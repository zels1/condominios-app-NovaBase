import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import { useSort, SortTh } from '../components/SortableTable'

// Manutenção do prédio (preventiva e corretiva). As avarias reportadas pelos condóminos
// ficam em Ocorrências.
const CATEGORIES = {
  extintores: 'Extintores',
  elevador: 'Elevadores',
  limpeza: 'Limpeza',
  jardinagem: 'Jardinagem',
  canalizacao: 'Canalização',
  eletricidade: 'Eletricidade',
  gas: 'Gás',
  desinfestacao: 'Desinfestação',
  portao: 'Portão / garagem',
  outro: 'Outro',
}
const FREQUENCIES = {
  unica: 'Única vez',
  semanal: 'Semanal',
  mensal: 'Mensal',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
  bienal: 'De 2 em 2 anos',
}
const KINDS = { preventiva: 'Preventiva', corretiva: 'Corretiva' }

const TEMPLATES = [
  { title: 'Manutenção dos extintores', category: 'extintores', kind: 'preventiva', frequency: 'anual' },
  { title: 'Inspeção periódica dos elevadores', category: 'elevador', kind: 'preventiva', frequency: 'bienal' },
  { title: 'Manutenção dos elevadores', category: 'elevador', kind: 'preventiva', frequency: 'mensal' },
  { title: 'Limpeza das partes comuns', category: 'limpeza', kind: 'preventiva', frequency: 'semanal' },
  { title: 'Desinfestação e desratização', category: 'desinfestacao', kind: 'preventiva', frequency: 'semestral' },
  { title: 'Manutenção do portão da garagem', category: 'portao', kind: 'preventiva', frequency: 'semestral' },
]

const EMPTY = { title: '', category: 'extintores', kind: 'preventiva', frequency: 'anual', supplier_id: '', last_done: '', next_due: '', estimated_cost: '', notes: '', active: true }

function money(v) { return v == null ? '—' : new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v) }
function fmtDate(d) { return d ? new Date(`${d}T00:00:00`).toLocaleDateString('pt-PT') : '—' }
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysUntil(d) {
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.round((new Date(`${d}T00:00:00`) - t) / 86400000)
}

function relative(d) {
  const n = daysUntil(d)
  if (n === 0) return 'hoje'
  if (n < 0) return `há ${-n} dia${n === -1 ? '' : 's'}`
  return `daqui a ${n} dia${n === 1 ? '' : 's'}`
}

function taskState(t) {
  if (!t.active) return { key: 'inactive', text: 'Suspensa', cls: '', rank: 5 }
  if (!t.next_due) return t.last_done ? { key: 'done', text: 'Concluída', cls: 'ok', rank: 4 } : { key: 'nodate', text: 'Sem data', cls: '', rank: 3 }
  const n = daysUntil(t.next_due)
  if (n < 0) return { key: 'overdue', text: 'Em atraso', cls: 'danger', rank: 0 }
  if (n <= 30) return { key: 'soon', text: n === 0 ? 'Hoje' : 'Em breve', cls: 'warn', rank: 1 }
  return { key: 'planned', text: 'Agendada', cls: 'ok', rank: 2 }
}

export default function Maintenance() {
  const { selectedCondo, isAdmin } = useCondo()
  const [tasks, setTasks] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState('all')
  const [form, setForm] = useState(null) // null = fechado; {…, id?} = a criar/editar
  const [doneFor, setDoneFor] = useState(null)
  const [historyFor, setHistoryFor] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const base = selectedCondo ? `/condominiums/${selectedCondo.id}/maintenance` : null

  async function load() {
    const [list, sups] = await Promise.all([
      api.get(base),
      isAdmin ? api.get(`/condominiums/${selectedCondo.id}/suppliers`).catch(() => []) : Promise.resolve([]),
    ])
    setTasks(list)
    setSuppliers(sups)
    setLoaded(true)
  }
  useEffect(() => {
    if (!selectedCondo) return
    setLoaded(false); setForm(null); setDoneFor(null); setHistoryFor(null); setError(null); setNotice(null)
    load().catch((e) => { setError(e.message); setLoaded(true) })
  }, [selectedCondo?.id])

  const visible = tasks.filter((t) => filter === 'all' || t.kind === filter)
  const columns = useMemo(() => ({
    state: (t) => taskState(t).rank * 100000 + (t.next_due ? daysUntil(t.next_due) : 0),
    title: (t) => t.title,
    category: (t) => CATEGORIES[t.category] || t.category,
    frequency: (t) => Object.keys(FREQUENCIES).indexOf(t.frequency),
    last: (t) => t.last_done,
    next: (t) => t.next_due,
    supplier: (t) => t.supplier_name,
    cost: (t) => t.estimated_cost,
  }), [])
  const { sorted, sort, toggle } = useSort(visible, columns, 'state')

  const overdue = tasks.filter((t) => taskState(t).key === 'overdue').length
  const soon = tasks.filter((t) => taskState(t).key === 'soon').length
  const preventive = tasks.filter((t) => t.kind === 'preventiva' && t.active).length
  const corrective = tasks.filter((t) => t.kind === 'corretiva' && taskState(t).key !== 'done' && t.active).length

  async function save(e) {
    e.preventDefault()
    setError(null); setNotice(null)
    const body = {
      title: form.title.trim(),
      category: form.category,
      kind: form.kind,
      frequency: form.frequency,
      supplier_id: form.supplier_id || null,
      last_done: form.last_done || null,
      next_due: form.next_due || null,
      estimated_cost: form.estimated_cost === '' ? null : parseFloat(String(form.estimated_cost).replace(',', '.')),
      notes: form.notes.trim() || null,
      active: form.active,
    }
    try {
      if (form.id) await api.put(`${base}/${form.id}`, body)
      else await api.post(base, body)
      setNotice(form.id ? `"${body.title}" atualizada.` : `"${body.title}" adicionada ao plano de manutenção.`)
      setForm(null)
      await load()
    } catch (err) { setError(err.message) }
  }

  async function remove(t) {
    if (!window.confirm(`Apagar "${t.title}" e todo o seu histórico? As despesas já lançadas mantêm-se.`)) return
    setError(null); setNotice(null)
    try {
      await api.del(`${base}/${t.id}`)
      setNotice(`"${t.title}" apagada.`)
      if (historyFor === t.id) setHistoryFor(null)
      await load()
    } catch (err) { setError(err.message) }
  }

  function edit(t) {
    setDoneFor(null); setNotice(null); setError(null)
    setForm({
      id: t.id, title: t.title, category: t.category, kind: t.kind, frequency: t.frequency,
      supplier_id: t.supplier_id || '', last_done: t.last_done || '', next_due: t.next_due || '',
      estimated_cost: t.estimated_cost ?? '', notes: t.notes || '', active: t.active,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!selectedCondo) return null

  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: 'center', gap: '.6rem' }}>
        <h1 style={{ margin: 0 }}>Manutenção</h1>
        {isAdmin && !form && (
          <button className="btn" onClick={() => { setForm({ ...EMPTY }); setDoneFor(null); setNotice(null); setError(null) }}>+ Nova manutenção</button>
        )}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Manutenções <strong>preventivas</strong> (periódicas: extintores, elevadores, limpeza…) e <strong>corretivas</strong> (reparações) das partes comuns.
        {' '}As avarias reportadas pelos condóminos estão em <em>Ocorrências</em>.
      </p>
      {notice && <div className="msg success">{notice}</div>}
      {error && <div className="msg error">{error}</div>}

      <div className="grid">
        <div className="card stat">
          <span className="label">Em atraso</span>
          <span className="value" style={{ color: overdue ? 'var(--danger)' : 'inherit' }}>{overdue}</span>
        </div>
        <div className="card stat">
          <span className="label">Nos próximos 30 dias</span>
          <span className="value">{soon}</span>
        </div>
        <div className="card stat">
          <span className="label">Preventivas ativas</span>
          <span className="value">{preventive}</span>
        </div>
        <div className="card stat">
          <span className="label">Corretivas por concluir</span>
          <span className="value">{corrective}</span>
        </div>
      </div>

      {isAdmin && form && (
        <TaskForm form={form} setForm={setForm} suppliers={suppliers} onSubmit={save} onCancel={() => setForm(null)} />
      )}

      {isAdmin && doneFor && (
        <DoneForm
          key={doneFor}
          task={tasks.find((t) => t.id === doneFor)}
          base={base}
          onCancel={() => setDoneFor(null)}
          onDone={async (msg) => { setDoneFor(null); setNotice(msg); await load() }}
        />
      )}

      <div className="card">
        <div className="row between" style={{ alignItems: 'center', marginBottom: '.6rem' }}>
          <h3 style={{ margin: 0 }}>Plano de manutenção</h3>
          <div className="choice-group" role="group" aria-label="Filtrar por tipo">
            {[['all', 'Todas'], ['preventiva', 'Preventivas'], ['corretiva', 'Corretivas']].map(([k, l]) => (
              <button key={k} type="button" className={`btn secondary small${filter === k ? ' selected' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
        {!loaded ? <div className="empty">A carregar…</div> : visible.length === 0 ? (
          <div className="empty">
            {tasks.length === 0
              ? (isAdmin ? 'Ainda não há manutenções registadas. Usa "+ Nova manutenção" — há modelos prontos para extintores, elevadores e limpeza.' : 'O administrador ainda não registou manutenções.')
              : 'Nenhuma manutenção deste tipo.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortTh label="Estado" sortKey="state" sort={sort} onSort={toggle} />
                  <SortTh label="Manutenção" sortKey="title" sort={sort} onSort={toggle} />
                  <SortTh label="Periodicidade" sortKey="frequency" sort={sort} onSort={toggle} />
                  <SortTh label="Última" sortKey="last" sort={sort} onSort={toggle} />
                  <SortTh label="Próxima" sortKey="next" sort={sort} onSort={toggle} />
                  <SortTh label="Fornecedor" sortKey="supplier" sort={sort} onSort={toggle} />
                  {isAdmin && <SortTh label="Custo previsto" sortKey="cost" sort={sort} onSort={toggle} />}
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => {
                  const st = taskState(t)
                  return (
                    <Fragment key={t.id}>
                      <tr>
                        <td><span className={`badge ${st.cls}`} style={{ whiteSpace: 'nowrap' }}>{st.text}</span></td>
                        <td style={{ minWidth: 180 }}>
                          <strong>{t.title}</strong>
                          <div className="hint" style={{ fontSize: '.8rem' }}>{KINDS[t.kind] || t.kind} · {CATEGORIES[t.category] || t.category}{t.notes ? ` · ${t.notes}` : ''}</div>
                          {isAdmin && (
                            <div className="row" style={{ gap: '.8rem', marginTop: '.25rem' }}>
                              <button className="link-button small" onClick={() => setHistoryFor(historyFor === t.id ? null : t.id)} aria-expanded={historyFor === t.id}>Histórico</button>
                              <button className="link-button small" onClick={() => edit(t)}>Editar</button>
                              <button className="link-button small" onClick={() => remove(t)} aria-label={`Apagar ${t.title}`}>Apagar</button>
                            </div>
                          )}
                          {!isAdmin && (
                            <button className="link-button small" style={{ marginTop: '.25rem' }} onClick={() => setHistoryFor(historyFor === t.id ? null : t.id)} aria-expanded={historyFor === t.id}>Histórico</button>
                          )}
                        </td>
                        <td>{FREQUENCIES[t.frequency] || t.frequency}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.last_done)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {fmtDate(t.next_due)}
                          {t.next_due && t.active && <div className="hint" style={{ fontSize: '.78rem', color: st.key === 'overdue' ? 'var(--danger)' : undefined }}>{relative(t.next_due)}</div>}
                        </td>
                        <td>{t.supplier_name || '—'}</td>
                        {isAdmin && <td>{money(t.estimated_cost)}</td>}
                        {isAdmin && (
                          <td>
                            {t.active && st.key !== 'done' && (
                              <button className="btn small" style={{ whiteSpace: 'nowrap' }} onClick={() => { setForm(null); setDoneFor(t.id); setNotice(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Marcar como feita</button>
                            )}
                          </td>
                        )}
                      </tr>
                      {historyFor === t.id && (
                        <tr>
                          <td colSpan={isAdmin ? 8 : 6} style={{ background: 'var(--bg)' }}>
                            <History base={base} task={t} isAdmin={isAdmin} onChanged={load} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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

function TaskForm({ form, setForm, suppliers, onSubmit, onCancel }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const periodic = form.frequency !== 'unica'
  return (
    <div className="card">
      <h3>{form.id ? 'Editar manutenção' : 'Nova manutenção'}</h3>
      {!form.id && (
        <div className="field">
          <label>Modelos rápidos</label>
          <div className="row" style={{ gap: '.35rem' }}>
            {TEMPLATES.map((tpl) => (
              <button key={tpl.title} type="button" className="btn secondary small" onClick={() => setForm({ ...form, ...tpl })}>{tpl.title}</button>
            ))}
          </div>
        </div>
      )}
      <form onSubmit={onSubmit} className="stack">
        <div className="field">
          <label htmlFor="mt-title">Descrição *</label>
          <input id="mt-title" value={form.title} onChange={set('title')} required placeholder="Ex: Manutenção dos extintores" />
        </div>
        <div className="row form-row">
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="mt-kind">Tipo</label>
            <select id="mt-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, frequency: e.target.value === 'corretiva' ? 'unica' : form.frequency })}>
              <option value="preventiva">Preventiva (periódica)</option>
              <option value="corretiva">Corretiva (reparação)</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="mt-cat">Categoria</label>
            <select id="mt-cat" value={form.category} onChange={set('category')}>
              {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="mt-freq">Periodicidade</label>
            <select id="mt-freq" value={form.frequency} onChange={set('frequency')}>
              {Object.entries(FREQUENCIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="row form-row">
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="mt-last">Última vez feita</label>
            <input id="mt-last" type="date" value={form.last_done} onChange={set('last_done')} max={todayISO()} />
            {periodic && !form.id && <span className="hint">Se deixares a próxima data vazia, é calculada a partir desta.</span>}
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="mt-next">{periodic ? 'Próxima data' : 'Data prevista'}</label>
            <input id="mt-next" type="date" value={form.next_due} onChange={set('next_due')} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="mt-cost">Custo previsto (€)</label>
            <input id="mt-cost" type="number" min="0" step="0.01" value={form.estimated_cost} onChange={set('estimated_cost')} />
          </div>
        </div>
        <div className="row form-row">
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label htmlFor="mt-sup">Fornecedor</label>
            <select id="mt-sup" value={form.supplier_id} onChange={set('supplier_id')}>
              <option value="">— Sem fornecedor —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {suppliers.length === 0 && <span className="hint">Podes registar fornecedores em Fornecedores e despesas.</span>}
          </div>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label htmlFor="mt-notes">Notas</label>
            <input id="mt-notes" value={form.notes} onChange={set('notes')} placeholder="Ex: 6 extintores (piso 0 a 5)" />
          </div>
        </div>
        {form.id && (
          <label className="remember" style={{ margin: 0 }}>
            <input type="checkbox" checked={form.active} onChange={set('active')} /> Ativa (desmarca para suspender sem apagar)
          </label>
        )}
        <div className="row">
          <button className="btn small">{form.id ? 'Guardar alterações' : 'Adicionar'}</button>
          <button type="button" className="btn secondary small" onClick={onCancel}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}

function DoneForm({ task, base, onCancel, onDone }) {
  const [f, setF] = useState({ done_at: todayISO(), cost: task?.estimated_cost ?? '', notes: '', register_expense: false })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!task) return null
  async function submit(e) {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const cost = f.cost === '' ? null : parseFloat(String(f.cost).replace(',', '.'))
      const res = await api.post(`${base}/${task.id}/done`, { done_at: f.done_at, cost, notes: f.notes.trim() || null, register_expense: f.register_expense })
      await onDone(`"${task.title}" registada como feita a ${fmtDate(f.done_at)}.`
        + (res.next_due ? ` Próxima: ${fmtDate(res.next_due)}.` : '')
        + (f.register_expense ? ' Despesa lançada em Fornecedores e despesas.' : ''))
    } catch (e2) { setErr(e2.message); setBusy(false) }
  }
  return (
    <div className="card">
      <h3>Marcar como feita — {task.title}</h3>
      <form onSubmit={submit} className="stack">
        <div className="row form-row">
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label htmlFor="dn-date">Data *</label>
            <input id="dn-date" type="date" value={f.done_at} max={todayISO()} onChange={(e) => setF({ ...f, done_at: e.target.value })} required />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label htmlFor="dn-cost">Custo (€)</label>
            <input id="dn-cost" type="number" min="0" step="0.01" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label htmlFor="dn-notes">Notas</label>
            <input id="dn-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Ex: substituídos 2 extintores" />
          </div>
        </div>
        <label className="remember" style={{ margin: 0 }}>
          <input type="checkbox" checked={f.register_expense} onChange={(e) => setF({ ...f, register_expense: e.target.checked })} />
          Lançar este custo como despesa do condomínio
        </label>
        {task.frequency !== 'unica' && <p className="hint" style={{ margin: 0 }}>A próxima data é calculada automaticamente ({FREQUENCIES[task.frequency].toLowerCase()}).</p>}
        {err && <div className="msg error">{err}</div>}
        <div className="row">
          <button className="btn small" disabled={busy}>{busy ? 'A guardar…' : 'Registar'}</button>
          <button type="button" className="btn secondary small" onClick={onCancel}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}

function History({ base, task, isAdmin, onChanged }) {
  const [logs, setLogs] = useState(null)
  const [err, setErr] = useState(null)
  async function load() {
    try { setLogs(await api.get(`${base}/${task.id}/logs`)) } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [task.id, task.last_done])
  async function removeLog(l) {
    if (!window.confirm(`Apagar o registo de ${fmtDate(l.done_at)}?${l.expense_id ? ' (a despesa lançada mantém-se)' : ''}`)) return
    try { await api.del(`${base}/${task.id}/logs/${l.id}`); await onChanged(); await load() } catch (e) { setErr(e.message) }
  }
  if (err) return <div className="msg error">{err}</div>
  if (!logs) return <span className="hint">A carregar histórico…</span>
  if (logs.length === 0) return <span className="hint">Ainda sem registos de execução.</span>
  return (
    <div className="stack" style={{ gap: '.3rem' }}>
      <strong style={{ fontSize: '.85rem' }}>Histórico</strong>
      {logs.map((l) => (
        <div key={l.id} className="row between" style={{ fontSize: '.9rem' }}>
          <span>
            {fmtDate(l.done_at)}{l.cost != null ? ` · ${money(l.cost)}` : ''}{l.notes ? ` · ${l.notes}` : ''}
            {l.expense_id && <span className="badge" style={{ marginLeft: '.4rem' }}>Despesa lançada</span>}
          </span>
          {isAdmin && <button className="btn secondary small" onClick={() => removeLog(l)}>Apagar registo</button>}
        </div>
      ))}
    </div>
  )
}
