const { pool } = require('../database')

/**
 * สูตรผสม (= T_MixingRegister + T_MixingFormula ในไฟล์ตัวอย่าง)
 *
 * สูตรคือ "บันทึกไว้ใช้ครั้งถัดไป" ตามที่เขียนใน Newfunction — เก็บสัดส่วนต่อ 1 ชุด
 * แล้วตอนสั่งผลิตค่อยขยายตามปริมาณที่ต้องการ
 */

const validateLines = (lines) => {
  if (!Array.isArray(lines) || lines.length === 0) return 'สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ'
  const seen = new Set()
  for (const [i, line] of lines.entries()) {
    const where = `วัตถุดิบรายการที่ ${i + 1}`
    if (!line.product_id) return `${where}: ยังไม่ได้เลือกวัตถุดิบ`
    if (!line.unit_code)  return `${where}: ยังไม่ได้เลือกหน่วย`
    const qty = Number(line.qty)
    if (!Number.isFinite(qty) || qty <= 0) return `${where}: ปริมาณต้องมากกว่า 0`
    // วัตถุดิบซ้ำในสูตรเดียวกันทำให้คำนวณของที่ต้องใช้ผิด เพราะหักแยกกันทีละบรรทัด
    if (seen.has(String(line.product_id))) return `${where}: วัตถุดิบนี้ถูกใส่ในสูตรซ้ำ`
    seen.add(String(line.product_id))
  }
  return null
}

const getFormulas = async (req, res) => {
  try {
    const { search, active } = req.query
    let query = `
      SELECT f.*,
             p.mat_uid AS output_mat_uid, p.name AS output_product_name,
             p.stock_unit AS output_stock_unit,
             un.name AS output_unit_name,
             u.full_name AS created_by_name,
             COUNT(fl.id)::int AS line_count
      FROM formula f
      JOIN product p ON p.id = f.output_product_id
      LEFT JOIN unit un ON un.code = f.output_unit
      LEFT JOIN users u ON u.id = f.created_by
      LEFT JOIN formula_line fl ON fl.formula_id = f.id
      WHERE 1=1`
    const params = []

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (f.std_code ILIKE $${params.length} OR f.name ILIKE $${params.length}
                 OR f.gtf_no ILIKE $${params.length})`
    }
    if (active === '1' || active === '0') {
      query += ` AND f.is_active = ${active === '1'}`
    }

    query += ` GROUP BY f.id, p.mat_uid, p.name, p.stock_unit, un.name, u.full_name
               ORDER BY f.std_code ASC`
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getFormulaById = async (req, res) => {
  try {
    const formula = await pool.query(
      `SELECT f.*,
              p.mat_uid AS output_mat_uid, p.name AS output_product_name,
              p.stock_unit AS output_stock_unit, p.pack_size AS output_pack_size,
              p.pack_unit AS output_pack_unit,
              un.name AS output_unit_name,
              u.full_name AS created_by_name
       FROM formula f
       JOIN product p ON p.id = f.output_product_id
       LEFT JOIN unit un ON un.code = f.output_unit
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.id = $1`,
      [req.params.id]
    )
    if (formula.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบสูตร' })
    }

    const lines = await pool.query(
      `SELECT fl.*, p.mat_uid, p.name AS product_name,
              p.stock_unit, p.pack_size, p.pack_unit,
              un.name AS unit_name
       FROM formula_line fl
       JOIN product p ON p.id = fl.product_id
       LEFT JOIN unit un ON un.code = fl.unit_code
       WHERE fl.formula_id = $1
       ORDER BY fl.seq ASC, fl.id ASC`,
      [req.params.id]
    )

    res.json({ ...formula.rows[0], lines: lines.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

/** เลขสูตรถัดไป เช่น STD0001 → STD0002 */
const getNextStdCode = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(SUBSTRING(std_code FROM 4)::bigint), 0) AS last
       FROM formula WHERE std_code ~ '^STD[0-9]+$'`
    )
    res.json({ std_code: `STD${String(Number(rows[0].last) + 1).padStart(4, '0')}` })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const createFormula = async (req, res) => {
  const {
    std_code, name, gtf_no, ferment_days, shelf_life_days,
    output_product_id, output_qty, output_unit, note, lines,
  } = req.body

  if (!name)              return res.status(400).json({ message: 'กรุณากรอกชื่อสูตร' })
  if (!output_product_id) return res.status(400).json({ message: 'กรุณาเลือกสินค้าที่ได้จากสูตรนี้' })
  if (!output_unit)       return res.status(400).json({ message: 'กรุณาเลือกหน่วยของผลผลิต' })
  if (!(Number(output_qty) > 0)) {
    return res.status(400).json({ message: 'ปริมาณผลผลิตต่อ 1 ชุดต้องมากกว่า 0' })
  }
  const lineError = validateLines(lines)
  if (lineError) return res.status(400).json({ message: lineError })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    let code = std_code
    if (!code) {
      const { rows } = await client.query(
        `SELECT COALESCE(MAX(SUBSTRING(std_code FROM 4)::bigint), 0) AS last
         FROM formula WHERE std_code ~ '^STD[0-9]+$'`
      )
      code = `STD${String(Number(rows[0].last) + 1).padStart(4, '0')}`
    }

    const formulaResult = await client.query(
      `INSERT INTO formula
         (std_code, name, gtf_no, ferment_days, shelf_life_days,
          output_product_id, output_qty, output_unit, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        code, name, gtf_no || null,
        Number(ferment_days) || 0, Number(shelf_life_days) || 0,
        output_product_id, output_qty, output_unit, note || null, req.user.id,
      ]
    )
    const formula = formulaResult.rows[0]

    for (const [i, line] of lines.entries()) {
      await client.query(
        `INSERT INTO formula_line (formula_id, seq, product_id, qty, unit_code, note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [formula.id, Number(line.seq) || i + 1, line.product_id,
         Number(line.qty), line.unit_code, line.note || null]
      )
    }

    await client.query('COMMIT')
    res.status(201).json(formula)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    if (err.code === '23505') {
      return res.status(400).json({ message: 'รหัสสูตรนี้มีอยู่แล้ว' })
    }
    res.status(500).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

const updateFormula = async (req, res) => {
  const { id } = req.params
  const {
    name, gtf_no, ferment_days, shelf_life_days,
    output_product_id, output_qty, output_unit, is_active, note, lines,
  } = req.body

  if (lines) {
    const lineError = validateLines(lines)
    if (lineError) return res.status(400).json({ message: lineError })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const current = await client.query('SELECT id FROM formula WHERE id = $1 FOR UPDATE', [id])
    if (current.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'ไม่พบสูตร' })
    }

    const result = await client.query(
      `UPDATE formula
       SET name              = COALESCE($1, name),
           gtf_no            = COALESCE($2, gtf_no),
           ferment_days      = COALESCE($3, ferment_days),
           shelf_life_days   = COALESCE($4, shelf_life_days),
           output_product_id = COALESCE($5, output_product_id),
           output_qty        = COALESCE($6, output_qty),
           output_unit       = COALESCE($7, output_unit),
           is_active         = COALESCE($8, is_active),
           note              = COALESCE($9, note),
           updated_at        = NOW()
       WHERE id = $10 RETURNING *`,
      [
        name ?? null, gtf_no ?? null,
        ferment_days ?? null, shelf_life_days ?? null,
        output_product_id ?? null, output_qty ?? null, output_unit ?? null,
        is_active ?? null, note ?? null, id,
      ]
    )

    // แก้สูตรไม่กระทบใบสั่งผลิตที่ผลิตไปแล้ว เพราะต้นทุนถูกบันทึกลง mixing_consumption ตอนผลิต
    if (lines) {
      await client.query('DELETE FROM formula_line WHERE formula_id = $1', [id])
      for (const [i, line] of lines.entries()) {
        await client.query(
          `INSERT INTO formula_line (formula_id, seq, product_id, qty, unit_code, note)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, Number(line.seq) || i + 1, line.product_id,
           Number(line.qty), line.unit_code, line.note || null]
        )
      }
    }

    await client.query('COMMIT')
    res.json(result.rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

const deleteFormula = async (req, res) => {
  const { id } = req.params
  try {
    const inUse = await pool.query(
      'SELECT 1 FROM mixing_order WHERE formula_id = $1 LIMIT 1', [id]
    )
    if (inUse.rows.length > 0) {
      return res.status(400).json({ message: 'ลบไม่ได้ เพราะมีใบสั่งผลิตใช้สูตรนี้อยู่ (ปิดการใช้งานแทนได้)' })
    }
    const result = await pool.query('DELETE FROM formula WHERE id = $1 RETURNING id', [id])
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบสูตร' })
    }
    res.json({ message: 'ลบสูตรสำเร็จ' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

module.exports = {
  getFormulas, getFormulaById, getNextStdCode,
  createFormula, updateFormula, deleteFormula,
}
