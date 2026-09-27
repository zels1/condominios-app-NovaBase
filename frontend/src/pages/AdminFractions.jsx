import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

const TYPES = [['habitação', 'Habitação'], ['comércio', 'Comércio'], ['garagem', 'Garagem'], ['arrumos', 'Arrumos']]

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}` }

export default function AdminFractions() {
  const { selectedCondo } = useCondo()
  const [fractions, setFractions] = useState([])
  const [check, setCheck] = useState(null)
  const [form, setForm] = useState({ identifier: '', permilagem: '', fraction_type: 'habitação' })
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [editing, setEditing] = useState(null)

  async function load() {
    if (!selectedCondo) return
    const [fs, c] = await Promise.all([
      api.get(`/condominiums/${selectedCondo.id}/fractions`),
      api.get(`/condominiums/${selectedCondo.id}/fractions/permilagem-check`),
    ])
    setFractions(fs); setCheck(c)
  }

  useEffect(() => { load().catch((e) => setError(e.message)) }, [selectedCondo])

  async function handleCreate(e) {
    e.preventDefault()
    setError(null); setNotice(null)
    try {
      await api.post(`/condominiums/${selectedCondo.id}/fractions`, {
        identifier: form.identifier.trim(),
        permilagem: parseFloat(String(form.permilagem).replace(',', '.')),
        fraction_type: form.fraction_type,
      })
      setForm({ identifier: '', permilagem: '', fraction_type: 'habitação' })
      load()
    } catch (err) { setError(err.message) }
  }

  async function handleDelete(f) {
    setError(null); setNotice(null)
    try {
      const p = await api.get(`/condominiums/${selectedCondo.id}/fractions/${f.id}/delete-preview`)
      const lost = [
        p.owners && plural(p.owners, 'associação a proprietário', 'associações a proprietários'),
        p.quotas && plural(p.quotas, 'quota', 'quotas'),
        p.payments && plural(p.payments, 'pagamento registado', 'pagamentos registados'),
        p.votes && plural(p.votes, 'voto em assembleias', 'votos em assembleias'),
      ].filter(Boolean)
      const msg = `Apagar definitivamente a fração ${f.identifier}?\n\n`
        + (lost.length ? `Vai apagar também:\n• ${lost.join('\n• ')}\n` : 'Não tem histórico associado.\n')
        + (p.occurrences ? `\n${plural(p.occurrences, 'ocorrência', 'ocorrências')} desta fração passa(m) a "zona comum".\n` : '')
        + '\nEsta ação não pode ser desfeita.'
      if (!window.confirm(msg)) return
      await api.del(`/condominiums/${selectedCondo.id}/fractions/${f.id}`)
      setNotice(`Fração ${f.identifier} apagada.`)
      if (expanded === f.id) setExpanded(null)
      load()
    } catch (err) { setError(err.message) }
  }

  if (!selectedCondo) return null

  return (
    <div className="stack">
      <div className="topbar">
        <h1>Frações</h1>
        {check && (
          <span className={`badge ${check.is_balanced ? 'ok' : 'warn'}`}>
            Soma da permilagem: {check.total_permilagem.toFixed(3)}‰ {check.is_balanced ? '(equilibrado)' : '(devia somar 1000)'}
          </span>
        )}
      </div>
      {notice && <div className="msg success">{notice}</div>}
      {error && <div className="msg error">{error}</div>}

      <div className="card">
        <h3>Adicionar fração</h3>
        <form onSubmit={handleCreate} className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label>Identificador</label>
            <input value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="2º Esq" required />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>Permilagem</label>
            <input type="number" step="0.001" value={form.permilagem} onChange={(e) => setForm({ ...form, permilagem: e.target.value })} placeholder="150.000" required />
          </div>
          <div className="field" style={{ width: 160 }}>
            <label>Tipo</label>
            <select value={form.fraction_type} onChange={(e) => setForm({ ...form, fraction_type: e.target.value })}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <button className="btn" style={{ marginBottom: '.9em' }}>Adicionar</button>
        </form>
      </div>

      <div className="stack">
        {fractions.map((f) => (
          <FractionCard key={f.id} fraction={f} condoId={selectedCondo.id}
            expanded={expanded === f.id} onToggle={() => { setExpanded(expanded === f.id ? null : f.id); setEditing(null) }}
            editing={editing === f.id} onEdit={() => { setEditing(editing === f.id ? null : f.id); setExpanded(null) }}
            onDelete={() => handleDelete(f)} onChanged={load} setNotice={setNotice} />
        ))}
        {fractions.length === 0 && <div className="empty">Ainda não há frações. Adiciona a primeira acima.</div>}
      </div>
    </div>
  )
}

function FractionCard({ fraction, condoId, expanded, onToggle, editing, onEdit, onDelete, onChanged, setNotice }) {
  const base = `/condominiums/${condoId}/fractions/${fraction.id}`
  const [owners, setOwners] = useState([])
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editForm, setEditForm] = useState({ identifier: fraction.identifier, permilagem: fraction.permilagem, fraction_type: fraction.fraction_type })
  const [newOwnerEmail, setNewOwnerEmail] = useState('')
  const [transfer, setTransfer] = useState(null) // { email, full_name, phone } quando o formulário está aberto
  const [ins, setIns] = useState({
    insurance_company: fraction.insurance_company || '',
    insurance_policy_number: fraction.insurance_policy_number || '',
    insurance_valid_until: fraction.insurance_valid_until || '',
  })
  const [editingIns, setEditingIns] = useState(false)

  async function loadOwners() { setOwners(await api.get(`${base}/owners`)) }
  useEffect(() => { if (expanded) loadOwners().catch((e) => setErr(e.message)) }, [expanded])
  useEffect(() => {
    setEditForm({ identifier: fraction.identifier, permilagem: fraction.permilagem, fraction_type: fraction.fraction_type })
  }, [fraction.id, fraction.identifier, fraction.permilagem, fraction.fraction_type])

  async function run(fn, okMsg) {
    setBusy(true); setErr(null)
    try {
      await fn()
      if (okMsg) setNotice(okMsg)
      await onChanged()
      if (expanded) await loadOwners()
      return true
    } catch (e) { setErr(e.message); return false } finally { setBusy(false) }
  }

  const saveEdit = (e) => {
    e.preventDefault()
    run(() => api.put(base, {
      identifier: editForm.identifier.trim(),
      permilagem: parseFloat(String(editForm.permilagem).replace(',', '.')),
      fraction_type: editForm.fraction_type,
    }), `Fração ${editForm.identifier.trim()} atualizada.`).then((ok) => ok && onEdit())
  }
  const invite = () => newOwnerEmail && run(async () => {
    await api.post(`${base}/owners`, { email: newOwnerEmail.trim(), ownership_share: 1, is_primary_contact: owners.length === 0 })
    setNewOwnerEmail('')
  })
  const removeOwner = (o) => {
    const who = o.user?.full_name || o.invited_email
    if (!window.confirm(`Tirar ${who} da fração ${fraction.identifier}?`)) return
    run(() => api.del(`${base}/owners/${o.id}`), `${who} deixou de estar associado(a) à fração ${fraction.identifier}.`)
  }
  const doTransfer = (e) => {
    e.preventDefault()
    const names = owners.map((o) => o.user?.full_name || o.invited_email).join(', ')
    if (!window.confirm(`Mudar o proprietário da fração ${fraction.identifier} para ${transfer.full_name || transfer.email}?${names ? `\n\n${names} deixa(m) de estar associado(s) a esta fração.` : ''}\nAs quotas e o histórico ficam na fração.`)) return
    run(async () => {
      await api.post(`${base}/transfer`, { email: transfer.email.trim(), full_name: transfer.full_name || undefined, phone: transfer.phone || undefined })
      setTransfer(null)
    }, `Proprietário da fração ${fraction.identifier} alterado.`)
  }
  const saveIns = () => run(async () => {
    await api.put(`${base}/insurance`, {
      insurance_company: ins.insurance_company || null,
      insurance_policy_number: ins.insurance_policy_number || null,
      insurance_valid_until: ins.insurance_valid_until || null,
    })
    setEditingIns(false)
  }, `Seguro da fração ${fraction.identifier} guardado.`)

  const typeLabel = (TYPES.find(([v]) => v === fraction.fraction_type) || [null, fraction.fraction_type])[1]

  return (
    <div className="card fraction-card">
      <div className="row between" style={{ alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>{fraction.identifier}</h3>
          <span className="hint" style={{ margin: 0 }}>{typeLabel} · {Number(fraction.permilagem).toFixed(3)}‰
            {fraction.insurance_company ? ` · seguro ${fraction.insurance_company}` : ''}</span>
        </div>
        <div className="row" style={{ gap: '.4rem' }}>
          <button className="btn secondary small" onClick={onEdit} aria-expanded={editing}>{editing ? 'Fechar' : 'Editar'}</button>
          <button className="btn secondary small" onClick={onToggle} aria-expanded={expanded}>{expanded ? 'Fechar' : 'Proprietários e seguro'}</button>
          <button className="btn danger small" onClick={onDelete}>Apagar</button>
        </div>
      </div>
      {err && <div className="msg error" style={{ marginTop: '.6rem' }}>{err}</div>}

      {editing && (
        <form onSubmit={saveEdit} className="row fraction-panel" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label>Identificador</label>
            <input value={editForm.identifier} onChange={(e) => setEditForm({ ...editForm, identifier: e.target.value })} required />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>Permilagem</label>
            <input type="number" step="0.001" min="0.001" value={editForm.permilagem} onChange={(e) => setEditForm({ ...editForm, permilagem: e.target.value })} required />
          </div>
          <div className="field" style={{ width: 160 }}>
            <label>Tipo</label>
            <select value={editForm.fraction_type} onChange={(e) => setEditForm({ ...editForm, fraction_type: e.target.value })}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <button className="btn small" disabled={busy} style={{ marginBottom: '.9em' }}>{busy ? 'A guardar…' : 'Guardar'}</button>
        </form>
      )}

      {expanded && (
        <div className="stack fraction-panel">
          <strong>Proprietários</strong>
          {owners.map((o) => (
            <div key={o.id} className="row between" style={{ alignItems: 'center' }}>
              <span>
                {o.user?.full_name || o.invited_email}{' '}
                {o.user?.email && <span className="hint">({o.user.email})</span>}{' '}
                {o.ownership_share < 1 && <span className="badge">{Math.round(o.ownership_share * 100)}%</span>}{' '}
                {o.is_primary_contact && <span className="badge ok">contacto principal</span>}{' '}
                {!o.user_id && <span className="badge warn">convite pendente</span>}
              </span>
              <button className="btn secondary small" disabled={busy} onClick={() => removeOwner(o)}>Remover</button>
            </div>
          ))}
          {owners.length === 0 && <p className="hint">Sem proprietário associado.</p>}

          {transfer ? (
            <form onSubmit={doTransfer} className="stack transfer-box">
              <strong>Mudar proprietário (ex: venda da fração)</strong>
              <span className="hint">Os proprietários atuais deixam de estar associados. As quotas, pagamentos e histórico ficam na fração.</span>
              <div className="row">
                <div className="field" style={{ flex: 2, minWidth: 200 }}>
                  <label>Email do novo proprietário *</label>
                  <input type="email" value={transfer.email} onChange={(e) => setTransfer({ ...transfer, email: e.target.value })} required />
                </div>
                <div className="field" style={{ flex: 2, minWidth: 180 }}>
                  <label>Nome</label>
                  <input value={transfer.full_name} onChange={(e) => setTransfer({ ...transfer, full_name: e.target.value })} placeholder="Obrigatório se for um condómino novo" />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 140 }}>
                  <label>Telemóvel</label>
                  <input type="tel" value={transfer.phone} onChange={(e) => setTransfer({ ...transfer, phone: e.target.value })} />
                </div>
              </div>
              <div className="row">
                <button className="btn small" disabled={busy}>{busy ? 'A guardar…' : 'Mudar proprietário'}</button>
                <button type="button" className="btn secondary small" onClick={() => setTransfer(null)}>Cancelar</button>
              </div>
            </form>
          ) : (
            <div className="row" style={{ gap: '.4rem', flexWrap: 'wrap' }}>
              <input type="email" placeholder="Acrescentar coproprietário: email@exemplo.pt" value={newOwnerEmail}
                onChange={(e) => setNewOwnerEmail(e.target.value)} className="inline-input" aria-label="Email do coproprietário" />
              <button className="btn small" disabled={busy || !newOwnerEmail} onClick={invite}>Acrescentar</button>
              <button className="btn secondary small" onClick={() => setTransfer({ email: '', full_name: '', phone: '' })}>Mudar proprietário…</button>
            </div>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '.4rem 0' }} />

          {editingIns ? (
            <div className="stack">
              <strong>Seguro da fração</strong>
              <div className="row">
                <div className="field" style={{ flex: 1, minWidth: 140 }}>
                  <label>Seguradora</label>
                  <input value={ins.insurance_company} onChange={(e) => setIns({ ...ins, insurance_company: e.target.value })} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 140 }}>
                  <label>Nº da apólice</label>
                  <input value={ins.insurance_policy_number} onChange={(e) => setIns({ ...ins, insurance_policy_number: e.target.value })} />
                </div>
                <div className="field" style={{ width: 160 }}>
                  <label>Válido até</label>
                  <input type="date" value={ins.insurance_valid_until || ''} onChange={(e) => setIns({ ...ins, insurance_valid_until: e.target.value })} />
                </div>
              </div>
              <div className="row">
                <button className="btn small" disabled={busy} onClick={saveIns}>{busy ? 'A guardar…' : 'Guardar seguro'}</button>
                <button className="btn secondary small" onClick={() => setEditingIns(false)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="row between" style={{ alignItems: 'center' }}>
              <span className="hint" style={{ margin: 0 }}>
                Seguro:{' '}
                {fraction.insurance_company
                  ? `${fraction.insurance_company}${fraction.insurance_policy_number ? ` (apólice ${fraction.insurance_policy_number})` : ''}${fraction.insurance_valid_until ? ` · válido até ${new Date(fraction.insurance_valid_until).toLocaleDateString('pt-PT')}` : ''}`
                  : 'não registado'}
              </span>
              <button className="btn secondary small" onClick={() => setEditingIns(true)}>Editar seguro</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
