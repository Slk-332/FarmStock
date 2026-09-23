const { pool } = require('../database')
const { resolveStockLines, consumeFromStock, round2 } = require('../services/consumptionService')

/**
 * Selling Process
 *
 * ใบขายเริ่มเป็น "ร่าง" ก่อน — ยังไม่แตะสต๊อก แก้ไขได้ตามใจ
 * กดยืนยันขายถึงจะหักของจริงตาม FIFO แล้วรู้ต้นทุนจริง → กำไรของรอบนั้น
 *
 * ต้นทุนถูกบันทึกไว้กับใบขาย ไม่คำนวณสดจาก ave_cost ปัจจุบัน
 * เพราะถ้าคำนวณสด กำไรของเดือนที่แล้วจะเปลี่ยนไปเรื่อย ๆ ทุกครั้งที่ราคาของเปลี่ยน
 */

const round4 = (n) => Math.round(Number(n) * 10000) / 10000

const validateLines = (lines) => {
  if (!Array.isArray(lines) || lines.length === 0) return 'ต้องมีรายการขายอย่างน้อย 1 รายการ'
  for (const [i, line] of lines.entries()) {
    const where = `รายการที่ ${i + 1}`
    if (!line.product_id) return `${where}: ยังไม่ได้เลือกสินค้า`
    if (!line.unit_code)  return `${where}: ยังไม่ได้เลือกหน่วย`
    if (!(Number(line.qty) > 0)) return `${where}: จำนวนต้องมากกว่า 0`
    if (Number(line.unit_price) < 0) return `${where}: ราคาขายติดลบไม่ได้`
  }
  return null
}

const priceLines = (lines) =>
  lines.map((line, i) => {
    const qty = Number(line.qty)
    const unitPrice = Number(line.unit_price) || 0
    return {
      seq:         Number(line.seq) || i + 1,
      product_id:  line.product_id,
      qty:         round4(qty),
      unit_code:   line.unit_code,
      unit_price:  unitPrice,
      total_price: round2(qty * unitPrice),
      note:        line.note || null,
    }
  })

const getSales = async (req, res) => {
  try {
    const { search, status, from, to } = req.query
    let query = `
      SELECT s.*, u.full_name AS created_by_name,
             COUNT(sl.id)::int AS line_count
      FROM sale s
      LEFT JOIN users u ON u.id = s.created_by
      LEFT JOIN sale_line sl ON sl.sale_id = s.id
      WHERE 1=1`
    const params = []

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (s.sale_no ILIKE $${params.length} OR s.customer ILIKE $${params.length})`
    }
    if (status) {
      params.push(status)
      query += ` AND s.status = $${params.length}`
    }
    if (from) {
      params.push(from)
      query += ` AND s.sale_date >= $${params.length}`
    }
    if (to) {
      params.push(to)
      query += ` AND s.sale_date <= $${params.length}`
    }

    query += ' GROUP BY s.id, u.full_name ORDER BY s.sale_date DESC, s.id DESC'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getSaleById = async (req, res) => {
  try {
    const sale = await pool.query(
      `SELECT s.*, u.full_name AS created_by_name
       FROM sale s LEFT JOIN users u ON u.id = s.created_by
       WHERE s.id = $1`,
      [req.params.id]
    )
    if (sale.rows.length === 0) return res.status(404).json({ message: 'ไม่พบรายการขาย' })

    const lines = await pool.query(
      `SELECT sl.*, p.mat_uid, p.name AS product_name, p.stock_unit,
              un.name AS unit_name
       FROM sale_line sl
       JOIN product p ON p.id = sl.product_id
       LEFT JOIN unit un ON un.code = sl.unit_code
       WHERE sl.sale_id = $1
       ORDER BY sl.seq ASC, sl.id ASC`,
      [req.params.id]
    )

    // ชิ้นที่ถูกหักไปจริง — มีเฉพาะใบที่ยืนยันขายแล้ว
    const items = await pool.query(
      `SELECT sli.*, i.item_id AS item_code, l.lot_no, un.name AS unit_name
       FROM sale_line_item sli
       JOIN sale_line sl ON sl.id = sli.sale_line_id
       JOIN item i ON i.id = sli.item_id
       JOIN lot l  ON l.id = i.lot_id
       LEFT JOIN unit un ON un.code = sli.unit_code
       WHERE sl.sale_id = $1
       ORDER BY sli.id ASC`,
      [req.params.id]
    )

    const byLine = new Map()
    for (const it of items.rows) {
      if (!byLine.has(it.sale_line_id)) byLine.set(it.sale_line_id, [])
      byLine.get(it.sale_line_id).push(it)
    }

    res.json({
      ...sale.rows[0],
      lines: lines.rows.map(l => ({ ...l, items: byLine.get(l.id) || [] })),
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getNextSaleNo = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(SUBSTRING(sale_no FROM 3)::bigint), 0) AS last
       FROM sale WHERE sale_no ~ '^SO[0-9]+$'`
    )
    res.json({ sale_no: `SO${String(Number(rows[0].last) + 1).padStart(6, '0')}` })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const createSale = async (req, res) => {
  const { sale_no, sale_date, customer, note, lines } = req.body

  const lineError = validateLines(lines)
  if (lineError) return res.status(400).json({ message: lineError })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    let no = sale_no
    if (!no) {
      const { rows } = await client.query(
        `SELECT COALESCE(MAX(SUBSTRING(sale_no FROM 3)::bigint), 0) AS last
         FROM sale WHERE sale_no ~ '^SO[0-9]+$'`
      )
      no = `SO${String(Number(rows[0].last) + 1).padStart(6, '0')}`
    }

    const priced = priceLines(lines)
    const total = round2(priced.reduce((s, l) => s + l.total_price, 0))

    const saleResult = await client.query(
      `INSERT INTO sale (sale_no, sale_date, customer, total_amount, note, created_by)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6) RETURNING *`,
      [no, sale_date || null, customer || null, total, note || null, req.user.id]
    )
    const sale = saleResult.rows[0]

    for (const line of priced) {
      await client.query(
        `INSERT INTO sale_line (sale_id, seq, product_id, qty, unit_code, unit_price, total_price, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [sale.id, line.seq, line.product_id, line.qty, line.unit_code,
         line.unit_price, line.total_price, line.note]
      )
    }

    await client.query('COMMIT')
    res.status(201).json(sale)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    if (err.code === '23505') return res.status(400).json({ message: 'เลขที่ใบขายนี้มีอยู่แล้ว' })
    res.status(500).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

const updateSale = async (req, res) => {
  const { id } = req.params
  const { sale_date, customer, note, lines } = req.body

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const current = await client.query('SELECT status FROM sale WHERE id = $1 FOR UPDATE', [id])
    if (current.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'ไม่พบรายการขาย' })
    }
    if (current.rows[0].status !== 'draft') {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'ใบขายที่ยืนยันหรือยกเลิกแล้ว แก้ไม่ได้' })
    }

    let total = null
    if (lines) {
      const lineError = validateLines(lines)
      if (lineError) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: lineError })
      }
      const priced = priceLines(lines)
      total = round2(priced.reduce((s, l) => s + l.total_price, 0))

      await client.query('DELETE FROM sale_line WHERE sale_id = $1', [id])
      for (const line of priced) {
        await client.query(
          `INSERT INTO sale_line (sale_id, seq, product_id, qty, unit_code, unit_price, total_price, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, line.seq, line.product_id, line.qty, line.unit_code,
           line.unit_price, line.total_price, line.note]
        )
      }
    }

    const result = await client.query(
      `UPDATE sale
       SET sale_date    = COALESCE($1, sale_date),
           customer     = COALESCE($2, customer),
           note         = COALESCE($3, note),
           total_amount = COALESCE($4, total_amount),
           updated_at   = NOW()
       WHERE id = $5 RETURNING *`,
      [sale_date || null, customer ?? null, note ?? null, total, id]
    )

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

/**
 * ยืนยันการขาย — หักของจากสต๊อกตาม FIFO แล้วคิดกำไรของรอบนี้
 *
 * หักทีละบรรทัดเพื่อให้รู้ว่าต้นทุนก้อนไหนเป็นของบรรทัดไหน
 * และเพราะหักไปทีละบรรทัด ถ้าสินค้าตัวเดียวกันอยู่หลายบรรทัด
 * บรรทัดหลังจะเห็นสต๊อกที่เหลือจริงหลังบรรทัดก่อนหักไปแล้ว
 */
const confirmSale = async (req, res) => {
  const { id } = req.params

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const sale = await client.query('SELECT * FROM sale WHERE id = $1 FOR UPDATE', [id])
    if (sale.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'ไม่พบรายการขาย' })
    }
    if (sale.rows[0].status !== 'draft') {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'ใบขายนี้ยืนยันหรือยกเลิกไปแล้ว' })
    }

    const { rows: saleLines } = await client.query(
      `SELECT * FROM sale_line WHERE sale_id = $1 ORDER BY seq ASC, id ASC`, [id]
    )
    if (saleLines.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'ใบขายนี้ไม่มีรายการสินค้า' })
    }

    let totalCost = 0
    for (const [i, saleLine] of saleLines.entries()) {
      const stockLines = await resolveStockLines(client, [{
        product_id: saleLine.product_id,
        qty:        Number(saleLine.qty),
        unit_code:  saleLine.unit_code,
        label:      `รายการที่ ${i + 1}`,
      }])

      const short = stockLines.filter((l) => l.shortage > 0)
      if (short.length > 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({
          message: 'ของในสต๊อกไม่พอขาย',
          shortages: short.map((l) => ({
            product_name: l.product_name,
            required: l.required_qty,
            available: l.available_qty,
            shortage: l.shortage,
            unit: l.required_unit_name,
          })),
        })
      }

      const { totalCost: lineCost } = await consumeFromStock(client, {
        lines: stockLines,
        onConsume: async (row) => {
          const result = await client.query(
            `INSERT INTO sale_line_item (sale_line_id, item_id, qty, unit_code, cost)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [saleLine.id, row.item_id, row.qty, row.unit_code, row.cost]
          )
          return result.rows[0]
        },
      })

      await client.query(
        'UPDATE sale_line SET total_cost = $1 WHERE id = $2', [lineCost, saleLine.id]
      )
      totalCost += lineCost
    }

    const amount = Number(sale.rows[0].total_amount)
    const cost = round2(totalCost)
    const updated = await client.query(
      `UPDATE sale
       SET status = 'confirmed', total_cost = $1, profit = $2,
           confirmed_at = NOW(), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [cost, round2(amount - cost), id]
    )

    await client.query('COMMIT')
    res.json(updated.rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(400).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

const cancelSale = async (req, res) => {
  try {
    const current = await pool.query('SELECT status FROM sale WHERE id = $1', [req.params.id])
    if (current.rows.length === 0) return res.status(404).json({ message: 'ไม่พบรายการขาย' })
    if (current.rows[0].status === 'confirmed') {
      return res.status(400).json({
        message: 'ยืนยันขายไปแล้ว ยกเลิกไม่ได้ — ของถูกหักออกจากสต๊อกแล้ว',
      })
    }

    const result = await pool.query(
      `UPDATE sale SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const deleteSale = async (req, res) => {
  try {
    const current = await pool.query('SELECT status FROM sale WHERE id = $1', [req.params.id])
    if (current.rows.length === 0) return res.status(404).json({ message: 'ไม่พบรายการขาย' })
    if (current.rows[0].status === 'confirmed') {
      return res.status(400).json({ message: 'ใบขายที่ยืนยันแล้วลบไม่ได้ เป็นประวัติการขาย' })
    }
    await pool.query('DELETE FROM sale WHERE id = $1', [req.params.id])
    res.json({ message: 'ลบใบขายสำเร็จ' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

/** สรุปยอดขายและกำไรในช่วงเวลา — นับเฉพาะใบที่ยืนยันแล้ว */
const getSalesSummary = async (req, res) => {
  try {
    const { from, to } = req.query
    const params = []
    let where = `WHERE s.status = 'confirmed'`
    if (from) {
      params.push(from)
      where += ` AND s.sale_date >= $${params.length}`
    }
    if (to) {
      params.push(to)
      where += ` AND s.sale_date <= $${params.length}`
    }

    const totals = await pool.query(
      `SELECT COUNT(*)::int AS sale_count,
              COALESCE(SUM(s.total_amount), 0) AS total_amount,
              COALESCE(SUM(s.total_cost), 0)   AS total_cost,
              COALESCE(SUM(s.profit), 0)       AS profit
       FROM sale s ${where}`,
      params
    )

    const byProduct = await pool.query(
      `SELECT p.id AS product_id, p.mat_uid, p.name AS product_name,
              SUM(sl.qty)         AS qty_sold,
              SUM(sl.total_price) AS amount,
              SUM(sl.total_cost)  AS cost,
              SUM(sl.total_price - sl.total_cost) AS profit
       FROM sale_line sl
       JOIN sale s    ON s.id = sl.sale_id
       JOIN product p ON p.id = sl.product_id
       ${where}
       GROUP BY p.id, p.mat_uid, p.name
       ORDER BY profit DESC`,
      params
    )

    const byMonth = await pool.query(
      `SELECT TO_CHAR(s.sale_date, 'YYYY-MM') AS month,
              SUM(s.total_amount) AS amount,
              SUM(s.total_cost)   AS cost,
              SUM(s.profit)       AS profit
       FROM sale s ${where}
       GROUP BY month ORDER BY month ASC`,
      params
    )

    res.json({
      ...totals.rows[0],
      by_product: byProduct.rows,
      by_month: byMonth.rows,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

module.exports = {
  getSales, getSaleById, getNextSaleNo, getSalesSummary,
  createSale, updateSale, confirmSale, cancelSale, deleteSale,
}
