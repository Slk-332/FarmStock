# FarmStock — สรุปวิเคราะห์โปรเจกต์ (สำหรับพัฒนาต่อ)

> บันทึกไว้เพื่อคุยต่อ ยังไม่ได้แก้อะไรในโค้ด

## ภาพรวมระบบ

ระบบจัดการสต๊อกฟาร์ม/โรงงานอาหาร เน้น traceability ระดับ**ชิ้นงานเดี่ยว** ไม่ใช่แค่จำนวนรวม
มี lot/batch tracking, บังคับ FIFO, พิมพ์/สแกน QR, บันทึกเบิกใช้พร้อมของเสีย (waste)

**Stack:** React 19 + Vite + Tailwind + Recharts (frontend) / Express + `pg` raw SQL + JWT (backend) / Postgres (Supabase) / deploy: Vercel (frontend) + Render (backend)

## โครงสร้างข้อมูล

```
product_group → product → lot → item (1 แถว = 1 ชิ้นจริง) → dispense
```

- `product`: mat_uid, name, min_stock, max_stock, weight_per_piece
- `lot`: lot_no, qty_received, qty_remaining, cost, mfg_date, exp_date, status
- `item`: item_id (เช่น `MATUID-LOT000001-001`), status active/dispensed, generate ทีละชิ้นตอนรับ lot เข้า
- `dispense`: qty_used, qty_waste, cost_per_piece, total_cost, status
- Logic บางส่วนอยู่ใน DB: function `recalculate_ave_cost()`, `auto_expire_lots()`, view `v_stock_summary`, `v_lot_detail`

## Flow หลัก 4 อย่าง

1. **Stock-In**: เลือก product → กรอก lot info → backend สร้าง lot + loop สร้าง item รายชิ้น (transaction เดียว) → recalculate ave_cost (weighted average)
2. **Print**: ดึง item ที่ `print_status='pending'` → พิมพ์ QR → mark `printed`
3. **Dispense (แน่นสุด)**: หา lot เก่าสุดของ product (FIFO) → UI ไฮไลต์ item ที่เบิกได้ → **backend เช็คซ้ำ FIFO ฝั่ง server เสมอ ไม่เชื่อ client** → บันทึก dispense + ลด qty_remaining + ปิด lot ถ้าหมด + recalculate ave_cost → แก้ไขย้อนหลังได้ ถ้าลดจำนวนใช้จริงจะ**คืน stock อัตโนมัติ**
4. **Report/Dashboard**: สรุปยอดวัน/เดือน, แจ้งเตือน stock ต่ำ/ล้น (เทียบ min/max), รายงานใกล้หมดอายุ (เรียก `auto_expire_lots()` ก่อนทุกครั้ง), กราฟเบิกจ่ายรายสัปดาห์

## จุดแข็ง (ของดีที่ควรเก็บไว้/เอาไปใช้ต่อ)

- Item-level tracking ทำให้ traceability รายชิ้นเป็นไปได้จริง
- FIFO enforcement เช็คซ้ำฝั่ง server เสมอ — เป็น pattern ที่ถูกต้อง
- Weighted-average cost คำนวณอัตโนมัติทุกจุดที่กระทบ stock ผ่าน DB function เดียว
- Auto-expire แบบเรียกตอนอ่านรายงาน เหมาะกับสเกลเล็ก ไม่ต้องมี cron แยก
- Stock alert รวม logic ไว้ที่ view เดียว (`v_stock_summary`)
- Return-to-stock เมื่อแก้ไขการเบิกย้อนหลัง — edge case ที่มักถูกลืมแต่ทำถูก
- Route auth guard (`verifyToken`/`adminOnly`) ครบเกือบทุก endpoint
- CORS จำกัด origin เฉพาะที่กำหนด + regex สำหรับ Vercel preview

## บั๊ก/ปัญหาที่พบ (เรียงตามความสำคัญ)

### ต้องแก้ก่อน (บั๊กจริง)
1. **`toggleUser` ป้องกันตัวเองพัง** — `backend/src/controllers/usersController.js:78` เทียบ `id === req.user.id` แบบ type ไม่ตรง (string vs จาก JWT) อาจทำให้ admin ปิดบัญชีตัวเองได้ทั้งที่ตั้งใจกันไว้
2. **`updateDispense` ไม่ rollback เมื่อไม่พบรายการ** — `backend/src/controllers/dispenseController.js:150-152` เปิด `BEGIN` แล้วแต่ return 404 โดยไม่ `ROLLBACK` ก่อน ทำให้ connection ค้าง transaction ตอนคืน pool
3. **`deleteItem` ไม่เช็คว่ามี item จริงก่อนอ่าน `.lot_id`** — `backend/src/controllers/itemsController.js:82-105` จะ throw ถ้า id ไม่มีอยู่จริง (แม้ catch ไว้แต่ error message ไม่สื่อความหมาย)

### ควรพิจารณา (security/architecture)
4. Role ฝังใน JWT ไม่เช็คซ้ำกับ DB — admin ที่ถูกลดสิทธิ์ยังใช้ token เดิมได้จนหมดอายุ
5. ไม่มี rate limiting ที่ `/api/auth/login`
6. เก็บ JWT ใน `localStorage` (เสี่ยง XSS)
7. `updateLot`/`updateUser` เขียนทับทุกคอลัมน์เต็ม ๆ ไม่ validate — ฟิลด์ที่ขาดจะถูกเขียนเป็น null
8. ไม่มี migration tool — schema DB ไม่ถูก track ใน version control
9. ไม่มีชั้น `models`/repository — query join ซ้ำกันหลายที่ (`item JOIN lot JOIN product`)
10. ไม่มี test เลยทั้งโปรเจกต์
11. ไม่มี validation library (Joi/Zod) — validate มือแบบ `if (!x)` ไม่สม่ำเสมอ

## ข้อสรุป: แก้ต่อ ไม่ต้อง rewrite ใหม่

Core logic (schema, FIFO, weighted-cost, item tracking) ถูกต้องและใช้ได้จริง ปัญหาที่เจอเป็นระดับ implementation ไม่ใช่สถาปัตยกรรม แนะนำ:

1. แก้บั๊ก 3 ข้อแรกก่อน (toggleUser, updateDispense rollback, deleteItem)
2. เพิ่ม migration tool (เช่น `node-pg-migrate`)
3. เพิ่ม validation layer (Zod)
4. แยก query ซ้ำออกเป็น shared model/repository
5. เขียน integration test ให้ FIFO/dispense flow ก่อนเป็นอันดับแรก (เป็นจุดที่มี business rule จริงจังที่สุด)

---
*สร้างเมื่อ 2026-09-20 — สำหรับใช้อ้างอิงตอนกลับมาทำงานต่อ*
