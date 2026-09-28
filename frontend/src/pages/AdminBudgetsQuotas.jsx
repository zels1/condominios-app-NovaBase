import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import { QuotaStatusBadge } from '../components/StatusBadge'
import { useSort, SortTh } from '../components/SortableTable'
import { QuotaTitle, linesText } from '../components/QuotaDetail'
import { ChargeTypesPanel, ExtraQuotaForm, MonthPreview } from './QuotaCharges'
import Modal from '../components/Modal'

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
  const [fractions, setFractions] = useState([])
  const [modal, setModal] = useState(null) // generate | extra | budget
  const [newChargeSignal, setNewChargeSignal] = useState(0)
  const [notice, setNotice] = useState(null)
  const [feeRun, setFeeRun] = useState(null)
  const [feeRunBusy, setFeeRunBusy] = useState(false)
  // filtros da lista
  const [fMonth, setFMonth] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fKind, setFKind] = useState('')
  const [fText, setFText] = useState('')

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
  async function loadQuotas() {
    const list = await api.get(`/condominiums/${selectedCondo.id}/quotas`)
    setQuotas(list)
    // por defeito mostra o mês mais recente com quotas
    setFMonth((m) => (m && list.some((q) => q.reference_month.slice(0, 7) === m) ? m : (list[0]?.reference_month.slice(0, 7) || '')))
  }

  useEffect(() => {
    if (!selectedCondo) return
    setNotice(null); setFMonth(''); setFStatus(''); setFKind(''); setFText('')
    loadBudgets(); loadQuotas()
    api.get(`/condominiums/${selectedCondo.id}/fractions`).then(setFractions).catch(() => {})
  }, [selectedCondo])

  const months = [...new Set(quotas.map((q) => q.reference_month.slice(0, 7)))].sort().reverse()
  const text = fText.trim().toLowerCase()
  const filtered = quotas.filter((q) =>
    (!fMonth || q.reference_month.slice(0, 7) === fMonth)
    && (!fStatus || q.status === fStatus)
    && (!fKind || q.kind === fKind)
    && (!text || [q.fraction_identifier, q.owner_name, q.description].some((v) => (v || '').toLowerCase().includes(text))))
  const qSort = useSort(filtered, QUOTA_COLUMNS, 'fraction', 'asc')
  const bSort = useSort(budgets, BUDGET_COLUMNS, 'year', 'desc')

  // resumo do período filtrado (mês escolhido, ou tudo)
  const inMonth = quotas.filter((q) => !fMonth || q.reference_month.slice(0, 7) === fMonth)
  const issued = inMonth.reduce((s, q) => s + Number(q.base_amount) + Number(q.late_fee_amount || 0), 0)
  const received = inMonth.reduce((s, q) => s + Number(q.amount_paid || 0), 0)
  const openDebt = quotas.filter((q) => q.status === 'overdue' || q.status === 'partially_paid').reduce((s, q) => s + Number(q.total_due || 0), 0)
  const overdueCount = quotas.filter((q) => q.status === 'overdue').length
  const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })

  if (!selectedCondo) return null

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Quotas</h1>
          <p className="subtitle">Rubricas, geração de quotas e cobranças — {selectedCondo.name}</p>
        </div>
        <div className="row" style={{ gap: '.4rem' }}>
          <button className="btn secondary" onClick={() => { setTab('charges'); setNewChargeSignal((n) => n + 1) }}>+ Nova rubrica</button>
          <button className="btn secondary" onClick={() => setModal('extra')}>+ Quota extraordinária</button>
          <button className="btn" onClick={() => setModal('generate')}>⚡ Gerar quotas</button>
        </div>
      </div>

      {notice && <div className={`msg ${notice.type}`}>{notice.text}</div>}

      <div className="stat-grid">
        <div className="card stat">
          <span className="label">Emitido {fMonth ? `em ${monthLabel(fMonth)}` : '(total)'}</span>
          <span className="value">{money(issued)}</span>
          <span className="label">{inMonth.length} quota(s)</span>
        </div>
        <div className="card stat">
          <span className="label">Recebido {fMonth ? 'deste mês' : '(total)'}</span>
          <span className="value">{money(received)}</span>
          <span className="label">{issued > 0 ? `${Math.round((received / issued) * 100)}% do emitido` : '—'}</span>
        </div>
        <div className="card stat">
          <span className="label">Em dívida (todas)</span>
          <span className="value" style={{ color: openDebt > 0 ? 'var(--danger)' : 'inherit' }}>{money(openDebt)}</span>
          <span className="label">{overdueCount} quota(s) em atraso</span>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'quotas'} className={tab === 'quotas' ? 'active' : ''} onClick={() => setTab('quotas')}>Quotas emitidas</button>
        <button role="tab" aria-selected={tab === 'charges'} className={tab === 'charges' ? 'active' : ''} onClick={() => setTab('charges')}>Rubricas</button>
        <button role="tab" aria-selected={tab === 'budgets'} className={tab === 'budgets' ? 'active' : ''} onClick={() => setTab('budgets')}>Orçamentos anuais</button>
      </div>

      {tab === 'charges' && <ChargeTypesPanel condoId={selectedCondo.id} fractions={fractions} newSignal={newChargeSignal} />}

      {tab === 'budgets' && (
        <div className="card">
          <div className="row between" style={{ alignItems: 'center', marginBottom: '.6rem' }}>
            <h3 style={{ margin: 0 }}>Orçamentos anuais</h3>
            <button className="btn secondary small" onClick={() => setModal('budget')}>+ Novo orçamento</button>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>A rubrica "Quota ordinária" usa o orçamento do ano: total ÷ 12, repartido por permilagem.</p>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <SortTh label="Ano" sortKey="year" sort={bSort.sort} onSort={bSort.toggle} />
                <SortTh label="Total anual" sortKey="total" sort={bSort.sort} onSort={bSort.toggle} />
                <SortTh label="Por mês (÷12)" sortKey="monthly" sort={bSort.sort} onSort={bSort.toggle} />
                <SortTh label="Fundo de reserva" sortKey="reserve" sort={bSort.sort} onSort={bSort.toggle} />
              </tr></thead>
              <tbody>
                {bSort.sorted.map((b) => (
                  <tr key={b.id}><td><strong>{b.year}</strong></td><td>{money(b.total_amount)}</td><td>{money(b.total_amount / 12)}</td><td>{b.reserve_fund_percent}%</td></tr>
                ))}
                {budgets.length === 0 && <tr><td colSpan={4} className="empty">Sem orçamentos ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'quotas' && (
        <div className="card">
          <div className="toolbar">
            <div className="field">
              <label htmlFor="q-month">Mês</label>
              <select id="q-month" value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
                <option value="">Todos os meses</option>
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="q-status">Estado</label>
              <select id="q-status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                <option value="">Todos</option>
                <option value="overdue">Em atraso</option>
                <option value="partially_paid">Pagamento parcial</option>
                <option value="pending">Pendente</option>
                <option value="paid">Paga</option>
                <option value="waived">Anulada</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="q-kind">Tipo</label>
              <select id="q-kind" value={fKind} onChange={(e) => setFKind(e.target.value)}>
                <option value="">Todas</option>
                <option value="regular">Mensais</option>
                <option value="extraordinary">Extraordinárias</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="q-text">Procurar</label>
              <input id="q-text" type="search" value={fText} onChange={(e) => setFText(e.target.value)} placeholder="Fração, proprietário…" />
            </div>
            <div className="row" style={{ gap: '.4rem', alignItems: 'center', marginLeft: 'auto' }}>
              <Link to="/juros" className="hint" style={{ margin: 0 }}>Regra de juros</Link>
              <button type="button" className="btn secondary small" disabled={feeRunBusy} onClick={runLateFees}>
                {feeRunBusy ? 'A aplicar…' : 'Aplicar juros em atraso'}
              </button>
            </div>
          </div>
          {feeRun && <div className={`msg ${feeRun.type === 'error' ? 'error' : 'success'}`} style={{ marginBottom: '.6rem' }}>{feeRun.text}</div>}
          <div className="table-wrap">
            <table>
              <thead><tr>
                <SortTh label="Fração" sortKey="fraction" sort={qSort.sort} onSort={qSort.toggle} />
                <SortTh label="Proprietário" sortKey="owner" sort={qSort.sort} onSort={qSort.toggle} />
                <SortTh label="Referente a" sortKey="month" sort={qSort.sort} onSort={qSort.toggle} />
                <SortTh label="Vencimento" sortKey="due" sort={qSort.sort} onSort={qSort.toggle} />
                <SortTh label="Valor" sortKey="base" sort={qSort.sort} onSort={qSort.toggle} />
                <SortTh label="Juro" sortKey="fee" sort={qSort.sort} onSort={qSort.toggle} />
                <SortTh label="Em dívida" sortKey="due_amount" sort={qSort.sort} onSort={qSort.toggle} />
                <SortTh label="Estado" sortKey="status" sort={qSort.sort} onSort={qSort.toggle} />
                <th></th>
              </tr></thead>
              <tbody>
                {qSort.sorted.map((q) => <QuotaRow key={q.id} quota={q} condoId={selectedCondo.id} onChanged={loadQuotas} />)}
                {quotas.length === 0 && <tr><td colSpan={9} className="empty">Ainda não há quotas. Carrega em "⚡ Gerar quotas".</td></tr>}
                {quotas.length > 0 && filtered.length === 0 && <tr><td colSpan={9} className="empty">Nenhuma quota corresponde aos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal === 'generate' && (
        <Modal title="Gerar quotas do mês" wide onClose={() => setModal(null)}>
          <GenerateForm condoId={selectedCondo.id} onCancel={() => setModal(null)}
            onDone={async (text, month) => { setModal(null); setNotice({ type: 'success', text }); setTab('quotas'); await loadQuotas(); setFMonth(month) }} />
        </Modal>
      )}
      {modal === 'extra' && (
        <Modal title="Lançar quota extraordinária" wide onClose={() => setModal(null)}>
          <ExtraQuotaForm condoId={selectedCondo.id} fractions={fractions} onCancel={() => setModal(null)}
            onCreated={async (text) => { setModal(null); setNotice({ type: 'success', text }); setTab('quotas'); setFKind(''); await loadQuotas() }} />
        </Modal>
      )}
      {modal === 'budget' && (
        <Modal title="Novo orçamento anual" onClose={() => setModal(null)}>
          <BudgetForm condoId={selectedCondo.id} onCancel={() => setModal(null)}
            onDone={async (text) => { setModal(null); setNotice({ type: 'success', text }); await loadBudgets() }} />
        </Modal>
      )}
    </div>
  )
}

function GenerateForm({ condoId, onCancel, onDone }) {
  const [month, setMonth] = useState(monthInput(new Date()))
  const [dueDay, setDueDay] = useState(8)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  async function generate(force = false) {
    setMsg(null); setBusy(true)
    try {
      const result = await api.post(`/condominiums/${condoId}/quotas/generate`, { reference_month: `${month}-01`, due_day: parseInt(dueDay), force })
      if (result.skipped_existing) {
        setMsg({ type: 'warn', text: `${result.message} Queres substituí-las?` })
      } else {
        const label = new Date(`${month}-01T00:00:00`).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
        await onDone(`${result.created} quotas de ${label} geradas (total: ${money(result.monthly_total)}).`, month)
        return
      }
    } catch (err) { setMsg({ type: 'error', text: err.message }) }
    setBusy(false)
  }

  return (
    <div className="stack">
      <p className="hint" style={{ margin: 0 }}>Cria a quota mensal de cada fração com as rubricas mensais ativas (separador Rubricas). Confere a pré-visualização antes de gerar.</p>
      <div className="row form-row">
        <div className="field" style={{ width: 180 }}>
          <label htmlFor="gen-month">Mês de referência</label>
          <input id="gen-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="field" style={{ width: 150 }}>
          <label htmlFor="gen-due">Dia de vencimento</label>
          <input id="gen-due" type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
        </div>
      </div>
      <strong style={{ fontSize: '.9rem' }}>Pré-visualização</strong>
      {month && <MonthPreview condoId={condoId} month={month} />}
      {msg && (
        <div className={`msg ${msg.type === 'error' || msg.type === 'warn' ? 'error' : 'success'}`}>
          {msg.text}
          {msg.type === 'warn' && <button className="btn secondary small" style={{ marginLeft: '.6em' }} disabled={busy} onClick={() => generate(true)}>Substituir</button>}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn secondary small" onClick={onCancel}>Cancelar</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => generate(false)}>{busy ? 'A gerar…' : 'Gerar quotas'}</button>
      </div>
    </div>
  )
}

function BudgetForm({ condoId, onCancel, onDone }) {
  const [form, setForm] = useState({ year: new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0), total_amount: '', reserve_fund_percent: 10 })
  const [err, setErr] = useState(null)
  async function submit(e) {
    e.preventDefault()
    setErr(null)
    try {
      await api.post(`/condominiums/${condoId}/budgets`, {
        year: parseInt(form.year), total_amount: parseFloat(form.total_amount), reserve_fund_percent: parseFloat(form.reserve_fund_percent),
      })
      await onDone(`Orçamento de ${form.year} criado (${money(parseFloat(form.total_amount))}).`)
    } catch (e2) { setErr(e2.message) }
  }
  return (
    <form onSubmit={submit} className="stack">
      {err && <div className="msg error">{err}</div>}
      <div className="row form-row">
        <div className="field" style={{ width: 110 }}>
          <label htmlFor="b-year">Ano</label>
          <input id="b-year" type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} required />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="b-total">Total anual das despesas (€)</label>
          <input id="b-total" type="number" step="0.01" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} required />
        </div>
        <div className="field" style={{ width: 170 }}>
          <label htmlFor="b-res">Fundo de reserva (%)</label>
          <input id="b-res" type="number" step="0.1" value={form.reserve_fund_percent} onChange={(e) => setForm({ ...form, reserve_fund_percent: e.target.value })} />
        </div>
      </div>
      <p className="hint" style={{ margin: 0 }}>O total não deve incluir o fundo comum de reserva — esse é cobrado à parte, pela rubrica própria.</p>
      <div className="modal-actions">
        <button type="button" className="btn secondary small" onClick={onCancel}>Cancelar</button>
        <button className="btn small">Criar orçamento</button>
      </div>
    </form>
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
        <td style={{ minWidth: 150 }}><QuotaTitle quota={quota} showLines={false} /></td>
        <td>{new Date(quota.due_date).toLocaleDateString('pt-PT')}</td>
        <td title={linesText(quota) || undefined} style={{ whiteSpace: 'nowrap' }}>
          {money(quota.base_amount)}
          {quota.lines && quota.lines.length > 1 && <div className="hint" style={{ fontSize: '.74rem', margin: 0 }}>{quota.lines.length} rubricas</div>}
        </td>
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
              <button className="btn small" onClick={() => { setShowPay(!showPay); setShowFee(false) }}>+ Pagamento</button>
            )}
            <button className="btn secondary small" title={Number(quota.amount_paid) > 0 ? 'Descarregar recibo (PDF)' : 'Descarregar aviso de cobrança (PDF), com a quota discriminada'}
              onClick={() => api.download(`/condominiums/${condoId}/quotas/${quota.id}/receipt`, Number(quota.amount_paid) > 0 ? 'recibo.pdf' : 'aviso.pdf').catch((e) => alert(e.message))}>
              {Number(quota.amount_paid) > 0 ? 'Recibo' : 'Aviso'}
            </button>
            {Number(quota.amount_paid) === 0 && (
              <button className="btn secondary small" title="Apagar esta quota (lançada por engano)" aria-label="Apagar quota"
                onClick={async () => {
                  if (!window.confirm(`Apagar a quota de ${quota.fraction_identifier} (${quota.kind === 'extraordinary' ? quota.description : new Date(quota.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })})?`)) return
                  try { await api.del(`/condominiums/${condoId}/quotas/${quota.id}`); await onChanged() } catch (e) { alert(e.message) }
                }}>✕</button>
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
