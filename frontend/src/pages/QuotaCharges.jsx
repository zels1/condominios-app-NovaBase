import { Fragment, useEffect, useState } from 'react'
import { api } from '../lib/api'

// Rubricas das quotas: quota ordinária, fundo comum de reserva, quotas extraordinárias e
// outras rubricas configuráveis — para todas as frações e, se preciso, fração a fração.

export const CATEGORY_LABELS = {
  ordinaria: 'Quota ordinária',
  fundo_reserva: 'Fundo comum de reserva',
  extraordinaria: 'Quota extraordinária',
  outra: 'Outra',
}
const METHOD_LABELS = {
  orcamento: 'Orçamento anual ÷ 12, por permilagem',
  percentagem: '% da quota ordinária',
  permilagem: 'Valor repartido por permilagem',
  igual: 'Valor repartido em partes iguais',
  fixo: 'Valor fixo por fração',
}
const EMPTY = { name: '', category: 'outra', method: 'permilagem', value: '', recurring: true, active: true }

function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }
function num(v) { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isNaN(n) ? null : n }

export function describeCharge(ct) {
  const v = Number(ct.value || 0)
  switch (ct.method) {
    case 'orcamento': return 'Orçamento anual ÷ 12, repartido por permilagem'
    case 'percentagem': return `${v.toLocaleString('pt-PT')}% da quota ordinária de cada fração`
    case 'permilagem': return `${money(v)}${ct.recurring ? '/mês' : ''} repartidos por permilagem`
    case 'igual': return `${money(v)}${ct.recurring ? '/mês' : ''} repartidos em partes iguais`
    case 'fixo': return `${money(v)}${ct.recurring ? '/mês' : ''} por fração`
    default: return ct.method
  }
}

export function ChargeTypesPanel({ condoId, fractions }) {
  const base = `/condominiums/${condoId}/charge-types`
  const [types, setTypes] = useState(null)
  const [overrides, setOverrides] = useState([])
  const [form, setForm] = useState(null)
  const [openFor, setOpenFor] = useState(null)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  async function load() {
    const [t, o] = await Promise.all([api.get(base), api.get(`${base}/overrides`)])
    setTypes(t); setOverrides(o)
  }
  useEffect(() => { load().catch((e) => setErr(e.message)) }, [condoId])

  async function save(e) {
    e.preventDefault()
    setErr(null); setMsg(null)
    const body = { ...form, name: form.name.trim(), value: num(form.value) ?? 0 }
    delete body.id
    try {
      if (form.id) await api.put(`${base}/${form.id}`, body)
      else await api.post(base, body)
      setMsg(form.id ? `Rubrica "${body.name}" atualizada.` : `Rubrica "${body.name}" criada.`)
      setForm(null)
      await load()
    } catch (e2) { setErr(e2.message) }
  }

  async function remove(ct) {
    if (!window.confirm(`Apagar a rubrica "${ct.name}"? Se já tiver sido usada em quotas, fica apenas desativada.`)) return
    setErr(null); setMsg(null)
    try {
      const r = await api.del(`${base}/${ct.id}`)
      setMsg(r.deactivated ? `"${ct.name}" já foi usada em quotas: ficou desativada.` : `"${ct.name}" apagada.`)
      await load()
    } catch (e) { setErr(e.message) }
  }

  if (!types) return err ? <div className="msg error">{err}</div> : <div className="empty">A carregar…</div>
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const countFor = (ctId) => overrides.filter((o) => o.charge_type_id === ctId).length

  return (
    <div className="stack">
      <div className="card">
        <div className="row between" style={{ alignItems: 'center', gap: '.6rem' }}>
          <h3 style={{ margin: 0 }}>Rubricas da quota</h3>
          {!form && <button className="btn small" onClick={() => { setForm({ ...EMPTY }); setMsg(null); setErr(null) }}>+ Nova rubrica</button>}
        </div>
        <p className="hint">
          As rubricas <strong>mensais</strong> entram na quota de cada mês e aparecem discriminadas no aviso e no recibo.
          As <strong>pontuais</strong> (ex: quota extraordinária para obras) lançam-se à parte, no separador Quotas.
          Em cada rubrica podes isentar frações ou dar-lhes um valor próprio.
        </p>
        {msg && <div className="msg success" style={{ marginBottom: '.6rem' }}>{msg}</div>}
        {err && <div className="msg error" style={{ marginBottom: '.6rem' }}>{err}</div>}

        {form && (
          <form onSubmit={save} className="stack assign-box" style={{ maxWidth: 'none', marginBottom: '1rem' }}>
            <strong>{form.id ? `Editar "${form.name}"` : 'Nova rubrica'}</strong>
            <div className="row form-row">
              <div className="field" style={{ flex: 2, minWidth: 200 }}>
                <label htmlFor="ct-name">Nome *</label>
                <input id="ct-name" value={form.name} onChange={set('name')} required placeholder="Ex: Seguro do edifício, Elevador, Obras na cobertura" />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 180 }}>
                <label htmlFor="ct-cat">Tipo</label>
                <select id="ct-cat" value={form.category} onChange={(e) => {
                  const category = e.target.value
                  setForm({
                    ...form, category,
                    recurring: category === 'extraordinaria' ? false : form.recurring,
                    method: category === 'fundo_reserva' ? 'percentagem' : (form.method === 'orcamento' && category !== 'ordinaria' ? 'permilagem' : form.method),
                  })
                }}>
                  {Object.entries(CATEGORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="row form-row">
              <div className="field" style={{ flex: 2, minWidth: 220 }}>
                <label htmlFor="ct-method">Cálculo</label>
                <select id="ct-method" value={form.method} onChange={set('method')}>
                  {Object.entries(METHOD_LABELS)
                    .filter(([k]) => form.recurring || k !== 'orcamento')
                    .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              {form.method !== 'orcamento' && (
                <div className="field" style={{ flex: 1, minWidth: 150 }}>
                  <label htmlFor="ct-value">{form.method === 'percentagem' ? 'Percentagem (%)' : form.recurring ? 'Valor mensal (€)' : 'Valor por defeito (€)'}</label>
                  <input id="ct-value" type="number" min="0" step="0.01" value={form.value} onChange={set('value')} required={form.recurring} />
                </div>
              )}
              <div className="field" style={{ flex: 1, minWidth: 170 }}>
                <label htmlFor="ct-rec">Cobrança</label>
                <select id="ct-rec" value={form.recurring ? 'mensal' : 'pontual'} onChange={(e) => setForm({ ...form, recurring: e.target.value === 'mensal', method: e.target.value !== 'mensal' && form.method === 'orcamento' ? 'permilagem' : form.method })}>
                  <option value="mensal">Mensal (na quota do mês)</option>
                  <option value="pontual">Pontual (lançada à parte)</option>
                </select>
              </div>
            </div>
            {form.id && (
              <label className="remember" style={{ margin: 0 }}>
                <input type="checkbox" checked={form.active} onChange={set('active')} /> Ativa
              </label>
            )}
            <div className="row">
              <button className="btn small">{form.id ? 'Guardar' : 'Criar rubrica'}</button>
              <button type="button" className="btn secondary small" onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </form>
        )}

        <div className="table-wrap">
          <table>
            <thead><tr><th>Rubrica</th><th>Cálculo</th><th>Cobrança</th><th>Frações com configuração própria</th><th /></tr></thead>
            <tbody>
              {types.map((ct) => (
                <Fragment key={ct.id}>
                  <tr style={ct.active ? undefined : { opacity: .55 }}>
                    <td>
                      <strong>{ct.name}</strong>
                      <div className="hint" style={{ fontSize: '.78rem' }}>{CATEGORY_LABELS[ct.category] || ct.category}{!ct.active && ' · desativada'}</div>
                    </td>
                    <td>{describeCharge(ct)}</td>
                    <td>{ct.recurring ? <span className="badge ok">Mensal</span> : <span className="badge warn">Pontual</span>}</td>
                    <td>
                      <button type="button" className="link-button small" onClick={() => setOpenFor(openFor === ct.id ? null : ct.id)} aria-expanded={openFor === ct.id}>
                        {countFor(ct.id) ? `${countFor(ct.id)} fração(ões)` : 'Todas iguais'} · configurar por fração
                      </button>
                    </td>
                    <td>
                      <div className="row" style={{ gap: '.3rem', flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                        <button className="btn secondary small" onClick={() => { setForm({ ...ct, value: String(ct.value ?? '') }); setMsg(null); setErr(null) }}>Editar</button>
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
      </div>
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

export function ExtraQuotaCard({ condoId, fractions, onCreated }) {
  const base = `/condominiums/${condoId}/charge-types`
  const [types, setTypes] = useState([])
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [form, setForm] = useState({ charge_type_id: '', name: '', total_amount: '', method: 'permilagem', month, due_date: '', all: true, fraction_ids: [] })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    api.get(base).then((t) => {
      const list = t.filter((x) => x.active)
      setTypes(list)
      const def = list.find((x) => x.category === 'extraordinaria') || list.find((x) => !x.recurring)
      if (def) setForm((f) => ({ ...f, charge_type_id: def.id, method: ['permilagem', 'igual', 'fixo'].includes(def.method) ? def.method : 'permilagem', total_amount: def.value ? String(def.value) : '' }))
    }).catch(() => {})
  }, [condoId])

  async function submit(e) {
    e.preventDefault()
    setMsg(null)
    const selected = form.all ? null : form.fraction_ids
    if (selected && selected.length === 0) { setMsg({ type: 'error', text: 'Escolhe pelo menos uma fração.' }); return }
    const ct = types.find((t) => t.id === form.charge_type_id)
    const label = form.name.trim() || ct?.name
    if (!window.confirm(`Lançar "${label}" (${form.method === 'fixo' ? `${money(num(form.total_amount))} por fração` : `total ${money(num(form.total_amount))}`}) para ${selected ? selected.length : 'todas as'} fração(ões)?`)) return
    setBusy(true)
    try {
      const r = await api.post(`${base}/extra-quota`, {
        charge_type_id: form.charge_type_id, name: form.name.trim() || undefined,
        total_amount: num(form.total_amount), method: form.method,
        reference_month: `${form.month}-01`, due_date: form.due_date, fraction_ids: selected,
      })
      setMsg({ type: 'success', text: `${r.created} quota(s) lançada(s), no total de ${money(r.total)}.` })
      setForm((f) => ({ ...f, name: '', total_amount: '' }))
      await onCreated()
    } catch (e2) { setMsg({ type: 'error', text: e2.message }) }
    setBusy(false)
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  return (
    <div className="card">
      <h3>Lançar quota extraordinária (ou outra rubrica pontual)</h3>
      <p className="hint">Para obras, reforço do fundo de reserva ou outra despesa aprovada: fica uma quota à parte para cada fração, respeitando as isenções e valores próprios configurados na rubrica.</p>
      <form onSubmit={submit} className="stack">
        <div className="row form-row">
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="xq-type">Rubrica</label>
            <select id="xq-type" value={form.charge_type_id} onChange={set('charge_type_id')} required>
              <option value="">Selecionar…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.recurring ? ' (mensal)' : ''}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label htmlFor="xq-name">Descrição (aparece no aviso e no recibo)</label>
            <input id="xq-name" value={form.name} onChange={set('name')} placeholder="Ex: Obras na cobertura — 1ª prestação" />
          </div>
        </div>
        <div className="row form-row">
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="xq-method">Repartição</label>
            <select id="xq-method" value={form.method} onChange={set('method')}>
              <option value="permilagem">Total repartido por permilagem</option>
              <option value="igual">Total repartido em partes iguais</option>
              <option value="fixo">Valor fixo por fração</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="xq-total">{form.method === 'fixo' ? 'Valor por fração (€)' : 'Valor total (€)'}</label>
            <input id="xq-total" type="number" min="0.01" step="0.01" value={form.total_amount} onChange={set('total_amount')} required />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="xq-month">Mês de referência</label>
            <input id="xq-month" type="month" value={form.month} onChange={set('month')} required />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label htmlFor="xq-due">Vencimento</label>
            <input id="xq-due" type="date" value={form.due_date} onChange={set('due_date')} required />
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
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <div><button className="btn small" disabled={busy}>{busy ? 'A lançar…' : 'Lançar quota'}</button></div>
      </form>
    </div>
  )
}
