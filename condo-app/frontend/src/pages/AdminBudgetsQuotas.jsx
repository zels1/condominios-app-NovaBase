import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import { QuotaStatusBadge } from '../components/StatusBadge'

function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }
function monthInput(d) { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` }

export default function AdminBudgetsQuotas() {
  const { selectedCondo } = useCondo()
  const [tab, setTab] = useState('quotas')
  const [budgets, setBudgets] = useState([])
  const [quotas, setQuotas] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [genMonth, setGenMonth] = useState(monthInput(new Date()))
  const [genDueDay, setGenDueDay] = useState(8)
  const [genMsg, setGenMsg] = useState(null)
  const [budgetForm, setBudgetForm] = useState({ year: new Date().getFullYear(), total_amount: '', reserve_fund_percent: 10 })
  const [error, setError] = useState(null)

  async function loadBudgets() { setBudgets(await api.get(`/condominiums/${selectedCondo.id}/budgets`)) }
  async function loadQuotas() { setQuotas(await api.get(`/condominiums/${selectedCondo.id}/quotas`, { status: statusFilter || undefined })) }

  useEffect(() => { if (selectedCondo) { loadBudgets(); loadQuotas() } }, [selectedCondo])
  useEffect(() => { if (selectedCondo) loadQuotas() }, [statusFilter])

  async function handleCreateBudget(e) {
    e.preventDefault()
    setError(null)
    try {
      await api.post(`/condominiums/${selectedCondo.id}/budgets`, {
        year: parseInt(budgetForm.year), total_amount: parseFloat(budgetForm.total_amount), reserve_fund_percent: parseFloat(budgetForm.reserve_fund_percent),
      })
      setBudgetForm({ year: new Date().getFullYear(), total_amount: '', reserve_fund_percent: 10 })
      loadBudgets()
    } catch (err) { setError(err.message) }
  }

  async function handleGenerate(force = false) {
    setGenMsg(null)
    try {
      const [year, month] = genMonth.split('-')
      const reference_month = `${year}-${month}-01`
      const result = await api.post(`/condominiums/${selectedCondo.id}/quotas/generate`, { reference_month, due_day: parseInt(genDueDay), force })
      if (result.skipped_existing) {
        setGenMsg({ type: 'warn', text: `${result.message} Queres substituir?`, showForce: true })
      } else {
        setGenMsg({ type: 'success', text: `${result.created} quotas geradas (total mensal: ${money(result.monthly_total)}).` })
        loadQuotas()
      }
    } catch (err) { setGenMsg({ type: 'error', text: err.message }) }
  }

  if (!selectedCondo) return null

  return (
    <div className="stack">
      <h1>Orçamento e Quotas</h1>
      <div className="tabs">
        <button className={tab === 'quotas' ? 'active' : ''} onClick={() => setTab('quotas')}>Quotas</button>
        <button className={tab === 'budgets' ? 'active' : ''} onClick={() => setTab('budgets')}>Orçamentos anuais</button>
      </div>

      {tab === 'budgets' && (
        <div className="stack">
          <div className="card">
            <h3>Novo orçamento anual</h3>
            {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
            <form onSubmit={handleCreateBudget} className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ width: 110 }}>
                <label>Ano</label>
                <input type="number" value={budgetForm.year} onChange={(e) => setBudgetForm({ ...budgetForm, year: e.target.value })} required />
              </div>
              <div className="field" style={{ width: 160 }}>
                <label>Valor total anual (€)</label>
                <input type="number" step="0.01" value={budgetForm.total_amount} onChange={(e) => setBudgetForm({ ...budgetForm, total_amount: e.target.value })} required />
              </div>
              <div className="field" style={{ width: 160 }}>
                <label>Fundo de reserva (%)</label>
                <input type="number" step="0.1" value={budgetForm.reserve_fund_percent} onChange={(e) => setBudgetForm({ ...budgetForm, reserve_fund_percent: e.target.value })} />
              </div>
              <button className="btn" style={{ marginBottom: '.9em' }}>Criar</button>
            </form>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Ano</th><th>Total anual</th><th>Mensalidade (÷12)</th><th>Fundo de reserva</th></tr></thead>
                <tbody>
                  {budgets.map((b) => (
                    <tr key={b.id}><td>{b.year}</td><td>{money(b.total_amount)}</td><td>{money(b.total_amount / 12)}</td><td>{b.reserve_fund_percent}%</td></tr>
                  ))}
                  {budgets.length === 0 && <tr><td colSpan={4} className="empty">Sem orçamentos ainda.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'quotas' && (
        <div className="stack">
          <div className="card">
            <h3>Gerar quotas do mês</h3>
            <p style={{ color: 'var(--text-muted)' }}>Divide o orçamento anual por 12 e reparte por cada fração de acordo com a sua permilagem.</p>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ width: 160 }}>
                <label>Mês de referência</label>
                <input type="month" value={genMonth} onChange={(e) => setGenMonth(e.target.value)} />
              </div>
              <div className="field" style={{ width: 120 }}>
                <label>Dia de vencimento</label>
                <input type="number" min={1} max={28} value={genDueDay} onChange={(e) => setGenDueDay(e.target.value)} />
              </div>
              <button className="btn" style={{ marginBottom: '.9em' }} onClick={() => handleGenerate(false)}>Gerar quotas</button>
            </div>
            {genMsg && (
              <div className={`msg ${genMsg.type === 'error' ? 'error' : genMsg.type === 'warn' ? 'error' : 'success'}`} style={{ marginTop: '.6em' }}>
                {genMsg.text}
                {genMsg.showForce && <button className="btn secondary small" style={{ marginLeft: '.6em' }} onClick={() => handleGenerate(true)}>Substituir</button>}
              </div>
            )}
          </div>

          <div className="card">
            <div className="row between" style={{ marginBottom: '.8em' }}>
              <h3 style={{ margin: 0 }}>Todas as quotas</h3>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: '.4em', borderRadius: 8, border: '1px solid var(--border)' }}>
                <option value="">Todos os estados</option>
                <option value="pending">Pendente</option>
                <option value="overdue">Em atraso</option>
                <option value="partially_paid">Pagamento parcial</option>
                <option value="paid">Paga</option>
                <option value="waived">Perdoada</option>
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Fração</th><th>Proprietário</th><th>Mês</th><th>Vencimento</th><th>Base</th><th>Juro</th><th>Em dívida</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {quotas.map((q) => <QuotaRow key={q.id} quota={q} condoId={selectedCondo.id} onChanged={loadQuotas} />)}
                  {quotas.length === 0 && <tr><td colSpan={9} className="empty">Sem quotas para este filtro.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function QuotaRow({ quota, condoId, onChanged }) {
  const [showPay, setShowPay] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('transferência')
  const [busy, setBusy] = useState(false)

  async function registerPayment(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post(`/condominiums/${condoId}/quotas/${quota.id}/payments`, { amount: parseFloat(amount), method })
      setShowPay(false); setAmount('')
      onChanged()
    } finally { setBusy(false) }
  }

  return (
    <>
      <tr>
        <td>{quota.fraction_identifier}</td>
        <td>{quota.owner_name || '—'}</td>
        <td>{new Date(quota.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })}</td>
        <td>{new Date(quota.due_date).toLocaleDateString('pt-PT')}</td>
        <td>{money(quota.base_amount)}</td>
        <td>{quota.late_fee_amount > 0 ? money(quota.late_fee_amount) : '—'}</td>
        <td><strong>{money(quota.total_due)}</strong></td>
        <td><QuotaStatusBadge status={quota.status} /></td>
        <td>
          {quota.status !== 'paid' && quota.status !== 'waived' && (
            <button className="btn small" onClick={() => setShowPay(!showPay)}>Registar pagamento</button>
          )}
        </td>
      </tr>
      {showPay && (
        <tr>
          <td colSpan={9} style={{ background: 'var(--bg)' }}>
            <form onSubmit={registerPayment} className="row" style={{ padding: '.6rem 0', alignItems: 'flex-end' }}>
              <div className="field" style={{ width: 140 }}>
                <label>Valor (€)</label>
                <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
              </div>
              <div className="field" style={{ width: 180 }}>
                <label>Método</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option>transferência</option>
                  <option>multibanco</option>
                  <option>mbway</option>
                  <option>numerário</option>
                </select>
              </div>
              <button className="btn small" disabled={busy}>{busy ? 'A guardar…' : 'Confirmar'}</button>
            </form>
          </td>
        </tr>
      )}
    </>
  )
}
