import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

const AUTH_TIMEOUT_MS = 20000

// Remove sessões antigas do Supabase guardadas neste browser (chaves "sb-...").
// Uma sessão antiga/corrompida pode deixar o login pendurado para sempre.
function clearStoredSession() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('sb-'))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    // localStorage indisponível (ex: modo privado restrito) — ignorar
  }
}

// Garante que um pedido ao Supabase nunca fica pendurado sem resposta.
function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      clearStoredSession()
      resolve({
        data: null,
        error: new Error(
          'O servidor de autenticação não respondeu. Verifica a ligação à internet ' +
          '(firewall, VPN ou bloqueador de anúncios podem bloquear o acesso a supabase.co) e tenta outra vez.'
        ),
      })
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Traduz as mensagens de erro mais comuns do Supabase.
export function friendlyAuthError(err) {
  const msg = err?.message || String(err || '')
  if (/invalid login credentials/i.test(msg)) return 'Email ou palavra-passe incorretos.'
  if (/email not confirmed/i.test(msg)) return 'Este email ainda não foi confirmado. Abre o link de confirmação que recebeste por email (ou pede ao administrador para confirmar a conta).'
  if (/user already registered/i.test(msg)) return 'Já existe uma conta com este email. Usa "Iniciar sessão".'
  if (/password should be at least/i.test(msg)) return 'A palavra-passe tem de ter pelo menos 6 caracteres.'
  if (/rate limit|too many requests/i.test(msg)) return 'Demasiadas tentativas. Espera um pouco e tenta outra vez.'
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return 'Não foi possível contactar o servidor de autenticação. Verifica a ligação à internet (firewall, VPN ou bloqueador de anúncios podem bloquear o acesso a supabase.co).'
  }
  return msg || 'Ocorreu um erro.'
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = a carregar, null = sem sessão

  useEffect(() => {
    withTimeout(supabase.auth.getSession(), AUTH_TIMEOUT_MS)
      .then(({ data }) => setSession(data?.session ?? null))
      .catch(() => setSession(null))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => listener.subscription.unsubscribe()
  }, [])

  const value = {
    session,
    loading: session === undefined,
    user: session?.user ?? null,
    signInWithPassword: (email, password) =>
      withTimeout(supabase.auth.signInWithPassword({ email: email.trim(), password }), AUTH_TIMEOUT_MS),
    signUp: (email, password, fullName) =>
      withTimeout(
        supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: fullName } } }),
        AUTH_TIMEOUT_MS
      ),
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
