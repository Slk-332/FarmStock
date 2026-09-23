/**
 * Phase 2 — Order Process: ใบสั่งซื้อ + การรับของเข้า Stock + หลักฐานการซื้อ
 *
 * โครงสร้างตาม T_MaterialOrder / T_MaterialReceive ในไฟล์ตัวอย่าง แต่แยกเป็น header/line
 * เพราะใบสั่งซื้อ 1 ใบสั่งได้หลายรายการ (ของเดิมใน Excel ยัดรวมแถวเดียว)
 *
 * จุดเชื่อมกับของเดิม: goods_receipt_line ผูกกับ lot ที่ถูกสร้างขึ้นตอนรับของ
 * → เข้า flow เดิม (lot + item รายชิ้น + recalculate_ave_cost) ไม่มีสต๊อกชุดที่สอง
 *
 * ดู docs/new-systems-design.md ประกอบ
 */

exports.shorthands = undefined

exports.up = (pgm) => {
  /* ---------- ใบสั่งซื้อ ---------- */

  pgm.createTable('purchase_order', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    order_code:   { type: 'varchar(30)',   notNull: true, unique: true },
    order_date:   { type: 'date',          notNull: true, default: pgm.func('CURRENT_DATE') },
    supplier:     { type: 'varchar(200)' },
    // draft = ร่าง, ordered = สั่งแล้ว, partial = รับบางส่วน, received = รับครบ, cancelled = ยกเลิก
    status:       { type: 'varchar(20)',   notNull: true, default: 'draft' },
    total_amount: { type: 'numeric(18,2)', notNull: true, default: 0 },
    note:         { type: 'text' },
    created_by:   { type: 'uuid',       references: 'users(id)', onDelete: 'SET NULL' },
    created_at:   { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
    updated_at:   { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
  })

  pgm.addConstraint('purchase_order', 'purchase_order_status_check',
    "CHECK (status IN ('draft', 'ordered', 'partial', 'received', 'cancelled'))")
  pgm.createIndex('purchase_order', 'status')
  pgm.createIndex('purchase_order', 'order_date')

  pgm.createTable('purchase_order_line', {
    id:          { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    // ลบใบสั่งซื้อ = รายการในใบหายตาม ไม่มีบรรทัดลอย
    order_id:    { type: 'uuid',       notNull: true, references: 'purchase_order(id)', onDelete: 'CASCADE' },
    seq:         { type: 'integer',       notNull: true, default: 1 },
    product_id:  { type: 'uuid',       notNull: true, references: 'product(id)', onDelete: 'RESTRICT' },
    qty:         { type: 'numeric(18,4)', notNull: true },
    unit_code:   { type: 'varchar(20)',   notNull: true, references: 'unit(code)', onDelete: 'RESTRICT' },
    unit_price:  { type: 'numeric(18,4)', notNull: true, default: 0 },
    total_price: { type: 'numeric(18,2)', notNull: true, default: 0 },
    // รับมาแล้วกี่หน่วย — ใช้ตัดสินว่าใบนี้ partial หรือ received
    qty_received:{ type: 'numeric(18,4)', notNull: true, default: 0 },
    note:        { type: 'text' },
  })

  pgm.addConstraint('purchase_order_line', 'purchase_order_line_qty_check',
    'CHECK (qty > 0)')
  pgm.addConstraint('purchase_order_line', 'purchase_order_line_qty_received_check',
    'CHECK (qty_received >= 0)')
  pgm.createIndex('purchase_order_line', 'order_id')
  pgm.createIndex('purchase_order_line', 'product_id')

  /* ---------- การรับของ ---------- */

  pgm.createTable('goods_receipt', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    receipt_no:   { type: 'varchar(30)',   notNull: true, unique: true },
    receipt_date: { type: 'date',          notNull: true, default: pgm.func('CURRENT_DATE') },
    // NULL ได้ เพราะรับของโดยไม่มีใบสั่งซื้อก็มี (ในไฟล์ตัวอย่างคือ PX000001 = ของที่ได้จากการผสม)
    order_id:     { type: 'uuid',       references: 'purchase_order(id)', onDelete: 'SET NULL' },
    supplier:     { type: 'varchar(200)' },
    note:         { type: 'text' },
    created_by:   { type: 'uuid',       references: 'users(id)', onDelete: 'SET NULL' },
    created_at:   { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
  })

  pgm.createIndex('goods_receipt', 'order_id')
  pgm.createIndex('goods_receipt', 'receipt_date')

  pgm.createTable('goods_receipt_line', {
    id:            { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    receipt_id:    { type: 'uuid',       notNull: true, references: 'goods_receipt(id)', onDelete: 'CASCADE' },
    order_line_id: { type: 'uuid',       references: 'purchase_order_line(id)', onDelete: 'SET NULL' },
    product_id:    { type: 'uuid',       notNull: true, references: 'product(id)', onDelete: 'RESTRICT' },
    // lot ที่ถูกสร้างจากการรับครั้งนี้ — RESTRICT เพื่อไม่ให้ลบ lot ทิ้งแล้วเหลือใบรับที่ชี้ไปไหนไม่รู้
    lot_id:        { type: 'uuid',       notNull: true, references: 'lot(id)', onDelete: 'RESTRICT' },
    qty:           { type: 'numeric(18,4)', notNull: true },
    unit_code:     { type: 'varchar(20)',   notNull: true, references: 'unit(code)', onDelete: 'RESTRICT' },
    unit_price:    { type: 'numeric(18,4)', notNull: true, default: 0 },
    total_price:   { type: 'numeric(18,2)', notNull: true, default: 0 },
  })

  pgm.addConstraint('goods_receipt_line', 'goods_receipt_line_qty_check',
    'CHECK (qty > 0)')
  pgm.createIndex('goods_receipt_line', 'receipt_id')
  pgm.createIndex('goods_receipt_line', 'lot_id')

  /* ---------- หลักฐานการซื้อ ---------- */

  // ตารางกลาง ใช้แนบไฟล์/ลิงก์กับเอกสารอะไรก็ได้ ไม่ต้องเพิ่มตารางใหม่ทุกครั้งที่มีเอกสารชนิดใหม่
  pgm.createTable('attachment', {
    id:          { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    ref_type:    { type: 'varchar(30)',  notNull: true },
    ref_id:      { type: 'uuid',         notNull: true },
    file_name:   { type: 'varchar(255)' },
    file_url:    { type: 'text',         notNull: true },
    note:        { type: 'text' },
    uploaded_by: { type: 'uuid',      references: 'users(id)', onDelete: 'SET NULL' },
    created_at:  { type: 'timestamptz',  notNull: true, default: pgm.func('NOW()') },
  })

  pgm.addConstraint('attachment', 'attachment_ref_type_check',
    "CHECK (ref_type IN ('purchase_order', 'goods_receipt'))")
  // ไม่ใช้ foreign key เพราะ ref_id ชี้ไปได้หลายตาราง — ความถูกต้องคุมที่ชั้น API
  pgm.createIndex('attachment', ['ref_type', 'ref_id'])
}

exports.down = (pgm) => {
  pgm.dropTable('attachment')
  pgm.dropTable('goods_receipt_line')
  pgm.dropTable('goods_receipt')
  pgm.dropTable('purchase_order_line')
  pgm.dropTable('purchase_order')
}
