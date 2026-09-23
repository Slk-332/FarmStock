/**
 * ตรรกะสต๊อกที่ใช้ร่วมกันหลายระบบ
 *
 * เดิมการสร้าง lot + item ฝังอยู่ใน lotsController อย่างเดียว แต่ตั้งแต่ Phase 2 เป็นต้นไป
 * มีอีกหลายทางที่ของเข้าสต๊อก — รับของตามใบสั่งซื้อ (Phase 2), ผสมเสร็จ (Phase 3),
 * เก็บเกี่ยว (Phase 4) — ทุกทางต้องได้ item รายชิ้นและ ave_cost ที่ถูกต้องเหมือนกัน
 * จึงย้ายมาไว้ที่เดียว
 *
 * ทุกฟังก์ชันในนี้รับ `client` จาก pool.connect() ที่เปิด transaction ไว้แล้ว
 * ตัวมันเองไม่ BEGIN/COMMIT เพื่อให้ผู้เรียกคุมขอบเขต transaction ได้เอง
 */

/** ตารางที่ออกเลขเอกสารให้ได้ — จำกัดไว้เพราะชื่อตาราง/คอลัมน์ผูกเข้า SQL ตรง ๆ ไม่ใช่ parameter */
const DOC_SEQUENCES = {
  purchase_order: { table: 'purchase_order', column: 'order_code',  prefix: 'PR1', width: 5 },
  goods_receipt:  { table: 'goods_receipt',  column: 'receipt_no',  prefix: 'RC',  width: 6 },
  // PR1xxxxx = ใบสั่งซื้อ, PR2xxxxx = ใบสั่งผลิต — ตามรูปแบบเดิมในไฟล์ตัวอย่าง
  mixing_order:   { table: 'mixing_order',   column: 'mix_no',      prefix: 'PR2', width: 5 },
  lot:            { table: 'lot',            column: 'lot_no',      prefix: 'LOT', width: 6 },
}

/**
 * ออกเลขเอกสารถัดไป เช่น PR100001 → PR100002
 *
 * อ่าน MAX จากฐานข้อมูลแทนการนับจำนวนแถว (ของเดิมฝั่ง frontend ใช้ `rows.length + 1`
 * ซึ่งเลขซ้ำทันทีที่มีใครลบเอกสารทิ้งไปสักใบ)
 */
async function nextDocNo(client, kind) {
  const seq = DOC_SEQUENCES[kind]
  if (!seq) throw new Error(`ไม่รู้จักชนิดเอกสาร "${kind}"`)

  const { rows } = await client.query(
    `SELECT COALESCE(MAX(SUBSTRING(${seq.column} FROM ${seq.prefix.length + 1})::bigint), 0) AS last
     FROM ${seq.table}
     WHERE ${seq.column} ~ $1`,
    [`^${seq.prefix}[0-9]+$`]
  )
  const next = Number(rows[0].last) + 1
  return `${seq.prefix}${String(next).padStart(seq.width, '0')}`
}

/**
 * สร้าง lot ใหม่พร้อม item รายชิ้น แล้วคำนวณ ave_cost ใหม่
 *
 * qty ต้องเป็นจำนวนเต็มบวก เพราะ 1 หน่วยนับ = 1 item = 1 QR — รับของ 2.5 กระสอบไม่ได้
 * รูปแบบ item_id คงของเดิมไว้ทุกตัวอักษร (`MATUID-LOTxxxxxx-001`) เพื่อไม่ให้ฉลากที่พิมพ์ไปแล้วอ่านไม่ตรง
 */
async function createLotWithItems(client, { product_id, lot_no, qty, cost, mfg_date, exp_date, supplier }) {
  const qtyInt = Number(qty)
  if (!Number.isInteger(qtyInt) || qtyInt <= 0) {
    throw new Error('จำนวนที่รับเข้าต้องเป็นจำนวนเต็มบวก (1 หน่วยนับ = 1 QR)')
  }

  const product = await client.query(
    'SELECT mat_uid, pack_size, pack_unit FROM product WHERE id = $1', [product_id]
  )
  if (product.rows.length === 0) {
    throw new Error('ไม่พบสินค้าที่ระบุ')
  }

  const lotResult = await client.query(
    `INSERT INTO lot (product_id, lot_no, qty_received, qty_remaining, cost, mfg_date, exp_date, supplier)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7) RETURNING *`,
    [product_id, lot_no, qtyInt, cost, mfg_date, exp_date, supplier || null]
  )
  const lot = lotResult.rows[0]

  const { mat_uid, pack_size, pack_unit } = product.rows[0]
  const matUid = mat_uid.replace(/-/g, '')
  const lotSeq = lot_no.replace(/[^0-9]/g, '').padStart(3, '0')

  // แทรก item ทั้งหมดในคำสั่งเดียว — ของเดิมยิงทีละ round-trip ต่อชิ้น
  // รับ 100 กระสอบ = 100 รอบไป-กลับฐานข้อมูล ซึ่งช้ามากบน Supabase ที่อยู่คนละทวีป
  const itemIds = []
  for (let i = 1; i <= qtyInt; i++) {
    itemIds.push(`${matUid}-LOT${lotSeq}-${String(i).padStart(3, '0')}`)
  }

  // ปริมาณบรรจุถูกคัดลอกลงแต่ละชิ้นตั้งแต่ตอนรับเข้า ไม่อ้าง product.pack_size ตอนใช้งาน
  // เพราะถ้าวันหลังแก้ขนาดบรรจุของสินค้า ของที่อยู่ในคลังแล้วต้องคงปริมาณจริงของมันไว้
  // (ของที่ไม่มีขนาดบรรจุจะเป็น NULL = หักได้ทีละทั้งหน่วยเท่านั้น)
  const itemsResult = await client.query(
    `INSERT INTO item (item_id, lot_id, content_size, content_unit, content_remaining)
     SELECT unnest($1::text[]), $2, $3, $4, $3
     RETURNING *`,
    [itemIds, lot.id, pack_size ?? null, pack_unit ?? null]
  )

  await client.query('SELECT recalculate_ave_cost($1)', [product_id])

  return { lot, items: itemsResult.rows }
}

module.exports = { nextDocNo, createLotWithItems, DOC_SEQUENCES }
