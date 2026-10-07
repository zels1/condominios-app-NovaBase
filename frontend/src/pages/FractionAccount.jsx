import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { QuotaStatusBadge } from '../components/StatusBadge'
import { QuotaTitle } from '../components/QuotaDetail'

// Conta de uma fração (todas as cobranças, quem paga e o que está em dívida), faturas avulsas
// e a lista de todas as faturas de um condómino.

function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('pt-PT') : '—' }
function pct(share) { return `${(Number(share || 0) * 100).toLocaleString('pt-PT', { maximumFractionDigits: 2 })}%` }
function ownerLabel(o) { return o.user?.full_name || o.invited_email || 'Proprietário' }
const isOpen = (q) => q.status !== 'paid' && q.status !== 'waived'
const debtOf = (q) => (isOpen(q) ? Math.max(Number(q.total_due || 0), 0) : 0)

function downloadDoc(condoId, q) {
  const paid = Number(q.amount_paid) > 0
  return api.download(`/condominiums/${condoId}/quotas/${q.id}/receipt`, paid ? 'recibo.pdf' : 'aviso.pdf').catch((e) => alert(e.message))
}

// ---------- Fatura avulsa ----------
export function InvoiceForm({ condoId, fractions, fractionId: fixedFraction, onCancel, onDone }) {
  const today = new Date()
  const inTwoWeeks = new Date(today.getTime() + 14 * 86400000).toISOString().slice(0, 10)
  const [fractionId, setFractionId] = useState(fixedFraction || '')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState(inTwoWeeks)
  const [responsible, setResponsible] = useState('')
  const [owners, setOwners] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const fraction = fractions.find((f) => f.id === fractionId)

  useEffect(() => {
    setOwners([]); setResponsible('')
    if (!fractionId) return
    api.get(`/condominiums/${condoId}/fractions/${fractionId}/owners`).then(setOwners).catch(() => {})
  }, [fractionId])

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    const value = parseFloat(String(amount).replace(',', '.'))
    if (!fractionId) { setErr('Escolhe a fração.'); return }
    if (Number.isNaN(value) || value <= 0) { setErr('Indica um valor maior que zero.'); return }
    setBusy(true)
    try {
      const r = await api.post(`/condominiums/${condoId}/quotas/invoice`, {
        fraction_id: fractionId, description: description.trim(), amount: value, due_date: dueDate,
        responsible: responsible || null,
      })
      const who = r.quotas.map((q) => `${q.owner_name || 'fração'} ${money(q.base_amount)}`).join(' · ')
      await onDone(`Fatura de ${money(value)} emitida à fração ${fraction?.identifier}${r.created > 1 ? ` (repartida: ${who})` : ''}.`, r)
    } catch (e2) { setErr(e2.message); setBusy(false) }
  }

  const several = owners.length > 1
  const defaultLabel = !several ? '' : fraction?.billing_mode === 'single'
    ? 'Como está definido na fração (um só responsável)'
    : 'Como está definido na fração (repartir pelos proprietários)'

  return (
    <form onSubmit={submit} className="stack">
      {err && <div className="msg error">{err}</div>}
      <div className="row form-row">
        <div className="field" style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="inv-fraction">Fração</label>
          <select id="inv-fraction" value={fractionId} onChange={(e) => setFractionId(e.target.value)} required disabled={!!fixedFraction}>
            <option value="">Escolher…</option>
            {fractions.map((f) => <option key={f.id} value={f.id}>{f.identifier}</option>)}
          </select>
        </div>
        <div className="field" style={{ width: 150 }}>
          <label htmlFor="inv-amount">Valor (€)</label>
          <input id="inv-amount" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="field" style={{ width: 170 }}>
          <label htmlFor="inv-due">Vencimento</label>
          <input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </div>
      </div>
      <div className="field">
        <label htmlFor="inv-desc">Descrição</label>
        <input id="inv-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} required
          placeholder="Ex: Reparação da porta da garagem, 2.ª via do comando…" />
      </div>
      {several && (
        <div className="field">
          <label htmlFor="inv-resp">Quem paga</label>
          <select id="inv-resp" value={responsible} onChange={(e) => setResponsible(e.target.value)}>
            <option value="">{defaultLabel}</option>
            <option value="split">Repartir pelos proprietários ({owners.map((o) => `${ownerLabel(o)} ${pct(o.ownership_share)}`).join(', ')})</option>
            {owners.map((o) => <option key={o.id} value={o.id}>Só {ownerLabel(o)}</option>)}
          </select>
        </div>
      )}
      {fractionId && owners.length === 1 && <p className="hint" style={{ margin: 0 }}>Em nome de {ownerLabel(owners[0])}.</p>}
      <p className="hint" style={{ margin: 0 }}>Fica na lista de quotas como "fatura", com aviso de cobrança em PDF; depois de paga, o PDF passa a recibo.</p>
      <div className="modal-actions">
        <button type="button" className="btn secondary small" onClick={onCancel}>Cancelar</button>
        <button className="btn small" disabled={busy}>{busy ? 'A emitir…' : 'Emitir fatura'}</button>
      </div>
    </form>
  )
}

// ---------- Separador "Por fração" ----------
export function FractionsTab({ fractions, quotas, onOpen }) {
  const [text, setText] = useState('')
  const rows = fractions.map((f) => {
    const qs = quotas.filter((q) => q.fraction_id === f.id)
    const names = [...new Set(qs.slice(0, 12).map((q) => q.owner_name).filter(Boolean))]
    return {
      f,
      names,
      issued: qs.filter((q) => q.status !== 'waived').reduce((s, q) => s + Number(q.base_amount) + Number(q.late_fee_amount || 0), 0),
      paid: qs.reduce((s, q) => s + Number(q.amount_paid || 0), 0),
      debt: qs.reduce((s, q) => s + debtOf(q), 0),
      overdue: qs.filter((q) => q.status === 'overdue').length,
    }
  }).filter((r) => !text.trim() || [r.f.identifier, ...r.names].some((v) => (v || '').toLowerCase().includes(text.trim().toLowerCase())))

  return (
    <div className="card">
      <div className="toolbar">
        <div className="field" style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="fr-text">Procurar</label>
          <input id="fr-text" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Fração, proprietário…" />
        </div>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>Abre uma fração para ver todas as quotas, quem pagou, o que falta pagar e emitir faturas.</p>
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Fração</th><th>Proprietário(s)</th><th style={{ textAlign: 'right' }}>Emitido</th>
            <th style={{ textAlign: 'right' }}>Pago</th><th style={{ textAlign: 'right' }}>Por pagar</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map(({ f, names, issued, paid, debt, overdue }) => (
              <tr key={f.id}>
                <td><button type="button" className="link-button" onClick={() => onOpen(f.id)}><strong>{f.identifier}</strong></button></td>
                <td>{names.join(', ') || '—'}</td>
                <td className="num">{money(issued)}</td>
                <td className="num"><span className={paid > 0 ? 'income-value' : undefined}>{money(paid)}</span></td>
                <td className="num" style={{ color: debt > 0 ? 'var(--danger)' : undefined }}>
                  {money(debt)}{overdue > 0 && <div className="hint" style={{ fontSize: '.74rem', margin: 0 }}>{overdue} em atraso</div>}
                </td>
                <td style={{ textAlign: 'right' }}><button className="btn secondary small" onClick={() => onOpen(f.id)}>Abrir</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="empty">Nenhuma fração encontrada.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------- Conta de uma fração ----------
export function FractionAccount({ condoId, fraction, onChanged, onInvoice, refreshKey = 0 }) {
  const [owners, setOwners] = useState([])
  const [quotas, setQuotas] = useState(null)
  const [mode, setMode] = useState(fraction.billing_mode || 'split')
  const [respId, setRespId] = useState(fraction.billing_owner_link_id || '')
  const [filter, setFilter] = useState('all') // all | open | paid
  const [paying, setPaying] = useState(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('transferência')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const base = `/condominiums/${condoId}`

  async function load() {
    const [o, q] = await Promise.all([
      api.get(`${base}/fractions/${fraction.id}/owners`),
      api.get(`${base}/quotas`, { fraction_id: fraction.id, include_payments: true }),
    ])
    setOwners(o); setQuotas(q)
  }
  useEffect(() => { load().catch((e) => setErr(e.message)) }, [fraction.id, refreshKey])

  async function saveBilling(nextMode, nextResp) {
    setErr(null); setMsg(null)
    setMode(nextMode); setRespId(nextResp)
    try {
      await api.put(`${base}/fractions/${fraction.id}/billing`, { billing_mode: nextMode, billing_owner_link_id: nextMode === 'single' ? (nextResp || null) : null })
      setMsg(nextMode === 'single'
        ? 'Guardado: as próximas cobranças desta fração vão para um só responsável.'
        : 'Guardado: as próximas cobranças desta fração são repartidas pelos proprietários.')
      await onChanged()
    } catch (e) { setErr(e.message) }
  }

  async function pay(e, q) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.post(`${base}/quotas/${q.id}/payments`, { amount: parseFloat(String(payAmount).replace(',', '.')), method: payMethod })
      setPaying(null); setPayAmount('')
      await load(); await onChanged()
    } catch (e2) { setErr(e2.message) }
    setBusy(false)
  }

  async function remove(q) {
    if (!window.confirm('Apagar esta cobrança (lançada por engano)?')) return
    try { await api.del(`${base}/quotas/${q.id}`); await load(); await onChanged() } catch (e) { setErr(e.message) }
  }

  if (!quotas) return err ? <div className="msg error">{err}</div> : <p className="hint">A carregar…</p>

  const issued = quotas.filter((q) => q.status !== 'waived').reduce((s, q) => s + Number(q.base_amount) + Number(q.late_fee_amount || 0), 0)
  const paid = quotas.reduce((s, q) => s + Number(q.amount_paid || 0), 0)
  const debt = quotas.reduce((s, q) => s + debtOf(q), 0)
  const shown = quotas.filter((q) => filter === 'all' || (filter === 'open' ? isOpen(q) : q.status === 'paid'))
  const several = owners.length > 1
  // dívida por responsável (útil quando as cobranças são repartidas)
  const byOwner = {}
  quotas.forEach((q) => { const k = q.owner_link_id || '—'; byOwner[k] = byOwner[k] || { paid: 0, debt: 0 }; byOwner[k].paid += Number(q.amount_paid || 0); byOwner[k].debt += debtOf(q) })

  return (
    <div className="stack">
      {err && <div className="msg error">{err}</div>}
      {msg && <div className="msg success">{msg}</div>}

      <div className="stat-grid">
        <div className="card stat"><span className="label">Emitido</span><span className="value">{money(issued)}</span><span className="label">{quotas.length} cobrança(s)</span></div>
        <div className="card stat"><span className="label">Pago</span><span className="value income-value">{money(paid)}</span></div>
        <div className="card stat"><span className="label">Por pagar</span><span className="value" style={{ color: debt > 0 ? 'var(--danger)' : 'inherit' }}>{money(debt)}</span></div>
      </div>

      <div>
        <strong style={{ fontSize: '.9rem' }}>Proprietário(s)</strong>
        {owners.length === 0 && <p className="hint" style={{ margin: '.2rem 0 0' }}>Esta fração ainda não tem proprietário associado.</p>}
        <div className="owner-chips">
          {owners.map((o) => {
            const t = byOwner[o.id]
            return (
              <span key={o.id} className="owner-chip">
                <strong>{ownerLabel(o)}</strong>{several && <> · {pct(o.ownership_share)}</>}
                {t && <span className="hint" style={{ margin: 0 }}> — pago {money(t.paid)}{t.debt > 0 ? <>, <span style={{ color: 'var(--danger)' }}>por pagar {money(t.debt)}</span></> : ''}</span>}
              </span>
            )
          })}
        </div>
        {several && (
          <div className="billing-choice" role="radiogroup" aria-label="Quem paga as cobranças desta fração">
            <label className="remember" style={{ margin: 0 }}>
              <input type="radio" name="billing" checked={mode === 'split'} onChange={() => saveBilling('split', '')} />
              Repartir as cobranças pelos proprietários, cada um a sua parte
            </label>
            <label className="remember" style={{ margin: 0, flexWrap: 'wrap' }}>
              <input type="radio" name="billing" checked={mode === 'single'} onChange={() => saveBilling('single', respId || owners.find((o) => o.is_primary_contact)?.id || owners[0].id)} />
              Um só responsável paga tudo:
              <select value={respId} disabled={mode !== 'single'} onChange={(e) => saveBilling('single', e.target.value)} aria-label="Responsável pelo pagamento" style={{ marginLeft: '.4rem', width: 'auto' }}>
                {mode !== 'single' && <option value="">—</option>}
                {owners.map((o) => <option key={o.id} value={o.id}>{ownerLabel(o)}</option>)}
              </select>
            </label>
            <span className="hint" style={{ margin: 0 }}>Aplica-se às próximas cobranças. Para refazer as de um mês já gerado, usa "⚡ Gerar quotas" → "Atualizar valores".</span>
          </div>
        )}
      </div>

      <div className="row between" style={{ alignItems: 'center', gap: '.5rem' }}>
        <div className="choice-group" role="group" aria-label="Filtrar cobranças">
          {[['all', 'Todas'], ['open', 'Por pagar'], ['paid', 'Pagas']].map(([k, l]) => (
            <button key={k} type="button" className={`btn secondary small${filter === k ? ' selected' : ''}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <button className="btn small" onClick={onInvoice}>+ Emitir fatura</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Referente a</th><th>Responsável</th><th>Vencimento</th><th style={{ textAlign: 'right' }}>Valor</th>
            <th style={{ textAlign: 'right' }}>Pago</th><th style={{ textAlign: 'right' }}>Por pagar</th><th>Estado</th><th></th>
          </tr></thead>
          <tbody>
            {shown.map((q) => (
              <FractionQuotaRow key={q.id} q={q} condoId={condoId} busy={busy}
                paying={paying === q.id} payAmount={payAmount} payMethod={payMethod}
                setPayAmount={setPayAmount} setPayMethod={setPayMethod}
                onTogglePay={() => { setPaying(paying === q.id ? null : q.id); setPayAmount(String(debtOf(q).toFixed(2))) }}
                onPay={(e) => pay(e, q)} onRemove={() => remove(q)} />
            ))}
            {shown.length === 0 && <tr><td colSpan={8} className="empty">{quotas.length === 0 ? 'Esta fração ainda não tem cobranças.' : 'Nenhuma cobrança neste filtro.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FractionQuotaRow({ q, condoId, busy, paying, payAmount, payMethod, setPayAmount, setPayMethod, onTogglePay, onPay, onRemove }) {
  const total = Number(q.base_amount) + Number(q.late_fee_amount || 0)
  const hasPaid = Number(q.amount_paid) > 0
  return (
    <>
      <tr>
        <td style={{ minWidth: 150 }}>
          <QuotaTitle quota={q} showLines={false} />
          {(q.payments || []).map((p) => (
            <div key={p.id} className="hint" style={{ fontSize: '.76rem', margin: 0 }}>
              Pago em {fmtDate(p.paid_at)}: {money(p.amount)} · {p.method}{p.reference ? ` · ref. ${p.reference}` : ''}
            </div>
          ))}
        </td>
        <td>{q.owner_name || '—'}</td>
        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(q.due_date)}</td>
        <td className="num">{money(total)}{Number(q.late_fee_amount) > 0 && <div className="hint" style={{ fontSize: '.74rem', margin: 0 }}>inclui juro {money(q.late_fee_amount)}</div>}</td>
        <td className="num"><span className={hasPaid ? 'income-value' : undefined}>{money(q.amount_paid)}</span></td>
        <td className="num" style={{ color: debtOf(q) > 0 ? 'var(--danger)' : undefined }}>{money(debtOf(q))}</td>
        <td><QuotaStatusBadge status={q.status} /></td>
        <td>
          <div className="row" style={{ gap: '.3rem', flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
            {isOpen(q) && <button className="btn small" onClick={onTogglePay}>+ Pagamento</button>}
            <button className="btn secondary small" onClick={() => downloadDoc(condoId, q)}
              title={hasPaid ? 'Descarregar recibo (PDF)' : 'Descarregar aviso de cobrança (PDF)'}>{hasPaid ? 'Recibo' : 'Aviso'}</button>
            {!hasPaid && <button className="btn secondary small" onClick={onRemove} aria-label="Apagar cobrança" title="Apagar esta cobrança">✕</button>}
          </div>
        </td>
      </tr>
      {paying && (
        <tr>
          <td colSpan={8} style={{ background: 'var(--bg)' }}>
            <form onSubmit={onPay} className="row" style={{ padding: '.5rem 0', alignItems: 'flex-end' }}>
              <div className="field" style={{ width: 140 }}>
                <label>Valor (€)</label>
                <input type="number" step="0.01" min="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required autoFocus />
              </div>
              <div className="field" style={{ width: 180 }}>
                <label>Método</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option>transferência</option><option>multibanco</option><option>mbway</option><option>numerário</option>
                </select>
              </div>
              <button className="btn small" disabled={busy}>{busy ? 'A guardar…' : `Registar pagamento${q.owner_name ? ` de ${q.owner_name}` : ''}`}</button>
            </form>
          </td>
        </tr>
      )}
    </>
  )
}

// ---------- Todas as faturas de um condómino ----------
export function OwnerInvoices({ condoId, owner }) {
  const [quotas, setQuotas] = useState(null)
  const [err, setErr] = useState(null)
  const [filter, setFilter] = useState('all')
  useEffect(() => {
    api.get(`/condominiums/${condoId}/quotas`, { owner_user_id: owner.id }).then(setQuotas).catch((e) => setErr(e.message))
  }, [owner.id])
  if (err) return <div className="msg error">{err}</div>
  if (!quotas) return <p className="hint">A carregar…</p>
  const issued = quotas.filter((q) => q.status !== 'waived').reduce((s, q) => s + Number(q.base_amount) + Number(q.late_fee_amount || 0), 0)
  const paid = quotas.reduce((s, q) => s + Number(q.amount_paid || 0), 0)
  const debt = quotas.reduce((s, q) => s + debtOf(q), 0)
  const shown = quotas.filter((q) => filter === 'all' || (filter === 'open' ? isOpen(q) : q.status === 'paid'))
  return (
    <div className="stack">
      <div className="stat-grid">
        <div className="card stat"><span className="label">Emitido</span><span className="value">{money(issued)}</span><span className="label">{quotas.length} documento(s)</span></div>
        <div className="card stat"><span className="label">Pago</span><span className="value income-value">{money(paid)}</span></div>
        <div className="card stat"><span className="label">Por pagar</span><span className="value" style={{ color: debt > 0 ? 'var(--danger)' : 'inherit' }}>{money(debt)}</span></div>
      </div>
      <div className="choice-group" role="group" aria-label="Filtrar">
        {[['all', 'Todas'], ['open', 'Por pagar'], ['paid', 'Pagas']].map(([k, l]) => (
          <button key={k} type="button" className={`btn secondary small${filter === k ? ' selected' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Fração</th><th>Referente a</th><th>Vencimento</th><th style={{ textAlign: 'right' }}>Valor</th>
            <th style={{ textAlign: 'right' }}>Por pagar</th><th>Estado</th><th></th>
          </tr></thead>
          <tbody>
            {shown.map((q) => (
              <tr key={q.id}>
                <td>{q.fraction_identifier}</td>
                <td style={{ minWidth: 150 }}><QuotaTitle quota={q} showLines={false} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(q.due_date)}</td>
                <td className="num">{money(Number(q.base_amount) + Number(q.late_fee_amount || 0))}</td>
                <td className="num" style={{ color: debtOf(q) > 0 ? 'var(--danger)' : undefined }}>{money(debtOf(q))}</td>
                <td><QuotaStatusBadge status={q.status} /></td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn secondary small" onClick={() => downloadDoc(condoId, q)}>{Number(q.amount_paid) > 0 ? 'Recibo' : 'Aviso'} (PDF)</button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={7} className="empty">{quotas.length === 0 ? 'Este condómino ainda não tem faturas.' : 'Nenhuma fatura neste filtro.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
