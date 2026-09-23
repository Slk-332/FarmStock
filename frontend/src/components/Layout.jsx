import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * โครงหน้าแบบ GTF SYSTEMS (docs/GTF SYSTEMS.pdf): แถบเมนูซ้าย + แถบผู้ใช้ด้านบน
 *
 * จอกว้าง (lg ขึ้นไป) เมนูซ้ายค้างไว้ตลอด
 * มือถือ/แท็บเล็ตเมนูซ่อนอยู่ กด ☰ แล้วเลื่อนออกมาทับเนื้อหา
 *
 * เมนูเป็นตัวหนังสือล้วนตามที่ผู้ใช้ขอ (ไม่ใส่ไอคอนแม้ในแบบจะมี)
 * หมวดที่มีเมนูย่อยตัวเดียว (ปลูก/ขาย) แสดงเป็นลิงก์ตรง ๆ เหมือนในแบบ
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
  { label: 'ปลูก', to: '/planting', roles: ['admin', 'user'] },
  {
    label: 'คลัง', roles: ['admin', 'user'],
    items: [
      { to: '/stock',    label: 'สต๊อกคงเหลือ' },
      { to: '/stock-in', label: 'ลง Stock' },
      { to: '/register', label: 'ลงทะเบียนวัตถุดิบ', roles: ['admin'] },
    ],
  },
  { label: 'ขาย', to: '/sales', roles: ['admin', 'user'] },
  { label: 'Users (Admin)', to: '/users', roles: ['admin'] },
]

const COLLAPSED_KEY = 'gtfstock.navCollapsed'

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || {} } catch { return {} }
}

const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ (Admin)', user: 'ผู้ใช้งาน' }

function Sidebar({ groups, onNavigate }) {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(loadCollapsed)

  const toggle = (label) => {
    const next = { ...collapsed, [label]: !collapsed[label] }
    setCollapsed(next)
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)) } catch { /* จำไม่ได้ก็ไม่เป็นไร */ }
  }

  const topLink = ({ isActive }) =>
    `block px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
      isActive ? 'bg-brand-active text-brand-dark' : 'text-brand-dark/90 hover:bg-white/60'
    }`

  const subLink = ({ isActive }) =>
    `flex items-center gap-2.5 pl-7 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
      isActive ? 'bg-white/70 text-brand-dark font-semibold' : 'text-gray-600 hover:text-brand-dark hover:bg-white/50'
    }`

  return (
    <nav className="flex flex-col gap-1 px-3 pb-6">
      {groups.map((group, idx) => (
        <div key={group.label} className={idx > 0 && group.items ? 'border-t border-brand-dark/10 pt-2 mt-1' : ''}>
          {group.to ? (
            <NavLink to={group.to} className={topLink} onClick={onNavigate}>{group.label}</NavLink>
          ) : (
            <>
              <button onClick={() => toggle(group.label)}
                className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors hover:bg-white/60 ${
                  group.items.some((i) => location.pathname.startsWith(i.to)) ? 'text-brand-dark' : 'text-brand-dark/90'
                }`}>
                {group.label}
                <span className={`text-[10px] text-gray-500 transition-transform ${collapsed[group.label] ? '' : 'rotate-180'}`}>▼</span>
              </button>
              {!collapsed[group.label] && (
                <div className="flex flex-col gap-0.5 mt-0.5 mb-1">
                  {group.items.map((item) => (
                    <NavLink key={item.to} to={item.to} className={subLink} onClick={onNavigate}>
                      <span className="w-1 h-1 rounded-full bg-current opacity-60" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </nav>
  )
}

const Brand = () => (
  <div className="flex items-center gap-3">
    <img src="/icon.jpg" alt="แก้วทวีฟาร์ม" className="h-11 w-11 rounded-full bg-white object-contain p-1 shadow-sm" />
    <span className="text-lg font-bold text-brand-dark tracking-tight">GTF Stock</span>
  </div>
)

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [userMenu, setUserMenu] = useState(false)
  const userRef = useRef(null)

  useEffect(() => {
    if (!userMenu) return
    const close = (e) => { if (userRef.current && !userRef.current.contains(e.target)) setUserMenu(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [userMenu])

  // เปลี่ยนหน้าแล้วปิดลิ้นชักเมนู/เมนูผู้ใช้ ไม่งั้นค้างทับหน้าใหม่
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDrawerOpen(false); setUserMenu(false) }, [location.pathname])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const allowed = (entry) => !entry.roles || entry.roles.includes(user?.role)
  const groups = NAV_GROUPS
    .filter(allowed)
    .map((g) => (g.items ? { ...g, items: g.items.filter(allowed) } : g))
    .filter((g) => !g.items || g.items.length > 0)

  return (
    <div className="min-h-screen bg-brand-bg lg:flex">

      {/* ===== เมนูซ้าย (จอกว้าง) ===== */}
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 bg-brand-sidebar border-r border-brand-dark/10 sticky top-0 h-screen overflow-y-auto">
        <div className="px-6 pt-6 pb-5"><Brand /></div>
        <Sidebar groups={groups} />
      </aside>

      {/* ===== ลิ้นชักเมนู (มือถือ/แท็บเล็ต) ===== */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-72 max-w-[85vw] bg-brand-sidebar h-full overflow-y-auto shadow-xl">
            <div className="px-5 pt-5 pb-4 flex items-center justify-between">
              <Brand />
              <button onClick={() => setDrawerOpen(false)} className="p-2 text-gray-500 text-lg">✕</button>
            </div>
            <Sidebar groups={groups} onNavigate={() => setDrawerOpen(false)} />
            <div className="px-3 pb-6">
              <button onClick={handleLogout}
                className="w-full text-left px-4 py-2.5 rounded-xl text-sm text-red-600 hover:bg-white/60">
                ออกจากระบบ
              </button>
            </div>
          </div>
          <div className="flex-1 bg-black/30" onClick={() => setDrawerOpen(false)} />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* ===== แถบบน ===== */}
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-gray-200/70 h-16 px-4 lg:px-8 flex items-center gap-3">
          <button onClick={() => setDrawerOpen(true)}
            className="lg:hidden h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 text-gray-600 bg-white">
            ☰
          </button>
          <div className="lg:hidden"><span className="text-base font-bold text-brand-dark">GTF Stock</span></div>

          <div ref={userRef} className="ml-auto relative">
            <button onClick={() => setUserMenu((v) => !v)}
              className="flex items-center gap-3 pl-3 pr-2 py-1.5 rounded-xl hover:bg-gray-50">
              <span className="h-9 w-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold">
                {(user?.full_name || '?').trim().charAt(0).toUpperCase()}
              </span>
              <span className="hidden sm:flex flex-col items-start leading-tight">
                <span className="text-sm font-semibold text-gray-800 max-w-44 truncate">{user?.full_name}</span>
                <span className="text-xs text-gray-500">{ROLE_LABEL[user?.role] || user?.role}</span>
              </span>
              <span className="text-[10px] text-gray-400">▼</span>
            </button>
            {userMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-lg py-1">
                <div className="sm:hidden px-4 py-2 border-b border-gray-100">
                  <div className="text-sm font-semibold text-gray-800 truncate">{user?.full_name}</div>
                  <div className="text-xs text-gray-500">{ROLE_LABEL[user?.role] || user?.role}</div>
                </div>
                <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                  ออกจากระบบ
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="p-4 lg:p-8 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
