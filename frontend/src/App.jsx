import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { CondoProvider, useCondo } from './lib/CondoContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import AdminSetup from './pages/AdminSetup'
import AdminDashboard from './pages/AdminDashboard'
import AdminFractions from './pages/AdminFractions'
import AdminOwners from './pages/AdminOwners'
import AdminBudgetsQuotas from './pages/AdminBudgetsQuotas'
import AdminLateFees from './pages/AdminLateFees'
import AdminReminders from './pages/AdminReminders'
import AdminSuppliers from './pages/AdminSuppliers'
import Maintenance from './pages/Maintenance'
import Assemblies from './pages/Assemblies'
import Documents from './pages/Documents'
import OwnerHome from './pages/OwnerHome'

function Gate({ children }) {
  const { loading, user } = useAuth()
  if (loading) return <div className="empty">A carregar…</div>
  if (!user) return <Login />
  return <CondoProvider>{children}</CondoProvider>
}

function RoleHome() {
  const { isAdmin } = useCondo()
  return isAdmin ? <AdminDashboard /> : <OwnerHome />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate>
          <Routes>
            <Route path="/configurar" element={<AdminSetup />} />
            <Route element={<Layout />}>
              <Route path="/" element={<RoleHome />} />
              <Route path="/fracoes" element={<AdminFractions />} />
              <Route path="/condominos" element={<AdminOwners />} />
              <Route path="/quotas" element={<AdminBudgetsQuotas />} />
              <Route path="/juros" element={<AdminLateFees />} />
              <Route path="/lembretes" element={<AdminReminders />} />
              <Route path="/fornecedores" element={<AdminSuppliers />} />
              <Route path="/manutencao" element={<Maintenance />} />
              <Route path="/assembleias" element={<Assemblies />} />
              <Route path="/documentos" element={<Documents />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Gate>
      </BrowserRouter>
    </AuthProvider>
  )
}
