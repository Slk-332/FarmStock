import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login        from './pages/Login'
import Dashboard    from './pages/Dashboard'
import Register     from './pages/Register'
import StockIn      from './pages/StockIn'
import Orders       from './pages/Orders'
import Receive      from './pages/Receive'
import Formulas     from './pages/Formulas'
import Mixing       from './pages/Mixing'
import Planting     from './pages/Planting'
import Sales        from './pages/Sales'
import PlotScan     from './pages/PlotScan'
import Dispense     from './pages/Dispense'
import Print        from './pages/Print'
import Report       from './pages/Report'
import Users        from './pages/Users'
import ScanItem     from './pages/ScanItem'
import Layout       from './components/Layout'

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="flex items-center justify-center h-screen">กำลังโหลด...</div>
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

const AdminRoute = ({ children }) => {
  const { user, loading } = useAuth()
  if (loading) return null
  return user?.role === 'admin' ? children : <Navigate to="/" />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/scan/:itemId" element={
        <PrivateRoute><ScanItem /></PrivateRoute>} />
        <Route path="/plot/:token" element={
        <PrivateRoute><PlotScan /></PrivateRoute>} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="stock-in"  element={<StockIn />} />
          <Route path="orders"    element={<Orders />} />
          <Route path="receive"   element={<Receive />} />
          <Route path="formulas"  element={<Formulas />} />
          <Route path="mixing"    element={<Mixing />} />
          <Route path="planting"  element={<Planting />} />
          <Route path="sales"     element={<Sales />} />
          <Route path="dispense"  element={<Dispense />} />
          <Route path="print"     element={<Print />} />
          <Route path="register"  element={<AdminRoute><Register /></AdminRoute>} />
          <Route path="report"    element={<AdminRoute><Report /></AdminRoute>} />
          <Route path="users"     element={<AdminRoute><Users /></AdminRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}