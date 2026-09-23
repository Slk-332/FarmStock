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
  { label: 'Dashboard', to: '/dashboard', roles: ['admin'] },
  {
    label: 'จัดซื้อ', roles: ['admin', 'user'],
    items: [
      { to: '/orders',  label: 'ใบสั่งซื้อ' },
      { to: '/receive', label: 'รับของเข้า Stock' },
    ],
  },
  {
    label: 'ผสม', roles: ['admin', 'user'],
    items: [
      { to: '/formulas', label: 'สูตรผสม' },
      { to: '/mixing',   label: 'ใบสั่งผลิต' },
      { to: '/print',    label: 'ปริ้น QR' },
      { to: '/dispense', label: 'เบิกจ่าย' },
    ],
  },
  {
    label: 'ปลูก', roles: ['admin', 'user'],
    items: [
      { to: '/planting', label: 'แปลงปลูก' },
    ],
  },
  {
    label: 'คลัง', roles: ['admin', 'user'],
    items: [
      { to: '/stock',    label: 'สต๊อกคงเหลือ' },
      { to: '/stock-in', label: 'ลง Stock' },
      { to: '/register', label: 'ลงทะเบียนวัตถุดิบ', roles: ['admin'] },
    ],
  },
  {
    label: 'ขาย', roles: ['admin', 'user'],
    items: [
      { to: '/sales', label: 'รายการขาย + กำไร' },
    ],
  },
  { label: 'Users', to: '/users', roles: ['admin'], badge: 'Admin' },
]

/** ปุ่มบนแถบล่างของมือถือ — 5 อันที่กดบ่อยสุด ไม่ใช่ทั้งหมด */
const BOTTOM_TABS = [
  { to: '/dashboard', label: 'Dashboard', roles: ['admin'] },
  { to: '/stock',     label: 'คลัง',      roles: ['user'] },
  { to: '/orders',    label: 'สั่งซื้อ' },
  { to: '/mixing',    label: 'ผลิต' },
  { to: '/planting',  label: 'แปลง' },
  { to: '/sales',     label: 'ขาย' },
]

const Brand = ({ compact = false }) => (
  <span className="flex items-center gap-2 text-sm font-semibold text-gray-800 whitespace-nowrap">
    <img src="/icon.jpg" alt="แก้วทวีฟาร์ม" className="h-7 w-7 rounded-md object-contain" />
    <span className={compact ? 'hidden lg:inline' : ''}>GTF Stock</span>
  </span>
)

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
        {/* แท็บเล็ต (768–1023px) ที่ไม่พอ ย่อชื่อระบบ/ชื่อผู้ใช้ เหลือแค่โลโก้ */}
        <span className="mr-2 lg:mr-3"><Brand compact /></span>

        {groups.map(group => group.to ? (
          <NavLink key={group.to} to={group.to}
            className={({ isActive }) =>
              `text-xs px-2.5 lg:px-3 py-1.5 rounded-md border whitespace-nowrap transition-colors ${
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
              className={`text-xs px-2.5 lg:px-3 py-1.5 rounded-md border whitespace-nowrap transition-colors ${
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
                    {item.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="ml-auto flex items-center gap-2 lg:gap-3">
          <span className="text-xs text-gray-500 hidden lg:inline truncate max-w-40">{user?.full_name}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium hidden lg:inline ${user?.role === 'admin' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
            {user?.role}
          </span>
          <button onClick={handleLogout} title={`ออกจากระบบ (${user?.full_name || ''})`}
            className="text-xs px-2.5 lg:px-3 py-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 whitespace-nowrap">
            <span className="lg:hidden">ออก</span>
            <span className="hidden lg:inline">ออกจากระบบ</span>
          </button>
        </div>
      </nav>

      {/* ===== Mobile Navbar ===== */}
      <nav className="bg-white border-b border-gray-200 px-4 h-12 flex items-center justify-between sticky top-0 z-50 md:hidden">
        <Brand />
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 truncate max-w-40">{user?.full_name}</span>
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
            <NavLink key={group.to} to={group.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`
              }>
              {group.label}
            </NavLink>
          ) : (
            <div key={group.label} className="flex flex-col">
              <div className="px-3 pt-2 pb-1 text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                {group.label}
              </div>
              {group.items.map(item => (
                <NavLink key={item.to} to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                    }`
                  }>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="border-t border-gray-100 pt-2 mt-1">
            <button onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-500 hover:bg-red-50 w-full">
              ออกจากระบบ
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
        {BOTTOM_TABS.filter(allowed).map(item => {
          const isActive = location.pathname.startsWith(item.to)
          return (
            <NavLink key={item.to} to={item.to}
              className={`flex-1 flex items-center justify-center py-3.5 text-xs transition-colors ${
                isActive ? 'text-blue-600 font-semibold' : 'text-gray-500'
              }`}>
              {item.label}
            </NavLink>
          )
        })}
      </div>
    </div>
  )
}
