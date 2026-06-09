import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import api from '../api/axios'

const expColor = (days) => {
  if (days < 0)  return { text: 'หมดอายุแล้ว', color: 'text-gray-500', bg: 'bg-gray-100' }
  if (days < 15) return { text: `${days} วัน ⚠️`, color: 'text-red-600', bg: 'bg-red-50' }
  if (days < 60) return { text: `${days} วัน`, color: 'text-yellow-600', bg: 'bg-yellow-50' }
  return { text: `${days} วัน`, color: 'text-green-600', bg: 'bg-green-50' }
}

export default function ScanItem() {
  const { itemId } = useParams()
  const [item,    setItem]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [confirm, setConfirm] = useState(false)
  const [remark,  setRemark]  = useState('')
  const [success, setSuccess] = useState('')
  const [dispensing, setDispensing] = useState(false)
  const [fifoError,  setFifoError]  = useState('')

  const fmt = (d) => d ? new Date(d).toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '-'

  useEffect(() => {
    const fetchItem = async () => {
      try {
        const res = await api.get(`/items/${itemId}`)
        setItem(res.data)
      } catch (err) {
        setError('ไม่พบสินค้านี้ในระบบ')
      } finally {
        setLoading(false)
      }
    }
    fetchItem()
  }, [itemId])

  const handleDispense = async () => {
    setDispensing(true)
    setFifoError('')
    try {
      await api.post('/dispense', { item_id: item.id, remark })
      setSuccess(`เบิกจ่ายสำเร็จ! ${item.item_id}`)
      setConfirm(false)
      // refresh item
      const res = await api.get(`/items/${itemId}`)
      setItem(res.data)
    } catch (err) {
      const msg = err.response?.data?.message || 'เกิดข้อผิดพลาด'
      if (msg.includes('FIFO')) {
        setFifoError(msg)
      } else {
        setFifoError(msg)
      }
      setConfirm(false)
    } finally {
      setDispensing(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">กำลังโหลด...</div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm text-center">
        <div className="text-3xl mb-3">❌</div>
        <div className="text-sm font-medium text-gray-700">{error}</div>
        <div className="text-xs text-gray-400 mt-2">{itemId}</div>
      </div>
    </div>
  )

  const exp   = expColor(item.days_remaining)
  const canDispense = item.status === 'active' && item.lot_status === 'active'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-between py-6 px-4">
      <div className="w-full max-w-sm flex flex-col gap-4">

        {/* Header */}
        <div className="text-center">
          <div className="text-2xl mb-1">🌱</div>
          <div className="text-xs text-gray-400">FarmStock</div>
        </div>

        {/* ข้อมูลสินค้า */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-4">
          <div>
            <div className="text-lg font-semibold text-gray-800">{item.product_name}</div>
            <div className="text-xs text-gray-400 mt-0.5">{item.mat_uid}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400">Item ID</div>
              <div className="text-xs font-mono font-medium text-gray-700 mt-0.5 break-all">{item.item_id}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400">Lot No.</div>
              <div className="text-sm font-medium text-gray-700 mt-0.5">{item.lot_no}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400">วันผลิต</div>
              <div className="text-sm font-medium text-gray-700 mt-0.5">{fmt(item.mfg_date)}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400">วันหมดอายุ</div>
              <div className="text-sm font-medium text-gray-700 mt-0.5">{fmt(item.exp_date)}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400">อายุการใช้งาน</div>
              <div className="text-sm font-medium text-gray-700 mt-0.5">{item.shelf_life_days} วัน</div>
            </div>
            <div className={`rounded-lg p-3 ${exp.bg}`}>
              <div className="text-xs text-gray-400">เหลืออีก</div>
              <div className={`text-sm font-semibold mt-0.5 ${exp.color}`}>{exp.text}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400">ราคาต้นทุน</div>
              <div className="text-sm font-medium text-gray-700 mt-0.5">{Number(item.cost).toFixed(2)} บาท</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400">Stock คงเหลือ (Lot)</div>
              <div className="text-sm font-medium text-gray-700 mt-0.5">{item.qty_remaining} ชิ้น</div>
            </div>
          </div>

          {item.detail && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">ส่วนผสม</div>
              <div className="text-xs text-gray-600">{item.detail}</div>
            </div>
          )}
        </div>

        {/* Status */}
        {item.status !== 'active' && (
          <div className="bg-gray-100 rounded-xl px-4 py-3 text-center text-sm text-gray-500">
            {item.status === 'dispensed' ? '✅ เบิกจ่ายไปแล้ว' : '⚫ หมดอายุแล้ว'}
          </div>
        )}

        {/* FIFO Error */}
        {fifoError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex flex-col gap-1">
            <div className="text-sm font-medium text-red-600">⚠️ เบิกไม่ได้</div>
            <div className="text-xs text-red-500">{fifoError}</div>
            <div className="text-xs text-red-400 mt-1">ต้องเบิก Lot เก่ากว่านี้ให้หมดก่อน</div>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-600 text-center">
            ✅ {success}
          </div>
        )}
      </div>

      {/* ปุ่มเบิกจ่าย */}
      {canDispense && !success && (
        <div className="w-full max-w-sm mt-4">
          <button onClick={() => setConfirm(true)}
            className="w-full h-12 rounded-xl bg-red-500 text-white font-medium text-base hover:bg-red-600 active:bg-red-700">
            เบิกจ่ายชิ้นนี้
          </button>
        </div>
      )}

      {/* Confirm Modal */}
      {confirm && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 px-4 pb-6">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 flex flex-col gap-4 shadow-xl">
            <div className="text-sm font-semibold text-gray-800 text-center">ยืนยันการเบิกจ่าย</div>
            <div className="bg-gray-50 rounded-lg px-4 py-3 flex flex-col gap-2 text-xs text-gray-600">
              <div><span className="text-gray-400">สินค้า:</span> <span className="font-medium">{item.product_name}</span></div>
              <div><span className="text-gray-400">Item ID:</span> <span className="font-mono">{item.item_id}</span></div>
              <div><span className="text-gray-400">Lot:</span> {item.lot_no}</div>
              <div><span className="text-gray-400">Cost:</span> {Number(item.cost).toFixed(2)} บาท</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-500">Remark (ถ้ามี)</label>
              <input value={remark} onChange={e=>setRemark(e.target.value)}
                className="h-9 px-3 text-sm rounded-lg border border-gray-200 focus:outline-none"
                placeholder="เช่น เบิกสำหรับออเดอร์ #001" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirm(false)}
                className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-500 text-sm">
                ยกเลิก
              </button>
              <button onClick={handleDispense} disabled={dispensing}
                className="flex-1 h-11 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50">
                {dispensing ? 'กำลังเบิก...' : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}