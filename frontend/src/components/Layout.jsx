import { useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const navItems = [
    { to: '/',         label: 'Dashboard',  icon: '📊', roles: ['admin','user'] },
    { to: '/register', label: 'ลงทะเบียน', icon: '📝', roles: ['admin'] },
    { to: '/stock-in', label: 'ลง Stock',  icon: '📦', roles: ['admin','user'] },
    { to: '/dispense', label: 'เบิกจ่าย', icon: '🔄', roles: ['admin','user'] },
    { to: '/print',    label: 'Print',      icon: '🖨️', roles: ['admin','user'] },
    { to: '/report',   label: 'Report',     icon: '📈', roles: ['admin'] },
    { to: '/users',    label: 'Users',      icon: '👥', roles: ['admin'] },
  ].filter(item => item.roles.includes(user?.role))

  // Bottom tab items (มือถือ) — แค่ 5 อันที่ใช้บ่อย
  const bottomItems = navItems.slice(0, 5)

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ===== Desktop Navbar ===== */}
      <nav className="bg-white border-b border-gray-200 px-4 h-11 items-center gap-2 sticky top-0 z-50 hidden md:flex">
        <span className="text-sm font-semibold text-gray-800 mr-3">🌱 FarmStock</span>
        {navItems.map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}
            className={({ isActive }) =>
              `text-xs px-3 py-1.5 rounded-md border transition-colors ${
                isActive ? 'bg-blue-50 text-blue-600 border-blue-200' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`
            }>
            {item.label}
            {item.label === 'Users' && (
              <span className="ml-1 text-[10px] bg-red-100 text-red-500 px-1 rounded-full">Admin</span>
            )}
          </NavLink>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-500">{user?.full_name}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${user?.role === 'admin' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
            {user?.role}
          </span>
          <button onClick={handleLogout}
            className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50">
            ออกจากระบบ
          </button>
        </div>
      </nav>

      {/* ===== Mobile Navbar ===== */}
      <nav className="bg-white border-b border-gray-200 px-4 h-12 flex items-center justify-between sticky top-0 z-50 md:hidden">
        <span className="text-sm font-semibold text-gray-800">🌱 FarmStock</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{user?.full_name}</span>
          <button onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 rounded-lg border border-gray-200 text-gray-500">
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
      </nav>

      {/* Mobile Dropdown Menu */}
      {menuOpen && (
        <div className="md:hidden bg-white border-b border-gray-200 px-4 py-3 flex flex-col gap-2 sticky top-12 z-40 shadow-md">
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`
              }>
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
          <div className="border-t border-gray-100 pt-2 mt-1">
            <button onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-500 hover:bg-red-50 w-full">
              <span>🚪</span>
              <span>ออกจากระบบ</span>
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="p-3 md:p-4 pb-20 md:pb-4">
        <Outlet />
      </main>

      {/* ===== Mobile Bottom Tab Bar ===== */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 flex">
        {bottomItems.map(item => {
          const isActive = item.to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.to)
          return (
            <NavLink key={item.to} to={item.to}
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${
                isActive ? 'text-blue-600' : 'text-gray-400'
              }`}>
              <span className="text-lg">{item.icon}</span>
              <span className="text-[10px]">{item.label}</span>
            </NavLink>
          )
        })}
      </div>
    </div>
  )
}