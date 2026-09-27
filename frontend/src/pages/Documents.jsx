import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import FilePicker from '../components/FilePicker'

const MAX_DOCUMENT_MB = 20
const CATEGORIES = ['Ata', 'Regulamento', 'Seguro', 'Contrato', 'Orçamento', 'Relatório de contas', 'Certificado', 'Outro']
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.odt,.ods,.txt'
// Tipos que o servidor aceita, a partir da extensão (alguns browsers não indicam o tipo)
const EXT_TYPES = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', txt: 'text/plain',
}
const EMPTY_DOC = { title: '', category: '', file_url: '', expires_at: '' }

function formatMB(bytes) {
  return `${(bytes / 1048576).toLocaleString('pt-PT', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`
}
function fileIcon(d) {
  const u = (d.file_url || '').toLowerCase().split('?')[0]
  if (u.endsWith('.pdf')) return '📕'
  if (/\.(jpe?g|png|webp)$/.test(u)) return '🖼️'
  if (/\.(xlsx?|ods)$/.test(u)) return '📊'
  return d.is_file ? '📄' : '🔗'
}

export default function Documents() {
  const { selectedCondo, isAdmin } = useCondo()
  const [docs, setDocs] = useState([])
  const [comms, setComms] = useState([])
  const [docForm, setDocForm] = useState(EMPTY_DOC)
  const [source, setSource] = useState('file') // file | link
  const [file, setFile] = useState(null)
  const [docError, setDocError] = useState(null)
  const [docNotice, setDocNotice] = useState(null)
  const [docBusy, setDocBusy] = useState(false)
  const [commForm, setCommForm] = useState({ title: '', body: '' })
  const [commError, setCommError] = useState(null)
  const [loadError, setLoadError] = useState(null)

  async function load() {
    try {
      const [d, c] = await Promise.all([
        api.get(`/condominiums/${selectedCondo.id}/documents`),
        api.get(`/condominiums/${selectedCondo.id}/communications`),
      ])
      setDocs(d); setComms(c); setLoadError(null)
    } catch (err) { setLoadError(err.message) }
  }
  useEffect(() => { if (selectedCondo) load() }, [selectedCondo])

  function pickFile(f) {
    setDocError(null)
    if (!f) { setFile(null); return }
    const ext = f.name.split('.').pop().toLowerCase()
    if (!EXT_TYPES[ext]) {
      setDocError('Tipo de ficheiro não suportado. Usa PDF, imagem, Word, Excel, OpenDocument ou texto.')
      setFile(null); return
    }
    if (f.size > MAX_DOCUMENT_MB * 1048576) {
      setDocError(`O ficheiro tem ${formatMB(f.size)} e o máximo é ${MAX_DOCUMENT_MB} MB.`)
      setFile(null); return
    }
    setFile(f)
    // sugere o título a partir do nome do ficheiro
    if (!docForm.title) setDocForm((d) => ({ ...d, title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') }))
  }

  async function addDoc(e) {
    e.preventDefault()
    setDocError(null); setDocNotice(null)
    if (source === 'file' && !file) { setDocError('Escolhe o ficheiro a anexar.'); return }
    setDocBusy(true)
    try {
      let file_url = docForm.file_url.trim()
      if (source === 'file') {
        const ext = file.name.split('.').pop().toLowerCase()
        const res = await api.upload(
          `/condominiums/${selectedCondo.id}/documents/upload?filename=${encodeURIComponent(file.name)}`,
          file, EXT_TYPES[ext]
        )
        file_url = res.file_ref
      }
      await api.post(`/condominiums/${selectedCondo.id}/documents`, {
        title: docForm.title.trim(), category: docForm.category || undefined, file_url,
        expires_at: docForm.expires_at || undefined,
      })
      setDocForm(EMPTY_DOC); setFile(null)
      setDocNotice('Documento adicionado. Já está visível para os condóminos.')
      load()
    } catch (err) { setDocError(err.message) }
    setDocBusy(false)
  }

  async function removeDoc(d) {
    if (!window.confirm(`Apagar o documento "${d.title}"? Os condóminos deixam de o ver.`)) return
    try {
      await api.del(`/condominiums/${selectedCondo.id}/documents/${d.id}`)
      load()
    } catch (err) { setDocError(err.message) }
  }

  async function sendComm(e) {
    e.preventDefault()
    setCommError(null)
    try {
      await api.post(`/condominiums/${selectedCondo.id}/communications`, commForm)
      setCommForm({ title: '', body: '' })
      load()
    } catch (err) { setCommError(err.message) }
  }

  if (!selectedCondo) return null
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="stack">
      <h1>Documentos e Comunicados</h1>
      {loadError && <div className="msg error">{loadError}</div>}

      {isAdmin && (
        <div className="card">
          <h3>Adicionar documento</h3>
          {docError && <div className="msg error" style={{ marginBottom: '1em' }}>{docError}</div>}
          {docNotice && <div className="msg success" style={{ marginBottom: '1em' }}>{docNotice}</div>}
          <div className="filter-tabs" role="tablist" aria-label="Origem do documento" style={{ marginBottom: '1rem' }}>
            <button type="button" role="tab" aria-selected={source === 'file'} className={`filter-tab${source === 'file' ? ' active' : ''}`} onClick={() => setSource('file')}>📎 Anexar ficheiro</button>
            <button type="button" role="tab" aria-selected={source === 'link'} className={`filter-tab${source === 'link' ? ' active' : ''}`} onClick={() => setSource('link')}>🔗 Colar link</button>
          </div>
          <form onSubmit={addDoc} className="stack">
            {source === 'file' ? (
              <div className="field">
                <label htmlFor="doc-file">Ficheiro *</label>
                <FilePicker id="doc-file" accept={ACCEPT} file={file} onFile={pickFile} disabled={docBusy}
                  hint={<>PDF, imagem, Word, Excel, OpenDocument ou texto. Máximo <strong>{MAX_DOCUMENT_MB} MB</strong>.</>} />
              </div>
            ) : (
              <div className="field">
                <label htmlFor="doc-link">Link *</label>
                <input id="doc-link" value={docForm.file_url} onChange={(e) => setDocForm({ ...docForm, file_url: e.target.value })} required type="url" placeholder="https://drive.google.com/…" />
                <span className="hint">Link partilhado do Google Drive, Dropbox, OneDrive, etc.</span>
              </div>
            )}
            <div className="row">
              <div className="field" style={{ flex: 2, minWidth: 180 }}>
                <label htmlFor="doc-title">Título *</label>
                <input id="doc-title" value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} required placeholder="Ex: Ata da assembleia de março 2026" />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label htmlFor="doc-cat">Categoria</label>
                <select id="doc-cat" value={docForm.category} onChange={(e) => setDocForm({ ...docForm, category: e.target.value })}>
                  <option value="">—</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label htmlFor="doc-exp">Expira em</label>
                <input id="doc-exp" type="date" value={docForm.expires_at} onChange={(e) => setDocForm({ ...docForm, expires_at: e.target.value })} />
              </div>
            </div>
            <span className="hint" style={{ marginTop: '-.6em' }}>"Expira em" é opcional — útil para seguros e certificados (aparece nos alertas do Resumo).</span>
            <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={docBusy}>
              {docBusy ? (source === 'file' ? 'A enviar ficheiro…' : 'A guardar…') : 'Adicionar documento'}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <h3>Documentos</h3>
        <div className="doc-list">
          {docs.map((d) => (
            <div key={d.id} className="doc-item">
              <span className="doc-icon" aria-hidden="true">{fileIcon(d)}</span>
              <div className="doc-main">
                {d.file_url
                  ? <a href={d.file_url} target="_blank" rel="noreferrer" className="doc-title">{d.title}</a>
                  : <span className="doc-title">{d.title} <span className="hint">(indisponível de momento)</span></span>}
                <div className="doc-meta">
                  {d.category && <span className="badge">{d.category}</span>}
                  <span>{new Date(d.created_at).toLocaleDateString('pt-PT')}</span>
                  {d.expires_at && (
                    <span className={`badge ${d.expires_at < today ? 'danger' : 'warn'}`}>
                      {d.expires_at < today ? 'Expirou' : 'Expira'} a {new Date(d.expires_at).toLocaleDateString('pt-PT')}
                    </span>
                  )}
                  {!d.is_file && <span>link externo</span>}
                </div>
              </div>
              {isAdmin && (
                <button type="button" className="btn secondary small" onClick={() => removeDoc(d)} aria-label={`Apagar ${d.title}`}>Apagar</button>
              )}
            </div>
          ))}
          {docs.length === 0 && <p className="hint">Sem documentos.</p>}
        </div>
      </div>

      {isAdmin && (
        <div className="card">
          <h3>Enviar comunicado</h3>
          {commError && <div className="msg error" style={{ marginBottom: '1em' }}>{commError}</div>}
          <form onSubmit={sendComm} className="stack">
            <div className="field"><label>Título *</label><input value={commForm.title} onChange={(e) => setCommForm({ ...commForm, title: e.target.value })} required /></div>
            <div className="field"><label>Mensagem *</label><textarea rows={3} value={commForm.body} onChange={(e) => setCommForm({ ...commForm, body: e.target.value })} required /></div>
            <button className="btn" style={{ alignSelf: 'flex-start' }}>Enviar a todos os condóminos</button>
          </form>
        </div>
      )}

      <div className="card">
        <h3>Comunicados</h3>
        <div className="stack">
          {comms.map((c) => (
            <div key={c.id} style={{ borderTop: '1px solid var(--border)', paddingTop: '.6rem' }}>
              <strong>{c.title}</strong>
              <p style={{ margin: '.2em 0', whiteSpace: 'pre-line' }}>{c.body}</p>
              <span className="hint">{new Date(c.created_at).toLocaleDateString('pt-PT')}</span>
            </div>
          ))}
          {comms.length === 0 && <p className="hint">Sem comunicados.</p>}
        </div>
      </div>
    </div>
  )
}
