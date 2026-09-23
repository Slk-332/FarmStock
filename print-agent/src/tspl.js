/**
 * แปลง job spec ที่ frontend ส่งมา → คำสั่ง TSPL (byte buffer) สำหรับ Xprinter XP-420B
 *
 * TSPL อ้างอิงพิกัดเป็น "dot" ไม่ใช่ mm
 *   203 DPI = 8 dots/mm   (รุ่น 300 DPI = 11.81 dots/mm)
 *
 * รูปแบบ job:
 * {
 *   widthMm, heightMm, gapMm, density, speed, direction, copies,
 *   labels: [{
 *     id,                                  // item.id ไว้ให้ frontend เอาไป mark printed
 *     bitmap: { x, y, width, height, dataBase64 }
 *   }]
 * }
 *
 * dataBase64 = บิตแมป 1-bit แพ็คตามแถว MSB ก่อน โดย **bit 1 = จุดสีดำ**
 * (TSPL ใช้กลับกันคือ 0 = ดำ — เรากลับบิตให้ตรงนี้ เพื่อให้ฝั่ง frontend ใช้ convention ที่อ่านง่ายกว่า)
 */

const CRLF = Buffer.from('\r\n', 'ascii')

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function ascii(line) {
  return Buffer.concat([Buffer.from(line, 'ascii'), CRLF])
}

function buildBitmapCommand(bitmap) {
  const { x, y, width, height, dataBase64 } = bitmap

  const px = clampInt(x, 0, 9999, 0)
  const py = clampInt(y, 0, 9999, 0)
  const pw = clampInt(width, 1, 4096, 0)
  const ph = clampInt(height, 1, 9999, 0)

  if (!pw || !ph) throw new Error('bitmap ต้องมี width และ height')

  const widthBytes = Math.ceil(pw / 8)
  const raw = Buffer.from(String(dataBase64 || ''), 'base64')
  const expected = widthBytes * ph

  if (raw.length !== expected) {
    throw new Error(
      `ขนาด bitmap ไม่ตรง: ได้ ${raw.length} byte แต่ ${pw}×${ph} ต้องการ ${expected} byte ` +
      `(${widthBytes} byte/แถว × ${ph} แถว)`
    )
  }

  // กลับบิต: frontend ส่งมาแบบ 1=ดำ, TSPL ต้องการ 0=ดำ
  const inverted = Buffer.allocUnsafe(raw.length)
  for (let i = 0; i < raw.length; i++) inverted[i] = ~raw[i] & 0xff

  return Buffer.concat([
    Buffer.from(`BITMAP ${px},${py},${widthBytes},${ph},0,`, 'ascii'),
    inverted,
    CRLF,
  ])
}

function buildJob(job) {
  const widthMm  = Number(job.widthMm)
  const heightMm = Number(job.heightMm)
  const gapMm    = Number(job.gapMm ?? 2)

  if (!Number.isFinite(widthMm) || widthMm <= 0)   throw new Error('widthMm ไม่ถูกต้อง')
  if (!Number.isFinite(heightMm) || heightMm <= 0) throw new Error('heightMm ไม่ถูกต้อง')
  if (!Array.isArray(job.labels) || job.labels.length === 0) throw new Error('ไม่มี label ให้พิมพ์')

  const density   = clampInt(job.density, 0, 15, 8)
  const speed     = clampInt(job.speed, 1, 6, 4)
  const direction = clampInt(job.direction, 0, 1, 0)
  const copies    = clampInt(job.copies, 1, 99, 1)

  const parts = [
    // ตั้งค่าระดับ job — ส่งครั้งเดียวพอ ค่าจะค้างอยู่จนกว่าจะสั่งใหม่
    ascii(`SIZE ${widthMm.toFixed(1)} mm,${heightMm.toFixed(1)} mm`),
    ascii(`GAP ${Math.max(0, gapMm).toFixed(1)} mm,0 mm`),
    ascii(`DIRECTION ${direction}`),
    ascii('REFERENCE 0,0'),
    ascii(`DENSITY ${density}`),
    ascii(`SPEED ${speed}`),
    ascii('SET TEAR ON'),
  ]

  const printedIds = []

  for (const label of job.labels) {
    if (!label || !label.bitmap) throw new Error(`label id=${label?.id} ไม่มี bitmap`)
    parts.push(ascii('CLS'))
    parts.push(buildBitmapCommand(label.bitmap))
    parts.push(ascii(`PRINT 1,${copies}`))
    printedIds.push(label.id)
  }

  return { buffer: Buffer.concat(parts), printedIds }
}

/** ฉลากทดสอบ ใช้ฟอนต์ในตัวเครื่อง ไม่ต้องพึ่ง bitmap จาก frontend */
function buildSelfTest({ widthMm = 40, heightMm = 20, gapMm = 2 } = {}) {
  return Buffer.concat([
    ascii(`SIZE ${widthMm.toFixed(1)} mm,${heightMm.toFixed(1)} mm`),
    ascii(`GAP ${gapMm.toFixed(1)} mm,0 mm`),
    ascii('DIRECTION 0'),
    ascii('REFERENCE 0,0'),
    ascii('DENSITY 8'),
    ascii('SPEED 4'),
    ascii('CLS'),
    ascii('TEXT 16,16,"2",0,1,1,"FarmStock OK"'),
    ascii('TEXT 16,48,"1",0,1,1,"Print agent self-test"'),
    ascii('PRINT 1,1'),
  ])
}

module.exports = { buildJob, buildSelfTest }
