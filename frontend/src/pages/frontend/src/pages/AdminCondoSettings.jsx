import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

const EMPTY = {
  name: '', nif: '', address: '', postal_code: '', city: '', district: '', municipality: '',
  iban: '', construction_year: '', registry_number: '',
  insurance_company: '', insurance_policy_number: '', insurance_valid_until: '',
  external_management_name: '', external_management_contact: '',
}

export default function AdminCondoSettings() {
  const { selectedCondo, reload } = useCondo()
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!selectedCondo) return
    setForm({
      name: selectedCondo.name || '',
      nif: selectedCondo.nif || '',
      address: selectedCondo.address || '',
      postal_code: selectedCondo.postal_code || '',
      city: selectedCondo.city || '',
      district: selectedCondo.district || '',
      municipality: selectedCondo.municipality || '',
      iban: selectedCondo.iban || '',
      construction_year: selectedCondo.construction_year || '',
      registry_number: selectedCondo.registry_number || '',
      insurance_company: selectedCondo.insurance_company || '',
      insurance_policy_number: selectedCondo.insurance_policy_number || '',
      insurance_valid_until: selectedCondo.insurance_valid_until || '',
      external_management_name: selectedCondo.external_management_name || '',
      external_management_contact: selectedCondo.external_management_contact || '',
    })
    setSaved(false)
  }, [selectedCondo])

  function set(field, value) { setForm((f) => ({ ...f, [field]: value })); setSaved(false) }

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api.put(`/condominiums/${selectedCondo.id}`, {
        ...form,
        construction_year: form.construction_year ? parseInt(form.construction_year, 10) : null,
        insurance_valid_until: form.insurance_valid_until || null,
      })
      await reload()
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!selectedCondo) return null

  return (
    <div className="stack">
      <h1>Dados do condomínio</h1>
      <p className="hint">Ficha completa deste condomínio — usada em recibos, atas e para controlar prazos de seguro.</p>

      <div className="card" style={{ maxWidth: 640 }}>
        {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
        {saved && <div className="msg success" style={{ marginBottom: '1em' }}>Dados guardados.</div>}
        <form onSubmit={handleSubmit} className="stack">
          <div className="field">
            <label>Nome do condomínio *</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>NIF</label>
              <input value={form.nif} onChange={(e) => set('nif', e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>IBAN (para recibos)</label>
              <input value={form.iban} onChange={(e) => set('iban', e.target.value)} />
            </div>
          </div>

          <h3 style={{ margin: '.4em 0 0' }}>Morada</h3>
          <div className="field">
            <label>Morada completa</label>
            <input value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Código postal</label>
              <input value={form.postal_code} onChange={(e) => set('postal_code', e.target.value)} placeholder="0000-000" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Cidade</label>
              <input value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Concelho</label>
              <input value={form.municipality} onChange={(e) => set('municipality', e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Distrito</label>
              <input value={form.district} onChange={(e) => set('district', e.target.value)} />
            </div>
          </div>

          <h3 style={{ margin: '.4em 0 0' }}>Edifício</h3>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Ano de construção</label>
              <input type="number" value={form.construction_year} onChange={(e) => set('construction_year', e.target.value)} placeholder="1998" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Nº de registo predial / matriz</label>
              <input value={form.registry_number} onChange={(e) => set('registry_number', e.target.value)} />
            </div>
          </div>

          <h3 style={{ margin: '.4em 0 0' }}>Seguro do edifício</h3>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Seguradora</label>
              <input value={form.insurance_company} onChange={(e) => set('insurance_company', e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Nº da apólice</label>
              <input value={form.insurance_policy_number} onChange={(e) => set('insurance_policy_number', e.target.value)} />
            </div>
            <div className="field" style={{ width: 160 }}>
              <label>Válido até</label>
              <input type="date" value={form.insurance_valid_until} onChange={(e) => set('insurance_valid_until', e.target.value)} />
            </div>
          </div>

          <h3 style={{ margin: '.4em 0 0' }}>Administração externa (se houver)</h3>
          <p className="hint" style={{ margin: 0 }}>Preenche apenas se este condomínio delegar a gestão numa empresa/pessoa externa, além do administrador aqui registado.</p>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Nome da empresa / pessoa</label>
              <input value={form.external_management_name} onChange={(e) => set('external_management_name', e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Contacto (telefone/email)</label>
              <input value={form.external_management_contact} onChange={(e) => set('external_management_contact', e.target.value)} />
            </div>
          </div>

          <button className="btn" disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'A guardar…' : 'Guardar dados'}</button>
        </form>
      </div>
    </div>
  )
}
