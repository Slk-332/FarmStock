import QRCode from 'qrcode'

/**
 * วาดฉลากลง canvas ที่ขนาด "dot จริง" ของหัวพิมพ์ แล้วแปลงเป็นบิตแมป 1 บิต
 *
 * ทำไมต้องวาดเองแทนที่จะให้ driver/QZ เรนเดอร์ HTML ให้:
 *   - คุม resolution ได้เป๊ะ 1 pixel = 1 dot ของหัวพิมพ์ ตัวอักษรเลยไม่เบลอ
 *   - QR วาดเป็นสี่เหลี่ยมทีละ module ด้วย scale จำนวนเต็ม ทุก module จึงขนาดเท่ากันเป๊ะ
 *   - สิ่งที่เห็นใน preview คือ byte ชุดเดียวกับที่ส่งเข้าเครื่องพิมพ์จริง
 */

// XP-420B = 203 DPI = 8 dots/mm (รุ่น 300 DPI ใช้ 11.81)
export const DOTS_PER_MM_203 = 8
export const DOTS_PER_MM_300 = 300 / 25.4

export const mmToDots = (mm, dotsPerMm = DOTS_PER_MM_203) => Math.round(mm * dotsPerMm)

const THAI_FONT_STACK = '"Leelawadee UI", "Leelawadee", "Tahoma", "Noto Sans Thai", sans-serif'

const fmtDate = (value) => {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/** ตัดข้อความให้พอดีความกว้าง โดยเติม … ท้าย */
function fitText(ctx, text, maxWidth) {
  const str = String(text ?? '')
  if (ctx.measureText(str).width <= maxWidth) return str
  let lo = 0
  let hi = str.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(str.slice(0, mid) + '…').width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return str.slice(0, lo) + '…'
}

/**
 * วาด QR ทีละ module เป็นสี่เหลี่ยมทึบ
 * ใช้ scale เป็นจำนวนเต็มเสมอ — ถ้าใช้ drawImage ย่อ/ขยายแบบเศษส่วน module จะกว้างไม่เท่ากัน
 * แล้วเครื่องสแกนจะอ่านยากขึ้น
 */
function drawQr(ctx, text, { x, y, maxSize, errorCorrectionLevel = 'M' }) {
  const qr = QRCode.create(String(text), { errorCorrectionLevel })
  const size = qr.modules.size
  const scale = Math.max(1, Math.floor(maxSize / size))
  const drawn = size * scale
  // จัดกึ่งกลางในพื้นที่ที่จองไว้ เผื่อ scale ปัดลงแล้วเหลือที่ว่าง
  const ox = x + Math.floor((maxSize - drawn) / 2)
  const oy = y + Math.floor((maxSize - drawn) / 2)

  ctx.fillStyle = '#000'
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (qr.modules.get(r, c)) ctx.fillRect(ox + c * scale, oy + r * scale, scale, scale)
    }
  }
  return { modules: size, scale, drawnDots: drawn }
}

/**
 * ตัดข้อความเป็น 2 บรรทัด โดยตัดที่ขอบคำภาษาไทย (Intl.Segmenter) ไม่ตัดกลางสระ/วรรณยุกต์
 * คืน { lines, size } ที่ขนาดใหญ่สุดที่ทั้งสองบรรทัดพอดีความกว้าง หรือ null ถ้าตัดไม่ได้
 */
function wrapText(ctx, text, maxWidth, applyFont, startSize, minSize) {
  const segments = typeof Intl !== 'undefined' && Intl.Segmenter
    ? [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map((s) => s.segment)
    : Array.from(text)
  if (segments.length < 2) return null

  for (let size = startSize; size >= minSize; size--) {
    applyFont(size)
    // หาจุดตัดที่บรรทัดแรกยาวที่สุดแต่ยังพอดี
    let first = ''
    let i = 0
    while (i < segments.length && ctx.measureText(first + segments[i]).width <= maxWidth) first += segments[i++]
    if (!first.trim()) continue
    const second = segments.slice(i).join('').trim()
    if (!second || ctx.measureText(second).width <= maxWidth) return { lines: second ? [first.trim(), second] : [first.trim()], size }
  }
  // ยาวมากจนย่อสุดแล้วยังไม่พอ — บรรทัดสองจะถูกตัดเป็น … ตอนวาด
  applyFont(minSize)
  let first = ''
  let i = 0
  while (i < segments.length && ctx.measureText(first + segments[i]).width <= maxWidth) first += segments[i++]
  if (!first.trim()) return null
  return { lines: [first.trim(), segments.slice(i).join('').trim()], size: minSize }
}

/**
 * วาดฉลากหนึ่งดวงลง canvas
 * @returns {{ canvas: HTMLCanvasElement, qr: object, widthDots: number, heightDots: number }}
 */
export function renderLabelCanvas(item, {
  widthMm,
  heightMm,
  scanUrl,
  dotsPerMm = DOTS_PER_MM_203,
  canvas = null,
} = {}) {
  const widthDots  = mmToDots(widthMm, dotsPerMm)
  const heightDots = mmToDots(heightMm, dotsPerMm)

  const target = canvas || document.createElement('canvas')
  target.width  = widthDots
  target.height = heightDots

  const ctx = target.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, widthDots, heightDots)

  const pad     = Math.max(4, Math.round(heightDots * 0.04))
  const qrBox   = Math.min(heightDots - pad * 2, Math.floor(widthDots * 0.45))
  const qrX     = widthDots - pad - qrBox
  const textW   = qrX - pad * 2

  const qr = drawQr(ctx, scanUrl, { x: qrX, y: pad, maxSize: qrBox })

  // ตัวหนังสือข้าง QR: ใหญ่ที่สุดเท่าที่พื้นที่ข้าง QR รับได้ (ผู้ใช้ขอให้อ่านง่ายขึ้น)
  // ขั้นที่ 1 หาขนาดจาก "ความสูง" — แบ่งความสูงให้ทุกบรรทัดตามสัดส่วน RATIO
  // ขั้นที่ 2 บรรทัดไหนกว้างเกินพื้นที่ ค่อยย่อเฉพาะบรรทัดนั้น (ไม่ตัดเป็น … ถ้ายังย่อได้)
  const name = String(item.product_name ?? '')
  const rest = [
    { text: item.mat_uid,                 ratio: 1.0,  weight: '600' },
    { text: item.lot_no,                  ratio: 1.0,  weight: '600' },
    { text: `ผลิต ${fmtDate(item.mfg_date)}`, ratio: 0.92, weight: '400' },
    { text: `หมด ${fmtDate(item.exp_date)}`,  ratio: 0.92, weight: '400' },
  ]
  const NAME_RATIO  = 1.2
  const LINE_HEIGHT = 1.12
  const availH = heightDots - pad * 2
  const unitFor = (nameLines) =>
    availH / ((NAME_RATIO * nameLines + rest.reduce((s, l) => s + l.ratio, 0)) * LINE_HEIGHT)

  ctx.textBaseline = 'top'
  const setFont = (weight, size) => { ctx.font = `${weight} ${size}px ${THAI_FONT_STACK}` }
  const minSize = Math.max(10, Math.round(heightDots * 0.07))

  /** ขนาดใหญ่สุดที่ไม่เกิน target และความกว้างไม่เกิน textW */
  const fitSize = (text, weight, target) => {
    let size = Math.max(minSize, Math.floor(target))
    setFont(weight, size)
    while (size > minSize && ctx.measureText(text).width > textW) setFont(weight, --size)
    return size
  }

  // ชื่อสินค้ายาว ๆ ตัดขึ้นบรรทัดสองดีกว่าย่อจนอ่านไม่ออก
  let unit = unitFor(1)
  let nameLines = [name]
  let nameSize = fitSize(name, '700', unit * NAME_RATIO)
  setFont('700', nameSize)
  if (ctx.measureText(name).width > textW || nameSize < unit * NAME_RATIO * 0.8) {
    const unit2 = unitFor(2)
    const split = wrapText(ctx, name, textW, (sz) => setFont('700', sz), Math.floor(unit2 * NAME_RATIO), minSize)
    if (split) { unit = unit2; nameLines = split.lines; nameSize = split.size }
  }

  const lines = [
    ...nameLines.map((text) => ({ text, size: nameSize, weight: '700' })),
    ...rest.map((l) => ({ text: l.text, weight: l.weight, size: fitSize(l.text, l.weight, unit * l.ratio) })),
  ]

  const totalTextHeight = lines.reduce((sum, l) => sum + Math.round(l.size * LINE_HEIGHT), 0)
  let cursorY = Math.max(pad, Math.round((heightDots - totalTextHeight) / 2))

  ctx.fillStyle = '#000'
  for (const line of lines) {
    setFont(line.weight, line.size)
    ctx.fillText(fitText(ctx, line.text, textW), pad, cursorY)
    cursorY += Math.round(line.size * LINE_HEIGHT)
  }

  return { canvas: target, qr, widthDots, heightDots }
}

/**
 * canvas → บิตแมป 1 บิต แพ็คตามแถว MSB ก่อน
 * **bit 1 = จุดสีดำ** (ฝั่ง print agent จะกลับบิตให้เป็น convention ของ TSPL เอง)
 *
 * threshold 0-255: พิกเซลที่สว่างน้อยกว่านี้ถือว่าดำ
 */
export function canvasToPackedBitmap(canvas, threshold = 160) {
  const { width, height } = canvas
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data } = ctx.getImageData(0, 0, width, height)
  return packRgbaToBitmap(data, width, height, threshold)
}

/** ส่วนคำนวณล้วน ๆ แยกออกมาเพื่อให้เทสต์ได้โดยไม่ต้องมี canvas จริง */
export function packRgbaToBitmap(data, width, height, threshold = 160) {
  const widthBytes = Math.ceil(width / 8)
  const out = new Uint8Array(widthBytes * height)

  for (let y = 0; y < height; y++) {
    const rowOffset = y * widthBytes
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const alpha = data[i + 3]
      // พิกเซลโปร่งใสถือว่าขาว
      const luma = alpha === 0
        ? 255
        : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]

      if (luma < threshold) out[rowOffset + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }

  let binary = ''
  for (let i = 0; i < out.length; i++) binary += String.fromCharCode(out[i])

  return { width, height, widthBytes, dataBase64: btoa(binary) }
}

/** รวมสองขั้นตอนไว้ให้เรียกทีเดียว: item → payload ที่ส่งให้ agent ได้เลย */
export function buildLabelPayload(item, options) {
  const { canvas, qr, widthDots, heightDots } = renderLabelCanvas(item, options)
  const bitmap = canvasToPackedBitmap(canvas, options?.threshold)
  return {
    label:  { id: item.id, bitmap: { x: 0, y: 0, ...bitmap } },
    canvas,
    qr,
    widthDots,
    heightDots,
  }
}
