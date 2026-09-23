const { pool } = require('../database')
const { nextDocNo } = require('../services/stockService')

const STATUSES = ['draft', 'ordered', 'partial', 'received', 'cancelled']

/** รวมยอดเงินของแต่ละบรรทัด แล้วคืนทั้งบรรทัดที่คำนวณแล้วและยอดรวมของใบ */
const priceLines = (lines) =>
  lines.map((line, i) => {
    const qty = Number(line.qty)
    const unitPrice = Number(line.unit_price) || 0
    return {
      seq:         Number(line.seq) || i + 1,
      product_id:  line.product_id,
      qty,
      unit_code:   line.unit_code,
      unit_price:  unitPrice,
      // ปัดที่นี่ที่เดียว ไม่ให้ยอดรวมกับยอดต่อบรรทัดเพี้ยนกันเพราะปัดคนละรอบ
      total_price: Math.round(qty * unitPrice * 100) / 100,
      note:        line.note || null,
    }
  })

/** ตรวจความถูกต้องของบรรทัดก่อนแตะฐานข้อมูล — คืนข้อความ error ตัวแรกที่เจอ หรือ null */
const validateLines = (lines) => {
  if (!Array.isArray(lines) || lines.length === 0) return 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ'
  for (const [i, line] of lines.entries()) {
    const where = `รายการที่ ${i + 1}`
    if (!line.product_id) return `${where}: ยังไม่ได้เลือกสินค้า`
    if (!line.unit_code)  return `${where}: ยังไม่ได้เลือกหน่วย`
    const qty = Number(line.qty)
    if (!Number.isFinite(qty) || qty <= 0) return `${where}: จำนวนต้องมากกว่า 0`
    const price = Number(line.unit_price)
    if (line.unit_price != null && line.unit_price !== '' && (!Number.isFinite(price) || price < 0)) {
      return `${where}: ราคาต่อหน่วยไม่ถูกต้อง`
    }
  }
  return null
}

const getOrders = async (req, res) => {
  try {
    const { search, status, from, to } = req.query
    let query = `
      SELECT o.*,
             u.full_name AS created_by_name,
             COUNT(ol.id)::int AS line_count,
             COALESCE(SUM(ol.qty), 0)          AS qty_ordered,
             COALESCE(SUM(ol.qty_received), 0) AS qty_received
      FROM purchase_order o
      LEFT JOIN users u ON u.id = o.created_by
      LEFT JOIN purchase_order_line ol ON ol.order_id = o.id
      WHERE 1=1`
    const params = []

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (o.order_code ILIKE $${params.length} OR o.supplier ILIKE $${params.length})`
    }
    if (status) {
      params.push(status)
      query += ` AND o.status = $${params.length}`
    }
    if (from) {
      params.push(from)
      query += ` AND o.order_date >= $${params.length}`
    }
    if (to) {
      params.push(to)
      query += ` AND o.order_date <= $${params.length}`
    }

    query += ` GROUP BY o.id, u.full_name ORDER BY o.order_date DESC, o.id DESC`
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getOrderById = async (req, res) => {
  try {
    const order = await pool.query(
      `SELECT o.*, u.full_name AS created_by_name
       FROM purchase_order o
       LEFT JOIN users u ON u.id = o.created_by
       WHERE o.id = $1`,
      [req.params.id]
    )
    if (order.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบใบสั่งซื้อ' })
    }

    const lines = await pool.query(
      `SELECT ol.*, p.mat_uid, p.name AS product_name, p.stock_unit,
              un.name AS unit_name
       FROM purchase_order_line ol
       JOIN product p ON p.id = ol.product_id
       LEFT JOIN unit un ON un.code = ol.unit_code
       WHERE ol.order_id = $1
       ORDER BY ol.seq ASC, ol.id ASC`,
      [req.params.id]
    )

    const attachments = await pool.query(
      `SELECT a.*, u.full_name AS uploaded_by_name
       FROM attachment a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.ref_type = 'purchase_order' AND a.ref_id = $1
       ORDER BY a.created_at DESC`,
      [req.params.id]
    )

    res.json({ ...order.rows[0], lines: lines.rows, attachments: attachments.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

/** เลขใบสั่งซื้อถัดไป ให้หน้าจอเอาไปแสดงตอนเปิดฟอร์ม */
const getNextOrderCode = async (req, res) => {
  const client = await pool.connect()
  try {
    res.json({ order_code: await nextDocNo(client, 'purchase_order') })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

const createOrder = async (req, res) => {
  const { order_code, order_date, supplier, status, note, lines } = req.body

  const lineError = validateLines(lines)
  if (lineError) return res.status(400).json({ message: lineError })
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ message: `สถานะต้องเป็น ${STATUSES.join(' / ')}` })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // ออกเลขในทรานแซกชันเดียวกับการ insert — ถ้าสองคนกดพร้อมกัน unique constraint จะกันเลขซ้ำให้
    const code = order_code || (await nextDocNo(client, 'purchase_order'))
    const priced = priceLines(lines)
    const total = priced.reduce((sum, l) => sum + l.total_price, 0)

    const orderResult = await client.query(
      `INSERT INTO purchase_order (order_code, order_date, supplier, status, total_amount, note, created_by)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7) RETURNING *`,
      [
        code, order_date || null, supplier || null,
        status || 'draft', Math.round(total * 100) / 100, note || null, req.user.id,
      ]
    )
    const order = orderResult.rows[0]

    for (const line of priced) {
      await client.query(
        `INSERT INTO purchase_order_line
           (order_id, seq, product_id, qty, unit_code, unit_price, total_price, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [order.id, line.seq, line.product_id, line.qty, line.unit_code,
         line.unit_price, line.total_price, line.note]
      )
    }

    await client.query('COMMIT')
    res.status(201).json(order)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    if (err.code === '23505') {
      return res.status(400).json({ message: 'เลขที่ใบสั่งซื้อนี้มีอยู่แล้ว' })
    }
    res.status(500).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

const updateOrder = async (req, res) => {
  const { id } = req.params
  const { order_date, supplier, note, lines } = req.body

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const current = await client.query(
      'SELECT status FROM purchase_order WHERE id = $1 FOR UPDATE', [id]
    )
    if (current.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'ไม่พบใบสั่งซื้อ' })
    }
    // รับของไปแล้วห้ามแก้รายการ ไม่งั้นยอดที่รับมาจะไม่ตรงกับที่สั่ง
    if (lines && !['draft', 'ordered'].includes(current.rows[0].status)) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'ใบสั่งซื้อที่รับของแล้วหรือถูกยกเลิก แก้รายการไม่ได้' })
    }

    let total = null
    if (lines) {
      const lineError = validateLines(lines)
      if (lineError) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: lineError })
      }
      const priced = priceLines(lines)
      total = Math.round(priced.reduce((sum, l) => sum + l.total_price, 0) * 100) / 100

      await client.query('DELETE FROM purchase_order_line WHERE order_id = $1', [id])
      for (const line of priced) {
        await client.query(
          `INSERT INTO purchase_order_line
             (order_id, seq, product_id, qty, unit_code, unit_price, total_price, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, line.seq, line.product_id, line.qty, line.unit_code,
           line.unit_price, line.total_price, line.note]
        )
      }
    }

    const result = await client.query(
      `UPDATE purchase_order
       SET order_date   = COALESCE($1, order_date),
           supplier     = COALESCE($2, supplier),
           note         = COALESCE($3, note),
           total_amount = COALESCE($4, total_amount),
           updated_at   = NOW()
       WHERE id = $5 RETURNING *`,
      [order_date || null, supplier ?? null, note ?? null, total, id]
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

/** เปลี่ยนสถานะใบสั่งซื้อด้วยมือ (กดสั่งซื้อ / ยกเลิก) — partial กับ received ระบบตั้งให้เองตอนรับของ */
const updateOrderStatus = async (req, res) => {
  const { id } = req.params
  const { status } = req.body

  if (!['draft', 'ordered', 'cancelled'].includes(status)) {
    return res.status(400).json({ message: 'เปลี่ยนเป็นสถานะนี้ด้วยมือไม่ได้' })
  }

  try {
    const current = await pool.query('SELECT status FROM purchase_order WHERE id = $1', [id])
    if (current.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบใบสั่งซื้อ' })
    }
    if (['partial', 'received'].includes(current.rows[0].status)) {
      return res.status(400).json({ message: 'ใบสั่งซื้อที่เริ่มรับของแล้ว เปลี่ยนสถานะด้วยมือไม่ได้' })
    }

    const result = await pool.query(
      `UPDATE purchase_order SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const deleteOrder = async (req, res) => {
  const { id } = req.params
  try {
    const receipts = await pool.query(
      'SELECT 1 FROM goods_receipt WHERE order_id = $1 LIMIT 1', [id]
    )
    if (receipts.rows.length > 0) {
      return res.status(400).json({ message: 'ลบไม่ได้ เพราะมีใบรับของอ้างถึงใบสั่งซื้อนี้อยู่ (ยกเลิกแทนได้)' })
    }

    const result = await pool.query('DELETE FROM purchase_order WHERE id = $1 RETURNING id', [id])
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบใบสั่งซื้อ' })
    }
    // บรรทัดในใบถูกลบตาม ON DELETE CASCADE แต่ไฟล์แนบไม่มี FK จึงต้องเก็บกวาดเอง
    await pool.query(
      `DELETE FROM attachment WHERE ref_type = 'purchase_order' AND ref_id = $1`, [id]
    )
    res.json({ message: 'ลบใบสั่งซื้อสำเร็จ' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

module.exports = {
  getOrders, getOrderById, getNextOrderCode,
  createOrder, updateOrder, updateOrderStatus, deleteOrder,
}
