const { pool } = require('../database')
const { nextDocNo, createLotWithItems } = require('../services/stockService')

/**
 * การรับของเข้า Stock
 *
 * นี่คือจุดที่ Order Process ต่อเข้ากับสต๊อกเดิม: รับของ 1 บรรทัด = สร้าง lot 1 ก้อน
 * พร้อม item รายชิ้นตามจำนวน แล้วให้ recalculate_ave_cost คำนวณต้นทุนเฉลี่ยใหม่
 * ทั้งใบรับอยู่ใน transaction เดียว — รับ 5 รายการแล้วพังรายการที่ 3 จะไม่เหลือของค้างครึ่ง ๆ กลาง ๆ
 */

const getReceipts = async (req, res) => {
  try {
    const { search, order_id, from, to } = req.query
    let query = `
      SELECT r.*,
             o.order_code,
             u.full_name AS created_by_name,
             COUNT(rl.id)::int          AS line_count,
             COALESCE(SUM(rl.qty), 0)   AS total_qty,
             COALESCE(SUM(rl.total_price), 0) AS total_amount
      FROM goods_receipt r
      LEFT JOIN purchase_order o ON o.id = r.order_id
      LEFT JOIN users u ON u.id = r.created_by
      LEFT JOIN goods_receipt_line rl ON rl.receipt_id = r.id
      WHERE 1=1`
    const params = []

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (r.receipt_no ILIKE $${params.length} OR r.supplier ILIKE $${params.length}
                 OR o.order_code ILIKE $${params.length})`
    }
    if (order_id) {
      params.push(order_id)
      query += ` AND r.order_id = $${params.length}`
    }
    if (from) {
      params.push(from)
      query += ` AND r.receipt_date >= $${params.length}`
    }
    if (to) {
      params.push(to)
      query += ` AND r.receipt_date <= $${params.length}`
    }

    query += ` GROUP BY r.id, o.order_code, u.full_name ORDER BY r.receipt_date DESC, r.id DESC`
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getReceiptById = async (req, res) => {
  try {
    const receipt = await pool.query(
      `SELECT r.*, o.order_code, u.full_name AS created_by_name
       FROM goods_receipt r
       LEFT JOIN purchase_order o ON o.id = r.order_id
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.id = $1`,
      [req.params.id]
    )
    if (receipt.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบใบรับของ' })
    }

    const lines = await pool.query(
      `SELECT rl.*, p.mat_uid, p.name AS product_name,
              l.lot_no, l.mfg_date, l.exp_date, l.qty_remaining,
              un.name AS unit_name
       FROM goods_receipt_line rl
       JOIN product p ON p.id = rl.product_id
       JOIN lot l     ON l.id = rl.lot_id
       LEFT JOIN unit un ON un.code = rl.unit_code
       WHERE rl.receipt_id = $1
       ORDER BY rl.id ASC`,
      [req.params.id]
    )

    const attachments = await pool.query(
      `SELECT a.*, u.full_name AS uploaded_by_name
       FROM attachment a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.ref_type = 'goods_receipt' AND a.ref_id = $1
       ORDER BY a.created_at DESC`,
      [req.params.id]
    )

    res.json({ ...receipt.rows[0], lines: lines.rows, attachments: attachments.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getNextReceiptNo = async (req, res) => {
  const client = await pool.connect()
  try {
    res.json({ receipt_no: await nextDocNo(client, 'goods_receipt') })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

/**
 * ปรับสถานะใบสั่งซื้อตามยอดที่รับไปแล้ว
 * รับครบทุกบรรทัด = received, รับไปบ้าง = partial, ยังไม่รับเลย = ปล่อยไว้อย่างเดิม
 */
async function syncOrderStatus(client, orderId) {
  const { rows } = await client.query(
    `SELECT COUNT(*) FILTER (WHERE qty_received < qty)::int AS pending,
            COUNT(*) FILTER (WHERE qty_received > 0)::int   AS started
     FROM purchase_order_line WHERE order_id = $1`,
    [orderId]
  )
  const { pending, started } = rows[0]
  const status = pending === 0 ? 'received' : started > 0 ? 'partial' : null
  if (!status) return

  await client.query(
    `UPDATE purchase_order SET status = $1, updated_at = NOW()
     WHERE id = $2 AND status <> 'cancelled'`,
    [status, orderId]
  )
}

const createReceipt = async (req, res) => {
  const { receipt_no, receipt_date, order_id, supplier, note, lines } = req.body

  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: 'ต้องมีรายการรับของอย่างน้อย 1 รายการ' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (order_id) {
      const order = await client.query(
        'SELECT status FROM purchase_order WHERE id = $1 FOR UPDATE', [order_id]
      )
      if (order.rows.length === 0) {
        await client.query('ROLLBACK')
        return res.status(404).json({ message: 'ไม่พบใบสั่งซื้อที่อ้างถึง' })
      }
      if (order.rows[0].status === 'cancelled') {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: 'ใบสั่งซื้อนี้ถูกยกเลิกแล้ว รับของไม่ได้' })
      }
    }

    const receiptNo = receipt_no || (await nextDocNo(client, 'goods_receipt'))
    const receiptResult = await client.query(
      `INSERT INTO goods_receipt (receipt_no, receipt_date, order_id, supplier, note, created_by)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6) RETURNING *`,
      [receiptNo, receipt_date || null, order_id || null, supplier || null, note || null, req.user.id]
    )
    const receipt = receiptResult.rows[0]

    const createdLines = []
    for (const [i, line] of lines.entries()) {
      const where = `รายการที่ ${i + 1}`

      if (!line.product_id) throw new Error(`${where}: ยังไม่ได้เลือกสินค้า`)
      if (!line.mfg_date || !line.exp_date) throw new Error(`${where}: ต้องระบุวันผลิตและวันหมดอายุ`)

      const qty = Number(line.qty)
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error(`${where}: จำนวนต้องเป็นจำนวนเต็มบวก เพราะ 1 หน่วยนับ = QR 1 ดวง`)
      }
      const unitPrice = Number(line.unit_price) || 0
      if (unitPrice < 0) throw new Error(`${where}: ราคาต่อหน่วยติดลบไม่ได้`)

      const product = await client.query(
        'SELECT mat_uid, name, stock_unit FROM product WHERE id = $1', [line.product_id]
      )
      if (product.rows.length === 0) throw new Error(`${where}: ไม่พบสินค้าที่ระบุ`)

      // หน่วยที่รับต้องเป็นหน่วยนับของสินค้านั้น — กระสอบกับกิโลกรัมแปลงกันไม่ได้
      // และจำนวน item ที่สร้างต้องตรงกับจำนวนหน่วยที่รับพอดี
      const unitCode = line.unit_code || product.rows[0].stock_unit
      if (unitCode !== product.rows[0].stock_unit) {
        throw new Error(
          `${where}: "${product.rows[0].name}" นับเป็นหน่วย "${product.rows[0].stock_unit}" ` +
          `รับเป็นหน่วยอื่นไม่ได้`
        )
      }

      const lotNo = line.lot_no || (await nextDocNo(client, 'lot'))
      const { lot } = await createLotWithItems(client, {
        product_id: line.product_id,
        lot_no:     lotNo,
        qty,
        cost:       unitPrice,
        mfg_date:   line.mfg_date,
        exp_date:   line.exp_date,
        supplier:   line.supplier || supplier || null,
      })

      const totalPrice = Math.round(qty * unitPrice * 100) / 100
      const lineResult = await client.query(
        `INSERT INTO goods_receipt_line
           (receipt_id, order_line_id, product_id, lot_id, qty, unit_code, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [receipt.id, line.order_line_id || null, line.product_id, lot.id,
         qty, unitCode, unitPrice, totalPrice]
      )
      createdLines.push({ ...lineResult.rows[0], lot_no: lot.lot_no })

      if (line.order_line_id) {
        const updated = await client.query(
          `UPDATE purchase_order_line
           SET qty_received = qty_received + $1
           WHERE id = $2 AND order_id = $3
           RETURNING id`,
          [qty, line.order_line_id, order_id || null]
        )
        if (updated.rows.length === 0) {
          throw new Error(`${where}: รายการในใบสั่งซื้อที่อ้างถึงไม่ตรงกับใบสั่งซื้อของใบรับนี้`)
        }
      }
    }

    if (order_id) await syncOrderStatus(client, order_id)

    await client.query('COMMIT')
    res.status(201).json({ ...receipt, lines: createdLines })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    if (err.code === '23505') {
      return res.status(400).json({ message: 'เลขที่ใบรับของหรือ Lot นี้มีอยู่แล้ว' })
    }
    res.status(400).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

module.exports = { getReceipts, getReceiptById, getNextReceiptNo, createReceipt }
