import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import { QuotaStatusBadge } from '../components/StatusBadge'

function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }

export default function OwnerHome() {
  const { selectedCondo } = useCondo()
  const [quotas, setQuotas] = useState([])

  useEffect(() => {
    if (!selectedCondo) return
    api.get(`/condominiums/${selectedCondo.id}/quotas`).then(setQuotas)
  }, [selectedCondo])

  if (!selectedCondo) {
    return <div className="empty">Ainda não estás associado a nenhuma fração. Fala com a administração do condomínio.</div>
  }

  const totalDue = quotas.filter((q) => q.status !== 'paid' && q.status !== 'waived').reduce((s, q) => s + q.total_due, 0)

  return (
    <div className="stack">
      <h1>As minhas quotas — {selectedCondo.name}</h1>

      <div className="card stat">
        <span className="label">Total em dívida</span>
        <span className="value" style={{ color: totalDue > 0 ? 'var(--danger)' : 'var(--primary)' }}>{money(totalDue)}</span>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Fração</th><th>Mês</th><th>Vencimento</th><th>Base</th><th>Juro</th><th>Total</th><th>Estado</th></tr></thead>
            <tbody>
              {quotas.map((q) => (
                <tr key={q.id}>
                  <td>{q.fraction_identifier}</td>
                  <td>{new Date(q.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })}</td>
                  <td>{new Date(q.due_date).toLocaleDateString('pt-PT')}</td>
                  <td>{money(q.base_amount)}</td>
                  <td>{q.late_fee_amount > 0 ? money(q.late_fee_amount) : '—'}</td>
                  <td><strong>{money(q.total_due)}</strong></td>
                  <td><QuotaStatusBadge status={q.status} /></td>
                </tr>
              ))}
              {quotas.length === 0 && <tr><td colSpan={7} className="empty">Ainda não tens quotas geradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint">Para regularizar um pagamento, contacta a administração do condomínio — o registo do pagamento fica aqui atualizado assim que for confirmado.</p>
    </div>
  )
}
