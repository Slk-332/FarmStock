import { useState, useEffect } from 'react'
import api from '../api/axios'

export default function Users() {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [modal,   setModal]   = useState(false)
  const [editUser,setEditUser]= useState(null)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState('')

  const [form, setForm] = useState({ full_name:'', username:'', password:'', role:'user' })

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const res = await api.get('/users')
      setUsers(res.data)
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { fetchUsers() }, [])

  const filtered = users.filter(u =>
    u.full_name.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase())
  )

  const openCreate = () => {
    setEditUser(null)
    setForm({ full_name:'', username:'', password:'', role:'user' })
    setError(''); setModal(true)
  }

  const openEdit = (user) => {
    setEditUser(user)
    setForm({ full_name: user.full_name, username: user.username, password:'', role: user.role })
    setError(''); setModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setSaving(true)
    try {
      if (editUser) {
        await api.put(`/users/${editUser.id}`, form)
        setSuccess('อัปเดตสำเร็จ')
      } else {
        await api.post('/users', form)
        setSuccess('สร้างบัญชีสำเร็จ')
      }
      setModal(false); fetchUsers()
    } catch (err) {
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาด')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (user) => {
    try {
      const res = await api.patch(`/users/${user.id}/toggle`)
      setSuccess(res.data.message); fetchUsers()
    } catch (err) {
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาด')
    }
  }

  const fmtTime = (d) => d ? new Date(d).toLocaleString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '-'

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-base font-semibold text-gray-800">User Management</h1>

      {error   && <div className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-xl">{error}</div>}
      {success && <div className="text-sm text-green-600 bg-green-50 px-4 py-3 rounded-xl">✅ {success}</div>}

      <div className="flex items-center gap-3">
        <div className="bg-white rounded-xl border border-gray-200 px-3 py-2 flex items-center gap-2 flex-1">
          <span className="text-gray-400 text-sm">🔍</span>
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="ค้นหา ชื่อ, Username..."
            className="flex-1 text-sm outline-none text-gray-700 placeholder-gray-400" />
        </div>
        <button onClick={openCreate}
          className="h-10 px-4 text-sm rounded-xl bg-blue-500 text-white hover:bg-blue-600 whitespace-nowrap">
          + สร้าง User
        </button>
      </div>

      {/* Mobile Card View */}
      <div className="flex flex-col gap-3 md:hidden">
        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">กำลังโหลด...</div>
        ) : filtered.map(user => (
          <div key={user.id} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">{user.full_name}</div>
                <div className="text-xs text-gray-400 mt-0.5">@{user.username}</div>
              </div>
              <div className="flex gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${user.role==='admin' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                  {user.role}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${user.is_active ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                  {user.is_active ? 'ใช้งาน' : 'ปิด'}
                </span>
              </div>
            </div>
            <div className="text-xs text-gray-400">เข้าใช้ล่าสุด: {fmtTime(user.last_login)}</div>
            <div className="flex gap-2">
              <button onClick={()=>openEdit(user)}
                className="flex-1 h-9 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
                ✏️ แก้ไข
              </button>
              <button onClick={()=>handleToggle(user)}
                className={`flex-1 h-9 text-xs rounded-lg border ${user.is_active ? 'border-red-200 text-red-500 hover:bg-red-50' : 'border-green-200 text-green-600 hover:bg-green-50'}`}>
                {user.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              {['ชื่อ','Username','Role','สิทธิ์','สถานะ','วันที่สร้าง','เข้าใช้ล่าสุด','จัดการ'].map(h=>(
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-8 text-gray-400 text-sm">กำลังโหลด...</td></tr>
            ) : filtered.map(user => (
              <tr key={user.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-700 font-medium whitespace-nowrap">{user.full_name}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{user.username}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${user.role==='admin' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                    {user.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                  {user.role === 'admin' ? 'ทุกอย่าง' : 'ลง Stock · เบิกจ่าย · Print'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${user.is_active ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                    {user.is_active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtTime(user.created_at)}</td>
                <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtTime(user.last_login)}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex gap-2">
                    <button onClick={()=>openEdit(user)}
                      className="text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">แก้ไข</button>
                    <button onClick={()=>handleToggle(user)}
                      className={`text-xs px-3 py-1 rounded-lg border ${user.is_active ? 'border-red-200 text-red-500 hover:bg-red-50' : 'border-green-200 text-green-600 hover:bg-green-50'}`}>
                      {user.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal - Bottom Sheet บนมือถือ */}
      {modal && (
        <div className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-xl w-full sm:max-w-sm p-5 flex flex-col gap-4 shadow-xl">
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto sm:hidden mb-1"/>
            <div className="text-sm font-semibold text-gray-800">{editUser ? 'แก้ไข User' : 'สร้าง User ใหม่'}</div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-500">ชื่อ-นามสกุล</label>
                <input value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})}
                  className="h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400"
                  placeholder="เช่น สมชาย ใจดี" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-500">Username</label>
                <input value={form.username} onChange={e=>setForm({...form,username:e.target.value})}
                  className="h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400"
                  placeholder="เช่น somchai" required disabled={!!editUser} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-500">{editUser ? 'Password ใหม่ (ถ้าต้องการเปลี่ยน)' : 'Password'}</label>
                <input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}
                  className="h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-blue-400"
                  required={!editUser} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-500">Role</label>
                <select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}
                  className="h-10 px-3 text-sm rounded-xl border border-gray-200 focus:outline-none bg-white">
                  <option value="user">User — ลง Stock · เบิกจ่าย · Print</option>
                  <option value="admin">Admin — ทุกอย่าง</option>
                </select>
              </div>
              {error && <div className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl">{error}</div>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={()=>setModal(false)}
                  className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-500 text-sm">ยกเลิก</button>
                <button type="submit" disabled={saving}
                  className="flex-1 h-11 rounded-xl bg-blue-500 text-white text-sm font-medium disabled:opacity-50">
                  {saving ? 'กำลังบันทึก...' : editUser ? 'บันทึก' : 'สร้างบัญชี'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}