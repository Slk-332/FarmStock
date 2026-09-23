# FarmStock — ทางเลือกการสั่งพิมพ์ฉลาก QR (แทน/ปรับปรุง QZ Tray)

> บันทึกผลตรวจสอบ 2026-09-21 — ยังไม่ได้แก้โค้ด
> เครื่องพิมพ์: Xprinter XP-420B (203 DPI, กว้างสุด 108mm, รองรับ TSPL/EPL/ZPL/DPL + ESC/POS,
> USB เป็นมาตรฐาน — LAN / Bluetooth / WiFi เป็น option เสริม)

## 1. ของเดิมทำงานยังไง

`frontend/src/pages/Print.jsx`

- `Print.jsx:50` → เชื่อม QZ Tray ผ่าน WebSocket ไป localhost
- `Print.jsx:172-173` → ส่งฉลากเป็น `{ type:'pixel', format:'html' }` แล้ว `qz.print()` **ทีละชิ้นในลูป**
- `Print.jsx:177` → `PATCH /items/print` mark ว่าปริ้นแล้ว
- มีปุ่มสำรอง `handlePrintBrowser()` เปิด `window.open` + `setTimeout(500)` แล้ว `print()`

## 2. ปัญหาที่เจอจริงในโค้ด (เรียงตามผลกระทบ)

| # | ปัญหา | ตำแหน่ง | ผล |
|---|-------|---------|-----|
| 1 | `setCertificatePromise((resolve)=>resolve())` + signature ว่าง = **ไม่ได้เซ็นใบรับรอง** | `Print.jsx:40-41` | QZ เด้ง dialog "Untrusted website" ให้กด Allow **ทุกครั้ง** ที่เชื่อม/พิมพ์ |
| 2 | ใช้ `format:'html'` | `Print.jsx:172` | QZ ต้องเปิด engine ภายในเรนเดอร์ HTML แล้วแปลงเป็นบิตแมป → ช้า (~1-3 วิ/ดวง) และตัวอักษรเบลอ เพราะ rasterize ไม่ตรง 203 DPI |
| 3 | `await qz.print()` อยู่ในลูป | `Print.jsx:173` | 100 ดวง = 100 job เข้า spooler แยกกัน ช้ามาก และหยุดกลางคันไม่ได้ |
| 4 | ชื่อเครื่องพิมพ์ hardcode `'Xprinter XP-420B'` | `Print.jsx:6` | เครื่องไหน driver ตั้งชื่อต่างนิดเดียวก็พิมพ์ไม่ออก ไม่มี UI ให้เลือก |
| 5 | mark `printed` หลังลูปจบ โดยไม่สนว่าดวงไหนสำเร็จ | `Print.jsx:177` | พังกลางคัน = ของที่ยังไม่ได้พิมพ์ถูกมาร์กว่าพิมพ์แล้ว |
| 6 | fallback mark `printed` ก่อนผู้ใช้กดยืนยันใน print dialog | `Print.jsx:239` | กด Cancel ก็ยังถูกมาร์กว่าพิมพ์แล้ว |
| 7 | `window.open` + `setTimeout(500)` + `close()` | `Print.jsx:243` | โดน popup blocker / รูป QR โหลดไม่ทัน / ปิดหน้าต่างก่อน spool เสร็จ |

**License:** QZ Tray ตัว community เป็น AGPL — ใช้เชิงพาณิชย์แบบไม่เปิดซอร์สต้องซื้อ license
(ซึ่งก็คือสิ่งที่ทำให้เซ็นใบรับรองได้และ dialog ข้อ 1 หายไป)

## 3. ทางเลือกที่ตรวจสอบมา

### A. TSPL / bitmap ผ่าน QZ (แก้ของเดิม ไม่เปลี่ยนสถาปัตยกรรม) — เร็วที่สุดที่จะเห็นผล

XP-420B รองรับ TSPL และมีคำสั่งสร้าง QR ในตัวเครื่อง (`QRCODE x,y,ECC,cell,A,rot,"data"`)
จึงไม่ต้องส่งรูป QR เลย ส่งแค่ text command สั้น ๆ

```
SIZE 40 mm,20 mm
GAP 2 mm,0
CLS
QRCODE 230,15,L,4,A,0,"https://.../scan/ITEM-ID"
BITMAP 10,10,...      <- เฉพาะส่วนข้อความไทย
PRINT 1,1
```

- **ข้อดี:** เร็วขึ้นหลายเท่า, QR คมกริบเพราะเครื่องวาดเอง, ส่งได้ทั้ง batch ใน job เดียว
- **ข้อควรระวัง:** ฟอนต์ในตัว TSPL **ไม่มีภาษาไทย** ส่วนชื่อสินค้าภาษาไทยต้องเรนเดอร์เป็นบิตแมป
  ทางแก้: วาดฉลากลง `<canvas>` ขนาดพอดีเป๊ะ 320×160 px (40mm × 203dpi = 320 dots)
  แล้วส่งเป็น `BITMAP` หรือ `{type:'pixel', format:'image'}` — เราคุมการ rasterize เอง คมกว่า html มาก
- **ยังต้องลง QZ Tray และ dialog ข้อ 1 ยังอยู่** (ถ้าไม่ซื้อ license)

### B. WebUSB (ยิงจากเบราว์เซอร์ตรงเข้าเครื่องพิมพ์) — ไม่แนะนำบน Windows

ฟังดูสวยที่สุดเพราะไม่ต้องมี middleware เลย แต่ติดปัญหาจริงจัง: บน Windows ระบบผูก `usbprint.sys`
เข้ากับเครื่องพิมพ์ไว้แล้ว เบราว์เซอร์ claim interface ไม่ได้ ต้องใช้ Zadig แทนที่ไดรเวอร์ด้วย WinUSB
ซึ่งจะทำให้ **เครื่องพิมพ์หายไปจากรายการ Printer ของ Windows** และโปรแกรมอื่นพิมพ์ไม่ได้อีกเลย
(รองรับแค่ Chrome/Edge ด้วย)

### C. LAN + raw TCP port 9100 — สะอาดที่สุด ถ้ายอมซื้อโมดูล LAN

XP-420B มี option LAN — เสียบสาย LAN แล้วยิง TSPL เข้า `printer-ip:9100` ตรง ๆ
ไม่ต้องมีไดรเวอร์ ไม่ต้องมีโปรแกรมคั่นบนเครื่อง PC เลย

- **ติดตรงนี้:** backend อยู่บน Render (คลาวด์) จึงมองไม่เห็น IP ในวง LAN ของฟาร์ม
  และเบราว์เซอร์เปิด TCP socket ดิบ ๆ ไม่ได้
- **ใช้ได้เมื่อ:** ย้าย backend มารันในวง LAN เอง หรือจับคู่กับข้อ D (ให้ agent เป็นตัวยิง 9100)

### D. เขียน Print Agent ของตัวเอง (เลิกใช้ QZ Tray ถาวร) — คำตอบระยะยาว

Node.js service เล็ก ๆ ~150 บรรทัด รันบนเครื่อง PC ที่ต่อเครื่องพิมพ์ ติดตั้งเป็น Windows Service
(nssm / pm2-windows-service) ให้เปิดเองตอนบูต

```
Vercel (https)  --POST http://127.0.0.1:9110/print-->  Agent  --raw TSPL-->  XP-420B
                                                              (USB share หรือ TCP 9100)
```

- **ข้อดี:** ไม่มี license, ไม่มี dialog กวน, ตอบกลับได้ว่าดวงไหนสำเร็จจริง (แก้ปัญหาข้อ 5-6 ได้จริง),
  batch ได้, คุม queue เองได้, ใส่ auth token กันคนอื่นสั่งพิมพ์ได้
- **เรื่องที่ต้องรู้:** หน้าเว็บ HTTPS เรียก `http://127.0.0.1` **ได้** เพราะ Chrome ถือว่า localhost
  เป็น trustworthy origin จึงไม่โดน mixed-content block — แต่ agent ต้องตอบ CORS
  และ header `Access-Control-Allow-Private-Network: true` (Private Network Access) ด้วย
- **ข้อเสีย:** ต้องดูแลเอง และต้องไปติดตั้งทุกเครื่องที่จะใช้พิมพ์

### E. Browser print แบบทำให้ถูกต้อง (ของฟรี ใช้ได้ทุกเครื่อง) — ควรมีไว้เป็น fallback เสมอ

ไม่ใช่ทางหลัก แต่ของเดิมเขียนไว้ผิดวิธี ควรแก้เป็น:

- ใช้ **hidden iframe** แทน `window.open` (ไม่โดน popup blocker)
- รอ `img.decode()` ของ QR ทุกใบก่อนค่อยสั่ง `print()` แทน `setTimeout(500)`
- ใช้ event `afterprint` แทนการเดาเวลา แล้วค่อย mark `printed`
- ตั้ง `@page { size: 40mm 20mm; margin: 0 }` ให้ตรงกับ label และตั้ง paper size ใน driver ให้ตรงกัน

คุณภาพจริง ๆ **ไม่แย่** เพราะไดรเวอร์ Windows เป็นคน rasterize ที่ 203 DPI เอง
เสียแค่ต้องกดยืนยัน dialog ทุกครั้ง และสั่งพิมพ์เงียบ ๆ ไม่ได้

### F. PrintNode / บริการคลาวด์พิมพ์ (จ่ายเงินให้คนอื่นดูแล)

backend เรียก REST API แล้ว client ของเขาบนเครื่อง PC พิมพ์ให้ ไม่ต้องเขียน agent เอง
เหมาะถ้าไม่อยากดูแลโค้ดฝั่ง desktop เลย แต่มีค่าบริการรายเดือน และข้อมูลฉลากวิ่งผ่านเซิร์ฟเวอร์เขา

## 4. สรุปเปรียบเทียบ

| วิธี | ต้องลงโปรแกรมที่เครื่อง | พิมพ์เงียบ (ไม่มี dialog) | ความคม | ความเร็ว | ค่าใช้จ่าย | งานที่ต้องทำ |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| ปัจจุบัน QZ + HTML | ต้องลง QZ | ไม่ (เด้ง untrusted) | ต่ำ | ช้า | AGPL / ต้องซื้อ | - |
| A. QZ + TSPL/bitmap | ต้องลง QZ | ไม่ (เว้นแต่ซื้อ license) | **สูง** | **เร็ว** | เท่าเดิม | น้อย |
| B. WebUSB | ไม่ต้อง | ได้ | สูง | เร็ว | ฟรี | มาก + **พังไดรเวอร์** |
| C. LAN 9100 | ไม่ต้อง | ได้ | **สูง** | **เร็ว** | ค่าโมดูล LAN | กลาง (ต้องมี D หรือย้าย backend) |
| D. Agent เอง | ของเราเอง | ได้ | **สูง** | **เร็ว** | ฟรี | กลาง-มาก |
| E. Browser (แก้ให้ถูก) | ไม่ต้อง | ไม่ได้ | กลาง-สูง | กลาง | ฟรี | น้อย |
| F. PrintNode | client ของเขา | ได้ | สูง | เร็ว | รายเดือน | น้อย |

## 5. สิ่งที่ตัดสินใจและทำไปแล้ว (2026-09-21)

**เลือกข้อ D — เขียน print agent เอง และถอด QZ Tray ออกทั้งหมด** (เครื่องพิมพ์เป็น USB อย่างเดียว)

### ไฟล์ที่เพิ่ม

| ไฟล์ | หน้าที่ |
|---|---|
| `print-agent/` | Node.js agent **ไม่มี npm dependency เลย** ก๊อปไปวางแล้วรันได้ |
| `print-agent/src/tspl.js` | ที่เดียวที่รู้เรื่องภาษาเครื่องพิมพ์ — แปลง job → คำสั่ง TSPL |
| `print-agent/src/printers.js` | list printer / เช็คสถานะ / เขียน raw ผ่าน `winspool.drv` |
| `print-agent/src/server.js` | HTTP API + CORS + Private Network Access + token auth |
| `frontend/src/lib/labelRender.js` | วาดฉลากลง canvas ที่ 203 DPI แล้วแพ็คเป็นบิตแมป 1 บิต |
| `frontend/src/lib/printAgent.js` | client คุยกับ agent + เก็บ setting ใน localStorage |
| `frontend/src/lib/browserPrint.js` | ทางสำรอง: hidden iframe + `img.decode()` + `afterprint` |
| `frontend/test/label-pipeline.test.mjs` | 12 เทสต์ล็อกการเรียงบิตและ TSPL (`npm test` ในโฟลเดอร์ frontend) |

### ปัญหาในตาราง §2 ถูกแก้ยังไง

| # | แก้โดย |
|---|---|
| 1 | ไม่มี QZ แล้ว จึงไม่มี dialog "Untrusted website" และไม่ติดเรื่อง license |
| 2 | เว็บวาดฉลากลง canvas ที่ **1 pixel = 1 dot ของหัวพิมพ์** (40mm = 320 dots) แล้วส่งบิตแมปตรง ๆ ไม่ผ่าน HTML renderer |
| 3 | ทุกดวงรวมเป็น **job เดียว** (`SIZE/GAP/DENSITY` ส่งครั้งเดียว แล้ว `CLS`+`BITMAP`+`PRINT` ต่อดวง) |
| 4 | dropdown ดึงจาก `GET /printers` + จำไว้ใน localStorage — ไม่มีชื่อ hardcode แล้ว |
| 5 | mark `printed` เฉพาะ `printedIds` ที่ agent ตอบกลับมา |
| 6 | ทางสำรองถามยืนยันก่อน ("พิมพ์ออกมาครบไหม?") — ไม่เดาแทนผู้ใช้ |
| 7 | เปลี่ยนเป็น hidden iframe + รอ `img.decode()` + รอ event `afterprint` |

### สิ่งที่ได้เพิ่มมาระหว่างทาง

- **preview ฉลาก** ในหน้า Print — เป็นข้อมูลชุดเดียวกับที่ส่งเข้าเครื่องพิมพ์จริง พร้อมบอกว่า QR
  กี่ module และกี่ dot ต่อ module (ฉลาก 40×20mm ได้ QR 33×33 @ 4 dot = 16.5mm สแกนสบาย)
- **เช็คสถานะเครื่องพิมพ์ก่อนส่งงาน** — ออฟไลน์ / กระดาษหมด / ฝาเปิด แจ้งเตือนก่อนเปลืองสติกเกอร์
- **ปุ่มทดสอบพิมพ์** ใช้ฟอนต์ในตัวเครื่อง แยกได้ว่าปัญหาอยู่ฝั่งเครื่องพิมพ์หรือฝั่งเว็บ
- ปรับ **ความเข้ม / ความเร็ว / ระยะห่างฉลาก** ได้จากหน้าเว็บ

### ยังทำไม่ได้ (ข้อจำกัดจริง ไม่ใช่ของค้าง)

`ok: true` จาก agent แปลว่า **spooler รับงานแล้ว** ไม่ได้การันตีว่าหมึกลงกระดาษครบทุกดวง
(กระดาษหมดกลางม้วนก็ยังนับว่า spooler รับงานสำเร็จ) — กรณีที่เจอบ่อยอย่างเครื่องออฟไลน์หรือ
กระดาษหมด ถูกดักไว้ก่อนส่งแล้วด้วย `checkPrinterStatus` แต่ถ้าอยากรู้ผลจริงระดับดวง
ต้องใช้เครื่องพิมพ์ที่มีช่องทางอ่านสถานะกลับ (LAN/serial) ซึ่ง USB อย่างเดียวทำไม่ได้

### ถ้าวันหนึ่งซื้อโมดูล LAN

เปลี่ยนแค่ `print-agent/src/printers.js` ให้เปิด TCP socket ไป `printer-ip:9100` แทนการเรียก
PowerShell — ส่วนที่เหลือใช้ต่อได้ทั้งหมด และจะได้สถานะกลับจากเครื่องพิมพ์ด้วย

---

**ข้อเท็จจริงที่ต้องยอมรับ:** เว็บที่ host บนคลาวด์ *ไม่มีทาง* สั่งพิมพ์เงียบ ๆ เข้าเครื่องพิมพ์ USB
โดยไม่มีอะไรรันอยู่บนเครื่องนั้นเลย — ตัวเลือกมีแค่ QZ Tray / agent ของเราเอง / PrintNode / WebUSB
(ซึ่งพังไดรเวอร์) เท่านั้น ปุ่ม "ปริ้นผ่าน Browser" จึงยังเก็บไว้เป็นทางสำรองที่ไม่ต้องลงอะไรเลย

---

### อ้างอิง

- [XP-420B official spec — Xprinter](https://www.xprintertech.com/xp-420b-thermal-label-printer.html)
- [XP-420B setup guide](https://electronics.alibaba.com/buyingguides/xp-420b-label-printer-guide-setup,-drivers-real-world-use)
- [WebUSB driver support on Windows — WICG/webusb#199](https://github.com/WICG/webusb/issues/199)
- [Zadig/WinUSB จะแทนที่ไดรเวอร์เดิมของเครื่องพิมพ์](https://support.dutchie.com/hc/en-us/articles/29384799104531-Install-the-required-driver-for-connecting-WebUSB-printers-to-Dutchie-POS-Windows-only)
