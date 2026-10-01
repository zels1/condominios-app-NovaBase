import { useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

// Cópia de segurança: descarrega um ZIP com todos os dados (e, se quiser, os ficheiros).
// Em browsers que o permitem (Chrome, Edge), o administrador escolhe a pasta e o nome.
const canChoose = typeof window !== 'undefined' && 'showSaveFilePicker' in window

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export default function Backup() {
  const { me, condominiums, isAdmin } = useCondo()
  const [includeFiles, setIncludeFiles] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const superAdmin = me?.role === 'super_admin'

  async function run() {
    setMsg(null)
    const suggested = `domvus-copia-${stamp()}.zip`
    let handle = null
    if (canChoose) {
      // tem de ser pedido logo no clique, antes de preparar a cópia
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: suggested,
          types: [{ description: 'Cópia de segurança (ZIP)', accept: { 'application/zip': ['.zip'] } }],
        })
      } catch (e) {
        if (e?.name === 'AbortError') return // cancelou a escolha
        handle = null
      }
    }
    setBusy(true)
    try {
      const { blob, filename } = await api.fetchFile(`/backup?include_files=${includeFiles}`, suggested)
      if (handle) {
        const w = await handle.createWritable()
        await w.write(blob)
        await w.close()
        setMsg({ type: 'success', text: `Cópia de segurança guardada como "${handle.name}" (${(blob.size / 1048576).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} MB).` })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = filename
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
        setMsg({ type: 'success', text: `Cópia de segurança descarregada: ${filename}. Está na pasta de transferências do browser.` })
      }
    } catch (e) {
      setMsg({ type: 'error', text: `Não foi possível criar a cópia: ${e.message}` })
    }
    setBusy(false)
  }

  if (!isAdmin) return <div className="empty">Só o administrador pode criar cópias de segurança.</div>

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Cópia de segurança</h1>
          <p className="subtitle">Descarrega uma cópia dos dados para guardar onde quiseres.</p>
        </div>
      </div>

      <div className="card stack">
        <p style={{ margin: 0 }}>
          A cópia inclui {superAdmin
            ? <strong>todos os dados da plataforma</strong>
            : <>os dados dos <strong>{condominiums.length} condomínio(s) que geres</strong> ({condominiums.map((c) => c.name).join(', ')})</>}:
          frações, condóminos, quotas, pagamentos, despesas, fornecedores, manutenção, ocorrências, assembleias, documentos, etc.
        </p>
        <p className="hint" style={{ margin: 0 }}>
          É um ficheiro ZIP com uma tabela por ficheiro, em JSON (para restaurar ou migrar) e em CSV (abre no Excel).
          As palavras-passe não são incluídas — continuam guardadas no Supabase.
        </p>
        <label className="remember" style={{ margin: 0 }}>
          <input type="checkbox" checked={includeFiles} onChange={(e) => setIncludeFiles(e.target.checked)} />
          Incluir também os ficheiros carregados (fotos, documentos, apólices, contratos) — demora mais e o ZIP fica maior
        </label>
        <div className="row" style={{ gap: '.6rem', alignItems: 'center' }}>
          <button className="btn" disabled={busy} onClick={run}>
            {busy ? 'A preparar a cópia…' : canChoose ? '⬇ Escolher onde guardar e criar cópia' : '⬇ Descarregar cópia de segurança'}
          </button>
          {!canChoose && <span className="hint">Neste browser o ficheiro vai para a pasta de transferências (no Chrome ou Edge podes escolher a pasta).</span>}
        </div>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <p className="hint" style={{ margin: 0 }}>
          ⚠ A cópia contém dados pessoais dos condóminos (RGPD): guarda-a num local seguro e privado, por exemplo um disco encriptado ou uma pasta com acesso restrito.
        </p>
      </div>
    </div>
  )
}
