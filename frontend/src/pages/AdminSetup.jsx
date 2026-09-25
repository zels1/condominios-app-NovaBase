import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

export default function AdminSetup() {
  const { reload, setSelectedId } = useCondo()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', nif: '', address: '', postal_code: '', city: '', iban: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function set(field, value) { setForm((f) => ({ ...f, [field]: value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const condo = await api.post('/condominiums', form)
      await reload()
      setSelectedId(condo.id)
      navigate('/fracoes')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="card auth-card" style={{ maxWidth: 460 }}>
        <h1>Novo condomínio</h1>
        <p style={{ color: 'var(--text-muted)' }}>Cria o primeiro condomínio que vais gerir. Podes ajustar tudo depois.</p>
        {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
        <form onSubmit={handleSubmit} className="stack">
          <div className="field">
            <label>Nome do condomínio *</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="Ex: Edifício Central" />
          </div>
          <div className="field">
            <label>NIF</label>
            <input value={form.nif} onChange={(e) => set('nif', e.target.value)} />
          </div>
          <div className="field">
            <label>Morada</label>
            <input value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Código postal</label>
              <input value={form.postal_code} onChange={(e) => set('postal_code', e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Cidade</label>
              <input value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>IBAN (para constar nos recibos)</label>
            <input value={form.iban} onChange={(e) => set('iban', e.target.value)} />
          </div>
          <button className="btn block" disabled={busy}>{busy ? 'A criar…' : 'Criar condomínio'}</button>
        </form>
      </div>
    </div>
  )
}
