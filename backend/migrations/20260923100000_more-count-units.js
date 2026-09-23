/**
 * เพิ่มหน่วยนับที่ใช้จริงในฟาร์ม
 *
 *   ฟางข้าว    → นับเป็น ก้อน
 *   ไข่ไก่      → นับเป็น แผง (ขนาดบรรจุเป็น ฟอง เช่น แผงละ 30 ฟอง)
 *   ถุงคาร์บอน → นับเป็น ใบ   (ขายยกเป็น แพ็ค ได้ เช่น แพ็คละ 100 ใบ)
 *
 * หน่วยตระกูล count ใช้เป็น "หน่วยขนาดบรรจุ" ได้ด้วย (แพ็ค/ฟอง/ใบ)
 * ไม่ต้องแก้ schema — pack_unit อ้าง unit(code) ได้ทุกประเภทอยู่แล้ว
 */

exports.shorthands = undefined

const NEW_UNITS = [
  { code: 'bale',  name: 'ก้อน', sort_order: 50 },
  { code: 'tray',  name: 'แผง', sort_order: 51 },
  { code: 'sheet', name: 'ใบ',   sort_order: 52 },
]

exports.up = (pgm) => {
  for (const u of NEW_UNITS) {
    // ถ้าผู้ใช้เคยเพิ่มหน่วยชื่อเดียวกันเองผ่านหน้าลงทะเบียน (รหัส u1, u2…) ก็ไม่เพิ่มซ้ำ
    pgm.sql(`
      INSERT INTO unit (code, name, kind, base_code, qty_per_base, sort_order)
      SELECT '${u.code}', '${u.name}', 'count', NULL, 1, ${u.sort_order}
      WHERE NOT EXISTS (SELECT 1 FROM unit WHERE name = '${u.name}' AND kind = 'count')
      ON CONFLICT (code) DO NOTHING`)
  }
}

exports.down = (pgm) => {
  // ลบเฉพาะหน่วยที่ยังไม่มีสินค้าไหนใช้ — ถ้าใช้แล้ว FK จะกันไว้อยู่ดี
  pgm.sql(`
    DELETE FROM unit u
    WHERE u.code IN (${NEW_UNITS.map((u) => `'${u.code}'`).join(', ')})
      AND NOT EXISTS (SELECT 1 FROM product p WHERE p.stock_unit = u.code OR p.pack_unit = u.code)`)
}
