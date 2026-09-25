import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useCondo } from '../lib/CondoContext'
import { OccurrenceStatusBadge } from '../components/StatusBadge'

const STATUS_FLOW = ['reported', 'acknowledged', 'in_progress', 'resolved', 'closed']
const STATUS_LABEL = { reported: 'Recebido', acknowledged: 'A caminho', in_progress: 'A caminho', resolved: 'Resolvido', closed: 'Fechada' }
const NEXT_LABEL = { reported: 'A caminho', acknowledged: 'A caminho', in_progress: 'Resolvido', resolved: 'Fechar' }
const PHOTO_BUCKET = 'occurrence-photos'

async function uploadPhoto(file) {
  const path = `${crypto.randomUUID()}-${file.name}`
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file)
  if (error) throw new Error(`Não foi possível enviar a foto: ${error.message}`)
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export default function Maintenance() {
  const { selectedCondo, isAdmin } = useCondo()
  const [occurrences, setOccurrences] = useState([])
  const [fractions, setFractions] = useState([])
  const [form, setForm] = useState({ title: '', description: '', fraction_id: '', priority: 'normal' })
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef(null)

  async function load() {
    const occs = await api.get(`/condominiums/${selectedCondo.id}/occurrences`)
    setOccurrences(occs)
    if (isAdmin) setFractions(await api.get(`/condominiums/${selectedCondo.id}/fractions`))
  }
  useEffect(() => { if (selectedCondo) load() }, [selectedCondo])

  function handlePhotoPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      let photo_url
      if (photoFile) photo_url = await uploadPhoto(photoFile)
      const title = form.title || `Avaria reportada (${new Date().toLocaleString('pt-PT')})`
      await api.post(`/condominiums/${selectedCondo.id}/occurrences`, {
        title, description: form.description || undefined, photo_url,
        fraction_id: form.fraction_id || undefined, priority: form.priority,
      })
      setForm({ title: '', description: '', fraction_id: '', priority: 'normal' })
      setPhotoFile(null); setPhotoPreview(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      load()
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function advance(occ) {
    const idx = STATUS_FLOW.indexOf(occ.status)
    const next = STATUS_FLOW[Math.min(idx + 1, STATUS_FLOW.length - 1)]
    await api.post(`/condominiums/${selectedCondo.id}/occurrences/${occ.id}/updates`, { status: next })
    load()
  }

  if (!selectedCondo) return null

  return (
    <div className="stack">
      <h1>Manutenção e Ocorrências</h1>

      <div className="card">
        <h3>Reportar uma avaria — tira uma foto e envia</h3>
        {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
        <form onSubmit={handleCreate} className="stack">
          <div className="field">
            <label>Foto (opcional, mas ajuda muito o administrador)</label>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoPick} />
            {photoPreview && (
              <img src={photoPreview} alt="Pré-visualização da foto" style={{ maxWidth: 220, borderRadius: 8, marginTop: '.4em' }} />
            )}
          </div>
          <div className="field">
            <label>O que se passa? (opcional se enviares foto)</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex: Torneira a pingar nas partes comuns" />
          </div>
          <div className="field">
            <label>Mais detalhes (opcional)</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="row">
            {isAdmin && (
              <div className="field" style={{ flex: 1 }}>
                <label>Fração (opcional — zona comum se vazio)</label>
                <select value={form.fraction_id} onChange={(e) => setForm({ ...form, fraction_id: e.target.value })}>
                  <option value="">Zona comum</option>
                  {fractions.map((f) => <option key={f.id} value={f.id}>{f.identifier}</option>)}
                </select>
              </div>
            )}
            <div className="field" style={{ width: 160 }}>
              <label>Prioridade</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
          </div>
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy}>{busy ? 'A enviar…' : 'Reportar'}</button>
        </form>
      </div>

      <div className="stack">
        {occurrences.map((o) => (
          <div key={o.id} className="card">
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div className="row" style={{ alignItems: 'flex-start', gap: '.8rem' }}>
                {o.photo_url && (
                  <img src={o.photo_url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                )}
                <div>
                  <h3 style={{ margin: 0 }}>{o.title}</h3>
                  <span className="badge">{o.priority}</span>
                  {o.description && <p style={{ marginTop: '.4em' }}>{o.description}</p>}
                  <p className="hint">Reportada em {new Date(o.created_at).toLocaleDateString('pt-PT')}</p>
                </div>
              </div>
              <OccurrenceStatusBadge status={o.status} />
            </div>

            <div className="row" style={{ gap: '.5rem', flexWrap: 'wrap', marginTop: '.6rem' }}>
              {['Recebido', 'A caminho', 'Resolvido'].map((label, i) => {
                const doneIdx = o.status === 'reported' ? 0 : (o.status === 'acknowledged' || o.status === 'in_progress') ? 1 : 2
                const done = i <= doneIdx
                return (
                  <span key={label} className={`badge ${done ? 'ok' : ''}`} style={{ opacity: done ? 1 : 0.5 }}>
                    {i > 0 && '→ '}{label}
                  </span>
                )
              })}
            </div>

            {isAdmin && o.status !== 'closed' && (
              <button className="btn secondary small" style={{ marginTop: '.6rem' }} onClick={() => advance(o)}>
                Avançar para "{NEXT_LABEL[o.status]}"
              </button>
            )}
          </div>
        ))}
        {occurrences.length === 0 && <div className="empty">Sem ocorrências reportadas.</div>}
      </div>
    </div>
  )
}
