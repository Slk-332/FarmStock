import { useState, useEffect } from 'react'
import api from '../api/axios'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import SummaryCards from '../components/SummaryCards'

const TABS = ['เบิกจ่าย', 'รับเข้า Stock', 'ต้องเติม Stock', 'ใกล้หมดอายุ']
const expColor = (days) => {
  if (days < 0)  return 'text-gray-400'
  if (days < 15) return 'text-red-500 font-semibold'
  if (days < 60) return 'text-yellow-500'
  return 'text-green-600'
}
const COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6']

export default function Report() {
  const [tab,      setTab]      = useState(0)
  const [summary,  setSummary]  = useState(null)
  const [data,     setData]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [from,     setFrom]     = useState('')
  const [to,       setTo]       = useState('')
  const [weekly,   setWeekly]   = useState([])
  const [products, setProducts] = useState([])
  const [chartFrom, setChartFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 6)
    return d.toISOString().slice(0,10)
  })
  const [chartTo, setChartTo] = useState(() => new Date().toISOString().slice(0,10))

  const fmt = (d) => d ? new Date(d).toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '-'
  const fmtTime = (d) => d ? new Date(d).toLocaleString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '-'

  const fetchSummary = async () => {
    try {
      const res = await api.get('/report/summary')
      setSummary(res.data)
    } catch {}
  }

  const fetchWeekly = async () => {
    try {
      const res = await api.get('/report/weekly-dispense', { params: { from: chartFrom, to: chartTo } })
      const raw = res.data.data
      const uniqueProducts = [...new Set(raw.map(r => r.product_name))]
      setProducts(uniqueProducts)
      const uniqueDates = [...new Set(raw.map(r => r.date?.slice(0,10)))]
      const chartData = uniqueDates.map(date => {
        const row = { date: new Date(date).toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit' }) }
        uniqueProducts.forEach(p => {
          const found = raw.find(r => r.date?.slice(0,10) === date && r.product_name === p)
          row[p] = found ? found.qty : 0
        })
        return row
      })
      setWeekly(chartData)
    } catch {}
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const endpoints = ['/report/dispense','/report/stock-in','/report/low-stock','/report/expiring']
      const res = await api.get(endpoints[tab], { params: { search, from, to } })
      setData(res.data)
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { fetchSummary(); fetchWeekly() }, [])
  useEffect(() => { fetchWeekly() }, [chartFrom, chartTo])
  useEffect(() => {
    const delay = setTimeout(fetchData, 300)
    return () => clearTimeout(delay)
  }, [tab, search, from, to])

  const handleExport = () => {
    if (data.length === 0) return
    const headers = Object.keys(data[0]).join(',')
    const rows    = data.map(r => Object.values(r).map(v => `"${v ?? ''}"`).join(',')).join('\n')
    const blob    = new Blob(['\uFEFF' + headers + '\n' + rows], { type: 'text/csv;charset=utf-8;' })
    const url     = URL.createObjectURL(blob)
    const a       = document.createElement('a')
    a.href = url; a.download = `farmstock_${TABS[tab]}_${new Date().toISOString().slice(0,10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-base font-semibold text-gray-800">Report</h1>

      <SummaryCards summary={summary} />

      {summary && summary.alerts.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          {summary.alerts.filter(a=>a.stock_status==='out').length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3 flex-1">
              <span className="text-lg">🔴</span>
              <div>
                <div className="text-xs font-medium text-red-600">หมดแล้ว {summary.alerts.filter(a=>a.stock_status==='out').length} รายการ</div>
                <div className="text-xs text-red-400 mt-0.5">{summary.alerts.filter(a=>a.stock_status==='out').map(a=>a.name).join(', ')}</div>
              </div>
            </div>
          )}
          {summary.alerts.filter(a=>a.stock_status==='low').length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-start gap-3 flex-1">
              <span className="text-lg">🟡</span>
              <div>
                <div className="text-xs font-medium text-yellow-600">ต่ำกว่า Min {summary.alerts.filter(a=>a.stock_status==='low').length} รายการ</div>
                <div className="text-xs text-yellow-500 mt-0.5">{summary.alerts.filter(a=>a.stock_status==='low').map(a=>`${a.name} (${a.total_stock}/${a.min_stock})`).join(', ')}</div>
              </div>
            </div>
          )}
          {summary.alerts.filter(a=>a.stock_status==='full').length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-3 flex-1">
              <span className="text-lg">🔵</span>
              <div>
                <div className="text-xs font-medium text-blue-600">เกิน Max {summary.alerts.filter(a=>a.stock_status==='full').length} รายการ</div>
                <div className="text-xs text-blue-400 mt-0.5">{summary.alerts.filter(a=>a.stock_status==='full').map(a=>`${a.name} (${a.total_stock}/${a.max_stock})`).join(', ')}</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-sm font-medium text-gray-700">📊 ยอดเบิกจ่ายรายวัน</div>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={chartFrom} onChange={e=>setChartFrom(e.target.value)}
              className="h-8 px-3 text-xs rounded-lg border border-gray-200 focus:outline-none text-gray-600 flex-1 sm:flex-none" />
            <span className="text-xs text-gray-400">ถึง</span>
            <input type="date" value={chartTo} onChange={e=>setChartTo(e.target.value)}
              className="h-8 px-3 text-xs rounded-lg border border-gray-200 focus:outline-none text-gray-600 flex-1 sm:flex-none" />
            <button onClick={fetchWeekly} className="h-8 px-3 text-xs rounded-lg bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">ดู</button>
          </div>
        </div>
        {weekly.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">ไม่มีข้อมูลในช่วงนี้</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weekly} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} formatter={(value, name) => [`${value} ชิ้น`, name]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {products.map((p, i) => <Bar key={p} dataKey={p} fill={COLORS[i % COLORS.length]} radius={[4,4,0,0]} />)}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
            <div className="text-xs font-medium text-gray-700">📤 เบิกจ่ายวันนี้</div>
            {summary.today_dispense.length === 0 ? <div className="text-xs text-gray-400">ยังไม่มีการเบิกจ่ายวันนี้</div>
              : summary.today_dispense.map(d => {
                const max = Math.max(...summary.today_dispense.map(x => x.qty))
                return (
                  <div key={d.product_name} className="flex items-center gap-2">
                    <div className="text-xs text-gray-500 w-20 text-right truncate">{d.product_name}</div>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-red-400 rounded-full flex items-center px-2" style={{ width: `${(d.qty/max)*100}%` }}>
                        <span className="text-xs text-white font-medium">{d.qty}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            }
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
            <div className="text-xs font-medium text-gray-700">📥 รับเข้าวันนี้</div>
            {summary.today_stock_in.length === 0 ? <div className="text-xs text-gray-400">ยังไม่มีการรับสินค้าวันนี้</div>
              : summary.today_stock_in.map(d => {
                const max = Math.max(...summary.today_stock_in.map(x => x.qty))
                return (
                  <div key={d.product_name} className="flex items-center gap-2">
                    <div className="text-xs text-gray-500 w-20 text-right truncate">{d.product_name}</div>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-green-400 rounded-full flex items-center px-2" style={{ width: `${(d.qty/max)*100}%` }}>
                        <span className="text-xs text-white font-medium">{d.qty}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            }
          </div>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
            <div className="text-xs font-medium text-gray-700">📤 เบิกจ่ายล่าสุด</div>
            <table className="w-full border-collapse text-xs">
              <thead><tr className="border-b border-gray-100">{['เวลา','ชื่อสินค้า','Lot','Cost'].map(h=><th key={h} className="pb-2 text-left text-gray-400 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {summary.recent_dispense.length === 0 ? <tr><td colSpan={4} className="py-4 text-center text-gray-400">ยังไม่มีข้อมูล</td></tr>
                  : summary.recent_dispense.map((d,i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1.5 text-gray-400 whitespace-nowrap">{fmtTime(d.dispensed_at)}</td>
                      <td className="py-1.5 text-gray-700">{d.product_name}</td>
                      <td className="py-1.5 text-gray-400 whitespace-nowrap">{d.lot_no}</td>
                      <td className="py-1.5 text-gray-500">{Number(d.cost_per_piece).toFixed(2)}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
            <div className="text-xs font-medium text-gray-700">📦 สินค้าพร้อมใช้</div>
            <table className="w-full border-collapse text-xs">
              <thead><tr className="border-b border-gray-100">{['ชื่อสินค้า','Stock','Max','Min','สถานะ'].map(h=><th key={h} className="pb-2 text-left text-gray-400 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {summary.stock_ready.map((s,i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1.5 text-gray-700">{s.name}</td>
                    <td className="py-1.5 text-gray-700 font-medium">{s.total_stock}</td>
                    <td className="py-1.5 text-gray-400">{s.max_stock}</td>
                    <td className="py-1.5 text-gray-400">{s.min_stock}</td>
                    <td className="py-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.stock_status==='out' ? 'bg-red-100 text-red-600' : s.stock_status==='low' ? 'bg-yellow-100 text-yellow-600' : s.stock_status==='full' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                        {s.stock_status==='out' ? 'Out' : s.stock_status==='low' ? 'Low' : s.stock_status==='full' ? 'Full' : 'OK'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-x-auto -mx-3 px-3">
        <div className="flex gap-2 bg-white rounded-xl border border-gray-200 p-2 min-w-max sm:min-w-0">
          {TABS.map((t,i) => (
            <button key={t} onClick={()=>{ setTab(i); setSearch(''); setFrom(''); setTo('') }}
              className={`flex-1 text-xs py-2 px-3 rounded-lg transition-colors whitespace-nowrap ${tab===i ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-40">
          <span className="text-gray-400 text-sm">🔍</span>
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
        <button onClick={handleExport} className="text-xs px-3 h-8 rounded-lg border border-green-200 bg-green-50 text-green-600 hover:bg-green-100 whitespace-nowrap">📥 Export CSV</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
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
              : data.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">✅ Stock ทุกรายการอยู่ในเกณฑ์ปกติ</td></tr>
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
              : data.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">✅ ไม่มีสินค้าใกล้หมดอายุ</td></tr>
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
                      {d.days_remaining < 0 ? '⚫ หมดอายุ' : d.days_remaining < 15 ? '🔴 วิกฤต' : '🟡 ใกล้หมด'}
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