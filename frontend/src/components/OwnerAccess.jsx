import { useEffect, useState } from 'react'
import { api } from '../lib/api'

// Acesso de um condómino à aplicação: criar a conta de login com palavra-passe,
// mudar a palavra-passe ou apagar o acesso (a ficha e o histórico ficam).

function generatePassword() {
  // sem caracteres que se confundem (0/O, 1/l/I), fácil de ditar
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const all = letters + digits
  const rnd = new Uint32Array(12)
  crypto.getRandomValues(rnd)
  let out = ''
  for (let i = 0; i < 12; i++) out += all[rnd[i] % all.length]
  // garante pelo menos um algarismo e uma letra
  return out.slice(0, 10) + digits[rnd[10] % digits.length] + letters[rnd[11] % letters.length]
}

function fmt(dt) {
  return dt ? new Date(dt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : null
}

export default function OwnerAccess({ condoId, owner, onChanged }) {
  const base = `/condominiums/${condoId}/owners/${owner.id}`
  const [info, setInfo] = useState(null)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null) // { text, password? }

  async function load() {
    try { setInfo(await api.get(`${base}/account`)) } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [owner.id])

  async function submit(e) {
    e.preventDefault()
    setErr(null); setDone(null)
    if (password.length < 8) { setErr('A palavra-passe tem de ter pelo menos 8 caracteres.'); return }
    setBusy(true)
    try {
      if (info.has_account) {
        await api.put(`${base}/password`, { password })
        setDone({ text: 'Palavra-passe alterada. As sessões que o condómino já tenha abertas continuam até expirarem.', password })
      } else {
        await api.post(`${base}/account`, { password })
        setDone({ text: `Acesso criado. O condómino entra com o email ${owner.email} e esta palavra-passe:`, password })
      }
      setPassword(''); setShow(false)
      await load(); await onChanged?.()
    } catch (e2) { setErr(e2.message) }
    setBusy(false)
  }

  async function removeAccess() {
    if (!window.confirm(`Apagar o acesso de ${owner.full_name}? Deixa de conseguir entrar na aplicação. A ficha, as frações e o histórico ficam.`)) return
    setBusy(true); setErr(null); setDone(null)
    try {
      await api.del(`${base}/account`)
      setDone({ text: 'Acesso apagado. Podes voltar a criar um novo acesso quando quiseres.' })
      await load(); await onChanged?.()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  if (!info) return err ? <div className="msg error">{err}</div> : <p className="hint">A carregar…</p>

  return (
    <div className="stack">
      <div className="access-status">
        <div>
          <strong>{owner.full_name}</strong>
          <div className="hint" style={{ margin: 0 }}>{owner.email}</div>
        </div>
        {info.has_account
          ? <span className="badge income">Tem acesso</span>
          : <span className="badge">Sem acesso</span>}
      </div>
      {info.has_account && (
        <p className="hint" style={{ margin: 0 }}>
          {info.last_sign_in_at ? `Último acesso: ${fmt(info.last_sign_in_at)}.` : 'Ainda não entrou na aplicação.'}
          {!info.is_active && ' A ficha está desativada: mesmo com acesso, não consegue usar a aplicação.'}
        </p>
      )}

      {err && <div className="msg error">{err}</div>}
      {done && (
        <div className="msg success">
          {done.text}
          {done.password && (
            <div className="row" style={{ gap: '.4rem', alignItems: 'center', marginTop: '.4rem' }}>
              <code className="password-shown">{done.password}</code>
              <button type="button" className="btn secondary small"
                onClick={() => navigator.clipboard?.writeText(done.password)}>Copiar</button>
            </div>
          )}
          {done.password && <div className="hint" style={{ margin: '.4rem 0 0' }}>Guarda-a agora: depois de fechares esta janela já não é possível vê-la. Recomenda ao condómino que a mude no primeiro acesso ("Esqueci-me da palavra-passe").</div>}
        </div>
      )}

      <form onSubmit={submit} className="stack">
        <div className="field">
          <label htmlFor="acc-pw">{info.has_account ? 'Nova palavra-passe' : 'Palavra-passe do novo acesso'}</label>
          <div className="row" style={{ gap: '.4rem', flexWrap: 'nowrap' }}>
            <div className="password-wrap" style={{ flex: 1 }}>
              <input id="acc-pw" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                minLength={8} maxLength={72} autoComplete="new-password" required />
              <button type="button" className="password-toggle" onClick={() => setShow((v) => !v)}
                aria-pressed={show} aria-label={show ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'}>{show ? 'Ocultar' : 'Mostrar'}</button>
            </div>
            <button type="button" className="btn secondary small" onClick={() => { setPassword(generatePassword()); setShow(true) }}>Gerar</button>
          </div>
          <span className="hint" style={{ margin: 0 }}>Pelo menos 8 caracteres, com letras e números.</span>
        </div>
        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          {info.has_account
            ? <button type="button" className="btn danger small" disabled={busy} onClick={removeAccess}>Apagar acesso</button>
            : <span />}
          <button className="btn small" disabled={busy}>
            {busy ? 'A guardar…' : info.has_account ? 'Alterar palavra-passe' : 'Criar acesso'}
          </button>
        </div>
      </form>
    </div>
  )
}
