const express = require('express')
const cors    = require('cors')
require('dotenv').config()

const app = express()
const { pool, getDatabaseInfo } = require('./src/database')

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}))
app.use(express.json())

app.get('/api/health', async (req, res) => {
  const missingEnv = []
  if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
    for (const key of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
      if (!process.env[key]) missingEnv.push(key)
    }
  }
  if (!process.env.JWT_SECRET) missingEnv.push('JWT_SECRET')

  try {
    await pool.query('SELECT 1')
    res.json({
      ok: true,
      database: 'connected',
      databaseInfo: getDatabaseInfo(),
      missingEnv,
    })
  } catch (err) {
    console.error('Health check failed:', err)
    res.status(500).json({
      ok: false,
      database: 'error',
      databaseInfo: getDatabaseInfo(),
      missingEnv,
      error: err.code || err.message,
    })
  }
})

// Routes
app.use('/api/auth',    require('./src/routes/auth'))
app.use('/api/users',   require('./src/routes/users'))
app.use('/api/groups',  require('./src/routes/groups'))
app.use('/api/products',require('./src/routes/products'))
app.use('/api/lots',    require('./src/routes/lots'))
app.use('/api/items',   require('./src/routes/items'))
app.use('/api/dispense',require('./src/routes/dispense'))
app.use('/api/report',  require('./src/routes/report'))

// Health check
app.get('/', (req, res) => {
  res.json({ message: '🌱 FarmStock API is running' })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
})
