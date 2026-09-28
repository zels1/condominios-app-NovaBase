import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.warn('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não configuradas — o login não vai funcionar.')
}

// Quando a pessoa abre o link "recuperar palavra-passe" do email, o Supabase acrescenta
// ao endereço "#...type=recovery" (ou um erro, se o link expirou). Guardamos isso já,
// porque o cliente do Supabase limpa o endereço logo a seguir.
function readAuthRedirect() {
  if (typeof window === 'undefined') return { isRecovery: false, isInvite: false, error: null }
  const params = new URLSearchParams(window.location.hash.replace(/^#/, '') + '&' + window.location.search.replace(/^\?/, ''))
  const errorCode = params.get('error_code') || params.get('error')
  let error = null
  if (errorCode) {
    error = /expired/i.test(errorCode + (params.get('error_description') || ''))
      ? 'O link de recuperação expirou ou já foi usado. Pede um novo link.'
      : (params.get('error_description') || 'O link de recuperação não é válido.').replace(/\+/g, ' ')
  }
  // convite enviado pelo administrador: a pessoa entra pelo link e define já a palavra-passe
  const isInvite = params.get('type') === 'invite'
  return { isRecovery: params.get('type') === 'recovery' || isInvite, isInvite, error }
}
export const authRedirect = readAuthRedirect()

export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder')
