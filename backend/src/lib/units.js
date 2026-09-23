/**
 * แปลงหน่วยฝั่ง server
 *
 * มีคู่แฝดอยู่ที่ `frontend/src/lib/units.js` ซึ่งเป็น ESM ส่วนนี่เป็น CommonJS
 * จึง import ข้ามกันไม่ได้ตรง ๆ — ถ้าแก้กติกาการแปลงต้องแก้ทั้งสองที่
 * (เทสต์ของทั้งคู่ใช้ชุดหน่วยเดียวกัน ถ้าเผลอแก้ข้างเดียวจะมีฝั่งหนึ่งแดง)
 *
 * กติกา: qty_per_base คือ "จำนวนหน่วยนี้ที่เท่ากับ 1 หน่วยฐาน"
 *   → ค่าในหน่วยฐาน = qty / qty_per_base
 */

/** โหลดหน่วยทั้งหมดจากฐานข้อมูลมาเป็น Map ค้นด้วย code */
async function loadUnits(client) {
  const { rows } = await client.query('SELECT code, name, kind, base_code, qty_per_base FROM unit')
  return new Map(rows.map((u) => [u.code, u]))
}

/** แปลงเป็นหน่วยฐานของตระกูลตัวเอง — คืน null ถ้าไม่รู้จักหน่วย */
function toBaseQty(units, qty, code) {
  const unit = units.get(code)
  if (!unit) return null
  const perBase = Number(unit.qty_per_base)
  if (!Number.isFinite(perBase) || perBase <= 0) return null
  return Number(qty) / perBase
}

/**
 * แปลงข้ามหน่วยในตระกูลเดียวกัน — คืน null เมื่อแปลงไม่ได้
 * หน่วยนับ (count) แปลงข้ามกันไม่ได้ เพราะกระสอบกับถุงไม่ใช่ของขนาดเท่ากัน
 */
function convertQty(units, qty, fromCode, toCode) {
  if (fromCode === toCode) return Number(qty)
  const from = units.get(fromCode)
  const to   = units.get(toCode)
  if (!from || !to) return null
  if (from.kind !== to.kind) return null
  if (from.kind === 'count') return null

  const base = toBaseQty(units, qty, fromCode)
  if (base === null) return null
  const perBase = Number(to.qty_per_base)
  if (!Number.isFinite(perBase) || perBase <= 0) return null
  return base * perBase
}

/** เหมือน convertQty แต่โยน error พร้อมข้อความภาษาคนแทนการคืน null เงียบ ๆ */
function convertOrThrow(units, qty, fromCode, toCode, what = 'ปริมาณ') {
  const result = convertQty(units, qty, fromCode, toCode)
  if (result === null) {
    const fromName = units.get(fromCode)?.name || fromCode
    const toName   = units.get(toCode)?.name || toCode
    throw new Error(`${what}: แปลงหน่วย "${fromName}" เป็น "${toName}" ไม่ได้`)
  }
  return result
}

function unitName(units, code) {
  return units.get(code)?.name || code || ''
}

module.exports = { loadUnits, toBaseQty, convertQty, convertOrThrow, unitName }
