const pool = require('../database')

const getGroups = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM product_group ORDER BY name ASC'
    )
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const createGroup = async (req, res) => {
  const { name } = req.body
  if (!name) return res.status(400).json({ message: 'กรุณากรอกชื่อ Group' })

  try {
    const exist = await pool.query(
      'SELECT id FROM product_group WHERE name = $1', [name]
    )
    if (exist.rows.length > 0) {
      return res.status(400).json({ message: 'Group นี้มีอยู่แล้ว' })
    }

    const result = await pool.query(
      'INSERT INTO product_group (name) VALUES ($1) RETURNING *',
      [name]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const deleteGroup = async (req, res) => {
  const { id } = req.params
  try {
    const inUse = await pool.query(
      'SELECT id FROM product WHERE group_id = $1 LIMIT 1', [id]
    )
    if (inUse.rows.length > 0) {
      return res.status(400).json({ message: 'ไม่สามารถลบได้ เพราะมีสินค้าใช้ Group นี้อยู่' })
    }
    await pool.query('DELETE FROM product_group WHERE id = $1', [id])
    res.json({ message: 'ลบ Group สำเร็จ' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

module.exports = { getGroups, createGroup, deleteGroup }