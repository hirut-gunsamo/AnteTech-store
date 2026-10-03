import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/context'
import AppShell from './components/AppShell'
import { LanguageProvider } from './components/LanguageProvider'
import { SettingsProvider } from './components/SettingsProvider'
import Dashboard from './pages/Dashboard'
import Expenses from './pages/Expenses'
import Equipment from './pages/Equipment'
import Deductions from './pages/Deductions'
import Payroll from './pages/Payroll'
import Commission from './pages/Commission'
import Approvals from './pages/Approvals'
import Branches from './pages/Branches'
import Inventory from './pages/Inventory'
import Products from './pages/Products'
import ProductTypes from './pages/ProductTypes'
import Categories from './pages/Categories'
import Transfers from './pages/Transfers'
import Receipts from './pages/Receipts'
import Reports from './pages/Reports'
import Requests from './pages/Requests'
import Sales from './pages/Sales'
import Settings from './pages/Settings'
import Sync from './pages/Sync'
import Users from './pages/Users'
import Login from './pages/Login'

function Protected() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100svh',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--muted)',
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  )
}

/** Sales is the sellers' page; the Owner reads sales on Reports. */
function SalesRoute() {
  const { user } = useAuth()

  if (user?.role === 'OWNER') return <Navigate to="/reports" replace />

  return <Sales />
}

function LoginRoute() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (user) return <Navigate to="/dashboard" replace />

  return <Login />
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />

          <Route element={<Protected />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/users" element={<Users />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/products" element={<Products />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/product-types" element={<ProductTypes />} />
            <Route path="/transfers" element={<Transfers />} />
            <Route path="/branches" element={<Branches />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/receipts" element={<Receipts />} />
            <Route path="/sync" element={<Sync />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/sales" element={<SalesRoute />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/equipment" element={<Equipment />} />
            <Route path="/deductions" element={<Deductions />} />
            <Route path="/payroll" element={<Payroll />} />
            <Route path="/commission" element={<Commission />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  )
}
