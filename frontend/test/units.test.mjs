/**
 * เทสต์การแปลงหน่วย (Phase 1)
 *
 * จุดที่พังแล้วเจอยากคือทิศทางของ qty_per_base — ถ้าคูณแทนที่จะหาร
 * สูตรผสมที่เขียนเป็น "กากน้ำตาล 1000 กรัม" จะกลายเป็น 1,000,000 กิโลกรัม
 * และต้นทุนที่คำนวณออกมาจะผิดแบบเงียบ ๆ จึงล็อกทิศทางไว้ด้วยเทสต์
 *
 * รัน: npm test  (ในโฟลเดอร์ frontend)
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  convertQty, toBaseQty, unitName, formatQty, formatPackSize, trimNumber,
} from '../src/lib/units.js'

/** ชุดหน่วยเดียวกับที่ migration seed ลงฐานข้อมูล */
const UNITS = [
  { code: 'kg',   name: 'กิโลกรัม',  kind: 'weight', base_code: null, qty_per_base: 1 },
  { code: 'g',    name: 'กรัม',      kind: 'weight', base_code: 'kg', qty_per_base: 1000 },
  { code: 'l',    name: 'ลิตร',      kind: 'volume', base_code: null, qty_per_base: 1 },
  { code: 'ml',   name: 'มิลลิลิตร', kind: 'volume', base_code: 'l',  qty_per_base: 1000 },
  { code: 'sack', name: 'กระสอบ',    kind: 'count',  base_code: null, qty_per_base: 1 },
  { code: 'bag',  name: 'ถุง',       kind: 'count',  base_code: null, qty_per_base: 1 },
]

test('แปลงหน่วยย่อยขึ้นหน่วยใหญ่ — 1500 กรัม = 1.5 กิโลกรัม', () => {
  assert.equal(convertQty(UNITS, 1500, 'g', 'kg'), 1.5)
})

test('แปลงหน่วยใหญ่ลงหน่วยย่อย — 2 ลิตร = 2000 มิลลิลิตร', () => {
  assert.equal(convertQty(UNITS, 2, 'l', 'ml'), 2000)
})

test('หน่วยเดียวกันคืนค่าเดิม ไม่ต้องรู้จักตารางหน่วยด้วยซ้ำ', () => {
  assert.equal(convertQty(UNITS, 7, 'kg', 'kg'), 7)
})

test('ข้ามตระกูลแปลงไม่ได้ — น้ำหนักกับปริมาตรไม่ใช่ของอย่างเดียวกัน', () => {
  assert.equal(convertQty(UNITS, 1, 'kg', 'l'), null)
})

test('หน่วยนับแปลงข้ามกันไม่ได้ — กระสอบกับถุงไม่เท่ากัน', () => {
  assert.equal(convertQty(UNITS, 1, 'sack', 'bag'), null)
})

test('หน่วยที่ไม่รู้จักคืน null ไม่ใช่ NaN — ผู้เรียกจะได้เช็คได้', () => {
  assert.equal(convertQty(UNITS, 1, 'g', 'ไม่มีจริง'), null)
  assert.equal(convertQty(UNITS, 1, 'ไม่มีจริง', 'g'), null)
  assert.equal(toBaseQty(UNITS, 1, 'ไม่มีจริง'), null)
})

test('toBaseQty ใช้หน่วยฐานของตระกูลตัวเอง', () => {
  assert.equal(toBaseQty(UNITS, 20, 'ml'), 0.02)
  assert.equal(toBaseQty(UNITS, 3, 'sack'), 3)
})

test('unitName คืน code ดิบเมื่อไม่รู้จัก ดีกว่าแสดงช่องว่าง', () => {
  assert.equal(unitName(UNITS, 'kg'), 'กิโลกรัม')
  assert.equal(unitName(UNITS, 'xyz'), 'xyz')
  assert.equal(unitName(UNITS, null), '')
})

test('trimNumber ตัดศูนย์ท้ายทศนิยมทิ้ง', () => {
  assert.equal(trimNumber(5.0), '5')
  assert.equal(trimNumber(1.5), '1.5')
  assert.equal(trimNumber('ไม่ใช่ตัวเลข'), '')
})

test('formatQty / formatPackSize ประกอบข้อความที่เอาไปแสดงได้เลย', () => {
  assert.equal(formatQty(UNITS, 5, 'sack'), '5 กระสอบ')
  assert.equal(
    formatPackSize(UNITS, { pack_size: 50, pack_unit: 'kg', stock_unit: 'sack' }),
    '50 กิโลกรัม/กระสอบ'
  )
  // ไม่ได้ระบุขนาดบรรจุ = ไม่แสดงอะไรเลย
  assert.equal(formatPackSize(UNITS, { stock_unit: 'sack' }), '')
})
