import { useState, useEffect } from 'react'
import api from '../api/axios'

export default function StockIn() {
  const [products, setProducts] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [success,  setSuccess]  = useState('')
  const [error,    setError]    = useState('')
  const [preview,  setPreview]  = useState(null)
  const [aveCost,  setAveCost]  = useState(null)

  const today = new Date().toISOString().slice(0, 10)

  const [form, setForm] = useState({
    product_id:'', lot_no:'', qty_received:'',
    cost:'', mfg_date: today, exp_date:'', supplier:'',
  })

  const fetchProducts = async () => {
    try {
      const res = await api.get('/products')
      setProducts(res.data)
    } catch {}
  }

  const genLotNo = async () => {
    try {
      const res = await api.get('/lots')
      return `LOT${String(res.data.length + 1).padStart(6, '0')}`
    } catch {
      return 'LOT000001'
    }
  }

  useEffect(() => {
    fetchProducts()
    genLotNo().then(lot => setForm(prev => ({ ...prev, lot_no: lot })))
  }, [])

  const handleProductChange = async (e) => {
    const product_id = e.target.value
    setForm(prev => ({ ...prev, product_id }))
    if (!product_id) { setPreview(null); return }
    try {
      const res = await api.get(`/products/${product_id}`)
      setPreview(res.data)
    } catch {}
  }

  useEffect(() => {
    if (!preview || !form.qty_received || !form.cost) { setAveCost(null); return }
    const newQty   = Number(form.qty_received)
    const newCost  = Number(form.cost)
    const oldQty   = preview.total_stock || 0
    const oldValue = oldQty * (preview.ave_cost || 0)
    const total    = oldQty + newQty
    if (total === 0) { setAveCost(0); return }
    setAveCost(((oldValue + newQty * newCost) / total).toFixed(2))
  }, [form.qty_received, form.cost, preview])

  const shelfLife = form.mfg_date && form.exp_date
    ? Math.max(0, Math.round((new Date(form.exp_date) - new Date(form.mfg_date)) / 86400000))
    : null

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    if (!form.product_id || !form.lot_no || !form.qty_received || !form.cost || !form.mfg_date || !form.exp_date) {
      setError('กรุณากรอกข้อมูลให้ครบ'); return
    }
    setLoading(true)
    try {
      const res = await api.post('/lots', {
        ...form,
        qty_received: Number(form.qty_received),
        cost:         Number(form.cost),
      })
      setSuccess(`บันทึก ${res.data.items_created} ชิ้น สำเร็จ! ไปปริ้น QR ได้ที่หน้า Print`)
      const newLot = await genLotNo()
      setForm({ product_id:'', lot_no: newLot, qty_received:'', cost:'', mfg_date: today, exp_date:'', supplier:'' })
      setPreview(null); setAveCost(null)
    } catch (err) {
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = "h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white text-gray-700 w-full"
  const labelClass = "text-xs text-gray-500 mb-1.5 block"

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <h1 className="text-base font-semibold text-gray-800">ลง Stock</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">

        {/* เลือกสินค้า */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">🔍 เลือกผลิตภัณฑ์</div>
          <div>
            <label className={labelClass}>MatUID / ชื่อสินค้า <span className="text-red-400">*</span></label>
            <select name="product_id" value={form.product_id} onChange={handleProductChange} className={inputClass}>
              <option value="">-- เลือกสินค้า --</option>
              {products.map(p => (
                <option key={p.product_id} value={p.product_id}>{p.mat_uid} | {p.name}</option>
              ))}
            </select>
          </div>
          {preview && (
            <div className="bg-gray-50 rounded-xl px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-gray-500">
              <div>MatUID: <span className="font-medium text-gray-700">{preview.mat_uid}</span></div>
              <div>Group: <span className="font-medium text-gray-700">{preview.group_name || '-'}</span></div>
              <div>Max: <span className="font-medium text-gray-700">{preview.max_stock}</span></div>
              <div>Min: <span className="font-medium text-gray-700">{preview.min_stock}</span></div>
              <div>Stock ปัจจุบัน: <span className="font-medium text-gray-700">{preview.total_stock || 0} ชิ้น</span></div>
            </div>
          )}
        </div>

        {/* ข้อมูล Lot */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">📦 ข้อมูล Lot ที่รับเข้า</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Lot No. <span className="text-red-400">*</span></label>
              <input name="lot_no" value={form.lot_no} onChange={handleChange} className={inputClass} placeholder="LOT000001" />
              <div className="text-xs text-gray-400 mt-1">ระบบสร้างให้อัตโนมัติ แก้ได้</div>
            </div>
            <div>
              <label className={labelClass}>จำนวนที่รับเข้า (ชิ้น) <span className="text-red-400">*</span></label>
              <input type="number" name="qty_received" value={form.qty_received} onChange={handleChange}
                className={inputClass} placeholder="เช่น 50" min="1" />
            </div>
            <div>
              <label className={labelClass}>ราคาต้นทุน/ชิ้น <span className="text-red-400">*</span></label>
              <input type="number" name="cost" value={form.cost} onChange={handleChange}
                className={inputClass} placeholder="เช่น 12.00" step="0.01" />
            </div>
            <div>
              <label className={labelClass}>วันผลิต <span className="text-red-400">*</span></label>
              <input type="date" name="mfg_date" value={form.mfg_date} onChange={handleChange} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>วันหมดอายุ <span className="text-red-400">*</span></label>
              <input type="date" name="exp_date" value={form.exp_date} onChange={handleChange} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Supplier</label>
              <input name="supplier" value={form.supplier} onChange={handleChange}
                className={inputClass} placeholder="เช่น บริษัท ABC" />
            </div>
          </div>
          {shelfLife !== null && (
            <div className="bg-gray-50 rounded-xl px-4 py-2 text-xs">
              <span className="text-gray-400">อายุการใช้งาน:</span>
              <span className="font-medium text-gray-700 ml-2">{shelfLife} วัน</span>
            </div>
          )}
        </div>

        {/* AveCost Preview */}
        {aveCost !== null && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex flex-col gap-1">
            <div className="text-xs text-blue-600 font-medium">AveCost ใหม่หลังรับ Lot นี้เข้า</div>
            <div className="text-lg font-semibold text-blue-700">{aveCost} บาท/ชิ้น</div>
            <div className="text-xs text-blue-500">
              (มูลค่าเดิม {((preview?.total_stock||0)*(preview?.ave_cost||0)).toFixed(2)} + Lot ใหม่ {(Number(form.qty_received||0)*Number(form.cost||0)).toFixed(2)})
              ÷ ({preview?.total_stock||0} + {form.qty_received||0})
            </div>
          </div>
        )}

        {error   && <div className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</div>}
        {success && <div className="text-sm text-green-600 bg-green-50 px-4 py-3 rounded-xl">✅ {success}</div>}

        <div className="flex flex-col sm:flex-row justify-end gap-3">
          <button type="button"
            onClick={() => { setForm(prev => ({ ...prev, product_id:'', qty_received:'', cost:'', exp_date:'', supplier:'' })); setPreview(null); setAveCost(null) }}
            className="h-10 px-5 text-sm rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
            ล้างข้อมูล
          </button>
          <button type="submit" disabled={loading}
            className="h-10 px-5 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
            {loading ? 'กำลังบันทึก...' : '✓ บันทึก + สร้าง Item ID'}
          </button>
        </div>
      </form>
    </div>
  )
}