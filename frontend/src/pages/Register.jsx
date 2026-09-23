import { useState, useEffect, useMemo } from 'react'
import api from '../api/axios'
import { MAT_TYPES, formatPackSize, unitName } from '../lib/units'

const EMPTY_FORM = {
  mat_uid:'', name:'', detail:'', group_id:'', mat_type:'material',
  stock_unit:'sack', pack_size:'', pack_unit:'', storage_area:'',
  max_stock:'', min_stock:'',
}

export default function Register() {
  const [groups,  setGroups]  = useState([])
  const [units,   setUnits]   = useState([])
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error,   setError]   = useState('')

  const [newGroup,setNewGroup]= useState('')
  const [showNewGroup, setShowNewGroup] = useState(false)
  // เพิ่มหน่วยใหม่ inline ได้เหมือน Group — 'stock' = หน่วยนับ, 'pack' = หน่วยขนาดบรรจุ
  const [newUnit, setNewUnit] = useState({ target:null, name:'', kind:'count' })

  const [form, setForm] = useState(EMPTY_FORM)

  const fetchGroups = async () => {
    try { setGroups((await api.get('/groups')).data) } catch {}
  }
  const fetchUnits = async () => {
    try { setUnits((await api.get('/units')).data) } catch {}
  }

  useEffect(() => { fetchGroups(); fetchUnits() }, [])

  // หน่วยนับ = กระสอบ/ถุง/ขวด (1 หน่วย = 1 QR), หน่วยขนาดบรรจุ = กิโลกรัม/ลิตร
  const countUnits   = useMemo(() => units.filter(u => u.kind === 'count'), [units])
  const measureUnits = useMemo(() => units.filter(u => u.kind !== 'count'), [units])

  const handleChange = (e) => {
    const { name, value } = e.target
    if (value === '__new_group__') { setShowNewGroup(true); return }
    if (value === '__new_stock_unit__') { setNewUnit({ target:'stock_unit', name:'', kind:'count' }); return }
    if (value === '__new_pack_unit__')  { setNewUnit({ target:'pack_unit',  name:'', kind:'weight' }); return }
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const handleAddGroup = async () => {
    if (!newGroup.trim()) return
    try {
      const res = await api.post('/groups', { name: newGroup.trim() })
      setGroups(prev => [...prev, res.data])
      setForm(prev => ({ ...prev, group_id: res.data.id }))
      setNewGroup(''); setShowNewGroup(false)
    } catch (err) {
      alert(err.response?.data?.message || 'เพิ่ม Group ไม่สำเร็จ')
    }
  }

  const handleAddUnit = async () => {
    if (!newUnit.name.trim()) return
    try {
      // ไม่ส่ง code — ให้ backend ออกรหัสให้ เพราะชื่อหน่วยเป็นภาษาไทย ทำเป็นรหัสเองไม่ได้
      const res = await api.post('/units', { name: newUnit.name.trim(), kind: newUnit.kind })
      setUnits(prev => [...prev, res.data])
      setForm(prev => ({ ...prev, [newUnit.target]: res.data.code }))
      setNewUnit({ target:null, name:'', kind:'count' })
    } catch (err) {
      alert(err.response?.data?.message || 'เพิ่มหน่วยไม่สำเร็จ')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    if (!form.mat_uid || !form.name) { setError('กรุณากรอก MatUID และชื่อสินค้า'); return }
    if (form.pack_size && !form.pack_unit) { setError('กรอกขนาดบรรจุแล้ว ต้องเลือกหน่วยขนาดบรรจุด้วย'); return }
    setLoading(true)
    try {
      await api.post('/products', {
        ...form,
        group_id:  form.group_id  || null,
        pack_size: form.pack_size ? Number(form.pack_size) : null,
        pack_unit: form.pack_unit || null,
        max_stock: Number(form.max_stock) || 0,
        min_stock: Number(form.min_stock) || 0,
      })
      setSuccess(`ลงทะเบียน "${form.name}" สำเร็จแล้ว!`)
      setForm(EMPTY_FORM)
    } catch (err) {
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = "h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 bg-white text-gray-700 w-full"
  const labelClass = "text-xs text-gray-500 mb-1.5 block"

  /* กล่องกรอกชื่อหน่วยใหม่ ใช้ร่วมกันทั้งหน่วยนับและหน่วยขนาดบรรจุ */
  const newUnitBox = (
    <div className="flex gap-2">
      <input autoFocus value={newUnit.name}
        onChange={e => setNewUnit(prev => ({ ...prev, name: e.target.value }))}
        className={inputClass} placeholder="ชื่อหน่วยใหม่ เช่น ปี๊บ" />
      <button type="button" onClick={handleAddUnit}
        className="px-3 h-10 text-xs rounded-xl bg-blue-500 text-white hover:bg-blue-600 whitespace-nowrap">
        เพิ่ม
      </button>
      <button type="button" onClick={() => setNewUnit({ target:null, name:'', kind:'count' })}
        className="px-3 h-10 text-xs rounded-xl border border-gray-200 text-gray-500">✕</button>
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <h1 className="text-base font-semibold text-gray-800">ลงทะเบียนผลิตภัณฑ์ใหม่</h1>

      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-700">
        ⚠️ ต้องลงทะเบียนสินค้าก่อน ถึงจะลง Stock ได้
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">

        {/* UID + ประเภท */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">🔖 ข้อมูล UID</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>MatUID <span className="text-red-400">*</span></label>
              <input name="mat_uid" value={form.mat_uid} onChange={handleChange}
                className={inputClass} placeholder="เช่น MAT0001" required />
            </div>
            <div>
              <label className={labelClass}>หมวดหมู่ (Category)</label>
              {showNewGroup ? (
                <div className="flex gap-2">
                  <input autoFocus value={newGroup} onChange={e=>setNewGroup(e.target.value)}
                    className={inputClass} placeholder="เช่น อินทรีย์วัตถุ" />
                  <button type="button" onClick={handleAddGroup}
                    className="px-3 h-10 text-xs rounded-xl bg-blue-500 text-white hover:bg-blue-600 whitespace-nowrap">
                    เพิ่ม
                  </button>
                  <button type="button" onClick={()=>setShowNewGroup(false)}
                    className="px-3 h-10 text-xs rounded-xl border border-gray-200 text-gray-500">✕</button>
                </div>
              ) : (
                <select name="group_id" value={form.group_id} onChange={handleChange} className={inputClass}>
                  <option value="">-- เลือกหมวดหมู่ --</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  <option value="__new_group__">➕ เพิ่มหมวดหมู่ใหม่</option>
                </select>
              )}
            </div>
            <div>
              <label className={labelClass}>ประเภทวัตถุดิบ</label>
              <select name="mat_type" value={form.mat_type} onChange={handleChange} className={inputClass}>
                {MAT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div className="text-xs text-gray-400 mt-1">
                ของผสมและผลผลิตอยู่ใน Stock เดียวกัน แยกกันด้วยช่องนี้
              </div>
            </div>
            <div>
              <label className={labelClass}>พื้นที่จัดเก็บ</label>
              <input name="storage_area" value={form.storage_area} onChange={handleChange}
                className={inputClass} placeholder="เช่น A" />
              <div className="text-xs text-gray-400 mt-1">โซนในคลัง ไม่ใช่แปลงปลูก</div>
            </div>
          </div>
        </div>

        {/* ข้อมูลสินค้า + หน่วย */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">📦 ข้อมูลผลิตภัณฑ์</div>
          <div>
            <label className={labelClass}>ชื่อผลิตภัณฑ์ <span className="text-red-400">*</span></label>
            <input name="name" value={form.name} onChange={handleChange}
              className={inputClass} placeholder="เช่น ปุ๋ยแห้ง 46-0-0" required />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>หน่วยนับ <span className="text-red-400">*</span></label>
              {newUnit.target === 'stock_unit' ? newUnitBox : (
                <select name="stock_unit" value={form.stock_unit} onChange={handleChange} className={inputClass}>
                  {countUnits.map(u => <option key={u.code} value={u.code}>{u.name}</option>)}
                  <option value="__new_stock_unit__">➕ เพิ่มหน่วยใหม่</option>
                </select>
              )}
              <div className="text-xs text-gray-400 mt-1">1 หน่วยนี้ = 1 QR</div>
            </div>
            <div>
              <label className={labelClass}>ขนาดบรรจุ</label>
              <input type="number" name="pack_size" value={form.pack_size} onChange={handleChange}
                className={inputClass} placeholder="เช่น 50" step="0.0001" min="0" />
            </div>
            <div>
              <label className={labelClass}>หน่วยขนาดบรรจุ</label>
              {newUnit.target === 'pack_unit' ? newUnitBox : (
                <select name="pack_unit" value={form.pack_unit} onChange={handleChange} className={inputClass}>
                  <option value="">-- ไม่ระบุ --</option>
                  {measureUnits.map(u => <option key={u.code} value={u.code}>{u.name}</option>)}
                  <option value="__new_pack_unit__">➕ เพิ่มหน่วยใหม่</option>
                </select>
              )}
            </div>
          </div>

          {form.pack_size && form.pack_unit && (
            <div className="bg-gray-50 rounded-xl px-4 py-2 text-xs text-gray-500">
              จะบันทึกเป็น <span className="font-medium text-gray-700">{formatPackSize(units, form)}</span>
              {' '}— ลง Stock 1 {unitName(units, form.stock_unit)} จะได้ QR 1 ดวง
            </div>
          )}

          <div>
            <label className={labelClass}>Detail (ส่วนผสม)</label>
            <textarea name="detail" value={form.detail} onChange={handleChange}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400 resize-none h-20 text-gray-700"
              placeholder="เช่น N 46%..." />
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
              <div className="text-xs text-gray-400 mt-1">
                จำนวนสูงสุดที่ควรเก็บ (หน่วย: {unitName(units, form.stock_unit) || '-'})
              </div>
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
          <button type="button" onClick={() => setForm(EMPTY_FORM)}
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
