import { useState } from 'react'
import { api } from '../lib/api'
import { POLICY_VERSION, POLICY_DATE_LABEL } from '../lib/privacy'

// Aviso mostrado ao entrar, enquanto o utilizador não confirmar que tomou conhecimento da
// versão em vigor da política de privacidade. Não é um pedido de consentimento: os dados
// são tratados por obrigação legal e para gerir o condomínio; aqui só se garante a informação.
export default function PrivacyNotice({ firstTime, onDone, onDecline }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function confirm() {
    setBusy(true); setErr(null)
    try {
      await api.post('/me/privacy-ack', { version: POLICY_VERSION })
      await onDone()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="privacy-notice-title">
        <div className="modal-head"><h3 id="privacy-notice-title">{firstTime ? 'Os teus dados na Domvus' : 'Atualizámos a política de privacidade'}</h3></div>
        <div className="modal-body stack">
          <p style={{ margin: 0 }}>
            {firstTime
              ? 'Para gerir o condomínio, a administração trata alguns dados teus: contactos, fração, quotas e pagamentos, ocorrências que reportas e a tua participação nas assembleias.'
              : `A política de privacidade foi atualizada em ${POLICY_DATE_LABEL}.`}
          </p>
          <p style={{ margin: 0 }}>
            Na <a href="/privacidade" target="_blank" rel="noreferrer"><strong>Política de privacidade</strong></a> explicamos que dados são,
            para que servem, quem os pode ver, durante quanto tempo ficam guardados e como podes exercer os teus direitos (aceder, corrigir, apagar,
            descarregar uma cópia).
          </p>
          {err && <div className="msg error">{err}</div>}
          <div className="modal-actions">
            <button type="button" className="btn secondary small" onClick={onDecline}>Terminar sessão</button>
            <button type="button" className="btn small" disabled={busy} onClick={confirm}>{busy ? 'A guardar…' : 'Li e tomei conhecimento'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
