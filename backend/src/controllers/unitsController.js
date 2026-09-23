const { pool } = require('../database')

const KINDS = ['weight', 'volume', 'count']

const getUnits = async (req, res) => {
  try {
    const { kind, all } = req.query
    let query = 'SELECT * FROM unit WHERE 1=1'
    const params = []

    // ปกติส่งเฉพาะหน่วยที่ยังใช้งานอยู่ — ?all=1 ใช้ตอนหน้าจัดการหน่วย
    if (all !== '1') query += ' AND is_active = true'
    if (kind) {
      query += ` AND kind = $${params.length + 1}`
      params.push(kind)
    }

    query += ' ORDER BY sort_order ASC, name ASC'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

/** หน่วยที่ผู้ใช้เพิ่มเองมักเป็นชื่อไทย ซึ่งทำเป็น code ไม่ได้ — ออกรหัสให้อัตโนมัติ */
const generateUnitCode = async () => {
  const { rows } = await pool.query(
    `SELECT code FROM unit WHERE code ~ '^u[0-9]+$' ORDER BY length(code) DESC, code DESC LIMIT 1`
  )
  const last = rows.length > 0 ? Number(rows[0].code.slice(1)) : 0
  return `u${last + 1}`
}

const createUnit = async (req, res) => {
  const { name, kind, base_code, qty_per_base, sort_order } = req.body
  let { code } = req.body

  if (!name) {
    return res.status(400).json({ message: 'กรุณากรอกชื่อหน่วย' })
  }
  if (kind && !KINDS.includes(kind)) {
    return res.status(400).json({ message: `ประเภทหน่วยต้องเป็น ${KINDS.join(' / ')}` })
  }

  const unitKind = kind || 'count'
  const perBase = qty_per_base == null || qty_per_base === '' ? 1 : Number(qty_per_base)
  if (!Number.isFinite(perBase) || perBase <= 0) {
    return res.status(400).json({ message: 'จำนวนต่อหน่วยฐานต้องมากกว่า 0' })
  }

  try {
    if (code) {
      const exist = await pool.query('SELECT id FROM unit WHERE code = $1', [code])
      if (exist.rows.length > 0) {
        return res.status(400).json({ message: 'รหัสหน่วยนี้มีอยู่แล้ว' })
      }
    } else {
      code = await generateUnitCode()
    }

    const sameName = await pool.query(
      'SELECT id FROM unit WHERE name = $1 AND kind = $2', [name, unitKind]
    )
    if (sameName.rows.length > 0) {
      return res.status(400).json({ message: 'มีหน่วยชื่อนี้อยู่แล้ว' })
    }

    // หน่วยฐานต้องมีจริงและอยู่ตระกูลเดียวกัน ไม่งั้นการแปลงหน่วยจะผิดแบบเงียบ ๆ
    if (base_code) {
      const base = await pool.query('SELECT kind FROM unit WHERE code = $1', [base_code])
      if (base.rows.length === 0) {
        return res.status(400).json({ message: 'ไม่พบหน่วยฐานที่ระบุ' })
      }
      if (base.rows[0].kind !== unitKind) {
        return res.status(400).json({ message: 'หน่วยฐานต้องเป็นประเภทเดียวกัน (น้ำหนัก/ปริมาตร/นับ)' })
      }
    }

    const result = await pool.query(
      `INSERT INTO unit (code, name, kind, base_code, qty_per_base, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [code, name, unitKind, base_code || null, perBase, Number(sort_order) || 0]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const updateUnit = async (req, res) => {
  const { id } = req.params
  const { name, sort_order, is_active } = req.body

  try {
    // ไม่ให้แก้ code / kind / qty_per_base เพราะมีข้อมูลเก่าอ้างอิงและคำนวณต้นทุนไว้แล้ว
    const result = await pool.query(
      `UPDATE unit
       SET name       = COALESCE($1, name),
           sort_order = COALESCE($2, sort_order),
           is_active  = COALESCE($3, is_active)
       WHERE id = $4 RETURNING *`,
      [name ?? null, sort_order ?? null, is_active ?? null, id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบหน่วยนี้' })
    }
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const deleteUnit = async (req, res) => {
  const { id } = req.params
  try {
    const unit = await pool.query('SELECT code FROM unit WHERE id = $1', [id])
    if (unit.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบหน่วยนี้' })
    }
    const { code } = unit.rows[0]

    const inUse = await pool.query(
      `SELECT 1 FROM product WHERE stock_unit = $1 OR pack_unit = $1
       UNION ALL
       SELECT 1 FROM unit WHERE base_code = $1
       LIMIT 1`,
      [code]
    )
    if (inUse.rows.length > 0) {
      return res.status(400).json({ message: 'ลบไม่ได้ เพราะมีสินค้าหรือหน่วยอื่นใช้หน่วยนี้อยู่ (ปิดการใช้งานแทนได้)' })
    }

    await pool.query('DELETE FROM unit WHERE id = $1', [id])
    res.json({ message: 'ลบหน่วยสำเร็จ' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

module.exports = { getUnits, createUnit, updateUnit, deleteUnit }
