import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * เมนูจัดเป็นกลุ่มตาม Newfunction.md
 *
 * ของเดิมเป็นรายการแบน ๆ 7 อัน พอเพิ่มระบบใหม่เข้าไปกลายเป็น 11 อัน กดหายาก
 * และ Newfunction ระบุไว้ว่า QR/ปริ้น/เบิกจ่าย ต้องไปอยู่ใต้ Mixing Process
 * ส่วนเมนู Material ให้เหลือแค่เรื่อง Stock
 */
const NAV_GROUPS = [
  { label: 'Dashboard', icon: '📊', to: '/', roles: ['admin', 'user'] },
  {
    label: 'จัดซื้อ', icon: '🧾', roles: ['admin', 'user'],
    items: [
      { to: '/orders',  label: 'ใบสั่งซื้อ',       icon: '🧾' },
      { to: '/receive', label: 'รับของเข้า Stock', icon: '📥' },
    ],
  },
  {
    label: 'ผสม', icon: '⚗️', roles: ['admin', 'user'],
    items: [
      { to: '/formulas', label: 'สูตรผสม',    icon: '📋' },
      { to: '/mixing',   label: 'ใบสั่งผลิต', icon: '⚗️' },
      { to: '/print',    label: 'ปริ้น QR',   icon: '🖨️' },
      { to: '/dispense', label: 'เบิกจ่าย',   icon: '🔄' },
    ],
  },
  {
    label: 'ปลูก', icon: '🌱', roles: ['admin', 'user'],
    items: [
      { to: '/planting', label: 'แปลงปลูก', icon: '🌱' },
    ],
  },
  {
    label: 'คลัง', icon: '📦', roles: ['admin', 'user'],
    items: [
      { to: '/stock-in', label: 'ลง Stock',           icon: '📦' },
      { to: '/register', label: 'ลงทะเบียนวัตถุดิบ', icon: '📝', roles: ['admin'] },
    ],
  },
  {
    label: 'ขาย', icon: '💰', roles: ['admin', 'user'],
    items: [
      { to: '/sales', label: 'รายการขาย + กำไร', icon: '💰' },
    ],
  },
  { label: 'Report', icon: '📈', to: '/report', roles: ['admin'] },
  { label: 'Users',  icon: '👥', to: '/users',  roles: ['admin'], badge: 'Admin' },
]

/** ปุ่มบนแถบล่างของมือถือ — 5 อันที่กดบ่อยสุด ไม่ใช่ทั้งหมด */
const BOTTOM_TABS = [
  { to: '/',         label: 'หน้าหลัก', icon: '📊' },
  { to: '/orders',   label: 'สั่งซื้อ',  icon: '🧾' },
  { to: '/mixing',   label: 'ผลิต',     icon: '⚗️' },
  { to: '/planting', label: 'แปลง',     icon: '🌱' },
  { to: '/sales',    label: 'ขาย',      icon: '💰' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [openGroup, setOpenGroup] = useState(null)
  const navRef = useRef(null)

  // ปิด dropdown เมื่อคลิกที่อื่น — ไม่งั้นมันค้างเปิดจนกว่าจะกดปุ่มเดิมซ้ำ
  useEffect(() => {
    if (!openGroup) return
    const close = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) setOpenGroup(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [openGroup])

  useEffect(() => { setOpenGroup(null); setMenuOpen(false) }, [location.pathname])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const allowed = (entry) => !entry.roles || entry.roles.includes(user?.role)

  const groups = NAV_GROUPS
    .filter(allowed)
    .map(g => (g.items ? { ...g, items: g.items.filter(allowed) } : g))
    .filter(g => !g.items || g.items.length > 0)

  const isGroupActive = (group) =>
    group.items?.some(i => location.pathname.startsWith(i.to))

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ===== Desktop Navbar ===== */}
      <nav ref={navRef}
        className="bg-white border-b border-gray-200 px-4 h-11 items-center gap-1 sticky top-0 z-50 hidden md:flex">
        <span className="text-sm font-semibold text-gray-800 mr-3">🌱 FarmStock</span>

        {groups.map(group => group.to ? (
          <NavLink key={group.to} to={group.to} end={group.to === '/'}
            className={({ isActive }) =>
              `text-xs px-3 py-1.5 rounded-md border transition-colors ${
                isActive ? 'bg-blue-50 text-blue-600 border-blue-200'
                         : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`
            }>
            {group.label}
            {group.badge && (
              <span className="ml-1 text-[10px] bg-red-100 text-red-500 px-1 rounded-full">{group.badge}</span>
            )}
          </NavLink>
        ) : (
          <div key={group.label} className="relative">
            <button onClick={() => setOpenGroup(openGroup === group.label ? null : group.label)}
              className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                isGroupActive(group) ? 'bg-blue-50 text-blue-600 border-blue-200'
                                     : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}>
              {group.label} <span className="text-[9px] ml-0.5">▼</span>
            </button>

            {openGroup === group.label && (
              <div className="absolute left-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
                {group.items.map(item => (
                  <NavLink key={item.to} to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                        isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                      }`
                    }>
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
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

      {/* Mobile Dropdown Menu — แสดงทุกเมนู แบ่งเป็นหมวด */}
      {menuOpen && (
        <div className="md:hidden bg-white border-b border-gray-200 px-4 py-3 flex flex-col gap-1 sticky top-12 z-40 shadow-md max-h-[70vh] overflow-y-auto">
          {groups.map(group => group.to ? (
            <NavLink key={group.to} to={group.to} end={group.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`
              }>
              <span>{group.icon}</span>
              <span>{group.label}</span>
            </NavLink>
          ) : (
            <div key={group.label} className="flex flex-col">
              <div className="px-3 pt-2 pb-1 text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                {group.icon} {group.label}
              </div>
              {group.items.map(item => (
                <NavLink key={item.to} to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                    }`
                  }>
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
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
        {BOTTOM_TABS.map(item => {
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
