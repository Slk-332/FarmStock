/**
 * Phase 5 — Selling Process: รายการขาย ดึงของจาก Stock ตรง สรุปกำไรต่อรอบ
 *
 * ยืนยันการขาย = หักของจากสต๊อกด้วยกติกาเดียวกับการผสมและการดูแลแปลง
 * (consumptionService) ต้นทุนที่ได้จากตรงนั้นคือ "ต้นทุนของที่ขายไปจริง"
 * เอาไปลบจากยอดขายได้กำไรของรอบนั้นทันที
 *
 * ต้นทุนของผลผลิตถูกใส่ไว้ตั้งแต่ตอนเก็บเกี่ยว (Phase 4) และของผสมตั้งแต่ตอนผลิต (Phase 3)
 * กำไรที่ออกมาตรงนี้จึงเป็นกำไรจริง ไม่ใช่ยอดขายลบต้นทุนที่เดาเอา
 *
 * ดู docs/new-systems-design.md ประกอบ
 */

exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.createTable('sale', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    sale_no:      { type: 'varchar(30)',   notNull: true, unique: true },
    sale_date:    { type: 'date',          notNull: true, default: pgm.func('CURRENT_DATE') },
    customer:     { type: 'varchar(200)' },
    // draft = ร่าง (ยังไม่หักของ), confirmed = ขายแล้ว (หักของแล้ว), cancelled = ยกเลิก
    status:       { type: 'varchar(20)',   notNull: true, default: 'draft' },
    total_amount: { type: 'numeric(18,2)', notNull: true, default: 0 },
    total_cost:   { type: 'numeric(18,2)', notNull: true, default: 0 },
    // เก็บกำไรไว้เลยแทนการคำนวณทุกครั้ง เพราะรายงานย้อนหลังต้องเห็นตัวเลข ณ วันที่ขาย
    // ถ้าคำนวณสดจาก ave_cost ปัจจุบัน กำไรของเดือนที่แล้วจะเปลี่ยนไปเรื่อย ๆ ตามต้นทุนวันนี้
    profit:       { type: 'numeric(18,2)', notNull: true, default: 0 },
    note:         { type: 'text' },
    created_by:   { type: 'uuid',       references: 'users(id)', onDelete: 'SET NULL' },
    confirmed_at: { type: 'timestamptz' },
    created_at:   { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
    updated_at:   { type: 'timestamptz',   notNull: true, default: pgm.func('NOW()') },
  })

  pgm.addConstraint('sale', 'sale_status_check',
    "CHECK (status IN ('draft', 'confirmed', 'cancelled'))")
  pgm.createIndex('sale', 'status')
  pgm.createIndex('sale', 'sale_date')

  pgm.createTable('sale_line', {
    id:          { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    sale_id:     { type: 'uuid',       notNull: true, references: 'sale(id)', onDelete: 'CASCADE' },
    seq:         { type: 'integer',       notNull: true, default: 1 },
    product_id:  { type: 'uuid',       notNull: true, references: 'product(id)', onDelete: 'RESTRICT' },
    qty:         { type: 'numeric(18,4)', notNull: true },
    unit_code:   { type: 'varchar(20)',   notNull: true, references: 'unit(code)', onDelete: 'RESTRICT' },
    unit_price:  { type: 'numeric(18,4)', notNull: true, default: 0 },
    total_price: { type: 'numeric(18,2)', notNull: true, default: 0 },
    // ต้นทุนจริงของชิ้นที่ถูกหักไป — ว่างจนกว่าจะยืนยันการขาย
    total_cost:  { type: 'numeric(18,2)', notNull: true, default: 0 },
    note:        { type: 'text' },
  })

  pgm.addConstraint('sale_line', 'sale_line_qty_check', 'CHECK (qty > 0)')
  pgm.addConstraint('sale_line', 'sale_line_price_check', 'CHECK (unit_price >= 0)')
  pgm.createIndex('sale_line', 'sale_id')
  pgm.createIndex('sale_line', 'product_id')

  pgm.createTable('sale_line_item', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    sale_line_id: { type: 'uuid',       notNull: true, references: 'sale_line(id)', onDelete: 'CASCADE' },
    // RESTRICT เพื่อไม่ให้ลบ item ทิ้งแล้วเหลือประวัติการขายที่ตรวจย้อนกลับไม่ได้
    item_id:      { type: 'uuid',       notNull: true, references: 'item(id)', onDelete: 'RESTRICT' },
    qty:          { type: 'numeric(18,4)', notNull: true },
    unit_code:    { type: 'varchar(20)',   notNull: true, references: 'unit(code)', onDelete: 'RESTRICT' },
    cost:         { type: 'numeric(18,4)', notNull: true, default: 0 },
  })

  pgm.addConstraint('sale_line_item', 'sale_line_item_qty_check', 'CHECK (qty > 0)')
  pgm.createIndex('sale_line_item', 'sale_line_id')
  pgm.createIndex('sale_line_item', 'item_id')
}

exports.down = (pgm) => {
  pgm.dropTable('sale_line_item')
  pgm.dropTable('sale_line')
  pgm.dropTable('sale')
}
