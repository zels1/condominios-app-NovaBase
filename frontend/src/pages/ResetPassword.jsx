import { useState } from 'react'
import { useAuth, friendlyAuthError } from '../lib/AuthContext'
import DomvusLogo from '../components/DomvusLogo'

// Ecrã mostrado quando a pessoa abre o link "recuperar palavra-passe" recebido por email.
export default function ResetPassword() {
  const { user, updatePassword, signOut, isInvite } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) { setError('A palavra-passe tem de ter pelo menos 6 caracteres.'); return }
    if (password !== confirm) { setError('As duas palavras-passe não são iguais.'); return }
    setBusy(true)
    try {
      const { error } = await updatePassword(password)
      if (error) throw error
      // sucesso: o contexto sai do modo de recuperação e a app abre normalmente
    } catch (err) {
      setError(friendlyAuthError(err))
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <div className="auth-brand"><DomvusLogo size={36} stacked /></div>
        <h1>{isInvite ? 'Bem-vindo(a) à Domvus' : 'Nova palavra-passe'}</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          {isInvite
            ? <>Foste convidado(a) pelo administrador do teu condomínio. Escolhe uma palavra-passe para <strong>{user?.email}</strong> — é com ela que vais entrar na aplicação.</>
            : <>Escolhe uma nova palavra-passe para <strong>{user?.email}</strong>.</>}
        </p>
        {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
        <form onSubmit={handleSubmit} className="stack">
          <input type="email" name="email" value={user?.email || ''} autoComplete="username" readOnly hidden />
          <div className="field">
            <label htmlFor="new-password">Nova palavra-passe</label>
            <div className="password-wrap">
              <input id="new-password" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                required minLength={6} autoComplete="new-password" autoFocus />
              <button type="button" className="password-toggle" onClick={() => setShow((v) => !v)}
                aria-pressed={show} aria-label={show ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'}>
                {show ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            <span className="hint">Mínimo 6 caracteres.</span>
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Repetir a nova palavra-passe</label>
            <input id="confirm-password" type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)}
              required minLength={6} autoComplete="new-password" />
          </div>
          <button className="btn block" disabled={busy}>{busy ? 'A guardar…' : 'Guardar e entrar'}</button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '.9rem' }}>
          <button type="button" className="link-button" onClick={signOut}>Cancelar</button>
        </p>
      </div>
    </div>
  )
}
