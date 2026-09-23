/**
 * เทสต์ตัวแปลงคำสั่งเครื่องพิมพ์ฝั่งเบราว์เซอร์ (ใช้ตอนพิมพ์ Bluetooth)
 *
 * TSPL ต้องได้ byte ตรงกับ print agent เป๊ะ — เครื่องพิมพ์ตัวเดียวกันควรได้ฉลากเหมือนกัน
 * ไม่ว่าจะสั่งจากคอมหรือจากมือถือ
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { packRgbaToBitmap } from '../src/lib/labelRender.js'
import { buildTsplJob, buildEscPosJob, buildJob } from '../src/lib/printerCommands.js'
import tspl from '../../print-agent/src/tspl.js'

function makeBitmap(width, height, isBlack) {
  const d = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const v = isBlack(x, y) ? 0 : 255
      d[i] = d[i + 1] = d[i + 2] = v
      d[i + 3] = 255
    }
  }
  return { x: 0, y: 0, ...packRgbaToBitmap(d, width, height) }
}

const checker = (x, y) => (x + y) % 3 === 0

test('TSPL ฝั่งเบราว์เซอร์ได้ byte เท่ากับ print agent', () => {
  const bitmap = makeBitmap(20, 7, checker)
  const opts = { widthMm: 40, heightMm: 20, gapMm: 2, density: 8, speed: 4 }

  const browser = buildTsplJob({ ...opts, bitmaps: [bitmap, bitmap] })
  const agent = tspl.buildJob({ ...opts, labels: [{ id: 1, bitmap }, { id: 2, bitmap }] }).buffer

  assert.deepEqual(Buffer.from(browser), agent)
})

test('ESC/POS ใช้ GS v 0 และไม่กลับบิต (1 = ดำ)', () => {
  const bitmap = makeBitmap(16, 2, (x) => x < 8) // ครึ่งซ้ายดำ
  const bytes = buildEscPosJob({ bitmaps: [bitmap], feedLines: 2 })

  assert.deepEqual([...bytes.subarray(0, 2)], [0x1b, 0x40])
  // GS v 0 m xL xH yL yH = 2 byte/แถว × 2 แถว
  assert.deepEqual([...bytes.subarray(2, 10)], [0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0])
  assert.deepEqual([...bytes.subarray(10, 14)], [0xff, 0x00, 0xff, 0x00])
  assert.deepEqual([...bytes.subarray(14)], [0x1b, 0x64, 2])
})

test('ESC/POS แบ่งรูปสูงเป็นแถบละไม่เกิน 255 แถว', () => {
  const bitmap = makeBitmap(8, 300, () => true)
  const bytes = buildEscPosJob({ bitmaps: [bitmap] })

  // แถบแรก 255 แถว แถบสอง 45 แถว
  assert.deepEqual([...bytes.subarray(2, 10)], [0x1d, 0x76, 0x30, 0x00, 1, 0, 255, 0])
  const second = 10 + 255
  assert.deepEqual([...bytes.subarray(second, second + 8)], [0x1d, 0x76, 0x30, 0x00, 1, 0, 45, 0])
  assert.equal(bytes.length, 2 + 8 + 255 + 8 + 45 + 3)
})

test('บิตแมปขนาดไม่ตรงต้องโยน error ไม่ใช่พิมพ์ขยะ', () => {
  const bitmap = { ...makeBitmap(16, 2, checker), height: 3 }
  assert.throws(() => buildJob('tspl', { widthMm: 40, heightMm: 20, bitmaps: [bitmap] }), /ขนาด bitmap ไม่ตรง/)
  assert.throws(() => buildJob('escpos', { bitmaps: [bitmap] }), /ขนาด bitmap ไม่ตรง/)
})
