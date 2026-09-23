/**
 * Phase 4 — Planting Process: โซน/แปลงปลูก + QR ต่อแปลง + บันทึกการดูแล + เก็บเกี่ยว
 *
 * "การดูแลรักษา" หักของจากสต๊อกจริงด้วยกติกาเดียวกับการผสม (เปิดใช้บางส่วนได้)
 * เพื่อให้รู้ต้นทุนสะสมต่อแปลง แล้วเอาไปคิดกำไรจริงตอนขายใน Phase 5
 *
 * `plot_reading` เป็นช่องว่างไว้ให้ IoT ยิงค่าเข้ามาในอนาคต ยังไม่มีอะไรใช้ตอนนี้
 *
 * ดู docs/new-systems-design.md ประกอบ
 */

exports.shorthands = undefined

/** หน่วยพื้นที่ — ฐานคือไร่ เพื่อให้ตัวคูณเป็นจำนวนเต็มทุกตัว */
const AREA_UNITS = [
  { code: 'rai',  name: 'ไร่',          qty_per_base: 1,    sort_order: 40 },
  { code: 'ngan', name: 'งาน',          qty_per_base: 4,    sort_order: 41 },
  { code: 'sqwa', name: 'ตารางวา',      qty_per_base: 400,  sort_order: 42 },
  { code: 'sqm',  name: 'ตารางเมตร',    qty_per_base: 1600, sort_order: 43 },
]

exports.up = (pgm) => {
  /* ---------- หน่วยพื้นที่ ---------- */

  // ตาราง unit เดิมรู้จักแค่ น้ำหนัก/ปริมาตร/หน่วยนับ ต้องเปิดรับ 'area' เพิ่ม
  pgm.dropConstraint('unit', 'unit_kind_check')
  pgm.addConstraint('unit', 'unit_kind_check',
    "CHECK (kind IN ('weight', 'volume', 'count', 'area'))")

  const quote = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
  for (const u of AREA_UNITS) {
    pgm.sql(`
      INSERT INTO unit (code, name, kind, base_code, qty_per_base, sort_order)
      VALUES (${quote(u.code)}, ${quote(u.name)}, 'area',
              ${u.code === 'rai' ? 'NULL' : "'rai'"}, ${u.qty_per_base}, ${u.sort_order})
      ON CONFLICT (code) DO NOTHING`)
  }

  /* ---------- โซนและแปลง ---------- */

  pgm.createTable('area', {
    id:         { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    area_code:  { type: 'varchar(30)',  notNull: true, unique: true },
    name:       { type: 'varchar(200)', notNull: true },
    note:       { type: 'text' },
    is_active:  { type: 'boolean',      notNull: true, default: true },
    created_by: { type: 'uuid',      references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz',  notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz',  notNull: true, default: pgm.func('NOW()') },
  })

  pgm.createTable('plot', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    // RESTRICT เพราะลบโซนทิ้งแล้วแปลงลอยไปไหนไม่ได้ — ต้องย้ายแปลงออกก่อน
    area_id:      { type: 'uuid',       notNull: true, references: 'area(id)', onDelete: 'RESTRICT' },
    plot_code:    { type: 'varchar(30)',   notNull: true, unique: true },
    name:         { type: 'varchar(200)',  notNull: true },
    size:         { type: 'numeric(18,4)' },
    size_unit:    { type: 'varchar(20)',   references: 'unit(code)', onDelete: 'RESTRICT' },
    crop:         { type: 'varchar(200)' },
    planted_date: { type: 'date' },
    // preparing = เตรียมแปลง, planted = ปลูกแล้ว, harvested = เก็บเกี่ยวแล้ว, resting = พักแปลง
    status:       { type: 'varchar(20)',   notNull: true, default: 'preparing' },
    // QR ของแปลงใช้ token สุ่ม ไม่ใช่ id ตรง ๆ — ป้ายที่ติดอยู่กลางแปลงใครก็สแกนได้
    // ถ้าใช้ id เรียงกันจะเดา URL ของแปลงอื่นได้ทันที
    qr_token:     { type: 'varchar(64)',   notNull: true, unique: true },
    note:         { type: 'text' },
    is_active:    { type: 'boolean',       notNull: true, default: true },
    created_by:   { type: 'uuid',       references: 'users(id)', onDelete: 'SET NULL' },
    created_at:   { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
    updated_at:   { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
  })

  pgm.addConstraint('plot', 'plot_status_check',
    "CHECK (status IN ('preparing', 'planted', 'harvested', 'resting'))")
  pgm.addConstraint('plot', 'plot_size_check', 'CHECK (size IS NULL OR size > 0)')
  pgm.createIndex('plot', 'area_id')
  pgm.createIndex('plot', 'status')

  /* ---------- บันทึกการดูแล ---------- */

  pgm.createTable('plot_activity', {
    id:            { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    plot_id:       { type: 'uuid',      notNull: true, references: 'plot(id)', onDelete: 'CASCADE' },
    activity_date: { type: 'date',         notNull: true, default: pgm.func('CURRENT_DATE') },
    // เก็บเป็นข้อความอิสระ ไม่ใช่ enum เพราะกิจกรรมในฟาร์มมีได้ไม่จำกัด
    // หน้าจอมีตัวเลือกสำเร็จรูปให้ แต่พิมพ์เองก็ได้
    activity_type: { type: 'varchar(50)',  notNull: true },
    note:          { type: 'text' },
    // ต้นทุนวัตถุดิบรวมของกิจกรรมนี้ — เก็บซ้ำไว้เพื่อไม่ต้อง SUM ทุกครั้งที่แสดงผล
    total_cost:    { type: 'numeric(18,2)', notNull: true, default: 0 },
    created_by:    { type: 'uuid',      references: 'users(id)', onDelete: 'SET NULL' },
    created_at:    { type: 'timestamptz',  notNull: true, default: pgm.func('NOW()') },
  })

  pgm.createIndex('plot_activity', 'plot_id')
  pgm.createIndex('plot_activity', 'activity_date')

  pgm.createTable('plot_activity_material', {
    id:          { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    activity_id: { type: 'uuid',       notNull: true, references: 'plot_activity(id)', onDelete: 'CASCADE' },
    product_id:  { type: 'uuid',       notNull: true, references: 'product(id)', onDelete: 'RESTRICT' },
    item_id:     { type: 'uuid',       notNull: true, references: 'item(id)', onDelete: 'RESTRICT' },
    qty:         { type: 'numeric(18,4)', notNull: true },
    unit_code:   { type: 'varchar(20)',   notNull: true, references: 'unit(code)', onDelete: 'RESTRICT' },
    cost:        { type: 'numeric(18,4)', notNull: true, default: 0 },
  })

  pgm.addConstraint('plot_activity_material', 'plot_activity_material_qty_check', 'CHECK (qty > 0)')
  pgm.createIndex('plot_activity_material', 'activity_id')
  pgm.createIndex('plot_activity_material', 'product_id')

  /* ---------- เก็บเกี่ยว ---------- */

  pgm.createTable('plot_harvest', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    plot_id:      { type: 'uuid',       notNull: true, references: 'plot(id)', onDelete: 'RESTRICT' },
    harvest_date: { type: 'date',          notNull: true, default: pgm.func('CURRENT_DATE') },
    // สินค้าที่ได้ ต้องลงทะเบียนเป็น mat_type = 'produce' ไว้ก่อน
    product_id:   { type: 'uuid',       notNull: true, references: 'product(id)', onDelete: 'RESTRICT' },
    qty:          { type: 'numeric(18,4)', notNull: true },
    unit_code:    { type: 'varchar(20)',   notNull: true, references: 'unit(code)', onDelete: 'RESTRICT' },
    // จำนวนหน่วยนับที่บรรจุได้ = จำนวน QR ที่ออก
    output_units: { type: 'integer',       notNull: true },
    lot_id:       { type: 'uuid',       references: 'lot(id)', onDelete: 'SET NULL' },
    // ต้นทุนที่ปันส่วนมาจากแปลงนี้ — หักจากต้นทุนสะสมที่ยังไม่ถูกปันส่วน
    cost_total:   { type: 'numeric(18,2)', notNull: true, default: 0 },
    note:         { type: 'text' },
    created_by:   { type: 'uuid',       references: 'users(id)', onDelete: 'SET NULL' },
    created_at:   { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
  })

  pgm.addConstraint('plot_harvest', 'plot_harvest_qty_check', 'CHECK (qty > 0)')
  pgm.addConstraint('plot_harvest', 'plot_harvest_units_check', 'CHECK (output_units > 0)')
  pgm.createIndex('plot_harvest', 'plot_id')
  pgm.createIndex('plot_harvest', 'harvest_date')

  /* ---------- ค่าที่อ่านได้จากแปลง (เผื่อ IoT) ---------- */

  pgm.createTable('plot_reading', {
    id:          { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    plot_id:     { type: 'uuid',       notNull: true, references: 'plot(id)', onDelete: 'CASCADE' },
    // เช่น soil_moisture, temperature, ph — ไม่จำกัดชนิดไว้ล่วงหน้า
    sensor_key:  { type: 'varchar(50)',   notNull: true },
    value:       { type: 'numeric(18,4)', notNull: true },
    // หน่วยของเซ็นเซอร์ (°C, %, pH) ไม่ได้อยู่ในตาราง unit จึงเก็บเป็นข้อความอิสระ ไม่มี FK
    unit_label:  { type: 'varchar(30)' },
    source:      { type: 'varchar(30)',   notNull: true, default: 'manual' },
    recorded_at: { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
  })

  pgm.createIndex('plot_reading', ['plot_id', 'sensor_key', 'recorded_at'])
}

exports.down = (pgm) => {
  pgm.dropTable('plot_reading')
  pgm.dropTable('plot_harvest')
  pgm.dropTable('plot_activity_material')
  pgm.dropTable('plot_activity')
  pgm.dropTable('plot')
  pgm.dropTable('area')

  // ลบหน่วยพื้นที่ก่อน ไม่งั้น constraint เดิมที่ไม่รู้จัก 'area' จะใส่กลับไม่ได้
  pgm.sql(`DELETE FROM unit WHERE kind = 'area'`)
  pgm.dropConstraint('unit', 'unit_kind_check')
  pgm.addConstraint('unit', 'unit_kind_check',
    "CHECK (kind IN ('weight', 'volume', 'count'))")
}
