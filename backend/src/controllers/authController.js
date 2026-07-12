const bcrypt = require('bcryptjs')
const jwt    = require('jsonwebtoken')
const pool   = require('../database')

const login = async (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ message: 'กรุณากรอก username และ password' })
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'username หรือ password ไม่ถูกต้อง' })
    }

    const user = result.rows[0]
    const isMatch = await bcrypt.compare(password, user.password_hash)

    if (!isMatch) {
      return res.status(401).json({ message: 'username หรือ password ไม่ถูกต้อง' })
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    )

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
    )

    res.json({
      token,
      user: {
        id:        user.id,
        username:  user.username,
        full_name: user.full_name,
        role:      user.role,
      }
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด กรุณาลองใหม่' })
  }
}

const getMe = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, full_name, role, last_login FROM users WHERE id = $1',
      [req.user.id]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

module.exports = { login, getMe }
