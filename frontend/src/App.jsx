import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { CondoProvider, useCondo } from './lib/CondoContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import AdminSetup from './pages/AdminSetup'
import AdminDashboard from './pages/AdminDashboard'
import AdminFractions from './pages/AdminFractions'
import AdminOwners from './pages/AdminOwners'
import AdminCondoSettings from './pages/AdminCondoSettings'
import AdminBudgetsQuotas from './pages/AdminBudgetsQuotas'
import AdminLateFees from './pages/AdminLateFees'
import AdminReminders from './pages/AdminReminders'
import AdminSuppliers from './pages/AdminSuppliers'
import Maintenance from './pages/Maintenance'
import Occurrences from './pages/Occurrences'
import AdminOverview from './pages/AdminOverview'
import Assemblies from './pages/Assemblies'
import Documents from './pages/Documents'
import OwnerHome from './pages/OwnerHome'
import AccountStatement from './pages/AccountStatement'

// Ecrã de login: volta sempre ao endereço inicial, para que quem entra a seguir comece
// na sua página inicial (condómino: as minhas quotas; admin: visão geral) e não na
// página onde o utilizador anterior estava.
function LoginScreen() {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (location.pathname !== '/') navigate('/', { replace: true })
  }, [location.pathname, navigate])
  return <Login />
}

function Gate({ children }) {
  const { loading, user, recovery } = useAuth()
  if (loading) return <div className="empty">A carregar…</div>
  if (user && recovery) return <ResetPassword />
  if (!user) return <LoginScreen />
  return <CondoProvider>{children}</CondoProvider>
}

function RoleHome() {
  const { isAdmin } = useCondo()
  return isAdmin ? <AdminOverview /> : <OwnerHome />
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
              <Route path="/resumo" element={<AdminDashboard />} />
              <Route path="/fracoes" element={<AdminFractions />} />
              <Route path="/condominos" element={<AdminOwners />} />
              <Route path="/condominio" element={<AdminCondoSettings />} />
              <Route path="/quotas" element={<AdminBudgetsQuotas />} />
              <Route path="/juros" element={<AdminLateFees />} />
              <Route path="/lembretes" element={<AdminReminders />} />
              <Route path="/fornecedores" element={<AdminSuppliers />} />
              <Route path="/manutencao" element={<Maintenance />} />
              <Route path="/ocorrencias" element={<Occurrences />} />
              <Route path="/assembleias" element={<Assemblies />} />
              <Route path="/documentos" element={<Documents />} />
              <Route path="/conta" element={<AccountStatement />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Gate>
      </BrowserRouter>
    </AuthProvider>
  )
}
