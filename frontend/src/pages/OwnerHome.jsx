import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import { QuotaStatusBadge } from '../components/StatusBadge'
import ExpenseChart from '../components/ExpenseChart'
import { useSort, SortTh } from '../components/SortableTable'
import { Link } from 'react-router-dom'

const STATUS_ORDER = { overdue: 0, partially_paid: 1, pending: 2, paid: 3, waived: 4 }
const COLUMNS = {
  fraction: (q) => q.fraction_identifier,
  month: (q) => q.reference_month,
  due: (q) => q.due_date,
  base: (q) => Number(q.base_amount),
  fee: (q) => Number(q.late_fee_amount),
  total: (q) => Number(q.total_due),
  status: (q) => STATUS_ORDER[q.status] ?? 9,
}

function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }

export default function OwnerHome() {
  const { selectedCondo } = useCondo()
  const [quotas, setQuotas] = useState([])
  const [expenses, setExpenses] = useState([])
  const [downloading, setDownloading] = useState(null)
  const [error, setError] = useState(null)
  const { sorted, sort, toggle } = useSort(quotas, COLUMNS, 'month', 'desc')

  async function downloadReceipt(q) {
    setDownloading(q.id); setError(null)
    try {
      await api.download(`/condominiums/${selectedCondo.id}/quotas/${q.id}/receipt`, 'recibo.pdf')
    } catch (err) { setError(err.message) }
    setDownloading(null)
  }

  useEffect(() => {
    if (!selectedCondo) return
    api.get(`/condominiums/${selectedCondo.id}/quotas`).then(setQuotas)
    api.get(`/condominiums/${selectedCondo.id}/expenses`).then(setExpenses)
  }, [selectedCondo])

  if (!selectedCondo) {
    return <div className="empty">Ainda não estás associado a nenhuma fração. Fala com a administração do condomínio.</div>
  }

  // Data de hoje no formato AAAA-MM-DD (hora local), para comparar com due_date
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const open = quotas.filter((q) => q.status !== 'paid' && q.status !== 'waived' && q.total_due > 0)
  // Em dívida = só o que já venceu; o que vence mais tarde aparece como "próximo pagamento"
  const overdue = open.filter((q) => q.due_date < today)
  const totalDue = overdue.reduce((s, q) => s + q.total_due, 0)
  const upcoming = open.filter((q) => q.due_date >= today).sort((a, b) => a.due_date.localeCompare(b.due_date))
  const nextDate = upcoming[0]?.due_date
  const nextAmount = upcoming.filter((q) => q.due_date === nextDate).reduce((s, q) => s + q.total_due, 0)

  return (
    <div className="stack">
      <h1>As minhas quotas — {selectedCondo.name}</h1>

      <div className="grid">
        <div className="card stat">
          <span className="label">Em dívida (já vencido)</span>
          <span className="value" style={{ color: totalDue > 0 ? 'var(--danger)' : 'var(--primary)' }}>{money(totalDue)}</span>
          <span className="hint" style={{ margin: 0 }}>
            {totalDue > 0 ? `${overdue.length} quota(s) por regularizar` : 'Tudo em dia 👍'}
          </span>
        </div>
        <div className="card stat">
          <span className="label">Próximo pagamento</span>
          <span className="value">{nextDate ? money(nextAmount) : '—'}</span>
          <span className="hint" style={{ margin: 0 }}>
            {nextDate ? `até ${new Date(nextDate).toLocaleDateString('pt-PT')}` : 'Sem quotas por vencer'}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <h3 style={{ margin: 0 }}>Para onde vai o meu dinheiro</h3>
          <Link to="/conta">Ver a conta corrente do prédio →</Link>
        </div>
        <ExpenseChart expenses={expenses} />
      </div>

      <div className="card">
        <h3>As minhas quotas</h3>
        {error && <div className="msg error" style={{ marginBottom: '.8em' }}>{error}</div>}
        <div className="table-wrap">
          <table>
            <thead><tr>
              <SortTh label="Fração" sortKey="fraction" sort={sort} onSort={toggle} />
              <SortTh label="Mês" sortKey="month" sort={sort} onSort={toggle} />
              <SortTh label="Vencimento" sortKey="due" sort={sort} onSort={toggle} />
              <SortTh label="Base" sortKey="base" sort={sort} onSort={toggle} />
              <SortTh label="Juro" sortKey="fee" sort={sort} onSort={toggle} />
              <SortTh label="Por pagar" sortKey="total" sort={sort} onSort={toggle} />
              <SortTh label="Estado" sortKey="status" sort={sort} onSort={toggle} />
              <th><span className="visually-hidden">Recibo</span></th>
            </tr></thead>
            <tbody>
              {sorted.map((q) => (
                <tr key={q.id}>
                  <td>{q.fraction_identifier}</td>
                  <td>{new Date(q.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })}</td>
                  <td>{new Date(q.due_date).toLocaleDateString('pt-PT')}</td>
                  <td>{money(q.base_amount)}</td>
                  <td>{q.late_fee_amount > 0 ? money(q.late_fee_amount) : '—'}</td>
                  <td><strong>{money(q.total_due)}</strong></td>
                  <td><QuotaStatusBadge status={q.status} /></td>
                  <td>
                    {Number(q.amount_paid) > 0 && (
                      <button type="button" className="btn secondary small" disabled={downloading === q.id}
                        onClick={() => downloadReceipt(q)} aria-label={`Descarregar recibo de ${new Date(q.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })}`}>
                        {downloading === q.id ? 'A gerar…' : '⬇ Recibo'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {quotas.length === 0 && <tr><td colSpan={8} className="empty">Ainda não tens quotas geradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint">Para regularizar um pagamento, contacta a administração do condomínio — o registo do pagamento fica aqui atualizado assim que for confirmado.</p>
    </div>
  )
}
