import { NavLink, Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useCondo } from '../lib/CondoContext'

const ADMIN_LINKS = [
  { to: '/', label: 'Resumo', end: true },
  { to: '/fracoes', label: 'Frações' },
  { to: '/quotas', label: 'Orçamento e Quotas' },
  { to: '/juros', label: 'Juros de mora' },
  { to: '/lembretes', label: 'Lembretes' },
  { to: '/manutencao', label: 'Manutenção' },
  { to: '/fornecedores', label: 'Fornecedores e despesas' },
  { to: '/assembleias', label: 'Assembleias' },
  { to: '/documentos', label: 'Documentos' },
]

const OWNER_LINKS = [
  { to: '/', label: 'As minhas quotas', end: true },
  { to: '/manutencao', label: 'Ocorrências' },
  { to: '/assembleias', label: 'Assembleias' },
  { to: '/documentos', label: 'Documentos' },
]

export default function Layout() {
  const { signOut, user } = useAuth()
  const { me, isAdmin, condominiums, selectedId, setSelectedId, loading, error } = useCondo()

  if (loading) return <div className="empty">A carregar…</div>
  if (error) return <div className="empty msg error">Erro a carregar dados: {error}</div>

  if (isAdmin && condominiums.length === 0) {
    return <Navigate to="/configurar" replace />
  }

  const links = isAdmin ? ADMIN_LINKS : OWNER_LINKS

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">🏢 Condomínios</div>
        {condominiums.length > 0 && (
          <select
            value={selectedId || ''}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{ marginBottom: '1rem', padding: '.5em', borderRadius: 8, border: '1px solid var(--border)' }}
          >
            {condominiums.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <nav>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => isActive ? 'active' : ''}>
              {l.label}
            </NavLink>
          ))}
          {isAdmin && <NavLink to="/configurar">+ Novo condomínio</NavLink>}
        </nav>
        <div style={{ marginTop: 'auto', paddingTop: '1rem', fontSize: '.8rem', color: 'var(--text-muted)' }}>
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
