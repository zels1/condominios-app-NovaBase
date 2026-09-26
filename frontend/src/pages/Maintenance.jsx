import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import { OccurrenceStatusBadge } from '../components/StatusBadge'

const STATUS_FLOW = ['reported', 'acknowledged', 'in_progress', 'resolved', 'closed']
const NEXT_LABEL = { reported: 'A caminho', acknowledged: 'A caminho', in_progress: 'Resolvido', resolved: 'Fechar' }
const PRIORITY_LABEL = { baixa: 'Prioridade baixa', normal: 'Prioridade normal', alta: 'Prioridade alta', urgente: 'Urgente' }
const PRIORITY_CLASS = { alta: 'warn', urgente: 'danger' }
const DEFAULT_MAX_MB = 5
const MAX_DIMENSION = 1600 // px — suficiente para ver bem a avaria, e muito mais leve

function formatMB(bytes) {
  return `${(bytes / 1048576).toLocaleString('pt-PT', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`
}

// Reduz a foto no próprio telemóvel/computador antes de enviar (JPEG, lado maior ≤ 1600 px).
// Se o browser não conseguir ler o formato (ex: HEIC no Chrome), envia o original.
async function shrinkImage(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (blob && blob.size < file.size) return blob
  } catch {
    // formato não suportado pelo browser — segue o original
  }
  return file
}

export default function Maintenance() {
  const { selectedCondo, isAdmin } = useCondo()
  const [occurrences, setOccurrences] = useState([])
  const [fractions, setFractions] = useState([])
  const [filter, setFilter] = useState('all') // all | open | mine
  const [form, setForm] = useState({ title: '', description: '', fraction_id: '', priority: 'normal' })
  const [photo, setPhoto] = useState(null) // { blob, preview, originalSize }
  const [photoBusy, setPhotoBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef(null)

  const maxMb = selectedCondo?.max_upload_mb || DEFAULT_MAX_MB
  const maxBytes = maxMb * 1048576

  async function load() {
    const occs = await api.get(`/condominiums/${selectedCondo.id}/occurrences`)
    setOccurrences(occs)
    if (isAdmin) setFractions(await api.get(`/condominiums/${selectedCondo.id}/fractions`))
  }
  useEffect(() => { if (selectedCondo) load().catch((e) => setError(e.message)) }, [selectedCondo])

  function clearPhoto() {
    if (photo?.preview) URL.revokeObjectURL(photo.preview)
    setPhoto(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handlePhotoPick(e) {
    const file = e.target.files?.[0]
    setError(null)
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Escolhe um ficheiro de imagem (foto).')
      clearPhoto()
      return
    }
    setPhotoBusy(true)
    const blob = await shrinkImage(file)
    setPhotoBusy(false)
    if (blob.size > maxBytes) {
      setError(`A foto tem ${formatMB(blob.size)} e o limite neste condomínio é ${maxMb} MB. Escolhe outra foto ou tira-a com menor resolução.`)
      clearPhoto()
      return
    }
    if (photo?.preview) URL.revokeObjectURL(photo.preview)
    setPhoto({ blob, preview: URL.createObjectURL(blob), originalSize: file.size })
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (!form.title.trim() && !photo) {
      setError('Descreve o que se passa ou junta uma foto.')
      return
    }
    setBusy(true)
    try {
      let photo_url
      if (photo) {
        const res = await api.upload(`/condominiums/${selectedCondo.id}/occurrences/photo`, photo.blob, photo.blob.type || 'image/jpeg')
        photo_url = res.url
      }
      const title = form.title.trim() || `Avaria reportada (${new Date().toLocaleString('pt-PT')})`
      await api.post(`/condominiums/${selectedCondo.id}/occurrences`, {
        title, description: form.description || undefined, photo_url,
        fraction_id: form.fraction_id || undefined, priority: form.priority,
      })
      setForm({ title: '', description: '', fraction_id: '', priority: 'normal' })
      clearPhoto()
      setNotice('Ocorrência reportada. A administração foi notificada.')
      load()
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function advance(occ) {
    const idx = STATUS_FLOW.indexOf(occ.status)
    const next = STATUS_FLOW[Math.min(idx + 1, STATUS_FLOW.length - 1)]
    try {
      await api.post(`/condominiums/${selectedCondo.id}/occurrences/${occ.id}/updates`, { status: next })
      load()
    } catch (err) { setError(err.message) }
  }

  if (!selectedCondo) return null

  const isOpen = (o) => o.status !== 'resolved' && o.status !== 'closed'
  const counts = {
    all: occurrences.length,
    open: occurrences.filter(isOpen).length,
    mine: occurrences.filter((o) => o.reported_by_me).length,
  }
  const visible = occurrences.filter((o) => (filter === 'open' ? isOpen(o) : filter === 'mine' ? o.reported_by_me : true))

  return (
    <div className="stack">
      <h1>Manutenção e Ocorrências</h1>

      <div className="card">
        <h3>Reportar uma avaria — tira uma foto e envia</h3>
        {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
        {notice && <div className="msg success" style={{ marginBottom: '1em' }}>{notice}</div>}
        <form onSubmit={handleCreate} className="stack">
          <div className="field">
            <label htmlFor="occ-photo">Foto (opcional, mas ajuda muito o administrador)</label>
            <input id="occ-photo" ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoPick} disabled={photoBusy || busy} />
            <span className="hint">Tamanho máximo: <strong>{maxMb} MB</strong>. As fotos grandes são reduzidas automaticamente antes de enviar.</span>
            {photoBusy && <span className="hint">A preparar a foto…</span>}
            {photo && (
              <div className="photo-preview">
                <img src={photo.preview} alt="Pré-visualização da foto" />
                <div>
                  <div className="hint" style={{ margin: 0 }}>
                    {formatMB(photo.blob.size)}
                    {photo.originalSize > photo.blob.size && ` (reduzida de ${formatMB(photo.originalSize)})`}
                  </div>
                  <button type="button" className="btn secondary small" onClick={clearPhoto} style={{ marginTop: '.4em' }}>Remover foto</button>
                </div>
              </div>
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
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy || photoBusy}>{busy ? 'A enviar…' : 'Reportar'}</button>
        </form>
      </div>

      <div className="row between" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '.6rem' }}>
        <h2 style={{ margin: 0 }}>Ocorrências do condomínio</h2>
        <div className="filter-tabs" role="tablist" aria-label="Filtrar ocorrências">
          {[['all', 'Todas'], ['open', 'Em aberto'], ['mine', 'Por mim']].map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key}
              className={`filter-tab${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)}>
              {label} <span className="filter-count">{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="stack">
        {visible.map((o) => (
          <div key={o.id} className="card">
            <div className="row between" style={{ alignItems: 'flex-start', gap: '.8rem' }}>
              <div className="row" style={{ alignItems: 'flex-start', gap: '.8rem', flexWrap: 'nowrap', minWidth: 0 }}>
                {o.photo_url && (
                  <a href={o.photo_url} target="_blank" rel="noreferrer" title="Ver foto em tamanho real" style={{ flexShrink: 0 }}>
                    <img src={o.photo_url} alt={`Foto: ${o.title}`} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                  </a>
                )}
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0 }}>{o.title}</h3>
                  <div className="row" style={{ gap: '.35rem', flexWrap: 'wrap', marginTop: '.3em' }}>
                    <span className="badge">{o.fraction_identifier ? `Fração ${o.fraction_identifier}` : 'Zona comum'}</span>
                    <span className={`badge ${PRIORITY_CLASS[o.priority] || ''}`}>{PRIORITY_LABEL[o.priority] || o.priority}</span>
                  </div>
                  {o.description && <p style={{ marginTop: '.4em' }}>{o.description}</p>}
                  <p className="hint">
                    Reportada por <strong>{o.reported_by_me ? 'mim' : (o.reporter_name || 'condómino')}</strong>
                    {' '}em {new Date(o.created_at).toLocaleDateString('pt-PT')}
                  </p>
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
        {visible.length === 0 && (
          <div className="empty">
            {filter === 'mine' ? 'Ainda não reportaste nenhuma ocorrência.' : filter === 'open' ? 'Não há ocorrências em aberto. 👍' : 'Sem ocorrências reportadas.'}
          </div>
        )}
      </div>
    </div>
  )
}
