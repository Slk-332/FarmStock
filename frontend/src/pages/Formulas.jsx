import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../api/axios'
import { unitName, trimNumber } from '../lib/units'

/**
 * สูตรผสม — "บันทึกสูตรช่วยให้ทำครั้งถัดไปได้" ตาม Newfunction
 *
 * สูตรเก็บสัดส่วนต่อ 1 ชุด (เช่น ได้ 10 กก. ใช้กากน้ำตาล 500 กรัม)
 * ตอนสั่งผลิตค่อยขยายตามปริมาณที่ต้องการ
 */

const emptyLine = () => ({ product_id: '', qty: '', unit_code: '', note: '' })

const emptyForm = () => ({
  std_code: '', name: '', gtf_no: '',
  ferment_days: '', shelf_life_days: '',
  output_product_id: '', output_qty: '', output_unit: '',
  note: '', lines: [emptyLine()],
})

export default function Formulas() {
  const [formulas, setFormulas] = useState([])
  const [products, setProducts] = useState([])
  const [units,    setUnits]    = useState([])
  const [search,   setSearch]   = useState('')
  const [error,    setError]    = useState('')

  const [form,     setForm]     = useState(null)
  const [editId,   setEditId]   = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [detail,   setDetail]   = useState(null)

  const fetchFormulas = useCallback(async () => {
    try {
      setFormulas((await api.get('/formulas', { params: { search: search || undefined } })).data)
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดสูตรไม่สำเร็จ')
    }
  }, [search])

  useEffect(() => { fetchFormulas() }, [fetchFormulas])

  useEffect(() => {
    api.get('/products').then(res => setProducts(res.data)).catch(() => {})
    api.get('/units').then(res => setUnits(res.data)).catch(() => {})
  }, [])

  // ผลผลิตของสูตรต้องเป็นสินค้าประเภท "ของผสม" — ลงทะเบียนไว้ก่อนที่หน้าลงทะเบียน
  const mixedProducts = useMemo(
    () => products.filter(p => p.mat_type === 'mixed'), [products]
  )
  const measureUnits = useMemo(() => units.filter(u => u.kind !== 'count'), [units])

  const openCreate = async () => {
    let code = ''
    try { code = (await api.get('/formulas/next-code')).data.std_code } catch {}
    setForm({ ...emptyForm(), std_code: code })
    setEditId(null)
    setError('')
  }

  const openEdit = async (id) => {
    try {
      const { data } = await api.get(`/formulas/${id}`)
      setForm({
        std_code: data.std_code, name: data.name, gtf_no: data.gtf_no || '',
        ferment_days: String(data.ferment_days), shelf_life_days: String(data.shelf_life_days),
        output_product_id: String(data.output_product_id),
        output_qty: trimNumber(data.output_qty), output_unit: data.output_unit,
        note: data.note || '',
        lines: data.lines.map(l => ({
          product_id: String(l.product_id), qty: trimNumber(l.qty),
          unit_code: l.unit_code, note: l.note || '',
        })),
      })
      setEditId(id)
      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดสูตรไม่สำเร็จ')
    }
  }

  const setLine = (idx, patch) =>
    setForm(prev => ({ ...prev, lines: prev.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }))

  // เลือกวัตถุดิบแล้วเดาหน่วยให้ — ของเหลวเดาเป็นหน่วยบรรจุ ของนับเป็นชิ้นเดาเป็นหน่วยนับ
  const handleMaterialPick = (idx, product_id) => {
    const p = products.find(x => String(x.product_id) === String(product_id))
    setLine(idx, { product_id, unit_code: p?.pack_unit || p?.stock_unit || '' })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      const payload = {
        ...form,
        ferment_days: Number(form.ferment_days) || 0,
        shelf_life_days: Number(form.shelf_life_days) || 0,
        output_qty: Number(form.output_qty),
        lines: form.lines.map((l, i) => ({ ...l, seq: i + 1, qty: Number(l.qty) })),
      }
      if (editId) await api.put(`/formulas/${editId}`, payload)
      else        await api.post('/formulas', payload)
      setForm(null); setEditId(null)
      fetchFormulas()
    } catch (err) {
      setError(err.response?.data?.message || 'บันทึกสูตรไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const openDetail = async (id) => {
    if (detail?.id === id) { setDetail(null); return }
    try { setDetail((await api.get(`/formulas/${id}`)).data) } catch {}
  }

  const toggleActive = async (f) => {
    try {
      await api.put(`/formulas/${f.id}`, { is_active: !f.is_active })
      fetchFormulas()
      if (detail?.id === f.id) setDetail((await api.get(`/formulas/${f.id}`)).data)
    } catch (err) {
      alert(err.response?.data?.message || 'เปลี่ยนสถานะไม่สำเร็จ')
    }
  }

  const inputClass = "h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white text-gray-700 w-full"
  const labelClass = "text-xs text-gray-500 mb-1.5 block"

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <h1 className="text-base font-semibold text-gray-800">สูตรผสม</h1>
        <div className="sm:ml-auto flex flex-wrap gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="h-9 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white basis-full sm:basis-auto min-w-0"
            placeholder="ค้นหารหัส / ชื่อสูตร / GTF" />
          <button onClick={openCreate}
            className="h-9 px-4 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 whitespace-nowrap">
            ＋ สร้างสูตร
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</div>}

      {mixedProducts.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-700">
          ⚠️ ยังไม่มีสินค้าประเภท "ของผสม" — ไปลงทะเบียนสินค้าที่จะได้จากการผสมก่อน
          โดยตั้งประเภทวัตถุดิบเป็น <span className="font-medium">ของผสม (จาก Mixing)</span>
        </div>
      )}

      {/* ===== ฟอร์มสูตร ===== */}
      {form && (
        <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">
            {editId ? `📋 แก้ไขสูตร ${form.std_code}` : '📋 สูตรใหม่'}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>รหัสสูตร</label>
              <input value={form.std_code} onChange={e => setForm({ ...form, std_code: e.target.value })}
                className={inputClass} placeholder="STD0001" disabled={!!editId} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>ชื่อสูตร <span className="text-red-400">*</span></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className={inputClass} placeholder="เช่น น้ำหมักกากถั่วเหลือง" required />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>เลขที่เอกสาร GTF</label>
              <input value={form.gtf_no} onChange={e => setForm({ ...form, gtf_no: e.target.value })}
                className={inputClass} placeholder="GTF-FERT-SOY-001" />
            </div>
            <div>
              <label className={labelClass}>ระยะเวลาหมัก (วัน)</label>
              <input type="number" value={form.ferment_days}
                onChange={e => setForm({ ...form, ferment_days: e.target.value })}
                className={inputClass} min="0" placeholder="30" />
            </div>
            <div>
              <label className={labelClass}>อายุการเก็บรักษา (วัน)</label>
              <input type="number" value={form.shelf_life_days}
                onChange={e => setForm({ ...form, shelf_life_days: e.target.value })}
                className={inputClass} min="0" placeholder="180" />
            </div>
          </div>

          <div className="bg-blue-50 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className={labelClass}>สินค้าที่ได้ <span className="text-red-400">*</span></label>
              <select value={form.output_product_id}
                onChange={e => setForm({ ...form, output_product_id: e.target.value })}
                className={inputClass} required>
                <option value="">-- เลือกของผสม --</option>
                {mixedProducts.map(p => (
                  <option key={p.product_id} value={p.product_id}>{p.mat_uid} | {p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>ได้ผลผลิตต่อ 1 ชุด <span className="text-red-400">*</span></label>
              <input type="number" value={form.output_qty}
                onChange={e => setForm({ ...form, output_qty: e.target.value })}
                className={inputClass} min="0" step="0.0001" placeholder="10" required />
            </div>
            <div>
              <label className={labelClass}>หน่วยผลผลิต <span className="text-red-400">*</span></label>
              <select value={form.output_unit} onChange={e => setForm({ ...form, output_unit: e.target.value })}
                className={inputClass} required>
                <option value="">-- เลือกหน่วย --</option>
                {measureUnits.map(u => <option key={u.code} value={u.code}>{u.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-3 text-xs text-blue-600">
              สั่งผลิตมากกว่านี้ ระบบจะคูณวัตถุดิบทุกตัวตามสัดส่วนให้เอง
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-xs text-gray-500">วัตถุดิบในสูตร (ต่อ 1 ชุด)</div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end bg-gray-50 rounded-xl p-3">
                <div className="col-span-2 sm:col-span-5">
                  <label className={labelClass}>วัตถุดิบ</label>
                  <select value={line.product_id} onChange={e => handleMaterialPick(idx, e.target.value)}
                    className={inputClass}>
                    <option value="">-- เลือกวัตถุดิบ --</option>
                    {products.map(p => (
                      <option key={p.product_id} value={p.product_id}>{p.mat_uid} | {p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>ปริมาณ</label>
                  <input type="number" value={line.qty} onChange={e => setLine(idx, { qty: e.target.value })}
                    className={inputClass} min="0" step="0.0001" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>หน่วย</label>
                  <select value={line.unit_code} onChange={e => setLine(idx, { unit_code: e.target.value })}
                    className={inputClass}>
                    <option value="">-- หน่วย --</option>
                    {units.map(u => <option key={u.code} value={u.code}>{u.name}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>หมายเหตุ</label>
                  <input value={line.note} onChange={e => setLine(idx, { note: e.target.value })}
                    className={inputClass} />
                </div>
                <div className="sm:col-span-1 flex justify-end">
                  {form.lines.length > 1 && (
                    <button type="button"
                      onClick={() => setForm(p => ({ ...p, lines: p.lines.filter((_, i) => i !== idx) }))}
                      className="h-10 px-3 text-xs rounded-xl border border-gray-200 text-red-400 hover:bg-red-50">✕</button>
                  )}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setForm(p => ({ ...p, lines: [...p.lines, emptyLine()] }))}
              className="self-start h-9 px-4 text-xs rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
              ＋ เพิ่มวัตถุดิบ
            </button>
          </div>

          <div>
            <label className={labelClass}>หมายเหตุสูตร</label>
            <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className={inputClass} />
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => { setForm(null); setEditId(null) }}
              className="h-10 px-5 text-sm rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving}
              className="h-10 px-5 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
              {saving ? 'กำลังบันทึก...' : '✓ บันทึกสูตร'}
            </button>
          </div>
        </form>
      )}

      {/* ===== รายการสูตร ===== */}
      <div className="flex flex-col gap-2">
        {formulas.length === 0 && !form && (
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            ยังไม่มีสูตร
          </div>
        )}

        {formulas.map(f => {
          const isOpen = detail?.id === f.id
          return (
            <div key={f.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button onClick={() => openDetail(f.id)}
                className="w-full px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-left hover:bg-gray-50">
                <span className="text-sm font-medium text-gray-800">{f.std_code}</span>
                <span className="text-sm text-gray-700">{f.name}</span>
                {!f.is_active && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">ปิดใช้งาน</span>
                )}
                <span className="text-xs text-gray-400">{f.line_count} วัตถุดิบ</span>
                <span className="text-xs text-gray-500">
                  ได้ {trimNumber(f.output_qty)} {f.output_unit_name || f.output_unit}/ชุด
                </span>
                <span className="ml-auto text-gray-300 text-xs">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="border-t border-gray-100 px-4 py-3 flex flex-col gap-3 bg-gray-50">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-500">
                    <div>ได้เป็น: <span className="font-medium text-gray-700">{detail.output_product_name}</span></div>
                    <div>GTF: <span className="font-medium text-gray-700">{detail.gtf_no || '-'}</span></div>
                    <div>หมัก: <span className="font-medium text-gray-700">{detail.ferment_days} วัน</span></div>
                    <div>เก็บได้: <span className="font-medium text-gray-700">{detail.shelf_life_days} วัน</span></div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-gray-400">
                        <tr className="text-left">
                          <th className="py-1.5 pr-3 font-normal">#</th>
                          <th className="py-1.5 pr-3 font-normal">วัตถุดิบ</th>
                          <th className="py-1.5 pr-3 font-normal text-right">ปริมาณ/ชุด</th>
                          <th className="py-1.5 font-normal">หมายเหตุ</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-600">
                        {detail.lines.map(l => (
                          <tr key={l.id} className="border-t border-gray-200">
                            <td className="py-1.5 pr-3 text-gray-400">{l.seq}</td>
                            <td className="py-1.5 pr-3">{l.mat_uid} | {l.product_name}</td>
                            <td className="py-1.5 pr-3 text-right">
                              {trimNumber(l.qty)} {l.unit_name || unitName([], l.unit_code)}
                            </td>
                            <td className="py-1.5 text-gray-400">{l.note || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {detail.note && <div className="text-xs text-gray-500">หมายเหตุ: {detail.note}</div>}

                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openEdit(f.id)}
                      className="h-9 px-4 text-xs rounded-xl border border-gray-200 text-gray-600 hover:bg-white">
                      ✏️ แก้ไขสูตร
                    </button>
                    <button onClick={() => toggleActive(f)}
                      className="h-9 px-4 text-xs rounded-xl border border-gray-200 text-gray-600 hover:bg-white">
                      {f.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                    </button>
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
