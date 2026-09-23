/**
 * Phase 3 — Mixing Process: สูตรผสม + ใบสั่งผลิต + การเปิดใช้วัตถุดิบบางส่วน
 *
 * ปัญหาที่ต้องแก้: สูตรเขียนเป็น "EM 20 มิลลิลิตร" แต่สต๊อกเก็บเป็น "ขวด"
 * ถ้าหักทั้งขวดต้นทุนจะพุ่ง (ขวดละ 200 บาท ใช้แค่ 20 มล. ก็คิด 200)
 * จึงเพิ่มปริมาณคงเหลือลงในแต่ละ item — เปิดขวดแล้วใช้ไปทีละนิดได้ ขวดปิดตัวเองเมื่อหมด
 *
 * ของที่ไม่มีขนาดบรรจุ (เช่น ฟางข้าว 1 มัด) content_size เป็น NULL
 * → ยังหักทั้งหน่วยเหมือนเดิม แบ่งครึ่งมัดไม่ได้
 *
 * ดู docs/new-systems-design.md ประกอบ
 */

exports.shorthands = undefined

exports.up = (pgm) => {
  /* ---------- เปิดใช้วัตถุดิบบางส่วน ---------- */

  pgm.addColumns('item', {
    // ปริมาณบรรจุตอนรับเข้า — เก็บสำเนาไว้ ไม่อ้าง product.pack_size ตรง ๆ
    // เพราะถ้าวันหลังแก้ขนาดบรรจุของสินค้า ของที่อยู่ในคลังแล้วต้องคงปริมาณจริงของมันไว้
    content_size:      { type: 'numeric(18,4)' },
    content_unit:      { type: 'varchar(20)' },
    // เหลือเท่าไร — NULL แปลว่าสินค้านี้ไม่มีขนาดบรรจุ ต้องหักทั้งหน่วย
    content_remaining: { type: 'numeric(18,4)' },
  })

  pgm.addConstraint('item', 'item_content_unit_fkey',
    { foreignKeys: { columns: 'content_unit', references: 'unit(code)', onDelete: 'RESTRICT' } })
  pgm.addConstraint('item', 'item_content_remaining_check',
    'CHECK (content_remaining IS NULL OR content_remaining >= 0)')

  // เติมค่าให้ของที่อยู่ในคลังอยู่แล้ว — ที่ยังไม่ถูกเบิกถือว่าเต็มหน่วย ที่เบิกไปแล้วถือว่าหมด
  pgm.sql(`
    UPDATE item i
    SET content_size      = p.pack_size,
        content_unit      = p.pack_unit,
        content_remaining = CASE WHEN i.status = 'active' THEN p.pack_size ELSE 0 END
    FROM lot l
    JOIN product p ON p.id = l.product_id
    WHERE i.lot_id = l.id
      AND p.pack_size IS NOT NULL`)

  /* ---------- สูตรผสม ---------- */

  pgm.createTable('formula', {
    id:                { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    std_code:          { type: 'varchar(30)',   notNull: true, unique: true },
    name:              { type: 'varchar(200)',  notNull: true },
    gtf_no:            { type: 'varchar(60)' },
    ferment_days:      { type: 'integer',       notNull: true, default: 0 },
    shelf_life_days:   { type: 'integer',       notNull: true, default: 0 },
    // สินค้าที่ได้จากสูตรนี้ — ต้องลงทะเบียนไว้ก่อนโดยตั้ง mat_type = 'mixed'
    output_product_id: { type: 'uuid',       notNull: true, references: 'product(id)', onDelete: 'RESTRICT' },
    // ผลผลิตต่อ 1 ชุดสูตร ใช้เป็นตัวหารตอนขยายสูตรตามปริมาณที่สั่งผลิต
    output_qty:        { type: 'numeric(18,4)', notNull: true },
    output_unit:       { type: 'varchar(20)',   notNull: true, references: 'unit(code)', onDelete: 'RESTRICT' },
    is_active:         { type: 'boolean',       notNull: true, default: true },
    note:              { type: 'text' },
    created_by:        { type: 'uuid',       references: 'users(id)', onDelete: 'SET NULL' },
    created_at:        { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
    updated_at:        { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
  })

  pgm.addConstraint('formula', 'formula_output_qty_check', 'CHECK (output_qty > 0)')
  pgm.addConstraint('formula', 'formula_days_check',
    'CHECK (ferment_days >= 0 AND shelf_life_days >= 0)')
  pgm.createIndex('formula', 'output_product_id')
  pgm.createIndex('formula', 'is_active')

  pgm.createTable('formula_line', {
    id:         { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    formula_id: { type: 'uuid',       notNull: true, references: 'formula(id)', onDelete: 'CASCADE' },
    seq:        { type: 'integer',       notNull: true, default: 1 },
    product_id: { type: 'uuid',       notNull: true, references: 'product(id)', onDelete: 'RESTRICT' },
    qty:        { type: 'numeric(18,4)', notNull: true },
    unit_code:  { type: 'varchar(20)',   notNull: true, references: 'unit(code)', onDelete: 'RESTRICT' },
    note:       { type: 'text' },
  })

  pgm.addConstraint('formula_line', 'formula_line_qty_check', 'CHECK (qty > 0)')
  pgm.createIndex('formula_line', 'formula_id')
  pgm.createIndex('formula_line', 'product_id')

  /* ---------- ใบสั่งผลิต ---------- */

  pgm.createTable('mixing_order', {
    id:            { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    mix_no:        { type: 'varchar(30)',   notNull: true, unique: true },
    mix_date:      { type: 'date',          notNull: true, default: pgm.func('CURRENT_DATE') },
    formula_id:    { type: 'uuid',       notNull: true, references: 'formula(id)', onDelete: 'RESTRICT' },
    target_qty:    { type: 'numeric(18,4)', notNull: true },
    target_unit:   { type: 'varchar(20)',   notNull: true, references: 'unit(code)', onDelete: 'RESTRICT' },
    status:        { type: 'varchar(20)',   notNull: true, default: 'requested' },
    // lot ของผลผลิตที่ได้ — ว่างจนกว่าจะกดยืนยันผลิต
    output_lot_id: { type: 'uuid',       references: 'lot(id)', onDelete: 'SET NULL' },
    // จำนวนหน่วยนับที่บรรจุได้จริง = จำนวน QR ที่จะพิมพ์
    output_units:  { type: 'integer' },
    total_cost:    { type: 'numeric(18,2)', notNull: true, default: 0 },
    cost_per_unit: { type: 'numeric(18,4)', notNull: true, default: 0 },
    note:          { type: 'text' },
    created_by:    { type: 'uuid',       references: 'users(id)', onDelete: 'SET NULL' },
    created_at:    { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
    updated_at:    { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
  })

  pgm.addConstraint('mixing_order', 'mixing_order_status_check',
    "CHECK (status IN ('requested', 'done', 'cancelled'))")
  pgm.addConstraint('mixing_order', 'mixing_order_target_qty_check', 'CHECK (target_qty > 0)')
  pgm.createIndex('mixing_order', 'formula_id')
  pgm.createIndex('mixing_order', 'status')
  pgm.createIndex('mixing_order', 'mix_date')

  pgm.createTable('mixing_consumption', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    mixing_order_id: { type: 'uuid',       notNull: true, references: 'mixing_order(id)', onDelete: 'CASCADE' },
    product_id:      { type: 'uuid',       notNull: true, references: 'product(id)', onDelete: 'RESTRICT' },
    // ชิ้นที่ถูกหัก — RESTRICT เพื่อไม่ให้ลบ item ทิ้งแล้วเหลือประวัติต้นทุนที่ตรวจสอบย้อนกลับไม่ได้
    item_id:         { type: 'uuid',       notNull: true, references: 'item(id)', onDelete: 'RESTRICT' },
    // ปริมาณที่หักจากชิ้นนั้น — หน่วยตาม unit_code (ปริมาณบรรจุ หรือหน่วยนับถ้าไม่มีขนาดบรรจุ)
    qty:             { type: 'numeric(18,4)', notNull: true },
    unit_code:       { type: 'varchar(20)',   notNull: true, references: 'unit(code)', onDelete: 'RESTRICT' },
    cost:            { type: 'numeric(18,4)', notNull: true, default: 0 },
    created_at:      { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
  })

  pgm.addConstraint('mixing_consumption', 'mixing_consumption_qty_check', 'CHECK (qty > 0)')
  pgm.createIndex('mixing_consumption', 'mixing_order_id')
  pgm.createIndex('mixing_consumption', 'product_id')
  pgm.createIndex('mixing_consumption', 'item_id')
}

exports.down = (pgm) => {
  pgm.dropTable('mixing_consumption')
  pgm.dropTable('mixing_order')
  pgm.dropTable('formula_line')
  pgm.dropTable('formula')
  pgm.dropConstraint('item', 'item_content_remaining_check')
  pgm.dropConstraint('item', 'item_content_unit_fkey')
  pgm.dropColumns('item', ['content_size', 'content_unit', 'content_remaining'])
}
