import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/axios'
import { unitName, trimNumber } from '../lib/units'

const STATUS_LABEL = {
  draft:     { text: 'ร่าง',        cls: 'bg-gray-100 text-gray-600' },
  ordered:   { text: 'สั่งซื้อแล้ว', cls: 'bg-blue-100 text-blue-600' },
  partial:   { text: 'รับบางส่วน',  cls: 'bg-amber-100 text-amber-700' },
  received:  { text: 'รับครบแล้ว',  cls: 'bg-green-100 text-green-600' },
  cancelled: { text: 'ยกเลิก',      cls: 'bg-red-100 text-red-500' },
}

const emptyLine = () => ({ product_id: '', qty: '', unit_code: '', unit_price: '', note: '' })

export default function Orders() {
  const navigate = useNavigate()

  const [orders,   setOrders]   = useState([])
  const [products, setProducts] = useState([])
  const [units,    setUnits]    = useState([])
  const [search,   setSearch]   = useState('')
  const [status,   setStatus]   = useState('')
  const [error,    setError]    = useState('')

  const [showForm, setShowForm] = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [form,     setForm]     = useState(null)

  const [detail,   setDetail]   = useState(null)
  const [newLink,  setNewLink]  = useState({ file_name: '', file_url: '' })

  const fetchOrders = useCallback(async () => {
    try {
      const res = await api.get('/orders', { params: { search: search || undefined, status: status || undefined } })
      setOrders(res.data)
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดใบสั่งซื้อไม่สำเร็จ')
    }
  }, [search, status])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  useEffect(() => {
    api.get('/products').then(res => setProducts(res.data)).catch(() => {})
    api.get('/units').then(res => setUnits(res.data)).catch(() => {})
  }, [])

  const openForm = async () => {
    const today = new Date().toISOString().slice(0, 10)
    let code = ''
    try { code = (await api.get('/orders/next-code')).data.order_code } catch {}
    setForm({ order_code: code, order_date: today, supplier: '', note: '', lines: [emptyLine()] })
    setShowForm(true)
    setError('')
  }

  const setLine = (idx, patch) => {
    setForm(prev => ({
      ...prev,
      lines: prev.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }))
  }

  // เลือกสินค้าแล้วเติมหน่วยนับของสินค้านั้นให้อัตโนมัติ — ตอนรับของต้องใช้หน่วยนี้เท่านั้น
  const handleProductPick = (idx, product_id) => {
    const product = products.find(p => String(p.product_id) === String(product_id))
    setLine(idx, { product_id, unit_code: product?.stock_unit || '' })
  }

  const lineTotal = (line) => (Number(line.qty) || 0) * (Number(line.unit_price) || 0)
  const formTotal = form ? form.lines.reduce((sum, l) => sum + lineTotal(l), 0) : 0

  const handleSave = async (e) => {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      await api.post('/orders', {
        ...form,
        lines: form.lines.map((l, i) => ({ ...l, seq: i + 1 })),
      })
      setShowForm(false); setForm(null)
      fetchOrders()
    } catch (err) {
      setError(err.response?.data?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const openDetail = async (id) => {
    if (detail?.id === id) { setDetail(null); return }
    try {
      setDetail((await api.get(`/orders/${id}`)).data)
      setNewLink({ file_name: '', file_url: '' })
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดรายละเอียดไม่สำเร็จ')
    }
  }

  const changeStatus = async (id, next) => {
    try {
      await api.patch(`/orders/${id}/status`, { status: next })
      await fetchOrders()
      setDetail((await api.get(`/orders/${id}`)).data)
    } catch (err) {
      alert(err.response?.data?.message || 'เปลี่ยนสถานะไม่สำเร็จ')
    }
  }

  const addAttachment = async () => {
    if (!newLink.file_url.trim()) return
    try {
      await api.post('/attachments', {
        ref_type: 'purchase_order', ref_id: detail.id,
        file_name: newLink.file_name.trim() || null,
        file_url:  newLink.file_url.trim(),
      })
      setDetail((await api.get(`/orders/${detail.id}`)).data)
      setNewLink({ file_name: '', file_url: '' })
    } catch (err) {
      alert(err.response?.data?.message || 'แนบหลักฐานไม่สำเร็จ')
    }
  }

  const removeAttachment = async (attId) => {
    try {
      await api.delete(`/attachments/${attId}`)
      setDetail((await api.get(`/orders/${detail.id}`)).data)
    } catch (err) {
      alert(err.response?.data?.message || 'ลบไม่สำเร็จ')
    }
  }

  const inputClass = "h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white text-gray-700 w-full"
  const labelClass = "text-xs text-gray-500 mb-1.5 block"

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">ใบสั่งซื้อ</h1>
          <p className="text-sm text-gray-500 mt-0.5">รายการสั่งซื้อวัตถุดิบจากผู้จำหน่าย</p>
        </div>
        <div className="sm:ml-auto flex flex-wrap gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="h-9 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white basis-full sm:basis-auto min-w-0"
            placeholder="ค้นหาเลขที่ / ผู้จำหน่าย" />
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="h-9 px-3 text-sm rounded-xl border border-gray-200 bg-white text-gray-700">
            <option value="">ทุกสถานะ</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
          </select>
          <button onClick={openForm}
            className="h-9 px-4 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 whitespace-nowrap">
            ＋ สร้าง
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</div>}

      {/* ===== ฟอร์มสร้างใบสั่งซื้อ ===== */}
      {showForm && form && (
        <form onSubmit={handleSave} className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">
            ใบสั่งซื้อใหม่
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>เลขที่ใบสั่งซื้อ</label>
              <input value={form.order_code} onChange={e => setForm({ ...form, order_code: e.target.value })}
                className={inputClass} placeholder="PR100001" />
              <div className="text-xs text-gray-400 mt-1">ระบบออกให้อัตโนมัติ แก้ได้</div>
            </div>
            <div>
              <label className={labelClass}>วันที่สั่งซื้อ</label>
              <input type="date" value={form.order_date}
                onChange={e => setForm({ ...form, order_date: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>ผู้จำหน่าย</label>
              <input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })}
                className={inputClass} placeholder="เช่น เมืองพาน" />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-xs text-gray-500">รายการสินค้า</div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end bg-gray-50 rounded-xl p-3">
                <div className="col-span-2 sm:col-span-5">
                  <label className={labelClass}>สินค้า</label>
                  <select value={line.product_id} onChange={e => handleProductPick(idx, e.target.value)}
                    className={inputClass}>
                    <option value="">-- เลือกสินค้า --</option>
                    {products.map(p => (
                      <option key={p.product_id} value={p.product_id}>{p.mat_uid} | {p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>จำนวน</label>
                  <input type="number" value={line.qty} onChange={e => setLine(idx, { qty: e.target.value })}
                    className={inputClass} min="0" step="1" />
                </div>
                <div className="sm:col-span-1">
                  <label className={labelClass}>หน่วย</label>
                  <div className="h-10 flex items-center text-sm text-gray-600">
                    {unitName(units, line.unit_code) || '-'}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>ราคา/หน่วย</label>
                  <input type="number" value={line.unit_price}
                    onChange={e => setLine(idx, { unit_price: e.target.value })}
                    className={inputClass} min="0" step="0.01" />
                </div>
                <div className="sm:col-span-2 flex items-end gap-2">
                  <div className="flex-1">
                    <label className={labelClass}>รวม</label>
                    <div className="h-10 flex items-center text-sm font-medium text-gray-700">
                      {lineTotal(line).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  {form.lines.length > 1 && (
                    <button type="button"
                      onClick={() => setForm(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }))}
                      className="h-10 px-3 text-xs rounded-xl border border-gray-200 text-red-400 hover:bg-red-50">✕</button>
                  )}
                </div>
              </div>
            ))}
            <button type="button"
              onClick={() => setForm(prev => ({ ...prev, lines: [...prev.lines, emptyLine()] }))}
              className="self-start h-9 px-4 text-xs rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
              ＋ เพิ่มรายการ
            </button>
          </div>

          <div>
            <label className={labelClass}>หมายเหตุ</label>
            <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className={inputClass} />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="text-sm text-gray-600">
              ยอดรวม <span className="text-lg font-semibold text-gray-800 ml-2">
                {formTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </span> บาท
            </div>
            <div className="sm:ml-auto flex gap-3">
              <button type="button" onClick={() => { setShowForm(false); setForm(null) }}
                className="h-10 px-5 text-sm rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
                ยกเลิก
              </button>
              <button type="submit" disabled={saving}
                className="h-10 px-5 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                {saving ? 'กำลังบันทึก...' : 'บันทึกใบสั่งซื้อ'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ===== รายการใบสั่งซื้อ ===== */}
      <div className="flex flex-col gap-2">
        {orders.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm px-4 py-8 text-center text-sm text-gray-400">
            ยังไม่มีใบสั่งซื้อ
          </div>
        )}

        {orders.map(o => {
          const badge = STATUS_LABEL[o.status] || STATUS_LABEL.draft
          const isOpen = detail?.id === o.id
          return (
            <div key={o.id} className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
              <button onClick={() => openDetail(o.id)}
                className="w-full px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-left hover:bg-gray-50">
                <span className="text-sm font-medium text-gray-800">{o.order_code}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.text}</span>
                <span className="text-xs text-gray-500">{String(o.order_date).slice(0, 10)}</span>
                <span className="text-xs text-gray-500">{o.supplier || '-'}</span>
                <span className="text-xs text-gray-400">{o.line_count} รายการ</span>
                <span className="ml-auto text-sm font-medium text-gray-700">
                  {Number(o.total_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
                </span>
                <span className="text-gray-300 text-xs">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="border-t border-gray-100 px-4 py-3 flex flex-col gap-4 bg-gray-50">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-gray-400">
                        <tr className="text-left">
                          <th className="py-1.5 pr-3 font-normal">สินค้า</th>
                          <th className="py-1.5 pr-3 font-normal text-right">สั่ง</th>
                          <th className="py-1.5 pr-3 font-normal text-right">รับแล้ว</th>
                          <th className="py-1.5 pr-3 font-normal text-right">ราคา/หน่วย</th>
                          <th className="py-1.5 font-normal text-right">รวม</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-600">
                        {detail.lines.map(l => (
                          <tr key={l.id} className="border-t border-gray-200">
                            <td className="py-1.5 pr-3">{l.mat_uid} | {l.product_name}</td>
                            <td className="py-1.5 pr-3 text-right">{trimNumber(l.qty)} {l.unit_name || l.unit_code}</td>
                            <td className="py-1.5 pr-3 text-right">
                              <span className={Number(l.qty_received) >= Number(l.qty) ? 'text-green-600' : 'text-amber-600'}>
                                {trimNumber(l.qty_received)}
                              </span>
                            </td>
                            <td className="py-1.5 pr-3 text-right">{trimNumber(l.unit_price, 2)}</td>
                            <td className="py-1.5 text-right">{Number(l.total_price).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {detail.note && <div className="text-xs text-gray-500">หมายเหตุ: {detail.note}</div>}

                  {/* หลักฐานการซื้อ */}
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-gray-500">หลักฐานการซื้อ</div>
                    {detail.attachments.map(a => (
                      <div key={a.id} className="flex items-center gap-2 text-xs">
                        <a href={a.file_url} target="_blank" rel="noreferrer"
                          className="text-blue-600 hover:underline truncate">
                          {a.file_name || a.file_url}
                        </a>
                        <span className="text-gray-400">{a.uploaded_by_name}</span>
                        <button onClick={() => removeAttachment(a.id)}
                          className="ml-auto text-red-400 hover:text-red-500">ลบ</button>
                      </div>
                    ))}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input value={newLink.file_name}
                        onChange={e => setNewLink({ ...newLink, file_name: e.target.value })}
                        className="h-9 px-3 text-xs rounded-xl border border-gray-200 bg-white sm:w-48"
                        placeholder="ชื่อไฟล์ (ไม่ใส่ก็ได้)" />
                      <input value={newLink.file_url}
                        onChange={e => setNewLink({ ...newLink, file_url: e.target.value })}
                        className="h-9 px-3 text-xs rounded-xl border border-gray-200 bg-white flex-1"
                        placeholder="วางลิงก์ใบเสร็จ เช่น https://..." />
                      <button onClick={addAttachment}
                        className="h-9 px-4 text-xs rounded-xl border border-gray-200 text-gray-600 hover:bg-white">
                        แนบ
                      </button>
                    </div>
                  </div>

                  {/* ปุ่มจัดการ */}
                  <div className="flex flex-wrap gap-2">
                    {detail.status === 'draft' && (
                      <button onClick={() => changeStatus(detail.id, 'ordered')}
                        className="h-9 px-4 text-xs rounded-xl bg-blue-500 text-white hover:bg-blue-600">
                        ยืนยันสั่งซื้อ
                      </button>
                    )}
                    {['ordered', 'partial'].includes(detail.status) && (
                      <button onClick={() => navigate(`/receive?order=${detail.id}`)}
                        className="h-9 px-4 text-xs rounded-xl bg-green-500 text-white hover:bg-green-600">
                        รับของเข้า Stock
                      </button>
                    )}
                    {['draft', 'ordered'].includes(detail.status) && (
                      <button onClick={() => changeStatus(detail.id, 'cancelled')}
                        className="h-9 px-4 text-xs rounded-xl border border-gray-200 text-red-500 hover:bg-red-50">
                        ยกเลิกใบสั่งซื้อ
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
