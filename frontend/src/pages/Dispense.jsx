import { useState, useEffect } from 'react'
import api from '../api/axios'

export default function Dispense() {
  const [products,  setProducts]  = useState([])
  const [loading,   setLoading]   = useState(false)
  const [success,   setSuccess]   = useState('')
  const [error,     setError]     = useState('')
  const [confirm,   setConfirm]   = useState(null)
  const [remark,    setRemark]    = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [fifoQueue, setFifoQueue] = useState([])
  const [history,   setHistory]   = useState([])
  const [editDisp,  setEditDisp]  = useState(null)
  const [editData,  setEditData]  = useState({ qty_used:'', qty_waste:'', remark:'' })
  const [saving,    setSaving]    = useState(false)
  const [tab,       setTab]       = useState('dispense')

  const fetchProducts = async () => {
    try {
      const res = await api.get('/products')
      setProducts(res.data)
    } catch {}
  }

  const fetchHistory = async () => {
    try {
      const res = await api.get('/dispense')
      setHistory(res.data)
    } catch {}
  }

  useEffect(() => { fetchProducts(); fetchHistory() }, [])

  const handleProductChange = async (e) => {
    const product_id = e.target.value
    setSelectedProduct(product_id)
    setFifoQueue([])
    setError('')
    if (!product_id) return
    try {
      const lotsRes  = await api.get(`/lots/product/${product_id}`)
      const lotIds   = lotsRes.data.map(l => l.id)
      const itemsRes = await api.get('/items', { params: { search: '' } })
      const filtered = itemsRes.data
        .filter(i => i.status === 'active' && lotIds.includes(i.lot_id))
        .sort((a,b) => new Date(a.mfg_date) - new Date(b.mfg_date))
      setFifoQueue(filtered)
    } catch {}
  }

  const handleDispense = async () => {
    if (!confirm) return
    setLoading(true); setError('')
    try {
      await api.post('/dispense', { item_id: confirm.id, remark })
      setSuccess(`เบิกจ่าย ${confirm.item_id} สำเร็จ!`)
      setConfirm(null); setRemark('')
      fetchHistory()
      handleProductChange({ target: { value: selectedProduct } })
    } catch (err) {
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาด')
      setConfirm(null)
    } finally {
      setLoading(false)
    }
  }

  const handleEditSave = async () => {
    setSaving(true)
    try {
      await api.put(`/dispense/${editDisp.id}`, editData)
      setEditDisp(null); fetchHistory()
    } catch (err) {
      alert(err.response?.data?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const fmt = (d) => d ? new Date(d).toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '-'
  const fmtTime = (d) => d ? new Date(d).toLocaleString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '-'
  const oldestLotId = fifoQueue.length > 0 ? fifoQueue[0].lot_id : null

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-base font-semibold text-gray-800">เบิกจ่าย</h1>

      {/* Tabs */}
      <div className="flex gap-2 bg-white rounded-xl border border-gray-200 p-2">
        <button onClick={()=>setTab('dispense')}
          className={`flex-1 text-xs py-2 rounded-lg transition-colors ${tab==='dispense' ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}>
          เบิกจ่าย
        </button>
        <button onClick={()=>{ setTab('history'); fetchHistory() }}
          className={`flex-1 text-xs py-2 rounded-lg transition-colors ${tab==='history' ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}>
          ประวัติ
        </button>
      </div>

      {/* ===== Tab: เบิกจ่าย ===== */}
      {tab === 'dispense' && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
            <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">🔍 เลือกสินค้าที่จะเบิก</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-500 mb-1.5">MatUID / ชื่อสินค้า</div>
                <select value={selectedProduct} onChange={handleProductChange}
                  className="h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white text-gray-700 w-full">
                  <option value="">-- เลือกสินค้า --</option>
                  {products.map(p => (
                    <option key={p.product_id} value={p.product_id}>{p.mat_uid} | {p.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <div className="text-xs text-gray-400 bg-gray-50 rounded-xl px-3 py-2.5 w-full">
                  💡 หรือสแกน QR Code บนมือถือเพื่อเบิกได้เลย
                </div>
              </div>
            </div>
          </div>

          {fifoQueue.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
              <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">📋 FIFO Queue</div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 text-xs text-yellow-700">
                ⚠️ ต้องเบิก Lot เก่าสุดให้หมดก่อน
              </div>
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full border-collapse text-xs min-w-[600px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['ลำดับ','Item ID','Lot','วันผลิต','วันหมดอายุ','เหลืออีก','Cost','สถานะ','เบิก'].map(h=>(
                        <th key={h} className="px-2 py-2 text-left text-gray-400 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fifoQueue.map((item, idx) => {
                      const canDispense = item.lot_id === oldestLotId
                      const daysLeft    = item.days_remaining
                      return (
                        <tr key={item.id} className={`border-b border-gray-50 ${canDispense ? 'bg-green-50' : ''}`}>
                          <td className="px-2 py-2">{idx+1} {idx===0 ? '🔥' : ''}</td>
                          <td className="px-2 py-2 font-mono text-gray-600 whitespace-nowrap">{item.item_id}</td>
                          <td className="px-2 py-2 text-gray-500 whitespace-nowrap">{item.lot_no}</td>
                          <td className="px-2 py-2 text-gray-500 whitespace-nowrap">{fmt(item.mfg_date)}</td>
                          <td className="px-2 py-2 text-gray-500 whitespace-nowrap">{fmt(item.exp_date)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <span className={daysLeft < 15 ? 'text-red-500 font-semibold' : daysLeft < 60 ? 'text-yellow-500' : 'text-green-600'}>
                              {daysLeft < 0 ? 'หมดอายุ' : `${daysLeft} วัน`}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-gray-500">{Number(item.cost).toFixed(2)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {canDispense
                              ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-600 font-medium">เบิกได้เลย</span>
                              : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">รอ Lot ก่อน</span>}
                          </td>
                          <td className="px-2 py-2">
                            {canDispense && (
                              <button onClick={()=>{ setConfirm(item); setError(''); setSuccess('') }}
                                className="text-xs px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600">
                                เบิก
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error   && <div className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</div>}
          {success && <div className="text-sm text-green-600 bg-green-50 px-4 py-3 rounded-xl">✅ {success}</div>}
        </>
      )}

      {/* ===== Tab: ประวัติ ===== */}
      {tab === 'history' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-max min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                {['วันที่/เวลา','Item ID','ชื่อสินค้า','Lot','เบิก','ใช้จริง','ของเสีย','Cost','มูลค่า','Remark','สถานะ','แก้ไข'].map(h=>(
                  <th key={h} className="px-3 py-2.5 text-left text-gray-400 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={12} className="text-center py-8 text-gray-400">ยังไม่มีประวัติ</td></tr>
              ) : history.map(d => {
                const isEditing = editDisp?.id === d.id
                return (
                  <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-400">{fmtTime(d.dispensed_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-gray-500">{d.item_id}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">{d.product_name}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{d.lot_no}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{d.qty_dispensed}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing
                        ? <input type="number" value={editData.qty_used} onChange={e=>setEditData({...editData,qty_used:e.target.value})}
                            className="border border-gray-200 rounded px-2 py-1 w-14 text-xs focus:outline-none"/>
                        : d.qty_used}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing
                        ? <input type="number" value={editData.qty_waste} onChange={e=>setEditData({...editData,qty_waste:e.target.value})}
                            className="border border-gray-200 rounded px-2 py-1 w-14 text-xs focus:outline-none"/>
                        : d.qty_waste}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{Number(d.cost_per_piece).toFixed(2)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700 font-medium">{Number(d.total_cost).toFixed(2)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing
                        ? <input value={editData.remark} onChange={e=>setEditData({...editData,remark:e.target.value})}
                            className="border border-gray-200 rounded px-2 py-1 w-28 text-xs focus:outline-none"/>
                        : <span className="text-gray-400">{d.remark || '-'}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        d.status==='cancelled' ? 'bg-red-100 text-red-500' :
                        d.status==='edited'    ? 'bg-yellow-100 text-yellow-600' :
                        'bg-green-100 text-green-600'}`}>{d.status}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <button onClick={handleEditSave} disabled={saving}
                            className="text-xs px-2 py-1 rounded bg-blue-500 text-white disabled:opacity-50">
                            {saving ? '...' : 'บันทึก'}
                          </button>
                          <button onClick={()=>setEditDisp(null)}
                            className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500">
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button onClick={()=>{ setEditDisp(d); setEditData({ qty_used: d.qty_used, qty_waste: d.qty_waste, remark: d.remark || '' }) }}
                          className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                          ✏️
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm Modal - Bottom Sheet บนมือถือ */}
      {confirm && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 px-0 sm:px-4">
          <div className="bg-white rounded-t-2xl sm:rounded-xl w-full sm:max-w-sm p-5 flex flex-col gap-4 shadow-xl">
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto sm:hidden mb-1"/>
            <div className="text-sm font-semibold text-gray-800">ยืนยันการเบิกจ่าย</div>
            <div className="bg-gray-50 rounded-xl px-4 py-3 flex flex-col gap-1.5 text-xs text-gray-600">
              <div><span className="text-gray-400">Item ID:</span> <span className="font-mono font-medium break-all">{confirm.item_id}</span></div>
              <div><span className="text-gray-400">สินค้า:</span> {confirm.product_name}</div>
              <div><span className="text-gray-400">Lot:</span> {confirm.lot_no}</div>
              <div><span className="text-gray-400">Cost:</span> {Number(confirm.cost).toFixed(2)} บาท</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-gray-500">Remark (ถ้ามี)</div>
              <input value={remark} onChange={e=>setRemark(e.target.value)}
                className="h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none"
                placeholder="เช่น เบิกสำหรับออเดอร์ #001" />
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setConfirm(null)}
                className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-500 text-sm">
                ยกเลิก
              </button>
              <button onClick={handleDispense} disabled={loading}
                className="flex-1 h-11 rounded-xl bg-red-500 text-white text-sm font-medium disabled:opacity-50">
                {loading ? 'กำลังเบิก...' : 'ยืนยันเบิกจ่าย'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}