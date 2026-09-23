/**
 * เทสต์การหักของจากสต๊อกที่ใช้ร่วมกัน (Phase 3 + 4)
 *
 * ตรรกะชุดนี้ถูกเรียกจากสองทาง — การผสม และการดูแลแปลงปลูก
 * ถ้าพังจะพังทั้งคู่พร้อมกัน และพังแบบเงียบ ๆ (ต้นทุนผิด ไม่มี error)
 *
 * เคสของ resolveStockLines อยู่ที่นี่ ส่วนเคสการขยายสูตรอยู่ใน mixing-service.test.mjs
 *
 * รัน: npm test  (ในโฟลเดอร์ backend)
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import consumptionService from '../src/services/consumptionService.js'

const { resolveStockLines, consumeFromStock } = consumptionService

const UNIT_ROWS = [
  { code: 'kg',     name: 'กิโลกรัม',  kind: 'weight', base_code: null, qty_per_base: 1 },
  { code: 'g',      name: 'กรัม',      kind: 'weight', base_code: 'kg', qty_per_base: 1000 },
  { code: 'l',      name: 'ลิตร',      kind: 'volume', base_code: null, qty_per_base: 1 },
  { code: 'ml',     name: 'มิลลิลิตร', kind: 'volume', base_code: 'l',  qty_per_base: 1000 },
  { code: 'sack',   name: 'กระสอบ',    kind: 'count',  base_code: null, qty_per_base: 1 },
  { code: 'bottle', name: 'ขวด',       kind: 'count',  base_code: null, qty_per_base: 1 },
  { code: 'bundle', name: 'มัด',       kind: 'count',  base_code: null, qty_per_base: 1 },
]

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
const productHandler = (product) => ['FROM product WHERE id', [product]]

/** บันทึกลงตารางสมมติ — ผู้เรียกจริงจะเขียนลง mixing_consumption หรือ plot_activity_material */
const recordTo = (table) => async (row) => ({ ...row, recorded_in: table })

/* ---------- resolveStockLines ---------- */

test('แปลงหน่วยที่ผู้ใช้กรอกมาเป็นหน่วยบรรจุของสินค้า', async () => {
  // ใส่ปุ๋ย 2000 กรัม แต่สินค้าบรรจุกระสอบละ 50 กิโลกรัม → เทียบกันที่ 2 กิโลกรัม
  const client = fakeClient([
    unitsHandler,
    productHandler({ id: 3, mat_uid: 'MAT0003', name: 'ปุ๋ยแห้ง 46-0-0',
                     stock_unit: 'sack', pack_size: 50, pack_unit: 'kg' }),
    ['SUM(i.content_remaining)', [{ available: 150 }]],
  ])

  const [line] = await resolveStockLines(client, [{ product_id: 3, qty: 2000, unit_code: 'g' }])

  assert.equal(line.required_qty, 2)
  assert.equal(line.required_unit, 'kg')
  assert.equal(line.required_unit_name, 'กิโลกรัม')
  assert.equal(line.divisible, true)
  assert.equal(line.shortage, 0)
})

test('ของที่ไม่มีขนาดบรรจุนับเป็นจำนวนชิ้น', async () => {
  const client = fakeClient([
    unitsHandler,
    productHandler({ id: 11, mat_uid: 'MAT0011', name: 'ฟางข้าว',
                     stock_unit: 'bundle', pack_size: null, pack_unit: null }),
    ['COUNT(*)', [{ available: 5 }]],
  ])

  const [line] = await resolveStockLines(client, [{ product_id: 11, qty: 3, unit_code: 'bundle' }])

  assert.equal(line.divisible, false)
  assert.equal(line.required_qty, 3)
  assert.equal(line.available_qty, 5)
})

test('บอกส่วนที่ขาดเป็นตัวเลข ไม่ใช่แค่บอกว่าไม่พอ', async () => {
  const client = fakeClient([
    unitsHandler,
    productHandler({ id: 24, mat_uid: 'MAT0024', name: 'EM',
                     stock_unit: 'bottle', pack_size: 1, pack_unit: 'l' }),
    ['SUM(i.content_remaining)', [{ available: 0.3 }]],
  ])

  const [line] = await resolveStockLines(client, [{ product_id: 24, qty: 500, unit_code: 'ml' }])

  assert.equal(line.required_qty, 0.5)
  assert.equal(line.shortage, 0.2)
})

test('ไม่พบสินค้า ต้องบอกว่าเป็นรายการไหน', async () => {
  const client = fakeClient([unitsHandler, ['FROM product WHERE id', []]])
  await assert.rejects(
    () => resolveStockLines(client, [{ product_id: 999, qty: 1, unit_code: 'kg', label: 'รายการที่ 2' }]),
    /รายการที่ 2: ไม่พบวัตถุดิบ/
  )
})

test('หน่วยที่แปลงไม่ได้ต้องฟ้องเป็นชื่อหน่วยภาษาคน', async () => {
  const client = fakeClient([
    unitsHandler,
    productHandler({ id: 3, mat_uid: 'MAT0003', name: 'ปุ๋ยแห้ง',
                     stock_unit: 'sack', pack_size: 50, pack_unit: 'kg' }),
  ])
  await assert.rejects(
    () => resolveStockLines(client, [{ product_id: 3, qty: 1, unit_code: 'l' }]),
    /แปลงหน่วย "ลิตร" เป็น "กิโลกรัม" ไม่ได้/
  )
})

/* ---------- consumeFromStock ---------- */

const line = (over = {}) => ({
  product_id: 24, product_name: 'EM',
  required_qty: 0.02, required_unit: 'l', required_unit_name: 'ลิตร',
  available_qty: 1, shortage: 0, divisible: true,
  ...over,
})

test('ผู้เรียกกำหนดเองได้ว่าจะบันทึกประวัติลงตารางไหน', async () => {
  // นี่คือเหตุผลที่แยก service นี้ออกมา — ผสมกับปลูกหักของเหมือนกัน แต่บันทึกคนละที่
  const client = fakeClient([
    ['FROM item', [{ id: 1, item_id: 'X-1', content_size: 1, content_remaining: 1,
                     content_unit: 'l', cost: 200, lot_id: 5 }]],
  ])

  const { consumptions } = await consumeFromStock(client, {
    lines: [line()],
    onConsume: recordTo('plot_activity_material'),
  })

  assert.equal(consumptions[0].recorded_in, 'plot_activity_material')
  assert.equal(consumptions[0].cost, 4)
  assert.equal(consumptions[0].item_code, 'X-1')
  assert.equal(consumptions[0].product_name, 'EM')
})

test('คิดต้นทุนตามสัดส่วนที่ใช้จริง', async () => {
  const client = fakeClient([
    ['FROM item', [{ id: 1, item_id: 'X-1', content_size: 1, content_remaining: 1,
                     content_unit: 'l', cost: 200, lot_id: 5 }]],
  ])

  const { totalCost } = await consumeFromStock(client, {
    lines: [line()], onConsume: recordTo('t'),
  })

  assert.equal(totalCost, 4)   // ไม่ใช่ 200
  const update = client.calls.find(c => c.sql.includes('SET content_remaining ='))
  assert.deepEqual(update.params, [0.98, 1])
})

test('หักข้ามชิ้นจนครบ แล้วปิดชิ้นที่หมด', async () => {
  const client = fakeClient([
    ['FROM item', [
      { id: 1, item_id: 'A', content_size: 1, content_remaining: 1, content_unit: 'l', cost: 100, lot_id: 5 },
      { id: 2, item_id: 'B', content_size: 1, content_remaining: 1, content_unit: 'l', cost: 100, lot_id: 5 },
    ]],
  ])

  const { totalCost, consumptions } = await consumeFromStock(client, {
    lines: [line({ required_qty: 1.5, available_qty: 2 })],
    onConsume: recordTo('t'),
  })

  assert.equal(consumptions.length, 2)
  assert.equal(totalCost, 150)
  assert.deepEqual(
    client.calls.filter(c => c.sql.includes('SET content_remaining =')).map(c => c.params),
    [[0, 1], [0.5, 2]]
  )
  // ชิ้นแรกหมด ต้องถูกปิดและลด qty_remaining ของ lot
  assert.equal(client.calls.filter(c => c.sql.includes("status = 'dispensed'")).length, 1)
})

test('ของที่หักทั้งหน่วยคิดต้นทุนเต็มราคาชิ้น', async () => {
  const client = fakeClient([
    ['FROM item', [
      { id: 7, item_id: 'STRAW-1', content_size: null, content_remaining: null,
        content_unit: null, cost: 30, lot_id: 8 },
      { id: 8, item_id: 'STRAW-2', content_size: null, content_remaining: null,
        content_unit: null, cost: 30, lot_id: 8 },
    ]],
  ])

  const { totalCost, consumptions } = await consumeFromStock(client, {
    lines: [line({
      product_id: 11, product_name: 'ฟางข้าว', divisible: false,
      required_qty: 2, required_unit: 'bundle', required_unit_name: 'มัด', available_qty: 2,
    })],
    onConsume: recordTo('t'),
  })

  assert.equal(consumptions.length, 2)
  assert.equal(totalCost, 60)
  // ของแบ่งไม่ได้ต้องไม่ไปแก้ content_remaining เลย
  assert.ok(!client.calls.some(c => c.sql.includes('SET content_remaining = $1')))
  assert.equal(client.calls.filter(c => c.sql.includes("status = 'dispensed'")).length, 2)
})

test('บล็อกทันทีเมื่อรู้ว่าของขาด ไม่แตะสต๊อกเลย', async () => {
  const client = fakeClient([])
  await assert.rejects(
    () => consumeFromStock(client, {
      lines: [line({ required_qty: 1, available_qty: 0.2, shortage: 0.8 })],
      onConsume: recordTo('t'),
    }),
    /ขาด 0.8/
  )
  assert.ok(!client.calls.some(c => c.sql.includes('UPDATE item')))
})

test('คำนวณต้นทุนเฉลี่ยใหม่ครั้งเดียวต่อสินค้า ไม่ใช่ต่อชิ้น', async () => {
  const client = fakeClient([
    ['FROM item', [
      { id: 1, item_id: 'A', content_size: 1, content_remaining: 1, content_unit: 'l', cost: 10, lot_id: 5 },
      { id: 2, item_id: 'B', content_size: 1, content_remaining: 1, content_unit: 'l', cost: 10, lot_id: 5 },
    ]],
  ])

  await consumeFromStock(client, {
    lines: [line({ required_qty: 1.5, available_qty: 2 })],
    onConsume: recordTo('t'),
  })

  assert.equal(client.calls.filter(c => c.sql.includes('recalculate_ave_cost')).length, 1)
})
