import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

export default function Documents() {
  const { selectedCondo, isAdmin } = useCondo()
  const [docs, setDocs] = useState([])
  const [comms, setComms] = useState([])
  const [docForm, setDocForm] = useState({ title: '', category: '', file_url: '', expires_at: '' })
  const [commForm, setCommForm] = useState({ title: '', body: '' })

  async function load() {
    const [d, c] = await Promise.all([
      api.get(`/condominiums/${selectedCondo.id}/documents`),
      api.get(`/condominiums/${selectedCondo.id}/communications`),
    ])
    setDocs(d); setComms(c)
  }
  useEffect(() => { if (selectedCondo) load() }, [selectedCondo])

  async function addDoc(e) {
    e.preventDefault()
    await api.post(`/condominiums/${selectedCondo.id}/documents`, { ...docForm, expires_at: docForm.expires_at || undefined })
    setDocForm({ title: '', category: '', file_url: '', expires_at: '' })
    load()
  }

  async function sendComm(e) {
    e.preventDefault()
    await api.post(`/condominiums/${selectedCondo.id}/communications`, commForm)
    setCommForm({ title: '', body: '' })
    load()
  }

  if (!selectedCondo) return null

  return (
    <div className="stack">
      <h1>Documentos e Comunicados</h1>

      {isAdmin && (
        <div className="card">
          <h3>Adicionar documento</h3>
          <p className="hint">Cola o link do ficheiro (ex: link partilhado do Google Drive, Dropbox, etc.)</p>
          <form onSubmit={addDoc} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, minWidth: 140 }}><label>Título *</label><input value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} required /></div>
            <div className="field" style={{ width: 140 }}><label>Categoria</label><input value={docForm.category} onChange={(e) => setDocForm({ ...docForm, category: e.target.value })} placeholder="ata, seguro…" /></div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}><label>Link *</label><input value={docForm.file_url} onChange={(e) => setDocForm({ ...docForm, file_url: e.target.value })} required type="url" /></div>
            <div className="field" style={{ width: 150 }}><label>Expira em</label><input type="date" value={docForm.expires_at} onChange={(e) => setDocForm({ ...docForm, expires_at: e.target.value })} /></div>
            <button className="btn" style={{ marginBottom: '.9em' }}>Adicionar</button>
          </form>
        </div>
      )}

      <div className="card">
        <h3>Documentos</h3>
        <div className="stack">
          {docs.map((d) => (
            <div key={d.id} className="row between">
              <a href={d.file_url} target="_blank" rel="noreferrer">📄 {d.title}</a>
              <span className="hint">{d.category}</span>
            </div>
          ))}
          {docs.length === 0 && <p className="hint">Sem documentos.</p>}
        </div>
      </div>

      {isAdmin && (
        <div className="card">
          <h3>Enviar comunicado</h3>
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
              <p style={{ margin: '.2em 0' }}>{c.body}</p>
              <span className="hint">{new Date(c.created_at).toLocaleDateString('pt-PT')}</span>
            </div>
          ))}
          {comms.length === 0 && <p className="hint">Sem comunicados.</p>}
        </div>
      </div>
    </div>
  )
}
