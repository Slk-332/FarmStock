const { Pool } = require('pg')
require('dotenv').config()

const useSSL =
  process.env.DB_SSL === 'true' ||
  process.env.NODE_ENV === 'production' ||
  process.env.DATABASE_URL?.includes('supabase') ||
  process.env.DB_HOST?.includes('supabase')

const dbConfig = process.env.DATABASE_URL ? {
  connectionString: process.env.DATABASE_URL,
} : {
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
}

const pool = new Pool({
  ...dbConfig,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
})

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL')
})

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err)
})

module.exports = pool
