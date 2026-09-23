const { pool } = require('../database')

/**
 * หลักฐานประกอบเอกสาร (ใบเสร็จ/ใบกำกับภาษี/รูปถ่ายของที่รับ)
 *
 * เก็บเป็น "ลิงก์" ไม่ใช่ไฟล์ — backend นี้รันบน Render ที่ดิสก์หายทุกครั้งที่ deploy
 * ถ้าจะอัปโหลดไฟล์จริงต้องต่อ Supabase Storage ก่อน ซึ่งยังไม่ได้ตัดสินใจ
 * โครงสร้างตารางรองรับไว้แล้ว (file_url เก็บ URL อะไรก็ได้) เปลี่ยนทีหลังไม่ต้องแก้ schema
 */

const REF_TYPES = ['purchase_order', 'goods_receipt']

const REF_TABLES = {
  purchase_order: 'purchase_order',
  goods_receipt:  'goods_receipt',
}

const getAttachments = async (req, res) => {
  const { ref_type, ref_id } = req.query

  if (!REF_TYPES.includes(ref_type) || !ref_id) {
    return res.status(400).json({ message: 'ต้องระบุ ref_type และ ref_id ให้ถูกต้อง' })
  }

  try {
    const result = await pool.query(
      `SELECT a.*, u.full_name AS uploaded_by_name
       FROM attachment a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.ref_type = $1 AND a.ref_id = $2
       ORDER BY a.created_at DESC`,
      [ref_type, ref_id]
    )
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const createAttachment = async (req, res) => {
  const { ref_type, ref_id, file_name, file_url, note } = req.body

  if (!REF_TYPES.includes(ref_type) || !ref_id) {
    return res.status(400).json({ message: 'ต้องระบุ ref_type และ ref_id ให้ถูกต้อง' })
  }
  if (!file_url) {
    return res.status(400).json({ message: 'กรุณาใส่ลิงก์ไฟล์' })
  }
  if (!/^https?:\/\//i.test(file_url)) {
    return res.status(400).json({ message: 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://' })
  }

  try {
    // ref_id ไม่มี foreign key (ชี้ได้หลายตาราง) จึงต้องเช็คเองว่าเอกสารมีจริง
    const exists = await pool.query(
      `SELECT 1 FROM ${REF_TABLES[ref_type]} WHERE id = $1`, [ref_id]
    )
    if (exists.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบเอกสารที่จะแนบหลักฐาน' })
    }

    const result = await pool.query(
      `INSERT INTO attachment (ref_type, ref_id, file_name, file_url, note, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [ref_type, ref_id, file_name || null, file_url, note || null, req.user.id]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

const deleteAttachment = async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM attachment WHERE id = $1 RETURNING id', [req.params.id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบหลักฐานที่ระบุ' })
    }
    res.json({ message: 'ลบหลักฐานสำเร็จ' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' })
  }
}

module.exports = { getAttachments, createAttachment, deleteAttachment }
