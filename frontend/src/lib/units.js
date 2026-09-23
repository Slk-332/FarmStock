/**
 * ตัวช่วยเรื่องหน่วยนับ (Phase 1)
 *
 * ข้อมูลหน่วยมาจาก GET /api/units — แต่ละตัวมีหน้าตาแบบนี้:
 *   { code:'g', name:'กรัม', kind:'weight', base_code:'kg', qty_per_base:1000 }
 *
 * กติกาการแปลง: qty_per_base คือ "จำนวนหน่วยนี้ที่เท่ากับ 1 หน่วยฐาน"
 *   → ค่าในหน่วยฐาน = qty / qty_per_base
 * หน่วยตระกูล count (กระสอบ/ถุง/ขวด) แปลงข้ามกันไม่ได้ เพราะ 1 หน่วย = 1 item = 1 QR
 */

/** ทำ list จาก API ให้เป็น map ค้นด้วย code ได้เร็ว */
export function indexUnits(units = []) {
  return new Map(units.map((u) => [u.code, u]))
}

/** ชื่อไทยของหน่วย — ไม่รู้จักก็คืน code ดิบไปแสดงแทน ดีกว่าโชว์ว่าง */
export function unitName(units, code) {
  if (!code) return ''
  const map = units instanceof Map ? units : indexUnits(units)
  return map.get(code)?.name || code
}

/** แปลงปริมาณเป็นหน่วยฐานของตระกูลตัวเอง เช่น 1500 กรัม → 1.5 (กิโลกรัม) */
export function toBaseQty(units, qty, code) {
  const map = units instanceof Map ? units : indexUnits(units)
  const unit = map.get(code)
  if (!unit) return null
  const perBase = Number(unit.qty_per_base)
  if (!Number.isFinite(perBase) || perBase <= 0) return null
  return Number(qty) / perBase
}

/**
 * แปลงปริมาณข้ามหน่วยในตระกูลเดียวกัน เช่น 1500 g → 1.5 kg
 * คืน null เมื่อแปลงไม่ได้ (ไม่รู้จักหน่วย หรือคนละตระกูล) — ผู้เรียกต้องเช็คเสมอ
 */
export function convertQty(units, qty, fromCode, toCode) {
  if (fromCode === toCode) return Number(qty)
  const map = units instanceof Map ? units : indexUnits(units)
  const from = map.get(fromCode)
  const to   = map.get(toCode)
  if (!from || !to) return null
  if (from.kind !== to.kind) return null
  // หน่วยนับไม่มีหน่วยฐานร่วม — กระสอบกับถุงเทียบกันไม่ได้
  if (from.kind === 'count') return null

  const base = toBaseQty(map, qty, fromCode)
  if (base === null) return null
  const perBase = Number(to.qty_per_base)
  if (!Number.isFinite(perBase) || perBase <= 0) return null
  return base * perBase
}

/** ตัดศูนย์ท้ายทศนิยมออก: 5.00 → "5", 1.50 → "1.5" */
export function trimNumber(value, maxDecimals = 4) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return String(Number(n.toFixed(maxDecimals)))
}

/** "5 กระสอบ" — ใช้แทนคำว่า "ชิ้น" ที่ hardcode อยู่ทั่วหน้าจอเดิม */
export function formatQty(units, qty, code) {
  const name = unitName(units, code)
  const num = trimNumber(qty)
  return name ? `${num} ${name}` : num
}

/** "50 กิโลกรัม/กระสอบ" — คืนค่าว่างถ้าสินค้านั้นไม่ได้ระบุขนาดบรรจุ */
export function formatPackSize(units, product) {
  if (!product?.pack_size || !product?.pack_unit) return ''
  return `${trimNumber(product.pack_size)} ${unitName(units, product.pack_unit)}/${unitName(units, product.stock_unit)}`
}

export const MAT_TYPES = [
  { value: 'material', label: 'วัตถุดิบ (ซื้อเข้า)' },
  { value: 'mixed',    label: 'ของผสม (จาก Mixing)' },
  { value: 'produce',  label: 'ผลผลิต (จากแปลงปลูก)' },
]

export function matTypeLabel(value) {
  return MAT_TYPES.find((t) => t.value === value)?.label || value || '-'
}
