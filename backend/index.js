const express = require('express')
const cors    = require('cors')
require('dotenv').config()

const app = express()

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}))
app.use(express.json())

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