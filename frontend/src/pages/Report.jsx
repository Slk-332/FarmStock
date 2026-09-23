import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

/**
 * Dashboard — ทำตามแบบ docs/GTF SYSTEMS.pdf
 *
 * ส่วนบน (การ์ด/กราฟ/แจ้งเตือน/ตาราง 4 ช่อง) ดึงจาก GET /report/dashboard ครั้งเดียว
 * ส่วนล่าง "รายงานละเอียด" คือรายงานเดิมพร้อม Export CSV เก็บไว้เพราะแบบไม่มีแต่ยังต้องใช้
 */

const TABS = ['เบิกจ่าย', 'รับเข้า Stock', 'ต้องเติม Stock', 'ใกล้หมดอายุ']
const RANGES = [7, 14, 30]

const expColor = (days) => {
  if (days < 0)  return 'text-gray-400'
  if (days < 15) return 'text-red-500 font-semibold'
  if (days < 60) return 'text-yellow-500'
  return 'text-green-600'
}

const baht = (n) => `${Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`
const thDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  d ? new Date(d).toLocaleDateString('th-TH', opts) : '-'
const thTime = (d) => d ? new Date(d).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-'

const STOCK_BADGE = {
  ok:   { text: 'ปกติ',    cls: 'bg-blue-50 text-blue-700' },
  full: { text: 'เกิน Max', cls: 'bg-sky-50 text-sky-700' },
  low:  { text: 'ใกล้ต่ำ',  cls: 'bg-amber-50 text-amber-700' },
  out:  { text: 'หมด',     cls: 'bg-red-50 text-red-600' },
}
const DISPENSE_BADGE = {
  active:    { text: 'เสร็จสิ้น', cls: 'bg-blue-50 text-blue-700' },
  edited:    { text: 'แก้ไขแล้ว', cls: 'bg-amber-50 text-amber-700' },
  cancelled: { text: 'ยกเลิก',   cls: 'bg-red-50 text-red-600' },
}

function Card({ title, action, children, className = '' }) {
  return (
    <section className={`bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 flex flex-col gap-4 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-brand-dark">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const SeeAll = ({ to }) => (
  <Link to={to} className="text-xs text-blue-600 hover:underline whitespace-nowrap">ดูทั้งหมด ›</Link>
)

function StatCard({ label, value, change, changeLabel }) {
  const up = change != null && change >= 0
  return (
    <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm px-4 sm:px-5 py-4 flex flex-col gap-1 min-w-0">
      <div className="text-xs sm:text-sm text-gray-500">{label}</div>
      <div className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{value}</div>
      <div className="text-xs text-gray-400 h-4">
        {change != null && (
          <>
            <span className={up ? 'text-blue-600 font-semibold' : 'text-red-500 font-semibold'}>
              {up ? '↑' : '↓'} {Math.abs(change)}%
            </span>{' '}{changeLabel}
          </>
        )}
      </div>
    </div>
  )
}

function SimpleTable({ columns, rows, empty, minWidth = 0 }) {
  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="w-full text-sm border-collapse" style={{ minWidth }}>
        <thead>
          <tr className="bg-brand-bg">
            {columns.map((c) => (
              <th key={c.key} className={`px-3 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap first:rounded-l-lg last:rounded-r-lg ${c.right ? 'text-right' : 'text-left'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="py-8 text-center text-sm text-gray-400">{empty}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-b-0">
              {columns.map((c) => (
                <td key={c.key} className={`px-2.5 py-2.5 whitespace-nowrap ${c.right ? 'text-right' : ''} ${c.className || 'text-gray-700'}`}>
                  {c.render ? c.render(r, i) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Report() {
  const [dash,     setDash]     = useState(null)
  const [dashErr,  setDashErr]  = useState('')
  const [range,    setRange]    = useState(7)

  const [tab,      setTab]      = useState(0)
  const [data,     setData]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [from,     setFrom]     = useState('')
  const [to,       setTo]       = useState('')

  const fmt = (d) => d ? new Date(d).toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '-'
  const fmtTime = (d) => d ? new Date(d).toLocaleString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '-'

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await api.get('/report/dashboard', { params: { days: range } })
      setDash(res.data)
      setDashErr('')
    } catch (err) {
      setDashErr(err.response?.status === 404
        ? 'เซิร์ฟเวอร์ยังเป็นเวอร์ชันเก่า (ยังไม่มีข้อมูล Dashboard แบบใหม่)'
        : 'โหลดข้อมูล Dashboard ไม่สำเร็จ')
    }
  }, [range])

  useEffect(() => { fetchDashboard() }, [fetchDashboard])

  const fetchData = async () => {
    setLoading(true)
    try {
      const endpoints = ['/report/dispense','/report/stock-in','/report/low-stock','/report/expiring']
      const res = await api.get(endpoints[tab], { params: { search, from, to } })
      setData(res.data)
    } catch { /* ตารางว่างไว้ ผู้ใช้กดเปลี่ยนแท็บใหม่ได้ */ }
    finally { setLoading(false) }
  }

  useEffect(() => {
    const delay = setTimeout(fetchData, 300)
    return () => clearTimeout(delay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, from, to])

  const handleExport = () => {
    if (data.length === 0) return
    const headers = Object.keys(data[0]).join(',')
    const rows    = data.map(r => Object.values(r).map(v => `"${v ?? ''}"`).join(',')).join('\n')
    const blob    = new Blob(['﻿' + headers + '\n' + rows], { type: 'text/csv;charset=utf-8;' })
    const url     = URL.createObjectURL(blob)
    const a       = document.createElement('a')
    a.href = url; a.download = `gtfstock_${TABS[tab]}_${new Date().toISOString().slice(0,10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const cards   = dash?.cards
  const alerts  = dash?.alerts
  const chart   = (dash?.daily || []).map((d, i, all) => ({
    label: thDate(d.date, { day: 'numeric', month: 'short' }),
    total: d.total,
    qty:   d.qty,
    last:  i === all.length - 1,
  }))

  const ALERT_ROWS = alerts ? [
    { label: 'สินค้าคงเหลือต่ำกว่าขั้นต่ำ', n: alerts.low_stock,      cls: 'bg-red-50 text-red-600',     to: '/stock' },
    { label: 'ใกล้หมดอายุการใช้งาน (30 วัน)', n: alerts.expiring,     cls: 'bg-amber-50 text-amber-700', to: '/stock' },
    { label: 'รับเข้าสินค้าวันนี้',          n: alerts.received_today, cls: 'bg-blue-50 text-blue-700',   to: '/stock-in' },
    { label: 'คำสั่งซื้อรอรับเข้า',          n: alerts.po_waiting,     cls: 'bg-sky-50 text-sky-700',     to: '/orders' },
  ] : []

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">แดชบอร์ด</h1>
          <p className="text-sm text-gray-500 mt-0.5">ภาพรวมข้อมูลการเบิกจ่ายและสต็อกสินค้า</p>
        </div>
        <div className="self-start sm:self-auto bg-white border border-gray-200 rounded-xl px-4 h-10 flex items-center text-sm text-gray-700 shadow-sm">
          วันที่ {thDate(new Date(), { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </div>

      {dashErr && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">{dashErr}</div>
      )}

      {/* การ์ดสรุป */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="มูลค่าเบิกจ่ายทั้งหมด" value={cards ? baht(cards.total_all) : '-'} />
        <StatCard label="เบิกจ่ายเดือนนี้" value={cards ? baht(cards.total_month) : '-'}
          change={cards?.month_change} changeLabel="จากเดือนที่แล้ว" />
        <StatCard label="เบิกจ่ายวันนี้" value={cards ? baht(cards.total_today) : '-'}
          change={cards?.today_change} changeLabel="จากเมื่อวาน" />
        <StatCard label="มูลค่า Stock เหลือ" value={cards ? baht(cards.stock_value) : '-'} />
      </div>

      {/* กราฟ + แจ้งเตือน */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="ยอดเบิกจ่ายรายวัน" className="xl:col-span-2"
          action={
            <select value={range} onChange={(e) => setRange(Number(e.target.value))}
              className="h-9 px-3 text-sm rounded-xl border border-gray-200 bg-white text-gray-700">
              {RANGES.map((r) => <option key={r} value={r}>{r} วันย้อนหลัง</option>)}
            </select>
          }>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eef2f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false}
                  interval="preserveStartEnd" minTickGap={12} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={56}
                  tickFormatter={(v) => Number(v).toLocaleString('th-TH')} />
                <Tooltip cursor={{ fill: '#eef7f2' }}
                  contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e5e7eb' }}
                  formatter={(v, _n, p) => [`${baht(v)} (${p.payload.qty} รายการ)`, 'ยอดเบิกจ่าย']} />
                <Bar dataKey="total" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {chart.map((d, i) => <Cell key={i} fill={d.last ? '#368c66' : '#9fd0b8'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="หมวดแจ้งเตือน" action={<SeeAll to="/stock" />}>
          <div className="flex flex-col divide-y divide-gray-100">
            {ALERT_ROWS.map((a) => (
              <Link key={a.label} to={a.to} className="flex items-center justify-between gap-3 py-3 first:pt-0 hover:opacity-80">
                <span className="text-sm text-gray-700">{a.label}</span>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${a.cls}`}>{a.n} รายการ</span>
              </Link>
            ))}
            {!alerts && <div className="text-sm text-gray-400 py-4">กำลังโหลด...</div>}
          </div>
        </Card>
      </div>

      {/* เบิกจ่ายวันนี้ + รับเข้าวันนี้ */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <Card title="เบิกจ่ายวันนี้" className="xl:col-span-3" action={<SeeAll to="/dispense" />}>
          <SimpleTable minWidth={500} empty="ยังไม่มีการเบิกจ่ายวันนี้" rows={dash?.today_dispense || []} columns={[
            { key: 'no',   label: 'ลำดับ', render: (_r, i) => i + 1, className: 'text-gray-500' },
            { key: 'mat_uid', label: 'รหัสสินค้า', className: 'text-gray-500' },
            { key: 'product_name', label: 'ชื่อสินค้า' },
            { key: 'qty',  label: 'จำนวน', right: true, className: 'text-gray-900 font-semibold' },
            { key: 'unit_name', label: 'หน่วย', className: 'text-gray-500' },
            { key: 'user_name', label: 'ผู้เบิก', className: 'text-gray-500' },
            { key: 'last_at', label: 'เวลา', render: (r) => thTime(r.last_at), className: 'text-gray-500' },
          ]} />
        </Card>
        <Card title="รับเข้าวันนี้" className="xl:col-span-2" action={<SeeAll to="/stock-in" />}>
          <SimpleTable minWidth={300} empty="ยังไม่มีการรับสินค้าวันนี้" rows={dash?.today_receive || []} columns={[
            { key: 'no', label: 'ลำดับ', render: (_r, i) => i + 1, className: 'text-gray-500' },
            { key: 'mat_uid', label: 'รหัสสินค้า', className: 'text-gray-500' },
            { key: 'product_name', label: 'ชื่อสินค้า' },
            { key: 'qty', label: 'จำนวน', right: true, render: (r) => `${r.qty} ${r.unit_name || ''}`, className: 'text-gray-900 font-semibold' },
          ]} />
        </Card>
      </div>

      {/* เบิกจ่ายล่าสุด + สินค้าพร้อมใช้ */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <Card title="เบิกจ่ายล่าสุด" className="xl:col-span-3" action={<SeeAll to="/dispense" />}>
          <SimpleTable minWidth={500} empty="ยังไม่มีข้อมูลการเบิกจ่าย" rows={dash?.recent_dispense || []} columns={[
            { key: 'dispensed_at', label: 'วันที่', render: (r) => thDate(r.dispensed_at), className: 'text-gray-500' },
            { key: 'mat_uid', label: 'รหัสสินค้า', className: 'text-gray-500' },
            { key: 'product_name', label: 'ชื่อสินค้า' },
            { key: 'qty', label: 'จำนวน', right: true, render: (r) => `${r.qty} ${r.unit_name || ''}` },
            { key: 'user_name', label: 'ผู้เบิก', className: 'text-gray-500' },
            { key: 'status', label: 'สถานะ', render: (r) => {
              const b = DISPENSE_BADGE[r.status] || { text: r.status, cls: 'bg-gray-100 text-gray-500' }
              return <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${b.cls}`}>{b.text}</span>
            } },
          ]} />
        </Card>
        <Card title="สินค้าพร้อมใช้ / Stock" className="xl:col-span-2" action={<SeeAll to="/stock" />}>
          <SimpleTable minWidth={340} empty="ยังไม่มีสินค้า" rows={dash?.stock || []} columns={[
            { key: 'name', label: 'สินค้า' },
            { key: 'total_stock', label: 'Stock', right: true, className: 'text-gray-900 font-semibold' },
            { key: 'max_stock', label: 'Max', right: true, className: 'text-gray-500' },
            { key: 'min_stock', label: 'Min', right: true, className: 'text-gray-500' },
            { key: 'stock_status', label: 'สถานะ', render: (r) => {
              const b = STOCK_BADGE[r.stock_status] || STOCK_BADGE.ok
              return <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${b.cls}`}>{b.text}</span>
            } },
          ]} />
        </Card>
      </div>

      {/* ---------- รายงานละเอียด (ของเดิม) ---------- */}
      <h2 className="text-lg font-bold text-brand-dark mt-2">รายงานละเอียด</h2>

      <div className="overflow-x-auto">
        <div className="flex gap-2 bg-white rounded-2xl border border-gray-200/80 shadow-sm p-2 min-w-max sm:min-w-0">
          {TABS.map((t,i) => (
            <button key={t} onClick={()=>{ setTab(i); setSearch(''); setFrom(''); setTo('') }}
              className={`flex-1 text-xs py-2 px-3 rounded-lg transition-colors whitespace-nowrap ${tab===i ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-40">
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหา UID, Lot, ชื่อสินค้า..."
            className="flex-1 text-sm outline-none text-gray-700 placeholder-gray-400 min-w-0" />
          {search && <button onClick={()=>setSearch('')} className="text-gray-400 text-xs">✕</button>}
        </div>
        {(tab === 0 || tab === 1) && (
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="h-8 px-3 text-xs rounded-lg border border-gray-200 focus:outline-none text-gray-600" />
            <span className="text-xs text-gray-400">ถึง</span>
            <input type="date" value={to} onChange={e=>setTo(e.target.value)} className="h-8 px-3 text-xs rounded-lg border border-gray-200 focus:outline-none text-gray-600" />
          </div>
        )}
        <button onClick={handleExport} className="text-xs px-3 h-8 rounded-lg border border-green-200 bg-green-50 text-green-600 hover:bg-green-100 whitespace-nowrap">Export CSV</button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-x-auto">
        <table className="w-max min-w-full border-collapse text-xs">
          {tab === 0 && <>
            <thead><tr className="border-b border-gray-100">{['วันที่/เวลา','Item ID','Lot','ชื่อสินค้า','Group','เบิก','ใช้จริง','ของเสีย','Cost','มูลค่า','Remark','สถานะ'].map(h=><th key={h} className="px-3 py-2.5 text-left text-gray-400 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={12} className="text-center py-8 text-gray-400">กำลังโหลด...</td></tr>
              : data.length === 0 ? <tr><td colSpan={12} className="text-center py-8 text-gray-400">ไม่พบข้อมูล</td></tr>
              : data.map(d => (
                <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{fmtTime(d.dispensed_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-gray-500">{d.item_id}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{d.lot_no}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{d.product_name}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{d.group_name||'-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{d.qty_dispensed}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{d.qty_used}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{d.qty_waste}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{Number(d.cost_per_piece).toFixed(2)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700 font-medium">{Number(d.total_cost).toFixed(2)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{d.remark||'-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${d.status==='cancelled' ? 'bg-red-100 text-red-500' : d.status==='edited' ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>{d.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </>}
          {tab === 1 && <>
            <thead><tr className="border-b border-gray-100">{['วันที่รับ','MatUID','ชื่อสินค้า','Group','Lot','รับเข้า','คงเหลือ','Cost','AveCost','วันผลิต','วันหมดอายุ','อายุการใช้งาน','เหลืออีก','Supplier'].map(h=><th key={h} className="px-3 py-2.5 text-left text-gray-400 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={14} className="text-center py-8 text-gray-400">กำลังโหลด...</td></tr>
              : data.length === 0 ? <tr><td colSpan={14} className="text-center py-8 text-gray-400">ไม่พบข้อมูล</td></tr>
              : data.map(d => (
                <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{fmt(d.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{d.mat_uid}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{d.product_name}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{d.group_name||'-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{d.lot_no}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700 font-medium">{d.qty_received}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{d.qty_remaining}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{Number(d.cost).toFixed(2)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{Number(d.ave_cost).toFixed(2)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{fmt(d.mfg_date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{fmt(d.exp_date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{d.shelf_life_days} วัน</td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className={expColor(d.days_remaining)}>{d.days_remaining < 0 ? 'หมดอายุแล้ว' : `${d.days_remaining} วัน`}</span></td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{d.supplier||'-'}</td>
                </tr>
              ))}
            </tbody>
          </>}
          {tab === 2 && <>
            <thead><tr className="border-b border-gray-100">{['MatUID','ชื่อสินค้า','Group','Stock','Min','Max','สถานะ'].map(h=><th key={h} className="px-3 py-2.5 text-left text-gray-400 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">กำลังโหลด...</td></tr>
              : data.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">Stock ทุกรายการอยู่ในเกณฑ์ปกติ</td></tr>
              : data.map(d => (
                <tr key={d.product_id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{d.mat_uid}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700 font-medium">{d.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{d.group_name||'-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700 font-semibold">{d.total_stock}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{d.min_stock}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{d.max_stock}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${d.stock_status==='out' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-600'}`}>
                      {d.stock_status==='out' ? 'Out' : 'Low'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </>}
          {tab === 3 && <>
            <thead><tr className="border-b border-gray-100">{['MatUID','ชื่อสินค้า','Lot','คงเหลือ','วันผลิต','วันหมดอายุ','อายุการใช้งาน','เหลืออีก','สถานะ'].map(h=><th key={h} className="px-3 py-2.5 text-left text-gray-400 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">กำลังโหลด...</td></tr>
              : data.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">ไม่มีสินค้าใกล้หมดอายุ</td></tr>
              : data.map(d => (
                <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{d.mat_uid}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700 font-medium">{d.product_name}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{d.lot_no}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{d.qty_remaining}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{fmt(d.mfg_date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{fmt(d.exp_date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{d.shelf_life_days} วัน</td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className={expColor(d.days_remaining)}>{d.days_remaining < 0 ? 'หมดอายุแล้ว' : `${d.days_remaining} วัน`}</span></td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${d.days_remaining < 0 ? 'bg-gray-100 text-gray-400' : d.days_remaining < 15 ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-600'}`}>
                      {d.days_remaining < 0 ? 'หมดอายุ' : d.days_remaining < 15 ? 'วิกฤต' : 'ใกล้หมด'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </>}
        </table>
      </div>
    </div>
  )
}
