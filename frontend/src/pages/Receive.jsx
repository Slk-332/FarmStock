import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import api from '../api/axios'
import { unitName, trimNumber } from '../lib/units'

/**
 * รับของเข้า Stock
 *
 * เลือกใบสั่งซื้อแล้วระบบเติมรายการที่ยังค้างรับให้ หรือจะรับโดยไม่อ้างใบสั่งซื้อก็ได้
 * (ในไฟล์ตัวอย่างมีเคสแบบนั้นจริง — ของที่ได้จากการผสมเอง)
 *
 * รับ 1 บรรทัด = สร้าง Lot 1 ก้อน + QR ตามจำนวนที่รับ ทั้งใบบันทึกพร้อมกันครั้งเดียว
 */

const today = () => new Date().toISOString().slice(0, 10)

const emptyLine = () => ({
  product_id: '', order_line_id: null, lot_no: '', qty: '', unit_code: '',
  unit_price: '', mfg_date: today(), exp_date: '',
})

export default function Receive() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const [orders,   setOrders]   = useState([])
  const [products, setProducts] = useState([])
  const [units,    setUnits]    = useState([])
  const [orderId,  setOrderId]  = useState(params.get('order') || '')
  const [header,   setHeader]   = useState({ receipt_no: '', receipt_date: today(), supplier: '', note: '' })
  const [lines,    setLines]    = useState([emptyLine()])
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState(null)

  useEffect(() => {
    // เฉพาะใบที่สั่งแล้วหรือรับไปบางส่วน — ใบร่าง/ยกเลิก/รับครบแล้ว ไม่ควรมารับซ้ำ
    Promise.all([api.get('/orders', { params: { status: 'ordered' } }),
                 api.get('/orders', { params: { status: 'partial' } })])
      .then(([a, b]) => setOrders([...a.data, ...b.data]))
      .catch(() => {})
    api.get('/products').then(res => setProducts(res.data)).catch(() => {})
    api.get('/units').then(res => setUnits(res.data)).catch(() => {})
    api.get('/receipts/next-no')
      .then(res => setHeader(h => ({ ...h, receipt_no: res.data.receipt_no })))
      .catch(() => {})
  }, [])

  /** ดึงรายการที่ยังค้างรับจากใบสั่งซื้อมาเติมให้ */
  const loadOrderLines = useCallback(async (id) => {
    if (!id) { setLines([emptyLine()]); return }
    try {
      const { data } = await api.get(`/orders/${id}`)
      const pending = data.lines.filter(l => Number(l.qty_received) < Number(l.qty))
      setHeader(h => ({ ...h, supplier: data.supplier || h.supplier }))
      setLines(pending.length === 0 ? [emptyLine()] : pending.map(l => ({
        product_id:    String(l.product_id),
        order_line_id: l.id,
        lot_no:        '',
        qty:           String(Number(l.qty) - Number(l.qty_received)),
        unit_code:     l.stock_unit || l.unit_code,
        unit_price:    String(l.unit_price),
        mfg_date:      today(),
        exp_date:      '',
      })))
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดใบสั่งซื้อไม่สำเร็จ')
    }
  }, [])

  useEffect(() => { loadOrderLines(orderId) }, [orderId, loadOrderLines])

  const setLine = (idx, patch) =>
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))

  const handleProductPick = (idx, product_id) => {
    const product = products.find(p => String(p.product_id) === String(product_id))
    setLine(idx, { product_id, unit_code: product?.stock_unit || '', order_line_id: null })
  }

  const lineTotal = (line) => (Number(line.qty) || 0) * (Number(line.unit_price) || 0)
  const grandTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0)
  const totalQr = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setSuccess(null)

    for (const [i, l] of lines.entries()) {
      const where = `รายการที่ ${i + 1}`
      if (!l.product_id) return setError(`${where}: ยังไม่ได้เลือกสินค้า`)
      if (!Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0) {
        return setError(`${where}: จำนวนต้องเป็นจำนวนเต็มบวก เพราะ 1 หน่วยนับ = QR 1 ดวง`)
      }
      if (!l.mfg_date || !l.exp_date) return setError(`${where}: ต้องระบุวันผลิตและวันหมดอายุ`)
      if (new Date(l.exp_date) < new Date(l.mfg_date)) {
        return setError(`${where}: วันหมดอายุต้องไม่ก่อนวันผลิต`)
      }
    }

    setSaving(true)
    try {
      const { data } = await api.post('/receipts', {
        ...header,
        order_id: orderId || null,
        lines: lines.map(l => ({
          ...l,
          qty: Number(l.qty),
          unit_price: Number(l.unit_price) || 0,
          lot_no: l.lot_no || null,
        })),
      })
      setSuccess({ receipt_no: data.receipt_no, qty: totalQr })
      setLines([emptyLine()])
      setOrderId('')
      const next = await api.get('/receipts/next-no')
      setHeader({ receipt_no: next.data.receipt_no, receipt_date: today(), supplier: '', note: '' })
    } catch (err) {
      setError(err.response?.data?.message || 'บันทึกการรับของไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const inputClass = "h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white text-gray-700 w-full"
  const labelClass = "text-xs text-gray-500 mb-1.5 block"

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <h1 className="text-base font-semibold text-gray-800">รับของเข้า Stock</h1>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 text-sm text-green-700">
          <span>✅ บันทึกใบรับ {success.receipt_no} แล้ว — สร้าง QR {success.qty} ดวง</span>
          <button onClick={() => navigate('/print')}
            className="ml-auto h-8 px-4 text-xs rounded-xl bg-green-500 text-white hover:bg-green-600">
            ไปหน้าปริ้น QR
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">

        {/* หัวใบรับ */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">📥 ข้อมูลใบรับ</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className={labelClass}>เลขที่ใบรับ</label>
              <input value={header.receipt_no} onChange={e => setHeader({ ...header, receipt_no: e.target.value })}
                className={inputClass} placeholder="RC000001" />
            </div>
            <div>
              <label className={labelClass}>วันที่รับ</label>
              <input type="date" value={header.receipt_date}
                onChange={e => setHeader({ ...header, receipt_date: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>อ้างใบสั่งซื้อ</label>
              <select value={orderId} onChange={e => setOrderId(e.target.value)} className={inputClass}>
                <option value="">— ไม่อ้างใบสั่งซื้อ —</option>
                {orders.map(o => (
                  <option key={o.id} value={o.id}>{o.order_code} | {o.supplier || 'ไม่ระบุผู้จำหน่าย'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>ผู้จำหน่าย</label>
              <input value={header.supplier} onChange={e => setHeader({ ...header, supplier: e.target.value })}
                className={inputClass} />
            </div>
          </div>
        </div>

        {/* รายการที่รับ */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">
            📦 รายการที่รับ
            <span className="text-xs font-normal text-gray-400 ml-2">1 หน่วยที่รับ = QR 1 ดวง</span>
          </div>

          {lines.map((line, idx) => (
            <div key={idx} className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
              <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
                <div className="col-span-2 sm:col-span-5">
                  <label className={labelClass}>
                    สินค้า
                    {line.order_line_id && <span className="text-blue-500 ml-1">(จากใบสั่งซื้อ)</span>}
                  </label>
                  <select value={line.product_id} onChange={e => handleProductPick(idx, e.target.value)}
                    className={inputClass}>
                    <option value="">-- เลือกสินค้า --</option>
                    {products.map(p => (
                      <option key={p.product_id} value={p.product_id}>{p.mat_uid} | {p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className={labelClass}>Lot No.</label>
                  <input value={line.lot_no} onChange={e => setLine(idx, { lot_no: e.target.value })}
                    className={inputClass} placeholder="เว้นว่าง = ออกให้อัตโนมัติ" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>จำนวน ({unitName(units, line.unit_code) || '-'})</label>
                  <input type="number" value={line.qty} onChange={e => setLine(idx, { qty: e.target.value })}
                    className={inputClass} min="1" step="1" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>ราคา/หน่วย</label>
                  <input type="number" value={line.unit_price}
                    onChange={e => setLine(idx, { unit_price: e.target.value })}
                    className={inputClass} min="0" step="0.01" />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
                <div className="sm:col-span-3">
                  <label className={labelClass}>วันผลิต</label>
                  <input type="date" value={line.mfg_date}
                    onChange={e => setLine(idx, { mfg_date: e.target.value })} className={inputClass} />
                </div>
                <div className="sm:col-span-3">
                  <label className={labelClass}>วันหมดอายุ</label>
                  <input type="date" value={line.exp_date}
                    onChange={e => setLine(idx, { exp_date: e.target.value })} className={inputClass} />
                </div>
                <div className="sm:col-span-4 text-xs text-gray-500">
                  รวม <span className="font-medium text-gray-700">
                    {lineTotal(line).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </span> บาท
                  {Number(line.qty) > 0 && <> · จะได้ QR {trimNumber(line.qty)} ดวง</>}
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  {lines.length > 1 && (
                    <button type="button" onClick={() => setLines(prev => prev.filter((_, i) => i !== idx))}
                      className="h-9 px-3 text-xs rounded-xl border border-gray-200 text-red-400 hover:bg-red-50">
                      ลบรายการ
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          <button type="button" onClick={() => setLines(prev => [...prev, emptyLine()])}
            className="self-start h-9 px-4 text-xs rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
            ＋ เพิ่มรายการ
          </button>
        </div>

        <div>
          <label className={labelClass}>หมายเหตุ</label>
          <input value={header.note} onChange={e => setHeader({ ...header, note: e.target.value })}
            className={inputClass} />
        </div>

        {error && <div className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</div>}

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="text-sm text-gray-600">
            ยอดรวม <span className="text-lg font-semibold text-gray-800 ml-2">
              {grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
            </span> บาท · QR ที่จะสร้าง {totalQr} ดวง
          </div>
          <button type="submit" disabled={saving}
            className="sm:ml-auto h-10 px-5 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
            {saving ? 'กำลังบันทึก...' : '✓ รับของเข้า Stock'}
          </button>
        </div>
      </form>
    </div>
  )
}
