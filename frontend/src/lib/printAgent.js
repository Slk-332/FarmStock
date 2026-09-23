/**
 * client สำหรับคุยกับ FarmStock Print Agent ที่รันอยู่บนเครื่องเดียวกับเครื่องพิมพ์
 *
 * หน้าเว็บเป็น https แต่ยิงไป http://127.0.0.1 ได้ เพราะ Chrome ถือว่า localhost เป็น
 * trustworthy origin จึงไม่โดน mixed-content block
 * (ฝั่ง agent ต้องตอบ header Access-Control-Allow-Private-Network: true ซึ่งทำไว้แล้ว)
 */

const STORAGE_KEY = 'farmstock.printAgent'

export const DEFAULT_AGENT_URL = 'http://127.0.0.1:9110'

const DEFAULT_SETTINGS = {
  url:     DEFAULT_AGENT_URL,
  token:   '',
  printer: '',
  density: 8,
  speed:   4,
  gapMm:   2,
}

export function getAgentSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveAgentSettings(patch) {
  const next = { ...getAgentSettings(), ...patch }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* โหมด private อาจเขียนไม่ได้ */ }
  return next
}

function normalizeBaseUrl(url) {
  return String(url || DEFAULT_AGENT_URL).replace(/\/+$/, '')
}

async function request(path, { method = 'GET', body, timeout = 15000, settings } = {}) {
  const cfg = settings || getAgentSettings()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  let res
  try {
    res = await fetch(`${normalizeBaseUrl(cfg.url)}${path}`, {
      method,
      signal:  controller.signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cfg.token ? { 'X-FarmStock-Token': cfg.token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Print Agent ไม่ตอบกลับภายในเวลาที่กำหนด', { cause: err })
    throw new Error('ติดต่อ Print Agent ไม่ได้ — ตรวจสอบว่าโปรแกรมเปิดอยู่และ URL ถูกต้อง', { cause: err })
  } finally {
    clearTimeout(timer)
  }

  let payload = null
  try { payload = await res.json() } catch { /* ไม่ใช่ JSON */ }

  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Print Agent ตอบกลับ ${res.status}`)
  }
  return payload
}

/** เช็คว่า agent เปิดอยู่ไหม — endpoint นี้ไม่ต้องใช้ token */
export function checkAgent(settings) {
  return request('/health', { timeout: 5000, settings })
}

export function fetchPrinters(settings) {
  return request('/printers', { timeout: 20000, settings })
}

export function selfTest(printer, settings) {
  return request('/self-test', { method: 'POST', body: { printer }, timeout: 30000, settings })
}

/**
 * ส่งฉลากทั้งชุดเป็น job เดียว
 * @returns {{ printedIds: number[], labels: number, bytesWritten: number }}
 */
export function sendPrintJob(job, settings) {
  return request('/print', { method: 'POST', body: job, timeout: 120000, settings })
}
