const { pool } = require('../database')
const { nextDocNo, createLotWithItems } = require('../services/stockService')
const { calculateRequirement, consumeMaterials, round4 } = require('../services/mixingService')
const { loadUnits, convertQty } = require('../lib/units')

/**
 * ใบสั่งผลิต (= T_MixingRequest)
 *
 * วงจร: requested → done (หรือ cancelled)
 * การผลิตจริงเกิดตอนกด "ยืนยันผลิต" เท่านั้น — ตอนนั้นถึงจะหักของจากสต๊อกและสร้าง lot ผลผลิต
 * ก่อนหน้านั้นใบสั่งผลิตเป็นแค่แผน ไม่จองของไว้
 */

/**
 * ดึงข้อมูลที่ต้องใช้ตอนคำนวณสูตร
 *
 * ระบุคอลัมน์ทีละตัวแทน `m.*, f.*` เพราะสองตารางมีชื่อคอลัมน์ชนกันหลายตัว
 * (id, note, created_by, created_at, updated_at) ซึ่งตัวหลังจะทับตัวหน้าเงียบ ๆ
 * และ `id` ที่ calculateRequirement ต้องใช้คือ id ของสูตร ไม่ใช่ของใบสั่งผลิต
 */
const ORDER_WITH_FORMULA = `
  SELECT m.id AS mixing_order_id, m.mix_no, m.mix_date, m.status,
         m.target_qty, m.target_unit,
         f.id, f.std_code, f.name AS formula_name,
         f.output_product_id, f.output_qty, f.output_unit,
         f.ferment_days, f.shelf_life_days, f.is_active,
         p.stock_unit AS output_stock_unit,
         p.pack_size  AS output_pack_size,
         p.pack_unit  AS output_pack_unit
  FROM mixing_order m
  JOIN formula f ON f.id = m.formula_id
  JOIN product p ON p.id = f.output_product_id`

const getMixingOrders = async (req, res) => {
  try {
    const { search, status, from, to } = req.query
    let query = `
      SELECT m.*,
             f.std_code, f.name AS formula_name,
             p.mat_uid AS output_mat_uid, p.name AS output_product_name,
             un.name AS target_unit_name,
             l.lot_no AS output_lot_no,
             u.full_name AS created_by_name
      FROM mixing_order m
      JOIN formula f ON f.id = m.formula_id
      JOIN product p ON p.id = f.output_product_id
      LEFT JOIN unit un ON un.code = m.target_unit
      LEFT JOIN lot l  ON l.id = m.output_lot_id
      LEFT JOIN users u ON u.id = m.created_by
      WHERE 1=1`
    const params = []

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (m.mix_no ILIKE $${params.length} OR f.std_code ILIKE $${params.length}
                 OR f.name ILIKE $${params.length})`
    }
    if (status) {
      params.push(status)
      query += ` AND m.status = $${params.length}`
    }
    if (from) {
      params.push(from)
      query += ` AND m.mix_date >= $${params.length}`
    }
    if (to) {
      params.push(to)
      query += ` AND m.mix_date <= $${params.length}`
    }

    query += ' ORDER BY m.mix_date DESC, m.id DESC'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getMixingOrderById = async (req, res) => {
  try {
    const order = await pool.query(
      `SELECT m.*,
              f.std_code, f.name AS formula_name, f.ferment_days, f.shelf_life_days,
              f.output_qty AS formula_output_qty, f.output_unit AS formula_output_unit,
              p.mat_uid AS output_mat_uid, p.name AS output_product_name,
              p.stock_unit AS output_stock_unit, p.pack_size AS output_pack_size,
              p.pack_unit AS output_pack_unit,
              un.name AS target_unit_name,
              l.lot_no AS output_lot_no,
              u.full_name AS created_by_name
       FROM mixing_order m
       JOIN formula f ON f.id = m.formula_id
       JOIN product p ON p.id = f.output_product_id
       LEFT JOIN unit un ON un.code = m.target_unit
       LEFT JOIN lot l  ON l.id = m.output_lot_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE m.id = $1`,
      [req.params.id]
    )
    if (order.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบใบสั่งผลิต' })
    }

    // ผลิตแล้วดูของที่หักไปจริง ยังไม่ผลิตดูของที่ต้องใช้ตามสูตร
    const consumption = await pool.query(
      `SELECT mc.*, p.mat_uid, p.name AS product_name, i.item_id AS item_code,
              un.name AS unit_name
       FROM mixing_consumption mc
       JOIN product p ON p.id = mc.product_id
       JOIN item i    ON i.id = mc.item_id
       LEFT JOIN unit un ON un.code = mc.unit_code
       WHERE mc.mixing_order_id = $1
       ORDER BY mc.id ASC`,
      [req.params.id]
    )

    res.json({ ...order.rows[0], consumption: consumption.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getNextMixNo = async (req, res) => {
  const client = await pool.connect()
  try {
    res.json({ mix_no: await nextDocNo(client, 'mixing_order') })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

/** ดึงสูตรมาคำนวณว่าต้องใช้อะไรเท่าไร และมีของพอไหม — ไม่แตะสต๊อก */
const getRequirement = async (req, res) => {
  const client = await pool.connect()
  try {
    const order = await client.query(`${ORDER_WITH_FORMULA} WHERE m.id = $1`, [req.params.id])
    if (order.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบใบสั่งผลิต' })
    }
    const row = order.rows[0]

    const requirement = await calculateRequirement(client, {
      formula:    row,
      targetQty:  row.target_qty,
      targetUnit: row.target_unit,
    })

    res.json({
      ...requirement,
      can_produce: requirement.lines.every((l) => l.shortage <= 0),
      suggested_output_units: await suggestOutputUnits(client, row),
    })
  } catch (err) {
    console.error(err)
    res.status(400).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

/**
 * เดาจำนวนหน่วยที่จะบรรจุได้ เช่น ผลิต 50 กก. ใส่กระสอบละ 50 กก. = 1 กระสอบ
 * เป็นแค่ตัวเลขแนะนำ ผู้ใช้แก้ได้ เพราะบรรจุจริงอาจไม่ลงตัว
 */
async function suggestOutputUnits(client, row) {
  if (!row.output_pack_size || !row.output_pack_unit) return null
  const units = await loadUnits(client)
  const targetInPackUnit = convertQty(units, row.target_qty, row.target_unit, row.output_pack_unit)
  if (targetInPackUnit === null) return null
  const n = Math.round(targetInPackUnit / Number(row.output_pack_size))
  return n > 0 ? n : null
}

const createMixingOrder = async (req, res) => {
  const { mix_no, mix_date, formula_id, target_qty, target_unit, note } = req.body

  if (!formula_id) return res.status(400).json({ message: 'กรุณาเลือกสูตร' })
  if (!(Number(target_qty) > 0)) {
    return res.status(400).json({ message: 'ปริมาณที่ต้องการผลิตต้องมากกว่า 0' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const formula = await client.query('SELECT * FROM formula WHERE id = $1', [formula_id])
    if (formula.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'ไม่พบสูตรที่เลือก' })
    }
    if (!formula.rows[0].is_active) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'สูตรนี้ถูกปิดการใช้งานอยู่' })
    }

    const unit = target_unit || formula.rows[0].output_unit
    // เช็คตั้งแต่ตอนสร้างว่าแปลงหน่วยได้ — ไม่งั้นจะไปพังตอนกดผลิตซึ่งสายไปแล้ว
    const units = await loadUnits(client)
    if (convertQty(units, target_qty, unit, formula.rows[0].output_unit) === null) {
      await client.query('ROLLBACK')
      return res.status(400).json({
        message: `หน่วยที่สั่งผลิตแปลงเป็นหน่วยของสูตร (${formula.rows[0].output_unit}) ไม่ได้`,
      })
    }

    const no = mix_no || (await nextDocNo(client, 'mixing_order'))
    const result = await client.query(
      `INSERT INTO mixing_order (mix_no, mix_date, formula_id, target_qty, target_unit, note, created_by)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7) RETURNING *`,
      [no, mix_date || null, formula_id, target_qty, unit, note || null, req.user.id]
    )

    await client.query('COMMIT')
    res.status(201).json(result.rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    if (err.code === '23505') {
      return res.status(400).json({ message: 'เลขที่ใบสั่งผลิตนี้มีอยู่แล้ว' })
    }
    res.status(500).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

/**
 * ยืนยันผลิต — จุดที่ทุกอย่างเกิดขึ้นจริง
 *
 * 1. คำนวณของที่ต้องใช้ใหม่ในทรานแซกชันนี้ (ไม่เชื่อตัวเลขที่หน้าจอส่งมา)
 * 2. ขาดแม้แต่ตัวเดียว = ยกเลิกทั้งหมด ไม่ผลิตครึ่ง ๆ กลาง ๆ
 * 3. หักของตาม FIFO แบบเปิดใช้บางส่วน รวมต้นทุนจริง
 * 4. สร้าง lot ผลผลิต + QR ตามจำนวนที่บรรจุได้
 */
const produceMixingOrder = async (req, res) => {
  const { id } = req.params
  const { output_units, lot_no, mfg_date, exp_date } = req.body

  const units = Number(output_units)
  if (!Number.isInteger(units) || units <= 0) {
    return res.status(400).json({ message: 'จำนวนหน่วยที่บรรจุได้ต้องเป็นจำนวนเต็มบวก (1 หน่วย = QR 1 ดวง)' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const order = await client.query(`${ORDER_WITH_FORMULA} WHERE m.id = $1 FOR UPDATE OF m`, [id])
    if (order.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'ไม่พบใบสั่งผลิต' })
    }
    const row = order.rows[0]
    if (row.status !== 'requested') {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'ใบสั่งผลิตนี้ผลิตไปแล้วหรือถูกยกเลิก' })
    }

    const requirement = await calculateRequirement(client, {
      formula:    row,
      targetQty:  row.target_qty,
      targetUnit: row.target_unit,
    })

    const short = requirement.lines.filter((l) => l.shortage > 0)
    if (short.length > 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({
        message: 'วัตถุดิบในสต๊อกไม่พอ',
        shortages: short.map((l) => ({
          product_name: l.product_name,
          required: l.required_qty,
          available: l.available_qty,
          shortage: l.shortage,
          unit: l.required_unit_name,
        })),
      })
    }

    const { totalCost } = await consumeMaterials(client, {
      mixingOrderId: row.mixing_order_id,
      requirement,
    })

    // อายุของผลผลิต = เวลาหมัก + อายุการเก็บรักษา นับจากวันผลิต
    const produceDate = mfg_date || row.mix_date
    const shelfDays = Number(row.ferment_days) + Number(row.shelf_life_days)
    const expiry = exp_date || new Date(
      new Date(produceDate).getTime() + shelfDays * 86400000
    ).toISOString().slice(0, 10)

    const costPerUnit = round4(totalCost / units)
    const outputLotNo = lot_no || (await nextDocNo(client, 'lot'))

    const { lot } = await createLotWithItems(client, {
      product_id: row.output_product_id,
      lot_no:     outputLotNo,
      qty:        units,
      cost:       costPerUnit,
      mfg_date:   produceDate,
      exp_date:   expiry,
      supplier:   `ผลิตเอง: ${row.std_code}`,
    })

    const updated = await client.query(
      `UPDATE mixing_order
       SET status = 'done', output_lot_id = $1, output_units = $2,
           total_cost = $3, cost_per_unit = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [lot.id, units, totalCost, costPerUnit, id]
    )

    await client.query('COMMIT')
    res.json({
      ...updated.rows[0],
      output_lot_no: lot.lot_no,
      qr_created: units,
      total_cost: totalCost,
      cost_per_unit: costPerUnit,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(400).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

const cancelMixingOrder = async (req, res) => {
  try {
    const current = await pool.query('SELECT status FROM mixing_order WHERE id = $1', [req.params.id])
    if (current.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบใบสั่งผลิต' })
    }
    if (current.rows[0].status === 'done') {
      return res.status(400).json({
        message: 'ผลิตไปแล้ว ยกเลิกไม่ได้ — ของถูกหักจากสต๊อกและออก QR ไปแล้ว',
      })
    }

    const result = await pool.query(
      `UPDATE mixing_order SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

module.exports = {
  getMixingOrders, getMixingOrderById, getNextMixNo,
  getRequirement, createMixingOrder, produceMixingOrder, cancelMixingOrder,
}
