/**
 * ทางสำรองเมื่อไม่มี Print Agent — สั่งพิมพ์ผ่าน print dialog ของเบราว์เซอร์
 *
 * เขียนใหม่จากของเดิมที่ใช้ window.open + setTimeout ซึ่งมีปัญหา:
 *   - window.open โดน popup blocker
 *   - setTimeout(500) เดาเวลา บางทีรูปยังโหลดไม่เสร็จก็สั่งพิมพ์ไปแล้ว
 *   - printWin.close() ปิดหน้าต่างก่อน spool เสร็จ
 *
 * ของใหม่: hidden iframe (ไม่โดน popup blocker) + รอ img.decode() ทุกใบ + รอ event afterprint
 */

const PRINT_TIMEOUT_MS = 120000

/**
 * @param {{dataUrl: string}[]} labels  ฉลากที่เรนเดอร์เป็นรูปแล้ว (ใช้ renderer ตัวเดียวกับที่ส่งเข้า agent)
 * @param {{widthMm: number, heightMm: number}} size
 * @returns {Promise<void>} resolve เมื่อ print dialog ปิด (ไม่ได้แปลว่าผู้ใช้กดยืนยัน)
 */
export function printViaBrowser(labels, { widthMm, heightMm }) {
  return new Promise((resolve, reject) => {
    if (!labels.length) return resolve()

    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    document.body.appendChild(iframe)

    let settled = false
    let timer = null

    const cleanup = () => {
      clearTimeout(timer)
      // หน่วงก่อนถอด iframe เพื่อให้ spooler อ่านข้อมูลเสร็จก่อน
      setTimeout(() => iframe.remove(), 1000)
    }
    const finish = (err) => {
      if (settled) return
      settled = true
      cleanup()
      err ? reject(err) : resolve()
    }

    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>FarmStock Labels</title>
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; }
  .label {
    width: ${widthMm}mm;
    height: ${heightMm}mm;
    page-break-after: always;
    break-after: page;
    overflow: hidden;
  }
  .label:last-child { page-break-after: auto; break-after: auto; }
  .label img {
    width: ${widthMm}mm;
    height: ${heightMm}mm;
    display: block;
    /* ห้ามเบลอ — บิตแมปถูกเรนเดอร์มาที่ความละเอียดหัวพิมพ์พอดีแล้ว */
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }
</style></head><body>
${labels.map((l) => `<div class="label"><img src="${l.dataUrl}" alt=""></div>`).join('\n')}
</body></html>`)
    doc.close()

    timer = setTimeout(() => finish(new Error('หมดเวลารอ print dialog')), PRINT_TIMEOUT_MS)

    const start = async () => {
      try {
        const win = iframe.contentWindow
        // รอให้รูปทุกใบพร้อมจริง ๆ แทนการเดาเวลา
        const imgs = Array.from(doc.images)
        await Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())))

        win.addEventListener('afterprint', () => finish(), { once: true })
        // Safari ไม่ยิง afterprint — ใช้ matchMedia สำรอง
        const mql = win.matchMedia?.('print')
        mql?.addEventListener?.('change', (e) => { if (!e.matches) finish() }, { once: true })

        win.focus()
        win.print()
      } catch (err) {
        finish(err)
      }
    }

    // รอให้ iframe render เสร็จก่อนค่อยเรียก print
    if (doc.readyState === 'complete') start()
    else iframe.addEventListener('load', start, { once: true })
  })
}
