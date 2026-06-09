const bcrypt = require('bcryptjs')
const pool   = require('../database')

const getUsers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, username, role, is_active, last_login, created_at
       FROM users ORDER BY created_at ASC`
    )
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const createUser = async (req, res) => {
  const { full_name, username, password, role } = req.body

  if (!full_name || !username || !password || !role) {
    return res.status(400).json({ message: 'กรุณากรอกข้อมูลให้ครบ' })
  }

  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ message: 'role ไม่ถูกต้อง' })
  }

  try {
    const exist = await pool.query(
      'SELECT id FROM users WHERE username = $1', [username]
    )
    if (exist.rows.length > 0) {
      return res.status(400).json({ message: 'username นี้มีอยู่แล้ว' })
    }

    const hash = await bcrypt.hash(password, 10)
    const result = await pool.query(
      `INSERT INTO users (full_name, username, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, username, role, is_active, created_at`,
      [full_name, username, hash, role]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const updateUser = async (req, res) => {
  const { id } = req.params
  const { full_name, role, password } = req.body

  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10)
      await pool.query(
        `UPDATE users SET full_name=$1, role=$2, password_hash=$3 WHERE id=$4`,
        [full_name, role, hash, id]
      )
    } else {
      await pool.query(
        `UPDATE users SET full_name=$1, role=$2 WHERE id=$3`,
        [full_name, role, id]
      )
    }
    res.json({ message: 'อัปเดตสำเร็จ' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const toggleUser = async (req, res) => {
  const { id } = req.params

  // ป้องกัน admin ปิดตัวเอง
  if (id === req.user.id) {
    return res.status(400).json({ message: 'ไม่สามารถปิดใช้งานตัวเองได้' })
  }

  try {
    const result = await pool.query(
      `UPDATE users SET is_active = NOT is_active WHERE id = $1
       RETURNING is_active`,
      [id]
    )
    res.json({
      message: result.rows[0].is_active ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว',
      is_active: result.rows[0].is_active
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

module.exports = { getUsers, createUser, updateUser, toggleUser }