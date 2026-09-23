const http = require('http')
const { listPrinters, checkPrinter, sendRaw } = require('./printers')
const { buildJob, buildSelfTest } = require('./tspl')

const AGENT_VERSION  = require('../package.json').version
const TOKEN_HEADER   = 'x-farmstock-token'
const MAX_BODY_BYTES = 32 * 1024 * 1024

/** พิมพ์ทีละ job ห้ามซ้อนกัน ไม่งั้น byte ของสอง job จะปนกันในคิวเดียว */
let printChain = Promise.resolve()
function queued(task) {
  const run = printChain.then(task, task)
  printChain = run.catch(() => {})
  return run
}

function applyCors(req, res, cfg) {
  const origin = req.headers.origin
  const allowAll = cfg.allowedOrigins.length === 0

  if (origin && (allowAll || cfg.allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else if (origin) {
    return false // origin ไม่อยู่ใน allowlist
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${TOKEN_HEADER}`)
  res.setHeader('Access-Control-Max-Age', '86400')

  // Private Network Access — Chrome ต้องการ header นี้ ตอนหน้าเว็บ https ยิงมาที่ 127.0.0.1
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
  return true
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type':  'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('ข้อมูลใหญ่เกินไป — ลองแบ่งพิมพ์เป็นรอบเล็กลง'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (err) { reject(new Error(`body ไม่ใช่ JSON ที่ถูกต้อง: ${err.message}`)) }
    })
    req.on('error', reject)
  })
}

function tokenOk(req, cfg) {
  if (!cfg.token) return true
  const got = req.headers[TOKEN_HEADER]
  if (typeof got !== 'string' || got.length !== cfg.token.length) return false
  // เทียบแบบ constant-time เบา ๆ
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ cfg.token.charCodeAt(i)
  return diff === 0
}

function createServer(cfg) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const route = `${req.method} ${url.pathname}`

    if (!applyCors(req, res, cfg)) {
      return sendJson(res, 403, { ok: false, error: `origin ${req.headers.origin} ไม่อยู่ใน allowedOrigins` })
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }

    try {
      // /health เปิดไว้ไม่ต้องใช้ token เพื่อให้หน้าเว็บเช็คได้ว่า agent เปิดอยู่ไหม
      if (route === 'GET /health') {
        return sendJson(res, 200, {
          ok:             true,
          agent:          'farmstock-print-agent',
          version:        AGENT_VERSION,
          defaultPrinter: cfg.defaultPrinter || null,
          requiresToken:  Boolean(cfg.token),
        })
      }

      if (!tokenOk(req, cfg)) {
        return sendJson(res, 401, { ok: false, error: 'token ไม่ถูกต้อง — ตั้งค่าใน config.json ของ agent ให้ตรงกับที่กรอกในหน้าเว็บ' })
      }

      if (route === 'GET /printers') {
        const printers = await listPrinters()
        return sendJson(res, 200, { ok: true, defaultPrinter: cfg.defaultPrinter || null, printers })
      }

      if (route === 'POST /print') {
        const job     = await readJsonBody(req)
        const printer = job.printer || cfg.defaultPrinter
        if (!printer) throw new Error('ไม่ได้ระบุเครื่องพิมพ์ และ config.json ก็ไม่มี defaultPrinter')

        const labelCount = Array.isArray(job.labels) ? job.labels.length : 0
        if (labelCount > cfg.maxLabelsPerJob) {
          throw new Error(`พิมพ์ได้สูงสุด ${cfg.maxLabelsPerJob} ดวงต่อครั้ง (ส่งมา ${labelCount})`)
        }

        const { buffer, printedIds } = buildJob(job)
        if (cfg.checkPrinterStatus) await checkPrinter(printer)

        const result = await queued(() => sendRaw(printer, buffer, `FarmStock ${printedIds.length} labels`))
        console.log(`[print] ${printedIds.length} ดวง → "${printer}" (${result.bytesWritten} bytes)`)

        return sendJson(res, 200, {
          ok:           true,
          printer,
          printedIds,
          labels:       printedIds.length,
          bytesWritten: result.bytesWritten,
          // ตรงไปตรงมา: spooler รับงานแล้ว ไม่ได้แปลว่าหมึกลงกระดาษครบทุกดวง
          note:         'spooler รับงานเรียบร้อย',
        })
      }

      if (route === 'POST /self-test') {
        const body    = await readJsonBody(req)
        const printer = body.printer || cfg.defaultPrinter
        if (!printer) throw new Error('ไม่ได้ระบุเครื่องพิมพ์')
        if (cfg.checkPrinterStatus) await checkPrinter(printer)
        const result = await queued(() => sendRaw(printer, buildSelfTest(body), 'FarmStock self-test'))
        return sendJson(res, 200, { ok: true, printer, bytesWritten: result.bytesWritten })
      }

      return sendJson(res, 404, { ok: false, error: `ไม่รู้จัก route ${route}` })
    } catch (err) {
      console.error(`[error] ${route}:`, err.message)
      return sendJson(res, 400, { ok: false, error: err.message })
    }
  })
}

module.exports = { createServer }
