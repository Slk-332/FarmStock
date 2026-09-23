const fs   = require('fs')
const path = require('path')

const ROOT         = path.join(__dirname, '..')
const CONFIG_PATH  = path.join(ROOT, 'config.json')
const EXAMPLE_PATH = path.join(ROOT, 'config.example.json')

const DEFAULTS = {
  host:               '127.0.0.1',
  port:               9110,
  token:              '',
  allowedOrigins:     [],
  defaultPrinter:     '',
  maxLabelsPerJob:    500,
  checkPrinterStatus: true,
}

function load() {
  if (!fs.existsSync(CONFIG_PATH)) {
    // ครั้งแรก: ก๊อป config.example.json มาให้เลย จะได้ไม่ต้องสร้างมือ
    if (fs.existsSync(EXAMPLE_PATH)) fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH)
    else fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2))
    console.warn(`[config] สร้าง ${CONFIG_PATH} ให้แล้ว — กรุณาแก้ token กับ allowedOrigins ก่อนใช้งานจริง`)
  }

  let raw
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch (err) {
    throw new Error(`อ่าน config.json ไม่ได้ (JSON ผิดรูปแบบ?): ${err.message}`)
  }

  const cfg = { ...DEFAULTS, ...raw }

  if (!Array.isArray(cfg.allowedOrigins)) cfg.allowedOrigins = []
  cfg.port            = Number(cfg.port) || DEFAULTS.port
  cfg.maxLabelsPerJob = Number(cfg.maxLabelsPerJob) || DEFAULTS.maxLabelsPerJob

  if (!cfg.token || cfg.token.startsWith('CHANGE-ME')) {
    console.warn('[config] ⚠ ยังไม่ได้ตั้ง token — ใครก็ตามที่เปิดหน้าเว็บบนเครื่องนี้สั่งพิมพ์ได้')
    cfg.token = ''
  }

  return cfg
}

module.exports = { load, CONFIG_PATH }
