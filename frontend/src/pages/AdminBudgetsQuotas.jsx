import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import { QuotaStatusBadge } from '../components/StatusBadge'
import { useSort, SortTh } from '../components/SortableTable'

const STATUS_ORDER = { overdue: 0, partially_paid: 1, pending: 2, paid: 3, waived: 4 }
const QUOTA_COLUMNS = {
  fraction: (q) => q.fraction_identifier,
  owner: (q) => q.owner_name,
  month: (q) => q.reference_month,
  due: (q) => q.due_date,
  base: (q) => Number(q.base_amount),
  fee: (q) => Number(q.late_fee_amount),
  due_amount: (q) => Number(q.total_due),
  status: (q) => STATUS_ORDER[q.status] ?? 9,
}
const BUDGET_COLUMNS = {
  year: (b) => b.year,
  total: (b) => Number(b.total_amount),
  monthly: (b) => Number(b.total_amount) / 12,
  reserve: (b) => Number(b.reserve_fund_percent),
}

function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }
function monthInput(d) { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` }

export default function AdminBudgetsQuotas() {
  const { selectedCondo } = useCondo()
  const [tab, setTab] = useState('quotas')
  const [budgets, setBudgets] = useState([])
  const [quotas, setQuotas] = useState([])
  const [genMonth, setGenMonth] = useState(monthInput(new Date()))
  const [genDueDay, setGenDueDay] = useState(8)
  const [genMsg, setGenMsg] = useState(null)
  const [budgetForm, setBudgetForm] = useState({ year: new Date().getFullYear(), total_amount: '', reserve_fund_percent: 10 })
  const [error, setError] = useState(null)
  const [feeRun, setFeeRun] = useState(null)
  const [feeRunBusy, setFeeRunBusy] = useState(false)

  async function runLateFees() {
    if (!window.confirm('Aplicar juros de mora a todas as quotas em atraso que já passaram o período de tolerância (e ainda não têm juro)?')) return
    setFeeRunBusy(true); setFeeRun(null)
    try {
      const r = await api.post(`/condominiums/${selectedCondo.id}/late-fee-config/run`)
      setFeeRun({ type: r.applied ? 'success' : 'info', text: r.message || (r.applied ? `Juro aplicado a ${r.applied} quota(s).` : 'Nenhuma quota precisava de juro neste momento.') })
      await loadQuotas()
    } catch (err) { setFeeRun({ type: 'error', text: err.message }) }
    setFeeRunBusy(false)
  }

  async function loadBudgets() { setBudgets(await api.get(`/condominiums/${selectedCondo.id}/budgets`)) }
  async function loadQuotas() { setQuotas(await api.get(`/condominiums/${selectedCondo.id}/quotas`)) }

  useEffect(() => { if (selectedCondo) { loadBudgets(); loadQuotas() } }, [selectedCondo])
  const qSort = useSort(quotas, QUOTA_COLUMNS, 'month', 'desc')
  const bSort = useSort(budgets, BUDGET_COLUMNS, 'year', 'desc')

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
                <thead><tr>
                  <SortTh label="Ano" sortKey="year" sort={bSort.sort} onSort={bSort.toggle} />
                  <SortTh label="Total anual" sortKey="total" sort={bSort.sort} onSort={bSort.toggle} />
                  <SortTh label="Mensalidade (÷12)" sortKey="monthly" sort={bSort.sort} onSort={bSort.toggle} />
                  <SortTh label="Fundo de reserva" sortKey="reserve" sort={bSort.sort} onSort={bSort.toggle} />
                </tr></thead>
                <tbody>
                  {bSort.sorted.map((b) => (
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
            <div className="row between" style={{ alignItems: 'center', gap: '.6rem', marginBottom: '.6rem' }}>
              <h3 style={{ margin: 0 }}>Todas as quotas</h3>
              <div className="row" style={{ gap: '.4rem', alignItems: 'center' }}>
                <Link to="/juros" className="hint" style={{ margin: 0 }}>Regra de juros</Link>
                <button type="button" className="btn secondary small" disabled={feeRunBusy} onClick={runLateFees}>
                  {feeRunBusy ? 'A aplicar…' : 'Aplicar juros às quotas em atraso'}
                </button>
              </div>
            </div>
            {feeRun && <div className={`msg ${feeRun.type === 'error' ? 'error' : 'success'}`} style={{ marginBottom: '.6rem' }}>{feeRun.text}</div>}
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <SortTh label="Fração" sortKey="fraction" sort={qSort.sort} onSort={qSort.toggle} />
                  <SortTh label="Proprietário" sortKey="owner" sort={qSort.sort} onSort={qSort.toggle} />
                  <SortTh label="Mês" sortKey="month" sort={qSort.sort} onSort={qSort.toggle} />
                  <SortTh label="Vencimento" sortKey="due" sort={qSort.sort} onSort={qSort.toggle} />
                  <SortTh label="Base" sortKey="base" sort={qSort.sort} onSort={qSort.toggle} />
                  <SortTh label="Juro" sortKey="fee" sort={qSort.sort} onSort={qSort.toggle} />
                  <SortTh label="Em dívida" sortKey="due_amount" sort={qSort.sort} onSort={qSort.toggle} />
                  <SortTh label="Estado" sortKey="status" sort={qSort.sort} onSort={qSort.toggle} />
                  <th></th>
                </tr></thead>
                <tbody>
                  {qSort.sorted.map((q) => <QuotaRow key={q.id} quota={q} condoId={selectedCondo.id} onChanged={loadQuotas} />)}
                  {quotas.length === 0 && <tr><td colSpan={9} className="empty">Ainda não há quotas geradas.</td></tr>}
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
  const [showFee, setShowFee] = useState(false)
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
        <td>
          <button type="button" className={`fee-cell${showFee ? ' open' : ''}`} onClick={() => { setShowFee(!showFee); setShowPay(false) }}
            aria-expanded={showFee} title="Ver e gerir o juro de mora desta quota">
            {Number(quota.late_fee_amount) > 0 ? money(quota.late_fee_amount) : quota.late_fee_waived ? 'perdoado' : '—'}
            <span aria-hidden="true" className="fee-edit">✎</span>
          </button>
        </td>
        <td><strong>{money(quota.total_due)}</strong></td>
        <td><QuotaStatusBadge status={quota.status} /></td>
        <td>
          <div className="row" style={{ gap: '.3rem', flexWrap: 'nowrap' }}>
            {quota.status !== 'paid' && quota.status !== 'waived' && (
              <button className="btn small" onClick={() => { setShowPay(!showPay); setShowFee(false) }}>Registar pagamento</button>
            )}
            {Number(quota.amount_paid) > 0 && (
              <button className="btn secondary small" title="Descarregar recibo (PDF)"
                onClick={() => api.download(`/condominiums/${condoId}/quotas/${quota.id}/receipt`, 'recibo.pdf').catch((e) => alert(e.message))}>
                Recibo
              </button>
            )}
          </div>
        </td>
      </tr>
      {showFee && (
        <tr>
          <td colSpan={9} style={{ background: 'var(--bg)' }}>
            <LateFeePanel quota={quota} condoId={condoId} onChanged={onChanged} onClose={() => setShowFee(false)} />
          </td>
        </tr>
      )}
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

function LateFeePanel({ quota, condoId, onChanged, onClose }) {
  const base = `/condominiums/${condoId}/late-fee-config/quotas/${quota.id}`
  const [info, setInfo] = useState(null)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    api.get(base).then((i) => { setInfo(i); setManual(String(i.late_fee_amount || '')) }).catch((e) => setErr(e.message))
  }, [quota.id, quota.late_fee_amount])

  async function act(fn, okText) {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const i = await fn()
      setInfo(i); setManual(String(i.late_fee_amount || ''))
      setMsg(okText(i))
      await onChanged()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const apply = () => act(() => api.post(`${base}/apply`), (i) => `Juro de ${money(i.late_fee_amount)} aplicado.`)
  const waive = () => window.confirm('Perdoar o juro desta quota?') && act(() => api.post(`${base}/waive`), () => 'Juro perdoado.')
  const setValue = (e) => {
    e.preventDefault()
    const amount = parseFloat(String(manual).replace(',', '.'))
    if (Number.isNaN(amount) || amount < 0) { setErr('Indica um valor válido (0 ou mais).'); return }
    act(() => api.put(base, { amount }), (i) => (i.late_fee_amount > 0 ? `Juro definido em ${money(i.late_fee_amount)}.` : 'Juro retirado.'))
  }

  if (!info) return <div className="fee-panel">{err ? <div className="msg error">{err}</div> : <span className="hint">A carregar…</span>}</div>
  const notDue = info.days_overdue <= 0

  return (
    <div className="fee-panel">
      <div className="row between" style={{ alignItems: 'baseline', gap: '.6rem' }}>
        <strong>Juro de mora — {quota.fraction_identifier}, {new Date(quota.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })}</strong>
        <button type="button" className="btn secondary small" onClick={onClose}>Fechar</button>
      </div>
      <div className="fee-facts">
        <span>Juro atual: <strong>{info.late_fee_amount > 0 ? money(info.late_fee_amount) : info.late_fee_waived ? 'perdoado' : 'sem juro'}</strong></span>
        <span>Atraso: <strong>{notDue ? 'ainda não venceu' : `${info.days_overdue} dia(s)`}</strong>
          {info.grace_period_days != null && !notDue && <> (tolerância {info.grace_period_days} dias{info.within_grace ? ' — ainda dentro' : ''})</>}</span>
        <span>Regra: {info.rule}</span>
        {!notDue && info.suggested_fee > 0 && <span>Pela regra, hoje: <strong>{money(info.suggested_fee)}</strong></span>}
      </div>
      {err && <div className="msg error">{err}</div>}
      {msg && <div className="msg success">{msg}</div>}
      <div className="row" style={{ gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="btn small" disabled={busy || notDue || !(info.suggested_fee > 0)} onClick={apply}>
          Aplicar juro calculado{info.suggested_fee > 0 && !notDue ? ` (${money(info.suggested_fee)})` : ''}
        </button>
        <form onSubmit={setValue} className="row" style={{ gap: '.4rem', alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 130, margin: 0 }}>
            <label htmlFor={`fee-${quota.id}`}>Definir valor (€)</label>
            <input id={`fee-${quota.id}`} type="number" step="0.01" min="0" value={manual} onChange={(e) => setManual(e.target.value)} />
          </div>
          <button className="btn secondary small" disabled={busy}>Guardar valor</button>
        </form>
        {info.late_fee_amount > 0 && <button type="button" className="btn secondary small" disabled={busy} onClick={waive}>Perdoar juro</button>}
      </div>
    </div>
  )
}
