import { useState, useEffect, useCallback, useMemo } from 'react'
import QRCode from 'qrcode'
import api from '../api/axios'
import { trimNumber } from '../lib/units'

/**
 * Planting Process — โซน, แปลง, บันทึกการดูแล, เก็บเกี่ยว
 *
 * การดูแลแต่ละครั้งหักของจากสต๊อกจริง ต้นทุนจึงสะสมอยู่กับแปลง
 * แล้วถูกปันส่วนออกตอนเก็บเกี่ยว → ผลผลิตที่เข้าสต๊อกมีต้นทุนจริงไปคิดกำไรต่อ
 */

const PLOT_STATUS = {
  preparing: { text: 'เตรียมแปลง',  cls: 'bg-gray-100 text-gray-600' },
  planted:   { text: 'ปลูกแล้ว',    cls: 'bg-green-100 text-green-600' },
  harvested: { text: 'เก็บเกี่ยวแล้ว', cls: 'bg-blue-100 text-blue-600' },
  resting:   { text: 'พักแปลง',     cls: 'bg-amber-100 text-amber-700' },
}

const ACTIVITY_TYPES = [
  'ปลูก', 'รดน้ำ', 'ใส่ปุ๋ย', 'พ่นยา', 'กำจัดวัชพืช', 'พรวนดิน', 'ตรวจแปลง', 'เก็บเกี่ยว',
]

const today = () => new Date().toISOString().slice(0, 10)
const emptyMaterial = () => ({ product_id: '', qty: '', unit_code: '' })

export default function Planting() {
  const [areas,    setAreas]    = useState([])
  const [plots,    setPlots]    = useState([])
  const [products, setProducts] = useState([])
  const [units,    setUnits]    = useState([])
  const [filter,   setFilter]   = useState({ area_id: '', status: '', search: '' })
  const [error,    setError]    = useState('')
  const [notice,   setNotice]   = useState('')

  const [showAreas,  setShowAreas]  = useState(false)
  const [newArea,    setNewArea]    = useState({ name: '', note: '' })
  const [plotForm,   setPlotForm]   = useState(null)
  const [saving,     setSaving]     = useState(false)

  const [detail,     setDetail]     = useState(null)
  const [activity,   setActivity]   = useState(null)
  const [harvest,    setHarvest]    = useState(null)
  const [qrImage,    setQrImage]    = useState(null)

  const fetchAreas = useCallback(async () => {
    try { setAreas((await api.get('/planting/areas')).data) } catch {}
  }, [])

  const fetchPlots = useCallback(async () => {
    try {
      const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v))
      setPlots((await api.get('/planting/plots', { params })).data)
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดแปลงไม่สำเร็จ')
    }
  }, [filter])

  useEffect(() => { fetchAreas() }, [fetchAreas])
  useEffect(() => { fetchPlots() }, [fetchPlots])

  useEffect(() => {
    api.get('/products').then(res => setProducts(res.data)).catch(() => {})
    api.get('/units').then(res => setUnits(res.data)).catch(() => {})
  }, [])

  const areaUnits    = useMemo(() => units.filter(u => u.kind === 'area'), [units])
  const measureUnits = useMemo(() => units.filter(u => ['weight', 'volume'].includes(u.kind)), [units])
  // ผลผลิตจากแปลงต้องลงทะเบียนเป็นประเภท "ผลผลิต" ไว้ก่อน
  const produceProducts = useMemo(() => products.filter(p => p.mat_type === 'produce'), [products])

  const refreshDetail = async (id) => setDetail((await api.get(`/planting/plots/${id}`)).data)

  /* ---------- โซน ---------- */

  const addArea = async () => {
    if (!newArea.name.trim()) return
    try {
      await api.post('/planting/areas', { name: newArea.name.trim(), note: newArea.note || null })
      setNewArea({ name: '', note: '' })
      fetchAreas()
    } catch (err) {
      alert(err.response?.data?.message || 'เพิ่มโซนไม่สำเร็จ')
    }
  }

  const removeArea = async (id) => {
    try {
      await api.delete(`/planting/areas/${id}`)
      fetchAreas()
    } catch (err) {
      alert(err.response?.data?.message || 'ลบโซนไม่สำเร็จ')
    }
  }

  /* ---------- แปลง ---------- */

  const openPlotForm = (plot) => {
    setError('')
    setPlotForm(plot ? {
      id: plot.id, area_id: String(plot.area_id), name: plot.name,
      size: plot.size ? trimNumber(plot.size) : '', size_unit: plot.size_unit || '',
      crop: plot.crop || '', planted_date: plot.planted_date ? String(plot.planted_date).slice(0, 10) : '',
      status: plot.status, note: plot.note || '',
    } : {
      id: null, area_id: areas[0] ? String(areas[0].id) : '', name: '',
      size: '', size_unit: 'rai', crop: '', planted_date: today(),
      status: 'preparing', note: '',
    })
  }

  const savePlot = async (e) => {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      const payload = {
        ...plotForm,
        size: plotForm.size ? Number(plotForm.size) : null,
        size_unit: plotForm.size_unit || null,
        planted_date: plotForm.planted_date || null,
      }
      if (plotForm.id) await api.put(`/planting/plots/${plotForm.id}`, payload)
      else             await api.post('/planting/plots', payload)
      setPlotForm(null)
      fetchPlots()
    } catch (err) {
      setError(err.response?.data?.message || 'บันทึกแปลงไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const openDetail = async (id) => {
    if (detail?.id === id) { setDetail(null); setQrImage(null); return }
    setError(''); setNotice(''); setActivity(null); setHarvest(null); setQrImage(null)
    try { await refreshDetail(id) } catch (err) {
      setError(err.response?.data?.message || 'โหลดรายละเอียดไม่สำเร็จ')
    }
  }

  /** QR ของแปลงชี้ไปหน้า /plot/<token> — สแกนที่หน้างานแล้วบันทึกกิจกรรมได้เลย */
  const showQr = async () => {
    const url = `${window.location.origin}/plot/${detail.qr_token}`
    try {
      setQrImage({ url, src: await QRCode.toDataURL(url, { width: 320, margin: 1 }) })
    } catch {
      setError('สร้าง QR ไม่สำเร็จ')
    }
  }

  /* ---------- กิจกรรม ---------- */

  const submitActivity = async (e) => {
    e.preventDefault()
    setError(''); setNotice(''); setSaving(true)
    try {
      const materials = activity.materials
        .filter(m => m.product_id && Number(m.qty) > 0)
        .map(m => ({ ...m, qty: Number(m.qty) }))
      await api.post(`/planting/plots/${detail.id}/activities`, { ...activity, materials })
      setActivity(null)
      await refreshDetail(detail.id)
      fetchPlots()
      setNotice('บันทึกกิจกรรมแล้ว')
    } catch (err) {
      const res = err.response?.data
      setError(res?.shortages
        ? `${res.message}: ` + res.shortages.map(s => `${s.product_name} ขาด ${trimNumber(s.shortage)} ${s.unit}`).join(', ')
        : res?.message || 'บันทึกกิจกรรมไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const setMaterial = (idx, patch) =>
    setActivity(prev => ({
      ...prev,
      materials: prev.materials.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    }))

  const pickMaterial = (idx, product_id) => {
    const p = products.find(x => String(x.product_id) === String(product_id))
    setMaterial(idx, { product_id, unit_code: p?.pack_unit || p?.stock_unit || '' })
  }

  /* ---------- เก็บเกี่ยว ---------- */

  const submitHarvest = async (e) => {
    e.preventDefault()
    setError(''); setNotice(''); setSaving(true)
    try {
      const { data } = await api.post(`/planting/plots/${detail.id}/harvests`, {
        ...harvest,
        qty: Number(harvest.qty),
        output_units: Number(harvest.output_units),
        cost_total: harvest.cost_total === '' ? null : Number(harvest.cost_total),
      })
      setHarvest(null)
      await refreshDetail(detail.id)
      fetchPlots()
      setNotice(`บันทึกเก็บเกี่ยวแล้ว — Lot ${data.lot_no} · QR ${data.qr_created} ดวง · ต้นทุน ${trimNumber(data.cost_per_unit, 2)} บาท/หน่วย`)
    } catch (err) {
      setError(err.response?.data?.message || 'บันทึกเก็บเกี่ยวไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const inputClass = "h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white text-gray-700 w-full"
  const labelClass = "text-xs text-gray-500 mb-1.5 block"

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <h1 className="text-base font-semibold text-gray-800">แปลงปลูก</h1>
        <div className="sm:ml-auto flex flex-wrap gap-2">
          <input value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })}
            className="h-9 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white basis-full sm:basis-auto min-w-0"
            placeholder="ค้นหาแปลง / พืช" />
          <select value={filter.area_id} onChange={e => setFilter({ ...filter, area_id: e.target.value })}
            className="h-9 px-3 text-sm rounded-xl border border-gray-200 bg-white text-gray-700">
            <option value="">ทุกโซน</option>
            {areas.map(a => <option key={a.id} value={a.id}>{a.area_code} | {a.name}</option>)}
          </select>
          <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}
            className="h-9 px-3 text-sm rounded-xl border border-gray-200 bg-white text-gray-700">
            <option value="">ทุกสถานะ</option>
            {Object.entries(PLOT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
          </select>
          <button onClick={() => setShowAreas(!showAreas)}
            className="h-9 px-4 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-white">
            โซน
          </button>
          <button onClick={() => openPlotForm(null)} disabled={areas.length === 0}
            className="h-9 px-4 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 whitespace-nowrap">
            ＋ สร้างแปลง
          </button>
        </div>
      </div>

      {error  && <div className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</div>}
      {notice && <div className="text-sm text-green-600 bg-green-50 px-4 py-3 rounded-xl">{notice}</div>}

      {areas.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-700">
          ยังไม่มีโซน — กดปุ่ม "โซน" เพื่อสร้างโซนก่อน แล้วค่อยแบ่งแปลงในโซนนั้น
        </div>
      )}

      {/* ===== จัดการโซน ===== */}
      {showAreas && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">โซน</div>
          {areas.map(a => (
            <div key={a.id} className="flex items-center gap-3 text-sm">
              <span className="font-medium text-gray-700">{a.area_code}</span>
              <span className="text-gray-600">{a.name}</span>
              <span className="text-xs text-gray-400">{a.plot_count} แปลง</span>
              {a.plot_count === 0 && (
                <button onClick={() => removeArea(a.id)}
                  className="ml-auto text-xs text-red-400 hover:text-red-500">ลบ</button>
              )}
            </div>
          ))}
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={newArea.name} onChange={e => setNewArea({ ...newArea, name: e.target.value })}
              className="h-9 px-3 text-sm rounded-xl border border-gray-200 bg-white flex-1"
              placeholder="ชื่อโซนใหม่ เช่น โซนหลังบ้าน" />
            <button onClick={addArea}
              className="h-9 px-4 text-xs rounded-xl bg-blue-500 text-white hover:bg-blue-600">
              เพิ่มโซน
            </button>
          </div>
        </div>
      )}

      {/* ===== ฟอร์มแปลง ===== */}
      {plotForm && (
        <form onSubmit={savePlot} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">
            {plotForm.id ? 'แก้ไขแปลง' : 'แปลงใหม่'}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className={labelClass}>โซน <span className="text-red-400">*</span></label>
              <select value={plotForm.area_id} onChange={e => setPlotForm({ ...plotForm, area_id: e.target.value })}
                className={inputClass} required>
                {areas.map(a => <option key={a.id} value={a.id}>{a.area_code} | {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>ชื่อแปลง <span className="text-red-400">*</span></label>
              <input value={plotForm.name} onChange={e => setPlotForm({ ...plotForm, name: e.target.value })}
                className={inputClass} placeholder="เช่น แปลง A1" required />
            </div>
            <div>
              <label className={labelClass}>ขนาด</label>
              <div className="flex gap-2">
                <input type="number" value={plotForm.size}
                  onChange={e => setPlotForm({ ...plotForm, size: e.target.value })}
                  className={inputClass} min="0" step="0.0001" />
                <select value={plotForm.size_unit}
                  onChange={e => setPlotForm({ ...plotForm, size_unit: e.target.value })}
                  className={`${inputClass} w-32`}>
                  <option value="">-</option>
                  {areaUnits.map(u => <option key={u.code} value={u.code}>{u.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>พืชที่ปลูก</label>
              <input value={plotForm.crop} onChange={e => setPlotForm({ ...plotForm, crop: e.target.value })}
                className={inputClass} placeholder="เช่น ผักกาดหอม" />
            </div>
            <div>
              <label className={labelClass}>วันที่ปลูก</label>
              <input type="date" value={plotForm.planted_date}
                onChange={e => setPlotForm({ ...plotForm, planted_date: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>สถานะ</label>
              <select value={plotForm.status} onChange={e => setPlotForm({ ...plotForm, status: e.target.value })}
                className={inputClass}>
                {Object.entries(PLOT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>หมายเหตุ</label>
              <input value={plotForm.note} onChange={e => setPlotForm({ ...plotForm, note: e.target.value })}
                className={inputClass} />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setPlotForm(null)}
              className="h-10 px-5 text-sm rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving}
              className="h-10 px-5 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
              {saving ? 'กำลังบันทึก...' : 'บันทึกแปลง'}
            </button>
          </div>
        </form>
      )}

      {/* ===== รายการแปลง ===== */}
      <div className="flex flex-col gap-2">
        {plots.length === 0 && !plotForm && (
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            ยังไม่มีแปลง
          </div>
        )}

        {plots.map(p => {
          const badge = PLOT_STATUS[p.status] || PLOT_STATUS.preparing
          const isOpen = detail?.id === p.id
          const unallocated = Number(p.material_cost) - Number(p.allocated_cost)
          return (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button onClick={() => openDetail(p.id)}
                className="w-full px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-left hover:bg-gray-50">
                <span className="text-sm font-medium text-gray-800">{p.plot_code}</span>
                <span className="text-sm text-gray-700">{p.name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.text}</span>
                <span className="text-xs text-gray-400">{p.area_code}</span>
                {p.crop && <span className="text-xs text-gray-500">{p.crop}</span>}
                {p.size && <span className="text-xs text-gray-400">{trimNumber(p.size)} {p.size_unit_name}</span>}
                <span className="ml-auto text-xs text-gray-500">
                  ต้นทุนค้าง {unallocated.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                </span>
                <span className="text-gray-300 text-xs">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && detail && (
                <div className="border-t border-gray-100 px-4 py-3 flex flex-col gap-4 bg-gray-50">

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-500">
                    <div>ต้นทุนที่ใช้ไป: <span className="font-medium text-gray-700">
                      {Number(detail.material_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                    </span></div>
                    <div>ปันส่วนไปแล้ว: <span className="font-medium text-gray-700">
                      {Number(detail.allocated_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                    </span></div>
                    <div>ยังไม่ปันส่วน: <span className="font-medium text-blue-600">
                      {Number(detail.unallocated_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                    </span></div>
                    <div>กิจกรรม: <span className="font-medium text-gray-700">{detail.activities.length} ครั้ง</span></div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setActivity({
                      activity_date: today(), activity_type: 'รดน้ำ', note: '', materials: [],
                    })}
                      className="h-9 px-4 text-xs rounded-xl bg-blue-500 text-white hover:bg-blue-600">
                      ＋ บันทึกกิจกรรม
                    </button>
                    <button onClick={() => setHarvest({
                      harvest_date: today(), product_id: '', qty: '', unit_code: 'kg',
                      output_units: '', cost_total: String(detail.unallocated_cost), exp_date: '', note: '',
                    })}
                      className="h-9 px-4 text-xs rounded-xl bg-green-500 text-white hover:bg-green-600">
                      บันทึกเก็บเกี่ยว
                    </button>
                    <button onClick={showQr}
                      className="h-9 px-4 text-xs rounded-xl border border-gray-200 text-gray-600 hover:bg-white">
                      QR ของแปลง
                    </button>
                    <button onClick={() => openPlotForm(p)}
                      className="h-9 px-4 text-xs rounded-xl border border-gray-200 text-gray-600 hover:bg-white">
                      แก้ไข
                    </button>
                  </div>

                  {/* QR */}
                  {qrImage && (
                    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col items-center gap-2">
                      <img src={qrImage.src} alt={`QR ${detail.plot_code}`} className="w-48 h-48" />
                      <div className="text-sm font-medium text-gray-700">{detail.plot_code} · {detail.name}</div>
                      <div className="text-[10px] text-gray-400 break-all text-center">{qrImage.url}</div>
                      <div className="text-xs text-gray-500">สแกนแล้วเข้าหน้าบันทึกกิจกรรมของแปลงนี้ได้เลย</div>
                    </div>
                  )}

                  {/* ฟอร์มกิจกรรม */}
                  {activity && (
                    <form onSubmit={submitActivity} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
                      <div className="text-xs font-medium text-gray-700">บันทึกกิจกรรม</div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className={labelClass}>วันที่</label>
                          <input type="date" value={activity.activity_date}
                            onChange={e => setActivity({ ...activity, activity_date: e.target.value })}
                            className={inputClass} />
                        </div>
                        <div>
                          <label className={labelClass}>ประเภท <span className="text-red-400">*</span></label>
                          <input list="activity-types" value={activity.activity_type}
                            onChange={e => setActivity({ ...activity, activity_type: e.target.value })}
                            className={inputClass} required />
                          <datalist id="activity-types">
                            {ACTIVITY_TYPES.map(t => <option key={t} value={t} />)}
                          </datalist>
                        </div>
                        <div>
                          <label className={labelClass}>หมายเหตุ</label>
                          <input value={activity.note}
                            onChange={e => setActivity({ ...activity, note: e.target.value })}
                            className={inputClass} />
                        </div>
                      </div>

                      {activity.materials.length > 0 && (
                        <div className="text-xs text-gray-500">วัตถุดิบที่ใช้ (จะถูกหักจากสต๊อกจริง)</div>
                      )}
                      {activity.materials.map((m, idx) => (
                        <div key={idx} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
                          <div className="col-span-2 sm:col-span-6">
                            <select value={m.product_id} onChange={e => pickMaterial(idx, e.target.value)}
                              className={inputClass}>
                              <option value="">-- เลือกวัตถุดิบ --</option>
                              {products.map(x => (
                                <option key={x.product_id} value={x.product_id}>{x.mat_uid} | {x.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="sm:col-span-2">
                            <input type="number" value={m.qty} onChange={e => setMaterial(idx, { qty: e.target.value })}
                              className={inputClass} placeholder="ปริมาณ" min="0" step="0.0001" />
                          </div>
                          <div className="sm:col-span-3">
                            <select value={m.unit_code} onChange={e => setMaterial(idx, { unit_code: e.target.value })}
                              className={inputClass}>
                              <option value="">-- หน่วย --</option>
                              {units.filter(u => u.kind !== 'area').map(u => (
                                <option key={u.code} value={u.code}>{u.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="sm:col-span-1 flex justify-end">
                            <button type="button"
                              onClick={() => setActivity(a => ({ ...a, materials: a.materials.filter((_, i) => i !== idx) }))}
                              className="h-10 px-3 text-xs rounded-xl border border-gray-200 text-red-400 hover:bg-red-50">✕</button>
                          </div>
                        </div>
                      ))}

                      <div className="flex flex-wrap gap-2">
                        <button type="button"
                          onClick={() => setActivity(a => ({ ...a, materials: [...a.materials, emptyMaterial()] }))}
                          className="h-9 px-4 text-xs rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
                          ＋ ใช้วัตถุดิบ
                        </button>
                        <div className="ml-auto flex gap-2">
                          <button type="button" onClick={() => setActivity(null)}
                            className="h-9 px-4 text-xs rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
                            ยกเลิก
                          </button>
                          <button type="submit" disabled={saving}
                            className="h-9 px-4 text-xs rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                          </button>
                        </div>
                      </div>
                    </form>
                  )}

                  {/* ฟอร์มเก็บเกี่ยว */}
                  {harvest && (
                    <form onSubmit={submitHarvest} className="bg-white rounded-xl border border-green-200 p-4 flex flex-col gap-3">
                      <div className="text-xs font-medium text-gray-700">บันทึกเก็บเกี่ยว — ผลผลิตจะเข้า Stock พร้อม QR</div>

                      {produceProducts.length === 0 && (
                        <div className="text-xs text-yellow-700 bg-yellow-50 rounded-xl px-3 py-2">
                          ยังไม่มีสินค้าประเภท "ผลผลิต" — ไปลงทะเบียนสินค้าที่เก็บเกี่ยวได้ก่อน
                          โดยตั้งประเภทเป็น <span className="font-medium">ผลผลิต (จากแปลงปลูก)</span>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className={labelClass}>วันที่เก็บ</label>
                          <input type="date" value={harvest.harvest_date}
                            onChange={e => setHarvest({ ...harvest, harvest_date: e.target.value })}
                            className={inputClass} />
                        </div>
                        <div className="sm:col-span-2">
                          <label className={labelClass}>ผลผลิตที่ได้ <span className="text-red-400">*</span></label>
                          <select value={harvest.product_id}
                            onChange={e => setHarvest({ ...harvest, product_id: e.target.value })}
                            className={inputClass} required>
                            <option value="">-- เลือกผลผลิต --</option>
                            {produceProducts.map(x => (
                              <option key={x.product_id} value={x.product_id}>{x.mat_uid} | {x.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={labelClass}>ปริมาณที่เก็บได้ <span className="text-red-400">*</span></label>
                          <div className="flex gap-2">
                            <input type="number" value={harvest.qty}
                              onChange={e => setHarvest({ ...harvest, qty: e.target.value })}
                              className={inputClass} min="0" step="0.0001" required />
                            <select value={harvest.unit_code}
                              onChange={e => setHarvest({ ...harvest, unit_code: e.target.value })}
                              className={`${inputClass} w-32`}>
                              {measureUnits.map(u => <option key={u.code} value={u.code}>{u.name}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className={labelClass}>บรรจุได้กี่หน่วย (= QR) <span className="text-red-400">*</span></label>
                          <input type="number" value={harvest.output_units}
                            onChange={e => setHarvest({ ...harvest, output_units: e.target.value })}
                            className={inputClass} min="1" step="1" required />
                        </div>
                        <div>
                          <label className={labelClass}>ต้นทุนที่ปันส่วน</label>
                          <input type="number" value={harvest.cost_total}
                            onChange={e => setHarvest({ ...harvest, cost_total: e.target.value })}
                            className={inputClass} min="0" step="0.01" />
                          <div className="text-xs text-gray-400 mt-1">
                            ค้างอยู่ {Number(detail.unallocated_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿ — แก้ได้
                          </div>
                        </div>
                        <div>
                          <label className={labelClass}>วันหมดอายุ</label>
                          <input type="date" value={harvest.exp_date}
                            onChange={e => setHarvest({ ...harvest, exp_date: e.target.value })}
                            className={inputClass} />
                          <div className="text-xs text-gray-400 mt-1">ไม่กรอก = 30 วันจากวันเก็บ</div>
                        </div>
                        <div className="sm:col-span-2">
                          <label className={labelClass}>หมายเหตุ</label>
                          <input value={harvest.note} onChange={e => setHarvest({ ...harvest, note: e.target.value })}
                            className={inputClass} />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setHarvest(null)}
                          className="h-9 px-4 text-xs rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
                          ยกเลิก
                        </button>
                        <button type="submit" disabled={saving || produceProducts.length === 0}
                          className="h-9 px-4 text-xs rounded-xl bg-green-500 text-white hover:bg-green-600 disabled:opacity-50">
                          {saving ? 'กำลังบันทึก...' : 'บันทึก + เข้า Stock'}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* ประวัติกิจกรรม */}
                  {detail.activities.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-gray-500">ประวัติการดูแล</div>
                      {detail.activities.map(a => (
                        <div key={a.id} className="bg-white rounded-xl border border-gray-200 px-3 py-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-gray-400">{String(a.activity_date).slice(0, 10)}</span>
                            <span className="font-medium text-gray-700">{a.activity_type}</span>
                            {a.note && <span className="text-gray-500">— {a.note}</span>}
                            <span className="ml-auto text-gray-600">
                              {Number(a.total_cost) > 0
                                ? `${Number(a.total_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿`
                                : '—'}
                            </span>
                            <span className="text-gray-400">{a.created_by_name}</span>
                          </div>
                          {a.materials.length > 0 && (
                            <div className="mt-1 pl-3 border-l-2 border-gray-100 flex flex-col gap-0.5 text-gray-500">
                              {a.materials.map(m => (
                                <div key={m.id}>
                                  {m.product_name} {trimNumber(m.qty)} {m.unit_name || m.unit_code}
                                  <span className="text-gray-400"> ({m.item_code}) </span>
                                  {trimNumber(m.cost, 2)} ฿
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ประวัติเก็บเกี่ยว */}
                  {detail.harvests.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-gray-500">ประวัติการเก็บเกี่ยว</div>
                      {detail.harvests.map(h => (
                        <div key={h.id} className="bg-white rounded-xl border border-gray-200 px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                          <span className="text-gray-400">{String(h.harvest_date).slice(0, 10)}</span>
                          <span className="font-medium text-gray-700">{h.product_name}</span>
                          <span className="text-gray-600">{trimNumber(h.qty)} {h.unit_name || h.unit_code}</span>
                          <span className="text-gray-400">→ {h.output_units} หน่วย · Lot {h.lot_no || '-'}</span>
                          <span className="ml-auto text-gray-600">
                            {Number(h.cost_total).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
