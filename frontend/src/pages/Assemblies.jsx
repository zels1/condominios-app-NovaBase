import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

const STATUS_LABELS = {
  scheduled: { text: 'Agendada', cls: '' },
  in_progress: { text: 'Em curso · votação aberta', cls: 'ok' },
  closed: { text: 'Encerrada', cls: 'warn' },
}
const CHOICE_LABELS = { favor: 'A favor', against: 'Contra', abstain: 'Abstenção' }
const ATTENDANCE_LABELS = { present: 'Presente', proxy: 'Procuração', absent: 'Ausente' }

function StatusBadge({ status }) {
  const s = STATUS_LABELS[status] || { text: status, cls: '' }
  return <span className={`badge ${s.cls}`}>{s.text}</span>
}

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
              <StatusBadge status={a.status} />
            </div>
          </div>
        ))}
        {assemblies.length === 0 && <div className="empty">Nenhuma assembleia agendada.</div>}
      </div>
    </div>
  )
}

function AssemblyDetail({ condoId, assembly: initialAssembly, isAdmin, onBack }) {
  const [assembly, setAssembly] = useState(initialAssembly)
  const [agenda, setAgenda] = useState([])
  const [myFractions, setMyFractions] = useState([])
  const [sheet, setSheet] = useState([])
  const [reloadKey, setReloadKey] = useState(0)
  const [statusMsg, setStatusMsg] = useState(null)
  const [proxies, setProxies] = useState([])
  const [attendance, setAttendance] = useState(null)
  const [agendaForm, setAgendaForm] = useState({ title: '', description: '' })
  const [proxyForm, setProxyForm] = useState({ fraction_id: '', proxy_holder_name: '' })
  const [fractions, setFractions] = useState([])

  async function load() {
    const items = await api.get(`/condominiums/${condoId}/assemblies/${assembly.id}/agenda`)
    setAgenda(items)
    if (isAdmin) {
      setSheet(await api.get(`/condominiums/${condoId}/assemblies/${assembly.id}/voting-sheet`))
      setProxies(await api.get(`/condominiums/${condoId}/assemblies/${assembly.id}/proxies`))
      setAttendance(await api.get(`/condominiums/${condoId}/assemblies/${assembly.id}/attendance`))
      setFractions(await api.get(`/condominiums/${condoId}/fractions`))
    } else {
      setMyFractions(await api.get(`/condominiums/${condoId}/assemblies/${assembly.id}/my-fractions`))
    }
    setReloadKey((k) => k + 1)
  }

  async function changeStatus(status, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return
    setStatusMsg(null)
    try {
      await api.post(`/condominiums/${condoId}/assemblies/${assembly.id}/status?status=${status}`)
      setAssembly({ ...assembly, status })
    } catch (err) { setStatusMsg(err.message) }
  }
  useEffect(() => { load() }, [assembly.id, assembly.status])

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
      <div className="row between">
        <h1 style={{ margin: 0 }}>{assembly.title}</h1>
        <StatusBadge status={assembly.status} />
      </div>
      <p className="hint">{fmt(assembly.scheduled_at)} {assembly.location ? `· ${assembly.location}` : ''}</p>

      {isAdmin && (
        <div className="card">
          <h3>Estado da assembleia</h3>
          {assembly.status === 'scheduled' && (
            <>
              <p className="hint">Quando a assembleia começar, inicia-a aqui: a votação abre para os condóminos e podes registar os votos dos presentes.</p>
              <button className="btn" onClick={() => changeStatus('in_progress')}>Iniciar assembleia e abrir votação</button>
            </>
          )}
          {assembly.status === 'in_progress' && (
            <>
              <p className="hint">A votação está aberta. Ao encerrar, deixa de ser possível votar ou alterar votos.</p>
              <button className="btn danger" onClick={() => changeStatus('closed', 'Encerrar a assembleia e fechar a votação?')}>Encerrar assembleia</button>
            </>
          )}
          {assembly.status === 'closed' && (
            <>
              <p className="hint">Assembleia encerrada. Os resultados ficam fixos.</p>
              <button className="btn secondary small" onClick={() => changeStatus('in_progress', 'Reabrir a votação? Só deves fazê-lo para corrigir um erro.')}>Reabrir votação</button>
            </>
          )}
          {statusMsg && <div className="msg error" style={{ marginTop: '.5em' }}>{statusMsg}</div>}
        </div>
      )}

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
          {agenda.map((item) => (
            <AgendaItemCard
              key={item.id}
              condoId={condoId}
              assemblyId={assembly.id}
              status={assembly.status}
              item={item}
              isAdmin={isAdmin}
              myFractions={myFractions}
              reloadKey={reloadKey}
              onVoted={load}
            />
          ))}
          {agenda.length === 0 && <p className="hint">Ainda sem pontos na ordem de trabalhos.</p>}
        </div>
      </div>

      {isAdmin && assembly.status !== 'scheduled' && agenda.some((i) => i.requires_vote) && (
        <VotingSheet condoId={condoId} assembly={assembly} agenda={agenda.filter((i) => i.requires_vote)} sheet={sheet} onChange={load} />
      )}

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
              <label>A minha fração</label>
              <select value={proxyForm.fraction_id} onChange={(e) => setProxyForm({ ...proxyForm, fraction_id: e.target.value })} required>
                <option value="">Selecionar…</option>
                {myFractions.filter((f) => !f.via_proxy).map((f) => <option key={f.fraction_id} value={f.fraction_id}>{f.identifier}</option>)}
              </select>
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
                    <td>{fractions.find((f) => f.id === p.fraction_id)?.identifier || p.fraction_id}</td><td>{p.proxy_holder_name}</td><td><span className="badge">{p.status}</span></td>
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

function AgendaItemCard({ condoId, assemblyId, status, item, isAdmin, myFractions, reloadKey, onVoted }) {
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)

  async function loadResults() {
    setResults(await api.get(`/condominiums/${condoId}/assemblies/${assemblyId}/agenda/${item.id}/results`))
  }
  useEffect(() => { if (item.requires_vote) loadResults() }, [reloadKey])

  async function vote(fraction, choice) {
    const label = CHOICE_LABELS[choice]
    if (!window.confirm(`Votar "${label}" pela fração ${fraction.identifier} no ponto "${item.title}"? Depois de votar não é possível alterar.`)) return
    setMsg(null)
    setBusy(fraction.fraction_id)
    try {
      await api.post(`/condominiums/${condoId}/assemblies/${assemblyId}/agenda/${item.id}/votes`, { fraction_id: fraction.fraction_id, choice })
      setMsg({ type: 'success', text: `Voto registado: ${label} (${fraction.identifier}).` })
      onVoted()
    } catch (err) { setMsg({ type: 'error', text: err.message }) }
    setBusy(null)
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.8rem' }}>
      <div className="row between">
        <strong>{item.title}</strong>
        {item.requires_vote
          ? results && <span className="badge">{results.votes_cast} voto(s)</span>
          : <span className="badge">Sem votação</span>}
      </div>
      {item.description && <p className="hint">{item.description}</p>}

      {item.requires_vote && results && (
        <div className="row" style={{ marginTop: '.4em' }}>
          <span className="badge ok">A favor: {results.permilagem_totals.favor.toFixed(1)}‰</span>
          <span className="badge danger">Contra: {results.permilagem_totals.against.toFixed(1)}‰</span>
          <span className="badge">Abstenção: {results.permilagem_totals.abstain.toFixed(1)}‰</span>
          {status === 'closed' && results.votes_cast > 0 && (
            <span className={`badge ${results.approved ? 'ok' : 'danger'}`}>{results.approved ? 'Aprovado' : 'Não aprovado'}</span>
          )}
        </div>
      )}

      {!isAdmin && item.requires_vote && (
        <div style={{ marginTop: '.6rem' }}>
          {status === 'scheduled' && <p className="hint">A votação abre quando a assembleia começar.</p>}
          {status === 'closed' && <p className="hint">Votação encerrada.</p>}
          {status === 'in_progress' && myFractions.length === 0 && (
            <p className="hint">Não tens nenhuma fração associada neste condomínio, por isso não podes votar.</p>
          )}
          {status === 'in_progress' && myFractions.map((f) => {
            const current = f.votes[item.id]
            return (
              <div key={f.fraction_id} className="row" style={{ alignItems: 'center', marginBottom: '.4em' }}>
                <span style={{ minWidth: 140 }}>
                  <strong>{f.identifier}</strong>
                  {f.via_proxy && <span className="hint"> · por procuração</span>}
                </span>
                {current ? (
                  <span className="badge ok">Votou: {CHOICE_LABELS[current]}</span>
                ) : (
                  <div className="row">
                    <button className="btn small" disabled={busy === f.fraction_id} onClick={() => vote(f, 'favor')}>A favor</button>
                    <button className="btn danger small" disabled={busy === f.fraction_id} onClick={() => vote(f, 'against')}>Contra</button>
                    <button className="btn secondary small" disabled={busy === f.fraction_id} onClick={() => vote(f, 'abstain')}>Abstenção</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {msg && <div className={`msg ${msg.type}`} style={{ marginTop: '.5em' }}>{msg.text}</div>}
    </div>
  )
}

function VotingSheet({ condoId, assembly, agenda, sheet, onChange }) {
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const editable = assembly.status === 'in_progress'
  const base = `/condominiums/${condoId}/assemblies/${assembly.id}`

  async function setVote(fractionId, itemId, choice) {
    setMsg(null)
    setBusy(true)
    try {
      if (choice) await api.post(`${base}/agenda/${itemId}/votes`, { fraction_id: fractionId, choice })
      else await api.del(`${base}/agenda/${itemId}/votes/${fractionId}`)
      await onChange()
    } catch (err) { setMsg(err.message) }
    setBusy(false)
  }

  async function checkIn(fractionId) {
    setMsg(null)
    try {
      await api.post(`${base}/attendance/${fractionId}/check-in`)
      await onChange()
    } catch (err) { setMsg(err.message) }
  }

  // Preenche com o mesmo voto todas as frações presentes/representadas que ainda não votaram neste ponto
  async function fillRemaining(itemId, choice) {
    const targets = sheet.filter((r) => r.attendance !== 'absent' && !r.votes[itemId])
    if (targets.length === 0) { setMsg('Não há frações presentes sem voto neste ponto.'); return }
    if (!window.confirm(`Registar "${CHOICE_LABELS[choice]}" para ${targets.length} fração(ões) presente(s) que ainda não votaram?`)) return
    setMsg(null)
    setBusy(true)
    try {
      for (const r of targets) {
        await api.post(`${base}/agenda/${itemId}/votes`, { fraction_id: r.fraction_id, choice })
      }
      await onChange()
    } catch (err) { setMsg(err.message) }
    setBusy(false)
  }

  return (
    <div className="card">
      <h3>Registo de votos na sala</h3>
      <p className="hint">
        {editable
          ? 'Regista aqui os votos dados presencialmente. Ao registar um voto, a fração fica marcada como presente. Os votos dados pelos condóminos na app aparecem automaticamente.'
          : 'Assembleia encerrada. Os votos já não podem ser alterados.'}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fração</th>
              <th>‰</th>
              <th>Presença</th>
              {agenda.map((i) => <th key={i.id}>{i.title}</th>)}
            </tr>
          </thead>
          <tbody>
            {sheet.map((r) => (
              <tr key={r.fraction_id}>
                <td><strong>{r.identifier}</strong></td>
                <td>{r.permilagem.toFixed(1)}</td>
                <td>
                  {r.attendance === 'absent' && editable
                    ? <button className="btn secondary small" onClick={() => checkIn(r.fraction_id)}>Marcar presente</button>
                    : <span className={`badge ${r.attendance === 'absent' ? '' : 'ok'}`}>{ATTENDANCE_LABELS[r.attendance] || r.attendance}</span>}
                </td>
                {agenda.map((i) => (
                  <td key={i.id}>
                    {editable ? (
                      <select disabled={busy} value={r.votes[i.id] || ''} onChange={(e) => setVote(r.fraction_id, i.id, e.target.value)}>
                        <option value="">—</option>
                        <option value="favor">A favor</option>
                        <option value="against">Contra</option>
                        <option value="abstain">Abstenção</option>
                      </select>
                    ) : (CHOICE_LABELS[r.votes[i.id]] || '—')}
                  </td>
                ))}
              </tr>
            ))}
            {editable && sheet.length > 0 && (
              <tr>
                <td colSpan={3} className="hint">Presentes sem voto →</td>
                {agenda.map((i) => (
                  <td key={i.id}>
                    <button className="btn small" disabled={busy} onClick={() => fillRemaining(i.id, 'favor')}>Todos a favor</button>
                  </td>
                ))}
              </tr>
            )}
            {sheet.length === 0 && <tr><td colSpan={3 + agenda.length} className="empty">Ainda não há frações neste condomínio.</td></tr>}
          </tbody>
        </table>
      </div>
      {msg && <div className="msg error" style={{ marginTop: '.5em' }}>{msg}</div>}
    </div>
  )
}
