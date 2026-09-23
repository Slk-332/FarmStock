#!/usr/bin/env node
/**
 * รัน migration ของฐานข้อมูล
 *
 * ใช้ node-pg-migrate ผ่าน API แทนการเรียก CLI ตรง ๆ เพราะ:
 *   1. node-pg-migrate v9 เป็น ESM ล้วน แต่ backend นี้เป็น CommonJS — เรียกผ่าน dynamic import
 *   2. CLI อ่าน DATABASE_URL จาก env เท่านั้น ไม่รู้จัก .env และไม่รู้ว่า Supabase ต้องใช้ SSL
 *      สคริปต์นี้ใช้ connectionConfig ตัวเดียวกับที่แอปใช้ จึงต่อได้เหมือนกันเป๊ะ
 *
 * รัน:
 *   npm run db:migrate           # อัปเดตขึ้นล่าสุด
 *   npm run db:migrate:down      # ถอยกลับ 1 ขั้น
 *   node scripts/migrate.js up 2 # อัปเดตขึ้น 2 ขั้น
 */
require('dotenv').config({ quiet: true })

const path = require('path')
const { connectionConfig, getDatabaseInfo } = require('../src/database')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')

async function main() {
  const direction = (process.argv[2] || 'up').toLowerCase()
  if (direction !== 'up' && direction !== 'down') {
    console.error(`ทิศทางไม่ถูกต้อง: "${direction}" (ต้องเป็น up หรือ down)`)
    process.exit(1)
  }

  // down ที่ไม่ระบุจำนวน = ถอย 1 ขั้น (กันเผลอถอยหมดทุก migration)
  const countArg = process.argv[3]
  const count = countArg ? Number(countArg) : direction === 'down' ? 1 : Infinity
  if (Number.isNaN(count)) {
    console.error(`จำนวนขั้นไม่ถูกต้อง: "${countArg}"`)
    process.exit(1)
  }

  const info = getDatabaseInfo()
  console.log(`กำลังรัน migration "${direction}" ที่ ${info.host}:${info.port} (ssl: ${info.ssl})`)

  const { runner } = await import('node-pg-migrate')

  const migrations = await runner({
    databaseUrl: connectionConfig,
    dir: MIGRATIONS_DIR,
    direction,
    count,
    migrationsTable: 'pgmigrations',
    // ทุก migration ที่ค้างอยู่รวมใน transaction เดียว — พังกลางทางแล้วย้อนกลับหมด
    singleTransaction: true,
    verbose: false,
  })

  if (migrations.length === 0) {
    console.log('✅ ไม่มี migration ที่ต้องรัน — ฐานข้อมูลเป็นเวอร์ชันล่าสุดแล้ว')
  } else {
    console.log(`✅ รันสำเร็จ ${migrations.length} รายการ:`)
    for (const m of migrations) console.log(`   ${direction === 'up' ? '↑' : '↓'} ${m.name}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n❌ migration ล้มเหลว: ${err.message}`)
    if (err.code === 'ENOTFOUND') {
      console.error('   host ไม่ resolve — โปรเจกต์ Supabase อาจถูก pause อยู่ ลองเข้า dashboard กด Resume ก่อน')
    }
    process.exit(1)
  })
