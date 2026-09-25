import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'

export default function Login() {
  const { signInWithPassword, signUp } = useAuth()
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null); setNotice(null); setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await signInWithPassword(email, password)
        if (error) throw error
      } else {
        const { error } = await signUp(email, password, fullName)
        if (error) throw error
        setNotice('Conta criada! Verifica o teu email para confirmar (se a confirmação estiver ativa) e depois inicia sessão.')
        setMode('signin')
      }
    } catch (err) {
      setError(err.message || 'Ocorreu um erro.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <h1>Gestão de Condomínios</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          {mode === 'signin' ? 'Inicia sessão para continuar.' : 'Cria a tua conta.'}
        </p>

        {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
        {notice && <div className="msg success" style={{ marginBottom: '1em' }}>{notice}</div>}

        <form onSubmit={handleSubmit} className="stack">
          {mode === 'signup' && (
            <div className="field">
              <label>Nome completo</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="field">
            <label>Palavra-passe</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={6} />
          </div>
          <button className="btn block" disabled={busy}>
            {busy ? 'A processar…' : mode === 'signin' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '.9rem' }}>
          {mode === 'signin' ? (
            <>Ainda não tens conta? <button className="navlink" style={{ background: 'none', border: 'none', color: 'var(--primary-dark)', fontWeight: 600, cursor: 'pointer', padding: 0 }} onClick={() => setMode('signup')}>Cria uma</button></>
          ) : (
            <>Já tens conta? <button style={{ background: 'none', border: 'none', color: 'var(--primary-dark)', fontWeight: 600, cursor: 'pointer', padding: 0 }} onClick={() => setMode('signin')}>Inicia sessão</button></>
          )}
        </p>
      </div>
    </div>
  )
}
