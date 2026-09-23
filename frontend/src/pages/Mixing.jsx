import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/axios'
import { trimNumber } from '../lib/units'

/**
 * ใบสั่งผลิต — กระบวนการคำนวณต้นทุนตาม Newfunction
 *
 * กดดูใบไหน ระบบจะขยายสูตรตามปริมาณที่สั่ง แล้วบอกว่าต้องใช้อะไรเท่าไร มีพอไหม
 * กด "ยืนยันผลิต" ถึงจะหักของจริงและออก QR ของผลผลิต
 */

const STATUS_LABEL = {
  requested: { text: 'รอผลิต',   cls: 'bg-amber-100 text-amber-700' },
  done:      { text: 'ผลิตแล้ว', cls: 'bg-green-100 text-green-600' },
  cancelled: { text: 'ยกเลิก',   cls: 'bg-red-100 text-red-500' },
}

const today = () => new Date().toISOString().slice(0, 10)

export default function Mixing() {
  const navigate = useNavigate()

  const [orders,   setOrders]   = useState([])
  const [formulas, setFormulas] = useState([])
  const [units,    setUnits]    = useState([])
  const [status,   setStatus]   = useState('')
  const [error,    setError]    = useState('')

  const [form,     setForm]     = useState(null)
  const [saving,   setSaving]   = useState(false)

  const [detail,      setDetail]      = useState(null)
  const [requirement, setRequirement] = useState(null)
  const [loadingReq,  setLoadingReq]  = useState(false)
  const [outputUnits, setOutputUnits] = useState('')
  const [producing,   setProducing]   = useState(false)
  const [produced,    setProduced]    = useState(null)

  const fetchOrders = useCallback(async () => {
    try {
      setOrders((await api.get('/mixing', { params: { status: status || undefined } })).data)
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดใบสั่งผลิตไม่สำเร็จ')
    }
  }, [status])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  useEffect(() => {
    api.get('/formulas', { params: { active: '1' } }).then(res => setFormulas(res.data)).catch(() => {})
    api.get('/units').then(res => setUnits(res.data)).catch(() => {})
  }, [])

  const measureUnits = useMemo(() => units.filter(u => u.kind !== 'count'), [units])

  const openCreate = async () => {
    let no = ''
    try { no = (await api.get('/mixing/next-no')).data.mix_no } catch {}
    setForm({ mix_no: no, mix_date: today(), formula_id: '', target_qty: '', target_unit: '', note: '' })
    setError('')
  }

  // เลือกสูตรแล้วตั้งหน่วยและปริมาณตั้งต้นตามสูตร
  const handleFormulaPick = (formula_id) => {
    const f = formulas.find(x => String(x.id) === String(formula_id))
    setForm(prev => ({
      ...prev,
      formula_id,
      target_unit: f?.output_unit || '',
      target_qty: prev.target_qty || (f ? trimNumber(f.output_qty) : ''),
    }))
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      await api.post('/mixing', { ...form, target_qty: Number(form.target_qty) })
      setForm(null)
      fetchOrders()
    } catch (err) {
      setError(err.response?.data?.message || 'สร้างใบสั่งผลิตไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const openDetail = async (id) => {
    if (detail?.id === id) { setDetail(null); setRequirement(null); return }
    setRequirement(null); setProduced(null); setError('')
    try {
      const { data } = await api.get(`/mixing/${id}`)
      setDetail(data)

      // ใบที่ยังไม่ผลิตถึงจะต้องคำนวณของที่ต้องใช้ ใบที่ผลิตแล้วดูของที่หักไปจริงแทน
      if (data.status === 'requested') {
        setLoadingReq(true)
        try {
          const req = await api.get(`/mixing/${id}/requirement`)
          setRequirement(req.data)
          setOutputUnits(req.data.suggested_output_units ? String(req.data.suggested_output_units) : '')
        } catch (err) {
          setError(err.response?.data?.message || 'คำนวณวัตถุดิบไม่สำเร็จ')
        } finally {
          setLoadingReq(false)
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดรายละเอียดไม่สำเร็จ')
    }
  }

  const handleProduce = async () => {
    if (!Number.isInteger(Number(outputUnits)) || Number(outputUnits) <= 0) {
      setError('จำนวนหน่วยที่บรรจุได้ต้องเป็นจำนวนเต็มบวก')
      return
    }
    setError(''); setProducing(true)
    try {
      const { data } = await api.post(`/mixing/${detail.id}/produce`, {
        output_units: Number(outputUnits),
      })
      setProduced(data)
      setDetail((await api.get(`/mixing/${detail.id}`)).data)
      setRequirement(null)
      fetchOrders()
    } catch (err) {
      const res = err.response?.data
      if (res?.shortages) {
        setError(`${res.message}: ` + res.shortages
          .map(s => `${s.product_name} ขาด ${trimNumber(s.shortage)} ${s.unit}`).join(', '))
      } else {
        setError(res?.message || 'ผลิตไม่สำเร็จ')
      }
    } finally {
      setProducing(false)
    }
  }

  const handleCancel = async (id) => {
    try {
      await api.patch(`/mixing/${id}/cancel`)
      fetchOrders()
      setDetail(null)
    } catch (err) {
      alert(err.response?.data?.message || 'ยกเลิกไม่สำเร็จ')
    }
  }

  const inputClass = "h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white text-gray-700 w-full"
  const labelClass = "text-xs text-gray-500 mb-1.5 block"

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">ใบสั่งผลิต</h1>
          <p className="text-sm text-gray-500 mt-0.5">สั่งผลิตตามสูตร ระบบตัดวัตถุดิบและคิดต้นทุนให้</p>
        </div>
        <div className="sm:ml-auto flex flex-wrap gap-2">
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="h-9 px-3 text-sm rounded-xl border border-gray-200 bg-white text-gray-700">
            <option value="">ทุกสถานะ</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
          </select>
          <button onClick={openCreate}
            className="h-9 px-4 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 whitespace-nowrap">
            ＋ สั่งผลิต
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</div>}

      {produced && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 text-sm text-green-700">
          <span>
            ผลิตเสร็จ — Lot {produced.output_lot_no} · ต้นทุนรวม{' '}
            {Number(produced.total_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
            ({trimNumber(produced.cost_per_unit, 2)} บาท/หน่วย) · สร้าง QR {produced.qr_created} ดวง
          </span>
          <button onClick={() => navigate('/print')}
            className="ml-auto h-8 px-4 text-xs rounded-xl bg-green-500 text-white hover:bg-green-600">
            ไปหน้าปริ้น QR
          </button>
        </div>
      )}

      {/* ===== ฟอร์มสั่งผลิต ===== */}
      {form && (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">ใบสั่งผลิตใหม่</div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className={labelClass}>เลขที่ใบสั่งผลิต</label>
              <input value={form.mix_no} onChange={e => setForm({ ...form, mix_no: e.target.value })}
                className={inputClass} placeholder="PR200001" />
            </div>
            <div>
              <label className={labelClass}>วันที่ผลิต</label>
              <input type="date" value={form.mix_date}
                onChange={e => setForm({ ...form, mix_date: e.target.value })} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>สูตรที่ใช้ <span className="text-red-400">*</span></label>
              <select value={form.formula_id} onChange={e => handleFormulaPick(e.target.value)}
                className={inputClass} required>
                <option value="">-- เลือกสูตร --</option>
                {formulas.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.std_code} | {f.name} (ได้ {trimNumber(f.output_qty)} {f.output_unit_name}/ชุด)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>ปริมาณที่ผลิต <span className="text-red-400">*</span></label>
              <input type="number" value={form.target_qty}
                onChange={e => setForm({ ...form, target_qty: e.target.value })}
                className={inputClass} min="0" step="0.0001" required />
            </div>
            <div>
              <label className={labelClass}>หน่วย <span className="text-red-400">*</span></label>
              <select value={form.target_unit} onChange={e => setForm({ ...form, target_unit: e.target.value })}
                className={inputClass} required>
                <option value="">-- เลือกหน่วย --</option>
                {measureUnits.map(u => <option key={u.code} value={u.code}>{u.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>หมายเหตุ</label>
              <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className={inputClass} />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setForm(null)}
              className="h-10 px-5 text-sm rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving}
              className="h-10 px-5 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
              {saving ? 'กำลังบันทึก...' : 'สร้างใบสั่งผลิต'}
            </button>
          </div>
        </form>
      )}

      {/* ===== รายการใบสั่งผลิต ===== */}
      <div className="flex flex-col gap-2">
        {orders.length === 0 && !form && (
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm px-4 py-8 text-center text-sm text-gray-400">
            ยังไม่มีใบสั่งผลิต
          </div>
        )}

        {orders.map(o => {
          const badge = STATUS_LABEL[o.status] || STATUS_LABEL.requested
          const isOpen = detail?.id === o.id
          return (
            <div key={o.id} className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
              <button onClick={() => openDetail(o.id)}
                className="w-full px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-left hover:bg-gray-50">
                <span className="text-sm font-medium text-gray-800">{o.mix_no}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.text}</span>
                <span className="text-xs text-gray-500">{String(o.mix_date).slice(0, 10)}</span>
                <span className="text-xs text-gray-700">{o.std_code} | {o.formula_name}</span>
                <span className="text-xs text-gray-500">
                  {trimNumber(o.target_qty)} {o.target_unit_name || o.target_unit}
                </span>
                {o.status === 'done' && (
                  <span className="ml-auto text-sm font-medium text-gray-700">
                    {Number(o.total_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                  </span>
                )}
                <span className={`text-gray-300 text-xs ${o.status === 'done' ? '' : 'ml-auto'}`}>
                  {isOpen ? '▲' : '▼'}
                </span>
              </button>

              {isOpen && detail && (
                <div className="border-t border-gray-100 px-4 py-3 flex flex-col gap-4 bg-gray-50">

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-500">
                    <div>ได้เป็น: <span className="font-medium text-gray-700">{detail.output_product_name}</span></div>
                    <div>หมัก: <span className="font-medium text-gray-700">{detail.ferment_days} วัน</span></div>
                    <div>เก็บได้: <span className="font-medium text-gray-700">{detail.shelf_life_days} วัน</span></div>
                    {detail.output_lot_no && (
                      <div>Lot ที่ได้: <span className="font-medium text-gray-700">{detail.output_lot_no}</span></div>
                    )}
                  </div>

                  {/* ยังไม่ผลิต — แสดงของที่ต้องใช้ */}
                  {detail.status === 'requested' && (
                    <>
                      {loadingReq && <div className="text-xs text-gray-400">กำลังคำนวณวัตถุดิบ...</div>}

                      {requirement && (
                        <>
                          <div className="text-xs text-gray-500">
                            ขยายสูตร <span className="font-medium text-gray-700">{requirement.scale} เท่า</span> —
                            วัตถุดิบที่ต้องใช้
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="text-gray-400">
                                <tr className="text-left">
                                  <th className="py-1.5 pr-3 font-normal">วัตถุดิบ</th>
                                  <th className="py-1.5 pr-3 font-normal text-right">ต้องใช้</th>
                                  <th className="py-1.5 pr-3 font-normal text-right">มีในสต๊อก</th>
                                  <th className="py-1.5 font-normal text-right">ขาด</th>
                                </tr>
                              </thead>
                              <tbody className="text-gray-600">
                                {requirement.lines.map(l => (
                                  <tr key={l.formula_line_id} className="border-t border-gray-200">
                                    <td className="py-1.5 pr-3">{l.mat_uid} | {l.product_name}</td>
                                    <td className="py-1.5 pr-3 text-right">
                                      {trimNumber(l.required_qty)} {l.required_unit_name}
                                    </td>
                                    <td className="py-1.5 pr-3 text-right">{trimNumber(l.available_qty)}</td>
                                    <td className={`py-1.5 text-right font-medium ${l.shortage > 0 ? 'text-red-500' : 'text-green-600'}`}>
                                      {l.shortage > 0 ? trimNumber(l.shortage) : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {requirement.can_produce ? (
                            <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-3 flex flex-col sm:flex-row sm:items-end gap-3">
                              <div className="sm:w-56">
                                <label className={labelClass}>
                                  บรรจุได้กี่{detail.output_stock_unit ? 'หน่วย' : 'หน่วย'}? (= จำนวน QR)
                                </label>
                                <input type="number" value={outputUnits}
                                  onChange={e => setOutputUnits(e.target.value)}
                                  className={inputClass} min="1" step="1" />
                                {requirement.suggested_output_units && (
                                  <div className="text-xs text-gray-400 mt-1">
                                    ระบบแนะนำ {requirement.suggested_output_units} จากขนาดบรรจุ — แก้ได้
                                  </div>
                                )}
                              </div>
                              <button onClick={handleProduce} disabled={producing}
                                className="h-10 px-5 text-sm rounded-xl bg-green-500 text-white hover:bg-green-600 disabled:opacity-50">
                                {producing ? 'กำลังผลิต...' : 'ยืนยันผลิต + หักสต๊อก'}
                              </button>
                            </div>
                          ) : (
                            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">
                              วัตถุดิบไม่พอ ผลิตไม่ได้ — ไปสั่งซื้อหรือรับของเข้ามาก่อน
                            </div>
                          )}
                        </>
                      )}

                      <div>
                        <button onClick={() => handleCancel(detail.id)}
                          className="h-9 px-4 text-xs rounded-xl border border-gray-200 text-red-500 hover:bg-red-50">
                          ยกเลิกใบสั่งผลิต
                        </button>
                      </div>
                    </>
                  )}

                  {/* ผลิตแล้ว — แสดงของที่หักไปจริงพร้อมต้นทุน */}
                  {detail.status === 'done' && (
                    <>
                      <div className="text-xs text-gray-500">วัตถุดิบที่ใช้จริงและต้นทุน</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-gray-400">
                            <tr className="text-left">
                              <th className="py-1.5 pr-3 font-normal">วัตถุดิบ</th>
                              <th className="py-1.5 pr-3 font-normal">ชิ้นที่หัก</th>
                              <th className="py-1.5 pr-3 font-normal text-right">ปริมาณ</th>
                              <th className="py-1.5 font-normal text-right">ต้นทุน</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-600">
                            {detail.consumption.map(c => (
                              <tr key={c.id} className="border-t border-gray-200">
                                <td className="py-1.5 pr-3">{c.product_name}</td>
                                <td className="py-1.5 pr-3 text-gray-400">{c.item_code}</td>
                                <td className="py-1.5 pr-3 text-right">
                                  {trimNumber(c.qty)} {c.unit_name || c.unit_code}
                                </td>
                                <td className="py-1.5 text-right">{trimNumber(c.cost, 2)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-gray-300 font-medium text-gray-800">
                              <td className="py-2 pr-3" colSpan={3}>
                                ต้นทุนรวม · บรรจุได้ {detail.output_units} หน่วย
                              </td>
                              <td className="py-2 text-right">
                                {Number(detail.total_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                            <tr className="text-blue-600">
                              <td className="py-1 pr-3" colSpan={3}>ต้นทุนต่อหน่วย</td>
                              <td className="py-1 text-right font-medium">
                                {trimNumber(detail.cost_per_unit, 2)} ฿
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </>
                  )}

                  {detail.note && <div className="text-xs text-gray-500">หมายเหตุ: {detail.note}</div>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
