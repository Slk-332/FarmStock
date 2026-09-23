/**
 * Phase 1 — Foundation: หน่วยนับ + ประเภทวัตถุดิบ + พื้นที่จัดเก็บ
 *
 * ระบบเดิมนับทุกอย่างเป็น "ชิ้น" ล้วน ไม่มีหน่วยเลย แต่ระบบใหม่ต้องการหน่วยจริง:
 *   - สูตรผสม (Mixing) เขียนเป็น กรัม / มิลลิลิตร
 *   - สต๊อกนับเป็น กระสอบ / ขวด / ถุง
 *   - ต้องแปลงข้ามกันได้ตอนคำนวณต้นทุน
 *
 * migration นี้ "เพิ่มอย่างเดียว" ไม่แตะโครงสร้างเดิม — ของเก่าที่รันอยู่จะไม่พัง
 *
 * ดู docs/new-systems-design.md ประกอบ
 */

exports.shorthands = undefined

/** หน่วยตั้งต้น — ตรงกับชีต PackingUnit และค่าที่ใช้จริงใน T_MaterialStock / T_MixingFormula */
const SEED_UNITS = [
  // น้ำหนัก — ฐานคือกิโลกรัม
  { code: 'kg',     name: 'กิโลกรัม',    kind: 'weight', base_code: null, qty_per_base: 1,    sort_order: 10 },
  { code: 'g',      name: 'กรัม',        kind: 'weight', base_code: 'kg', qty_per_base: 1000, sort_order: 11 },
  // ปริมาตร — ฐานคือลิตร
  { code: 'l',      name: 'ลิตร',        kind: 'volume', base_code: null, qty_per_base: 1,    sort_order: 20 },
  { code: 'ml',     name: 'มิลลิลิตร',   kind: 'volume', base_code: 'l',  qty_per_base: 1000, sort_order: 21 },
  { code: 'cc',     name: 'ซีซี',        kind: 'volume', base_code: 'l',  qty_per_base: 1000, sort_order: 22 },
  // หน่วยนับ/บรรจุภัณฑ์ — นับตัวเป็นตัว แปลงข้ามกันไม่ได้ (1 หน่วย = 1 item = 1 QR)
  { code: 'sack',   name: 'กระสอบ',      kind: 'count',  base_code: null, qty_per_base: 1,    sort_order: 30 },
  { code: 'bag',    name: 'ถุง',         kind: 'count',  base_code: null, qty_per_base: 1,    sort_order: 31 },
  { code: 'bottle', name: 'ขวด',         kind: 'count',  base_code: null, qty_per_base: 1,    sort_order: 32 },
  { code: 'sachet', name: 'ซอง',         kind: 'count',  base_code: null, qty_per_base: 1,    sort_order: 33 },
  { code: 'pack',   name: 'แพ็ค',        kind: 'count',  base_code: null, qty_per_base: 1,    sort_order: 34 },
  { code: 'jar',    name: 'กระปุก',      kind: 'count',  base_code: null, qty_per_base: 1,    sort_order: 35 },
  { code: 'box',    name: 'กล่อง',       kind: 'count',  base_code: null, qty_per_base: 1,    sort_order: 36 },
  { code: 'bundle', name: 'มัด',         kind: 'count',  base_code: null, qty_per_base: 1,    sort_order: 37 },
  { code: 'egg',    name: 'ฟอง',         kind: 'count',  base_code: null, qty_per_base: 1,    sort_order: 38 },
  { code: 'piece',  name: 'ชิ้น',        kind: 'count',  base_code: null, qty_per_base: 1,    sort_order: 39 },
]

exports.up = (pgm) => {
  pgm.createTable('unit', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    code:         { type: 'varchar(20)',    notNull: true, unique: true },
    name:         { type: 'varchar(50)',    notNull: true },
    // weight / volume แปลงกันได้ในตระกูลเดียวกัน, count แปลงไม่ได้
    kind:         { type: 'varchar(10)',    notNull: true, default: 'count' },
    // หน่วยฐานของตระกูลนี้ (NULL = ตัวเองเป็นฐาน)
    base_code:    { type: 'varchar(20)' },
    // จำนวนหน่วยนี้ที่เท่ากับ 1 หน่วยฐาน เช่น กรัม = 1000 → ค่าในหน่วยฐาน = qty / qty_per_base
    qty_per_base: { type: 'numeric(18,6)',  notNull: true, default: 1 },
    sort_order:   { type: 'integer',        notNull: true, default: 0 },
    is_active:    { type: 'boolean',        notNull: true, default: true },
    created_at:   { type: 'timestamptz',    notNull: true, default: pgm.func('NOW()') },
  })

  pgm.addConstraint('unit', 'unit_kind_check',
    "CHECK (kind IN ('weight', 'volume', 'count'))")
  pgm.addConstraint('unit', 'unit_qty_per_base_check',
    'CHECK (qty_per_base > 0)')
  // หน่วยฐานต้องมีอยู่จริง — กัน typo ที่ทำให้แปลงหน่วยเงียบ ๆ ผิด
  pgm.addConstraint('unit', 'unit_base_code_fkey',
    { foreignKeys: { columns: 'base_code', references: 'unit(code)', onDelete: 'RESTRICT' } })

  const quote = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
  for (const u of SEED_UNITS) {
    pgm.sql(`
      INSERT INTO unit (code, name, kind, base_code, qty_per_base, sort_order)
      VALUES (${quote(u.code)}, ${quote(u.name)}, ${quote(u.kind)},
              ${quote(u.base_code)}, ${u.qty_per_base}, ${u.sort_order})
      ON CONFLICT (code) DO NOTHING`)
  }

  pgm.addColumns('product', {
    // หน่วยที่นับใน stock — 1 หน่วยนี้ = 1 แถว item = 1 QR
    stock_unit:   { type: 'varchar(20)',   notNull: true, default: 'piece' },
    // ขนาดบรรจุต่อ 1 หน่วยนับ เช่น กระสอบละ 50 กิโลกรัม → pack_size=50, pack_unit='kg'
    pack_size:    { type: 'numeric(18,4)' },
    pack_unit:    { type: 'varchar(20)' },
    // material = ซื้อเข้า, mixed = ได้จาก Mixing Process, produce = ผลผลิตจากแปลงปลูก
    mat_type:     { type: 'varchar(20)',   notNull: true, default: 'material' },
    // พื้นที่จัดเก็บในคลัง (คอลัมน์ Area ใน T_MaterialStock) — คนละเรื่องกับแปลงปลูกใน Phase 4
    storage_area: { type: 'varchar(20)' },
    is_active:    { type: 'boolean',       notNull: true, default: true },
  })

  pgm.addConstraint('product', 'product_mat_type_check',
    "CHECK (mat_type IN ('material', 'mixed', 'produce'))")
  pgm.addConstraint('product', 'product_pack_size_check',
    'CHECK (pack_size IS NULL OR pack_size > 0)')
  pgm.addConstraint('product', 'product_stock_unit_fkey',
    { foreignKeys: { columns: 'stock_unit', references: 'unit(code)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('product', 'product_pack_unit_fkey',
    { foreignKeys: { columns: 'pack_unit', references: 'unit(code)', onDelete: 'RESTRICT' } })

  pgm.createIndex('product', 'mat_type')
  pgm.createIndex('product', 'is_active')

  /* ---------- ตัด weight_per_piece ทิ้ง ---------- */

  // v_stock_summary อ้าง weight_per_piece อยู่ จึงต้องสร้าง view ใหม่ก่อน ไม่งั้น DROP COLUMN ไม่ผ่าน
  // นิยามอื่นคงเดิมทุกอย่าง เปลี่ยนแค่เอาคอลัมน์นั้นออก
  pgm.sql('DROP VIEW IF EXISTS v_stock_summary')
  pgm.sql(`
    CREATE VIEW v_stock_summary AS
    SELECT p.id AS product_id,
        p.mat_uid,
        p.name,
        p.detail,
        p.pieces_per_lot,
        p.max_stock,
        p.min_stock,
        pg.name AS group_name,
        COALESCE(sum(l.qty_remaining), (0)::bigint) AS total_stock,
            CASE
                WHEN (COALESCE(sum(l.qty_remaining), (0)::bigint) = 0) THEN 'out'::text
                WHEN (COALESCE(sum(l.qty_remaining), (0)::bigint) <= p.min_stock) THEN 'low'::text
                WHEN (COALESCE(sum(l.qty_remaining), (0)::bigint) >= p.max_stock) THEN 'full'::text
                ELSE 'ok'::text
            END AS stock_status,
        round(
            CASE
                WHEN (COALESCE(sum(l.qty_remaining), (0)::bigint) = 0) THEN (0)::numeric
                ELSE (sum(((l.qty_remaining)::numeric * l.cost)) / (sum(l.qty_remaining))::numeric)
            END, 2) AS ave_cost
       FROM ((product p
         LEFT JOIN product_group pg ON ((p.group_id = pg.id)))
         LEFT JOIN lot l ON (((l.product_id = p.id) AND ((l.status)::text = 'active'::text))))
      GROUP BY p.id, p.mat_uid, p.name, p.detail, p.pieces_per_lot, p.max_stock, p.min_stock, pg.name`)

  pgm.dropColumns('product', ['weight_per_piece'])
}

exports.down = (pgm) => {
  // คืนคอลัมน์กลับมาได้ แต่ค่าเดิมที่เคยอยู่ในนั้นหายไปแล้ว
  pgm.addColumns('product', { weight_per_piece: { type: 'varchar(50)' } })
  pgm.sql('DROP VIEW IF EXISTS v_stock_summary')
  pgm.sql(`
    CREATE VIEW v_stock_summary AS
    SELECT p.id AS product_id, p.mat_uid, p.name, p.detail, p.weight_per_piece,
        p.pieces_per_lot, p.max_stock, p.min_stock, pg.name AS group_name,
        COALESCE(sum(l.qty_remaining), (0)::bigint) AS total_stock,
            CASE
                WHEN (COALESCE(sum(l.qty_remaining), (0)::bigint) = 0) THEN 'out'::text
                WHEN (COALESCE(sum(l.qty_remaining), (0)::bigint) <= p.min_stock) THEN 'low'::text
                WHEN (COALESCE(sum(l.qty_remaining), (0)::bigint) >= p.max_stock) THEN 'full'::text
                ELSE 'ok'::text
            END AS stock_status,
        round(CASE WHEN (COALESCE(sum(l.qty_remaining), (0)::bigint) = 0) THEN (0)::numeric
              ELSE (sum(((l.qty_remaining)::numeric * l.cost)) / (sum(l.qty_remaining))::numeric) END, 2) AS ave_cost
       FROM ((product p
         LEFT JOIN product_group pg ON ((p.group_id = pg.id)))
         LEFT JOIN lot l ON (((l.product_id = p.id) AND ((l.status)::text = 'active'::text))))
      GROUP BY p.id, p.mat_uid, p.name, p.detail, p.weight_per_piece, p.pieces_per_lot,
               p.max_stock, p.min_stock, pg.name`)
  pgm.dropConstraint('product', 'product_pack_unit_fkey')
  pgm.dropConstraint('product', 'product_stock_unit_fkey')
  pgm.dropConstraint('product', 'product_pack_size_check')
  pgm.dropConstraint('product', 'product_mat_type_check')
  pgm.dropIndex('product', 'mat_type')
  pgm.dropIndex('product', 'is_active')
  pgm.dropColumns('product', [
    'stock_unit', 'pack_size', 'pack_unit', 'mat_type', 'storage_area', 'is_active',
  ])
  pgm.dropTable('unit')
}
