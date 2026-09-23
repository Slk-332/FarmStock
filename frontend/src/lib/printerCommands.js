/**
 * แปลงบิตแมปฉลาก → byte คำสั่งเครื่องพิมพ์ ฝั่งเบราว์เซอร์
 *
 * ใช้ตอนพิมพ์ผ่าน Bluetooth ซึ่งไม่มี Print Agent มาช่วยแปลงให้
 * (ส่วน TSPL ตรงกับ print-agent/src/tspl.js — ถ้าแก้ฝั่งหนึ่งต้องดูอีกฝั่งด้วย)
 *
 * รองรับ 2 ภาษา:
 *   - TSPL    : เครื่องพิมพ์ฉลากแบบมีช่องว่างระหว่างดวง (Xprinter, Gprinter, HPRT ส่วนใหญ่)
 *   - ESC/POS : เครื่องพิมพ์ใบเสร็จ/สติกเกอร์ม้วนต่อเนื่องแบบพกพา
 *
 * บิตแมปที่รับเข้ามาเป็นแบบเดียวกับ labelRender.canvasToPackedBitmap:
 *   แพ็คตามแถว MSB ก่อน, **bit 1 = จุดสีดำ**
 */

export const PROTOCOLS = [
  { value: 'tspl',   label: 'TSPL (เครื่องพิมพ์ฉลาก)' },
  { value: 'escpos', label: 'ESC/POS (เครื่องพิมพ์ใบเสร็จ/ม้วนต่อเนื่อง)' },
]

const encoder = new TextEncoder()
const ascii = (line) => encoder.encode(`${line}\r\n`)

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function concatBytes(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function decodeBase64(b64) {
  const bin = atob(String(b64 || ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** ดึง byte ของบิตแมปออกมาพร้อมเช็คขนาด — ขนาดไม่ตรงคือบั๊ก ไม่ควรพิมพ์ขยะออกไป */
function bitmapBytes({ width, height, dataBase64 }) {
  const widthBytes = Math.ceil(width / 8)
  const raw = decodeBase64(dataBase64)
  if (raw.length !== widthBytes * height) {
    throw new Error(`ขนาด bitmap ไม่ตรง: ได้ ${raw.length} byte แต่ ${width}×${height} ต้องการ ${widthBytes * height} byte`)
  }
  return { raw, widthBytes }
}

/* ---------- TSPL ---------- */

export function buildTsplJob({ widthMm, heightMm, gapMm = 2, density = 8, speed = 4, bitmaps }) {
  if (!(Number(widthMm) > 0) || !(Number(heightMm) > 0)) throw new Error('ขนาดฉลากไม่ถูกต้อง')
  if (!bitmaps?.length) throw new Error('ไม่มีฉลากให้พิมพ์')

  const parts = [
    ascii(`SIZE ${Number(widthMm).toFixed(1)} mm,${Number(heightMm).toFixed(1)} mm`),
    ascii(`GAP ${Math.max(0, Number(gapMm) || 0).toFixed(1)} mm,0 mm`),
    ascii('DIRECTION 0'),
    ascii('REFERENCE 0,0'),
    ascii(`DENSITY ${clampInt(density, 0, 15, 8)}`),
    ascii(`SPEED ${clampInt(speed, 1, 6, 4)}`),
    ascii('SET TEAR ON'),
  ]

  for (const bitmap of bitmaps) {
    const { raw, widthBytes } = bitmapBytes(bitmap)
    // TSPL ใช้ 0 = ดำ กลับกับที่เราเก็บไว้
    const inverted = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) inverted[i] = ~raw[i] & 0xff

    parts.push(ascii('CLS'))
    parts.push(encoder.encode(`BITMAP 0,0,${widthBytes},${bitmap.height},0,`))
    parts.push(inverted)
    parts.push(encoder.encode('\r\n'))
    parts.push(ascii('PRINT 1,1'))
  }
  return concatBytes(parts)
}

export function buildTsplSelfTest({ widthMm = 40, heightMm = 20, gapMm = 2 } = {}) {
  return concatBytes([
    ascii(`SIZE ${widthMm.toFixed(1)} mm,${heightMm.toFixed(1)} mm`),
    ascii(`GAP ${gapMm.toFixed(1)} mm,0 mm`),
    ascii('DIRECTION 0'),
    ascii('CLS'),
    ascii('TEXT 16,16,"2",0,1,1,"FarmStock OK"'),
    ascii('TEXT 16,48,"1",0,1,1,"Bluetooth test"'),
    ascii('PRINT 1,1'),
  ])
}

/* ---------- ESC/POS ---------- */

/**
 * ESC/POS พิมพ์รูปด้วย GS v 0 (raster bit image) ซึ่งใช้ 1 = ดำ ตรงกับของเราเลย
 * ส่งทีละแถบสูงไม่เกิน 255 แถว — เครื่องพกพาหลายรุ่นบัฟเฟอร์เล็ก รับก้อนใหญ่ทีเดียวแล้วค้าง
 */
const ESC_BAND_ROWS = 255

export function buildEscPosJob({ bitmaps, feedLines = 3 }) {
  if (!bitmaps?.length) throw new Error('ไม่มีฉลากให้พิมพ์')

  const parts = [Uint8Array.of(0x1b, 0x40)] // ESC @ = reset
  for (const bitmap of bitmaps) {
    const { raw, widthBytes } = bitmapBytes(bitmap)
    for (let y = 0; y < bitmap.height; y += ESC_BAND_ROWS) {
      const rows = Math.min(ESC_BAND_ROWS, bitmap.height - y)
      parts.push(Uint8Array.of(
        0x1d, 0x76, 0x30, 0x00,
        widthBytes & 0xff, (widthBytes >> 8) & 0xff,
        rows & 0xff, (rows >> 8) & 0xff,
      ))
      parts.push(raw.subarray(y * widthBytes, (y + rows) * widthBytes))
    }
    parts.push(Uint8Array.of(0x1b, 0x64, clampInt(feedLines, 0, 20, 3))) // ESC d n = เลื่อนกระดาษ n บรรทัด
  }
  return concatBytes(parts)
}

export function buildEscPosSelfTest() {
  return concatBytes([
    Uint8Array.of(0x1b, 0x40),
    encoder.encode('FarmStock OK\nBluetooth test\n'),
    Uint8Array.of(0x1b, 0x64, 3),
  ])
}

export function buildJob(protocol, options) {
  return protocol === 'escpos' ? buildEscPosJob(options) : buildTsplJob(options)
}

export function buildSelfTest(protocol, options) {
  return protocol === 'escpos' ? buildEscPosSelfTest() : buildTsplSelfTest(options)
}
