import { useState, useEffect, useCallback } from 'react'
import api from '../api/axios'
import { unitName, trimNumber, formatQty } from '../lib/units'

/**
 * Selling Process — "สร้างรายการขายดึงของจาก Stock โดยตรง
 * แล้วสรุปราคาและผลกำไรได้จากรอบการขายนั้น ๆ"
 *
 * ใบขายเริ่มเป็นร่างก่อน ยังไม่แตะสต๊อก แก้ได้ตามใจ
 * กดยืนยันขายถึงจะหักของตาม FIFO แล้วรู้ต้นทุนจริง → กำไรของรอบนั้น
 */

const STATUS_LABEL = {
  draft:     { text: 'ร่าง',     cls: 'bg-gray-100 text-gray-600' },
  confirmed: { text: 'ขายแล้ว',  cls: 'bg-green-100 text-green-600' },
  cancelled: { text: 'ยกเลิก',   cls: 'bg-red-100 text-red-500' },
}

const today = () => new Date().toISOString().slice(0, 10)
const emptyLine = () => ({ product_id: '', qty: '', unit_code: '', unit_price: '', note: '' })
const baht = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 })

export default function Sales() {
  const [sales,    setSales]    = useState([])
  const [products, setProducts] = useState([])
  const [units,    setUnits]    = useState([])
  const [summary,  setSummary]  = useState(null)
  const [filter,   setFilter]   = useState({ search: '', status: '', from: '', to: '' })
  const [error,    setError]    = useState('')

  const [form,   setForm]   = useState(null)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState(null)

  const fetchSales = useCallback(async () => {
    try {
      const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v))
      setSales((await api.get('/sales', { params })).data)
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดรายการขายไม่สำเร็จ')
    }
  }, [filter])

  const fetchSummary = useCallback(async () => {
    try {
      const params = {}
      if (filter.from) params.from = filter.from
      if (filter.to)   params.to = filter.to
      setSummary((await api.get('/sales/summary', { params })).data)
    } catch {}
  }, [filter.from, filter.to])

  useEffect(() => { fetchSales() }, [fetchSales])
  useEffect(() => { fetchSummary() }, [fetchSummary])

  useEffect(() => {
    api.get('/products').then(res => setProducts(res.data)).catch(() => {})
    api.get('/units').then(res => setUnits(res.data)).catch(() => {})
  }, [])

  const refreshAll = async () => { await fetchSales(); await fetchSummary() }

  const openCreate = async () => {
    let no = ''
    try { no = (await api.get('/sales/next-no')).data.sale_no } catch {}
    setForm({ sale_no: no, sale_date: today(), customer: '', note: '', lines: [emptyLine()] })
    setEditId(null)
    setError('')
  }

  const openEdit = (sale) => {
    setForm({
      sale_no: sale.sale_no, sale_date: String(sale.sale_date).slice(0, 10),
      customer: sale.customer || '', note: sale.note || '',
      lines: sale.lines.map(l => ({
        product_id: String(l.product_id), qty: trimNumber(l.qty),
        unit_code: l.unit_code, unit_price: trimNumber(l.unit_price, 2), note: l.note || '',
      })),
    })
    setEditId(sale.id)
    setError('')
  }

  const setLine = (idx, patch) =>
    setForm(prev => ({ ...prev, lines: prev.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }))

  // ขายเป็นหน่วยไหนก็ได้ที่แปลงกันได้ แต่ตั้งต้นด้วยหน่วยบรรจุของสินค้า
  const pickProduct = (idx, product_id) => {
    const p = products.find(x => String(x.product_id) === String(product_id))
    setLine(idx, { product_id, unit_code: p?.pack_unit || p?.stock_unit || '' })
  }

  const lineTotal = (l) => (Number(l.qty) || 0) * (Number(l.unit_price) || 0)
  const formTotal = form ? form.lines.reduce((s, l) => s + lineTotal(l), 0) : 0

  const handleSave = async (e) => {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      const payload = { ...form, lines: form.lines.map((l, i) => ({ ...l, seq: i + 1 })) }
      if (editId) await api.put(`/sales/${editId}`, payload)
      else        await api.post('/sales', payload)
      setForm(null); setEditId(null); setDetail(null)
      refreshAll()
    } catch (err) {
      setError(err.response?.data?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const openDetail = async (id) => {
    if (detail?.id === id) { setDetail(null); return }
    setError('')
    try { setDetail((await api.get(`/sales/${id}`)).data) } catch (err) {
      setError(err.response?.data?.message || 'โหลดรายละเอียดไม่สำเร็จ')
    }
  }

  const confirmSale = async (id) => {
    setError(''); setSaving(true)
    try {
      await api.post(`/sales/${id}/confirm`)
      setDetail((await api.get(`/sales/${id}`)).data)
      refreshAll()
    } catch (err) {
      const res = err.response?.data
      setError(res?.shortages
        ? `${res.message}: ` + res.shortages
            .map(s => `${s.product_name} ต้องการ ${trimNumber(s.required)} ${s.unit} มี ${trimNumber(s.available)}`).join(', ')
        : res?.message || 'ยืนยันการขายไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const cancelSale = async (id) => {
    try {
      await api.patch(`/sales/${id}/cancel`)
      setDetail((await api.get(`/sales/${id}`)).data)
      refreshAll()
    } catch (err) {
      alert(err.response?.data?.message || 'ยกเลิกไม่สำเร็จ')
    }
  }

  const inputClass = "h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white text-gray-700 w-full"
  const labelClass = "text-xs text-gray-500 mb-1.5 block"

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <h1 className="text-base font-semibold text-gray-800">การขาย</h1>
        <div className="sm:ml-auto flex flex-wrap gap-2">
          <input value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })}
            className="h-9 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white basis-full sm:basis-auto min-w-0"
            placeholder="ค้นหาเลขที่ / ลูกค้า" />
          <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}
            className="h-9 px-3 text-sm rounded-xl border border-gray-200 bg-white text-gray-700">
            <option value="">ทุกสถานะ</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
          </select>
          <button onClick={openCreate}
            className="h-9 px-4 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 whitespace-nowrap">
            ＋ สร้างใบขาย
          </button>
        </div>
      </div>

      {/* ===== สรุปกำไร ===== */}
      {summary && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-gray-700">สรุปยอดขาย (เฉพาะใบที่ขายแล้ว)</span>
            <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
              <input type="date" value={filter.from} onChange={e => setFilter({ ...filter, from: e.target.value })}
                className="h-8 px-2 text-xs rounded-lg border border-gray-200 bg-white" />
              <span>ถึง</span>
              <input type="date" value={filter.to} onChange={e => setFilter({ ...filter, to: e.target.value })}
                className="h-8 px-2 text-xs rounded-lg border border-gray-200 bg-white" />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <div className="text-xs text-gray-400">จำนวนรอบขาย</div>
              <div className="text-lg font-semibold text-gray-800">{summary.sale_count}</div>
            </div>
            <div className="bg-blue-50 rounded-xl px-4 py-3">
              <div className="text-xs text-blue-500">ยอดขาย</div>
              <div className="text-lg font-semibold text-blue-700">{baht(summary.total_amount)}</div>
            </div>
            <div className="bg-amber-50 rounded-xl px-4 py-3">
              <div className="text-xs text-amber-600">ต้นทุน</div>
              <div className="text-lg font-semibold text-amber-700">{baht(summary.total_cost)}</div>
            </div>
            <div className={`rounded-xl px-4 py-3 ${Number(summary.profit) >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <div className={`text-xs ${Number(summary.profit) >= 0 ? 'text-green-600' : 'text-red-500'}`}>กำไร</div>
              <div className={`text-lg font-semibold ${Number(summary.profit) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {baht(summary.profit)}
              </div>
            </div>
          </div>

          {summary.by_product.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-400">
                  <tr className="text-left">
                    <th className="py-1.5 pr-3 font-normal">สินค้า</th>
                    <th className="py-1.5 pr-3 font-normal text-right">ขายไป</th>
                    <th className="py-1.5 pr-3 font-normal text-right">ยอดขาย</th>
                    <th className="py-1.5 pr-3 font-normal text-right">ต้นทุน</th>
                    <th className="py-1.5 font-normal text-right">กำไร</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600">
                  {summary.by_product.map(p => (
                    <tr key={p.product_id} className="border-t border-gray-100">
                      <td className="py-1.5 pr-3">{p.mat_uid} | {p.product_name}</td>
                      <td className="py-1.5 pr-3 text-right">{trimNumber(p.qty_sold)}</td>
                      <td className="py-1.5 pr-3 text-right">{baht(p.amount)}</td>
                      <td className="py-1.5 pr-3 text-right">{baht(p.cost)}</td>
                      <td className={`py-1.5 text-right font-medium ${Number(p.profit) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {baht(p.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {error && <div className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</div>}

      {/* ===== ฟอร์มใบขาย ===== */}
      {form && (
        <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">
            {editId ? `💰 แก้ไขใบขาย ${form.sale_no}` : '💰 ใบขายใหม่'}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>เลขที่ใบขาย</label>
              <input value={form.sale_no} onChange={e => setForm({ ...form, sale_no: e.target.value })}
                className={inputClass} placeholder="SO000001" disabled={!!editId} />
            </div>
            <div>
              <label className={labelClass}>วันที่ขาย</label>
              <input type="date" value={form.sale_date}
                onChange={e => setForm({ ...form, sale_date: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>ลูกค้า</label>
              <input value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })}
                className={inputClass} placeholder="ชื่อลูกค้า" />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-xs text-gray-500">รายการที่ขาย</div>
            {form.lines.map((line, idx) => {
              const p = products.find(x => String(x.product_id) === String(line.product_id))
              return (
                <div key={idx} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end bg-gray-50 rounded-xl p-3">
                  <div className="col-span-2 sm:col-span-4">
                    <label className={labelClass}>สินค้า</label>
                    <select value={line.product_id} onChange={e => pickProduct(idx, e.target.value)}
                      className={inputClass}>
                      <option value="">-- เลือกสินค้า --</option>
                      {products.map(x => (
                        <option key={x.product_id} value={x.product_id}>{x.mat_uid} | {x.name}</option>
                      ))}
                    </select>
                    {p && (
                      <div className="text-xs text-gray-400 mt-1">
                        มีในสต๊อก {formatQty(units, p.total_stock || 0, p.stock_unit)}
                      </div>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>จำนวน</label>
                    <input type="number" value={line.qty} onChange={e => setLine(idx, { qty: e.target.value })}
                      className={inputClass} min="0" step="0.0001" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>หน่วย</label>
                    <select value={line.unit_code} onChange={e => setLine(idx, { unit_code: e.target.value })}
                      className={inputClass}>
                      <option value="">-- หน่วย --</option>
                      {units.filter(u => u.kind !== 'area').map(u => (
                        <option key={u.code} value={u.code}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>ราคาขาย/หน่วย</label>
                    <input type="number" value={line.unit_price}
                      onChange={e => setLine(idx, { unit_price: e.target.value })}
                      className={inputClass} min="0" step="0.01" />
                  </div>
                  <div className="sm:col-span-2 flex items-end gap-2">
                    <div className="flex-1">
                      <label className={labelClass}>รวม</label>
                      <div className="h-10 flex items-center text-sm font-medium text-gray-700">
                        {baht(lineTotal(line))}
                      </div>
                    </div>
                    {form.lines.length > 1 && (
                      <button type="button"
                        onClick={() => setForm(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }))}
                        className="h-10 px-3 text-xs rounded-xl border border-gray-200 text-red-400 hover:bg-red-50">✕</button>
                    )}
                  </div>
                </div>
              )
            })}
            <button type="button" onClick={() => setForm(p => ({ ...p, lines: [...p.lines, emptyLine()] }))}
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
              ยอดขายรวม <span className="text-lg font-semibold text-gray-800 ml-2">{baht(formTotal)}</span> บาท
              <span className="text-xs text-gray-400 ml-2">(ต้นทุนและกำไรจะรู้ตอนยืนยันขาย)</span>
            </div>
            <div className="sm:ml-auto flex gap-3">
              <button type="button" onClick={() => { setForm(null); setEditId(null) }}
                className="h-10 px-5 text-sm rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
                ยกเลิก
              </button>
              <button type="submit" disabled={saving}
                className="h-10 px-5 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                {saving ? 'กำลังบันทึก...' : '✓ บันทึกเป็นร่าง'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ===== รายการขาย ===== */}
      <div className="flex flex-col gap-2">
        {sales.length === 0 && !form && (
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            ยังไม่มีรายการขาย
          </div>
        )}

        {sales.map(s => {
          const badge = STATUS_LABEL[s.status] || STATUS_LABEL.draft
          const isOpen = detail?.id === s.id
          return (
            <div key={s.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button onClick={() => openDetail(s.id)}
                className="w-full px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-left hover:bg-gray-50">
                <span className="text-sm font-medium text-gray-800">{s.sale_no}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.text}</span>
                <span className="text-xs text-gray-500">{String(s.sale_date).slice(0, 10)}</span>
                <span className="text-xs text-gray-600">{s.customer || 'ไม่ระบุลูกค้า'}</span>
                <span className="text-xs text-gray-400">{s.line_count} รายการ</span>
                <span className="ml-auto text-sm font-medium text-gray-700">{baht(s.total_amount)} ฿</span>
                {s.status === 'confirmed' && (
                  <span className={`text-sm font-medium ${Number(s.profit) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    กำไร {baht(s.profit)}
                  </span>
                )}
                <span className="text-gray-300 text-xs">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && detail && (
                <div className="border-t border-gray-100 px-4 py-3 flex flex-col gap-4 bg-gray-50">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-gray-400">
                        <tr className="text-left">
                          <th className="py-1.5 pr-3 font-normal">สินค้า</th>
                          <th className="py-1.5 pr-3 font-normal text-right">จำนวน</th>
                          <th className="py-1.5 pr-3 font-normal text-right">ราคา/หน่วย</th>
                          <th className="py-1.5 pr-3 font-normal text-right">ยอดขาย</th>
                          <th className="py-1.5 pr-3 font-normal text-right">ต้นทุน</th>
                          <th className="py-1.5 font-normal text-right">กำไร</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-600">
                        {detail.lines.map(l => {
                          const lineProfit = Number(l.total_price) - Number(l.total_cost)
                          return (
                            <tr key={l.id} className="border-t border-gray-200 align-top">
                              <td className="py-1.5 pr-3">
                                {l.mat_uid} | {l.product_name}
                                {l.items.length > 0 && (
                                  <div className="text-gray-400 mt-0.5">
                                    {l.items.map(it => (
                                      <div key={it.id}>
                                        {it.item_code} · Lot {it.lot_no} · {trimNumber(it.qty)}{' '}
                                        {it.unit_name || it.unit_code} · {trimNumber(it.cost, 2)} ฿
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="py-1.5 pr-3 text-right">
                                {trimNumber(l.qty)} {l.unit_name || unitName(units, l.unit_code)}
                              </td>
                              <td className="py-1.5 pr-3 text-right">{trimNumber(l.unit_price, 2)}</td>
                              <td className="py-1.5 pr-3 text-right">{baht(l.total_price)}</td>
                              <td className="py-1.5 pr-3 text-right">
                                {detail.status === 'confirmed' ? baht(l.total_cost) : '—'}
                              </td>
                              <td className={`py-1.5 text-right font-medium ${lineProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                {detail.status === 'confirmed' ? baht(lineProfit) : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      {detail.status === 'confirmed' && (
                        <tfoot>
                          <tr className="border-t-2 border-gray-300 font-medium text-gray-800">
                            <td className="py-2 pr-3" colSpan={3}>รวมทั้งรอบ</td>
                            <td className="py-2 pr-3 text-right">{baht(detail.total_amount)}</td>
                            <td className="py-2 pr-3 text-right">{baht(detail.total_cost)}</td>
                            <td className={`py-2 text-right ${Number(detail.profit) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                              {baht(detail.profit)}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>

                  {detail.note && <div className="text-xs text-gray-500">หมายเหตุ: {detail.note}</div>}

                  <div className="flex flex-wrap gap-2">
                    {detail.status === 'draft' && (
                      <>
                        <button onClick={() => confirmSale(detail.id)} disabled={saving}
                          className="h-9 px-4 text-xs rounded-xl bg-green-500 text-white hover:bg-green-600 disabled:opacity-50">
                          {saving ? 'กำลังยืนยัน...' : '💰 ยืนยันขาย + หักสต๊อก'}
                        </button>
                        <button onClick={() => openEdit(detail)}
                          className="h-9 px-4 text-xs rounded-xl border border-gray-200 text-gray-600 hover:bg-white">
                          ✏️ แก้ไข
                        </button>
                        <button onClick={() => cancelSale(detail.id)}
                          className="h-9 px-4 text-xs rounded-xl border border-gray-200 text-red-500 hover:bg-red-50">
                          ยกเลิกใบขาย
                        </button>
                      </>
                    )}
                    {detail.status === 'confirmed' && (
                      <div className="text-xs text-gray-400">
                        ยืนยันขายเมื่อ {detail.confirmed_at ? new Date(detail.confirmed_at).toLocaleString('th-TH') : '-'}
                        {' '}· ของถูกหักออกจากสต๊อกแล้ว ย้อนกลับไม่ได้
                      </div>
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
