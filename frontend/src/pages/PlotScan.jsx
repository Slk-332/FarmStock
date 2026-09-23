import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api/axios'
import { trimNumber } from '../lib/units'

/**
 * หน้าที่เปิดขึ้นตอนสแกน QR ที่ติดอยู่กลางแปลง
 *
 * ออกแบบให้ใช้มือถือกลางแดด: ตัวใหญ่ ปุ่มใหญ่ บันทึกกิจกรรมได้ในไม่กี่แตะ
 * โดยไม่ต้องไล่หาแปลงจากรายการ
 */

const QUICK_ACTIVITIES = ['รดน้ำ', 'ใส่ปุ๋ย', 'พ่นยา', 'กำจัดวัชพืช', 'พรวนดิน', 'ตรวจแปลง']

const PLOT_STATUS = {
  preparing: 'เตรียมแปลง', planted: 'ปลูกแล้ว',
  harvested: 'เก็บเกี่ยวแล้ว', resting: 'พักแปลง',
}

export default function PlotScan() {
  const { token } = useParams()
  const [plot,    setPlot]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [notice,  setNotice]  = useState('')
  const [saving,  setSaving]  = useState(false)
  const [note,    setNote]    = useState('')

  const load = useCallback(async () => {
    try {
      setPlot((await api.get(`/planting/plots/token/${token}`)).data)
    } catch (err) {
      setError(err.response?.data?.message || 'ไม่พบแปลงที่ตรงกับ QR นี้')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  /** บันทึกกิจกรรมแบบแตะเดียว — ไม่ใช้วัตถุดิบ จึงไม่แตะสต๊อก */
  const quickLog = async (activity_type) => {
    setSaving(true); setError(''); setNotice('')
    try {
      await api.post(`/planting/plots/${plot.id}/activities`, {
        activity_type, note: note || null, materials: [],
      })
      setNote('')
      await load()
      setNotice(`บันทึก "${activity_type}" แล้ว`)
    } catch (err) {
      setError(err.response?.data?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-screen text-gray-400">กำลังโหลด...</div>
  }

  if (!plot) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4 p-6">
        <div className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</div>
        <Link to="/planting" className="text-sm text-blue-600 hover:underline">ไปหน้าแปลงปลูก</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 flex flex-col gap-4 max-w-lg mx-auto">

      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-gray-800">{plot.plot_code}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-600">
            {PLOT_STATUS[plot.status] || plot.status}
          </span>
        </div>
        <div className="text-base text-gray-700">{plot.name}</div>
        <div className="text-xs text-gray-500">
          {plot.area_code} · {plot.area_name}
          {plot.size && <> · {trimNumber(plot.size)} {plot.size_unit_name}</>}
        </div>
        {plot.crop && <div className="text-sm text-gray-600">{plot.crop}</div>}
        {plot.planted_date && (
          <div className="text-xs text-gray-400">ปลูกเมื่อ {String(plot.planted_date).slice(0, 10)}</div>
        )}
        <div className="text-xs text-gray-500 pt-2 border-t border-gray-100 mt-1">
          ต้นทุนสะสมที่ยังไม่ปันส่วน{' '}
          <span className="font-medium text-blue-600">
            {Number(plot.unallocated_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
          </span>
        </div>
      </div>

      {error  && <div className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</div>}
      {notice && <div className="text-sm text-green-600 bg-green-50 px-4 py-3 rounded-xl">{notice}</div>}

      {/* บันทึกเร็ว */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-3">
        <div className="text-sm font-medium text-gray-700">บันทึกกิจกรรม</div>
        <input value={note} onChange={e => setNote(e.target.value)}
          className="h-11 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white"
          placeholder="หมายเหตุ (ไม่ใส่ก็ได้)" />
        <div className="grid grid-cols-2 gap-2">
          {QUICK_ACTIVITIES.map(t => (
            <button key={t} onClick={() => quickLog(t)} disabled={saving}
              className="h-12 text-sm rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {t}
            </button>
          ))}
        </div>
        <div className="text-xs text-gray-400">
          กิจกรรมที่ต้องใช้วัตถุดิบ (หักสต๊อก) บันทึกที่{' '}
          <Link to="/planting" className="text-blue-600 hover:underline">หน้าแปลงปลูก</Link>
        </div>
      </div>

      {/* ประวัติล่าสุด */}
      {plot.activities.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-2">
          <div className="text-sm font-medium text-gray-700">ประวัติล่าสุด</div>
          {plot.activities.slice(0, 10).map(a => (
            <div key={a.id} className="flex items-center gap-2 text-xs border-b border-gray-50 pb-1.5 last:border-0">
              <span className="text-gray-400">{String(a.activity_date).slice(0, 10)}</span>
              <span className="text-gray-700">{a.activity_type}</span>
              {a.note && <span className="text-gray-400 truncate">{a.note}</span>}
              {Number(a.total_cost) > 0 && (
                <span className="ml-auto text-gray-600">{trimNumber(a.total_cost, 2)} ฿</span>
              )}
            </div>
          ))}
        </div>
      )}

      <Link to="/planting"
        className="text-center text-sm text-blue-600 hover:underline py-2">
        ← ไปหน้าแปลงปลูกทั้งหมด
      </Link>
    </div>
  )
}
