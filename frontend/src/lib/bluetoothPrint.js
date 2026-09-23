/**
 * พิมพ์ผ่าน Bluetooth ตรงจากเบราว์เซอร์ (Web Bluetooth)
 *
 * ใช้ได้กับ Chrome/Edge บน Android, Windows, macOS, ChromeOS เท่านั้น
 * iPhone/iPad ใช้ไม่ได้ — Safari ไม่มี Web Bluetooth และทุกเบราว์เซอร์บน iOS ก็คือ Safari
 * ต้องเปิดเว็บผ่าน https (หรือ localhost) ด้วย
 *
 * เครื่องพิมพ์พกพาจีนแทบทุกยี่ห้อเปิด BLE service แบบ "serial" ไว้ให้เขียน byte ดิบเข้าไป
 * แต่ละยี่ห้อใช้ UUID ต่างกัน — Web Bluetooth บังคับให้ประกาศ service ที่จะใช้ล่วงหน้า
 * จึงต้องรวม UUID ที่รู้จักไว้ใน KNOWN_SERVICES แล้วหา characteristic ที่เขียนได้เอง
 */

const KNOWN_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Xprinter / Gprinter / เครื่องจีนทั่วไป (char 2af1)
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Xprinter / HPRT / Rongta
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip ISSC transparent UART
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style serial
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ae3a-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
]

const STORAGE_KEY = 'farmstock.bluetoothPrinter'

const DEFAULT_SETTINGS = {
  protocol:  'tspl',
  chunkSize: 180,  // byte ต่อครั้ง — ถ้าพิมพ์ออกมาแหว่ง/ค้างให้ลดลงเหลือ 20
  density:   8,
  speed:     3,
  gapMm:     2,
}

export function isBluetoothSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

/** บอกเหตุผลที่ใช้ไม่ได้เป็นภาษาคน — iOS เป็นเคสที่เจอบ่อยสุด */
export function bluetoothUnsupportedReason() {
  if (isBluetoothSupported()) return null
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return 'iPhone/iPad ไม่รองรับการพิมพ์ Bluetooth จากเว็บ — ใช้มือถือ/แท็บเล็ต Android หรือคอมพิวเตอร์ที่เปิดด้วย Chrome แทน'
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'ต้องเปิดเว็บผ่าน https ถึงจะใช้ Bluetooth ได้'
  }
  return 'เบราว์เซอร์นี้ไม่รองรับ Bluetooth — ใช้ Google Chrome หรือ Microsoft Edge'
}

export function getBluetoothSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveBluetoothSettings(patch) {
  const next = { ...getBluetoothSettings(), ...patch }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* โหมด private อาจเขียนไม่ได้ */ }
  return next
}

/* ---------- การเชื่อมต่อ ---------- */

// เก็บไว้ระดับ module — เปลี่ยนหน้าไปมาแล้วยังต่อค้างอยู่ ไม่ต้องจับคู่ใหม่ทุกครั้ง
let current = null // { device, characteristic }
const disconnectListeners = new Set()

/** ให้หน้าจอรู้ตัวเมื่อเครื่องพิมพ์หลุด (ปิดเครื่อง/เดินออกนอกระยะ) — คืนฟังก์ชันยกเลิก */
export function onBluetoothDisconnect(listener) {
  disconnectListeners.add(listener)
  return () => disconnectListeners.delete(listener)
}

function handleGattDisconnected() {
  disconnectListeners.forEach((fn) => fn())
}

export function getConnectedPrinter() {
  if (!current?.device?.gatt?.connected) return null
  return { name: current.device.name || 'เครื่องพิมพ์ Bluetooth', id: current.device.id }
}

async function findWritableCharacteristic(server) {
  let services
  try {
    services = await server.getPrimaryServices()
  } catch (err) {
    throw new Error('อ่านข้อมูลเครื่องพิมพ์ไม่ได้ — ลองปิด-เปิดเครื่องพิมพ์แล้วเชื่อมต่อใหม่', { cause: err })
  }

  // เลือกตัวที่ "เขียนแบบไม่ต้องรอตอบ" ก่อน เพราะเร็วกว่ามาก พิมพ์บิตแมปทีละหลาย KB
  let fallback = null
  for (const service of services) {
    let chars
    try { chars = await service.getCharacteristics() } catch { continue }
    for (const c of chars) {
      if (c.properties.writeWithoutResponse) return c
      if (c.properties.write && !fallback) fallback = c
    }
  }
  if (fallback) return fallback
  throw new Error('เครื่องนี้ไม่มีช่องให้ส่งข้อมูลพิมพ์ — อาจไม่ใช่เครื่องพิมพ์ หรือเป็นรุ่นที่ใช้ Bluetooth แบบเก่า (Classic) ซึ่งเว็บต่อไม่ได้')
}

async function openGatt(device) {
  // removeEventListener ก่อน กันผูกซ้ำเวลาต่อเครื่องเดิมหลายรอบ
  device.removeEventListener('gattserverdisconnected', handleGattDisconnected)
  device.addEventListener('gattserverdisconnected', handleGattDisconnected)
  const server = await device.gatt.connect()
  const characteristic = await findWritableCharacteristic(server)
  current = { device, characteristic }
  return getConnectedPrinter()
}

/** เปิดหน้าต่างเลือกเครื่อง — ต้องเรียกจากการกดปุ่มเท่านั้น (เบราว์เซอร์บังคับ) */
export async function connectBluetoothPrinter() {
  if (!isBluetoothSupported()) throw new Error(bluetoothUnsupportedReason())

  let device
  try {
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: KNOWN_SERVICES,
    })
  } catch (err) {
    if (err.name === 'NotFoundError') throw new Error('ยังไม่ได้เลือกเครื่องพิมพ์', { cause: err })
    throw err
  }

  if (current?.device && current.device !== device) disconnectBluetoothPrinter()
  try {
    return await openGatt(device)
  } catch (err) {
    try { device.gatt.disconnect() } catch { /* ไม่ได้ต่ออยู่แล้ว */ }
    throw err
  }
}

/**
 * ต่อเครื่องเดิมที่เคยอนุญาตไว้แบบเงียบ ๆ (ไม่เด้งหน้าต่าง)
 * ใช้ได้เฉพาะ Chrome ที่มี getDevices — ถ้าไม่มีก็คืน null ให้ผู้ใช้กดเชื่อมต่อเอง
 */
export async function reconnectBluetoothPrinter() {
  if (getConnectedPrinter()) return getConnectedPrinter()
  if (current?.device) {
    try { return await openGatt(current.device) } catch { /* ลองทางอื่นต่อ */ }
  }
  if (!navigator.bluetooth?.getDevices) return null
  try {
    const devices = await navigator.bluetooth.getDevices()
    for (const device of devices) {
      try { return await openGatt(device) } catch { /* เครื่องนี้ปิดอยู่ ลองตัวถัดไป */ }
    }
  } catch { /* ไม่ได้รับสิทธิ์ */ }
  return null
}

export function disconnectBluetoothPrinter() {
  try { current?.device?.gatt?.disconnect() } catch { /* ไม่ได้ต่ออยู่แล้ว */ }
  current = null
}

/* ---------- ส่งข้อมูล ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * เขียน byte ทั้งหมดเข้าเครื่องพิมพ์ทีละก้อน
 * BLE ส่งได้ทีละไม่กี่ร้อย byte และเครื่องพกพาบัฟเฟอร์เล็ก ถ้ายัดเร็วเกินจะทำข้อมูลหาย
 * → แบบไม่รอตอบต้องเว้นจังหวะนิดหน่อยทุกก้อน
 */
export async function writeToBluetoothPrinter(bytes, { chunkSize = 180, onProgress } = {}) {
  if (!getConnectedPrinter()) {
    const again = await reconnectBluetoothPrinter()
    if (!again) throw new Error('ยังไม่ได้เชื่อมต่อเครื่องพิมพ์ Bluetooth')
  }
  const { characteristic } = current
  let size = Math.max(20, Math.min(512, Math.round(Number(chunkSize)) || 180))
  const noResponse = characteristic.properties.writeWithoutResponse

  const writeChunk = async (chunk) => {
    if (noResponse) {
      await characteristic.writeValueWithoutResponse(chunk)
      await sleep(8)
    } else {
      await characteristic.writeValueWithResponse(chunk)
    }
  }

  for (let offset = 0; offset < bytes.length; offset += size) {
    try {
      await writeChunk(bytes.subarray(offset, offset + size))
    } catch (err) {
      // เครื่องรุ่นเก่ารับได้แค่ 20 byte/ครั้ง (MTU ต่ำสุดของ BLE) — ลดขนาดแล้วลองก้อนเดิมใหม่
      if (size > 20) {
        size = 20
        offset -= size
        continue
      }
      throw new Error(`ส่งข้อมูลไม่สำเร็จที่ byte ${offset}/${bytes.length} — ${err.message}`, { cause: err })
    }
    onProgress?.(Math.min(offset + size, bytes.length), bytes.length)
  }
}
