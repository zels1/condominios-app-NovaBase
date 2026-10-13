import { useRef, useState } from 'react'
import { useAuth, friendlyAuthError } from '../lib/AuthContext'
import DomvusLogo from '../components/DomvusLogo'

// Contas usadas recentemente neste dispositivo (só o email — nunca a palavra-passe).
const RECENT_KEY = 'recentLoginEmails'
const MAX_RECENT = 5

function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(list) ? list.filter((e) => typeof e === 'string') : []
  } catch {
    return []
  }
}

function saveRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* sem localStorage */ }
}

export default function Login() {
  const { signInWithPassword, requestPasswordReset, linkError } = useAuth()
  const [mode, setMode] = useState('signin') // signin | forgot (as contas são criadas pela administração)
  const [recent, setRecent] = useState(loadRecent)
  const [email, setEmail] = useState(() => loadRecent()[0] || '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const passwordRef = useRef(null)
  const [error, setError] = useState(linkError)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null); setNotice(null); setBusy(true)
    try {
      if (mode === 'forgot') {
        const { error } = await requestPasswordReset(email)
        if (error) throw error
        // Não revelamos se o email existe ou não (evita descobrir quem tem conta)
        setNotice(`Se existir uma conta com ${email.trim()}, vais receber um email com um link para definir uma nova palavra-passe. Verifica também a pasta de spam.`)
        setMode('signin')
      } else {
        const { error } = await signInWithPassword(email, password)
        if (error) throw error
        rememberEmail(email, remember)
      }
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  function switchMode(next) {
    setMode(next)
    setError(null)
    setNotice(null)
    setPassword('')
  }

  function rememberEmail(value, keep) {
    const clean = value.trim().toLowerCase()
    const others = loadRecent().filter((e) => e !== clean)
    const next = keep ? [clean, ...others].slice(0, MAX_RECENT) : others
    saveRecent(next)
    setRecent(next)
  }

  function pickRecent(value) {
    setEmail(value)
    setPassword('')
    setError(null)
    setTimeout(() => passwordRef.current?.focus(), 0)
  }

  function forgetRecent(value) {
    rememberEmail(value, false)
    if (email === value) setEmail('')
  }

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <div className="auth-brand">
          <DomvusLogo size={44} stacked />
        </div>
        <p style={{ color: 'var(--text-muted)' }}>
          {mode === 'signin' && 'Inicia sessão para continuar.'}
          {mode === 'forgot' && 'Indica o teu email e enviamos-te um link para definires uma nova palavra-passe.'}
        </p>

        {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
        {notice && <div className="msg success" style={{ marginBottom: '1em' }}>{notice}</div>}

        {mode === 'signin' && recent.length > 0 && (
          <div className="recent-accounts">
            <span className="recent-title">Entrar como</span>
            {recent.map((r) => (
              <div key={r} className={`recent-item${r === email.trim().toLowerCase() ? ' selected' : ''}`}>
                <button type="button" className="recent-pick" onClick={() => pickRecent(r)}>
                  <span className="recent-avatar" aria-hidden="true">{r[0]?.toUpperCase()}</span>
                  <span className="recent-email">{r}</span>
                </button>
                <button type="button" className="recent-forget" onClick={() => forgetRecent(r)}
                  aria-label={`Esquecer ${r} neste dispositivo`} title="Esquecer neste dispositivo">✕</button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="stack">
          <div className="field">
            <label>Email</label>
            <input type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              autoComplete="username" />
          </div>
          {mode !== 'forgot' && (
          <div className="field">
            <div className="label-row">
              <label>Palavra-passe</label>
              {mode === 'signin' && (
                <button type="button" className="link-button small" onClick={() => switchMode('forgot')}>Esqueci-me da palavra-passe</button>
              )}
            </div>
            <div className="password-wrap">
              <input ref={passwordRef} type={showPassword ? 'text' : 'password'} name="password" value={password}
                onChange={(e) => setPassword(e.target.value)} required
                autoComplete="current-password" />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword} aria-label={showPassword ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'}>
                {showPassword ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
          </div>
          )}
          {mode === 'signin' && (
            <label className="remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Lembrar este email neste dispositivo
            </label>
          )}
          <button className="btn block" disabled={busy}>
            {busy ? 'A processar…' : mode === 'signin' ? 'Entrar' : 'Enviar link de recuperação'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '.9rem' }}>
          {mode === 'signin' ? (
            <span className="hint">Não tens acesso? Pede-o à administração do teu condomínio.</span>
          ) : (
            <>Lembraste-te? <button type="button" className="link-button" onClick={() => switchMode('signin')}>Inicia sessão</button></>
          )}
        </p>
        <p className="hint" style={{ textAlign: 'center', margin: '.6rem 0 0' }}>
          <a href="/privacidade">Política de privacidade</a>
        </p>
      </div>
    </div>
  )
}
