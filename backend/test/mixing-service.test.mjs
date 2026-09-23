/**
 * เทสต์การขยายสูตรและการหักวัตถุดิบ (Phase 3)
 *
 * นี่คือจุดที่ผิดแล้วเสียหายเงียบที่สุดในทั้งระบบ — ถ้าต้นทุนคำนวณผิด
 * จะไม่มีอะไรพัง ไม่มี error ขึ้น แต่ราคาขายที่ตั้งจากต้นทุนนี้จะผิดไปด้วยทั้งหมด
 *
 * เคสที่ล็อกไว้:
 *   - ขยายสูตรตามสัดส่วน (สั่ง 50 กก. จากสูตรที่ให้ 10 กก./ชุด = 5 เท่า)
 *   - แปลงหน่วยสูตร (กรัม) มาเป็นหน่วยบรรจุของสินค้า (กิโลกรัม)
 *   - ต้นทุนตามสัดส่วนที่ใช้จริง (ใช้ 20 มล. จากขวด 1000 มล. ราคา 200 = 4 บาท ไม่ใช่ 200)
 *   - ของหมดขวดแล้วต้องปิดชิ้นและลดจำนวนคงเหลือของ lot
 *
 * รัน: npm test  (ในโฟลเดอร์ backend)
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import mixingService from '../src/services/mixingService.js'

const { calculateRequirement, consumeMaterials } = mixingService

const UNIT_ROWS = [
  { code: 'kg',   name: 'กิโลกรัม',  kind: 'weight', base_code: null, qty_per_base: 1 },
  { code: 'g',    name: 'กรัม',      kind: 'weight', base_code: 'kg', qty_per_base: 1000 },
  { code: 'l',    name: 'ลิตร',      kind: 'volume', base_code: null, qty_per_base: 1 },
  { code: 'ml',   name: 'มิลลิลิตร', kind: 'volume', base_code: 'l',  qty_per_base: 1000 },
  { code: 'sack', name: 'กระสอบ',    kind: 'count',  base_code: null, qty_per_base: 1 },
  { code: 'bottle', name: 'ขวด',     kind: 'count',  base_code: null, qty_per_base: 1 },
  { code: 'bundle', name: 'มัด',     kind: 'count',  base_code: null, qty_per_base: 1 },
]

/**
 * client ปลอมที่ตอบตาม SQL — `handlers` เป็นคู่ [ชิ้นส่วน SQL, ผลลัพธ์หรือฟังก์ชัน]
 * ตัวที่ตรงตัวแรกชนะ จึงวางเคสเฉพาะเจาะจงไว้ก่อนเคสกว้าง
 */
function fakeClient(handlers) {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return { rows: typeof rows === 'function' ? rows(params) : rows }
      }
      return { rows: [] }
    },
  }
}

const unitsHandler = ['FROM unit', UNIT_ROWS]

/** resolveStockLines อ่านข้อมูลสินค้าแยกจากบรรทัดสูตร จึงต้องมี handler ของตัวเอง */
const productHandler = (product) => ['FROM product WHERE id', [product]]

test('ขยายสูตรตามสัดส่วนที่สั่งผลิต', async () => {
  // สูตรให้ผล 10 กก./ชุด ใช้กากน้ำตาล 500 กรัม — สั่ง 50 กก. = 5 เท่า = 2500 กรัม = 2.5 กก.
  const client = fakeClient([
    unitsHandler,
    ['FROM formula_line', [{ id: 1, seq: 1, product_id: 27, qty: 500, unit_code: 'g' }]],
    productHandler({
      id: 27, mat_uid: 'MAT0027', name: 'กากน้ำตาล',
      stock_unit: 'sack', pack_size: 50, pack_unit: 'kg',
    }),
    ['SUM(i.content_remaining)', [{ available: 100 }]],
  ])

  const result = await calculateRequirement(client, {
    formula: { id: 7, output_qty: 10, output_unit: 'kg' },
    targetQty: 50, targetUnit: 'kg',
  })

  assert.equal(result.scale, 5)
  assert.equal(result.lines[0].required_qty, 2.5)      // 2500 กรัม → 2.5 กิโลกรัม
  assert.equal(result.lines[0].required_unit, 'kg')    // เทียบในหน่วยบรรจุของสินค้า
  assert.equal(result.lines[0].shortage, 0)
})

test('แปลงหน่วยปริมาณที่สั่งผลิตให้เป็นหน่วยของสูตรก่อนคำนวณ', async () => {
  // สั่ง 2000 กรัม จากสูตรที่ให้ผล 1 กิโลกรัม/ชุด = 2 เท่า
  const client = fakeClient([
    unitsHandler,
    ['FROM formula_line', [{ id: 1, seq: 1, product_id: 5, qty: 300, unit_code: 'g' }]],
    productHandler({
      id: 5, mat_uid: 'MAT0005', name: 'แกลบดำ',
      stock_unit: 'sack', pack_size: 10, pack_unit: 'kg',
    }),
    ['SUM(i.content_remaining)', [{ available: 50 }]],
  ])

  const result = await calculateRequirement(client, {
    formula: { id: 3, output_qty: 1, output_unit: 'kg' },
    targetQty: 2000, targetUnit: 'g',
  })

  assert.equal(result.scale, 2)
  assert.equal(result.lines[0].required_qty, 0.6)  // 600 กรัม
})

test('บอกว่าขาดเท่าไรเมื่อของไม่พอ', async () => {
  const client = fakeClient([
    unitsHandler,
    ['FROM formula_line', [{ id: 1, seq: 1, product_id: 24, qty: 20, unit_code: 'ml' }]],
    productHandler({
      id: 24, mat_uid: 'MAT0024', name: 'หัวเชื้อจุลินทรีย์ (EM)',
      stock_unit: 'bottle', pack_size: 1, pack_unit: 'l',
    }),
    ['SUM(i.content_remaining)', [{ available: 0.005 }]],  // เหลือ 5 มล.
  ])

  const result = await calculateRequirement(client, {
    formula: { id: 1, output_qty: 1, output_unit: 'l' },
    targetQty: 1, targetUnit: 'l',
  })

  assert.equal(result.lines[0].required_qty, 0.02)   // 20 มล. = 0.02 ลิตร
  assert.equal(result.lines[0].shortage, 0.015)      // ขาด 15 มล.
})

test('ของที่ไม่มีขนาดบรรจุนับเป็นหน่วยนับ ไม่ใช่ปริมาณ', async () => {
  // ฟางข้าวนับเป็นมัด แบ่งครึ่งมัดไม่ได้ — ต้องนับจำนวนชิ้นแทนการรวมปริมาณ
  const client = fakeClient([
    unitsHandler,
    ['FROM formula_line', [{ id: 1, seq: 1, product_id: 11, qty: 2, unit_code: 'bundle' }]],
    productHandler({
      id: 11, mat_uid: 'MAT0011', name: 'ฟางข้าว',
      stock_unit: 'bundle', pack_size: null, pack_unit: null,
    }),
    ['COUNT(*)', [{ available: 3 }]],
  ])

  const result = await calculateRequirement(client, {
    formula: { id: 4, output_qty: 1, output_unit: 'kg' },
    targetQty: 1, targetUnit: 'kg',
  })

  assert.equal(result.lines[0].divisible, false)
  assert.equal(result.lines[0].required_qty, 2)
  assert.equal(result.lines[0].shortage, 0)
})

test('สูตรที่ยังไม่มีวัตถุดิบใช้ผลิตไม่ได้', async () => {
  const client = fakeClient([unitsHandler, ['FROM formula_line', []]])
  await assert.rejects(
    () => calculateRequirement(client, {
      formula: { id: 9, output_qty: 1, output_unit: 'kg' },
      targetQty: 1, targetUnit: 'kg',
    }),
    /ยังไม่มีรายการวัตถุดิบ/
  )
})

test('แปลงหน่วยข้ามตระกูลไม่ได้ ต้องฟ้องชื่อหน่วยให้คนอ่านรู้เรื่อง', async () => {
  const client = fakeClient([unitsHandler])
  await assert.rejects(
    () => calculateRequirement(client, {
      formula: { id: 1, output_qty: 1, output_unit: 'kg' },
      targetQty: 1, targetUnit: 'l',   // ลิตร → กิโลกรัม
    }),
    /แปลงหน่วย "ลิตร" เป็น "กิโลกรัม" ไม่ได้/
  )
})

/* ---------- การหักของจริง ---------- */

/** 1 บรรทัดสูตร ที่ต้องใช้ EM 0.02 ลิตร (= 20 มล.) */
const emRequirement = (available = 1) => ({
  scale: 1,
  lines: [{
    product_id: 24, product_name: 'หัวเชื้อจุลินทรีย์ (EM)',
    required_qty: 0.02, required_unit: 'l', required_unit_name: 'ลิตร',
    available_qty: available, shortage: 0, divisible: true,
  }],
})

test('คิดต้นทุนตามสัดส่วนที่ใช้จริง ไม่ใช่ทั้งขวด', async () => {
  // ขวดละ 1 ลิตร ราคา 200 บาท ใช้ไป 0.02 ลิตร → ต้นทุน 4 บาท
  const client = fakeClient([
    ['FROM item', [{
      id: 501, item_id: 'MAT0024-LOT000005-001',
      content_size: 1, content_remaining: 1, content_unit: 'l',
      cost: 200, lot_id: 90,
    }]],
    ['INSERT INTO mixing_consumption', (p) => [{ id: 1, item_id: p[2], qty: p[3], cost: p[5] }]],
  ])

  const { totalCost, consumptions } = await consumeMaterials(client, {
    mixingOrderId: 1, requirement: emRequirement(),
  })

  assert.equal(totalCost, 4)
  assert.equal(consumptions.length, 1)

  // ขวดยังไม่หมด เหลือ 0.98 ลิตร และต้องไม่ถูกปิด
  const update = client.calls.find(c => c.sql.includes('SET content_remaining ='))
  assert.deepEqual(update.params, [0.98, 501])
  assert.ok(!client.calls.some(c => c.sql.includes("status = 'dispensed'")))
  assert.ok(!client.calls.some(c => c.sql.includes('qty_remaining = qty_remaining - 1')))
})

test('หยิบของตาม FIFO และเอาชิ้นที่เปิดค้างไว้ก่อน', async () => {
  // ลำดับการหยิบถูกกำหนดด้วย ORDER BY ในฐานข้อมูล ไม่ใช่โค้ด JS จึงต้องตรวจที่ตัว SQL
  // ถ้าไม่หยิบชิ้นที่เปิดแล้วก่อน จะมีขวดเปิดค้างเต็มชั้นจนหมดอายุไปเปล่า ๆ
  const client = fakeClient([
    ['FROM item', [{
      id: 801, item_id: 'C-1', content_size: 1, content_remaining: 0.5, content_unit: 'l',
      cost: 100, lot_id: 93,
    }]],
    ['INSERT INTO mixing_consumption', [{ id: 5 }]],
  ])

  await consumeMaterials(client, { mixingOrderId: 1, requirement: emRequirement(0.5) })

  const pick = client.calls.find(c => c.sql.includes('FROM item'))
  assert.match(pick.sql, /ORDER BY l\.mfg_date ASC/)                              // lot เก่าก่อน
  assert.match(pick.sql, /\(i\.content_remaining < i\.content_size\) DESC/)    // ชิ้นที่เปิดแล้วก่อน
  assert.match(pick.sql, /FOR UPDATE OF i/)                                        // ล็อกกันแย่งของ
})

test('ชิ้นที่ใช้หมดถูกปิดและลดจำนวนคงเหลือของ lot', async () => {
  // ขวดเหลือ 0.02 ลิตรพอดี ใช้หมดเกลี้ยง
  const client = fakeClient([
    ['FROM item', [{
      id: 502, item_id: 'MAT0024-LOT000005-002',
      content_size: 1, content_remaining: 0.02, content_unit: 'l',
      cost: 200, lot_id: 90,
    }]],
    ['INSERT INTO mixing_consumption', [{ id: 2 }]],
  ])

  const { totalCost } = await consumeMaterials(client, {
    mixingOrderId: 1, requirement: emRequirement(0.02),
  })

  assert.equal(totalCost, 4)
  assert.ok(client.calls.some(c => c.sql.includes("status = 'dispensed'")))
  assert.ok(client.calls.some(c => c.sql.includes('qty_remaining = qty_remaining - 1')))
  assert.ok(client.calls.some(c => c.sql.includes("SET status = 'done'")))
})

test('หักต่อเนื่องหลายชิ้นเมื่อชิ้นเดียวไม่พอ', async () => {
  // ต้องใช้ 1.5 ลิตร จากขวดละ 1 ลิตร 2 ขวด → ขวดแรกหมด ขวดสองเหลือ 0.5
  const client = fakeClient([
    ['FROM item', [
      { id: 601, item_id: 'A-1', content_size: 1, content_remaining: 1, content_unit: 'l', cost: 100, lot_id: 91 },
      { id: 602, item_id: 'A-2', content_size: 1, content_remaining: 1, content_unit: 'l', cost: 100, lot_id: 91 },
    ]],
    ['INSERT INTO mixing_consumption', [{ id: 3 }]],
  ])

  const { totalCost, consumptions } = await consumeMaterials(client, {
    mixingOrderId: 1,
    requirement: { scale: 1, lines: [{
      product_id: 30, product_name: 'น้ำสะอาด',
      required_qty: 1.5, required_unit: 'l', required_unit_name: 'ลิตร',
      available_qty: 2, shortage: 0, divisible: true,
    }] },
  })

  assert.equal(consumptions.length, 2)
  assert.equal(totalCost, 150)   // 100 (เต็มขวด) + 50 (ครึ่งขวด)

  const updates = client.calls.filter(c => c.sql.includes('SET content_remaining ='))
  assert.deepEqual(updates.map(u => u.params), [[0, 601], [0.5, 602]])
})

test('ไม่ยอมหักถ้ารู้อยู่แล้วว่าของขาด', async () => {
  const client = fakeClient([])
  await assert.rejects(
    () => consumeMaterials(client, {
      mixingOrderId: 1,
      requirement: { scale: 1, lines: [{
        product_id: 24, product_name: 'EM',
        required_qty: 1, required_unit: 'l', required_unit_name: 'ลิตร',
        available_qty: 0.2, shortage: 0.8, divisible: true,
      }] },
    }),
    /ขาด 0.8/
  )
  assert.ok(!client.calls.some(c => c.sql.includes('INSERT INTO mixing_consumption')))
})

test('ฟ้องเมื่อหยิบของได้ไม่ครบเพราะมีคนตัดหน้าไป', async () => {
  // ผ่านการเช็ค shortage มาแล้ว แต่พอจะหยิบจริงกลับไม่มีของ
  const client = fakeClient([['FROM item', []]])
  await assert.rejects(
    () => consumeMaterials(client, { mixingOrderId: 1, requirement: emRequirement() }),
    /หยิบของได้ไม่ครบ/
  )
})

test('คำนวณต้นทุนเฉลี่ยใหม่ให้ทุกวัตถุดิบที่ถูกหัก', async () => {
  const client = fakeClient([
    ['FROM item', [{
      id: 701, item_id: 'B-1', content_size: 1, content_remaining: 1, content_unit: 'l',
      cost: 10, lot_id: 92,
    }]],
    ['INSERT INTO mixing_consumption', [{ id: 4 }]],
  ])
  await consumeMaterials(client, { mixingOrderId: 1, requirement: emRequirement() })
  assert.ok(client.calls.some(c => c.sql.includes('recalculate_ave_cost')))
})
