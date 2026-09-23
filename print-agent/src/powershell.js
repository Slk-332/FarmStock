const { execFile } = require('child_process')

const PS_EXE = process.env.FARMSTOCK_PS_EXE || 'powershell.exe'

/**
 * รัน PowerShell ผ่าน -EncodedCommand (base64 ของ UTF-16LE)
 * ใช้วิธีนี้เพื่อ:
 *   - ไม่ต้องเขียนไฟล์ .ps1 ลงดิสก์ จึงไม่ติด ExecutionPolicy
 *   - ไม่ต้องกังวลเรื่อง quote/escape ตอนส่ง argument ผ่าน command line
 */
function runPowerShell(script, { timeout = 30000 } = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      PS_EXE,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || stdout || err.message || '').trim()
          return reject(new Error(detail || `PowerShell ล้มเหลว (exit ${err.code})`))
        }
        resolve(stdout)
      }
    )
  })
}

/** escape ข้อความให้ใส่ใน single-quoted string ของ PowerShell ได้อย่างปลอดภัย */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

module.exports = { runPowerShell, psQuote }
