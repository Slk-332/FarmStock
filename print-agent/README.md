# FarmStock Print Agent

โปรแกรมเล็ก ๆ ที่รันบนเครื่อง PC ที่ต่อเครื่องพิมพ์ฉลาก ทำหน้าที่รับข้อมูลฉลากจากหน้าเว็บ FarmStock
แล้วส่งคำสั่ง TSPL ดิบ ๆ เข้าเครื่องพิมพ์ **ใช้แทน QZ Tray**

```
FarmStock บน Vercel (https)
          │  POST http://127.0.0.1:9110/print
          ▼
   Print Agent (เครื่องนี้)
          │  raw TSPL ผ่าน Windows spooler (datatype RAW)
          ▼
   Xprinter XP-420B (USB)
```

## ทำไมถึงไม่ใช้ QZ Tray

| | QZ Tray | Print Agent ตัวนี้ |
|---|---|---|
| หน้าต่าง "Untrusted website" | เด้งทุกครั้ง ถ้าไม่ซื้อ license | ไม่มี |
| License | AGPL — ใช้เชิงพาณิชย์ต้องซื้อ | เป็นโค้ดของเราเอง |
| ความคมของฉลาก | เรนเดอร์ HTML เป็นบิตแมป เบลอ | เว็บวาดที่ 203 DPI พอดี ส่งบิตแมปตรง ๆ |
| พิมพ์ 100 ดวง | 100 job ใน spooler | 1 job |
| รู้ว่าพิมพ์สำเร็จไหม | ไม่รู้ | คืน `printedIds` ของงานที่ spooler รับจริง |
| ต้องลง Java | ต้อง | ไม่ต้อง (ใช้ Node + PowerShell ที่มีอยู่แล้วใน Windows) |

**เครื่องพิมพ์ยังอยู่ในรายการ Printer ของ Windows ตามปกติ** เพราะส่งผ่าน spooler ด้วย datatype `RAW`
ไม่ได้ไปยุ่งกับไดรเวอร์ (ต่างจากวิธี WebUSB ที่ต้องใช้ Zadig แทนไดรเวอร์แล้วเครื่องพิมพ์จะหายไปจากระบบ)

## ความต้องการ

- Windows (ใช้ `winspool.drv` ผ่าน PowerShell)
- Node.js 18 ขึ้นไป
- เครื่องพิมพ์ติดตั้งไดรเวอร์ใน Windows เรียบร้อยแล้ว และพิมพ์หน้าทดสอบจาก Windows ได้

**ไม่มี dependency จาก npm เลย** — ก๊อปโฟลเดอร์นี้ไปวางแล้วรันได้ทันที ไม่ต้อง `npm install`

## ติดตั้ง

### 1. หาชื่อเครื่องพิมพ์

```powershell
node index.js --list-printers
```

จะได้ประมาณนี้:

```
เครื่องพิมพ์ที่ Windows รู้จัก:

  • Xprinter XP-420B
      port: USB001  สถานะ: idle  [ค่าเริ่มต้น]
```

### 2. แก้ `config.json`

รันครั้งแรก agent จะสร้าง `config.json` ให้จาก `config.example.json` แก้ 3 อย่างนี้:

```json
{
  "token": "สุ่มข้อความยาว ๆ มาใส่",
  "defaultPrinter": "Xprinter XP-420B",
  "allowedOrigins": ["https://ที่อยู่จริงของเว็บ.vercel.app"]
}
```

| ค่า | ความหมาย |
|---|---|
| `host` | `127.0.0.1` = รับเฉพาะโปรแกรมบนเครื่องนี้ **อย่าเปลี่ยนเป็น 0.0.0.0** ถ้าไม่จำเป็น |
| `port` | พอร์ตที่ agent ฟัง (ต้องตรงกับที่กรอกในหน้าเว็บ) |
| `token` | กันเว็บอื่นสั่งพิมพ์ ต้องกรอกให้ตรงกันในหน้า Print → ⚙️ ตั้งค่า |
| `allowedOrigins` | รายการเว็บที่อนุญาต ปล่อยเป็น `[]` = อนุญาตทุกเว็บ (ไม่แนะนำ) |
| `maxLabelsPerJob` | กันกดพลาดแล้วพิมพ์ทีละพันดวง |
| `checkPrinterStatus` | เช็คว่าเครื่องพิมพ์ออนไลน์/กระดาษหมดไหม ก่อนส่งงาน |

### 3. ทดสอบ

```powershell
node index.js --self-test
```

ควรมีฉลากคำว่า **FarmStock OK** ออกมาจากเครื่องพิมพ์
ถ้าออก แปลว่าเส้นทาง Node → PowerShell → spooler → เครื่องพิมพ์ ใช้ได้แล้ว

### 4. รัน

```powershell
node index.js
```

แล้วเปิดหน้า Print ในเว็บ FarmStock — ควรขึ้น **Print Agent: พร้อม ✅**
ถ้า agent ตั้ง token ไว้ ให้กด ⚙️ ตั้งค่า แล้วกรอก token ให้ตรงกัน (เก็บไว้ในเบราว์เซอร์เครื่องนั้น)

## ให้เปิดเองตอนบูต (Windows Service)

ใช้ [NSSM](https://nssm.cc/download) — ง่ายและเสถียรที่สุด

```powershell
# รันใน PowerShell แบบ Run as Administrator
nssm install FarmStockPrintAgent "C:\Program Files\nodejs\node.exe" "C:\FarmStock\print-agent\index.js"
nssm set FarmStockPrintAgent AppDirectory "C:\FarmStock\print-agent"
nssm set FarmStockPrintAgent AppStdout "C:\FarmStock\print-agent\agent.log"
nssm set FarmStockPrintAgent AppStderr "C:\FarmStock\print-agent\agent.log"
nssm set FarmStockPrintAgent Start SERVICE_AUTO_START
nssm start FarmStockPrintAgent
```

> **สำคัญ:** service ต้องรันด้วยบัญชีผู้ใช้ที่ "มองเห็น" เครื่องพิมพ์ตัวนั้น
> ถ้าเครื่องพิมพ์ถูกติดตั้งแบบ per-user ให้ตั้งใน `nssm set FarmStockPrintAgent ObjectName .\ชื่อผู้ใช้ รหัสผ่าน`
> ไม่งั้น service จะมองไม่เห็นเครื่องพิมพ์ทั้งที่ตอนรันมือปกติดี

คำสั่งที่ใช้บ่อย:

```powershell
nssm restart FarmStockPrintAgent
nssm stop FarmStockPrintAgent
nssm remove FarmStockPrintAgent confirm
```

## API

ทุก endpoint ยกเว้น `/health` ต้องส่ง header `X-FarmStock-Token` ถ้า config ตั้ง token ไว้

### `GET /health`
เช็คว่า agent เปิดอยู่ไหม (ไม่ต้องใช้ token เพื่อให้หน้าเว็บตรวจได้)

```json
{ "ok": true, "version": "1.0.0", "defaultPrinter": "Xprinter XP-420B", "requiresToken": true }
```

### `GET /printers`
รายชื่อเครื่องพิมพ์พร้อมสถานะ (`idle` / `printing` / `offline`) และสาเหตุที่ไม่พร้อม เช่น กระดาษหมด

### `POST /print`

```json
{
  "printer": "Xprinter XP-420B",
  "widthMm": 40, "heightMm": 20, "gapMm": 2,
  "density": 8, "speed": 4,
  "labels": [
    { "id": 123,
      "bitmap": { "x": 0, "y": 0, "width": 320, "height": 160, "dataBase64": "..." } }
  ]
}
```

`dataBase64` = บิตแมป 1 บิต แพ็คตามแถว MSB ก่อน **bit 1 = จุดสีดำ**
(agent กลับบิตให้เองก่อนส่ง เพราะ TSPL ใช้ 0 = ดำ)

ตอบกลับ:

```json
{ "ok": true, "printer": "...", "printedIds": [123], "labels": 1, "bytesWritten": 6538 }
```

> **`ok: true` แปลว่า spooler รับงานไปแล้ว** ไม่ได้การันตีว่าหมึกลงกระดาษครบทุกดวง
> (กระดาษหมดกลางคันก็ยังนับว่า spooler รับงานสำเร็จ) แต่กรณีที่เจอบ่อยอย่างเครื่องออฟไลน์
> หรือกระดาษหมด `checkPrinterStatus` จะดักไว้ให้ก่อนส่งแล้ว

### `POST /self-test`
พิมพ์ฉลากทดสอบด้วยฟอนต์ในตัวเครื่อง ใช้แยกปัญหาว่าอยู่ฝั่งเครื่องพิมพ์หรือฝั่งเว็บ

## แก้ปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| หน้าเว็บขึ้น "ติดต่อ Print Agent ไม่ได้" | agent ไม่ได้เปิด / port ไม่ตรง / firewall บล็อก localhost |
| เบราว์เซอร์ error เรื่อง private network | ใช้ Chrome หรือ Edge (Firefox ยังไม่รองรับ Private Network Access) |
| `ไม่พบเครื่องพิมพ์ชื่อ ...` | ชื่อใน config ไม่ตรงเป๊ะ — เช็คด้วย `--list-printers` |
| self-test ออก แต่ฉลากจริงว่างเปล่า | ขนาด label ในเว็บไม่ตรงกับสติกเกอร์จริง ลองวัดใหม่ |
| ฉลากออกมาเป็นภาพกลับสี (พื้นดำ) | เครื่องพิมพ์ตีความ BITMAP mode ต่างไป — แก้ mode ใน `src/tspl.js` |
| ฉลากเลื่อน/ขาดครึ่ง | `gapMm` ไม่ตรงกับระยะห่างสติกเกอร์จริง หรือยังไม่ได้ calibrate เครื่อง |
| service รันแต่พิมพ์ไม่ออก | service รันด้วยบัญชีที่มองไม่เห็นเครื่องพิมพ์ (ดูหัวข้อ Windows Service) |

ดู log ได้จาก console หรือไฟล์ที่ตั้งไว้ใน nssm

## โครงสร้างโค้ด

```
index.js              จุดเริ่ม + คำสั่ง CLI (--list-printers, --self-test)
src/config.js         โหลด/สร้าง config.json
src/server.js         HTTP API + CORS + Private Network Access + token
src/tspl.js           แปลง job → คำสั่ง TSPL (ที่เดียวที่รู้เรื่องภาษาเครื่องพิมพ์)
src/printers.js       คุยกับ Windows: list printer, เช็คสถานะ, เขียน raw ผ่าน winspool.drv
src/powershell.js     ตัวรัน PowerShell แบบ -EncodedCommand
```

เทสต์ของท่อส่งข้อมูล (การเรียงบิต → TSPL) อยู่ที่ `frontend/test/label-pipeline.test.mjs`
รันด้วย `npm test` ในโฟลเดอร์ `frontend`

## ถ้าวันหนึ่งซื้อโมดูล LAN มาใส่

เปลี่ยนแค่ `src/printers.js` ให้เปิด TCP socket ไปที่ `printer-ip:9100` แล้วเขียน buffer ตรง ๆ
แทนการเรียก PowerShell — ส่วนที่เหลือทั้งหมดใช้ต่อได้เลย
