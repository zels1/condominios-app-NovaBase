import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import { OccurrenceStatusBadge } from '../components/StatusBadge'

const STATUS_FLOW = ['reported', 'acknowledged', 'in_progress', 'resolved', 'closed']
const STATUS_LABEL = { reported: 'Reportada', acknowledged: 'Reconhecida', in_progress: 'Em curso', resolved: 'Resolvida', closed: 'Fechada' }

export default function Maintenance() {
  const { selectedCondo, isAdmin } = useCondo()
  const [occurrences, setOccurrences] = useState([])
  const [fractions, setFractions] = useState([])
  const [form, setForm] = useState({ title: '', description: '', fraction_id: '', priority: 'normal' })
  const [error, setError] = useState(null)

  async function load() {
    const occs = await api.get(`/condominiums/${selectedCondo.id}/occurrences`)
    setOccurrences(occs)
    if (isAdmin) setFractions(await api.get(`/condominiums/${selectedCondo.id}/fractions`))
  }
  useEffect(() => { if (selectedCondo) load() }, [selectedCondo])

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    try {
      await api.post(`/condominiums/${selectedCondo.id}/occurrences`, {
        title: form.title, description: form.description || undefined,
        fraction_id: form.fraction_id || undefined, priority: form.priority,
      })
      setForm({ title: '', description: '', fraction_id: '', priority: 'normal' })
      load()
    } catch (err) { setError(err.message) }
  }

  async function advance(occ) {
    const idx = STATUS_FLOW.indexOf(occ.status)
    const next = STATUS_FLOW[Math.min(idx + 1, STATUS_FLOW.length - 1)]
    await api.post(`/condominiums/${selectedCondo.id}/occurrences/${occ.id}/updates`, { status: next })
    load()
  }

  if (!selectedCondo) return null

  return (
    <div className="stack">
      <h1>Manutenção e Ocorrências</h1>

      <div className="card">
        <h3>Reportar nova ocorrência</h3>
        {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
        <form onSubmit={handleCreate} className="stack">
          <div className="field">
            <label>Título *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex: Fuga de água na garagem" required />
          </div>
          <div className="field">
            <label>Descrição</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="row">
            {isAdmin && (
              <div className="field" style={{ flex: 1 }}>
                <label>Fração (opcional — zona comum se vazio)</label>
                <select value={form.fraction_id} onChange={(e) => setForm({ ...form, fraction_id: e.target.value })}>
                  <option value="">Zona comum</option>
                  {fractions.map((f) => <option key={f.id} value={f.id}>{f.identifier}</option>)}
                </select>
              </div>
            )}
            <div className="field" style={{ width: 160 }}>
              <label>Prioridade</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
          </div>
          <button className="btn" style={{ alignSelf: 'flex-start' }}>Reportar</button>
        </form>
      </div>

      <div className="stack">
        {occurrences.map((o) => (
          <div key={o.id} className="card">
            <div className="row between">
              <div>
                <h3 style={{ margin: 0 }}>{o.title}</h3>
                <span className="badge">{o.priority}</span>
              </div>
              <OccurrenceStatusBadge status={o.status} />
            </div>
            {o.description && <p>{o.description}</p>}
            <p className="hint">Reportada em {new Date(o.created_at).toLocaleDateString('pt-PT')}</p>
            {isAdmin && o.status !== 'closed' && (
              <button className="btn secondary small" onClick={() => advance(o)}>
                Avançar para "{STATUS_LABEL[STATUS_FLOW[Math.min(STATUS_FLOW.indexOf(o.status) + 1, STATUS_FLOW.length - 1)]]}"
              </button>
            )}
          </div>
        ))}
        {occurrences.length === 0 && <div className="empty">Sem ocorrências reportadas.</div>}
      </div>
    </div>
  )
}
