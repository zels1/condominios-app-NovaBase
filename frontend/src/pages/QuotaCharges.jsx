import { Fragment, useEffect, useState } from 'react'
import { api } from '../lib/api'
import Modal from '../components/Modal'

// Quotas / rubricas de cobrança: quota ordinária, fundo comum de reserva, quotas
// extraordinárias e outras — com frequência (única vez, mensal, trimestral, semestral,
// anual) e forma de cálculo (permilagem, partes iguais, valor fixo, manual por condómino…).

export const CATEGORY_LABELS = {
  ordinaria: 'Quota ordinária',
  fundo_reserva: 'Fundo comum de reserva',
  extraordinaria: 'Quota extraordinária',
  outra: 'Outra',
}
export const FREQUENCY_LABELS = {
  unica: 'Única vez',
  mensal: 'Mensal',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
}
const PERIOD_WORD = { mensal: 'mês', trimestral: 'trimestre', semestral: 'semestre', anual: 'ano', unica: 'vez' }
const METHOD_LABELS = {
  permilagem: 'Por permilagem (valor total repartido)',
  igual: 'Por fração, em partes iguais',
  fixo: 'Valor fixo por fração',
  manual: 'Manual — valor definido para cada condómino',
  percentagem: '% da quota ordinária',
  orcamento: 'Orçamento anual (÷ 12, por permilagem)',
}

function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }
function num(v) { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isNaN(n) ? null : n }
function thisMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export function frequencyOf(ct) { return ct.recurring ? (ct.frequency || 'mensal') : 'unica' }

export function describeCharge(ct) {
  const v = Number(ct.value || 0)
  const per = ct.recurring ? `/${PERIOD_WORD[ct.frequency || 'mensal']}` : ''
  switch (ct.method) {
    case 'orcamento': return 'Orçamento anual ÷ 12, repartido por permilagem'
    case 'percentagem': return `${v.toLocaleString('pt-PT')}% da quota ordinária de cada fração`
    case 'permilagem': return `${money(v)}${per} repartidos por permilagem`
    case 'igual': return `${money(v)}${per} repartidos em partes iguais`
    case 'fixo': return `${money(v)}${per} por fração`
    case 'manual': return `Valor definido para cada condómino${per}`
    default: return ct.method
  }
}

// Formulário único para criar ou editar uma quota/rubrica. Se for "Única vez", é lançada logo.
export function QuotaRuleForm({ condoId, fractions, rule, overrides = [], onCancel, onSaved }) {
  const base = `/condominiums/${condoId}/charge-types`
  const editing = !!rule?.id
  const [form, setForm] = useState(() => ({
    name: rule?.name || '',
    category: rule?.category || 'outra',
    frequency: rule ? frequencyOf(rule) : 'mensal',
    method: rule?.method || 'permilagem',
    value: rule?.value != null && rule?.method !== 'manual' ? String(rule.value) : '',
    start_month: rule?.start_month ? rule.start_month.slice(0, 7) : thisMonth(),
    active: rule?.active ?? true,
    // única vez
    launch: !editing,
    month: thisMonth(),
    due_date: '',
    all: true,
    fraction_ids: [],
  }))
  const [manual, setManual] = useState(() => {
    const m = {}
    overrides.filter((o) => o.mode === 'valor').forEach((o) => { m[o.fraction_id] = String(o.amount ?? '') })
    return m
  })
  const [fillAll, setFillAll] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const once = form.frequency === 'unica'
  const methods = Object.keys(METHOD_LABELS).filter((k) => {
    if (once && (k === 'percentagem' || k === 'orcamento')) return false
    if (k === 'orcamento' && form.category !== 'ordinaria' && form.method !== 'orcamento') return false
    return true
  })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const manualTotal = fractions.reduce((t, f) => t + (num(manual[f.id]) || 0), 0)
  const period = PERIOD_WORD[form.frequency]

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    if (form.method === 'manual' && manualTotal <= 0) { setErr('Indica o valor de pelo menos um condómino.'); return }
    if (once && form.launch && !form.all && form.fraction_ids.length === 0) { setErr('Escolhe pelo menos uma fração.'); return }
    const body = {
      name: form.name.trim(),
      category: form.category,
      method: form.method,
      value: form.method === 'manual' || form.method === 'orcamento' ? 0 : (num(form.value) ?? 0),
      recurring: !once,
      frequency: once ? 'mensal' : form.frequency,
      start_month: !once && form.frequency !== 'mensal' ? `${form.start_month}-01` : null,
      active: form.active,
      manual_amounts: form.method === 'manual'
        ? Object.fromEntries(fractions.map((f) => [f.id, num(manual[f.id]) || 0]))
        : undefined,
    }
    setBusy(true)
    try {
      const ct = editing ? await api.put(`${base}/${rule.id}`, body) : await api.post(base, body)
      let text = editing ? `"${body.name}" atualizada.` : `"${body.name}" criada.`
      let launched = false
      if (once && form.launch) {
        const r = await api.post(`${base}/extra-quota`, {
          charge_type_id: ct.id, name: body.name, total_amount: body.value || 0,
          method: form.method, reference_month: `${form.month}-01`, due_date: form.due_date,
          fraction_ids: form.all ? null : form.fraction_ids,
        })
        text = `"${body.name}": ${r.created} quota(s) lançada(s), no total de ${money(r.total)}.`
        launched = true
      } else if (!once) {
        text += ` Entra nas quotas geradas ${form.frequency === 'mensal' ? 'todos os meses' : `de ${form.frequency === 'trimestral' ? '3 em 3' : form.frequency === 'semestral' ? '6 em 6' : '12 em 12'} meses`}.`
        text += ' Para a incluir num mês que já tem quotas geradas, usa "⚡ Gerar quotas" e depois "Atualizar valores".'
      }
      await onSaved(text, launched)
    } catch (e2) { setErr(e2.message); setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="stack">
      {err && <div className="msg error">{err}</div>}
      <div className="row form-row">
        <div className="field" style={{ flex: 2, minWidth: 200 }}>
          <label htmlFor="qr-name">Nome *</label>
          <input id="qr-name" value={form.name} onChange={set('name')} required placeholder="Ex: Quota extraordinária — obras, Seguro, Elevador" />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 170 }}>
          <label htmlFor="qr-cat">Tipo</label>
          <select id="qr-cat" value={form.category} onChange={(e) => {
            const category = e.target.value
            setForm({
              ...form, category,
              frequency: category === 'extraordinaria' && !editing ? 'unica' : form.frequency,
              method: category === 'fundo_reserva' ? 'percentagem' : (form.method === 'orcamento' && category !== 'ordinaria' ? 'permilagem' : form.method),
              value: category === 'fundo_reserva' && !form.value ? '10' : form.value,
            })
          }}>
            {Object.entries(CATEGORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="row form-row">
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="qr-freq">Frequência</label>
          <select id="qr-freq" value={form.frequency} onChange={(e) => {
            const frequency = e.target.value
            setForm({ ...form, frequency, method: frequency === 'unica' && ['percentagem', 'orcamento'].includes(form.method) ? 'permilagem' : form.method })
          }}>
            {Object.entries(FREQUENCY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 2, minWidth: 220 }}>
          <label htmlFor="qr-method">Cálculo</label>
          <select id="qr-method" value={form.method} onChange={set('method')}>
            {methods.map((k) => <option key={k} value={k}>{METHOD_LABELS[k]}</option>)}
          </select>
        </div>
      </div>

      {['permilagem', 'igual', 'fixo', 'percentagem'].includes(form.method) && (
        <div className="row form-row">
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="qr-value">
              {form.method === 'percentagem' ? 'Percentagem (%)'
                : form.method === 'fixo' ? `Valor por fração (€) por ${period}`
                  : `Valor total a repartir (€) por ${period}`}
            </label>
            <input id="qr-value" type="number" min="0" step="0.01" value={form.value} onChange={set('value')} required />
          </div>
          <p className="hint" style={{ flex: 2, minWidth: 200, margin: '1.6rem 0 0' }}>
            {form.method === 'permilagem' && 'Cada fração paga a sua parte de acordo com a permilagem.'}
            {form.method === 'igual' && `Dividido pelas ${fractions.length} frações em partes iguais.`}
            {form.method === 'fixo' && 'Todas as frações pagam este valor.'}
            {form.method === 'percentagem' && 'Calculado sobre a quota ordinária de cada fração (ex: fundo comum de reserva, mínimo 10%).'}
          </p>
        </div>
      )}
      {form.method === 'orcamento' && <p className="hint" style={{ margin: 0 }}>Usa o orçamento anual do ano (separador Orçamentos): total ÷ 12, repartido por permilagem.</p>}

      {form.method === 'manual' && (
        <div className="stack" style={{ gap: '.2rem' }}>
          <div className="row between" style={{ alignItems: 'flex-end' }}>
            <strong style={{ fontSize: '.9rem' }}>Valor de cada condómino (€ por {period})</strong>
            <div className="row" style={{ gap: '.3rem', alignItems: 'center' }}>
              <input type="number" min="0" step="0.01" placeholder="Valor" value={fillAll} onChange={(e) => setFillAll(e.target.value)} style={{ width: 100 }} aria-label="Valor para todas as frações" className="small-input" />
              <button type="button" className="btn secondary small" onClick={() => setManual(Object.fromEntries(fractions.map((f) => [f.id, fillAll])))}>Aplicar a todas</button>
            </div>
          </div>
          <span className="hint">Deixa vazio (ou 0) nas frações que não pagam.</span>
          <div className="manual-grid">
            {fractions.map((f) => (
              <label key={f.id} className="manual-cell">
                <span><strong>{f.identifier}</strong> <span className="hint">{Number(f.permilagem).toLocaleString('pt-PT')}‰</span></span>
                <input type="number" min="0" step="0.01" value={manual[f.id] ?? ''} placeholder="0,00"
                  onChange={(e) => setManual({ ...manual, [f.id]: e.target.value })} aria-label={`Valor da fração ${f.identifier}`} />
              </label>
            ))}
          </div>
          <span className="hint">Total por {period}: <strong>{money(manualTotal)}</strong></span>
        </div>
      )}

      {!once && form.frequency !== 'mensal' && (
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="qr-start">Primeiro mês de cobrança</label>
          <input id="qr-start" type="month" value={form.start_month} onChange={set('start_month')} required />
          <span className="hint">Depois repete de {form.frequency === 'trimestral' ? '3 em 3' : form.frequency === 'semestral' ? '6 em 6' : '12 em 12'} meses.</span>
        </div>
      )}

      {once && (
        <div className="stack assign-box" style={{ maxWidth: 'none', gap: '.4rem' }}>
          {editing && (
            <label className="remember" style={{ margin: 0 }}>
              <input type="checkbox" checked={form.launch} onChange={set('launch')} /> Lançar esta quota agora
            </label>
          )}
          {form.launch && (<>
            <div className="row form-row">
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label htmlFor="qr-month">Mês de referência</label>
                <input id="qr-month" type="month" value={form.month} onChange={set('month')} required />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label htmlFor="qr-due">Vencimento</label>
                <input id="qr-due" type="date" value={form.due_date} onChange={set('due_date')} required />
              </div>
            </div>
            <label className="remember" style={{ margin: 0 }}>
              <input type="checkbox" checked={form.all} onChange={set('all')} /> Todas as frações
            </label>
            {!form.all && (
              <div className="row" style={{ gap: '.3rem .9rem' }}>
                {fractions.map((f) => (
                  <label key={f.id} className="remember" style={{ margin: 0 }}>
                    <input type="checkbox" checked={form.fraction_ids.includes(f.id)}
                      onChange={(e) => setForm({ ...form, fraction_ids: e.target.checked ? [...form.fraction_ids, f.id] : form.fraction_ids.filter((x) => x !== f.id) })} />
                    {f.identifier}
                  </label>
                ))}
              </div>
            )}
          </>)}
        </div>
      )}
      {!once && <p className="hint" style={{ margin: 0 }}>Entra automaticamente nas quotas geradas ({FREQUENCY_LABELS[form.frequency].toLowerCase()}) e aparece discriminada no aviso e no recibo.</p>}

      {editing && (
        <label className="remember" style={{ margin: 0 }}>
          <input type="checkbox" checked={form.active} onChange={set('active')} /> Ativa
        </label>
      )}
      <div className="modal-actions">
        <button type="button" className="btn secondary small" onClick={onCancel}>Cancelar</button>
        <button className="btn small" disabled={busy}>
          {busy ? 'A guardar…' : once && form.launch ? (editing ? 'Guardar e lançar' : 'Criar e lançar') : (editing ? 'Guardar' : 'Criar')}
        </button>
      </div>
    </form>
  )
}

export function ChargeTypesPanel({ condoId, fractions, newSignal = 0, onLaunched }) {
  const base = `/condominiums/${condoId}/charge-types`
  const [types, setTypes] = useState(null)
  const [overrides, setOverrides] = useState([])
  const [editing, setEditing] = useState(null) // null | {} (nova) | rubrica
  const [openFor, setOpenFor] = useState(null)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  async function load() {
    const [t, o] = await Promise.all([api.get(base), api.get(`${base}/overrides`)])
    setTypes(t); setOverrides(o)
  }
  useEffect(() => { load().catch((e) => setErr(e.message)) }, [condoId])
  useEffect(() => { if (newSignal) { setEditing({}); setMsg(null); setErr(null) } }, [newSignal])

  async function remove(ct) {
    if (!window.confirm(`Apagar "${ct.name}"? Se já tiver sido usada em quotas, fica apenas desativada.`)) return
    setErr(null); setMsg(null)
    try {
      const r = await api.del(`${base}/${ct.id}`)
      setMsg(r.deactivated ? `"${ct.name}" já foi usada em quotas: ficou desativada.` : `"${ct.name}" apagada.`)
      await load()
    } catch (e) { setErr(e.message) }
  }

  if (!types) return err ? <div className="msg error">{err}</div> : <div className="empty">A carregar…</div>
  const countFor = (ctId) => overrides.filter((o) => o.charge_type_id === ctId).length

  return (
    <div className="card">
      <div className="row between" style={{ alignItems: 'center', gap: '.6rem' }}>
        <h3 style={{ margin: 0 }}>Quotas e rubricas</h3>
        <button className="btn secondary small" onClick={() => { setEditing({}); setMsg(null); setErr(null) }}>+ Nova quota</button>
      </div>
      <p className="hint">
        As recorrentes (mensal, trimestral, semestral, anual) entram nas quotas geradas e aparecem discriminadas no aviso e no recibo.
        As de <strong>única vez</strong> (ex: quota extraordinária para obras) são lançadas logo ao criar.
        Em cada uma podes isentar frações ou dar-lhes um valor próprio.
      </p>
      {msg && <div className="msg success" style={{ marginBottom: '.6rem' }}>{msg}</div>}
      {err && <div className="msg error" style={{ marginBottom: '.6rem' }}>{err}</div>}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Quota / rubrica</th><th>Cálculo</th><th>Frequência</th><th>Por fração</th><th /></tr></thead>
          <tbody>
            {types.map((ct) => (
              <Fragment key={ct.id}>
                <tr style={ct.active ? undefined : { opacity: .55 }}>
                  <td>
                    <strong>{ct.name}</strong>
                    {(CATEGORY_LABELS[ct.category] !== ct.name || !ct.active) && (
                      <div className="hint" style={{ fontSize: '.78rem' }}>{[CATEGORY_LABELS[ct.category] !== ct.name && (CATEGORY_LABELS[ct.category] || ct.category), !ct.active && 'desativada'].filter(Boolean).join(' · ')}</div>
                    )}
                  </td>
                  <td>{describeCharge(ct)}</td>
                  <td><span className={`badge ${ct.recurring ? 'ok' : 'warn'}`}>{FREQUENCY_LABELS[frequencyOf(ct)]}</span></td>
                  <td>
                    <button type="button" className="link-button small" onClick={() => setOpenFor(openFor === ct.id ? null : ct.id)} aria-expanded={openFor === ct.id}>
                      {ct.method === 'manual' ? `${countFor(ct.id)} com valor` : countFor(ct.id) ? `${countFor(ct.id)} com configuração própria` : 'Todas iguais'} · ver
                    </button>
                  </td>
                  <td>
                    <div className="row" style={{ gap: '.3rem', flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                      <button className="btn secondary small" onClick={() => { setEditing(ct); setMsg(null); setErr(null) }}>Editar</button>
                      <button className="btn secondary small" onClick={() => remove(ct)}>Apagar</button>
                    </div>
                  </td>
                </tr>
                {openFor === ct.id && (
                  <tr><td colSpan={5} style={{ background: 'var(--bg)' }}>
                    <FractionOverrides base={base} ct={ct} fractions={fractions} overrides={overrides.filter((o) => o.charge_type_id === ct.id)} onChanged={load} />
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing.id ? `Editar — ${editing.name}` : 'Nova quota'} wide onClose={() => setEditing(null)}>
          <QuotaRuleForm condoId={condoId} fractions={fractions} rule={editing.id ? editing : null}
            overrides={editing.id ? overrides.filter((o) => o.charge_type_id === editing.id) : []}
            onCancel={() => setEditing(null)}
            onSaved={async (text, launched) => {
              setEditing(null); setMsg(text); await load()
              if (launched && onLaunched) await onLaunched(text)
            }} />
        </Modal>
      )}
    </div>
  )
}

function FractionOverrides({ base, ct, fractions, overrides, onChanged }) {
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const byFraction = Object.fromEntries(overrides.map((o) => [o.fraction_id, o]))

  async function apply(f, mode, amount) {
    setErr(null); setBusy(f.id)
    try {
      await api.put(`${base}/${ct.id}/overrides/${f.id}`, { mode, amount: mode === 'valor' ? num(amount) : null })
      setDrafts((d) => { const n = { ...d }; delete n[f.id]; return n })
      await onChanged()
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  return (
    <div className="stack" style={{ gap: '.2rem' }}>
      <strong style={{ fontSize: '.9rem' }}>Configuração de "{ct.name}" por fração</strong>
      <span className="hint">Isenta: não paga esta rubrica (a parte dela é repartida pelas outras). Valor próprio: paga este valor em vez do calculado.</span>
      {err && <div className="msg error">{err}</div>}
      {fractions.map((f) => {
        const o = byFraction[f.id]
        const mode = drafts[f.id]?.mode ?? (o ? o.mode : 'normal')
        const amount = drafts[f.id]?.amount ?? (o?.amount ?? '')
        return (
          <div key={f.id} className="vote-row">
            <div className="who"><strong>{f.identifier}</strong> <span className="hint">· {Number(f.permilagem).toLocaleString('pt-PT')}‰</span></div>
            <div className="row" style={{ gap: '.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <div className="choice-group" role="group" aria-label={`Configuração da fração ${f.identifier}`}>
                {[['normal', 'Normal'], ['isento', 'Isenta'], ['valor', 'Valor próprio']].map(([k, l]) => (
                  <button key={k} type="button" disabled={busy === f.id}
                    className={`btn secondary small${mode === k ? ' selected' : ''}${k === 'isento' ? ' neutral' : ''}`}
                    aria-pressed={mode === k}
                    onClick={() => (k === 'valor' ? setDrafts((d) => ({ ...d, [f.id]: { mode: 'valor', amount } })) : apply(f, k))}>
                    {l}
                  </button>
                ))}
              </div>
              {mode === 'valor' && (
                <form className="row" style={{ gap: '.3rem', flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); apply(f, 'valor', amount) }}>
                  <input type="number" min="0" step="0.01" required value={amount} style={{ width: 110 }} aria-label={`Valor da fração ${f.identifier}`}
                    onChange={(e) => setDrafts((d) => ({ ...d, [f.id]: { mode: 'valor', amount: e.target.value } }))} />
                  <span className="hint">€{ct.recurring ? '/mês' : ''}</span>
                  <button className="btn small" disabled={busy === f.id}>Guardar</button>
                </form>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function MonthPreview({ condoId, month }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    setData(null); setErr(null)
    api.get(`/condominiums/${condoId}/charge-types/preview?month=${month}-01`).then(setData).catch((e) => setErr(e.message))
  }, [condoId, month])
  if (err) return <div className="msg error">{err}</div>
  if (!data) return <span className="hint">A calcular…</span>
  const names = []
  data.fractions.forEach((f) => f.lines.forEach((l) => { if (!names.includes(l.name)) names.push(l.name) }))
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Fração</th>{names.map((n) => <th key={n}>{n}</th>)}<th>Total</th></tr></thead>
        <tbody>
          {data.fractions.map((f) => (
            <tr key={f.fraction_id}>
              <td><strong>{f.identifier}</strong> <span className="hint">· {f.permilagem.toLocaleString('pt-PT')}‰</span></td>
              {names.map((n) => {
                const l = f.lines.find((x) => x.name === n)
                return <td key={n}>{l ? money(l.amount) : <span className="hint">isenta</span>}</td>
              })}
              <td><strong>{money(f.total)}</strong></td>
            </tr>
          ))}
          <tr><td colSpan={names.length + 1} className="hint">Total do mês</td><td><strong>{money(data.total)}</strong></td></tr>
        </tbody>
      </table>
    </div>
  )
}

