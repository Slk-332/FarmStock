const { loadUnits, convertOrThrow, unitName } = require('../lib/units')

/**
 * การหักของจากสต๊อกที่ใช้ร่วมกัน
 *
 * ทั้งการผสม (Phase 3) และการดูแลแปลงปลูก (Phase 4) หักของด้วยกติกาเดียวกันเป๊ะ:
 *   - เทียบในหน่วยบรรจุของสินค้า (ขวดละ 1 ลิตร → คิดเป็นลิตร)
 *   - ของที่ไม่มีขนาดบรรจุหักทีละทั้งหน่วย (ฟางข้าว 1 มัด)
 *   - หยิบ lot เก่าก่อน และในแต่ละ lot หยิบชิ้นที่เปิดแล้วก่อน
 *   - ต้นทุนคิดตามสัดส่วนที่ใช้จริง
 *
 * ต่างกันแค่ว่าบันทึกประวัติลงตารางไหน จึงรับ `onConsume` เข้ามาให้ผู้เรียกจัดการเอง
 *
 * ทุกฟังก์ชันรับ `client` ที่เปิด transaction ไว้แล้ว ไม่ BEGIN/COMMIT เอง
 */

/** ปัดให้พอดีกับ numeric(18,4) / numeric(18,2) — กันเศษลอยจากการคูณหารสะสม */
const round4 = (n) => Math.round(Number(n) * 10000) / 10000
const round2 = (n) => Math.round(Number(n) * 100) / 100

/**
 * แปลงรายการที่อยากใช้ ให้เป็น "บรรทัดพร้อมหัก" — บอกว่าต้องใช้กี่หน่วยบรรจุ
 * มีในสต๊อกเท่าไร และขาดเท่าไร
 *
 * `wanted` แต่ละตัว: { product_id, qty, unit_code, label? }
 */
async function resolveStockLines(client, wanted) {
  const units = await loadUnits(client)
  const lines = []

  for (const want of wanted) {
    const product = await client.query(
      `SELECT id, mat_uid, name, stock_unit, pack_size, pack_unit
       FROM product WHERE id = $1`,
      [want.product_id]
    )
    if (product.rows.length === 0) {
      throw new Error(`${want.label || 'รายการ'}: ไม่พบวัตถุดิบที่ระบุ`)
    }
    const p = product.rows[0]

    // มีขนาดบรรจุ = แบ่งใช้ได้ คิดเป็นหน่วยบรรจุ
    // ไม่มี = หักทีละทั้งหน่วย คิดเป็นหน่วยนับ
    const divisible = p.pack_size != null && p.pack_unit != null
    const workUnit = divisible ? p.pack_unit : p.stock_unit

    const required = convertOrThrow(units, want.qty, want.unit_code, workUnit, p.name)
    if (!(required > 0)) {
      throw new Error(`${p.name}: ปริมาณที่ใช้ต้องมากกว่า 0`)
    }

    const stock = await client.query(
      divisible
        ? `SELECT COALESCE(SUM(i.content_remaining), 0) AS available
           FROM item i JOIN lot l ON l.id = i.lot_id
           WHERE l.product_id = $1 AND i.status = 'active' AND l.status = 'active'`
        : `SELECT COUNT(*)::numeric AS available
           FROM item i JOIN lot l ON l.id = i.lot_id
           WHERE l.product_id = $1 AND i.status = 'active' AND l.status = 'active'`,
      [want.product_id]
    )
    const available = Number(stock.rows[0].available)

    lines.push({
      ...want,
      product_id:         p.id,
      mat_uid:            p.mat_uid,
      product_name:       p.name,
      required_qty:       round4(required),
      required_unit:      workUnit,
      required_unit_name: unitName(units, workUnit),
      available_qty:      round4(available),
      shortage:           round4(Math.max(0, required - available)),
      divisible,
    })
  }

  return lines
}

/**
 * หักของจริงตามบรรทัดที่ resolveStockLines คำนวณไว้
 *
 * `onConsume(row)` ถูกเรียกทุกครั้งที่หักจากชิ้นหนึ่ง เพื่อให้ผู้เรียกบันทึกประวัติ
 * ลงตารางของตัวเอง (mixing_consumption / plot_activity_material) แล้วคืนแถวที่บันทึกได้
 */
async function consumeFromStock(client, { lines, onConsume }) {
  const consumptions = []
  let totalCost = 0
  const touchedProducts = new Set()

  for (const line of lines) {
    if (line.shortage > 0) {
      throw new Error(
        `${line.product_name}: ต้องใช้ ${line.required_qty} ${line.required_unit_name} ` +
        `แต่มีในสต๊อก ${line.available_qty} — ขาด ${line.shortage}`
      )
    }

    // FOR UPDATE ล็อกชิ้นที่จะหยิบไว้ กันสองงานแย่งของก้อนเดียวกันพร้อมกัน
    const { rows: items } = await client.query(
      `SELECT i.id, i.item_id, i.content_size, i.content_remaining, i.content_unit,
              l.cost, l.id AS lot_id
       FROM item i
       JOIN lot l ON l.id = i.lot_id
       WHERE l.product_id = $1 AND i.status = 'active' AND l.status = 'active'
       ORDER BY l.mfg_date ASC, l.created_at ASC,
                (i.content_remaining < i.content_size) DESC NULLS LAST,
                i.item_id ASC
       FOR UPDATE OF i`,
      [line.product_id]
    )

    let remaining = line.required_qty

    for (const item of items) {
      if (remaining <= 0) break

      const inItem = line.divisible ? Number(item.content_remaining) : 1
      if (!(inItem > 0)) continue

      const take = Math.min(remaining, inItem)
      const left = round4(inItem - take)

      // ต้นทุนตามสัดส่วน — ใช้ 20 มล. จากขวด 1000 มล. ราคา 200 = 4 บาท
      const perUnitCost = Number(item.cost) || 0
      const portion = line.divisible && Number(item.content_size) > 0
        ? take / Number(item.content_size)
        : 1
      const cost = round4(perUnitCost * portion)

      if (line.divisible) {
        await client.query(
          'UPDATE item SET content_remaining = $1 WHERE id = $2', [left, item.id]
        )
      }

      // ชิ้นนี้หมดแล้ว — ปิดชิ้นและลดจำนวนคงเหลือของ lot ลง 1
      if (left <= 0) {
        await client.query(
          `UPDATE item SET status = 'dispensed', content_remaining = 0 WHERE id = $1`, [item.id]
        )
        await client.query(
          'UPDATE lot SET qty_remaining = qty_remaining - 1, updated_at = NOW() WHERE id = $1',
          [item.lot_id]
        )
        await client.query(
          `UPDATE lot SET status = 'done', updated_at = NOW()
           WHERE id = $1 AND qty_remaining <= 0`,
          [item.lot_id]
        )
      }

      const recorded = await onConsume({
        product_id: line.product_id,
        item_id:    item.id,
        qty:        round4(take),
        unit_code:  line.required_unit,
        cost,
      })

      consumptions.push({
        ...recorded,
        item_code:    item.item_id,
        product_name: line.product_name,
      })
      totalCost += cost
      remaining = round4(remaining - take)
    }

    if (remaining > 0) {
      // ผ่านการเช็ค shortage มาแล้วแต่ยังหยิบไม่พอ = มีคนอื่นหยิบตัดหน้าไประหว่างทาง
      throw new Error(
        `${line.product_name}: หยิบของได้ไม่ครบ ขาดอีก ${remaining} ${line.required_unit_name} ` +
        `(อาจมีการเบิกของชนิดนี้พร้อมกัน ลองใหม่อีกครั้ง)`
      )
    }

    touchedProducts.add(line.product_id)
  }

  // ต้นทุนเฉลี่ยของวัตถุดิบที่ถูกหักไปเปลี่ยน ต้องคำนวณใหม่ทุกตัว
  for (const productId of touchedProducts) {
    await client.query('SELECT recalculate_ave_cost($1)', [productId])
  }

  return { consumptions, totalCost: round2(totalCost) }
}

module.exports = { resolveStockLines, consumeFromStock, round2, round4 }
