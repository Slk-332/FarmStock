const { pool } = require('../database')

const MAT_TYPES = ['material', 'mixed', 'produce']

// คอลัมน์ที่แก้ผ่าน PUT ได้ — อะไรที่ไม่อยู่ในนี้ client แก้ไม่ได้
const UPDATABLE = [
  'name', 'detail', 'pieces_per_lot', 'max_stock', 'min_stock', 'group_id',
  'stock_unit', 'pack_size', 'pack_unit', 'mat_type', 'storage_area', 'is_active',
]

/** คอลัมน์ใหม่ของ Phase 1 ที่ view v_stock_summary ยังไม่รู้จัก จึง join product เอาเอง */
const PRODUCT_EXTRA_COLS = `
  p.stock_unit, p.pack_size, p.pack_unit, p.mat_type, p.storage_area, p.is_active, p.updated_at,
  ROUND(v.total_stock * v.ave_cost, 2) AS total_value,
  su.name AS stock_unit_name, pu.name AS pack_unit_name`

const PRODUCT_EXTRA_JOIN = `
  JOIN product p        ON p.id = v.product_id
  LEFT JOIN unit su     ON su.code = p.stock_unit
  LEFT JOIN unit pu     ON pu.code = p.pack_unit`

const getProducts = async (req, res) => {
  try {
    const { search, mat_type, group_id, active } = req.query
    let query = `SELECT v.*, ${PRODUCT_EXTRA_COLS} FROM v_stock_summary v ${PRODUCT_EXTRA_JOIN} WHERE 1=1`
    const params = []

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (v.mat_uid ILIKE $${params.length} OR v.name ILIKE $${params.length}
                 OR v.group_name ILIKE $${params.length})`
    }
    if (mat_type) {
      params.push(mat_type)
      query += ` AND p.mat_type = $${params.length}`
    }
    if (group_id) {
      params.push(group_id)
      query += ` AND p.group_id = $${params.length}`
    }
    // ?active=1 เอาเฉพาะที่ยังใช้งาน, ?active=0 เอาเฉพาะที่ปิดไว้, ไม่ส่ง = เอาทั้งหมด
    if (active === '1' || active === '0') {
      query += ` AND p.is_active = ${active === '1'}`
    }

    query += ` ORDER BY v.name ASC`
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getProductById = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, pg.name AS group_name,
              su.name AS stock_unit_name, pu.name AS pack_unit_name
       FROM product p
       LEFT JOIN product_group pg ON p.group_id = pg.id
       LEFT JOIN unit su ON su.code = p.stock_unit
       LEFT JOIN unit pu ON pu.code = p.pack_unit
       WHERE p.id = $1`,
      [req.params.id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบสินค้า' })
    }
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

/** ตรวจว่าหน่วยที่ส่งมามีจริงและยังเปิดใช้งาน — กันข้อมูลที่แปลงหน่วยไม่ได้ทีหลัง */
const assertUnitExists = async (code, label) => {
  if (!code) return null
  const result = await pool.query('SELECT code FROM unit WHERE code = $1 AND is_active = true', [code])
  if (result.rows.length === 0) throw new Error(`ไม่พบ${label} "${code}" หรือถูกปิดใช้งานอยู่`)
  return code
}

const createProduct = async (req, res) => {
  const {
    mat_uid, name, detail, pieces_per_lot, max_stock, min_stock, group_id,
    stock_unit, pack_size, pack_unit, mat_type, storage_area,
  } = req.body

  if (!mat_uid || !name) {
    return res.status(400).json({ message: 'กรุณากรอก MatUID และชื่อสินค้า' })
  }
  if (mat_type && !MAT_TYPES.includes(mat_type)) {
    return res.status(400).json({ message: `ประเภทวัตถุดิบต้องเป็น ${MAT_TYPES.join(' / ')}` })
  }

  try {
    const exist = await pool.query('SELECT id FROM product WHERE mat_uid = $1', [mat_uid])
    if (exist.rows.length > 0) {
      return res.status(400).json({ message: 'MatUID นี้มีอยู่แล้ว' })
    }

    await assertUnitExists(stock_unit, 'หน่วยนับ')
    await assertUnitExists(pack_unit, 'หน่วยขนาดบรรจุ')

    const result = await pool.query(
      `INSERT INTO product
         (mat_uid, name, detail, pieces_per_lot, max_stock, min_stock, group_id,
          stock_unit, pack_size, pack_unit, mat_type, storage_area)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        mat_uid, name, detail || null, pieces_per_lot || null,
        max_stock || 0, min_stock || 0, group_id || null,
        stock_unit || 'piece', pack_size || null, pack_unit || null,
        mat_type || 'material', storage_area || null,
      ]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  }
}

const updateProduct = async (req, res) => {
  const { id } = req.params

  // อัปเดตเฉพาะฟิลด์ที่ส่งมาจริง — ของเดิมเขียนทับทุกคอลัมน์ ฟิลด์ที่ไม่ส่งจะกลายเป็น null
  const fields = UPDATABLE.filter((key) => key in req.body)
  if (fields.length === 0) {
    return res.status(400).json({ message: 'ไม่มีข้อมูลที่จะอัปเดต' })
  }
  if ('mat_type' in req.body && !MAT_TYPES.includes(req.body.mat_type)) {
    return res.status(400).json({ message: `ประเภทวัตถุดิบต้องเป็น ${MAT_TYPES.join(' / ')}` })
  }

  if ('stock_unit' in req.body && !req.body.stock_unit) {
    return res.status(400).json({ message: 'หน่วยนับเว้นว่างไม่ได้' })
  }

  try {
    if ('stock_unit' in req.body) await assertUnitExists(req.body.stock_unit, 'หน่วยนับ')
    if ('pack_unit'  in req.body) await assertUnitExists(req.body.pack_unit, 'หน่วยขนาดบรรจุ')

    const setClause = fields.map((key, i) => `${key} = $${i + 1}`).join(', ')
    const params = fields.map((key) => req.body[key])
    params.push(id)

    const result = await pool.query(
      `UPDATE product SET ${setClause}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบสินค้า' })
    }
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  }
}

module.exports = { getProducts, getProductById, createProduct, updateProduct }
