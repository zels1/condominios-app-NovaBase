import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

const EMPTY_PROFILE = {
  full_name: '', email: '', phone: '', landline_phone: '', nif: '', correspondence_address: '', iban: '', notes: '',
}
const EMPTY_NEW = { ...EMPTY_PROFILE, fraction_id: '', ownership_share: '100', is_primary_contact: true }

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('pt-PT') : '' }

// Campos da ficha, usados em "Adicionar", "Editar" e "Completar convite"
function ProfileFields({ form, setForm, emailHint }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <>
      <div className="row">
        <div className="field" style={{ flex: 2, minWidth: 200 }}>
          <label>Nome *</label>
          <input value={form.full_name} onChange={set('full_name')} required />
        </div>
        <div className="field" style={{ flex: 2, minWidth: 220 }}>
          <label>Email *</label>
          <input type="email" value={form.email} onChange={set('email')} required />
          {emailHint && <span className="hint">{emailHint}</span>}
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1, minWidth: 150 }}>
          <label>Telemóvel</label>
          <input type="tel" value={form.phone} onChange={set('phone')} placeholder="912 345 678" />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 150 }}>
          <label>Telefone fixo</label>
          <input type="tel" value={form.landline_phone} onChange={set('landline_phone')} placeholder="213 456 789" />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>NIF</label>
          <input value={form.nif} onChange={set('nif')} placeholder="123456789" inputMode="numeric" />
        </div>
      </div>
      <div className="field">
        <label>Morada (para correspondência)</label>
        <input value={form.correspondence_address} onChange={set('correspondence_address')} placeholder="Rua, nº, andar, código postal, localidade" />
        <span className="hint">Deixa vazio se a correspondência for para a própria fração.</span>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label>IBAN (para reembolsos)</label>
          <input value={form.iban} onChange={set('iban')} placeholder="PT50 ..." />
        </div>
      </div>
      <div className="field">
        <label>Notas / observações</label>
        <textarea rows={2} value={form.notes} onChange={set('notes')} />
      </div>
    </>
  )
}

export default function AdminOwners() {
  const { selectedCondo } = useCondo()
  const [owners, setOwners] = useState([])
  const [fractions, setFractions] = useState([])
  const [editing, setEditing] = useState(null) // id do condómino (ou "pending-…") em edição
  const [form, setForm] = useState({ ...EMPTY_PROFILE, is_active: true })
  const [insurance, setInsurance] = useState({}) // fraction_id -> {insurance_company, ...}
  const [adding, setAdding] = useState(false)
  const [newForm, setNewForm] = useState(EMPTY_NEW)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')

  async function load() {
    if (!selectedCondo) return
    const [o, f] = await Promise.all([
      api.get(`/condominiums/${selectedCondo.id}/owners`),
      api.get(`/condominiums/${selectedCondo.id}/fractions`),
    ])
    setOwners(o); setFractions(f)
  }
  useEffect(() => { load().catch((e) => setError(e.message)) }, [selectedCondo])

  function startEdit(o) {
    setAdding(false)
    setEditing(o.id)
    setNotice(null)
    setForm({
      full_name: o.is_pending ? '' : o.full_name,
      email: o.email || '',
      phone: o.phone || '',
      landline_phone: o.landline_phone || '',
      nif: o.nif || '',
      correspondence_address: o.correspondence_address || '',
      iban: o.iban || '',
      notes: o.notes || '',
      is_active: o.is_active,
    })
    const ins = {}
    o.fractions.forEach((f) => {
      ins[f.fraction_id] = {
        insurance_company: f.insurance_company || '',
        insurance_policy_number: f.insurance_policy_number || '',
        insurance_valid_until: f.insurance_valid_until || '',
      }
    })
    setInsurance(ins)
    setError(null)
  }

  async function saveEdit(o) {
    setBusy(true)
    setError(null)
    try {
      const base = `/condominiums/${selectedCondo.id}`
      if (o.is_pending) {
        const { is_active, ...profile } = form // eslint-disable-line no-unused-vars
        await api.put(`${base}/owners/pending/${o.id.replace('pending-', '')}`, profile)
      } else {
        await api.put(`${base}/owners/${o.id}`, form)
      }
      // seguro de cada fração (só as que mudaram)
      for (const f of o.fractions) {
        const now = insurance[f.fraction_id]
        if (!now) continue
        const before = [f.insurance_company || '', f.insurance_policy_number || '', f.insurance_valid_until || '']
        const after = [now.insurance_company, now.insurance_policy_number, now.insurance_valid_until]
        if (before.join('|') !== after.join('|')) {
          await api.put(`${base}/fractions/${f.fraction_id}/insurance`, {
            insurance_company: now.insurance_company || null,
            insurance_policy_number: now.insurance_policy_number || null,
            insurance_valid_until: now.insurance_valid_until || null,
          })
        }
      }
      setEditing(null)
      setNotice(`Ficha de ${form.full_name} guardada.`)
      await load()
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function addOwner(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const share = Math.min(100, Math.max(1, parseFloat(String(newForm.ownership_share).replace(',', '.')) || 100)) / 100
      await api.post(`/condominiums/${selectedCondo.id}/owners`, { ...newForm, ownership_share: share })
      setNotice(`${newForm.full_name} adicionado(a). Quando criar conta com ${newForm.email}, fica logo ligado(a) a esta ficha.`)
      setNewForm(EMPTY_NEW)
      setAdding(false)
      await load()
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function removeFraction(fractionId, ownerLinkId) {
    if (!confirm('Remover esta associação a esta fração?')) return
    try {
      await api.del(`/condominiums/${selectedCondo.id}/fractions/${fractionId}/owners/${ownerLinkId}`)
      load()
    } catch (err) { setError(err.message) }
  }

  if (!selectedCondo) return null

  const q = query.trim().toLowerCase()
  const visible = owners.filter((o) => !q || [o.full_name, o.email, o.phone, o.landline_phone, o.nif, ...o.fractions.map((f) => f.fraction_identifier)]
    .some((v) => (v || '').toLowerCase().includes(q)))

  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '.6rem' }}>
        <h1 style={{ margin: 0 }}>Condóminos</h1>
        {!adding && (
          <button className="btn" onClick={() => { setAdding(true); setEditing(null); setError(null); setNotice(null) }}>+ Adicionar condómino</button>
        )}
      </div>
      <p className="hint">Fichas dos condóminos deste condomínio (e convites ainda pendentes). Podes adicionar condóminos, editar os contactos e o seguro de cada fração, ou desativar o acesso à aplicação sem apagar o registo.</p>
      {notice && <div className="msg success">{notice}</div>}
      {error && !editing && <div className="msg error">{error}</div>}

      {adding && (
        <div className="card">
          <h3>Novo condómino</h3>
          <form onSubmit={addOwner} className="stack">
            <ProfileFields form={newForm} setForm={setNewForm}
              emailHint="Quando a pessoa criar conta com este email, fica automaticamente ligada a esta ficha." />
            <div className="row">
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label>Fração *</label>
                <select value={newForm.fraction_id} onChange={(e) => setNewForm({ ...newForm, fraction_id: e.target.value })} required>
                  <option value="">Selecionar…</option>
                  {fractions.map((f) => <option key={f.id} value={f.id}>{f.identifier}</option>)}
                </select>
              </div>
              <div className="field" style={{ width: 150 }}>
                <label>Quota de propriedade (%)</label>
                <input type="number" min={1} max={100} step="any" value={newForm.ownership_share}
                  onChange={(e) => setNewForm({ ...newForm, ownership_share: e.target.value })} />
              </div>
            </div>
            <label className="remember" style={{ margin: 0 }}>
              <input type="checkbox" checked={newForm.is_primary_contact} onChange={(e) => setNewForm({ ...newForm, is_primary_contact: e.target.checked })} />
              Contacto principal da fração (recebe as quotas e comunicações)
            </label>
            <div className="row">
              <button className="btn small" disabled={busy}>{busy ? 'A guardar…' : 'Adicionar condómino'}</button>
              <button type="button" className="btn secondary small" onClick={() => { setAdding(false); setError(null) }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {owners.length > 3 && (
        <div className="field" style={{ margin: 0, maxWidth: 360 }}>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Procurar por nome, email, telefone, NIF ou fração…" aria-label="Procurar condómino" />
        </div>
      )}

      <div className="stack">
        {visible.map((o) => (
          <div key={o.id} className="card">
            {editing === o.id ? (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); saveEdit(o) }}>
                <h3 style={{ margin: 0 }}>{o.is_pending ? 'Completar ficha do convite' : `Editar ficha — ${o.full_name}`}</h3>
                {error && <div className="msg error">{error}</div>}
                <ProfileFields form={form} setForm={setForm}
                  emailHint={o.is_pending
                    ? 'Podes corrigir o email do convite.'
                    : o.has_login
                      ? 'Esta pessoa já tem conta: ao mudar o email, passa a entrar na app com o novo email.'
                      : 'Ainda não criou conta: vai poder criá-la com este email.'} />

                {o.fractions.length > 0 && (
                  <div className="stack" style={{ gap: '.6rem' }}>
                    <h4 style={{ margin: '.3em 0 0' }}>Seguro da fração</h4>
                    {o.fractions.map((f) => {
                      const ins = insurance[f.fraction_id] || {}
                      const setIns = (k) => (e) => setInsurance({ ...insurance, [f.fraction_id]: { ...ins, [k]: e.target.value } })
                      return (
                        <div key={f.id} className="row" style={{ alignItems: 'flex-end' }}>
                          <span className="badge" style={{ marginBottom: '1.1em' }}>{f.fraction_identifier}</span>
                          <div className="field" style={{ flex: 1, minWidth: 140 }}>
                            <label>Seguradora</label>
                            <input value={ins.insurance_company || ''} onChange={setIns('insurance_company')} placeholder="Ex: Fidelidade" />
                          </div>
                          <div className="field" style={{ flex: 1, minWidth: 140 }}>
                            <label>Nº da apólice</label>
                            <input value={ins.insurance_policy_number || ''} onChange={setIns('insurance_policy_number')} />
                          </div>
                          <div className="field" style={{ width: 160 }}>
                            <label>Válida até</label>
                            <input type="date" value={ins.insurance_valid_until || ''} onChange={setIns('insurance_valid_until')} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {!o.is_pending && (
                  <label className="remember" style={{ margin: 0 }}>
                    <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                    Conta ativa (desmarca para bloquear o acesso deste condómino à aplicação)
                  </label>
                )}
                <div className="row">
                  <button className="btn small" disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</button>
                  <button type="button" className="btn secondary small" onClick={() => { setEditing(null); setError(null) }}>Cancelar</button>
                </div>
              </form>
            ) : (
              <div className="row between" style={{ alignItems: 'flex-start', gap: '.8rem' }}>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0 }}>
                    {o.full_name}{' '}
                    {o.is_pending && <span className="badge warn">convite pendente</span>}
                    {!o.is_pending && !o.is_active && <span className="badge danger">conta desativada</span>}
                    {!o.is_pending && o.is_active && !o.has_login && <span className="badge">ainda não entrou na app</span>}
                  </h3>
                  <p className="hint" style={{ margin: '.2em 0', overflowWrap: 'anywhere' }}>
                    {[o.is_pending ? null : o.email, o.phone && `📱 ${o.phone}`, o.landline_phone && `☎️ ${o.landline_phone}`].filter(Boolean).join(' · ')}
                  </p>
                  {(o.nif || o.iban) && (
                    <p className="hint" style={{ margin: '.2em 0' }}>
                      {[o.nif && `NIF: ${o.nif}`, o.iban && `IBAN: ${o.iban}`].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {o.correspondence_address && <p className="hint" style={{ margin: '.2em 0' }}>Morada: {o.correspondence_address}</p>}
                  {o.notes && <p className="hint" style={{ margin: '.2em 0' }}>Notas: {o.notes}</p>}
                  <div className="stack" style={{ gap: '.3rem', marginTop: '.5rem' }}>
                    {o.fractions.map((f) => (
                      <div key={f.id} className="row" style={{ gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="badge">
                          {f.fraction_identifier}
                          {f.ownership_share < 1 && ` · ${Math.round(f.ownership_share * 100)}%`}
                          {!o.is_pending && (
                            <button onClick={() => removeFraction(f.fraction_id, f.id)} title="Remover esta associação" aria-label={`Remover associação à fração ${f.fraction_identifier}`}
                              style={{ marginLeft: '.4em', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', fontWeight: 700 }}>×</button>
                          )}
                        </span>
                        <span className="hint" style={{ margin: 0 }}>
                          {f.insurance_company
                            ? `Seguro: ${f.insurance_company}${f.insurance_policy_number ? `, apólice ${f.insurance_policy_number}` : ''}${f.insurance_valid_until ? ` · válido até ${fmtDate(f.insurance_valid_until)}` : ''}`
                            : 'Sem seguro registado'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <button className="btn secondary small" onClick={() => startEdit(o)} style={{ flexShrink: 0 }}>
                  {o.is_pending ? 'Completar ficha' : 'Editar ficha'}
                </button>
              </div>
            )}
          </div>
        ))}
        {owners.length === 0 && !adding && <div className="empty">Ainda não há condóminos. Carrega em "+ Adicionar condómino".</div>}
        {owners.length > 0 && visible.length === 0 && <div className="empty">Nenhum condómino corresponde à pesquisa.</div>}
      </div>
    </div>
  )
}
