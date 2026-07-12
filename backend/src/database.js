const { Pool } = require('pg')
require('dotenv').config()

const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL
const connectionUrl = connectionString ? new URL(connectionString) : null

const useSSL =
  process.env.DB_SSL === 'true' ||
  process.env.NODE_ENV === 'production' ||
  connectionString?.includes('supabase') ||
  process.env.DB_HOST?.includes('supabase')

const dbConfig = connectionString ? {
  connectionString,
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

const getDatabaseInfo = () => ({
  env: process.env.DATABASE_URL ? 'DATABASE_URL' : process.env.DIRECT_URL ? 'DIRECT_URL' : 'DB_*',
  host: connectionUrl?.hostname || process.env.DB_HOST || null,
  port: connectionUrl?.port || process.env.DB_PORT || null,
  ssl: Boolean(useSSL),
})

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL')
})

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err)
})

module.exports = { pool, getDatabaseInfo }
