const { pool } = require('../database')
const { nextDocNo, createLotWithItems } = require('../services/stockService')

const getLots = async (req, res) => {
  try {
    const { search } = req.query
    let query = `
      SELECT
        v.*,
        p.detail,
        p.pack_size,
        p.pack_unit,
        p.stock_unit,
        p.max_stock,
        p.min_stock
      FROM v_lot_detail v
      JOIN product p ON v.product_id = p.id
    `
    const params = []

    if (search) {
      query += ` WHERE v.lot_no ILIKE $1 OR v.mat_uid ILIKE $1 OR v.product_name ILIKE $1
                 OR v.group_name ILIKE $1 OR CAST(v.mfg_date AS TEXT) ILIKE $1
                 OR CAST(v.exp_date AS TEXT) ILIKE $1
                 OR p.detail ILIKE $1`
      params.push(`%${search}%`)
    }

    query += ` ORDER BY 
  CASE WHEN v.status = 'done' THEN 1
       WHEN v.status = 'expired' THEN 2
       ELSE 0 END ASC,
  v.created_at ASC`
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getLotsByProduct = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM v_lot_detail WHERE product_id = $1 AND status = 'active' ORDER BY mfg_date ASC`,
      [req.params.productId]
    )
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

/** ออกเลข Lot ถัดไปให้ฝั่งหน้าจอ — เดิม frontend เดาเลขจากจำนวนแถวซึ่งซ้ำได้ถ้ามีการลบ */
const getNextLotNo = async (req, res) => {
  const client = await pool.connect()
  try {
    res.json({ lot_no: await nextDocNo(client, 'lot') })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

const createLot = async (req, res) => {
  const { product_id, lot_no, qty_received, cost, mfg_date, exp_date, supplier } = req.body

  if (!product_id || !lot_no || !qty_received || !cost || !mfg_date || !exp_date) {
    return res.status(400).json({ message: 'กรุณากรอกข้อมูลให้ครบ' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { lot, items } = await createLotWithItems(client, {
      product_id, lot_no, qty: qty_received, cost, mfg_date, exp_date, supplier,
    })
    await client.query('COMMIT')
    res.status(201).json({ lot, items_created: items.length })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

const updateLot = async (req, res) => {
  const { id } = req.params
  const { mfg_date, exp_date, cost, qty_remaining, status, supplier } = req.body

  try {
    await pool.query(
      `UPDATE lot SET mfg_date=$1, exp_date=$2, cost=$3, qty_remaining=$4,
       status=$5, supplier=$6, updated_at=NOW() WHERE id=$7`,
      [mfg_date, exp_date, cost, qty_remaining, status, supplier, id]
    )

    // คำนวณ AveCost ใหม่
    const lot = await pool.query('SELECT product_id FROM lot WHERE id=$1', [id])
    await pool.query('SELECT recalculate_ave_cost($1)', [lot.rows[0].product_id])

    res.json({ message: 'อัปเดตสำเร็จ' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const deleteLot = async (req, res) => {
  const { id } = req.params
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // ลบ dispense ที่เกี่ยวข้อง
    await client.query(`DELETE FROM dispense WHERE item_id IN (SELECT id FROM item WHERE lot_id = $1)`, [id])
    // ลบ items
    await client.query(`DELETE FROM item WHERE lot_id = $1`, [id])
    // ลบ lot
    await client.query(`DELETE FROM lot WHERE id = $1`, [id])
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

module.exports = { getLots, getLotsByProduct, getNextLotNo, createLot, updateLot, deleteLot }

