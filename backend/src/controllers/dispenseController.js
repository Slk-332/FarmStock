const pool = require('../database')

const getDispenses = async (req, res) => {
  try {
    const { search, from, to } = req.query
    let query = `
      SELECT d.*, i.item_id, l.lot_no, l.mfg_date, l.exp_date,
             p.name AS product_name, p.mat_uid,
             pg.name AS group_name,
             u.full_name AS dispensed_by
      FROM dispense d
      JOIN item i    ON d.item_id  = i.id
      JOIN lot l     ON i.lot_id   = l.id
      JOIN product p ON l.product_id = p.id
      LEFT JOIN product_group pg ON p.group_id = pg.id
      JOIN users u   ON d.user_id  = u.id
      WHERE 1=1`
    const params = []
    let idx = 1

    if (search) {
      query += ` AND (i.item_id ILIKE $${idx} OR l.lot_no ILIKE $${idx}
                 OR p.name ILIKE $${idx} OR p.mat_uid ILIKE $${idx}
                 OR pg.name ILIKE $${idx})`
      params.push(`%${search}%`)
      idx++
    }
    if (from) {
      query += ` AND d.dispensed_at >= $${idx}`
      params.push(from)
      idx++
    }
    if (to) {
      query += ` AND d.dispensed_at <= $${idx}`
      params.push(to)
      idx++
    }

    query += ` ORDER BY d.dispensed_at DESC`
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const createDispense = async (req, res) => {
  const { item_id, remark } = req.body

  if (!item_id) {
    return res.status(400).json({ message: 'กรุณาระบุ item_id' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // ดึงข้อมูล item
    const itemResult = await client.query(
      `SELECT i.*, l.lot_no, l.cost, l.product_id, l.mfg_date,
              (l.exp_date - CURRENT_DATE) AS days_remaining
       FROM item i JOIN lot l ON i.lot_id = l.id
       WHERE i.id = $1 AND i.status = 'active'`,
      [item_id]
    )

    if (itemResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'ไม่พบสินค้า หรือสินค้าถูกเบิกไปแล้ว' })
    }

    const item = itemResult.rows[0]

    // เช็ค FIFO — ต้องเป็น Lot เก่าสุดของสินค้านี้
    const fifoCheck = await client.query(
      `SELECT l.id FROM lot l
       JOIN item i ON i.lot_id = l.id
       WHERE l.product_id = $1 AND l.status = 'active' AND i.status = 'active'
       ORDER BY l.mfg_date ASC LIMIT 1`,
      [item.product_id]
    )

    if (fifoCheck.rows.length > 0 && fifoCheck.rows[0].id !== item.lot_id) {
      await client.query('ROLLBACK')
      return res.status(400).json({
        message: 'FIFO: ต้องเบิก Lot เก่ากว่านี้ให้หมดก่อน',
        must_use_lot_id: fifoCheck.rows[0].id
      })
    }

    // บันทึกการเบิก
    const dispenseResult = await client.query(
      `INSERT INTO dispense (item_id, user_id, qty_dispensed, qty_used, qty_waste, cost_per_piece, total_cost, remark)
       VALUES ($1,$2,1,1,0,$3,$3,$4) RETURNING *`,
      [item_id, req.user.id, item.cost, remark]
    )

    // อัปเดต item status
    await client.query(
      `UPDATE item SET status='dispensed' WHERE id=$1`, [item_id]
    )

    // อัปเดต qty_remaining ของ lot
    await client.query(
      `UPDATE lot SET qty_remaining = qty_remaining - 1, updated_at=NOW() WHERE id=$1`,
      [item.lot_id]
    )

    // เช็คว่า lot หมดแล้วไหม
    const lotCheck = await client.query(
      `SELECT qty_remaining FROM lot WHERE id=$1`, [item.lot_id]
    )
    if (lotCheck.rows[0].qty_remaining <= 0) {
      await client.query(
        `UPDATE lot SET status='done', updated_at=NOW() WHERE id=$1`, [item.lot_id]
      )
    }

    // คำนวณ AveCost ใหม่
    await client.query('SELECT recalculate_ave_cost($1)', [item.product_id])

    await client.query('COMMIT')
    res.status(201).json(dispenseResult.rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

const updateDispense = async (req, res) => {
  const { id } = req.params
  const { qty_used, qty_waste, remark } = req.body

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const dispense = await client.query(
      `SELECT d.*, i.lot_id, l.product_id FROM dispense d
       JOIN item i ON d.item_id = i.id
       JOIN lot l ON i.lot_id = l.id
       WHERE d.id = $1`,
      [id]
    )

    if (dispense.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบรายการ' })
    }

    const d = dispense.rows[0]
    const returnQty = d.qty_dispensed - qty_used - qty_waste

    // ถ้าของเหลือ คืน stock
    if (returnQty > 0) {
      await client.query(
        `UPDATE lot SET qty_remaining = qty_remaining + $1,
         status = 'active', updated_at=NOW() WHERE id=$2`,
        [returnQty, d.lot_id]
      )
    }

    await client.query(
      `UPDATE dispense SET qty_used=$1, qty_waste=$2, remark=$3,
       status='edited', updated_at=NOW(), updated_by=$4 WHERE id=$5`,
      [qty_used, qty_waste, remark, req.user.id, id]
    )

    // คำนวณ AveCost ใหม่
    await client.query('SELECT recalculate_ave_cost($1)', [d.product_id])

    await client.query('COMMIT')
    res.json({ message: 'อัปเดตสำเร็จ' })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

module.exports = { getDispenses, createDispense, updateDispense }