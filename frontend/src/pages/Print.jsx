import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import api from '../api/axios'
import { buildLabelPayload, renderLabelCanvas } from '../lib/labelRender'
import { printViaBrowser } from '../lib/browserPrint'
import {
  getAgentSettings, saveAgentSettings, checkAgent,
  fetchPrinters, selfTest, sendPrintJob, DEFAULT_AGENT_URL,
} from '../lib/printAgent'
import {
  bluetoothUnsupportedReason, getBluetoothSettings, saveBluetoothSettings,
  connectBluetoothPrinter, reconnectBluetoothPrinter, disconnectBluetoothPrinter,
  getConnectedPrinter, onBluetoothDisconnect, writeToBluetoothPrinter,
} from '../lib/bluetoothPrint'
import { PROTOCOLS, buildJob as buildPrinterJob, buildSelfTest as buildPrinterSelfTest } from '../lib/printerCommands'

const SIZE_PRESETS = [[40, 20], [50, 40], [60, 40], [80, 50], [100, 70]]
const RENDER_CHUNK = 10 // เรนเดอร์ทีละกี่ดวงก่อนคืน event loop ให้ UI ไม่ค้าง
const METHOD_KEY = 'farmstock.printMethod'

/** มือถือ/แท็บเล็ตไม่มี Print Agent อยู่แล้ว เริ่มที่ Bluetooth เลย */
function initialMethod() {
  try {
    const saved = localStorage.getItem(METHOD_KEY)
    if (saved === 'agent' || saved === 'bluetooth') return saved
  } catch { /* อ่าน storage ไม่ได้ ใช้ค่าเดาแทน */ }
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  return touch ? 'bluetooth' : 'agent'
}

export default function Print() {
  const [items,    setItems]    = useState([])
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [expanded, setExpanded] = useState(new Set())

  const [labelW, setLabelW] = useState(40)
  const [labelH, setLabelH] = useState(20)

  const [settings,    setSettings]    = useState(getAgentSettings)
  const [agentStatus, setAgentStatus] = useState('checking') // checking | online | offline
  const [agentInfo,   setAgentInfo]   = useState(null)
  const [printers,    setPrinters]    = useState([])
  const [showConfig,  setShowConfig]  = useState(false)

  const [method,     setMethodState] = useState(initialMethod)
  const [btSettings, setBtSettings]  = useState(getBluetoothSettings)
  const [btPrinter,  setBtPrinter]   = useState(getConnectedPrinter)
  const [btBusy,     setBtBusy]      = useState(false)
  const btUnsupported = useMemo(() => bluetoothUnsupportedReason(), [])

  const [printing, setPrinting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [msg,      setMsg]      = useState(null) // { type: 'ok'|'err'|'info', text }

  const previewRef = useRef(null)

  /* ---------- ข้อมูล item ---------- */

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/items', { params: { search } })
      setItems(res.data)
    } catch {
      setMsg({ type: 'err', text: 'โหลดรายการไม่สำเร็จ' })
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    const delay = setTimeout(fetchItems, 300)
    return () => clearTimeout(delay)
  }, [fetchItems])

  /* ---------- Print Agent ---------- */

  const connectAgent = useCallback(async (override) => {
    const cfg = override || settings
    try {
      const health = await checkAgent(cfg)
      setAgentInfo(health)
      setAgentStatus('online')

      const list = await fetchPrinters(cfg)
      setPrinters(list.printers || [])

      // ถ้ายังไม่ได้เลือกเครื่องพิมพ์ ใช้ค่าจาก agent หรือเครื่องที่ Windows ตั้งเป็น default
      if (!cfg.printer) {
        const fallback = health.defaultPrinter
          || list.printers?.find((p) => p.isDefault)?.name
          || list.printers?.[0]?.name
        if (fallback) setSettings(saveAgentSettings({ printer: fallback }))
      }
      return true
    } catch (err) {
      setAgentStatus('offline')
      setAgentInfo(null)
      setPrinters([])
      setMsg({ type: 'info', text: err.message })
      return false
    }
  }, [settings])

  /** ปุ่ม "เชื่อมต่อใหม่" — ต่างจาก connectAgent ตรงที่กลับไปขึ้นสถานะ "กำลังตรวจสอบ" ก่อน */
  const reconnectAgent = () => {
    setAgentStatus('checking')
    connectAgent()
  }

  useEffect(() => {
    // เช็คครั้งเดียวตอนเลือกโหมด Agent — หลังจากนั้นผู้ใช้กดปุ่มเชื่อมต่อใหม่เอง
    // (สถานะเริ่มต้นเป็น 'checking' อยู่แล้ว จึงไม่ต้อง setState ตรงนี้)
    if (method === 'agent' && agentStatus === 'checking') connectAgent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method])

  const setMethod = (next) => {
    setMethodState(next)
    try { localStorage.setItem(METHOD_KEY, next) } catch { /* ไม่เป็นไร แค่จำไม่ได้ */ }
  }

  /* ---------- Bluetooth ---------- */

  useEffect(() => onBluetoothDisconnect(() => setBtPrinter(null)), [])

  useEffect(() => {
    // เคยอนุญาตเครื่องไว้แล้ว ลองต่อให้เองแบบเงียบ ๆ จะได้ไม่ต้องกดเลือกเครื่องทุกครั้ง
    if (method !== 'bluetooth' || btUnsupported || getConnectedPrinter()) return
    let cancelled = false
    reconnectBluetoothPrinter().then((p) => { if (!cancelled && p) setBtPrinter(p) })
    return () => { cancelled = true }
  }, [method, btUnsupported])

  const updateBtSetting = (patch) => setBtSettings(saveBluetoothSettings(patch))

  const handleBtConnect = async () => {
    setBtBusy(true)
    setMsg(null)
    try {
      const printer = await connectBluetoothPrinter()
      setBtPrinter(printer)
      setMsg({ type: 'ok', text: `เชื่อมต่อ "${printer.name}" แล้ว` })
    } catch (err) {
      setMsg({ type: 'err', text: `เชื่อมต่อไม่สำเร็จ: ${err.message}` })
    } finally {
      setBtBusy(false)
    }
  }

  const handleBtDisconnect = () => {
    disconnectBluetoothPrinter()
    setBtPrinter(null)
  }

  const handleBtSelfTest = async () => {
    setBtBusy(true)
    try {
      setMsg({ type: 'info', text: 'กำลังส่งฉลากทดสอบ...' })
      const bytes = buildPrinterSelfTest(btSettings.protocol, { widthMm: labelW, heightMm: labelH, gapMm: Number(btSettings.gapMm) })
      await writeToBluetoothPrinter(bytes, { chunkSize: btSettings.chunkSize })
      setMsg({ type: 'ok', text: 'ส่งฉลากทดสอบแล้ว — ถ้าไม่มีอะไรออกมา ลองเปลี่ยนภาษาเครื่องพิมพ์ (TSPL ↔ ESC/POS)' })
    } catch (err) {
      setMsg({ type: 'err', text: `ทดสอบไม่สำเร็จ: ${err.message}` })
    } finally {
      setBtBusy(false)
    }
  }

  const updateSetting = (patch) => setSettings(saveAgentSettings(patch))

  /* ---------- เลือก item ---------- */

  const groupedByLot = useMemo(() => items.reduce((acc, item) => {
    const key = item.lot_id
    if (!acc[key]) acc[key] = { lot_no: item.lot_no, product_name: item.product_name, mat_uid: item.mat_uid, items: [] }
    acc[key].items.push(item)
    return acc
  }, {}), [items])

  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected])

  const toggleLot = (lotItems) => {
    const next = new Set(selected)
    const allSelected = lotItems.every((i) => next.has(i.id))
    lotItems.forEach((i) => (allSelected ? next.delete(i.id) : next.add(i.id)))
    setSelected(next)
  }

  const toggleItem = (id) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  const toggleExpand = (lotId) => {
    const next = new Set(expanded)
    next.has(lotId) ? next.delete(lotId) : next.add(lotId)
    setExpanded(next)
  }

  const selectAll = () => setSelected(new Set(items.map((i) => i.id)))
  const clearAll  = () => setSelected(new Set())

  /* ---------- preview ---------- */

  const scanUrlFor = (item) => `${window.location.origin}/scan/${item.item_id}`

  const [previewInfo, setPreviewInfo] = useState(null)

  useEffect(() => {
    const item = selectedItems[0]
    const canvas = previewRef.current
    if (!item || !canvas) {
      setPreviewInfo(null)
      return
    }
    try {
      const { qr, widthDots, heightDots } = renderLabelCanvas(item, {
        widthMm: labelW, heightMm: labelH, scanUrl: scanUrlFor(item), canvas,
      })
      setPreviewInfo({ qr, widthDots, heightDots, itemId: item.item_id })
    } catch {
      setPreviewInfo(null)
    }
  }, [selectedItems, labelW, labelH])

  /* ---------- เรนเดอร์ฉลากทั้งชุด ---------- */

  const renderAll = async (list) => {
    const payloads = []
    for (let i = 0; i < list.length; i++) {
      payloads.push(buildLabelPayload(list[i], {
        widthMm: labelW, heightMm: labelH, scanUrl: scanUrlFor(list[i]),
      }))
      if (i % RENDER_CHUNK === RENDER_CHUNK - 1) {
        setProgress({ phase: 'render', done: i + 1, total: list.length })
        await new Promise((r) => setTimeout(r, 0)) // คืน event loop ให้ UI วาดได้
      }
    }
    return payloads
  }

  /* ---------- พิมพ์ผ่าน agent ---------- */

  const handlePrintAgent = async () => {
    if (!selectedItems.length || printing) return
    if (agentStatus !== 'online') {
      setMsg({ type: 'err', text: 'Print Agent ยังไม่ได้เชื่อมต่อ' })
      return
    }
    if (!settings.printer) {
      setMsg({ type: 'err', text: 'ยังไม่ได้เลือกเครื่องพิมพ์' })
      return
    }

    setPrinting(true)
    setMsg(null)
    try {
      const payloads = await renderAll(selectedItems)

      setProgress({ phase: 'send', done: 0, total: selectedItems.length })
      const res = await sendPrintJob({
        printer:  settings.printer,
        widthMm:  labelW,
        heightMm: labelH,
        gapMm:    Number(settings.gapMm),
        density:  Number(settings.density),
        speed:    Number(settings.speed),
        labels:   payloads.map((p) => p.label),
      }, settings)

      // mark เฉพาะ id ที่อยู่ในงานที่ spooler รับไปจริง ๆ
      const printedIds = res.printedIds || []
      if (printedIds.length) {
        await api.patch('/items/print', { ids: printedIds })
        await fetchItems()
        setSelected(new Set())
      }
      setMsg({
        type: 'ok',
        text: `ส่งเข้าเครื่องพิมพ์ "${res.printer}" แล้ว ${printedIds.length} ดวง (${(res.bytesWritten / 1024).toFixed(1)} KB)`,
      })
    } catch (err) {
      setMsg({ type: 'err', text: `พิมพ์ไม่สำเร็จ: ${err.message}` })
    } finally {
      setPrinting(false)
      setProgress(null)
    }
  }

  /* ---------- พิมพ์ผ่าน Bluetooth ---------- */

  const handlePrintBluetooth = async () => {
    if (!selectedItems.length || printing) return
    if (!btPrinter) {
      setMsg({ type: 'err', text: 'ยังไม่ได้เชื่อมต่อเครื่องพิมพ์ Bluetooth' })
      return
    }

    setPrinting(true)
    setMsg(null)
    try {
      const payloads = await renderAll(selectedItems)
      const bytes = buildPrinterJob(btSettings.protocol, {
        widthMm:  labelW,
        heightMm: labelH,
        gapMm:    Number(btSettings.gapMm),
        density:  Number(btSettings.density),
        speed:    Number(btSettings.speed),
        bitmaps:  payloads.map((p) => p.label.bitmap),
      })

      // ส่งทั้งชุดเป็นก้อนเดียว — แสดงความคืบหน้าเป็นจำนวนดวงโดยประมาณจากสัดส่วน byte
      const total = selectedItems.length
      setProgress({ phase: 'send', done: 0, total })
      await writeToBluetoothPrinter(bytes, {
        chunkSize: btSettings.chunkSize,
        onProgress: (sent, all) => setProgress({ phase: 'send', done: Math.floor((sent / all) * total), total }),
      })

      // ส่งครบทุก byte แล้วถึงค่อย mark — ถ้าหลุดกลางทางจะโยน error ก่อนถึงตรงนี้
      await api.patch('/items/print', { ids: selectedItems.map((i) => i.id) })
      await fetchItems()
      setSelected(new Set())
      setMsg({ type: 'ok', text: `ส่งเข้า "${btPrinter.name}" แล้ว ${total} ดวง (${(bytes.length / 1024).toFixed(1)} KB)` })
    } catch (err) {
      setMsg({ type: 'err', text: `พิมพ์ไม่สำเร็จ: ${err.message}` })
    } finally {
      setPrinting(false)
      setProgress(null)
    }
  }

  /* ---------- พิมพ์ผ่านเบราว์เซอร์ (ทางสำรอง) ---------- */

  const handlePrintBrowser = async () => {
    if (!selectedItems.length || printing) return

    setPrinting(true)
    setMsg(null)
    try {
      const payloads = await renderAll(selectedItems)
      setProgress({ phase: 'dialog', done: 0, total: selectedItems.length })

      await printViaBrowser(
        payloads.map((p) => ({ dataUrl: p.canvas.toDataURL('image/png') })),
        { widthMm: labelW, heightMm: labelH }
      )

      // เบราว์เซอร์ไม่บอกว่าผู้ใช้กดพิมพ์หรือกดยกเลิก จึงต้องถาม ไม่เดาเอาเอง
      const confirmed = window.confirm(
        `พิมพ์ออกมาครบ ${selectedItems.length} ดวงไหม?\n\nกด OK เพื่อบันทึกว่าพิมพ์แล้ว / กด Cancel ถ้ายกเลิกหรือพิมพ์ไม่ออก`
      )
      if (confirmed) {
        await api.patch('/items/print', { ids: selectedItems.map((i) => i.id) })
        await fetchItems()
        setSelected(new Set())
        setMsg({ type: 'ok', text: `บันทึกว่าพิมพ์แล้ว ${selectedItems.length} ดวง` })
      } else {
        setMsg({ type: 'info', text: 'ยังไม่ได้บันทึกสถานะการพิมพ์' })
      }
    } catch (err) {
      setMsg({ type: 'err', text: `พิมพ์ไม่สำเร็จ: ${err.message}` })
    } finally {
      setPrinting(false)
      setProgress(null)
    }
  }

  const handleSelfTest = async () => {
    try {
      setMsg({ type: 'info', text: 'กำลังส่งฉลากทดสอบ...' })
      await selfTest(settings.printer, settings)
      setMsg({ type: 'ok', text: 'ส่งฉลากทดสอบแล้ว — ดูที่เครื่องพิมพ์ว่ามีฉลาก "FarmStock OK" ออกมาไหม' })
    } catch (err) {
      setMsg({ type: 'err', text: `ทดสอบไม่สำเร็จ: ${err.message}` })
    }
  }

  /* ---------- UI ---------- */

  const statusConfig = {
    checking: { label: 'กำลังตรวจสอบ...',    className: 'bg-yellow-100 text-yellow-600' },
    online:   { label: 'Print Agent: พร้อม ', className: 'bg-green-100 text-green-600' },
    offline:  { label: 'Print Agent: ไม่พบ ', className: 'bg-red-100 text-red-500' },
  }[agentStatus]

  const msgClass = {
    ok:   'bg-green-50 border-green-200 text-green-700',
    err:  'bg-red-50 border-red-200 text-red-600',
    info: 'bg-blue-50 border-blue-200 text-blue-600',
  }[msg?.type] || ''

  const selectedPrinter = printers.find((p) => p.name === settings.printer)

  return (
    <div className="flex flex-col gap-3">
      <div>
          <h1 className="text-2xl font-bold text-brand-dark">ปริ้น QR</h1>
          <p className="text-sm text-gray-500 mt-0.5">พิมพ์ฉลาก QR ผ่าน Bluetooth, Print Agent หรือเบราว์เซอร์</p>
        </div>

      {/* เลือกวิธีพิมพ์ */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { value: 'bluetooth', label: 'Bluetooth',   hint: 'มือถือ / แท็บเล็ต / เครื่องพกพา' },
          { value: 'agent',     label: 'Print Agent', hint: 'คอมที่ต่อเครื่องพิมพ์ USB' },
        ].map((m) => (
          <button key={m.value} onClick={() => setMethod(m.value)}
            className={`rounded-xl border px-3 py-2 text-left transition-colors ${method === m.value ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            <div className="text-sm font-medium">{m.label}</div>
            <div className="text-xs opacity-70">{m.hint}</div>
          </button>
        ))}
      </div>

      {/* Bluetooth */}
      {method === 'bluetooth' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm px-4 py-3 flex flex-col gap-3">
          {btUnsupported ? (
            <div className="text-xs text-amber-600">{btUnsupported} · ยังใช้ปุ่ม "ปริ้นผ่าน Browser" ได้</div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs px-3 py-1.5 rounded-lg font-medium ${btPrinter ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                  {btPrinter ? `${btPrinter.name}: พร้อม ` : 'ยังไม่ได้เชื่อมต่อ'}
                </span>
                {btPrinter ? (
                  <>
                    <button onClick={handleBtSelfTest} disabled={btBusy || printing}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                      ทดสอบพิมพ์
                    </button>
                    <button onClick={handleBtDisconnect} disabled={printing}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                      ตัดการเชื่อมต่อ
                    </button>
                  </>
                ) : (
                  <button onClick={handleBtConnect} disabled={btBusy}
                    className="text-xs px-3 py-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                    {btBusy ? 'กำลังเชื่อมต่อ...' : 'ค้นหาเครื่องพิมพ์'}
                  </button>
                )}
                <button onClick={() => setShowConfig((v) => !v)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
                  ตั้งค่า
                </button>
              </div>

              {!btPrinter && (
                <div className="text-xs text-gray-400">
                  เปิดเครื่องพิมพ์และเปิด Bluetooth ของมือถือก่อน แล้วกด "ค้นหาเครื่องพิมพ์" เลือกชื่อเครื่องจากรายการ
                  {' '}(ไม่ต้องจับคู่ในหน้าตั้งค่า Bluetooth ของมือถือ)
                </div>
              )}

              {showConfig && (
                <div className="border-t border-gray-100 pt-3 flex flex-col gap-3">
                  <div className="flex flex-wrap gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-400">ภาษาเครื่องพิมพ์</span>
                      <select value={btSettings.protocol} onChange={(e) => updateBtSetting({ protocol: e.target.value })}
                        className="h-8 px-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-600 max-w-full">
                        {PROTOCOLS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-400">ขนาดก้อนข้อมูล (byte)</span>
                      <input type="number" min="20" max="512" value={btSettings.chunkSize}
                        onChange={(e) => updateBtSetting({ chunkSize: Number(e.target.value) })}
                        className="w-24 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none text-center" />
                    </label>
                  </div>
                  {btSettings.protocol === 'tspl' && (
                    <div className="flex flex-wrap gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-400">ความเข้ม (0-15)</span>
                        <input type="number" min="0" max="15" value={btSettings.density}
                          onChange={(e) => updateBtSetting({ density: Number(e.target.value) })}
                          className="w-20 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none text-center" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-400">ความเร็ว (1-6)</span>
                        <input type="number" min="1" max="6" value={btSettings.speed}
                          onChange={(e) => updateBtSetting({ speed: Number(e.target.value) })}
                          className="w-20 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none text-center" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-400">ระยะห่างฉลาก (mm)</span>
                        <input type="number" min="0" max="10" step="0.5" value={btSettings.gapMm}
                          onChange={(e) => updateBtSetting({ gapMm: Number(e.target.value) })}
                          className="w-24 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none text-center" />
                      </label>
                    </div>
                  )}
                  <div className="text-xs text-gray-400">
                    ถ้าพิมพ์แล้วไม่มีอะไรออก ลองสลับภาษาเครื่องพิมพ์ · ถ้าออกมาแหว่ง/ขาดกลางดวง ลดขนาดก้อนข้อมูลเหลือ 20
                    {btSettings.protocol === 'escpos' && ' · เครื่องม้วน 58 mm พิมพ์กว้างได้ไม่เกิน 48 mm'}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* สถานะ Print Agent */}
      {method === 'agent' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm px-4 py-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-3 py-1.5 rounded-lg font-medium ${statusConfig.className}`}>
                {statusConfig.label}
              </span>
              <button onClick={reconnectAgent} disabled={agentStatus === 'checking'}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                เชื่อมต่อใหม่
              </button>
              <button onClick={() => setShowConfig((v) => !v)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
                ตั้งค่า
              </button>
              {agentStatus === 'online' && (
                <button onClick={handleSelfTest} disabled={!settings.printer}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                  ทดสอบพิมพ์
                </button>
              )}
            </div>

            {agentStatus === 'online' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">เครื่องพิมพ์:</span>
                <select value={settings.printer} onChange={(e) => updateSetting({ printer: e.target.value })}
                  className="text-xs h-8 px-2 rounded-lg border border-gray-200 text-gray-600 max-w-52">
                  <option value="">— เลือกเครื่องพิมพ์ —</option>
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}{p.isDefault ? ' (ค่าเริ่มต้น)' : ''}{p.offline ? ' — ออฟไลน์' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {selectedPrinter?.errorState && (
            <div className="text-xs text-amber-600">{selectedPrinter.name}: {selectedPrinter.errorState}</div>
          )}

          {agentStatus === 'offline' && !showConfig && (
            <div className="text-xs text-gray-400">
              ยังใช้ปุ่ม "ปริ้นผ่าน Browser" ได้ตามปกติ · วิธีติดตั้ง Agent ดูที่ <code className="text-gray-500">print-agent/README.md</code>
            </div>
          )}

          {showConfig && (
            <div className="border-t border-gray-100 pt-3 flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-400">Agent URL</span>
                  <input type="text" value={settings.url} placeholder={DEFAULT_AGENT_URL}
                    onChange={(e) => updateSetting({ url: e.target.value })}
                    className="w-56 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-400">
                    Token {agentInfo?.requiresToken === false && <span className="text-gray-300">(agent ไม่ได้ตั้งไว้)</span>}
                  </span>
                  <input type="password" value={settings.token} autoComplete="off"
                    onChange={(e) => updateSetting({ token: e.target.value })}
                    className="w-56 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none" />
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-400">ความเข้ม (0-15)</span>
                  <input type="number" min="0" max="15" value={settings.density}
                    onChange={(e) => updateSetting({ density: Number(e.target.value) })}
                    className="w-20 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none text-center" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-400">ความเร็ว (1-6)</span>
                  <input type="number" min="1" max="6" value={settings.speed}
                    onChange={(e) => updateSetting({ speed: Number(e.target.value) })}
                    className="w-20 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none text-center" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-400">ระยะห่างฉลาก (mm)</span>
                  <input type="number" min="0" max="10" step="0.5" value={settings.gapMm}
                    onChange={(e) => updateSetting({ gapMm: Number(e.target.value) })}
                    className="w-24 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none text-center" />
                </label>
              </div>
              <div className="text-xs text-gray-400">
                ค่าพวกนี้เก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น · token ต้องตรงกับที่ตั้งใน <code className="text-gray-500">print-agent/config.json</code>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ขนาด Label */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-gray-600">ขนาด Label:</span>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">กว้าง</label>
          <input type="number" value={labelW} onChange={(e) => setLabelW(Number(e.target.value))} min="20" max="150"
            className="w-14 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none text-center" />
          <span className="text-xs text-gray-400">mm</span>
        </div>
        <span className="text-gray-300 text-xs">×</span>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">สูง</label>
          <input type="number" value={labelH} onChange={(e) => setLabelH(Number(e.target.value))} min="15" max="150"
            className="w-14 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none text-center" />
          <span className="text-xs text-gray-400">mm</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {SIZE_PRESETS.map(([w, h]) => (
            <button key={`${w}x${h}`} onClick={() => { setLabelW(w); setLabelH(h) }}
              className={`text-xs px-2 py-1 rounded-lg border transition-colors ${labelW === w && labelH === h ? 'bg-blue-50 text-blue-600 border-blue-200' : 'border-gray-200 text-gray-400 hover:bg-gray-50'}`}>
              {w}×{h}
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      {selectedItems.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm px-4 py-3 flex flex-wrap items-center gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">ตัวอย่างฉลาก</span>
            <span className="text-xs text-gray-400">ภาพนี้คือข้อมูลชุดเดียวกับที่ส่งเข้าเครื่องพิมพ์</span>
          </div>
          {/* ปล่อยให้ canvas ใช้ขนาด intrinsic (1 px = 1 dot) จะได้เห็นของจริงแบบ 1:1 */}
          <canvas ref={previewRef}
            className="border border-gray-200 rounded bg-white"
            style={{ imageRendering: 'pixelated', maxWidth: '100%', height: 'auto' }} />
          {previewInfo && (
            <div className="text-xs text-gray-400 flex flex-col gap-0.5">
              <span>{previewInfo.widthDots} × {previewInfo.heightDots} dots @ 203 DPI</span>
              <span>QR {previewInfo.qr.modules}×{previewInfo.qr.modules} module · {previewInfo.qr.scale} dot/module
                {' '}({(previewInfo.qr.drawnDots / 8).toFixed(1)} mm)</span>
              <span className="font-mono text-gray-300 truncate max-w-64">{previewInfo.itemId}</span>
            </div>
          )}
        </div>
      )}

      {/* ข้อความแจ้งผล */}
      {msg && (
        <div className={`rounded-xl border px-4 py-3 text-xs flex items-start justify-between gap-3 ${msgClass}`}>
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-40">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหา Lot, Item ID, ชื่อสินค้า..."
            className="flex-1 text-sm outline-none text-gray-700 placeholder-gray-400 min-w-0" />
          {search && <button onClick={() => setSearch('')} className="text-gray-400 text-xs">✕</button>}
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={selectAll} className="text-xs text-blue-500 hover:underline">เลือกทั้งหมด</button>
          <button onClick={clearAll} className="text-xs text-gray-400 hover:underline">ยกเลิก</button>
        </div>
      </div>

      {/* รายการ */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">กำลังโหลด...</div>
        ) : Object.entries(groupedByLot).length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">ไม่พบข้อมูล</div>
        ) : Object.entries(groupedByLot).map(([lotId, lot]) => {
          const allSel     = lot.items.every((i) => selected.has(i.id))
          const someSel    = lot.items.some((i) => selected.has(i.id))
          const selCount   = lot.items.filter((i) => selected.has(i.id)).length
          const isExpanded = expanded.has(lotId)
          const allPrinted = lot.items.every((i) => i.print_status === 'printed')

          return (
            <div key={lotId} className="border-b border-gray-100 last:border-b-0">
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <input type="checkbox" checked={allSel}
                  ref={(el) => { if (el) el.indeterminate = someSel && !allSel }}
                  onChange={() => toggleLot(lot.items)}
                  className="accent-blue-500 w-4 h-4 flex-shrink-0" />
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(lotId)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-700">{lot.lot_no}</span>
                    <span className="text-xs text-gray-400 truncate">{lot.product_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-auto ${allPrinted ? 'bg-gray-100 text-gray-400' : 'bg-yellow-100 text-yellow-600'}`}>
                      {allPrinted ? 'ปริ้นแล้ว' : 'ยังไม่ปริ้น'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {lot.items.length} ชิ้น
                    {selCount > 0 && <span className="text-blue-600 ml-2">· เลือก {selCount} ชิ้น</span>}
                  </div>
                </div>
                <button onClick={() => toggleExpand(lotId)}
                  className="text-gray-400 text-xs px-2 py-1 rounded border border-gray-200 flex-shrink-0">
                  {isExpanded ? '▲' : '▼'}
                </button>
              </div>
              {isExpanded && lot.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-2 pl-10 border-t border-gray-50 bg-gray-50/50">
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleItem(item.id)}
                    className="accent-blue-500 w-4 h-4 flex-shrink-0" />
                  <span className="text-xs text-gray-500 font-mono truncate flex-1">{item.item_id}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${item.print_status === 'printed' ? 'bg-gray-100 text-gray-400' : 'bg-yellow-100 text-yellow-600'}`}>
                    {item.print_status === 'printed' ? 'ปริ้นแล้ว' : 'ยังไม่ปริ้น'}
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* สรุป + ปุ่มพิมพ์ */}
      {selectedItems.length > 0 && (
        <div className="sticky bottom-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 shadow-lg flex-wrap">
          <div>
            <div className="text-xs text-blue-500">รวมที่เลือก</div>
            <div className="text-lg font-semibold text-blue-700">{selectedItems.length} แผ่น</div>
            <div className="text-xs text-blue-400">
              {progress
                ? `${progress.phase === 'render' ? 'กำลังเตรียมฉลาก' : progress.phase === 'send' ? 'กำลังส่งเข้าเครื่องพิมพ์' : 'รอ print dialog'} ${progress.done}/${progress.total}`
                : `ขนาด ${labelW}×${labelH} mm`}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {method === 'bluetooth' ? (
              <button onClick={handlePrintBluetooth}
                disabled={printing || !btPrinter}
                className="px-4 h-10 text-sm rounded-xl bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 font-medium">
                {printing ? 'กำลังพิมพ์...' : 'พิมพ์ผ่าน Bluetooth'}
              </button>
            ) : (
              <button onClick={handlePrintAgent}
                disabled={printing || agentStatus !== 'online' || !settings.printer}
                className="px-4 h-10 text-sm rounded-xl bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 font-medium">
                {printing ? 'กำลังพิมพ์...' : 'พิมพ์ผ่าน Print Agent'}
              </button>
            )}
            <button onClick={handlePrintBrowser} disabled={printing}
              className="px-4 h-10 text-sm rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-50">
              ปริ้นผ่าน Browser
            </button>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-400 pb-2">
        * Bluetooth = พิมพ์จากมือถือ/แท็บเล็ต Android หรือคอมด้วย Chrome/Edge (iPhone/iPad ใช้ไม่ได้) ·
        Print Agent = พิมพ์ตรงเข้าเครื่องพิมพ์ ไม่มีหน้าต่างเด้ง ต้องเปิดโปรแกรมไว้บนเครื่องที่ต่อเครื่องพิมพ์ ·
        Browser = ใช้ได้ทุกเครื่องแต่ต้องกดยืนยันใน print dialog
      </div>
    </div>
  )
}
