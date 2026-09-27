import { useId, useRef, useState } from 'react'

function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1048576).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} MB`
}

// Escolha de ficheiro com um botão igual aos restantes botões da app.
// Também aceita arrastar e largar o ficheiro em cima. onFile(file|null).
export default function FilePicker({
  accept, onFile, file, disabled, label = 'Escolher ficheiro', emptyText = 'Nenhum ficheiro escolhido',
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

  return (
    <div
      className={`file-picker${dragging ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (!disabled && e.dataTransfer.files?.[0]) pick(e.dataTransfer.files[0]) }}
    >
      <input ref={inputRef} id={id} type="file" accept={accept} capture={capture} disabled={disabled}
        className="file-picker-input" onChange={(e) => pick(e.target.files?.[0])} />
      <div className="file-picker-row">
        {preview && file && <img src={preview} alt="" className="file-picker-thumb" />}
        <label htmlFor={id} className={`btn secondary${file ? " small" : ""}`} aria-disabled={disabled}>{file ? "Trocar" : label}</label>
        <span className="file-picker-status">
          {file ? <><strong>{file.name || 'Ficheiro'}</strong> · {formatSize(file.size)}</> : emptyText}
        </span>
        {file && <button type="button" className="btn secondary small" onClick={() => pick(null)} disabled={disabled}>Remover</button>}
      </div>
      {hint && <span className="file-picker-hint">{hint}</span>}
    </div>
  )
}
