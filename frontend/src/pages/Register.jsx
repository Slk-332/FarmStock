import { useState, useEffect } from 'react'
import api from '../api/axios'

export default function Register() {
  const [groups,  setGroups]  = useState([])
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error,   setError]   = useState('')
  const [newGroup,setNewGroup]= useState('')
  const [showNewGroup, setShowNewGroup] = useState(false)

  const [form, setForm] = useState({
    mat_uid:'', name:'', detail:'', weight_per_piece:'',
    max_stock:'', min_stock:'', group_id:'',
  })

  const fetchGroups = async () => {
    try {
      const res = await api.get('/groups')
      setGroups(res.data)
    } catch {}
  }

  useEffect(() => { fetchGroups() }, [])

  const handleChange = (e) => {
    const { name, value } = e.target
    if (value === '__new__') { setShowNewGroup(true); return }
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const handleAddGroup = async () => {
    if (!newGroup.trim()) return
    try {
      const res = await api.post('/groups', { name: newGroup.trim() })
      setGroups(prev => [...prev, res.data])
      setForm(prev => ({ ...prev, group_id: res.data.id }))
      setNewGroup('')
      setShowNewGroup(false)
    } catch (err) {
      alert(err.response?.data?.message || 'เพิ่ม Group ไม่สำเร็จ')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    if (!form.mat_uid || !form.name) { setError('กรุณากรอก MatUID และชื่อสินค้า'); return }
    setLoading(true)
    try {
      await api.post('/products', {
        ...form,
        max_stock: Number(form.max_stock) || 0,
        min_stock: Number(form.min_stock) || 0,
      })
      setSuccess(`ลงทะเบียน "${form.name}" สำเร็จแล้ว!`)
      setForm({ mat_uid:'', name:'', detail:'', weight_per_piece:'', max_stock:'', min_stock:'', group_id:'' })
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
      <h1 className="text-base font-semibold text-gray-800">ลงทะเบียนผลิตภัณฑ์ใหม่</h1>

      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-700">
        ⚠️ ต้องลงทะเบียนสินค้าก่อน ถึงจะลง Stock ได้
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">

        {/* UID */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">🔖 ข้อมูล UID</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>MatUID <span className="text-red-400">*</span></label>
              <input name="mat_uid" value={form.mat_uid} onChange={handleChange}
                className={inputClass} placeholder="เช่น UID-001" required />
            </div>
            <div>
              <label className={labelClass}>Group ผลิตภัณฑ์</label>
              {showNewGroup ? (
                <div className="flex gap-2">
                  <input value={newGroup} onChange={e=>setNewGroup(e.target.value)}
                    className={inputClass} placeholder="ชื่อ Group ใหม่" />
                  <button type="button" onClick={handleAddGroup}
                    className="px-3 h-10 text-xs rounded-xl bg-blue-500 text-white hover:bg-blue-600 whitespace-nowrap">
                    เพิ่ม
                  </button>
                  <button type="button" onClick={()=>setShowNewGroup(false)}
                    className="px-3 h-10 text-xs rounded-xl border border-gray-200 text-gray-500">✕</button>
                </div>
              ) : (
                <select name="group_id" value={form.group_id} onChange={handleChange} className={inputClass}>
                  <option value="">-- เลือก Group --</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  <option value="__new__">➕ เพิ่ม Group ใหม่</option>
                </select>
              )}
            </div>
          </div>
        </div>

        {/* ข้อมูลสินค้า */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">📦 ข้อมูลผลิตภัณฑ์</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>ชื่อผลิตภัณฑ์ <span className="text-red-400">*</span></label>
              <input name="name" value={form.name} onChange={handleChange}
                className={inputClass} placeholder="เช่น วิตามิน C 500mg" required />
            </div>
            <div>
              <label className={labelClass}>น้ำหนักต่อชิ้น</label>
              <input name="weight_per_piece" value={form.weight_per_piece} onChange={handleChange}
                className={inputClass} placeholder="เช่น 0.5 g" />
            </div>
          </div>
          <div>
            <label className={labelClass}>Detail (ส่วนผสม)</label>
            <textarea name="detail" value={form.detail} onChange={handleChange}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 resize-none h-20 text-gray-700"
              placeholder="เช่น Ascorbic acid 500mg..." />
          </div>
        </div>

        {/* Max/Min */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">⚙️ กำหนด Max / Min Stock</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Max Stock</label>
              <input type="number" name="max_stock" value={form.max_stock} onChange={handleChange}
                className={inputClass} placeholder="เช่น 200" />
              <div className="text-xs text-gray-400 mt-1">จำนวนสูงสุดที่ควรเก็บ</div>
            </div>
            <div>
              <label className={labelClass}>Min Stock</label>
              <input type="number" name="min_stock" value={form.min_stock} onChange={handleChange}
                className={inputClass} placeholder="เช่น 20" />
              <div className="text-xs text-gray-400 mt-1">ต่ำกว่านี้จะแจ้งเตือน Low</div>
            </div>
          </div>
        </div>

        {error   && <div className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</div>}
        {success && <div className="text-sm text-green-600 bg-green-50 px-4 py-3 rounded-xl">✅ {success}</div>}

        <div className="flex flex-col sm:flex-row justify-end gap-3">
          <button type="button"
            onClick={() => setForm({ mat_uid:'', name:'', detail:'', weight_per_piece:'', max_stock:'', min_stock:'', group_id:'' })}
            className="h-10 px-5 text-sm rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">
            ล้างข้อมูล
          </button>
          <button type="submit" disabled={loading}
            className="h-10 px-5 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
            {loading ? 'กำลังบันทึก...' : '✓ บันทึกลงทะเบียน'}
          </button>
        </div>
      </form>
    </div>
  )
}