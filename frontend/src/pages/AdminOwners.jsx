import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

export default function AdminOwners() {
  const { selectedCondo } = useCondo()
  const [owners, setOwners] = useState([])
  const [editing, setEditing] = useState(null) // id do condómino a editar
  const [form, setForm] = useState({ full_name: '', phone: '', is_active: true })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!selectedCondo) return
    setOwners(await api.get(`/condominiums/${selectedCondo.id}/owners`))
  }
  useEffect(() => { load() }, [selectedCondo])

  function startEdit(o) {
    setEditing(o.id)
    setForm({ full_name: o.full_name, phone: o.phone || '', is_active: o.is_active })
    setError(null)
  }

  async function saveEdit() {
    setBusy(true)
    setError(null)
    try {
      await api.put(`/condominiums/${selectedCondo.id}/owners/${editing}`, form)
      setEditing(null)
      load()
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function removeFraction(fractionId, ownerLinkId) {
    if (!confirm('Remover esta associação a esta fração?')) return
    await api.del(`/condominiums/${selectedCondo.id}/fractions/${fractionId}/owners/${ownerLinkId}`)
    load()
  }

  if (!selectedCondo) return null

  return (
    <div className="stack">
      <h1>Condóminos</h1>
      <p className="hint">Todos os condóminos registados neste condomínio (e convites ainda pendentes). Podes editar o nome e o telefone, ou desativar o acesso à aplicação sem apagar o registo.</p>

      <div className="stack">
        {owners.map((o) => (
          <div key={o.id} className="card">
            {editing === o.id ? (
              <div className="stack">
                {error && <div className="msg error">{error}</div>}
                <div className="row">
                  <div className="field" style={{ flex: 1 }}>
                    <label>Nome</label>
                    <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                  </div>
                  <div className="field" style={{ width: 180 }}>
                    <label>Telefone</label>
                    <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="912 345 678" />
                  </div>
                </div>
                <label className="row" style={{ gap: '.5em', fontWeight: 600, fontSize: '.9rem' }}>
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  Conta ativa (desmarca para bloquear o acesso deste condómino à aplicação)
                </label>
                <div className="row">
                  <button className="btn small" disabled={busy} onClick={saveEdit}>{busy ? 'A guardar…' : 'Guardar'}</button>
                  <button className="btn secondary small" onClick={() => setEditing(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: 0 }}>
                    {o.full_name}{' '}
                    {o.is_pending && <span className="badge warn">convite pendente</span>}
                    {!o.is_pending && !o.is_active && <span className="badge danger">conta desativada</span>}
                  </h3>
                  {!o.is_pending && <p className="hint" style={{ margin: '.2em 0' }}>{o.email}{o.phone ? ` · ${o.phone}` : ''}</p>}
                  <div className="row" style={{ gap: '.4rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
                    {o.fractions.map((f) => (
                      <span key={f.id} className="badge">
                        {f.fraction_identifier}
                        {!o.is_pending && (
                          <button
                            onClick={() => removeFraction(f.fraction_id, f.id)}
                            title="Remover esta associação"
                            style={{ marginLeft: '.4em', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', fontWeight: 700 }}
                          >×</button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
                {!o.is_pending && (
                  <button className="btn secondary small" onClick={() => startEdit(o)}>Editar ficha</button>
                )}
              </div>
            )}
          </div>
        ))}
        {owners.length === 0 && <div className="empty">Ainda não há condóminos associados. Convida-os em Frações → "Ver/gerir".</div>}
      </div>
    </div>
  )
}
