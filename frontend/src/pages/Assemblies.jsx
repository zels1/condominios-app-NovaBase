import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

function fmt(dt) { return new Date(dt).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }) }

export default function Assemblies() {
  const { selectedCondo, isAdmin } = useCondo()
  const [assemblies, setAssemblies] = useState([])
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ title: '', assembly_type: 'ordinária', scheduled_at: '', location: '' })

  async function load() {
    const list = await api.get(`/condominiums/${selectedCondo.id}/assemblies`)
    setAssemblies(list)
  }
  useEffect(() => { if (selectedCondo) load() }, [selectedCondo])

  async function create(e) {
    e.preventDefault()
    await api.post(`/condominiums/${selectedCondo.id}/assemblies`, form)
    setForm({ title: '', assembly_type: 'ordinária', scheduled_at: '', location: '' })
    load()
  }

  if (!selectedCondo) return null

  if (selected) {
    return <AssemblyDetail condoId={selectedCondo.id} assembly={selected} isAdmin={isAdmin} onBack={() => setSelected(null)} />
  }

  return (
    <div className="stack">
      <h1>Assembleias</h1>

      {isAdmin && (
        <div className="card">
          <h3>Convocar assembleia</h3>
          <form onSubmit={create} className="stack">
            <div className="field"><label>Título *</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Tipo</label>
                <select value={form.assembly_type} onChange={(e) => setForm({ ...form, assembly_type: e.target.value })}>
                  <option value="ordinária">Ordinária</option>
                  <option value="extraordinária">Extraordinária</option>
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Data e hora *</label>
                <input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} required />
              </div>
            </div>
            <div className="field"><label>Local</label><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            <button className="btn" style={{ alignSelf: 'flex-start' }}>Convocar</button>
          </form>
        </div>
      )}

      <div className="stack">
        {assemblies.map((a) => (
          <div key={a.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setSelected(a)}>
            <div className="row between">
              <div>
                <h3 style={{ margin: 0 }}>{a.title}</h3>
                <p className="hint" style={{ margin: 0 }}>{a.assembly_type} · {fmt(a.scheduled_at)} {a.location ? `· ${a.location}` : ''}</p>
              </div>
              <span className="badge">{a.status}</span>
            </div>
          </div>
        ))}
        {assemblies.length === 0 && <div className="empty">Nenhuma assembleia agendada.</div>}
      </div>
    </div>
  )
}

function AssemblyDetail({ condoId, assembly, isAdmin, onBack }) {
  const [agenda, setAgenda] = useState([])
  const [proxies, setProxies] = useState([])
  const [attendance, setAttendance] = useState(null)
  const [agendaForm, setAgendaForm] = useState({ title: '', description: '' })
  const [proxyForm, setProxyForm] = useState({ fraction_id: '', proxy_holder_name: '' })
  const [fractions, setFractions] = useState([])

  async function load() {
    const items = await api.get(`/condominiums/${condoId}/assemblies/${assembly.id}/agenda`)
    setAgenda(items)
    if (isAdmin) {
      setProxies(await api.get(`/condominiums/${condoId}/assemblies/${assembly.id}/proxies`))
      setAttendance(await api.get(`/condominiums/${condoId}/assemblies/${assembly.id}/attendance`))
      setFractions(await api.get(`/condominiums/${condoId}/fractions`))
    }
  }
  useEffect(() => { load() }, [assembly.id])

  async function addAgendaItem(e) {
    e.preventDefault()
    await api.post(`/condominiums/${condoId}/assemblies/${assembly.id}/agenda`, { ...agendaForm, requires_vote: true })
    setAgendaForm({ title: '', description: '' })
    load()
  }

  async function submitProxy(e) {
    e.preventDefault()
    await api.post(`/condominiums/${condoId}/assemblies/${assembly.id}/proxies`, proxyForm)
    setProxyForm({ fraction_id: '', proxy_holder_name: '' })
    load()
  }

  async function validateProxy(proxyId, approve) {
    await api.post(`/condominiums/${condoId}/assemblies/${assembly.id}/proxies/${proxyId}/validate?approve=${approve}`)
    load()
  }

  return (
    <div className="stack">
      <button className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={onBack}>← Voltar</button>
      <h1>{assembly.title}</h1>
      <p className="hint">{fmt(assembly.scheduled_at)} {assembly.location ? `· ${assembly.location}` : ''}</p>

      {isAdmin && attendance && (
        <div className="card">
          <h3>Quórum</h3>
          <p>{attendance.present_permilagem.toFixed(1)}‰ de {attendance.total_permilagem.toFixed(1)}‰ presente/representado ({attendance.quorum_percent}%)</p>
        </div>
      )}

      <div className="card">
        <h3>Ordem de trabalhos</h3>
        {isAdmin && (
          <form onSubmit={addAgendaItem} className="row" style={{ marginBottom: '1rem', alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1 }}><label>Ponto</label><input value={agendaForm.title} onChange={(e) => setAgendaForm({ ...agendaForm, title: e.target.value })} required /></div>
            <button className="btn small" style={{ marginBottom: '.9em' }}>Adicionar</button>
          </form>
        )}
        <div className="stack">
          {agenda.map((item) => <AgendaItemCard key={item.id} condoId={condoId} assemblyId={assembly.id} item={item} isAdmin={isAdmin} />)}
          {agenda.length === 0 && <p className="hint">Ainda sem pontos na ordem de trabalhos.</p>}
        </div>
      </div>

      <div className="card">
        <h3>Procurações</h3>
        <form onSubmit={submitProxy} className="row" style={{ marginBottom: '1rem', alignItems: 'flex-end' }}>
          {isAdmin ? (
            <div className="field" style={{ flex: 1 }}>
              <label>Fração</label>
              <select value={proxyForm.fraction_id} onChange={(e) => setProxyForm({ ...proxyForm, fraction_id: e.target.value })} required>
                <option value="">Selecionar…</option>
                {fractions.map((f) => <option key={f.id} value={f.id}>{f.identifier}</option>)}
              </select>
            </div>
          ) : (
            <div className="field" style={{ flex: 1 }}>
              <label>ID da minha fração</label>
              <input value={proxyForm.fraction_id} onChange={(e) => setProxyForm({ ...proxyForm, fraction_id: e.target.value })} required placeholder="cola aqui o id" />
            </div>
          )}
          <div className="field" style={{ flex: 1 }}><label>Procurador</label><input value={proxyForm.proxy_holder_name} onChange={(e) => setProxyForm({ ...proxyForm, proxy_holder_name: e.target.value })} required /></div>
          <button className="btn small" style={{ marginBottom: '.9em' }}>Submeter procuração</button>
        </form>
        {isAdmin && (
          <div className="table-wrap">
            <table><thead><tr><th>Fração</th><th>Procurador</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {proxies.map((p) => (
                  <tr key={p.id}>
                    <td>{p.fraction_id}</td><td>{p.proxy_holder_name}</td><td><span className="badge">{p.status}</span></td>
                    <td>
                      {p.status === 'pending_validation' && (
                        <div className="row">
                          <button className="btn small" onClick={() => validateProxy(p.id, true)}>Validar</button>
                          <button className="btn secondary small" onClick={() => validateProxy(p.id, false)}>Rejeitar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {proxies.length === 0 && <tr><td colSpan={4} className="empty">Sem procurações submetidas.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function AgendaItemCard({ condoId, assemblyId, item, isAdmin }) {
  const [results, setResults] = useState(null)
  const [voteFractionId, setVoteFractionId] = useState('')
  const [choice, setChoice] = useState('favor')
  const [msg, setMsg] = useState(null)

  async function loadResults() {
    setResults(await api.get(`/condominiums/${condoId}/assemblies/${assemblyId}/agenda/${item.id}/results`))
  }
  useEffect(() => { loadResults() }, [])

  async function vote(e) {
    e.preventDefault()
    setMsg(null)
    try {
      await api.post(`/condominiums/${condoId}/assemblies/${assemblyId}/agenda/${item.id}/votes`, { fraction_id: voteFractionId, choice })
      setMsg({ type: 'success', text: 'Voto registado!' })
      loadResults()
    } catch (err) { setMsg({ type: 'error', text: err.message }) }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.8rem' }}>
      <div className="row between">
        <strong>{item.title}</strong>
        {results && <span className="badge">{results.votes_cast} voto(s)</span>}
      </div>
      {item.description && <p className="hint">{item.description}</p>}

      {results && (
        <div className="row" style={{ marginTop: '.4em' }}>
          <span className="badge ok">A favor: {results.permilagem_totals.favor.toFixed(1)}‰</span>
          <span className="badge danger">Contra: {results.permilagem_totals.against.toFixed(1)}‰</span>
          <span className="badge">Abstenção: {results.permilagem_totals.abstain.toFixed(1)}‰</span>
        </div>
      )}

      {!isAdmin && (
        <form onSubmit={vote} className="row" style={{ marginTop: '.6rem', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}><label>ID da minha fração</label><input value={voteFractionId} onChange={(e) => setVoteFractionId(e.target.value)} required /></div>
          <div className="field" style={{ width: 160 }}>
            <label>Voto</label>
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="favor">A favor</option>
              <option value="against">Contra</option>
              <option value="abstain">Abstenção</option>
            </select>
          </div>
          <button className="btn small" style={{ marginBottom: '.9em' }}>Votar</button>
        </form>
      )}
      {msg && <div className={`msg ${msg.type}`} style={{ marginTop: '.5em' }}>{msg.text}</div>}
    </div>
  )
}
