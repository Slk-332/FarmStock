const { pool } = require('../database')

// สรุปภาพรวม Dashboard Report
const getSummary = async (req, res) => {
  try {
    // เบิกจ่ายวันนี้
    const todayDispense = await pool.query(`
      SELECT p.name AS product_name, COUNT(*) AS qty
      FROM dispense d
      JOIN item i ON d.item_id = i.id
      JOIN lot l ON i.lot_id = l.id
      JOIN product p ON l.product_id = p.id
      WHERE DATE(d.dispensed_at) = CURRENT_DATE
      GROUP BY p.name ORDER BY qty DESC
    `)

    // รับเข้าวันนี้
    const todayStockIn = await pool.query(`
      SELECT p.name AS product_name, SUM(l.qty_received) AS qty
      FROM lot l JOIN product p ON l.product_id = p.id
      WHERE DATE(l.created_at) = CURRENT_DATE
      GROUP BY p.name ORDER BY qty DESC
    `)

    // แจ้งเตือน
    const alerts = await pool.query(`
      SELECT mat_uid, name, total_stock, max_stock, min_stock, stock_status
      FROM v_stock_summary
      WHERE stock_status IN ('out','low','full')
      ORDER BY stock_status ASC
    `)

    // เบิกจ่ายล่าสุด
    const recentDispense = await pool.query(`
      SELECT d.dispensed_at, i.item_id, l.lot_no,
             p.name AS product_name, d.cost_per_piece
      FROM dispense d
      JOIN item i ON d.item_id = i.id
      JOIN lot l ON i.lot_id = l.id
      JOIN product p ON l.product_id = p.id
      ORDER BY d.dispensed_at DESC LIMIT 10
    `)

    // สินค้าพร้อมใช้
    const stockReady = await pool.query(`
      SELECT * FROM v_stock_summary ORDER BY name ASC
    `)

    const totalDispense = await pool.query(`
      SELECT
      COALESCE(SUM(total_cost), 0)::numeric AS total_all,
      COALESCE(SUM(CASE WHEN DATE_TRUNC('month', dispensed_at) = DATE_TRUNC('month', NOW())
      THEN total_cost END), 0)::numeric AS total_month,
      COALESCE(SUM(CASE WHEN DATE(dispensed_at) = CURRENT_DATE
      THEN total_cost END), 0)::numeric AS total_today
      FROM dispense
      WHERE status != 'cancelled'
    `)
    // ยอดรวมแยกตามสินค้า
    const totalByProduct = await pool.query(`
      SELECT
      p.name AS product_name,
      p.mat_uid,
      COUNT(d.id)::int               AS total_qty,
      COALESCE(SUM(d.total_cost), 0) AS total_cost
      FROM dispense d
      JOIN item i    ON d.item_id    = i.id
      JOIN lot l     ON i.lot_id     = l.id
      JOIN product p ON l.product_id = p.id
      WHERE d.status != 'cancelled'
      GROUP BY p.name, p.mat_uid
      ORDER BY total_cost DESC
     `)

    // มูลค่า stock คงเหลือ
    const stockValue = await pool.query(`
      SELECT COALESCE(SUM(qty_remaining * cost), 0)::numeric AS total_stock_value
      FROM lot WHERE status = 'active'
    `)

    res.json({
      today_dispense: todayDispense.rows,
      today_stock_in: todayStockIn.rows,
      alerts:         alerts.rows,
      recent_dispense:recentDispense.rows,
      stock_ready:    stockReady.rows,
      total_dispense:  totalDispense.rows[0],  
      total_by_product: totalByProduct.rows,     
      stock_value:      stockValue.rows[0],
    })



  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

// รายงานเบิกจ่าย
const getDispenseReport = async (req, res) => {
  try {
    const { search, from, to } = req.query
    let query = `
      SELECT d.*, i.item_id, l.lot_no, l.mfg_date, l.exp_date,
             p.name AS product_name, p.mat_uid,
             pg.name AS group_name, u.full_name AS dispensed_by
      FROM dispense d
      JOIN item i ON d.item_id = i.id
      JOIN lot l ON i.lot_id = l.id
      JOIN product p ON l.product_id = p.id
      LEFT JOIN product_group pg ON p.group_id = pg.id
      JOIN users u ON d.user_id = u.id
      WHERE 1=1`
    const params = []
    let idx = 1

    if (search) {
      query += ` AND (i.item_id ILIKE $${idx} OR l.lot_no ILIKE $${idx}
                 OR p.name ILIKE $${idx} OR p.mat_uid ILIKE $${idx}
                 OR pg.name ILIKE $${idx})`
      params.push(`%${search}%`)
      idx++
    }
    if (from) { query += ` AND d.dispensed_at >= $${idx}`; params.push(from); idx++ }
    if (to)   { query += ` AND d.dispensed_at <= $${idx}`; params.push(to);   idx++ }

    query += ` ORDER BY d.dispensed_at DESC`
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

// รายงานรับเข้า Stock
const getStockInReport = async (req, res) => {
  try {
    const { search, from, to } = req.query
    let query = `SELECT * FROM v_lot_detail WHERE 1=1`
    const params = []
    let idx = 1

    if (search) {
      query += ` AND (lot_no ILIKE $${idx} OR mat_uid ILIKE $${idx}
                 OR product_name ILIKE $${idx} OR group_name ILIKE $${idx})`
      params.push(`%${search}%`)
      idx++
    }
    if (from) { query += ` AND created_at >= $${idx}`; params.push(from); idx++ }
    if (to)   { query += ` AND created_at <= $${idx}`; params.push(to);   idx++ }

    query += ` ORDER BY created_at DESC`
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

// รายงานสินค้าต้องเติม
const getLowStockReport = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM v_stock_summary
      WHERE stock_status IN ('out','low')
      ORDER BY total_stock ASC
    `)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

// รายงานใกล้หมดอายุ
const getExpireReport = async (req, res) => {
  try {
    // auto expire ก่อน
    await pool.query('SELECT auto_expire_lots()')

    const result = await pool.query(`
      SELECT * FROM v_lot_detail
      WHERE status = 'active' OR status = 'expired'
      ORDER BY days_remaining ASC
    `)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getWeeklyDispense = async (req, res) => {
  try {
    const { from, to } = req.query
    const startDate = from || new Date(Date.now() - 6 * 86400000).toISOString().slice(0,10)
    const endDate   = to   || new Date().toISOString().slice(0,10)

    const result = await pool.query(`
      SELECT
        DATE(d.dispensed_at)    AS date,
        p.name                  AS product_name,
        p.mat_uid,
        COUNT(*)::int           AS qty
      FROM dispense d
      JOIN item i    ON d.item_id    = i.id
      JOIN lot l     ON i.lot_id     = l.id
      JOIN product p ON l.product_id = p.id
      WHERE DATE(d.dispensed_at) BETWEEN $1 AND $2
        AND d.status != 'cancelled'
      GROUP BY DATE(d.dispensed_at), p.name, p.mat_uid
      ORDER BY date ASC, qty DESC
    `, [startDate, endDate])

    res.json({ data: result.rows, from: startDate, to: endDate })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

/* ---------- Dashboard (แบบ GTF SYSTEMS) ---------- */

// เวลาในฐานข้อมูลเก็บเป็น UTC แบบไม่มี timezone — แปลงเป็นเวลาไทยก่อนตัดเป็น "วัน"
// ไม่งั้นรายการตอนตี 1 ของไทยจะไปนับเป็นเมื่อวาน
const TH = (col) => `((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')`
const TODAY_TH = `(NOW() AT TIME ZONE 'Asia/Bangkok')::date`

/** % เปลี่ยนแปลงเทียบช่วงก่อน — ช่วงก่อนเป็น 0 ถือว่าเทียบไม่ได้ (คืน null ให้หน้าจอไม่ต้องโชว์) */
const pctChange = (current, previous) => {
  const cur = Number(current)
  const prev = Number(previous)
  if (!prev) return null
  return Math.round(((cur - prev) / prev) * 1000) / 10
}

const getDashboard = async (req, res) => {
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 7))
  try {
    const [totals, daily, alerts, todayDispense, todayReceive, recent, stock] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(total_cost), 0) AS total_all,
          COALESCE(SUM(total_cost) FILTER (WHERE DATE_TRUNC('month', ${TH('dispensed_at')}) = DATE_TRUNC('month', ${TODAY_TH})), 0) AS total_month,
          COALESCE(SUM(total_cost) FILTER (WHERE DATE_TRUNC('month', ${TH('dispensed_at')}) = DATE_TRUNC('month', ${TODAY_TH} - INTERVAL '1 month')), 0) AS total_last_month,
          COALESCE(SUM(total_cost) FILTER (WHERE ${TH('dispensed_at')}::date = ${TODAY_TH}), 0) AS total_today,
          COALESCE(SUM(total_cost) FILTER (WHERE ${TH('dispensed_at')}::date = ${TODAY_TH} - 1), 0) AS total_yesterday,
          (SELECT COALESCE(SUM(qty_remaining * cost), 0) FROM lot WHERE status = 'active') AS stock_value
        FROM dispense WHERE status != 'cancelled'`),

      // ทุกวันในช่วง แม้วันที่ไม่มีการเบิก (เป็น 0) กราฟจะได้ไม่กระโดดข้ามวัน
      pool.query(`
        SELECT g.day::date AS date, COALESCE(SUM(d.total_cost), 0) AS total, COUNT(d.id)::int AS qty
        FROM generate_series(${TODAY_TH} - ($1::int - 1), ${TODAY_TH}, INTERVAL '1 day') AS g(day)
        LEFT JOIN dispense d ON ${TH('d.dispensed_at')}::date = g.day::date AND d.status != 'cancelled'
        GROUP BY g.day ORDER BY g.day`, [days]),

      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM v_stock_summary v JOIN product p ON p.id = v.product_id
            WHERE p.is_active AND v.stock_status IN ('out', 'low'))::int AS low_stock,
          (SELECT COUNT(*) FROM lot WHERE status = 'active' AND qty_remaining > 0
            AND exp_date BETWEEN ${TODAY_TH} AND ${TODAY_TH} + 30)::int AS expiring,
          (SELECT COUNT(*) FROM lot WHERE ${TH('created_at')}::date = ${TODAY_TH})::int AS received_today,
          (SELECT COUNT(*) FROM purchase_order WHERE status IN ('ordered', 'partial'))::int AS po_waiting`),

      pool.query(`
        SELECT p.mat_uid, p.name AS product_name, su.name AS unit_name, u.full_name AS user_name,
               SUM(d.qty_dispensed)::int AS qty, MAX(${TH('d.dispensed_at')}) AS last_at
        FROM dispense d
        JOIN item i ON i.id = d.item_id
        JOIN lot l ON l.id = i.lot_id
        JOIN product p ON p.id = l.product_id
        LEFT JOIN unit su ON su.code = p.stock_unit
        LEFT JOIN users u ON u.id = d.user_id
        WHERE d.status != 'cancelled' AND ${TH('d.dispensed_at')}::date = ${TODAY_TH}
        GROUP BY p.mat_uid, p.name, su.name, u.full_name
        ORDER BY last_at DESC`),

      pool.query(`
        SELECT p.mat_uid, p.name AS product_name, su.name AS unit_name, SUM(l.qty_received)::int AS qty
        FROM lot l
        JOIN product p ON p.id = l.product_id
        LEFT JOIN unit su ON su.code = p.stock_unit
        WHERE ${TH('l.created_at')}::date = ${TODAY_TH}
        GROUP BY p.mat_uid, p.name, su.name
        ORDER BY p.mat_uid`),

      pool.query(`
        SELECT ${TH('d.dispensed_at')} AS dispensed_at, p.mat_uid, p.name AS product_name,
               d.qty_dispensed AS qty, su.name AS unit_name, u.full_name AS user_name, d.status
        FROM dispense d
        JOIN item i ON i.id = d.item_id
        JOIN lot l ON l.id = i.lot_id
        JOIN product p ON p.id = l.product_id
        LEFT JOIN unit su ON su.code = p.stock_unit
        LEFT JOIN users u ON u.id = d.user_id
        ORDER BY d.dispensed_at DESC LIMIT 8`),

      // สินค้าที่ต้องจับตา (หมด/ต่ำ) ขึ้นก่อน แล้วค่อยเรียงตามชื่อ
      pool.query(`
        SELECT v.mat_uid, v.name, v.total_stock, v.max_stock, v.min_stock, v.stock_status, su.name AS unit_name
        FROM v_stock_summary v
        JOIN product p ON p.id = v.product_id
        LEFT JOIN unit su ON su.code = p.stock_unit
        WHERE p.is_active
        ORDER BY CASE v.stock_status WHEN 'out' THEN 0 WHEN 'low' THEN 1 WHEN 'full' THEN 2 ELSE 3 END, v.name
        LIMIT 8`),
    ])

    const t = totals.rows[0]
    res.json({
      cards: {
        total_all:   Number(t.total_all),
        total_month: Number(t.total_month),
        month_change: pctChange(t.total_month, t.total_last_month),
        total_today: Number(t.total_today),
        today_change: pctChange(t.total_today, t.total_yesterday),
        stock_value: Number(t.stock_value),
      },
      daily:          daily.rows.map((r) => ({ date: r.date, total: Number(r.total), qty: r.qty })),
      alerts:         alerts.rows[0],
      today_dispense: todayDispense.rows,
      today_receive:  todayReceive.rows,
      recent_dispense: recent.rows,
      stock:          stock.rows,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

module.exports = {
  getDashboard,
  getSummary,
  getDispenseReport,
  getStockInReport,
  getLowStockReport,
  getExpireReport,
  getWeeklyDispense,
}
