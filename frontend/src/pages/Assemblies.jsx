import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

const STATUS_LABELS = {
  scheduled: { text: 'Agendada', cls: '' },
  in_progress: { text: 'Em curso · votação aberta', cls: 'ok' },
  closed: { text: 'Encerrada', cls: 'warn' },
}
const CHOICE_LABELS = { favor: 'A favor', against: 'Contra', abstain: 'Abstenção' }
const ATTENDANCE_LABELS = { present: 'Presente', proxy: 'Representado', absent: 'Ausente' }
const PROXY_STATUS = { pending_validation: 'Por validar', validated: 'Validada', rejected: 'Rejeitada' }

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
        <AttendanceCard condoId={condoId} assembly={assembly} sheet={sheet} attendance={attendance} onChange={load} />
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
              sheet={sheet}
              reloadKey={reloadKey}
              onVoted={load}
            />
          ))}
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
                    <td>{fractions.find((f) => f.id === p.fraction_id)?.identifier || p.fraction_id}</td><td>{p.proxy_holder_name}</td><td><span className={`badge ${p.status === 'validated' ? 'ok' : p.status === 'rejected' ? 'danger' : 'warn'}`}>{PROXY_STATUS[p.status] || p.status}</span></td>
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

function AgendaItemCard({ condoId, assemblyId, status, item, isAdmin, myFractions, sheet, reloadKey, onVoted }) {
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
      {isAdmin && item.requires_vote && (
        <AdminVotes condoId={condoId} assemblyId={assemblyId} status={status} item={item} sheet={sheet} onChange={onVoted} />
      )}

      {msg && <div className={`msg ${msg.type}`} style={{ marginTop: '.5em' }}>{msg.text}</div>}
    </div>
  )
}

function ownersText(r) {
  return r.owners && r.owners.length ? r.owners.join(', ') : 'Sem proprietário registado'
}

// Presenças: o administrador marca cada condómino/fração como presente, representado por
// procuração (com o nome do procurador) ou ausente. O quórum atualiza na hora.
function AttendanceCard({ condoId, assembly, sheet, attendance, onChange }) {
  const [drafts, setDrafts] = useState({}) // fraction_id → nome do procurador a escrever
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const editable = assembly.status !== 'closed'
  const base = `/condominiums/${condoId}/assemblies/${assembly.id}`
  const counts = sheet.reduce((c, r) => ({ ...c, [r.attendance]: (c[r.attendance] || 0) + 1 }), {})

  async function setAttendance(r, type, holder) {
    setMsg(null)
    if (type === 'proxy' && !(holder || r.proxy_holder_name)) {
      setDrafts((d) => ({ ...d, [r.fraction_id]: d[r.fraction_id] ?? '' }))
      return
    }
    setBusy(r.fraction_id)
    try {
      await api.put(`${base}/attendance/${r.fraction_id}`, { attendance_type: type, proxy_holder_name: type === 'proxy' ? (holder || r.proxy_holder_name) : undefined })
      setDrafts((d) => { const n = { ...d }; delete n[r.fraction_id]; return n })
      await onChange()
    } catch (err) { setMsg(err.message) }
    setBusy(null)
  }

  return (
    <div className="card">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Presenças e quórum</h3>
        <span className={`badge ${attendance.quorum_percent > 50 ? 'ok' : 'warn'}`}>
          {attendance.present_permilagem.toLocaleString('pt-PT', { maximumFractionDigits: 3 })}‰ de {attendance.total_permilagem.toLocaleString('pt-PT', { maximumFractionDigits: 3 })}‰ · {attendance.quorum_percent}%
        </span>
      </div>
      <p className="hint">
        {editable
          ? 'Marca quem está presente ou representado por procuração. Ao registar um voto, a fração também fica marcada como presente.'
          : 'Assembleia encerrada: as presenças já não podem ser alteradas.'}
        {' '}Presentes: {counts.present || 0} · Representados: {counts.proxy || 0} · Ausentes: {counts.absent || 0}
      </p>
      <div className="stack" style={{ gap: 0 }}>
        {sheet.map((r) => {
          const draft = drafts[r.fraction_id]
          return (
            <div key={r.fraction_id} className="vote-row">
              <div className="who">
                <strong>{r.identifier}</strong> <span className="hint">· {r.permilagem.toLocaleString('pt-PT')}‰</span>
                <div className="hint">{ownersText(r)}{r.attendance === 'proxy' && r.proxy_holder_name ? ` — representado por ${r.proxy_holder_name}` : ''}</div>
              </div>
              {editable ? (
                <div className="stack" style={{ gap: '.3rem', alignItems: 'flex-end' }}>
                  <div className="choice-group" role="group" aria-label={`Presença da fração ${r.identifier}`}>
                    {['present', 'proxy', 'absent'].map((t) => (
                      <button key={t} type="button" disabled={busy === r.fraction_id}
                        className={`btn secondary small${r.attendance === t && draft === undefined ? ' selected' : ''}${t === 'absent' ? ' neutral' : ''}${t === 'proxy' && draft !== undefined ? ' selected' : ''}`}
                        aria-pressed={r.attendance === t}
                        onClick={() => setAttendance(r, t)}>
                        {t === 'present' ? 'Presente' : t === 'proxy' ? 'Procuração' : 'Ausente'}
                      </button>
                    ))}
                  </div>
                  {(draft !== undefined || r.attendance === 'proxy') && (
                    <form className="row" style={{ gap: '.3rem', flexWrap: 'nowrap' }}
                      onSubmit={(e) => { e.preventDefault(); setAttendance(r, 'proxy', (draft ?? r.proxy_holder_name ?? '').trim()) }}>
                      <input aria-label={`Procurador da fração ${r.identifier}`} placeholder="Nome do procurador" style={{ minWidth: 160 }}
                        value={draft ?? r.proxy_holder_name ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [r.fraction_id]: e.target.value }))} required />
                      <button className="btn small" disabled={busy === r.fraction_id}>Guardar</button>
                    </form>
                  )}
                </div>
              ) : (
                <span className={`badge ${r.attendance === 'absent' ? '' : 'ok'}`}>{ATTENDANCE_LABELS[r.attendance] || r.attendance}</span>
              )}
            </div>
          )
        })}
        {sheet.length === 0 && <p className="hint">Ainda não há frações neste condomínio.</p>}
      </div>
      {msg && <div className="msg error" style={{ marginTop: '.5em' }}>{msg}</div>}
    </div>
  )
}

// Votos de cada condómino neste ponto da ordem de trabalhos, registados pelo administrador
function AdminVotes({ condoId, assemblyId, status, item, sheet, onChange }) {
  const [onlyPresent, setOnlyPresent] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const editable = status === 'in_progress'
  const base = `/condominiums/${condoId}/assemblies/${assemblyId}`
  const voted = sheet.filter((r) => r.votes[item.id]).length
  const rows = sheet.filter((r) => !onlyPresent || r.attendance !== 'absent' || r.votes[item.id])

  async function setVote(r, choice) {
    setMsg(null); setBusy(true)
    try {
      if (choice) await api.post(`${base}/agenda/${item.id}/votes`, { fraction_id: r.fraction_id, choice })
      else await api.del(`${base}/agenda/${item.id}/votes/${r.fraction_id}`)
      await onChange()
    } catch (err) { setMsg(err.message) }
    setBusy(false)
  }

  async function fillRemaining(choice) {
    const targets = sheet.filter((r) => r.attendance !== 'absent' && !r.votes[item.id])
    if (targets.length === 0) { setMsg('Não há condóminos presentes sem voto neste ponto.'); return }
    if (!window.confirm(`Registar "${CHOICE_LABELS[choice]}" para ${targets.length} fração(ões) presente(s) que ainda não votaram?`)) return
    setMsg(null); setBusy(true)
    try {
      for (const r of targets) await api.post(`${base}/agenda/${item.id}/votes`, { fraction_id: r.fraction_id, choice })
      await onChange()
    } catch (err) { setMsg(err.message) }
    setBusy(false)
  }

  if (status === 'scheduled') {
    return <p className="hint" style={{ marginTop: '.5rem' }}>Os votos de cada condómino registam-se aqui quando iniciares a assembleia.</p>
  }

  return (
    <details className="admin-votes" open={editable} style={{ marginTop: '.6rem' }}>
      <summary><strong>Votos por condómino</strong> <span className="hint">({voted} de {sheet.length} frações votaram)</span></summary>
      <div className="row between" style={{ margin: '.5rem 0 .2rem', gap: '.5rem' }}>
        <label className="remember" style={{ margin: 0 }}>
          <input type="checkbox" checked={onlyPresent} onChange={(e) => setOnlyPresent(e.target.checked)} /> Só presentes e representados
        </label>
        {editable && (
          <button type="button" className="btn secondary small" disabled={busy} onClick={() => fillRemaining('favor')}>Presentes sem voto: todos a favor</button>
        )}
      </div>
      {rows.length === 0 && <p className="hint">Ninguém marcado como presente. Marca as presenças acima, ou desmarca o filtro para ver todas as frações.</p>}
      {rows.map((r) => {
        const current = r.votes[item.id]
        return (
          <div key={r.fraction_id} className="vote-row">
            <div className="who">
              <strong>{r.identifier}</strong> <span className="hint">· {r.permilagem.toLocaleString('pt-PT')}‰ · {ATTENDANCE_LABELS[r.attendance]}</span>
              <div className="hint">{ownersText(r)}{r.attendance === 'proxy' && r.proxy_holder_name ? ` — por ${r.proxy_holder_name}` : ''}</div>
            </div>
            {editable ? (
              <div className="choice-group" role="group" aria-label={`Voto da fração ${r.identifier}`}>
                <button type="button" disabled={busy} aria-pressed={current === 'favor'} className={`btn secondary small${current === 'favor' ? ' selected' : ''}`} onClick={() => setVote(r, 'favor')}>A favor</button>
                <button type="button" disabled={busy} aria-pressed={current === 'against'} className={`btn secondary small against${current === 'against' ? ' selected' : ''}`} onClick={() => setVote(r, 'against')}>Contra</button>
                <button type="button" disabled={busy} aria-pressed={current === 'abstain'} className={`btn secondary small neutral${current === 'abstain' ? ' selected' : ''}`} onClick={() => setVote(r, 'abstain')}>Abstenção</button>
                {current && <button type="button" disabled={busy} className="link-button small" onClick={() => setVote(r, null)} title="Anular este voto">Anular</button>}
              </div>
            ) : (
              <span className={`badge ${current === 'favor' ? 'ok' : current === 'against' ? 'danger' : ''}`}>{CHOICE_LABELS[current] || 'Não votou'}</span>
            )}
          </div>
        )
      })}
      {msg && <div className="msg error" style={{ marginTop: '.5em' }}>{msg}</div>}
    </details>
  )
}
