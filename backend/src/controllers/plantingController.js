const crypto = require('crypto')
const { pool } = require('../database')
const { nextDocNo, createLotWithItems } = require('../services/stockService')
const { resolveStockLines, consumeFromStock, round2 } = require('../services/consumptionService')

/**
 * Planting Process — โซน/แปลง, บันทึกการดูแล, เก็บเกี่ยว
 *
 * การดูแลแต่ละครั้งหักของจากสต๊อกจริงด้วยกติกาเดียวกับการผสม
 * ต้นทุนที่หักไปสะสมอยู่กับแปลง แล้วถูกปันส่วนออกตอนเก็บเกี่ยว
 * เพื่อให้ผลผลิตที่เข้าสต๊อกมีต้นทุนจริงไปคิดกำไรต่อใน Phase 5
 */

const PLOT_STATUSES = ['preparing', 'planted', 'harvested', 'resting']

/* ============ โซน (Area) ============ */

const getAreas = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, COUNT(p.id)::int AS plot_count
       FROM area a
       LEFT JOIN plot p ON p.area_id = a.id
       GROUP BY a.id
       ORDER BY a.area_code ASC`
    )
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const createArea = async (req, res) => {
  const { area_code, name, note } = req.body
  if (!name) return res.status(400).json({ message: 'กรุณากรอกชื่อโซน' })

  try {
    let code = area_code
    if (!code) {
      const { rows } = await pool.query(
        `SELECT COALESCE(MAX(SUBSTRING(area_code FROM 5)::bigint), 0) AS last
         FROM area WHERE area_code ~ '^AREA[0-9]+$'`
      )
      code = `AREA${String(Number(rows[0].last) + 1).padStart(3, '0')}`
    }

    const result = await pool.query(
      `INSERT INTO area (area_code, name, note, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [code, name, note || null, req.user.id]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    if (err.code === '23505') return res.status(400).json({ message: 'รหัสโซนนี้มีอยู่แล้ว' })
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const updateArea = async (req, res) => {
  const { name, note, is_active } = req.body
  try {
    const result = await pool.query(
      `UPDATE area SET name = COALESCE($1, name), note = COALESCE($2, note),
                       is_active = COALESCE($3, is_active), updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [name ?? null, note ?? null, is_active ?? null, req.params.id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'ไม่พบโซน' })
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const deleteArea = async (req, res) => {
  try {
    const inUse = await pool.query('SELECT 1 FROM plot WHERE area_id = $1 LIMIT 1', [req.params.id])
    if (inUse.rows.length > 0) {
      return res.status(400).json({ message: 'ลบไม่ได้ เพราะยังมีแปลงอยู่ในโซนนี้' })
    }
    const result = await pool.query('DELETE FROM area WHERE id = $1 RETURNING id', [req.params.id])
    if (result.rows.length === 0) return res.status(404).json({ message: 'ไม่พบโซน' })
    res.json({ message: 'ลบโซนสำเร็จ' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

/* ============ แปลง (Plot) ============ */

const getPlots = async (req, res) => {
  try {
    const { area_id, status, search } = req.query
    let query = `
      SELECT p.*, a.area_code, a.name AS area_name,
             un.name AS size_unit_name,
             COALESCE(act.total_cost, 0)   AS material_cost,
             COALESCE(act.activity_count, 0)::int AS activity_count,
             COALESCE(h.harvested_cost, 0) AS allocated_cost
      FROM plot p
      JOIN area a ON a.id = p.area_id
      LEFT JOIN unit un ON un.code = p.size_unit
      LEFT JOIN (
        SELECT plot_id, SUM(total_cost) AS total_cost, COUNT(*) AS activity_count
        FROM plot_activity GROUP BY plot_id
      ) act ON act.plot_id = p.id
      LEFT JOIN (
        SELECT plot_id, SUM(cost_total) AS harvested_cost
        FROM plot_harvest GROUP BY plot_id
      ) h ON h.plot_id = p.id
      WHERE 1=1`
    const params = []

    if (area_id) {
      params.push(area_id)
      query += ` AND p.area_id = $${params.length}`
    }
    if (status) {
      params.push(status)
      query += ` AND p.status = $${params.length}`
    }
    if (search) {
      params.push(`%${search}%`)
      query += ` AND (p.plot_code ILIKE $${params.length} OR p.name ILIKE $${params.length}
                 OR p.crop ILIKE $${params.length})`
    }

    query += ' ORDER BY a.area_code ASC, p.plot_code ASC'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

/** ดึงแปลงพร้อมประวัติ — รับได้ทั้ง id และ qr_token (จากการสแกน QR ที่ติดกลางแปลง) */
const loadPlotDetail = async (where, value) => {
  const plot = await pool.query(
    `SELECT p.*, a.area_code, a.name AS area_name, un.name AS size_unit_name
     FROM plot p
     JOIN area a ON a.id = p.area_id
     LEFT JOIN unit un ON un.code = p.size_unit
     WHERE p.${where} = $1`,
    [value]
  )
  if (plot.rows.length === 0) return null

  const id = plot.rows[0].id

  const activities = await pool.query(
    `SELECT pa.*, u.full_name AS created_by_name
     FROM plot_activity pa
     LEFT JOIN users u ON u.id = pa.created_by
     WHERE pa.plot_id = $1
     ORDER BY pa.activity_date DESC, pa.id DESC`,
    [id]
  )

  const materials = await pool.query(
    `SELECT pam.*, p.mat_uid, p.name AS product_name, i.item_id AS item_code,
            un.name AS unit_name
     FROM plot_activity_material pam
     JOIN plot_activity pa ON pa.id = pam.activity_id
     JOIN product p ON p.id = pam.product_id
     JOIN item i    ON i.id = pam.item_id
     LEFT JOIN unit un ON un.code = pam.unit_code
     WHERE pa.plot_id = $1
     ORDER BY pam.id ASC`,
    [id]
  )

  const harvests = await pool.query(
    `SELECT ph.*, p.mat_uid, p.name AS product_name, l.lot_no,
            un.name AS unit_name, u.full_name AS created_by_name
     FROM plot_harvest ph
     JOIN product p ON p.id = ph.product_id
     LEFT JOIN lot l ON l.id = ph.lot_id
     LEFT JOIN unit un ON un.code = ph.unit_code
     LEFT JOIN users u ON u.id = ph.created_by
     WHERE ph.plot_id = $1
     ORDER BY ph.harvest_date DESC, ph.id DESC`,
    [id]
  )

  const readings = await pool.query(
    `SELECT * FROM plot_reading WHERE plot_id = $1 ORDER BY recorded_at DESC LIMIT 50`,
    [id]
  )

  // ต้นทุนสะสมที่ยังไม่ถูกปันส่วนออกไปกับการเก็บเกี่ยวครั้งก่อน ๆ
  const materialCost = activities.rows.reduce((s, a) => s + Number(a.total_cost), 0)
  const allocatedCost = harvests.rows.reduce((s, h) => s + Number(h.cost_total), 0)

  // จับวัตถุดิบเข้ากับกิจกรรมของมัน เพื่อให้หน้าจอไม่ต้องยิง API ซ้ำทีละกิจกรรม
  const byActivity = new Map()
  for (const m of materials.rows) {
    if (!byActivity.has(m.activity_id)) byActivity.set(m.activity_id, [])
    byActivity.get(m.activity_id).push(m)
  }

  return {
    ...plot.rows[0],
    activities: activities.rows.map(a => ({ ...a, materials: byActivity.get(a.id) || [] })),
    harvests: harvests.rows,
    readings: readings.rows,
    material_cost:   round2(materialCost),
    allocated_cost:  round2(allocatedCost),
    unallocated_cost: round2(materialCost - allocatedCost),
  }
}

const getPlotById = async (req, res) => {
  try {
    const detail = await loadPlotDetail('id', req.params.id)
    if (!detail) return res.status(404).json({ message: 'ไม่พบแปลง' })
    res.json(detail)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const getPlotByToken = async (req, res) => {
  try {
    const detail = await loadPlotDetail('qr_token', req.params.token)
    if (!detail) return res.status(404).json({ message: 'ไม่พบแปลงที่ตรงกับ QR นี้' })
    res.json(detail)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const createPlot = async (req, res) => {
  const { area_id, plot_code, name, size, size_unit, crop, planted_date, status, note } = req.body

  if (!area_id) return res.status(400).json({ message: 'กรุณาเลือกโซน' })
  if (!name)    return res.status(400).json({ message: 'กรุณากรอกชื่อแปลง' })
  if (status && !PLOT_STATUSES.includes(status)) {
    return res.status(400).json({ message: `สถานะต้องเป็น ${PLOT_STATUSES.join(' / ')}` })
  }

  try {
    let code = plot_code
    if (!code) {
      const { rows } = await pool.query(
        `SELECT COALESCE(MAX(SUBSTRING(plot_code FROM 5)::bigint), 0) AS last
         FROM plot WHERE plot_code ~ '^PLOT[0-9]+$'`
      )
      code = `PLOT${String(Number(rows[0].last) + 1).padStart(4, '0')}`
    }

    const result = await pool.query(
      `INSERT INTO plot (area_id, plot_code, name, size, size_unit, crop, planted_date,
                         status, qr_token, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        area_id, code, name, size || null, size_unit || null, crop || null,
        planted_date || null, status || 'preparing',
        crypto.randomBytes(16).toString('hex'), note || null, req.user.id,
      ]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    if (err.code === '23505') return res.status(400).json({ message: 'รหัสแปลงนี้มีอยู่แล้ว' })
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const updatePlot = async (req, res) => {
  const { area_id, name, size, size_unit, crop, planted_date, status, note, is_active } = req.body

  if (status && !PLOT_STATUSES.includes(status)) {
    return res.status(400).json({ message: `สถานะต้องเป็น ${PLOT_STATUSES.join(' / ')}` })
  }

  try {
    const result = await pool.query(
      `UPDATE plot
       SET area_id      = COALESCE($1, area_id),
           name         = COALESCE($2, name),
           size         = COALESCE($3, size),
           size_unit    = COALESCE($4, size_unit),
           crop         = COALESCE($5, crop),
           planted_date = COALESCE($6, planted_date),
           status       = COALESCE($7, status),
           note         = COALESCE($8, note),
           is_active    = COALESCE($9, is_active),
           updated_at   = NOW()
       WHERE id = $10 RETURNING *`,
      [
        area_id ?? null, name ?? null, size ?? null, size_unit ?? null, crop ?? null,
        planted_date ?? null, status ?? null, note ?? null, is_active ?? null, req.params.id,
      ]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'ไม่พบแปลง' })
    res.json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const deletePlot = async (req, res) => {
  try {
    const harvested = await pool.query(
      'SELECT 1 FROM plot_harvest WHERE plot_id = $1 LIMIT 1', [req.params.id]
    )
    if (harvested.rows.length > 0) {
      return res.status(400).json({ message: 'ลบไม่ได้ เพราะแปลงนี้มีประวัติเก็บเกี่ยวแล้ว (ปิดใช้งานแทนได้)' })
    }
    // กิจกรรมและวัตถุดิบถูกลบตาม CASCADE แต่ของที่หักจากสต๊อกไปแล้วไม่ได้คืน
    const result = await pool.query('DELETE FROM plot WHERE id = $1 RETURNING id', [req.params.id])
    if (result.rows.length === 0) return res.status(404).json({ message: 'ไม่พบแปลง' })
    res.json({ message: 'ลบแปลงสำเร็จ' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

/* ============ บันทึกการดูแล ============ */

/**
 * บันทึกกิจกรรม พร้อมหักวัตถุดิบจากสต๊อก (ถ้ามี)
 *
 * กิจกรรมที่ไม่ใช้ของเลย (เช่น "ตรวจแปลง") ส่ง materials มาเป็น [] ได้
 */
const createActivity = async (req, res) => {
  const { plot_id } = req.params
  const { activity_date, activity_type, note, materials } = req.body

  if (!activity_type) return res.status(400).json({ message: 'กรุณาระบุประเภทกิจกรรม' })

  const list = Array.isArray(materials) ? materials : []
  for (const [i, m] of list.entries()) {
    if (!m.product_id) return res.status(400).json({ message: `วัตถุดิบรายการที่ ${i + 1}: ยังไม่ได้เลือก` })
    if (!m.unit_code)  return res.status(400).json({ message: `วัตถุดิบรายการที่ ${i + 1}: ยังไม่ได้เลือกหน่วย` })
    if (!(Number(m.qty) > 0)) {
      return res.status(400).json({ message: `วัตถุดิบรายการที่ ${i + 1}: ปริมาณต้องมากกว่า 0` })
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const plot = await client.query('SELECT id FROM plot WHERE id = $1', [plot_id])
    if (plot.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'ไม่พบแปลง' })
    }

    const activityResult = await client.query(
      `INSERT INTO plot_activity (plot_id, activity_date, activity_type, note, created_by)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5) RETURNING *`,
      [plot_id, activity_date || null, activity_type, note || null, req.user.id]
    )
    const activity = activityResult.rows[0]

    let used = { consumptions: [], totalCost: 0 }
    if (list.length > 0) {
      const lines = await resolveStockLines(client, list.map((m, i) => ({
        product_id: m.product_id,
        qty:        Number(m.qty),
        unit_code:  m.unit_code,
        label:      `วัตถุดิบรายการที่ ${i + 1}`,
      })))

      const short = lines.filter((l) => l.shortage > 0)
      if (short.length > 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({
          message: 'วัตถุดิบในสต๊อกไม่พอ',
          shortages: short.map((l) => ({
            product_name: l.product_name,
            required: l.required_qty,
            available: l.available_qty,
            shortage: l.shortage,
            unit: l.required_unit_name,
          })),
        })
      }

      used = await consumeFromStock(client, {
        lines,
        onConsume: async (row) => {
          const result = await client.query(
            `INSERT INTO plot_activity_material
               (activity_id, product_id, item_id, qty, unit_code, cost)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [activity.id, row.product_id, row.item_id, row.qty, row.unit_code, row.cost]
          )
          return result.rows[0]
        },
      })

      await client.query(
        'UPDATE plot_activity SET total_cost = $1 WHERE id = $2', [used.totalCost, activity.id]
      )
    }

    await client.query('COMMIT')
    res.status(201).json({ ...activity, total_cost: used.totalCost, materials: used.consumptions })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(400).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

const deleteActivity = async (req, res) => {
  try {
    // ไม่คืนของที่หักไปแล้ว — ของถูกใช้ในแปลงจริง การลบบันทึกไม่ได้ทำให้ของกลับมา
    const used = await pool.query(
      'SELECT 1 FROM plot_activity_material WHERE activity_id = $1 LIMIT 1', [req.params.activity_id]
    )
    if (used.rows.length > 0) {
      return res.status(400).json({
        message: 'ลบไม่ได้ เพราะกิจกรรมนี้หักวัตถุดิบจากสต๊อกไปแล้ว',
      })
    }
    const result = await pool.query(
      'DELETE FROM plot_activity WHERE id = $1 RETURNING id', [req.params.activity_id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'ไม่พบกิจกรรม' })
    res.json({ message: 'ลบกิจกรรมสำเร็จ' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

/* ============ เก็บเกี่ยว ============ */

/**
 * บันทึกการเก็บเกี่ยว → ผลผลิตเข้าสต๊อกเป็น lot ใหม่พร้อม QR
 *
 * ต้นทุนของผลผลิตมาจากต้นทุนสะสมของแปลงที่ยังไม่ถูกปันส่วน
 * ผู้ใช้แก้ตัวเลขได้ เพราะบางทีเก็บหลายรอบแล้วอยากเฉลี่ยเอง
 */
const createHarvest = async (req, res) => {
  const { plot_id } = req.params
  const {
    harvest_date, product_id, qty, unit_code, output_units,
    cost_total, lot_no, exp_date, note,
  } = req.body

  if (!product_id) return res.status(400).json({ message: 'กรุณาเลือกสินค้าที่เก็บเกี่ยวได้' })
  if (!unit_code)  return res.status(400).json({ message: 'กรุณาเลือกหน่วยของผลผลิต' })
  if (!(Number(qty) > 0)) return res.status(400).json({ message: 'ปริมาณที่เก็บได้ต้องมากกว่า 0' })

  const outUnits = Number(output_units)
  if (!Number.isInteger(outUnits) || outUnits <= 0) {
    return res.status(400).json({ message: 'จำนวนหน่วยที่บรรจุได้ต้องเป็นจำนวนเต็มบวก (1 หน่วย = QR 1 ดวง)' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const plot = await client.query(
      'SELECT id, plot_code, name FROM plot WHERE id = $1 FOR UPDATE', [plot_id]
    )
    if (plot.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: 'ไม่พบแปลง' })
    }

    // ต้นทุนที่ยังไม่ถูกปันส่วน = ที่ใช้ไปทั้งหมด − ที่ปันส่วนไปกับการเก็บเกี่ยวครั้งก่อน ๆ
    const costs = await client.query(
      `SELECT COALESCE((SELECT SUM(total_cost) FROM plot_activity WHERE plot_id = $1), 0) AS spent,
              COALESCE((SELECT SUM(cost_total) FROM plot_harvest WHERE plot_id = $1), 0) AS allocated`,
      [plot_id]
    )
    const unallocated = round2(Number(costs.rows[0].spent) - Number(costs.rows[0].allocated))

    const allocate = cost_total != null && cost_total !== ''
      ? round2(Number(cost_total))
      : Math.max(0, unallocated)
    if (!(allocate >= 0)) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'ต้นทุนที่ปันส่วนต้องไม่ติดลบ' })
    }

    const harvestDate = harvest_date || new Date().toISOString().slice(0, 10)
    const outputLotNo = lot_no || (await nextDocNo(client, 'lot'))

    const { lot } = await createLotWithItems(client, {
      product_id,
      lot_no:   outputLotNo,
      qty:      outUnits,
      cost:     round2(allocate / outUnits),
      mfg_date: harvestDate,
      // ผลผลิตสดไม่มีวันหมดอายุตายตัว ให้กรอกเอง ไม่กรอกถือว่า 30 วัน
      exp_date: exp_date || new Date(
        new Date(harvestDate).getTime() + 30 * 86400000
      ).toISOString().slice(0, 10),
      supplier: `เก็บเกี่ยว: ${plot.rows[0].plot_code}`,
    })

    const harvestResult = await client.query(
      `INSERT INTO plot_harvest
         (plot_id, harvest_date, product_id, qty, unit_code, output_units, lot_id, cost_total, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [plot_id, harvestDate, product_id, qty, unit_code, outUnits, lot.id, allocate, note || null, req.user.id]
    )

    await client.query(
      `UPDATE plot SET status = 'harvested', updated_at = NOW() WHERE id = $1`, [plot_id]
    )

    await client.query('COMMIT')
    res.status(201).json({
      ...harvestResult.rows[0],
      lot_no: lot.lot_no,
      qr_created: outUnits,
      cost_per_unit: round2(allocate / outUnits),
      unallocated_before: unallocated,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(400).json({ message: err.message || 'เกิดข้อผิดพลาด' })
  } finally {
    client.release()
  }
}

/* ============ ค่าจากเซ็นเซอร์ (เผื่อ IoT) ============ */

const createReading = async (req, res) => {
  const { plot_id } = req.params
  const { sensor_key, value, unit_label, source, recorded_at } = req.body

  if (!sensor_key) return res.status(400).json({ message: 'กรุณาระบุชนิดค่าที่วัด' })
  if (!Number.isFinite(Number(value))) {
    return res.status(400).json({ message: 'ค่าที่วัดต้องเป็นตัวเลข' })
  }

  try {
    const plot = await pool.query('SELECT id FROM plot WHERE id = $1', [plot_id])
    if (plot.rows.length === 0) return res.status(404).json({ message: 'ไม่พบแปลง' })

    const result = await pool.query(
      `INSERT INTO plot_reading (plot_id, sensor_key, value, unit_label, source, recorded_at)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6, NOW())) RETURNING *`,
      [plot_id, sensor_key, Number(value), unit_label || null, source || 'manual', recorded_at || null]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

module.exports = {
  getAreas, createArea, updateArea, deleteArea,
  getPlots, getPlotById, getPlotByToken, createPlot, updatePlot, deletePlot,
  createActivity, deleteActivity, createHarvest, createReading,
}
