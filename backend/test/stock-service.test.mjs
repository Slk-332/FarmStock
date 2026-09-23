/**
 * เทสต์ตรรกะสต๊อกที่ใช้ร่วมกัน (Phase 2)
 *
 * stockService รับ `client` เข้ามาเป็นพารามิเตอร์ จึงเทสต์ด้วย client ปลอมได้
 * โดยไม่ต้องมีฐานข้อมูล — สำคัญมากตอนนี้เพราะ Supabase ยังต่อไม่ได้
 *
 * สองเรื่องที่พังแล้วเจอยากและแพง:
 *   1. รูปแบบ item_id — ถ้าเปลี่ยนไปจากเดิม ฉลาก QR ที่พิมพ์ไปแล้วจะสแกนไม่เจอของ
 *   2. เลขเอกสาร — ถ้าออกเลขซ้ำ ใบสั่งซื้อจะชนกันที่ unique constraint กลางงาน
 *
 * รัน: npm test  (ในโฟลเดอร์ backend)
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import stockService from '../src/services/stockService.js'

const { nextDocNo, createLotWithItems } = stockService

/**
 * client ปลอม — ตอบตาม SQL ที่ได้รับ และเก็บทุก query ไว้ให้ตรวจย้อนหลัง
 * `responses` คือคู่ [ชิ้นส่วนของ SQL ที่ต้องเจอ, ผลลัพธ์]
 */
function fakeClient(responses) {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      for (const [needle, rows] of responses) {
        if (sql.includes(needle)) return { rows: typeof rows === 'function' ? rows(params) : rows }
      }
      return { rows: [] }
    },
  }
}

test('nextDocNo ออกเลขใบสั่งซื้อตัวแรกเป็น PR100001', async () => {
  const client = fakeClient([['FROM purchase_order', [{ last: '0' }]]])
  assert.equal(await nextDocNo(client, 'purchase_order'), 'PR100001')
})

test('nextDocNo นับต่อจากเลขสูงสุดที่มีอยู่ ไม่ใช่จำนวนแถว', async () => {
  // เลขล่าสุดคือ 42 แม้จะมีแค่ 3 แถว (อีก 39 ใบถูกลบไป) — ต้องได้ 43 ไม่ใช่ 4
  const client = fakeClient([['FROM purchase_order', [{ last: '42' }]]])
  assert.equal(await nextDocNo(client, 'purchase_order'), 'PR100043')
})

test('nextDocNo ออกเลข Lot และใบรับตามรูปแบบของแต่ละชนิด', async () => {
  assert.equal(await nextDocNo(fakeClient([['FROM lot', [{ last: '0' }]]]), 'lot'), 'LOT000001')
  assert.equal(
    await nextDocNo(fakeClient([['FROM goods_receipt', [{ last: '9' }]]]), 'goods_receipt'),
    'RC000010'
  )
})

test('nextDocNo ไม่ยอมออกเลขให้ชนิดเอกสารที่ไม่รู้จัก', async () => {
  await assert.rejects(
    () => nextDocNo(fakeClient([]), 'ไม่มีจริง'),
    /ไม่รู้จักชนิดเอกสาร/
  )
})

/** ชุดคำตอบมาตรฐานสำหรับ createLotWithItems */
const lotResponses = (matUid = 'MAT0003', pack = { pack_size: 50, pack_unit: 'kg' }) => ([
  ['FROM product',      [{ mat_uid: matUid, ...pack }]],
  ['INSERT INTO lot',   [{ id: 77, lot_no: 'LOT000001' }]],
  ['INSERT INTO item',  (params) => params[0].map((id) => ({ item_id: id, lot_id: 77 }))],
])

test('createLotWithItems สร้าง item_id ตามรูปแบบเดิมทุกตัวอักษร', async () => {
  const client = fakeClient(lotResponses())
  const { items } = await createLotWithItems(client, {
    product_id: 3, lot_no: 'LOT000001', qty: 3,
    cost: 980, mfg_date: '2026-07-26', exp_date: '2027-07-26',
  })

  assert.deepEqual(items.map(i => i.item_id), [
    'MAT0003-LOT000001-001',
    'MAT0003-LOT000001-002',
    'MAT0003-LOT000001-003',
  ])
})

test('createLotWithItems ตัดขีดออกจาก mat_uid เหมือนของเดิม', async () => {
  const client = fakeClient(lotResponses('UID-001'))
  const { items } = await createLotWithItems(client, {
    product_id: 1, lot_no: 'LOT000007', qty: 1,
    cost: 10, mfg_date: '2026-01-01', exp_date: '2026-12-31',
  })
  assert.equal(items[0].item_id, 'UID001-LOT000007-001')
})

test('createLotWithItems แทรก item ทั้งหมดในคำสั่งเดียว ไม่ใช่ทีละชิ้น', async () => {
  const client = fakeClient(lotResponses())
  await createLotWithItems(client, {
    product_id: 3, lot_no: 'LOT000001', qty: 50,
    cost: 1, mfg_date: '2026-01-01', exp_date: '2026-12-31',
  })

  const itemInserts = client.calls.filter(c => c.sql.includes('INSERT INTO item'))
  assert.equal(itemInserts.length, 1)
  assert.equal(itemInserts[0].params[0].length, 50)
})

test('createLotWithItems คำนวณ ave_cost ใหม่เสมอ', async () => {
  const client = fakeClient(lotResponses())
  await createLotWithItems(client, {
    product_id: 3, lot_no: 'LOT000001', qty: 2,
    cost: 5, mfg_date: '2026-01-01', exp_date: '2026-12-31',
  })
  assert.ok(client.calls.some(c => c.sql.includes('recalculate_ave_cost')))
})

test('createLotWithItems ไม่ยอมรับจำนวนที่ไม่ใช่จำนวนเต็มบวก', async () => {
  for (const qty of [0, -1, 2.5, 'สอง', null]) {
    await assert.rejects(
      () => createLotWithItems(fakeClient(lotResponses()), {
        product_id: 3, lot_no: 'LOT000001', qty,
        cost: 1, mfg_date: '2026-01-01', exp_date: '2026-12-31',
      }),
      /จำนวนเต็มบวก/,
      `qty = ${qty} ควรถูกปฏิเสธ`
    )
  }
})

test('createLotWithItems คัดลอกขนาดบรรจุลงทุกชิ้นที่สร้าง', async () => {
  // ไม่ทำตรงนี้ ของที่รับเข้ามาใหม่จะเอาไปผสมแบบเปิดใช้บางส่วนไม่ได้เลย
  const client = fakeClient(lotResponses('MAT0024', { pack_size: 1, pack_unit: 'l' }))
  await createLotWithItems(client, {
    product_id: 24, lot_no: 'LOT000002', qty: 2,
    cost: 200, mfg_date: '2026-01-01', exp_date: '2026-12-31',
  })

  const insert = client.calls.find(c => c.sql.includes('INSERT INTO item'))
  assert.match(insert.sql, /content_size, content_unit, content_remaining/)
  // ปริมาณคงเหลือตั้งต้นต้องเท่ากับขนาดบรรจุ (พารามิเตอร์ตัวเดียวกันถูกใช้ซ้ำใน SELECT)
  assert.deepEqual(insert.params.slice(2), [1, 'l'])
})

test('createLotWithItems ปล่อยขนาดบรรจุเป็นว่างเมื่อสินค้าไม่ได้ระบุไว้', async () => {
  // เช่น ฟางข้าวที่นับเป็นมัด — แบ่งครึ่งมัดไม่ได้ ต้องหักทั้งหน่วย
  const client = fakeClient(lotResponses('MAT0011', { pack_size: null, pack_unit: null }))
  await createLotWithItems(client, {
    product_id: 11, lot_no: 'LOT000003', qty: 1,
    cost: 30, mfg_date: '2026-01-01', exp_date: '2026-12-31',
  })

  const insert = client.calls.find(c => c.sql.includes('INSERT INTO item'))
  assert.deepEqual(insert.params.slice(2), [null, null])
})

test('createLotWithItems ไม่สร้าง lot ถ้าหาสินค้าไม่เจอ', async () => {
  const client = fakeClient([['FROM product', []]])
  await assert.rejects(
    () => createLotWithItems(client, {
      product_id: 999, lot_no: 'LOT000001', qty: 1,
      cost: 1, mfg_date: '2026-01-01', exp_date: '2026-12-31',
    }),
    /ไม่พบสินค้า/
  )
  assert.ok(!client.calls.some(c => c.sql.includes('INSERT INTO lot')))
})
