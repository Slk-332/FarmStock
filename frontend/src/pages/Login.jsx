import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const { login }    = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  
  const handleSubmit = async (e) => {
  e.preventDefault()
  setError('')
  setLoading(true)
  try {
    await login(username, password)
    const from = location.state?.from?.pathname || '/'
    console.log('redirect to:', from)
    navigate(from, { replace: true })
  } catch (err) {
    setError(err.response?.data?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่')
  } finally {
    setLoading(false)
  }
}

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl border border-gray-200 p-8 w-full max-w-sm shadow-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🌱</div>
          <h1 className="text-xl font-semibold text-gray-800">FarmStock</h1>
          <p className="text-sm text-gray-500 mt-1">ระบบจัดการ Stock ผลิตภัณฑ์เกษตร</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-gray-600">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
              placeholder="กรอก username"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-gray-600">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
              placeholder="กรอก password"
              required
            />
          </div>

          {error && (
            <div className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="h-9 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  )
}