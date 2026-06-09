import { useState, useEffect, useRef } from 'react'
import api from '../api/axios'
import QRCode from 'qrcode'
import qz from 'qz-tray'

const PRINTER_NAME = 'Xprinter XP-420B'

export default function Print() {
  const [items,      setItems]      = useState([])
  const [search,     setSearch]     = useState('')
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState(new Set())
  const [expanded,   setExpanded]   = useState(new Set())
  const [printing,   setPrinting]   = useState(false)
  const [labelW,     setLabelW]     = useState(40)
  const [labelH,     setLabelH]     = useState(20)
  const [qzStatus,   setQzStatus]   = useState('disconnected') // disconnected | connecting | connected | error
  const printRef = useRef()

 const isConnecting = useRef(false)

useEffect(() => {
  // delay นิดนึงให้ component mount เสร็จก่อน
  const timer = setTimeout(() => {
    connectQZ()
  }, 1000)
  return () => {
    clearTimeout(timer)
  }
}, [])

const connectQZ = async () => {
  // ป้องกัน connect ซ้ำ
  if (isConnecting.current) return
  isConnecting.current = true

  try {
    setQzStatus('connecting')

    qz.security.setCertificatePromise((resolve) => resolve())
    qz.security.setSignaturePromise(() => (resolve) => resolve())

    // ถ้า active อยู่แล้วไม่ต้อง connect ใหม่
    if (qz.websocket.isActive()) {
      setQzStatus('connected')
      isConnecting.current = false
      return
    }

    await qz.websocket.connect()
    setQzStatus('connected')
  } catch (err) {
    console.error('QZ Tray error:', err)
    setQzStatus('error')
  } finally {
    isConnecting.current = false
  }
}
  const fetchItems = async () => {
    try {
      setLoading(true)
      const res = await api.get('/items', { params: { search } })
      setItems(res.data)
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => {
    const delay = setTimeout(fetchItems, 300)
    return () => clearTimeout(delay)
  }, [search])

  const groupedByLot = items.reduce((acc, item) => {
    const key = item.lot_id
    if (!acc[key]) acc[key] = { lot_no: item.lot_no, product_name: item.product_name, mat_uid: item.mat_uid, created_at: item.created_at, items: [] }
    acc[key].items.push(item)
    return acc
  }, {})

  const toggleLot = (lotId, lotItems) => {
    const newSel = new Set(selected)
    const allSelected = lotItems.every(i => newSel.has(i.id))
    lotItems.forEach(i => allSelected ? newSel.delete(i.id) : newSel.add(i.id))
    setSelected(newSel)
  }

  const toggleItem = (id) => {
    const newSel = new Set(selected)
    newSel.has(id) ? newSel.delete(id) : newSel.add(id)
    setSelected(newSel)
  }

  const toggleExpand = (lotId) => {
    const newExp = new Set(expanded)
    newExp.has(lotId) ? newExp.delete(lotId) : newExp.add(lotId)
    setExpanded(newExp)
  }

  const selectAll = () => setSelected(new Set(items.map(i => i.id)))
  const clearAll  = () => setSelected(new Set())
  const selectedItems = items.filter(i => selected.has(i.id))

  // ปริ้นผ่าน QZ Tray
  const handlePrintQZ = async () => {
    if (selectedItems.length === 0) return
    if (qzStatus !== 'connected') {
      alert('QZ Tray ยังไม่ได้เชื่อมต่อ กรุณาเปิด QZ Tray ก่อน')
      return
    }
    setPrinting(true)
    try {
      const config = qz.configs.create(PRINTER_NAME, {
        size:        { width: labelW, height: labelH },
        units:       'mm',
        colorType:   'blackwhite',
        duplex:      false,
        margins:     { top: 0, right: 0, bottom: 0, left: 0 },
      })

      for (const item of selectedItems) {
        const url = `${window.location.origin}/scan/${item.item_id}`
        const qr  = await QRCode.toDataURL(url, { width: 300, margin: 1 })

        // สร้าง HTML label
        const labelHtml = `
  <html><head>
  <style>
    /* 1. รีเซ็ตขอบหน้ากระดาษตอนปริ้นให้ออกมาพอดี */
    @page {
      margin: 0;
      size: ${labelW}mm ${labelH}mm; 
    }
    
    * { margin:0; padding:0; box-sizing:border-box; }
    
    body {
  width: ${labelW}mm; 
  height: ${labelH}mm;
  font-family: sans-serif;
  
  /* แก้ตรงนี้: บน 1.5, ขวา 1.5, ล่าง 1.5, ซ้าย 4 */
  padding: 1.5mm 1.5mm 1.5mm 4mm; 
  
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2mm;
  overflow: hidden;
}
    
    .info { flex:1; display:flex; flex-direction:column; gap:0.5mm; overflow:hidden; }
    .name  { font-size:7pt; font-weight:bold; line-height:1.2; }
    .uid   { font-size:5.5pt; color:#444; }
    .lot   { font-size:5pt; color:#555; }
    .dates { font-size:4.5pt; color:#666; line-height:1.3; }
    .qr img { width:${labelH - 3}mm; height:${labelH - 3}mm; display:block; }
  </style></head>
  <body>
    <div class="info">
      <div class="name">${item.product_name}</div>
      <div class="uid">${item.mat_uid}</div>
      <div class="lot">Lot: ${item.lot_no}</div>
      <div class="dates">
        ผลิต: ${new Date(item.mfg_date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'})}<br/>
        หมด: ${new Date(item.exp_date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'})}
      </div>
    </div>
    <div class="qr"><img src="${qr}" /></div>
  </body></html>
`

        const data = [{ type: 'pixel', format: 'html', flavor: 'plain', data: labelHtml }]
        await qz.print(config, data)
      }

      // อัปเดต print status
      await api.patch('/items/print', { ids: selectedItems.map(i => i.id) })
      await fetchItems()
      setSelected(new Set())
      alert(`ปริ้นสำเร็จ ${selectedItems.length} แผ่น`)
    } catch (err) {
      console.error(err)
      alert('ปริ้นไม่สำเร็จ: ' + err.message)
    } finally {
      setPrinting(false)
    }
  }

  // ปริ้นแบบ browser fallback (กรณี QZ ไม่ได้เชื่อมต่อ)
  const handlePrintBrowser = async () => {
    if (selectedItems.length === 0) return
    setPrinting(true)
    try {
      const qrDataList = await Promise.all(
        selectedItems.map(async (item) => {
          const url = `${window.location.origin}/scan/${item.item_id}`
          const qr  = await QRCode.toDataURL(url, { width: 200, margin: 1 })
          return { ...item, qr }
        })
      )
      const printWin = window.open('', '_blank')
      printWin.document.write(`
        <html><head><title>FarmStock Labels</title>
        <style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family:sans-serif; }
          .label {
            width:${labelW}mm; height:${labelH}mm; padding:3mm;
            display:inline-flex; flex-direction:column; justify-content:space-between;
            border:0.5px solid #eee; page-break-inside:avoid; vertical-align:top;
          }
          .name  { font-size:${Math.max(7,labelW*0.18)}pt; font-weight:bold; }
          .uid   { font-size:${Math.max(6,labelW*0.14)}pt; color:#555; }
          .lot   { font-size:${Math.max(6,labelW*0.14)}pt; color:#555; }
          .dates { font-size:${Math.max(5,labelW*0.12)}pt; color:#777; }
          .qr    { text-align:center; }
          .qr img { width:${Math.min(labelW*0.55,labelH*0.55)}mm; height:${Math.min(labelW*0.55,labelH*0.55)}mm; }
          @media print { body { margin:0; } .label { border:none; } }
        </style></head><body>
        ${qrDataList.map(item=>`
          <div class="label">
            <div>
              <div class="name">${item.product_name}</div>
              <div class="uid">${item.mat_uid}</div>
              <div class="lot">Lot: ${item.lot_no} | ${item.item_id.split('-').pop()}</div>
              <div class="dates">
                ผลิต: ${new Date(item.mfg_date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'})}
                หมด: ${new Date(item.exp_date).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'})}
              </div>
            </div>
            <div class="qr"><img src="${item.qr}" /></div>
          </div>
        `).join('')}
        </body></html>
      `)
      printWin.document.close()
      printWin.focus()
      setTimeout(() => { printWin.print(); printWin.close() }, 500)
      await api.patch('/items/print', { ids: selectedItems.map(i => i.id) })
      await fetchItems()
      setSelected(new Set())
    } catch {
      alert('ปริ้นไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setPrinting(false)
    }
  }

  const fmt = (d) => d ? new Date(d).toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '-'

  const qzStatusConfig = {
    disconnected: { label: 'QZ Tray: ไม่ได้เชื่อมต่อ', className: 'bg-gray-100 text-gray-500', btn: 'เชื่อมต่อ' },
    connecting:   { label: 'QZ Tray: กำลังเชื่อมต่อ...', className: 'bg-yellow-100 text-yellow-600', btn: null },
    connected:    { label: 'QZ Tray: เชื่อมต่อแล้ว ✅', className: 'bg-green-100 text-green-600', btn: null },
    error:        { label: 'QZ Tray: เชื่อมต่อไม่ได้ ❌', className: 'bg-red-100 text-red-500', btn: 'ลองใหม่' },
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-base font-semibold text-gray-800">Print QR Label</h1>

      {/* QZ Tray Status */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-3 py-1.5 rounded-lg font-medium ${qzStatusConfig[qzStatus].className}`}>
            🖨️ {qzStatusConfig[qzStatus].label}
          </span>
          {qzStatusConfig[qzStatus].btn && (
            <button onClick={connectQZ}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
              {qzStatusConfig[qzStatus].btn}
            </button>
          )}
        </div>
        <div className="text-xs text-gray-400">
          Printer: <span className="font-medium text-gray-600">{PRINTER_NAME}</span>
        </div>
      </div>

      {/* Label Size */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-gray-600">📐 ขนาด Label:</span>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">กว้าง</label>
          <input type="number" value={labelW} onChange={e=>setLabelW(Number(e.target.value))} min="20" max="150"
            className="w-14 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none text-center" />
          <span className="text-xs text-gray-400">mm</span>
        </div>
        <span className="text-gray-300 text-xs">×</span>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">สูง</label>
          <input type="number" value={labelH} onChange={e=>setLabelH(Number(e.target.value))} min="20" max="150"
            className="w-14 h-8 px-2 text-sm rounded-lg border border-gray-200 focus:outline-none text-center" />
          <span className="text-xs text-gray-400">mm</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[[50,40],[60,40],[80,50],[100,70]].map(([w,h]) => (
            <button key={`${w}x${h}`} onClick={()=>{ setLabelW(w); setLabelH(h) }}
              className={`text-xs px-2 py-1 rounded-lg border transition-colors ${labelW===w && labelH===h ? 'bg-blue-50 text-blue-600 border-blue-200' : 'border-gray-200 text-gray-400 hover:bg-gray-50'}`}>
              {w}×{h}
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-40">
          <span className="text-gray-400 text-sm">🔍</span>
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="ค้นหา Lot, Item ID, ชื่อสินค้า..."
            className="flex-1 text-sm outline-none text-gray-700 placeholder-gray-400 min-w-0" />
          {search && <button onClick={()=>setSearch('')} className="text-gray-400 text-xs">✕</button>}
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={selectAll} className="text-xs text-blue-500 hover:underline">เลือกทั้งหมด</button>
          <button onClick={clearAll}  className="text-xs text-gray-400 hover:underline">ยกเลิก</button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">กำลังโหลด...</div>
        ) : Object.entries(groupedByLot).length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">ไม่พบข้อมูล</div>
        ) : Object.entries(groupedByLot).map(([lotId, lot]) => {
          const allSel    = lot.items.every(i => selected.has(i.id))
          const someSel   = lot.items.some(i  => selected.has(i.id))
          const selCount  = lot.items.filter(i => selected.has(i.id)).length
          const isExpanded= expanded.has(lotId)
          const allPrinted= lot.items.every(i => i.print_status === 'printed')

          return (
            <div key={lotId} className="border-b border-gray-100 last:border-b-0">
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <input type="checkbox" checked={allSel}
                  ref={el => { if(el) el.indeterminate = someSel && !allSel }}
                  onChange={() => toggleLot(lotId, lot.items)}
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
              {isExpanded && lot.items.map(item => (
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

      {/* Summary + ปุ่มปริ้น */}
      {selectedItems.length > 0 && (
        <div className="sticky bottom-16 md:bottom-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 shadow-lg flex-wrap">
          <div>
            <div className="text-xs text-blue-500">รวมที่เลือก</div>
            <div className="text-lg font-semibold text-blue-700">{selectedItems.length} แผ่น</div>
            <div className="text-xs text-blue-400">ขนาด {labelW}×{labelH} mm</div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* ปริ้นผ่าน QZ Tray */}
            <button onClick={handlePrintQZ} disabled={printing || qzStatus !== 'connected'}
              className="px-4 h-10 text-sm rounded-xl bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 font-medium">
              {printing ? 'กำลังปริ้น...' : `🖨️ ปริ้นผ่าน XP-420B`}
            </button>
            {/* ปริ้นแบบ browser fallback */}
            <button onClick={handlePrintBrowser} disabled={printing}
              className="px-4 h-10 text-sm rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
              ปริ้นผ่าน Browser
            </button>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-400 pb-2">
        * ปริ้นผ่าน XP-420B ต้องเปิด QZ Tray ไว้ · ปริ้นผ่าน Browser ใช้ได้กับ Printer ทุกรุ่น
      </div>
    </div>
  )
}