import { useId, useRef, useState } from 'react'

function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1048576).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} MB`
}

// Escolha de ficheiro com botão bonito + arrastar e largar.
// onFile(file|null) é chamado com o ficheiro escolhido (ou null ao remover).
export default function FilePicker({
  accept, onFile, file, disabled, label = 'Escolher ficheiro', icon = '📎',
  hint, preview, id: idProp, capture,
}) {
  const autoId = useId()
  const id = idProp || `file-${autoId}`
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  function pick(f) {
    if (inputRef.current) inputRef.current.value = ''
    onFile(f || null)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    const f = e.dataTransfer.files?.[0]
    if (f) pick(f)
  }

  return (
    <div
      className={`file-picker${dragging ? ' dragging' : ''}${file ? ' has-file' : ''}${disabled ? ' disabled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef} id={id} type="file" accept={accept} capture={capture} disabled={disabled}
        className="file-picker-input" onChange={(e) => pick(e.target.files?.[0])}
      />
      {file ? (
        <div className="file-picker-chosen">
          {preview
            ? <img src={preview} alt="" className="file-picker-thumb" />
            : <span className="file-picker-icon" aria-hidden="true">📄</span>}
          <div className="file-picker-info">
            <span className="file-picker-name">{file.name || 'Ficheiro'}</span>
            <span className="file-picker-size">{formatSize(file.size)}</span>
          </div>
          <div className="file-picker-actions">
            <label htmlFor={id} className="btn secondary small" aria-disabled={disabled}>Trocar</label>
            <button type="button" className="btn secondary small" onClick={() => pick(null)} disabled={disabled}>Remover</button>
          </div>
        </div>
      ) : (
        <div className="file-picker-empty">
          <label htmlFor={id} className="btn file-picker-button" aria-disabled={disabled}>
            <span aria-hidden="true">{icon}</span> {label}
          </label>
          <span className="file-picker-drop">ou arrasta o ficheiro para aqui</span>
        </div>
      )}
      {hint && <span className="file-picker-hint">{hint}</span>}
    </div>
  )
}
