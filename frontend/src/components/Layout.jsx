import { useEffect, useState } from 'react'
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useCondo } from '../lib/CondoContext'
import DomvusLogo from './DomvusLogo'

const ADMIN_LINKS = [
  { to: '/', label: 'Resumo', end: true },
  { to: '/fracoes', label: 'Frações' },
  { to: '/condominos', label: 'Condóminos' },
  { to: '/condominio', label: 'Dados do condomínio' },
  { to: '/quotas', label: 'Orçamento e Quotas' },
  { to: '/conta', label: 'Conta corrente' },
  { to: '/juros', label: 'Juros de mora' },
  { to: '/lembretes', label: 'Lembretes' },
  { to: '/manutencao', label: 'Manutenção' },
  { to: '/fornecedores', label: 'Fornecedores e despesas' },
  { to: '/assembleias', label: 'Assembleias' },
  { to: '/documentos', label: 'Documentos' },
]

const OWNER_LINKS = [
  { to: '/', label: 'As minhas quotas', end: true },
  { to: '/conta', label: 'Conta do prédio' },
  { to: '/manutencao', label: 'Ocorrências' },
  { to: '/assembleias', label: 'Assembleias' },
  { to: '/documentos', label: 'Documentos' },
]

export default function Layout() {
  const { signOut, user } = useAuth()
  const { me, isAdmin, condominiums, selectedId, setSelectedId, loading, error } = useCondo()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  // No telemóvel, o menu fecha-se sozinho ao mudar de página
  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  if (loading) return <div className="empty">A carregar…</div>
  if (error) {
    const disabled = /desativada/i.test(error)
    return (
      <div className="auth-screen">
        <div className="card auth-card" style={{ textAlign: 'center' }}>
          <div className="auth-brand"><DomvusLogo size={30} /></div>
          <h2 style={{ marginTop: 0 }}>{disabled ? 'Acesso desativado' : 'Não foi possível carregar os dados'}</h2>
          <p className="hint" style={{ fontSize: '.95rem' }}>{error}</p>
          <div className="row" style={{ justifyContent: 'center', gap: '.5rem' }}>
            {!disabled && <button className="btn" onClick={() => window.location.reload()}>Tentar outra vez</button>}
            <button className={`btn${disabled ? '' : ' secondary'}`} onClick={signOut}>Terminar sessão</button>
          </div>
        </div>
      </div>
    )
  }

  if (isAdmin && condominiums.length === 0) {
    return <Navigate to="/configurar" replace />
  }

  const links = isAdmin ? ADMIN_LINKS : OWNER_LINKS

  return (
    <div className="app-shell">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="sidebar-top">
          <NavLink to="/" className="brand" aria-label="Domvus — início"><DomvusLogo size={30} /></NavLink>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="main-menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? '✕ Fechar' : '☰ Menu'}
          </button>
        </div>
        {condominiums.length > 0 && (
          <select
            value={selectedId || ''}
            onChange={(e) => setSelectedId(e.target.value)}
            className="condo-select"
            aria-label="Condomínio"
          >
            {condominiums.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <nav id="main-menu">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => isActive ? 'active' : ''}>
              {l.label}
            </NavLink>
          ))}
          {isAdmin && <NavLink to="/configurar">+ Novo condomínio</NavLink>}
        </nav>
        <div className="sidebar-footer">
          <div>{me?.full_name || user?.email}</div>
          <div style={{ textTransform: 'capitalize' }}>{me?.role === 'owner' ? 'Condómino' : 'Administrador'}</div>
          <button className="btn secondary small" style={{ marginTop: '.6rem' }} onClick={signOut}>Terminar sessão</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
