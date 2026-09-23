/**
 * เทสต์ท่อส่งข้อมูลฉลาก: canvas pixel → บิตแมป 1 บิต → คำสั่ง TSPL ของ print agent
 *
 * ส่วนที่พังแล้วเจอยากที่สุดคือ "การเรียงบิต" — ถ้าสลับ MSB/LSB หรือลืมกลับบิต
 * ฉลากจะออกมาเป็นภาพกลับสี/เลื่อน ซึ่งกว่าจะรู้ก็เปลืองสติกเกอร์ไปแล้ว จึงล็อกไว้ด้วยเทสต์
 *
 * รัน: npm test  (ในโฟลเดอร์ frontend)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import QRCode from 'qrcode'

import { packRgbaToBitmap, mmToDots, DOTS_PER_MM_203 } from '../src/lib/labelRender.js'
import tspl from '../../print-agent/src/tspl.js'

const { buildJob } = tspl

/** สร้าง RGBA buffer แบบเดียวกับที่ ctx.getImageData() คืนมา */
function makeRgba(width, height, isBlack) {
  const d = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const v = isBlack(x, y) ? 0 : 255
      d[i] = d[i + 1] = d[i + 2] = v
      d[i + 3] = 255
    }
  }
  return d
}

test('mmToDots แปลงเป็น dot ของหัวพิมพ์ 203 DPI ได้ถูกต้อง', () => {
  assert.equal(DOTS_PER_MM_203, 8)
  assert.equal(mmToDots(40), 320)
  assert.equal(mmToDots(20), 160)
  assert.equal(mmToDots(100), 800)
})

test('แพ็คบิตแบบ MSB ก่อน และ bit 1 = จุดสีดำ', () => {
  const data = makeRgba(16, 2, (x, y) => (y === 0 ? x % 2 === 0 : x < 8))
  const { widthBytes, dataBase64, width, height } = packRgbaToBitmap(data, 16, 2)

  assert.equal(widthBytes, 2)
  assert.equal(width, 16)
  assert.equal(height, 2)

  const bytes = Buffer.from(dataBase64, 'base64')
  assert.equal(bytes.length, 4)
  assert.equal(bytes[0], 0b10101010)
  assert.equal(bytes[1], 0b10101010)
  assert.equal(bytes[2], 0b11111111)
  assert.equal(bytes[3], 0b00000000)
})

test('ความกว้างที่ไม่ลงตัว 8 ถูกปัดขึ้นเป็นไบต์เต็ม', () => {
  const data = makeRgba(10, 1, (x) => x < 3)
  const { widthBytes, dataBase64 } = packRgbaToBitmap(data, 10, 1)
  const bytes = Buffer.from(dataBase64, 'base64')

  assert.equal(widthBytes, 2)
  assert.equal(bytes.length, 2)
  assert.equal(bytes[0], 0b11100000)
  assert.equal(bytes[1], 0b00000000)
})

test('พิกเซลโปร่งใสนับเป็นสีขาว ไม่ใช่สีดำ', () => {
  const transparent = new Uint8ClampedArray(8 * 4) // alpha = 0 ทั้งแถว
  const { dataBase64 } = packRgbaToBitmap(transparent, 8, 1)
  assert.equal(Buffer.from(dataBase64, 'base64')[0], 0)
})

test('threshold ตัดสีเทาตามค่าที่กำหนด', () => {
  const grey = new Uint8ClampedArray([200, 200, 200, 255, 100, 100, 100, 255])

  const strict = packRgbaToBitmap(grey, 2, 1, 160)
  assert.equal(Buffer.from(strict.dataBase64, 'base64')[0], 0b01000000)

  const loose = packRgbaToBitmap(grey, 2, 1, 220)
  assert.equal(Buffer.from(loose.dataBase64, 'base64')[0], 0b11000000)
})

test('QRCode.create ให้ API ที่ renderer ใช้ และ module ใหญ่พอสแกนได้บนฉลาก 40×20', () => {
  const url = 'https://farmstock.vercel.app/scan/MATUID-LOT000001-001'
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' })

  assert.equal(typeof qr.modules.get, 'function')
  assert.equal(qr.modules.get(0, 0), 1) // มุม finder pattern ต้องดำ
  assert.equal(qr.modules.get(0, 7), 0) // separator ต้องขาว

  // คำนวณแบบเดียวกับ renderLabelCanvas สำหรับฉลาก 40×20mm
  const widthDots = 320
  const heightDots = 160
  const pad = Math.max(4, Math.round(heightDots * 0.04))
  const qrBox = Math.min(heightDots - pad * 2, Math.floor(widthDots * 0.45))
  const scale = Math.max(1, Math.floor(qrBox / qr.modules.size))

  assert.ok(scale >= 3, `module ได้แค่ ${scale} dot — เล็กเกินไปสำหรับสแกนเนอร์`)
})

test('บิตแมปจาก renderer ต่อเข้า buildJob ของ agent ได้ ขนาดตรงกัน', () => {
  const W = 320
  const H = 160
  const data = makeRgba(W, H, (x, y) => (x + y) % 3 === 0)
  const bmp = packRgbaToBitmap(data, W, H)

  const { buffer, printedIds } = buildJob({
    widthMm: 40, heightMm: 20, gapMm: 2, density: 8, speed: 4,
    labels: [{ id: 42, bitmap: { x: 0, y: 0, ...bmp } }],
  })

  assert.deepEqual(printedIds, [42])
  const text = buffer.toString('latin1')
  assert.ok(text.startsWith('SIZE 40.0 mm,20.0 mm\r\n'))
  assert.ok(text.includes(`BITMAP 0,0,${W / 8},${H},0,`))
  assert.ok(text.includes('PRINT 1,1\r\n'))
})

test('agent กลับบิตให้ตรง convention ของ TSPL (0 = ดำ)', () => {
  const data = makeRgba(8, 1, (x) => x < 4)
  const bmp = packRgbaToBitmap(data, 8, 1)
  assert.equal(Buffer.from(bmp.dataBase64, 'base64')[0], 0b11110000)

  const { buffer } = buildJob({
    widthMm: 40, heightMm: 20,
    labels: [{ id: 1, bitmap: { x: 0, y: 0, ...bmp } }],
  })

  const marker = Buffer.from('BITMAP 0,0,1,1,0,', 'ascii')
  const at = buffer.indexOf(marker)
  assert.ok(at >= 0, 'ไม่พบคำสั่ง BITMAP')
  assert.equal(buffer[at + marker.length], 0b00001111)
})

test('หลายฉลากรวมเป็น job เดียว แต่ละดวงมี CLS + PRINT ของตัวเอง', () => {
  const bmp = packRgbaToBitmap(makeRgba(8, 1, () => true), 8, 1)
  const labels = [1, 2, 3].map((id) => ({ id, bitmap: { x: 0, y: 0, ...bmp } }))

  const { buffer, printedIds } = buildJob({ widthMm: 40, heightMm: 20, labels })
  const text = buffer.toString('latin1')

  assert.deepEqual(printedIds, [1, 2, 3])
  assert.equal(text.split('PRINT 1,1\r\n').length - 1, 3)
  assert.equal(text.split('CLS\r\n').length - 1, 3)
  // ค่าตั้งต้นระดับ job ต้องส่งครั้งเดียวพอ
  assert.equal(text.split('SIZE ').length - 1, 1)
})

test('ขนาด bitmap ไม่ตรงกับ width/height ต้อง throw ไม่ปล่อยผ่านไปเปลืองสติกเกอร์', () => {
  assert.throws(
    () => buildJob({
      widthMm: 40, heightMm: 20,
      labels: [{ id: 1, bitmap: { x: 0, y: 0, width: 16, height: 5, dataBase64: 'AAAA' } }],
    }),
    /ขนาด bitmap ไม่ตรง/
  )
})

test('job ที่ไม่มีฉลากเลยต้อง throw', () => {
  assert.throws(() => buildJob({ widthMm: 40, heightMm: 20, labels: [] }), /ไม่มี label/)
})

test('density กับ speed ถูก clamp ให้อยู่ในช่วงที่เครื่องพิมพ์รับได้', () => {
  const bmp = packRgbaToBitmap(makeRgba(8, 1, () => true), 8, 1)
  const { buffer } = buildJob({
    widthMm: 40, heightMm: 20, density: 99, speed: -3,
    labels: [{ id: 1, bitmap: { x: 0, y: 0, ...bmp } }],
  })
  const text = buffer.toString('latin1')
  assert.ok(text.includes('DENSITY 15\r\n'))
  assert.ok(text.includes('SPEED 1\r\n'))
})
