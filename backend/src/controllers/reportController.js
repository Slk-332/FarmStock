const pool = require('../database')

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



module.exports = {
  getSummary,
  getDispenseReport,
  getStockInReport,
  getLowStockReport,
  getExpireReport,
  getWeeklyDispense,
}