import { useState, useEffect, useMemo } from 'react'
import api from '../api/axios'
import { formatPackSize, trimNumber } from '../lib/units'

const statusConfig = {
  out:   { label: 'Out',      className: 'bg-red-100 text-red-600' },
  low:   { label: 'Low',      className: 'bg-yellow-100 text-yellow-600' },
  full:  { label: 'Full',     className: 'bg-blue-100 text-blue-600' },
  ok:    { label: 'In Stock', className: 'bg-green-100 text-green-600' },
  active:{ label: 'Active',   className: 'bg-green-100 text-green-600' },
  done:  { label: 'Done',     className: 'bg-gray-100 text-gray-400' },
}

const expColor = (days) => {
  if (days == null) return 'text-gray-400'
  if (days < 0)  return 'text-gray-400'
  if (days < 15) return 'text-red-500 font-semibold'
  if (days < 60) return 'text-yellow-500'
  return 'text-green-600'
}

/** สถานะสต๊อกรายวัตถุดิบ — ข้อความเดียวกับหน้า Dashboard */
const MATERIAL_STATUS = {
  ok:   { label: 'ปกติ',    className: 'bg-blue-50 text-blue-700' },
  full: { label: 'เกิน Max', className: 'bg-sky-50 text-sky-700' },
  low:  { label: 'ใกล้ต่ำ',  className: 'bg-amber-50 text-amber-700' },
  out:  { label: 'หมด',     className: 'bg-red-50 text-red-600' },
}

const PAGE_SIZE = 10

/** เลขหน้าที่จะโชว์: หน้าแรก หน้าสุดท้าย และรอบ ๆ หน้าปัจจุบัน ที่เหลือย่อเป็น … */
function pageNumbers(current, total) {
  const pages = new Set([1, total, current - 1, current, current + 1])
  const list = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const out = []
  list.forEach((n, i) => {
    if (i > 0 && n - list[i - 1] > 1) out.push('…')
    out.push(n)
  })
  return out
}

const money = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * ตารางวัตถุดิบแบบชีต T_MaterialStock ใน โปรแกรมเกษตร (Rev.02).xlsx
 * แสดงทุกวัตถุดิบแม้ยังไม่มีของ (จำนวน 0) — ต่างจากมุมมอง Lot ที่เห็นเฉพาะของที่รับเข้าแล้ว
 */
function MaterialTable({ products, loading, search }) {
  const [group,  setGroup]  = useState('')
  const [area,   setArea]   = useState('')
  const [status, setStatus] = useState('')
  // จำเลขหน้าคู่กับคำค้น — พิมพ์คำค้นใหม่แล้วกลับไปหน้า 1 เอง
  const [pageState, setPageState] = useState({ search, page: 1 })
  const page    = pageState.search === search ? pageState.page : 1
  const setPage = (n) => setPageState({ search, page: n })

  const groups = useMemo(() => [...new Set(products.map((p) => p.group_name).filter(Boolean))].sort(), [products])
  const areas  = useMemo(() => [...new Set(products.map((p) => p.storage_area).filter(Boolean))].sort(), [products])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products
      .filter((p) => !q || [p.mat_uid, p.name, p.group_name, p.detail].some((v) => String(v || '').toLowerCase().includes(q)))
      .filter((p) => !group || p.group_name === group)
      .filter((p) => !area || p.storage_area === area)
      .filter((p) => !status || p.stock_status === status)
      .sort((a, b) => String(a.mat_uid).localeCompare(String(b.mat_uid)))
  }, [products, search, group, area, status])

  // เปลี่ยนตัวกรอง/คำค้นแล้วกลับไปหน้าแรก ไม่งั้นอาจค้างอยู่หน้าที่ไม่มีแล้ว
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current   = Math.min(page, pageCount)
  const pageRows  = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const setFilter = (setter) => (e) => { setter(e.target.value); setPage(1) }

  const totalValue = rows.reduce((sum, p) => sum + Number(p.total_value || 0), 0)
  const lowCount   = rows.filter((p) => p.stock_status === 'low' || p.stock_status === 'out').length
  const selectCls  = 'h-9 px-3 text-sm rounded-xl border border-gray-200 bg-white text-gray-700'
  const HEAD = ['รหัสวัตถุดิบ','ชื่อวัตถุดิบ','ประเภท','สูงสุด','ต่ำสุด','จำนวน','หน่วย','จำนวนขนาด','หน่วยขนาด','ราคาต่อหน่วย','ราคารวม','พื้นที่','วันที่บันทึก','สถานะสต๊อก','สถานะการใช้งาน','หมายเหตุ']
  const RIGHT = new Set(['สูงสุด','ต่ำสุด','จำนวน','จำนวนขนาด','ราคาต่อหน่วย','ราคารวม'])

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['จำนวนวัตถุดิบ', `${rows.length} รายการ`],
          ['มูลค่าคงเหลือรวม', `${money(totalValue)} ฿`],
          ['ต่ำกว่าขั้นต่ำ / หมด', `${lowCount} รายการ`],
          ['ประเภท', `${groups.length} ประเภท`],
        ].map(([label, value]) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-200/80 shadow-sm px-4 py-3">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-bold text-gray-900 mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={group} onChange={setFilter(setGroup)} className={selectCls}>
          <option value="">ทุกประเภท</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={area} onChange={setFilter(setArea)} className={selectCls}>
          <option value="">ทุกพื้นที่</option>
          {areas.map((a) => <option key={a} value={a}>พื้นที่ {a}</option>)}
        </select>
        <select value={status} onChange={setFilter(setStatus)} className={selectCls}>
          <option value="">ทุกสถานะสต๊อก</option>
          {Object.entries(MATERIAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-x-auto">
        <table className="w-max min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-brand-bg border-b border-gray-200">
              {HEAD.map((h) => (
                <th key={h} className={`px-3 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap ${RIGHT.has(h) ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={HEAD.length} className="py-10 text-center text-gray-400">กำลังโหลด...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={HEAD.length} className="py-10 text-center text-gray-400">ไม่พบวัตถุดิบ</td></tr>
            ) : pageRows.map((p) => {
              const st = MATERIAL_STATUS[p.stock_status] || MATERIAL_STATUS.ok
              return (
                <tr key={p.product_id} className="border-b border-gray-100 hover:bg-brand-bg/60">
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">{p.mat_uid}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-900 font-medium">{p.name}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{p.group_name || '-'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right text-gray-500">{p.max_stock}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right text-gray-500">{p.min_stock}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right text-gray-900 font-semibold">{p.total_stock}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{p.stock_unit_name || p.stock_unit}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right text-gray-600">{p.pack_size ? trimNumber(p.pack_size) : '-'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{p.pack_unit_name || '-'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right text-gray-600">{money(p.ave_cost)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right text-gray-900">{money(p.total_value)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{p.storage_area || '-'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">
                    {p.updated_at ? new Date(p.updated_at).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-'}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${st.className}`}>{st.label}</span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{p.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                  <td className="px-3 py-2.5 text-gray-500 max-w-60 truncate">{p.detail || '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-sm text-gray-500">
            แสดง {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, rows.length)} จาก {rows.length} รายการ
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(current - 1)} disabled={current === 1}
              className="h-9 px-3 text-sm rounded-xl border border-gray-200 bg-white text-gray-600 disabled:opacity-40">
              ก่อนหน้า
            </button>
            {pageNumbers(current, pageCount).map((n, i) => n === '…' ? (
              <span key={`gap${i}`} className="px-1 text-gray-400">…</span>
            ) : (
              <button key={n} onClick={() => setPage(n)}
                className={`h-9 min-w-9 px-2 text-sm rounded-xl border ${n === current ? 'bg-blue-500 border-blue-500 text-white font-semibold' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                {n}
              </button>
            ))}
            <button onClick={() => setPage(current + 1)} disabled={current === pageCount}
              className="h-9 px-3 text-sm rounded-xl border border-gray-200 bg-white text-gray-600 disabled:opacity-40">
              ถัดไป
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const [lots,     setLots]     = useState([])
  const [items,    setItems]    = useState([])
  const [products, setProducts] = useState([])
  const [units,    setUnits]    = useState([])
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [view,     setView]     = useState('material')
  const [expanded, setExpanded] = useState(new Set())
  const [editRow,  setEditRow]  = useState(null)
  const [editData, setEditData] = useState({})
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const fetchAll = async () => {
    try {
      setLoading(true)
      const [lotsRes, itemsRes, unitsRes, productsRes] = await Promise.all([
        api.get('/lots',  { params: { search } }),
        api.get('/items', { params: { search } }),
        api.get('/units'),
        api.get('/products'),
      ])
      setProducts(productsRes.data)
      setLots(lotsRes.data)
      setItems(itemsRes.data)
      setUnits(unitsRes.data)
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const delay = setTimeout(fetchAll, 300)
    return () => clearTimeout(delay)
  }, [search])

  const toggleExpand = (key) => {
    const n = new Set(expanded)
    n.has(key) ? n.delete(key) : n.add(key)
    setExpanded(n)
  }

  const itemsByLot = items.reduce((acc, item) => {
    if (!acc[item.lot_id]) acc[item.lot_id] = []
    acc[item.lot_id].push(item)
    return acc
  }, {})

  const handleEdit = (lot) => {
    setEditRow(lot.id)
    setEditData({
      name:             lot.product_name,
      detail:           lot.detail || '',
      mfg_date:         lot.mfg_date?.slice(0,10) || '',
      exp_date:         lot.exp_date?.slice(0,10) || '',
      cost:             lot.cost,
      qty_remaining:    lot.qty_remaining,
      max_stock:        lot.max_stock,
      min_stock:        lot.min_stock,
      status:           lot.status,
      supplier:         lot.supplier || '',
    })
  }

  const handleSave = async (lot) => {
    setSaving(true)
    try {
      await api.put(`/lots/${lot.id}`, editData)
      setEditRow(null)
      fetchAll()
    } catch (err) {
      alert(err.response?.data?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteLot = async (id) => {
    if (!window.confirm('ยืนยันลบ Lot นี้? จะลบทุกชิ้นและประวัติเบิกจ่ายใน Lot นี้ด้วย')) return
    try {
      await api.delete(`/lots/${id}`)
      fetchAll()
    } catch (err) {
      alert(err.response?.data?.message || 'ลบไม่สำเร็จ')
    }
  }

  const handleDeleteItem = async (id) => {
    if (!window.confirm('ยืนยันลบชิ้นนี้?')) return
    try {
      await api.delete(`/items/${id}`)
      fetchAll()
    } catch (err) {
      alert(err.response?.data?.message || 'ลบไม่สำเร็จ')
    }
  }

  const fmt = (d) => d ? new Date(d).toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '-'
  const inputCls = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
  const HEADERS  = ['MatUID','ชื่อสินค้า','Detail','Lot','Status','Max','Min','คงเหลือ','ขนาดบรรจุ','จำนวนชิ้น','Cost','AveCost','TotalCost','วันผลิต','วันหมดอายุ','อายุการใช้งาน','เหลืออีก','จัดการ']

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">สต๊อกคงเหลือ</h1>
          <p className="text-sm text-gray-500 mt-0.5">วัตถุดิบทั้งหมดในคลัง แยกดูเป็นรายการ / Lot / รายชิ้นได้</p>
        </div>
        <span className="text-xs text-gray-400">{products.length} วัตถุดิบ · {lots.length} Lot · {items.length} ชิ้น</span>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm px-4 py-2.5 flex items-center gap-3">
        <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="ค้นหา MatUID, ชื่อสินค้า, Lot, Item ID, วันที่..."
          className="flex-1 text-sm outline-none text-gray-700 placeholder-gray-400" />
        {search && <button onClick={()=>setSearch('')} className="text-gray-400 text-xs">✕</button>}
        <div className="flex border border-gray-200 rounded-lg overflow-hidden ml-2">
          <button onClick={()=>setView('material')} className={`text-xs px-3 py-1.5 ${view==='material' ? 'bg-blue-50 text-blue-600' : 'text-gray-500'}`}>วัตถุดิบ</button>
          <button onClick={()=>setView('lot')}  className={`text-xs px-3 py-1.5 ${view==='lot'  ? 'bg-blue-50 text-blue-600' : 'text-gray-500'}`}>Lot</button>
          <button onClick={()=>setView('item')} className={`text-xs px-3 py-1.5 ${view==='item' ? 'bg-blue-50 text-blue-600' : 'text-gray-500'}`}>รายชิ้น</button>
        </div>
      </div>

      {error && <div className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}

      {view === 'material' && <MaterialTable products={products} loading={loading} search={search} />}

      {/* ===== View: Lot ===== */}
      {view === 'lot' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-x-auto">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {HEADERS.map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={18} className="text-center py-8 text-gray-400 text-sm">กำลังโหลด...</td></tr>
              ) : lots.length === 0 ? (
                <tr><td colSpan={18} className="text-center py-8 text-gray-400 text-sm">ไม่พบข้อมูล</td></tr>
              ) : lots.map(lot => {
                const isEditing = editRow === lot.id
                const stkStat  = statusConfig[lot.status] || statusConfig.ok
                const days     = lot.days_remaining
                const totalCost = (Number(lot.qty_remaining) * Number(lot.cost)).toFixed(2)
                return (
                  <tr key={lot.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{lot.mat_uid}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing
                        ? <input className={`${inputCls} w-32`} value={editData.name} onChange={e=>setEditData({...editData,name:e.target.value})}/>
                        : <span className="text-xs font-medium text-gray-700">{lot.product_name}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing
                        ? <input className={`${inputCls} w-36`} value={editData.detail} onChange={e=>setEditData({...editData,detail:e.target.value})}/>
                        : <span className="text-xs text-gray-500 max-w-[120px] truncate block">{lot.detail || '-'}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{lot.lot_no}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing
                        ? <select className={inputCls} value={editData.status} onChange={e=>setEditData({...editData,status:e.target.value})}>
                            <option value="active">Active</option>
                            <option value="done">Done</option>
                          </select>
                        : <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stkStat.className}`}>{stkStat.label}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing
                        ? <input type="number" className={`${inputCls} w-16`} value={editData.max_stock} onChange={e=>setEditData({...editData,max_stock:e.target.value})}/>
                        : <span className="text-xs text-gray-500">{lot.max_stock ?? '-'}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing
                        ? <input type="number" className={`${inputCls} w-16`} value={editData.min_stock} onChange={e=>setEditData({...editData,min_stock:e.target.value})}/>
                        : <span className="text-xs text-gray-500">{lot.min_stock ?? '-'}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing
                        ? <input type="number" className={`${inputCls} w-16`} value={editData.qty_remaining} onChange={e=>setEditData({...editData,qty_remaining:e.target.value})}/>
                        : <span className="text-xs font-medium text-gray-700">{lot.qty_remaining}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="text-xs text-gray-500">{formatPackSize(units, lot) || '-'}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{lot.qty_received}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing
                        ? <input type="number" className={`${inputCls} w-20`} value={editData.cost} onChange={e=>setEditData({...editData,cost:e.target.value})}/>
                        : <span className="text-xs text-gray-500">{Number(lot.cost).toFixed(2)}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{Number(lot.ave_cost).toFixed(2)}</td>
                    <td className="px-3 py-2 text-xs font-medium text-gray-700 whitespace-nowrap">{totalCost}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing
                        ? <input type="date" className={inputCls} value={editData.mfg_date} onChange={e=>setEditData({...editData,mfg_date:e.target.value})}/>
                        : <span className="text-xs text-gray-500">{fmt(lot.mfg_date)}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing
                        ? <input type="date" className={inputCls} value={editData.exp_date} onChange={e=>setEditData({...editData,exp_date:e.target.value})}/>
                        : <span className="text-xs text-gray-500">{fmt(lot.exp_date)}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                      {lot.shelf_life_days != null ? `${lot.shelf_life_days} วัน` : '-'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`text-xs ${expColor(days)}`}>
                        {days == null ? '-' : days < 0 ? 'หมดอายุแล้ว' : `${days} วัน`}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <button onClick={()=>handleSave(lot)} disabled={saving}
                            className="text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                            {saving ? '...' : 'บันทึก'}
                          </button>
                          <button onClick={()=>setEditRow(null)}
                            className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button onClick={()=>handleEdit(lot)}
                            className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                            แก้ไข
                          </button>
                          <button onClick={()=>handleDeleteLot(lot.id)}
                            className="text-xs px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50">
                            ลบ
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== View: รายชิ้น ===== */}
      {view === 'item' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
          {loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">กำลังโหลด...</div>
          ) : lots.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">ไม่พบข้อมูล</div>
          ) : lots.map(lot => {
            const lotItems  = itemsByLot[lot.id] || []
            const isExp     = expanded.has(lot.id)
            const isEditing = editRow === lot.id
            return (
              <div key={lot.id} className="border-b border-gray-100 last:border-b-0">
                {/* Lot Header */}
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 select-none"
                  onClick={() => toggleExpand(lot.id)}>
                  <span className="text-sm font-medium text-gray-700">{lot.lot_no}</span>
                  <span className="text-xs text-gray-400">{lot.product_name}</span>
                  <span className="text-xs text-gray-400 ml-auto">{lotItems.length} ชิ้น</span>
                  <button onClick={e=>{ e.stopPropagation(); handleDeleteLot(lot.id) }}
                    className="text-xs px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50">
                    ลบ Lot
                  </button>
                  <button onClick={e=>{ e.stopPropagation(); handleEdit(lot); if(!isExp) toggleExpand(lot.id) }}
                    className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                    แก้ไข Lot
                  </button>
                  <span className="text-xs text-gray-400">{isExp ? '▲' : '▼'}</span>
                </div>

                {/* Edit form */}
                {isExp && isEditing && (
                  <div className="px-4 py-3 bg-blue-50 border-t border-blue-100 flex flex-wrap gap-3 items-end">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-400">ชื่อสินค้า</span>
                      <input className={inputCls} value={editData.name} onChange={e=>setEditData({...editData,name:e.target.value})}/>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-400">Detail</span>
                      <input className={`${inputCls} w-40`} value={editData.detail} onChange={e=>setEditData({...editData,detail:e.target.value})}/>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-400">Piece</span>
                      <input type="number" className={`${inputCls} w-16`} value={editData.qty_remaining} onChange={e=>setEditData({...editData,qty_remaining:e.target.value})}/>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-400">Cost</span>
                      <input type="number" className={`${inputCls} w-20`} value={editData.cost} onChange={e=>setEditData({...editData,cost:e.target.value})}/>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-400">วันผลิต</span>
                      <input type="date" className={inputCls} value={editData.mfg_date} onChange={e=>setEditData({...editData,mfg_date:e.target.value})}/>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-400">วันหมดอายุ</span>
                      <input type="date" className={inputCls} value={editData.exp_date} onChange={e=>setEditData({...editData,exp_date:e.target.value})}/>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-400">Status</span>
                      <select className={inputCls} value={editData.status} onChange={e=>setEditData({...editData,status:e.target.value})}>
                        <option value="active">Active</option>
                        <option value="done">Done</option>
                      </select>
                    </div>
                    <div className="flex gap-2 ml-auto">
                      <button onClick={()=>handleSave(lot)} disabled={saving}
                        className="text-xs px-3 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                        {saving ? '...' : 'บันทึก'}
                      </button>
                      <button onClick={()=>setEditRow(null)}
                        className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                )}

                {/* Item rows */}
                {isExp && lotItems.map(item => {
                  const parentLot = lots.find(l => l.id === item.lot_id)
                  return (
                    <div key={item.id}
                      className="flex items-center gap-3 px-4 py-2 pl-10 border-t border-gray-50 hover:bg-blue-50/30">
                      <span className="text-xs text-gray-500 font-mono">{item.item_id}</span>
                      <span className={`text-xs ml-auto px-2 py-0.5 rounded-full ${
                        item.status === 'dispensed' ? 'bg-gray-100 text-gray-400' :
                        item.status === 'expired'   ? 'bg-red-100 text-red-400' :
                        'bg-green-100 text-green-600'
                      }`}>
                        {item.status === 'dispensed' ? 'เบิกแล้ว' : item.status === 'expired' ? 'หมดอายุ' : 'Active'}
                      </span>
                      <span className={`text-xs ${expColor(item.days_remaining)}`}>
                        {item.days_remaining < 0 ? 'หมดอายุ' : `${item.days_remaining} วัน`}
                      </span>
                      <button onClick={()=>handleEdit(parentLot)}
                        className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                        แก้ไข
                      </button>
                      <button onClick={()=>handleDeleteItem(item.id)}
                        className="text-xs px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50">
                        ลบ
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}