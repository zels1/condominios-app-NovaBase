import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('pt-PT') : '—' }

export default function AdminDashboard() {
  const { selectedCondo } = useCondo()
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!selectedCondo) return
    setSummary(null); setError(null)
    api.get(`/condominiums/${selectedCondo.id}/dashboard`).then(setSummary).catch((e) => setError(e.message))
  }, [selectedCondo])

  if (!selectedCondo) return null
  if (error) return <div className="msg error">{error}</div>
  if (!summary) return <div className="empty">A carregar resumo…</div>

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h1>Resumo — {selectedCondo.name}</h1>
          <p style={{ color: 'var(--text-muted)' }}>O estado do condomínio hoje, {new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}.</p>
        </div>
      </div>

      <div className="grid">
        <div className="card stat">
          <span className="label">Dívida total em atraso</span>
          <span className="value" style={{ color: summary.total_overdue_amount > 0 ? 'var(--danger)' : 'inherit' }}>{money(summary.total_overdue_amount)}</span>
          <span className="label">{summary.overdue_quota_count} quota(s) · {summary.fractions_in_debt} fração(ões)</span>
        </div>
        <div className="card stat">
          <span className="label">Cobrado este mês</span>
          <span className="value">{money(summary.this_month_collected)}</span>
          <span className="label">de {money(summary.this_month_expected)} esperado</span>
        </div>
        <div className="card stat">
          <span className="label">Ocorrências pendentes</span>
          <span className="value">{summary.pending_occurrences}</span>
          <Link to="/manutencao" style={{ fontSize: '.85rem' }}>Ver manutenção →</Link>
        </div>
        <div className="card stat">
          <span className="label">Próxima assembleia</span>
          <span className="value" style={{ fontSize: '1.1rem' }}>{summary.upcoming_assembly ? summary.upcoming_assembly.title : 'Nenhuma agendada'}</span>
          <span className="label">{summary.upcoming_assembly ? fmtDate(summary.upcoming_assembly.scheduled_at) : ''}</span>
        </div>
      </div>

      {(summary.documents_expiring_soon.length > 0 || summary.contracts_expiring_soon.length > 0) && (
        <div className="card">
          <h3>A expirar nos próximos 30 dias</h3>
          <div className="stack">
            {summary.documents_expiring_soon.map((d) => (
              <div key={d.id} className="row between"><span>📄 {d.title}</span><span className="badge warn">{fmtDate(d.expires_at)}</span></div>
            ))}
            {summary.contracts_expiring_soon.map((c) => (
              <div key={c.id} className="row between"><span>📋 {c.title}</span><span className="badge warn">{fmtDate(c.end_date)}</span></div>
            ))}
          </div>
        </div>
      )}

      <div className="grid">
        <Link to="/quotas" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h3>💶 Gerar quotas do mês</h3>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Calcula automaticamente a quota de cada fração com base no orçamento.</p>
        </Link>
        <Link to="/juros" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h3>⏰ Aplicar juros de mora</h3>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Corre o motor de juros configurável para as quotas em atraso.</p>
        </Link>
        <Link to="/lembretes" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h3>📣 Enviar lembretes</h3>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Dispara os lembretes automáticos configurados para dívidas em atraso.</p>
        </Link>
      </div>
    </div>
  )
}
