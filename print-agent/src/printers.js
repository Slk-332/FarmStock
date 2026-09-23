const os   = require('os')
const fs   = require('fs')
const path = require('path')
const crypto = require('crypto')
const { runPowerShell, psQuote } = require('./powershell')

// Win32_Printer.PrinterStatus
const PRINTER_STATUS = {
  1: 'other', 2: 'unknown', 3: 'idle', 4: 'printing',
  5: 'warmup', 6: 'stopped', 7: 'offline',
}

// Win32_Printer.DetectedErrorState
const ERROR_STATE = {
  0: null,               1: 'ข้อผิดพลาดอื่น ๆ', 2: null,
  3: 'กระดาษใกล้หมด',    4: 'กระดาษหมด',        5: 'หมึกใกล้หมด',
  6: 'หมึกหมด',          7: 'ฝาเครื่องเปิดอยู่', 8: 'กระดาษติด',
  9: 'เครื่องออฟไลน์',   10: 'ต้องการการซ่อมบำรุง', 11: 'ถาดรับกระดาษเต็ม',
}

/** ดึงรายชื่อเครื่องพิมพ์ทั้งหมดที่ Windows รู้จัก */
async function listPrinters() {
  const script = `
$ErrorActionPreference = 'Stop'
$list = @(Get-CimInstance -ClassName Win32_Printer |
  Select-Object Name, Default, PrinterStatus, WorkOffline, DetectedErrorState, PortName, DriverName)
ConvertTo-Json -InputObject $list -Depth 3 -Compress
`
  const stdout = await runPowerShell(script)
  const text = stdout.trim()
  if (!text) return []

  let parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) parsed = [parsed]

  return parsed.map((p) => ({
    name:        p.Name,
    isDefault:   Boolean(p.Default),
    port:        p.PortName || null,
    driver:      p.DriverName || null,
    status:      PRINTER_STATUS[p.PrinterStatus] || 'unknown',
    offline:     Boolean(p.WorkOffline) || p.PrinterStatus === 7,
    errorState:  ERROR_STATE[p.DetectedErrorState] || null,
  }))
}

/** เช็คว่าเครื่องพิมพ์ชื่อนี้มีอยู่จริงและพร้อมพิมพ์ไหม */
async function checkPrinter(name) {
  const printers = await listPrinters()
  const found = printers.find((p) => p.name === name)

  if (!found) {
    const names = printers.map((p) => p.name).join(', ') || '(ไม่พบเครื่องพิมพ์เลย)'
    throw new Error(`ไม่พบเครื่องพิมพ์ชื่อ "${name}" — ที่มีอยู่: ${names}`)
  }
  if (found.offline) {
    throw new Error(`เครื่องพิมพ์ "${name}" ออฟไลน์อยู่ (เช็คสาย USB / เปิดเครื่องหรือยัง)`)
  }
  if (found.errorState) {
    throw new Error(`เครื่องพิมพ์ "${name}" ไม่พร้อม: ${found.errorState}`)
  }
  return found
}

/**
 * ส่ง byte ดิบ ๆ เข้า Windows print spooler ด้วย datatype RAW
 * (winspool.drv: OpenPrinter → StartDocPrinter → WritePrinter → EndDocPrinter)
 *
 * datatype RAW แปลว่า driver จะไม่แตะข้อมูลเลย ส่งตรงเข้าเครื่องพิมพ์
 * ทำให้ส่งคำสั่ง TSPL ได้ โดยที่เครื่องพิมพ์ยังอยู่ในรายการ Printer ของ Windows ตามปกติ
 */
async function sendRaw(printerName, buffer, docName = 'FarmStock Labels') {
  const tmpFile = path.join(
    os.tmpdir(),
    `farmstock-print-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.bin`
  )
  fs.writeFileSync(tmpFile, buffer)

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class FarmStockRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static int SendFile(string printerName, string filePath, string docName)
    {
        byte[] bytes = System.IO.File.ReadAllBytes(filePath);
        IntPtr hPrinter = IntPtr.Zero;

        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("OpenPrinter failed, win32 error " + Marshal.GetLastWin32Error());

        try
        {
            DOCINFOW di = new DOCINFOW();
            di.pDocName = docName;
            di.pDataType = "RAW";

            if (!StartDocPrinter(hPrinter, 1, di))
                throw new Exception("StartDocPrinter failed, win32 error " + Marshal.GetLastWin32Error());

            try
            {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("StartPagePrinter failed, win32 error " + Marshal.GetLastWin32Error());

                IntPtr unmanaged = Marshal.AllocCoTaskMem(bytes.Length);
                try
                {
                    Marshal.Copy(bytes, 0, unmanaged, bytes.Length);
                    int written = 0;
                    if (!WritePrinter(hPrinter, unmanaged, bytes.Length, out written))
                        throw new Exception("WritePrinter failed, win32 error " + Marshal.GetLastWin32Error());
                    if (written != bytes.Length)
                        throw new Exception("WritePrinter wrote " + written + " of " + bytes.Length + " bytes");
                }
                finally { Marshal.FreeCoTaskMem(unmanaged); }

                EndPagePrinter(hPrinter);
            }
            finally { EndDocPrinter(hPrinter); }
        }
        finally { ClosePrinter(hPrinter); }

        return bytes.Length;
    }
}
"@
$written = [FarmStockRawPrinter]::SendFile(${psQuote(printerName)}, ${psQuote(tmpFile)}, ${psQuote(docName)})
Write-Output $written
`

  try {
    const stdout = await runPowerShell(script, { timeout: 120000 })
    const written = parseInt(stdout.trim(), 10)
    return { bytesWritten: Number.isFinite(written) ? written : buffer.length }
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {})
  }
}

module.exports = { listPrinters, checkPrinter, sendRaw }
