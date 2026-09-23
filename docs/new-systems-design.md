# FarmStock — ออกแบบระบบใหม่ตาม Newfunction.md

> เริ่ม 2026-09-22 — เอกสารนี้คือแผนแม่บท ใช้อ้างอิงตอนทำแต่ละ Phase
> อ้างอิงโครงสร้างข้อมูลเป้าหมายจาก `docs/โปรแกรมเกษตร (Rev.02).xlsx` (ข้อมูลตัวอย่าง)

## ข้อตกลงที่ตัดสินใจไว้แล้ว

| เรื่อง | ที่ตกลง |
|---|---|
| ความละเอียดของ QR | **คงรายชิ้นไว้** — 1 กระสอบ = 1 แถว `item` = 1 QR เหมือนเดิม เพิ่มแค่หน่วย/ขนาดบรรจุเข้าไป |
| ลำดับส่งงาน | **ทีละ Phase ตามลำดับพึ่งพา** — ใช้งานจริงได้ทีละตัว |
| Planting ตัด Stock | **ตัด** — การดูแลแต่ละครั้งหักของจาก Stock จริง เพื่อให้คิดต้นทุนต่อแปลงได้ |
| การหักวัตถุดิบที่ใช้ไม่เต็มหน่วย | **เปิดใช้บางส่วนได้** — เพิ่มปริมาณคงเหลือในแต่ละ `item` ต้นทุนคิดตามสัดส่วนที่ใช้จริง |
| วัตถุดิบไม่พอตามสูตร | **บล็อก** — บอกว่าขาดอะไรเท่าไร ไม่ให้สต๊อกติดลบ |
| ฐานข้อมูล | Supabase ต่อไม่ได้ตอนเขียน — **เขียน migration ไว้ก่อน** แล้วผู้ใช้ไป Resume เองแล้วค่อยรัน |

## สิ่งที่มีอยู่เดิม (ไม่รื้อ)

```
product_group → product → lot → item (1 แถว = 1 ชิ้นจริง) → dispense
```

- views: `v_stock_summary`, `v_lot_detail`
- functions: `recalculate_ave_cost(product_id)`, `auto_expire_lots()`
- FIFO เช็คซ้ำฝั่ง server เสมอ / weighted-average cost / คืน stock เมื่อแก้การเบิกย้อนหลัง

ของพวกนี้ถูกต้องแล้ว ระบบใหม่ทั้งหมด **ต่อยอดบนนี้** ไม่สร้างสต๊อกชุดที่สอง

---

## แผนที่ Excel → ระบบใหม่

| Sheet ต้นฉบับ | ระบบ | ตารางปลายทาง |
|---|---|---|
| `PackingUnit` | Foundation | `unit` |
| `T_MaterialStock` | Material Stock | `product` (เพิ่มคอลัมน์) + `product_group` (=Category) |
| `T_MaterialOrder` | Order Process | `purchase_order` + `purchase_order_line` |
| `T_MaterialReceive` | Order Process | `goods_receipt` + `goods_receipt_line` → สร้าง `lot` + `item` |
| `T_MixingRegister` | Mixing Process | `formula` |
| `T_MixingFormula` | Mixing Process | `formula_line` |
| `T_MixingRequest` | Mixing Process | `mixing_order` + `mixing_consumption` |
| — (ของใหม่) | Planting Process | `area`, `plot`, `plot_activity`, `plot_activity_material`, `plot_harvest`, `plot_reading` |
| — (ของใหม่) | Selling Process | `sale`, `sale_line`, `sale_line_item` |

---

## สถานะงาน

| Phase | สถานะ |
|---|---|
| 1. Foundation (หน่วย/ประเภท/พื้นที่จัดเก็บ) | ✅ **รัน migration บนฐานจริงแล้ว** 2026-09-22 |
| 2. Order Process | ✅ **รัน migration บนฐานจริงแล้ว** |
| 3. Mixing Process | ✅ **รัน migration บนฐานจริงแล้ว** |
| 4. Planting Process | ✅ **รัน migration บนฐานจริงแล้ว** |
| 5. Selling Process | ✅ **รัน migration บนฐานจริงแล้ว** |

ยังไม่ได้ deploy ขึ้น Render และยังไม่ได้ push — โค้ดอยู่ในเครื่องอย่างเดียว

### บทเรียนจากวันที่รันจริง (2026-09-22)

migration ทั้ง 5 ตัวถูกเขียนตอนที่ต่อฐานข้อมูลไม่ได้ จึงเดาโครงสร้างเดิมจาก query ในโค้ด
พอต่อได้จริงพบว่า **เดาผิดจุดใหญ่: primary key ทุกตารางเป็น `uuid` ไม่ใช่ `serial integer`**
foreign key ทุกตัวใน Phase 2-5 จึงพังหมด ต้องแก้เป็น uuid ทั้งชุดก่อนจะรันผ่าน

สิ่งที่เดาผิดอีก:
- `product` **ไม่มี** คอลัมน์ `ave_cost` — ต้นทุนเฉลี่ยคำนวณอยู่ใน view `v_stock_summary`
- `product.weight_per_piece` เป็น `varchar(50)` จริง ๆ (เดาถูกว่าอาจเป็น text)
- `v_stock_summary` **อ้าง `weight_per_piece`** จึงต้อง `DROP VIEW` แล้วสร้างใหม่ก่อนถึงจะลบคอลัมน์ได้
- `lot` unique เป็น `(lot_no, product_id)` ไม่ใช่ `lot_no` เดี่ยว
- `item.status` รับ 4 ค่า (`active`/`dispensed`/`expired`/`waste`) ไม่ใช่ 2
- `dispense.status` ค่า default คือ `active` ไม่ใช่ `normal`
- timestamp เป็น `timestamp without time zone` ไม่ใช่ `timestamptz`
- มี event trigger `rls_auto_enable` ที่เปิด RLS ให้ทุกตารางใหม่ใน `public` อัตโนมัติ

**ผลพลอยได้:** เพราะ id เป็น uuid การเรียง `ORDER BY id` จึงได้ลำดับมั่ว
`consumptionService` ถูกแก้ให้ใช้ `l.created_at` กับ `i.item_id` เป็นลำดับสำรองแทน ไม่งั้น FIFO ไม่แน่นอน

**ตอนนี้ `backend/db/schema.sql` มีโครงสร้างจริงอยู่ใน git แล้ว** — ครั้งแรกของโปรเจกต์
ถ้าจะเขียน migration ใหม่ ให้เปิดไฟล์นั้นดูก่อน อย่าเดาจากโค้ดอีก

### วิธีรัน migration

```bash
cd backend
npm run db:migrate          # อัปเดตขึ้นล่าสุด
npm run db:migrate:down     # ถอยกลับ 1 ขั้น
npm run db:dump-schema      # ถ่ายรูปโครงสร้างปัจจุบันเก็บไว้ที่ backend/db/schema.sql
```

ต้อง Resume โปรเจกต์ Supabase ใน dashboard ก่อน ไม่งั้นจะขึ้น `ENOTFOUND`

---

## Phase 1 — Foundation: หน่วย + ประเภท + พื้นที่จัดเก็บ

ทุก Phase หลังจากนี้ต้องใช้หน่วย (สูตรผสมใช้ กรัม/มิลลิลิตร แต่สต๊อกนับเป็น กระสอบ/ขวด)
ระบบปัจจุบัน **ไม่มีหน่วยเลย** — นับเป็น "ชิ้น" ล้วน จึงต้องทำก่อน

### ตาราง `unit`

| คอลัมน์ | ชนิด | ความหมาย |
|---|---|---|
| `id` | serial PK | |
| `code` | varchar(20) UNIQUE | `kg`, `g`, `l`, `ml`, `sack`, `bag`, … |
| `name` | varchar(50) | ชื่อไทยที่แสดงผล เช่น "กิโลกรัม" |
| `kind` | varchar(10) | `weight` / `volume` / `count` |
| `base_code` | varchar(20) NULL | หน่วยฐานของตระกูลเดียวกัน (NULL = ตัวเองเป็นฐาน) |
| `qty_per_base` | numeric(18,6) | **จำนวนหน่วยนี้ = 1 หน่วยฐาน** (กรัม = 1000, ตรงกับคอลัมน์ `PackQty` ใน Excel) |
| `sort_order` | integer | ลำดับแสดงใน dropdown |
| `is_active` | boolean | |

แปลงหน่วย: `ค่าในหน่วยฐาน = qty / qty_per_base` — แปลงข้ามตระกูล (`kind`) ไม่ได้ ต้องบล็อก

หน่วย `count` (กระสอบ/ถุง/ขวด) ไม่มีหน่วยฐาน — นับตัวเป็นตัว เพราะ **1 หน่วยนับ = 1 `item` = 1 QR**

### `product` เพิ่มคอลัมน์

| คอลัมน์ | ชนิด | ความหมาย | มาจาก Excel |
|---|---|---|---|
| `stock_unit` | varchar(20) → `unit.code` | หน่วยที่นับใน Stock — **1 หน่วยนี้ = 1 item = 1 QR** | `StockUnit` |
| `pack_size` | numeric(18,4) NULL | ขนาดบรรจุต่อ 1 หน่วยนับ เช่น 50 | `PackSize` |
| `pack_unit` | varchar(20) NULL → `unit.code` | หน่วยของขนาดบรรจุ เช่น กิโลกรัม (`ว่าง` ใน Excel = NULL) | `PackUnit` |
| `mat_type` | varchar(20) | `material` (ซื้อเข้า) / `mixed` (ได้จากผสม) / `produce` (ผลผลิตจากแปลง) | — |
| `storage_area` | varchar(20) NULL | พื้นที่จัดเก็บในคลัง (A/B) | `Area` |
| `is_active` | boolean | สถานะใช้งาน | `MatActive` |

- `Category` ใน Excel = `product_group` ที่มีอยู่แล้ว — ไม่สร้างตารางใหม่
- `weight_per_piece` (varchar) ถูก **ลบทิ้งแล้ว** แทนที่ด้วย `pack_size` + `pack_unit`
  ต้องสร้าง `v_stock_summary` ใหม่ก่อน เพราะ view อ้างคอลัมน์นี้อยู่
  สินค้าเดิม 3 ตัวจึงยังไม่มีขนาดบรรจุ ต้องไปกรอกที่หน้าลงทะเบียน
- `mat_type` คือคำตอบของ "แบ่งประเภทของ Mixing กับ material แต่เก็บไว้ในระบบ Stock รวมกัน"
  — แยกด้วยคอลัมน์ ไม่แยกตาราง

### ไฟล์ที่ทำไปแล้วใน Phase 1

| ไฟล์ | หน้าที่ |
|---|---|
| `backend/migrations/20260922120000_units-and-product-attributes.js` | สร้าง `unit` + seed 15 หน่วย + เพิ่มคอลัมน์ `product` + backfill `pack_size` |
| `backend/scripts/migrate.js` | ตัวรัน migration (node-pg-migrate v9 เป็น ESM แต่ backend เป็น CJS จึงเรียกผ่าน dynamic import + ใช้ connection config ตัวเดียวกับแอป) |
| `backend/src/controllers/unitsController.js` + `src/routes/units.js` | `GET/POST/PUT/DELETE /api/units` (เพิ่ม/แก้/ลบ = admin) |
| `backend/src/controllers/productsController.js` | รับ-ส่งคอลัมน์ใหม่, กรองด้วย `?mat_type= &group_id= &active=`, PUT อัปเดตเฉพาะฟิลด์ที่ส่งมา |
| `frontend/src/lib/units.js` | แปลงหน่วย + จัดรูปข้อความ (`convertQty`, `formatQty`, `formatPackSize`) |
| `frontend/test/units.test.mjs` | เทสต์ทิศทางการแปลงหน่วย 10 เคส |
| `frontend/src/pages/Register.jsx` | เพิ่มช่อง ประเภท / หน่วยนับ / ขนาดบรรจุ + หน่วย / พื้นที่จัดเก็บ (เพิ่มหน่วยใหม่ inline ได้เหมือน Group) |
| `frontend/src/pages/StockIn.jsx` | แสดงหน่วยจริงแทนคำว่า "ชิ้น" ทั้งหน้า |

หมายเหตุ: หน่วยที่ผู้ใช้เพิ่มเองเป็นชื่อไทย ทำเป็น `code` ไม่ได้ — backend ออกรหัสให้อัตโนมัติ (`u1`, `u2`, …)

---

## Phase 2 — Order Process

> "เก็บประวัติการซื้อ, รับสินค้าเข้า Material Stock, ใช้เก็บหลักฐานการซื้อของบันทึกค่าใช้จ่าย"

### `purchase_order` / `purchase_order_line`

- `purchase_order`: `order_code` (PR100001), `order_date`, `supplier`, `status`
  (`draft` → `ordered` → `partial` → `received` / `cancelled`), `total_amount`, `note`, `created_by`
- `purchase_order_line`: `product_id`, `qty`, `unit_code`, `unit_price`, `total_price`, `qty_received`

### `goods_receipt` / `goods_receipt_line`

- รับของได้**ทั้งแบบอ้างใบสั่งซื้อและไม่อ้าง** (ใน Excel มี `PX000001` = ของที่ได้จากการผสม ไม่ได้ซื้อ)
- `goods_receipt_line` ผูกกับ `lot` ที่สร้างขึ้น → ยิง flow เดิม (สร้าง lot + item รายชิ้น + `recalculate_ave_cost`)
- **ย้าย logic สร้าง lot/item ออกจาก `lotsController` มาเป็น service ร่วม** เพราะ Phase 3/4 เรียกใช้ซ้ำ

### หลักฐานการซื้อ

`attachment` (`ref_type`, `ref_id`, `file_name`, `file_url`, `note`, `uploaded_by`)

ตอนนี้ทำเป็น **"แนบลิงก์"** ก่อน ไม่ใช่อัปโหลดไฟล์ เพราะ backend รันบน Render ที่ดิสก์หายทุกครั้งที่ deploy
ถ้าจะอัปโหลดไฟล์จริงต้องต่อ Supabase Storage เพิ่ม — `file_url` เก็บ URL อะไรก็ได้ เปลี่ยนทีหลังไม่ต้องแก้ schema

`ref_id` ไม่มี foreign key เพราะชี้ได้หลายตาราง ความถูกต้องคุมที่ชั้น API (เช็คว่าเอกสารมีจริงก่อนแนบ)
และตอนลบใบสั่งซื้อต้องเก็บกวาด attachment เองเพราะ CASCADE ไม่ครอบถึง

### ไฟล์ที่ทำไปแล้วใน Phase 2

| ไฟล์ | หน้าที่ |
|---|---|
| `backend/migrations/20260922130000_order-process.js` | 5 ตาราง: `purchase_order`, `purchase_order_line`, `goods_receipt`, `goods_receipt_line`, `attachment` |
| `backend/src/services/stockService.js` | **ของกลาง** — `createLotWithItems()` (lot + item รายชิ้น + ave_cost) และ `nextDocNo()` ออกเลขเอกสาร Phase 3/4 จะเรียกตัวนี้ต่อ |
| `backend/test/stock-service.test.mjs` | เทสต์ 10 เคสด้วย client ปลอม — ไม่ต้องมีฐานข้อมูล |
| `backend/src/controllers/ordersController.js` + `routes/orders.js` | `/api/orders` — list/detail/สร้าง/แก้/เปลี่ยนสถานะ/ลบ |
| `backend/src/controllers/receiptsController.js` + `routes/receipts.js` | `/api/receipts` — รับของ → สร้าง lot + QR + อัปเดตสถานะใบสั่งซื้ออัตโนมัติ |
| `backend/src/controllers/attachmentsController.js` + `routes/attachments.js` | `/api/attachments` — แนบ/ลบหลักฐาน |
| `frontend/src/pages/Orders.jsx` | หน้าใบสั่งซื้อ: ค้นหา/กรองสถานะ, สร้างใบหลายรายการ, กางดูรายละเอียด, แนบหลักฐาน |
| `frontend/src/pages/Receive.jsx` | หน้ารับของ: เลือกใบสั่งซื้อแล้วเติมรายการค้างรับให้, หรือรับแบบไม่อ้างใบสั่งซื้อ |

### กติกาสำคัญของ Phase 2

- **หน่วยที่รับต้องเป็น `stock_unit` ของสินค้านั้นเท่านั้น** — สั่งเป็นกิโลกรัมแต่รับเป็นกระสอบไม่ได้
  เพราะจำนวน item ที่สร้างต้องตรงกับจำนวนหน่วยพอดี (1 หน่วย = 1 QR)
- **จำนวนที่รับต้องเป็นจำนวนเต็ม** ด้วยเหตุผลเดียวกัน
- ทั้งใบรับอยู่ใน transaction เดียว — รับ 5 รายการแล้วพังรายการที่ 3 จะไม่เหลือ lot ค้าง
- สถานะใบสั่งซื้อ `partial` / `received` ระบบตั้งให้เองตอนรับของ เปลี่ยนด้วยมือไม่ได้
- **ยังไม่มีการแก้/ลบใบรับของ** — ย้อนใบรับหมายถึงต้องลบ lot กับ item ที่อาจถูกเบิกไปแล้ว
  ต้องออกแบบเป็น "ใบรับคืน/ปรับปรุงสต๊อก" แยกต่างหาก ยังไม่ได้ทำ

---

## Phase 3 — Mixing Process

> "ใช้ Material จาก Material stock, คำนวณต้นทุน, บันทึกสูตรไว้ใช้ครั้งถัดไป, QR/ปริ้น/จ่าย มาอยู่ใต้ระบบนี้"

### ปัญหาหลักและทางแก้: เปิดใช้วัตถุดิบบางส่วน

สูตรเขียนเป็น "EM 20 มิลลิลิตร" แต่สต๊อกเก็บเป็น "ขวด" — หักครึ่งขวดในโมเดลรายชิ้นไม่ได้
ถ้าหักทั้งขวดต้นทุนจะพุ่ง (ขวดละ 200 บาท ใช้แค่ 20 มล. ก็คิด 200)

จึงเพิ่มคอลัมน์ลง `item`:

| คอลัมน์ | ความหมาย |
|---|---|
| `content_size` | ปริมาณบรรจุตอนรับเข้า — **สำเนาจาก `product.pack_size`** ไม่อ้างถึงตรง ๆ เพราะถ้าวันหลังแก้ขนาดบรรจุของสินค้า ของที่อยู่ในคลังแล้วต้องคงปริมาณจริงของมันไว้ |
| `content_unit` | หน่วยของปริมาณบรรจุ |
| `content_remaining` | เหลือเท่าไร — **NULL = สินค้านี้ไม่มีขนาดบรรจุ ต้องหักทั้งหน่วย** (เช่น ฟางข้าว 1 มัด) |

- เปิดขวดใช้ 20 มล. → `content_remaining` เหลือ 980 มล. ขวดยังอยู่ในสต๊อก
- ใช้จนหมด → `item.status = 'dispensed'` และ `lot.qty_remaining` ลด 1
- ต้นทุน = `lot.cost × (ที่ใช้ / content_size)`
- ลำดับการหยิบ: **lot เก่าก่อน (FIFO) และในแต่ละ lot หยิบชิ้นที่เปิดแล้วก่อน**
  ไม่งั้นจะมีขวดเปิดค้างเต็มชั้นจนหมดอายุไปเปล่า ๆ
- การเบิกจ่ายแบบเดิม (ทั้งชิ้น) ถูกปรับให้ล้าง `content_remaining = 0` ด้วย

### ตาราง

| ตาราง | เนื้อหา |
|---|---|
| `formula` (= `T_MixingRegister`) | `std_code`, `name`, `gtf_no`, `ferment_days`, `shelf_life_days`, `output_product_id` (สินค้า `mat_type='mixed'`), `output_qty` + `output_unit` (ผลผลิตต่อ 1 ชุด), `is_active` |
| `formula_line` (= `T_MixingFormula`) | `formula_id`, `seq`, `product_id`, `qty`, `unit_code` — ห้ามใส่วัตถุดิบซ้ำในสูตรเดียวกัน |
| `mixing_order` (= `T_MixingRequest`) | `mix_no` (PR200001), `mix_date`, `formula_id`, `target_qty` + `target_unit`, `status`, `output_lot_id`, `output_units`, `total_cost`, `cost_per_unit` |
| `mixing_consumption` | `mixing_order_id`, `product_id`, `item_id`, `qty`, `unit_code`, `cost` — ประวัติว่าหักชิ้นไหนไปเท่าไร ราคาเท่าไร |

### ขั้นตอนการผลิต

1. สร้างใบสั่งผลิต (`requested`) — เป็นแค่แผน **ไม่จองของ**
2. `GET /api/mixing/:id/requirement` ขยายสูตรตาม `target_qty / formula.output_qty`
   แล้วเทียบกับสต๊อกจริง บอกว่าขาดอะไรเท่าไร
3. กดยืนยันผลิต → **คำนวณใหม่อีกรอบในทรานแซกชัน** (ไม่เชื่อตัวเลขจากหน้าจอ)
   ขาดแม้ตัวเดียว = ยกเลิกทั้งหมด
4. หักของตาม FIFO แบบเปิดใช้บางส่วน → รวมต้นทุนจริง
5. สร้าง lot ผลผลิต + QR ตามจำนวนที่บรรจุได้ โดย
   `cost = total_cost / output_units`, `exp_date = mix_date + ferment_days + shelf_life_days`

`output_units` (จำนวนหน่วยที่บรรจุได้ = จำนวน QR) ผู้ใช้กรอกเอง ระบบแค่แนะนำตัวเลขจากขนาดบรรจุ
เพราะบรรจุจริงมักไม่ลงตัวพอดี

### ไฟล์ที่ทำไปแล้วใน Phase 3

| ไฟล์ | หน้าที่ |
|---|---|
| `backend/migrations/20260922140000_mixing-process.js` | เพิ่ม 3 คอลัมน์ใน `item` + backfill + 4 ตารางใหม่ |
| `backend/src/lib/units.js` | แปลงหน่วยฝั่ง server — **มีคู่แฝด ESM ที่ `frontend/src/lib/units.js` แก้กติกาต้องแก้ทั้งคู่** |
| `backend/src/services/mixingService.js` | `calculateRequirement()` ขยายสูตร+เทียบสต๊อก, `consumeMaterials()` หักของ+คิดต้นทุน |
| `backend/test/mixing-service.test.mjs` | เทสต์ 13 เคส รวมเคสต้นทุนตามสัดส่วนและการหยิบข้ามชิ้น |
| `backend/src/controllers/formulasController.js` + `routes/formulas.js` | `/api/formulas` |
| `backend/src/controllers/mixingController.js` + `routes/mixing.js` | `/api/mixing` รวม `/:id/requirement` และ `/:id/produce` |
| `frontend/src/pages/Formulas.jsx` | สร้าง/แก้/ปิดใช้งานสูตร |
| `frontend/src/pages/Mixing.jsx` | ใบสั่งผลิต + ตารางของที่ต้องใช้/ขาด + ยืนยันผลิต + ดูต้นทุนที่เกิดจริง |
| `frontend/src/components/Layout.jsx` | **จัดเมนูใหม่เป็นกลุ่ม** — ปริ้น QR กับเบิกจ่ายย้ายมาอยู่ใต้ "ผสม" ตาม Newfunction |

### ข้อจำกัดที่ยังอยู่

- **ผลิตแล้วยกเลิกไม่ได้** — ของถูกหักและออก QR ไปแล้ว ต้องทำเป็นใบปรับปรุงสต๊อกแยก
- ใบสั่งผลิตไม่จองของ — สร้างใบไว้ 3 ใบแล้วของพอแค่ใบเดียว ใครกดผลิตก่อนได้ก่อน
  (`FOR UPDATE` กันได้แค่ไม่ให้หักซ้ำชิ้นเดียวกัน)

## Phase 4 — Planting Process

> "สร้าง Area จัด zone แบ่งแปลง, สร้าง QR สำหรับแปลง, เก็บบันทึกการดูแลรักษา, รองรับ IoT ในอนาคต"

### หน่วยพื้นที่

ตาราง `unit` เดิมรู้จักแค่ น้ำหนัก/ปริมาตร/หน่วยนับ — Phase นี้เปิดรับ `kind = 'area'` เพิ่ม
แล้ว seed ไร่ / งาน / ตารางวา / ตารางเมตร โดย**ใช้ไร่เป็นหน่วยฐาน** เพื่อให้ตัวคูณเป็นจำนวนเต็มทุกตัว
(1 ไร่ = 4 งาน = 400 ตารางวา = 1600 ตารางเมตร)

### ตาราง

| ตาราง | เนื้อหา |
|---|---|
| `area` | `area_code` (AREA001), `name`, `note`, `is_active` — zone ใหญ่ |
| `plot` | `area_id`, `plot_code` (PLOT0001), `name`, `size` + `size_unit`, `crop`, `planted_date`, `status`, **`qr_token`**, `is_active` |
| `plot_activity` | `plot_id`, `activity_date`, `activity_type`, `note`, `total_cost` |
| `plot_activity_material` | `activity_id`, `product_id`, `item_id`, `qty`, `unit_code`, `cost` — **หัก Stock จริง** |
| `plot_harvest` | `plot_id`, `harvest_date`, `product_id`, `qty` + `unit_code`, `output_units`, `lot_id`, `cost_total` |
| `plot_reading` | `plot_id`, `sensor_key`, `value`, `unit_label`, `source`, `recorded_at` — ช่องว่างไว้ให้ IoT |

- `qr_token` เป็นค่าสุ่ม 32 ตัวอักษร **ไม่ใช่ id เรียงกัน** เพราะป้ายติดอยู่กลางแปลง ใครเดินผ่านก็สแกนได้
  ถ้าใช้ id จะเดา URL ของแปลงอื่นได้ทันที
- `activity_type` เป็นข้อความอิสระ ไม่ใช่ enum — กิจกรรมในฟาร์มมีได้ไม่จำกัด หน้าจอมีตัวเลือกสำเร็จรูปให้แต่พิมพ์เองได้
- `plot_reading.unit_label` ไม่มี FK ไป `unit` เพราะหน่วยเซ็นเซอร์ (°C, %, pH) คนละเรื่องกับหน่วยสินค้า

### ต้นทุนต่อแปลง

นี่คือเหตุผลที่ตกลงกันว่า "การดูแลต้องตัด Stock":

```
ต้นทุนสะสมของแปลง = Σ plot_activity.total_cost
ปันส่วนไปแล้ว      = Σ plot_harvest.cost_total
ยังไม่ปันส่วน      = ต้นทุนสะสม − ปันส่วนไปแล้ว
```

ตอนเก็บเกี่ยว ระบบเติม "ต้นทุนที่ยังไม่ปันส่วน" ให้เป็นค่าตั้งต้น **ผู้ใช้แก้ได้**
เพราะเก็บหลายรอบจากแปลงเดียวกันอาจอยากเฉลี่ยเอง แล้วผลผลิตเข้า Stock ด้วย
`lot.cost = ต้นทุนที่ปันส่วน / จำนวนหน่วยที่บรรจุ` → ไปคิดกำไรจริงต่อใน Phase 5

### ของที่ใช้ร่วมกับ Phase 3

การดูแลแปลงหักวัตถุดิบด้วยกติกาเดียวกับการผสมทุกอย่าง (เปิดใช้บางส่วน, FIFO, ต้นทุนตามสัดส่วน)
จึง**แยกตรรกะนั้นออกมาเป็น `consumptionService`** ให้ทั้งสองระบบเรียกใช้:

- `resolveStockLines()` — แปลงหน่วย + เทียบสต๊อก + บอกส่วนที่ขาด
- `consumeFromStock()` — หักของจริง โดยรับ `onConsume` เข้ามาให้ผู้เรียกเลือกว่าจะบันทึกประวัติลงตารางไหน
  (`mixing_consumption` หรือ `plot_activity_material`)

`mixingService` เหลือแค่ตรรกะเฉพาะของมัน คือการขยายสูตรตามปริมาณที่สั่งผลิต

### ไฟล์ที่ทำไปแล้วใน Phase 4

| ไฟล์ | หน้าที่ |
|---|---|
| `backend/migrations/20260922150000_planting-process.js` | หน่วยพื้นที่ + 6 ตารางใหม่ |
| `backend/src/services/consumptionService.js` | **ของกลาง** — แยกออกมาจาก mixingService ให้ Phase 3/4 ใช้ร่วมกัน |
| `backend/test/consumption-service.test.mjs` | เทสต์ 11 เคส ครอบคลุมทั้งของที่แบ่งได้และแบ่งไม่ได้ |
| `backend/src/controllers/plantingController.js` + `routes/planting.js` | `/api/planting` — โซน/แปลง/กิจกรรม/เก็บเกี่ยว/เซ็นเซอร์ |
| `frontend/src/pages/Planting.jsx` | จัดการโซน+แปลง, บันทึกกิจกรรม (หักสต๊อก), เก็บเกี่ยว, แสดง QR ของแปลง |
| `frontend/src/pages/PlotScan.jsx` | หน้าที่เปิดตอนสแกน QR กลางแปลง — ออกแบบให้ใช้มือถือกลางแดด บันทึกกิจกรรมแตะเดียว |

### ข้อจำกัดที่ยังอยู่

- **ลบกิจกรรมที่หักวัตถุดิบไปแล้วไม่ได้** — ของถูกใช้ในแปลงจริง ลบบันทึกไม่ได้ทำให้ของกลับมา
- หน้า QR ของแปลงยังต้อง login ก่อนถึงจะเปิดได้ — คนงานที่ไม่มีบัญชีสแกนแล้วใช้ไม่ได้
- `plot_reading` ยังไม่มีอะไรยิงเข้ามา และ endpoint ใช้ JWT ของผู้ใช้
  **อุปกรณ์ IoT จริงต้องมี device token แยก** ยังไม่ได้ทำ

## Phase 5 — Selling Process

> "สร้างรายการขายดึงของจาก Stock โดยตรง สรุปราคาและผลกำไรจากรอบการขายนั้น ๆ และเก็บประวัติ"

### ตาราง

| ตาราง | เนื้อหา |
|---|---|
| `sale` | `sale_no` (SO000001), `sale_date`, `customer`, `status`, `total_amount`, `total_cost`, `profit`, `confirmed_at` |
| `sale_line` | `sale_id`, `seq`, `product_id`, `qty` + `unit_code`, `unit_price`, `total_price`, `total_cost` |
| `sale_line_item` | `sale_line_id`, `item_id`, `qty`, `unit_code`, `cost` — ชิ้นที่ถูกหักไปจริง |

### ทำไมเก็บ `profit` ไว้ในตาราง ไม่คำนวณสด

ถ้าคำนวณกำไรสดจาก `ave_cost` ปัจจุบัน **กำไรของเดือนที่แล้วจะเปลี่ยนไปเรื่อย ๆ**
ทุกครั้งที่ราคาของเปลี่ยน รายงานย้อนหลังต้องเห็นตัวเลข ณ วันที่ขาย จึงบันทึกไว้ตอนยืนยันขาย

### วงจร

1. สร้างใบขายเป็น **ร่าง** — ยังไม่แตะสต๊อก แก้ไขได้ตามใจ
2. กดยืนยันขาย → หักของตาม FIFO ผ่าน `consumptionService` ตัวเดียวกับ Phase 3/4
   → ได้ต้นทุนจริงของชิ้นที่ขายไป
3. `profit = total_amount − total_cost` บันทึกลงใบขาย
4. ของไม่พอ = บล็อก บอกว่าขาดอะไรเท่าไร

หักทีละบรรทัดเพื่อให้รู้ว่าต้นทุนก้อนไหนเป็นของบรรทัดไหน — และเพราะหักไปทีละบรรทัด
ถ้าสินค้าตัวเดียวกันอยู่หลายบรรทัด บรรทัดหลังจะเห็นสต๊อกที่เหลือจริงหลังบรรทัดก่อนหักไปแล้ว

### กำไรที่ได้เป็นกำไรจริง

ต้นทุนไม่ได้เดาเอา แต่ไหลมาตลอดสาย:

```
ซื้อเข้า (Phase 2) → lot.cost
     ↓
ผสม (Phase 3)   → ต้นทุนวัตถุดิบตามสัดส่วนที่ใช้ → lot.cost ของของผสม
ปลูก (Phase 4)  → ต้นทุนการดูแลสะสมต่อแปลง → ปันส่วนตอนเก็บเกี่ยว → lot.cost ของผลผลิต
     ↓
ขาย (Phase 5)   → หักชิ้นจริง → total_cost → กำไร
```

### รายงาน

`GET /api/sales/summary?from&to` — ยอดขาย/ต้นทุน/กำไรรวม, แยกตามสินค้า, แยกตามเดือน
(นับเฉพาะใบที่ยืนยันแล้ว ใบร่างไม่นับ)

### ไฟล์ที่ทำไปแล้วใน Phase 5

| ไฟล์ | หน้าที่ |
|---|---|
| `backend/migrations/20260922160000_selling-process.js` | 3 ตาราง |
| `backend/src/controllers/salesController.js` + `routes/sales.js` | `/api/sales` รวม `/summary` และ `/:id/confirm` |
| `backend/test/routes.test.mjs` | เทสต์ว่าทุก endpoint ถูกต่อไว้จริง + ทุกเส้นทางมี `verifyToken` + ลำดับเส้นทางไม่ชนกัน |
| `frontend/src/pages/Sales.jsx` | ใบขาย (ร่าง → ยืนยัน), การ์ดสรุปกำไร, กำไรรายสินค้า, ไล่ดูได้ถึงชิ้นที่ขายไป |

### ข้อจำกัดที่ยังอยู่

- **ยืนยันขายแล้วยกเลิกไม่ได้** — ของถูกหักออกจากสต๊อกแล้ว ต้องทำเป็นใบรับคืนแยก
- ยังไม่มีการออกเอกสาร (ใบเสร็จ/ใบส่งของ) — เก็บแค่ข้อมูลการขาย

---

## งานที่เหลือร่วมกันทุก Phase

**เรื่องเดียวกันที่โผล่ทั้ง 4 Phase: ย้อนรายการที่ทำไปแล้วไม่ได้**
รับของ / ผลิต / ดูแลแปลง / ขาย — พอกดยืนยันแล้วของถูกหักและออก QR ไปแล้ว ย้อนไม่ได้ทั้งหมด
ทางแก้ที่ถูกต้องคือทำ **"ใบปรับปรุงสต๊อก"** ตัวเดียวที่ใช้ได้กับทุกกรณี แทนที่จะให้แต่ละระบบลบของตัวเอง
— ยังไม่ได้ทำ และควรเป็นงานก้อนถัดไปถ้าใช้จริงแล้วเจอปัญหา

## เรื่องที่ยังไม่สรุป (ต้องถามเพิ่มตอนถึง Phase นั้น)

1. **Phase 2** — จะอัปโหลดไฟล์จริงผ่าน Supabase Storage ไหม (ตอนนี้แนบเป็นลิงก์) และจะทำ "ใบรับคืน/ปรับปรุงสต๊อก" ไหม
2. **Phase 3** — จะทำ "ใบปรับปรุงสต๊อก" เพื่อย้อนการผลิตไหม และใบสั่งผลิตควรจองของล่วงหน้าไหม
3. **Phase 4** — จะให้สแกน QR แปลงได้โดยไม่ต้อง login ไหม และ IoT จะยิงข้อมูลเข้ามาด้วยวิธีไหน (device token?)
4. **Phase 5** — ต้องออกเอกสารใบเสร็จ/ใบส่งของไหม และจะทำ "ใบรับคืนสินค้า" ไหม

## หนี้ทางเทคนิคที่ควรเก็บระหว่างทาง

จาก `docs/analysis-notes.md` — แก้ตอนแตะไฟล์นั้น ๆ อยู่แล้ว ไม่ต้องทำเป็นงานแยก:

- `updateDispense` ไม่ `ROLLBACK` ตอน return 404 (`dispenseController.js:150`)
- `toggleUser` เทียบ id ต่างชนิด (`usersController.js:78`)
- `deleteItem` ไม่เช็คว่ามี item จริงก่อนอ่าน `.lot_id` (`itemsController.js:82`)
- `updateProduct` / `updateLot` เขียนทับทุกคอลัมน์ ฟิลด์ที่ไม่ส่งกลายเป็น null
