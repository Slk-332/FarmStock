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

  // ขนาดฟอนต์อิงความสูงฉลาก เปลี่ยนขนาด label แล้วสัดส่วนยังเท่าเดิม
  const nameSize = Math.round(heightDots * 0.125)
  const uidSize  = Math.round(heightDots * 0.100)
  const lotSize  = Math.round(heightDots * 0.095)
  const dateSize = Math.round(heightDots * 0.085)

  const lines = [
    { text: item.product_name,                      size: nameSize, weight: '700' },
    { text: item.mat_uid,                           size: uidSize,  weight: '400' },
    { text: `Lot: ${item.lot_no}`,                  size: lotSize,  weight: '400' },
    { text: `ผลิต ${fmtDate(item.mfg_date)}`,        size: dateSize, weight: '400' },
    { text: `หมด  ${fmtDate(item.exp_date)}`,        size: dateSize, weight: '400' },
  ]

  const totalTextHeight = lines.reduce((sum, l) => sum + Math.round(l.size * 1.25), 0)
  let cursorY = Math.max(pad, Math.round((heightDots - totalTextHeight) / 2))

  ctx.fillStyle = '#000'
  ctx.textBaseline = 'top'
  for (const line of lines) {
    ctx.font = `${line.weight} ${line.size}px ${THAI_FONT_STACK}`
    ctx.fillText(fitText(ctx, line.text, textW), pad, cursorY)
    cursorY += Math.round(line.size * 1.25)
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
