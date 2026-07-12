const { pool } = require('../database')

const getProducts = async (req, res) => {
  try {
    const { search } = req.query
    let query = `SELECT * FROM v_stock_summary`
    const params = []

    if (search) {
      query += ` WHERE mat_uid ILIKE $1 OR name ILIKE $1 OR group_name ILIKE $1`
      params.push(`%${search}%`)
    }

    query += ` ORDER BY name ASC`
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getProductById = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, pg.name as group_name
       FROM product p
       LEFT JOIN product_group pg ON p.group_id = pg.id
       WHERE p.id = $1`,
      [req.params.id]
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

const createProduct = async (req, res) => {
  const { mat_uid, name, detail, weight_per_piece, pieces_per_lot, max_stock, min_stock, group_id } = req.body

  if (!mat_uid || !name) {
    return res.status(400).json({ message: 'กรุณากรอก MatUID และชื่อสินค้า' })
  }

  try {
    const exist = await pool.query(
      'SELECT id FROM product WHERE mat_uid = $1', [mat_uid]
    )
    if (exist.rows.length > 0) {
      return res.status(400).json({ message: 'MatUID นี้มีอยู่แล้ว' })
    }

    const result = await pool.query(
      `INSERT INTO product (mat_uid, name, detail, weight_per_piece, pieces_per_lot, max_stock, min_stock, group_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [mat_uid, name, detail, weight_per_piece, pieces_per_lot, max_stock || 0, min_stock || 0, group_id]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const updateProduct = async (req, res) => {
  const { name, detail, weight_per_piece, pieces_per_lot, max_stock, min_stock, group_id } = req.body
  try {
    await pool.query(
      `UPDATE product
       SET name=$1, detail=$2, weight_per_piece=$3, pieces_per_lot=$4,
           max_stock=$5, min_stock=$6, group_id=$7, updated_at=NOW()
       WHERE id=$8`,
      [name, detail, weight_per_piece, pieces_per_lot, max_stock, min_stock, group_id, req.params.id]
    )
    res.json({ message: 'อัปเดตสำเร็จ' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

module.exports = { getProducts, getProductById, createProduct, updateProduct }
