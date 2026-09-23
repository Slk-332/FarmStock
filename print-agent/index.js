#!/usr/bin/env node
const { load, CONFIG_PATH } = require('./src/config')
const { createServer } = require('./src/server')
const { listPrinters, checkPrinter, sendRaw } = require('./src/printers')
const { buildSelfTest } = require('./src/tspl')

async function cliListPrinters() {
  const printers = await listPrinters()
  if (!printers.length) return console.log('ไม่พบเครื่องพิมพ์ในระบบ')
  console.log('เครื่องพิมพ์ที่ Windows รู้จัก:\n')
  for (const p of printers) {
    const flags = [
      p.isDefault ? 'ค่าเริ่มต้น' : null,
      p.offline ? 'ออฟไลน์' : null,
      p.errorState,
    ].filter(Boolean)
    console.log(`  • ${p.name}`)
    console.log(`      port: ${p.port || '-'}  สถานะ: ${p.status}${flags.length ? `  [${flags.join(', ')}]` : ''}`)
  }
  console.log('\nเอาชื่อไปใส่ "defaultPrinter" ใน config.json ได้เลย')
}

async function cliSelfTest(cfg) {
  const printer = process.argv[process.argv.indexOf('--self-test') + 1]?.startsWith('--')
    ? cfg.defaultPrinter
    : process.argv[process.argv.indexOf('--self-test') + 1] || cfg.defaultPrinter

  if (!printer) throw new Error('ไม่ได้ระบุเครื่องพิมพ์ — ใส่ defaultPrinter ใน config.json หรือ node index.js --self-test "ชื่อเครื่อง"')
  console.log(`กำลังส่งฉลากทดสอบไปที่ "${printer}" ...`)
  await checkPrinter(printer)
  const { bytesWritten } = await sendRaw(printer, buildSelfTest(), 'FarmStock self-test')
  console.log(`✔ ส่งแล้ว ${bytesWritten} bytes — ดูที่เครื่องพิมพ์ว่ามีฉลาก "FarmStock OK" ออกมาไหม`)
}

async function main() {
  if (process.argv.includes('--list-printers')) return cliListPrinters()

  const cfg = load()
  if (process.argv.includes('--self-test')) return cliSelfTest(cfg)

  const server = createServer(cfg)

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ port ${cfg.port} ถูกใช้อยู่แล้ว — อาจมี agent รันซ้อนอยู่ หรือเปลี่ยน port ใน config.json`)
      process.exit(1)
    }
    throw err
  })

  server.listen(cfg.port, cfg.host, () => {
    console.log('FarmStock Print Agent')
    console.log(`  ฟังอยู่ที่ http://${cfg.host}:${cfg.port}`)
    console.log(`  config:  ${CONFIG_PATH}`)
    console.log(`  เครื่องพิมพ์เริ่มต้น: ${cfg.defaultPrinter || '(ยังไม่ได้ตั้ง)'}`)
    console.log(`  token:   ${cfg.token ? 'เปิดใช้งาน' : '⚠ ปิดอยู่'}`)
    console.log(`  origin ที่อนุญาต: ${cfg.allowedOrigins.length ? cfg.allowedOrigins.join(', ') : '⚠ ทุก origin'}`)
  })

  const shutdown = () => {
    console.log('\nกำลังปิด agent ...')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('❌', err.message)
  process.exit(1)
})
