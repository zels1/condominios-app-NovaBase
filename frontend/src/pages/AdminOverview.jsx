import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import { useSort, SortTh } from '../components/SortableTable'

function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }) : '—' }
function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : null }

// Página inicial do administrador: todos os condomínios sob gestão num só quadro,
// com o que pede atenção em cada um. Clicar num condomínio abre o resumo dele.
export default function AdminOverview() {
  const { setSelectedId } = useCondo()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/dashboard/overview').then(setData).catch((e) => setError(e.message))
  }, [])

  const rows = data?.condominiums || []
  const columns = useMemo(() => ({
    name: (r) => r.name,
    fractions: (r) => r.fractions,
    debt: (r) => r.total_overdue_amount,
    collected: (r) => pct(r.this_month_collected, r.this_month_expected),
    occ: (r) => r.open_occurrences,
    maint: (r) => r.maintenance_overdue * 1000 + r.maintenance_due_soon,
    assembly: (r) => r.next_assembly?.scheduled_at || null,
  }), [])
  const { sorted, sort, toggle } = useSort(rows, columns, 'name')

  function open(condoId, path = '/resumo') {
    setSelectedId(condoId)
    navigate(path)
  }

  if (error) return <div className="msg error">{error}</div>
  if (!data) return <div className="empty">A carregar…</div>

  const t = data.totals
  const attention = rows.filter((r) => r.total_overdue_amount > 0 || r.urgent_occurrences > 0 || r.maintenance_overdue > 0 || r.expiring_items > 0)

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h1>Visão geral</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            {t.condominiums} condomínio(s) sob gestão · {t.fractions} frações · {new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <Link to="/configurar" className="btn secondary small" style={{ textDecoration: 'none' }}>+ Novo condomínio</Link>
      </div>

      <div className="grid">
        <div className="card stat">
          <span className="label">Dívida em atraso (total)</span>
          <span className="value" style={{ color: t.total_overdue_amount > 0 ? 'var(--danger)' : 'inherit' }}>{money(t.total_overdue_amount)}</span>
          <span className="label">{rows.filter((r) => r.total_overdue_amount > 0).length} condomínio(s) com dívidas</span>
        </div>
        <div className="card stat">
          <span className="label">Cobrado este mês</span>
          <span className="value">{money(t.this_month_collected)}</span>
          <span className="label">de {money(t.this_month_expected)} esperado</span>
        </div>
        <div className="card stat">
          <span className="label">Ocorrências em aberto</span>
          <span className="value">{t.open_occurrences}</span>
          <span className="label">em todos os condomínios</span>
        </div>
        <div className="card stat">
          <span className="label">Manutenções</span>
          <span className="value" style={{ color: t.maintenance_overdue > 0 ? 'var(--danger)' : 'inherit' }}>{t.maintenance_overdue} em atraso</span>
          <span className="label">{t.maintenance_due_soon} nos próximos 30 dias</span>
        </div>
      </div>

      {attention.length > 0 && (
        <div className="card">
          <h3>Precisa de atenção</h3>
          <div className="stack" style={{ gap: '.5rem' }}>
            {attention.map((r) => (
              <div key={r.id} className="row between" style={{ borderTop: '1px solid var(--border)', paddingTop: '.5rem' }}>
                <button type="button" className="link-button" onClick={() => open(r.id)}><strong>{r.name}</strong></button>
                <div className="row" style={{ gap: '.4rem' }}>
                  {r.total_overdue_amount > 0 && (
                    <button type="button" className="badge danger badge-button" onClick={() => open(r.id, '/quotas')}>
                      {money(r.total_overdue_amount)} em atraso · {r.fractions_in_debt} fração(ões)
                    </button>
                  )}
                  {r.urgent_occurrences > 0 && (
                    <button type="button" className="badge warn badge-button" onClick={() => open(r.id, '/ocorrencias')}>
                      {r.urgent_occurrences} ocorrência(s) urgente(s)
                    </button>
                  )}
                  {r.maintenance_overdue > 0 && (
                    <button type="button" className="badge danger badge-button" onClick={() => open(r.id, '/manutencao')}>
                      {r.maintenance_overdue} manutenção(ões) em atraso
                    </button>
                  )}
                  {r.expiring_items > 0 && (
                    <button type="button" className="badge warn badge-button" onClick={() => open(r.id)}>
                      {r.expiring_items} documento(s)/contrato(s) a expirar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3>Condomínios</h3>
        {rows.length === 0 ? (
          <div className="empty">Ainda não tens condomínios. <Link to="/configurar">Criar o primeiro</Link></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortTh label="Condomínio" sortKey="name" sort={sort} onSort={toggle} />
                  <SortTh label="Frações" sortKey="fractions" sort={sort} onSort={toggle} />
                  <SortTh label="Em atraso" sortKey="debt" sort={sort} onSort={toggle} />
                  <SortTh label="Cobrado no mês" sortKey="collected" sort={sort} onSort={toggle} />
                  <SortTh label="Ocorrências" sortKey="occ" sort={sort} onSort={toggle} />
                  <SortTh label="Manutenção" sortKey="maint" sort={sort} onSort={toggle} />
                  <SortTh label="Próxima assembleia" sortKey="assembly" sort={sort} onSort={toggle} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const p = pct(r.this_month_collected, r.this_month_expected)
                  return (
                    <tr key={r.id} className="clickable-row" onClick={() => open(r.id)} title={`Abrir ${r.name}`}>
                      <td>
                        <strong>{r.name}</strong>
                        <div className="hint" style={{ fontSize: '.8rem' }}>{[r.city, `${r.owners} condómino(s)`].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td>{r.fractions}</td>
                      <td style={{ color: r.total_overdue_amount > 0 ? 'var(--danger)' : undefined, fontWeight: r.total_overdue_amount > 0 ? 650 : undefined }}>
                        {r.total_overdue_amount > 0 ? money(r.total_overdue_amount) : '—'}
                      </td>
                      <td>{r.this_month_expected > 0 ? `${money(r.this_month_collected)} (${p}%)` : '—'}</td>
                      <td>
                        {r.open_occurrences > 0
                          ? <span className={`badge ${r.urgent_occurrences > 0 ? 'warn' : ''}`}>{r.open_occurrences} em aberto</span>
                          : '—'}
                      </td>
                      <td>
                        {r.maintenance_overdue > 0 && <span className="badge danger">{r.maintenance_overdue} em atraso</span>}{' '}
                        {r.maintenance_due_soon > 0 && <span className="badge warn">{r.maintenance_due_soon} em breve</span>}
                        {r.maintenance_overdue === 0 && r.maintenance_due_soon === 0 && '—'}
                      </td>
                      <td>{r.next_assembly ? `${fmtDate(r.next_assembly.scheduled_at)} · ${r.next_assembly.title}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
