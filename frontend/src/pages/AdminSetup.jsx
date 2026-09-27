import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import DomvusLogo from '../components/DomvusLogo'

const TYPES = [['habitação', 'Habitação'], ['comércio', 'Comércio'], ['garagem', 'Garagem'], ['arrumos', 'Arrumos']]
const NAMING = [
  ['floors', 'Andares (R/C Esq, R/C Dto, 1º Esq…)'],
  ['letters', 'Letras (A, B, C…)'],
  ['numbers', 'Números (1, 2, 3…)'],
]

function identifierFor(scheme, i) {
  if (scheme === 'letters') {
    let n = i, s = ''
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
    return s
  }
  if (scheme === 'numbers') return String(i + 1)
  const floor = Math.floor(i / 2)
  return `${floor === 0 ? 'R/C' : `${floor}º`} ${i % 2 === 0 ? 'Esq' : 'Dto'}`
}

// Reparte 1000‰ em partes iguais (3 casas decimais); a última absorve o arredondamento.
function evenPermilagem(n) {
  if (n <= 0) return []
  const each = Math.floor((1000 / n) * 1000) / 1000
  const arr = Array(n).fill(each)
  arr[n - 1] = Math.round((1000 - each * (n - 1)) * 1000) / 1000
  return arr
}

const emptyRow = (identifier, permilagem) => ({ identifier, permilagem: String(permilagem), fraction_type: 'habitação', owner_name: '', owner_email: '', owner_phone: '' })

export default function AdminSetup() {
  const { reload, setSelectedId, condominiums } = useCondo()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', nif: '', address: '', postal_code: '', city: '', iban: '' })
  const [count, setCount] = useState('')
  const [scheme, setScheme] = useState('floors')
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function set(field, value) { setForm((f) => ({ ...f, [field]: value })) }

  function generate(n = parseInt(count, 10), sch = scheme) {
    if (!n || n < 1) { setRows([]); return }
    const n2 = Math.min(n, 300)
    const perm = evenPermilagem(n2)
    // mantém o que já foi escrito nas linhas existentes (proprietários, tipos)
    setRows((old) => Array.from({ length: n2 }, (_, i) => ({
      ...(old[i] || emptyRow('', 0)),
      identifier: identifierFor(sch, i),
      permilagem: String(perm[i]),
    })))
  }

  function setRow(i, field, value) { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r))) }
  function addRow() {
    setRows((rs) => [...rs, emptyRow(identifierFor(scheme, rs.length), 0)])
    setCount(String(rows.length + 1))
  }
  function removeRow(i) {
    setRows((rs) => rs.filter((_, j) => j !== i))
    setCount(String(Math.max(0, rows.length - 1)))
  }
  function spreadEvenly() { const p = evenPermilagem(rows.length); setRows((rs) => rs.map((r, i) => ({ ...r, permilagem: String(p[i]) }))) }

  const total = rows.reduce((t, r) => t + (parseFloat(String(r.permilagem).replace(',', '.')) || 0), 0)
  const balanced = rows.length === 0 || Math.abs(total - 1000) < 0.0005

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    const missingEmail = rows.find((r) => r.owner_name.trim() && !r.owner_email.trim())
    if (missingEmail) { setError(`Fração ${missingEmail.identifier}: falta o email do proprietário.`); return }
    if (!balanced && !window.confirm(`A soma da permilagem é ${total.toFixed(3)}‰ (devia ser 1000‰). Criar mesmo assim? Podes corrigir depois em Frações.`)) return
    setBusy(true)
    try {
      const condo = await api.post('/condominiums', {
        ...form,
        fractions: rows.map((r) => ({
          identifier: r.identifier.trim(),
          permilagem: parseFloat(String(r.permilagem).replace(',', '.')),
          fraction_type: r.fraction_type,
          owner_name: r.owner_name.trim() || undefined,
          owner_email: r.owner_email.trim() || undefined,
          owner_phone: r.owner_phone.trim() || undefined,
        })),
      })
      await reload()
      setSelectedId(condo.id)
      navigate(rows.length ? '/' : '/fracoes')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup-screen">
      <div className="setup-brand"><DomvusLogo size={26} /></div>
      <form onSubmit={handleSubmit} className="stack setup-form">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Novo condomínio</h1>
          <p className="hint">Preenche os dados principais. Tudo pode ser ajustado depois.</p>
          {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
          <div className="field">
            <label>Nome do condomínio *</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="Ex: Edifício Central" />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: 150 }}>
              <label>NIF</label>
              <input value={form.nif} onChange={(e) => set('nif', e.target.value)} inputMode="numeric" />
            </div>
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label>IBAN (para constar nos recibos)</label>
              <input value={form.iban} onChange={(e) => set('iban', e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Morada</label>
            <input value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label>Código postal</label>
              <input value={form.postal_code} onChange={(e) => set('postal_code', e.target.value)} placeholder="0000-000" />
            </div>
            <div className="field" style={{ flex: 2, minWidth: 160 }}>
              <label>Cidade</label>
              <input value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Frações e proprietários</h2>
          <p className="hint">Indica quantas frações tem o prédio. A permilagem é repartida por igual — ajusta-a se as frações forem diferentes. O proprietário é opcional: quando criar conta com esse email, fica logo ligado à fração.</p>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ width: 170 }}>
              <label htmlFor="n-fractions">Número de frações</label>
              <input id="n-fractions" type="number" min={1} max={300} value={count}
                onChange={(e) => { setCount(e.target.value); generate(parseInt(e.target.value, 10)) }} placeholder="Ex: 8" />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label>Identificação</label>
              <div className="filter-tabs" role="tablist" aria-label="Identificação das frações">
                {NAMING.map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={scheme === k} className={`filter-tab${scheme === k ? ' active' : ''}`}
                    onClick={() => { setScheme(k); if (rows.length) generate(rows.length, k) }}>{l}</button>
                ))}
              </div>
            </div>
          </div>

          {rows.length > 0 && (
            <>
              <div className="setup-rows">
                <div className="setup-row setup-head" aria-hidden="true">
                  <span>Fração</span><span>Tipo</span><span>Permilagem ‰</span><span>Proprietário</span><span>Email</span><span>Telemóvel</span><span />
                </div>
                {rows.map((r, i) => (
                  <div key={i} className="setup-row">
                    <input aria-label={`Fração ${i + 1}: identificação`} value={r.identifier} onChange={(e) => setRow(i, 'identifier', e.target.value)} required />
                    <select aria-label={`Fração ${i + 1}: tipo`} value={r.fraction_type} onChange={(e) => setRow(i, 'fraction_type', e.target.value)}>
                      {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <input aria-label={`Fração ${i + 1}: permilagem`} type="number" step="0.001" min="0.001" value={r.permilagem} onChange={(e) => setRow(i, 'permilagem', e.target.value)} required />
                    <input aria-label={`Fração ${i + 1}: nome do proprietário`} placeholder="Nome (opcional)" value={r.owner_name} onChange={(e) => setRow(i, 'owner_name', e.target.value)} />
                    <input aria-label={`Fração ${i + 1}: email do proprietário`} type="email" placeholder="email@exemplo.pt" value={r.owner_email} onChange={(e) => setRow(i, 'owner_email', e.target.value)} />
                    <input aria-label={`Fração ${i + 1}: telemóvel do proprietário`} type="tel" placeholder="Telemóvel" value={r.owner_phone} onChange={(e) => setRow(i, 'owner_phone', e.target.value)} />
                    <button type="button" className="btn secondary small" onClick={() => removeRow(i)} aria-label={`Remover fração ${r.identifier}`}>✕</button>
                  </div>
                ))}
              </div>
              <div className="row between" style={{ alignItems: 'center', marginTop: '.8rem', gap: '.6rem' }}>
                <div className="row" style={{ gap: '.4rem' }}>
                  <button type="button" className="btn secondary small" onClick={addRow}>+ Adicionar fração</button>
                  <button type="button" className="btn secondary small" onClick={spreadEvenly}>Repartir permilagem por igual</button>
                </div>
                <span className={`badge ${balanced ? 'ok' : 'warn'}`}>Soma: {total.toFixed(3)}‰ {balanced ? '✓' : '(devia ser 1000‰)'}</span>
              </div>
            </>
          )}
        </div>

        <div className="row" style={{ gap: '.6rem' }}>
          <button className="btn" disabled={busy}>{busy ? 'A criar…' : rows.length ? `Criar condomínio com ${rows.length} frações` : 'Criar condomínio'}</button>
          {condominiums.length > 0 && <button type="button" className="btn secondary" onClick={() => navigate(-1)}>Cancelar</button>}
        </div>
      </form>
    </div>
  )
}
