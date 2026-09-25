import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

export default function AdminFractions() {
  const { selectedCondo } = useCondo()
  const [fractions, setFractions] = useState([])
  const [check, setCheck] = useState(null)
  const [form, setForm] = useState({ identifier: '', permilagem: '', fraction_type: 'habitação' })
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)

  async function load() {
    if (!selectedCondo) return
    const [fs, c] = await Promise.all([
      api.get(`/condominiums/${selectedCondo.id}/fractions`),
      api.get(`/condominiums/${selectedCondo.id}/fractions/permilagem-check`),
    ])
    setFractions(fs); setCheck(c)
  }

  useEffect(() => { load() }, [selectedCondo])

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    try {
      await api.post(`/condominiums/${selectedCondo.id}/fractions`, {
        identifier: form.identifier,
        permilagem: parseFloat(form.permilagem),
        fraction_type: form.fraction_type,
      })
      setForm({ identifier: '', permilagem: '', fraction_type: 'habitação' })
      load()
    } catch (err) { setError(err.message) }
  }

  async function handleRemove(id) {
    if (!confirm('Desativar esta fração?')) return
    await api.del(`/condominiums/${selectedCondo.id}/fractions/${id}`)
    load()
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

      <div className="card">
        <h3>Adicionar fração</h3>
        {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
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
              <option value="habitação">Habitação</option>
              <option value="comércio">Comércio</option>
              <option value="garagem">Garagem</option>
              <option value="arrumos">Arrumos</option>
            </select>
          </div>
          <button className="btn" style={{ marginBottom: '.9em' }}>Adicionar</button>
        </form>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Fração</th><th>Tipo</th><th>Permilagem</th><th>Proprietários</th><th></th></tr></thead>
            <tbody>
              {fractions.map((f) => (
                <FractionRow key={f.id} fraction={f} condoId={selectedCondo.id}
                  expanded={expanded === f.id} onToggle={() => setExpanded(expanded === f.id ? null : f.id)}
                  onRemove={() => handleRemove(f.id)} onChanged={load} />
              ))}
              {fractions.length === 0 && <tr><td colSpan={5} className="empty">Ainda não há frações. Adiciona a primeira acima.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function FractionRow({ fraction, condoId, expanded, onToggle, onRemove, onChanged }) {
  const [owners, setOwners] = useState([])
  const [newOwnerEmail, setNewOwnerEmail] = useState('')
  const [inviteError, setInviteError] = useState(null)
  const [inviteBusy, setInviteBusy] = useState(false)

  useEffect(() => {
    if (expanded) api.get(`/condominiums/${condoId}/fractions/${fraction.id}/owners`).then(setOwners)
  }, [expanded])

  async function handleInvite() {
    if (!newOwnerEmail) return
    setInviteBusy(true)
    setInviteError(null)
    try {
      await api.post(`/condominiums/${condoId}/fractions/${fraction.id}/owners`, { email: newOwnerEmail, ownership_share: 1, is_primary_contact: true })
      setNewOwnerEmail('')
      api.get(`/condominiums/${condoId}/fractions/${fraction.id}/owners`).then(setOwners)
      onChanged()
    } catch (err) { setInviteError(err.message) }
    setInviteBusy(false)
  }

  return (
    <>
      <tr>
        <td>{fraction.identifier}</td>
        <td>{fraction.fraction_type}</td>
        <td>{Number(fraction.permilagem).toFixed(3)}‰</td>
        <td>
          <button className="btn secondary small" onClick={onToggle}>{expanded ? 'Fechar' : 'Ver/gerir'}</button>
        </td>
        <td><button className="btn danger small" onClick={onRemove}>Desativar</button></td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} style={{ background: 'var(--bg)' }}>
            <div className="stack" style={{ padding: '.6rem 0' }}>
              {owners.map((o) => (
                <div key={o.id} className="row between">
                  <span>
                    {o.user?.full_name || o.invited_email}{' '}
                    {o.is_primary_contact && <span className="badge ok">contacto principal</span>}{' '}
                    {!o.user_id && <span className="badge warn">convite pendente</span>}
                  </span>
                </div>
              ))}
              {owners.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Sem proprietário associado ainda.</p>}
              <p className="hint">
                Basta o email — se a pessoa ainda não tiver conta, fica como "convite pendente" e liga-se
                sozinha assim que ela criar a conta com esse mesmo email.
              </p>
              {inviteError && <div className="msg error">{inviteError}</div>}
              <div className="row">
                <input type="email" placeholder="email@exemplo.pt" value={newOwnerEmail} onChange={(e) => setNewOwnerEmail(e.target.value)} style={{ flex: 1, padding: '.5em', borderRadius: 8, border: '1px solid var(--border)' }} />
                <button className="btn small" disabled={inviteBusy} onClick={handleInvite}>{inviteBusy ? 'A convidar…' : 'Convidar'}</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
