const { pool } = require('../database')

const getItems = async (req, res) => {
  try {
    const { search, lot_id, print_status } = req.query
    let query = `
      SELECT i.*, l.lot_no, l.mfg_date, l.exp_date, l.cost,
             l.shelf_life_days, (l.exp_date - CURRENT_DATE) AS days_remaining,
             p.name AS product_name, p.mat_uid
      FROM item i
      JOIN lot l ON i.lot_id = l.id
      JOIN product p ON l.product_id = p.id
      WHERE 1=1`
    const params = []
    let idx = 1

    if (search) {
      query += ` AND (i.item_id ILIKE $${idx} OR l.lot_no ILIKE $${idx} OR p.name ILIKE $${idx} OR p.mat_uid ILIKE $${idx})`
      params.push(`%${search}%`)
      idx++
    }
    if (lot_id) {
      query += ` AND i.lot_id = $${idx}`
      params.push(lot_id)
      idx++
    }
    if (print_status) {
      query += ` AND i.print_status = $${idx}`
      params.push(print_status)
      idx++
    }

    query += ` ORDER BY l.mfg_date ASC, i.item_id ASC`
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getItemByItemId = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, l.lot_no, l.mfg_date, l.exp_date, l.cost, l.ave_cost,
              l.shelf_life_days, (l.exp_date - CURRENT_DATE) AS days_remaining,
              l.qty_remaining, l.status AS lot_status,
              p.name AS product_name, p.mat_uid, p.detail,
              p.weight_per_piece, p.max_stock, p.min_stock,
              pg.name AS group_name
       FROM item i
       JOIN lot l ON i.lot_id = l.id
       JOIN product p ON l.product_id = p.id
       LEFT JOIN product_group pg ON p.group_id = pg.id
       WHERE i.item_id = $1`,
      [req.params.itemId]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบสินค้า' })
    }
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const updatePrintStatus = async (req, res) => {
  const { ids } = req.body // array of item ids
  try {
    await pool.query(
      `UPDATE item SET print_status='printed', printed_at=NOW() WHERE id = ANY($1)`,
      [ids]
    )
    res.json({ message: `อัปเดตสถานะปริ้น ${ids.length} รายการสำเร็จ` })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const deleteItem = async (req, res) => {
  const { id } = req.params
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM dispense WHERE item_id = $1`, [id])
    const item = await client.query(`SELECT lot_id FROM item WHERE id = $1`, [id])
    await client.query(`DELETE FROM item WHERE id = $1`, [id])
    await client.query(
      `UPDATE lot SET qty_remaining = qty_remaining - 1, updated_at = NOW() WHERE id = $1`,
      [item.rows[0].lot_id]
    )
    const lot = await client.query(`SELECT product_id FROM lot WHERE id = $1`, [item.rows[0].lot_id])
    await client.query(`SELECT recalculate_ave_cost($1)`, [lot.rows[0].product_id])
    await client.query('COMMIT')
    res.json({ message: 'ลบสำเร็จ' })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}


module.exports = { getItems, getItemByItemId, updatePrintStatus, deleteItem }
