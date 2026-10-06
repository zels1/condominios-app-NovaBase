import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import { POLICY_VERSION, POLICY_DATE_LABEL } from '../lib/privacy'

const EMPTY = {
  entity_name: '', entity_nif: '', entity_address: '', privacy_email: '', privacy_phone: '',
  dpo_name: '', dpo_email: '', data_location: '', transfers_outside_eu: false,
}

// Administração → Privacidade (RGPD): identificação da entidade que aparece na política de
// privacidade, e um resumo do que a aplicação já faz para cumprir o RGPD.
export default function PrivacySettings() {
  const { isAdmin } = useCondo()
  const [form, setForm] = useState(null)
  const [canEdit, setCanEdit] = useState(false)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    api.get('/legal/privacy').then((d) => setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? (k === 'transfers_outside_eu' ? false : '')])) }))
      .catch((e) => setMsg({ type: 'error', text: e.message }))
    api.get('/legal/privacy/can-edit').then((r) => setCanEdit(r.can_edit)).catch(() => {})
  }, [isAdmin])

  if (!isAdmin) return <div className="empty">Só o administrador tem acesso a esta página.</div>
  if (!form) return msg ? <div className="msg error">{msg.text}</div> : <div className="empty">A carregar…</div>

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const missing = [
    !form.entity_name && 'nome da entidade', !form.entity_nif && 'NIF', !form.privacy_email && 'email de contacto para privacidade',
    !form.data_location && 'local de alojamento dos dados',
  ].filter(Boolean)

  async function save(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const { updated_at, ...body } = form // eslint-disable-line no-unused-vars
      await api.put('/legal/privacy', body)
      setMsg({ type: 'success', text: 'Dados guardados. A política de privacidade já mostra esta informação.' })
    } catch (err) { setMsg({ type: 'error', text: err.message }) }
    setBusy(false)
  }

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Privacidade (RGPD)</h1>
          <p className="subtitle">Política de privacidade em vigor: versão de {POLICY_DATE_LABEL} ({POLICY_VERSION}).</p>
        </div>
        <Link to="/privacidade" className="btn secondary" style={{ textDecoration: 'none' }}>Ver a política de privacidade</Link>
      </div>

      {missing.length > 0 && (
        <div className="msg error">Para a política ficar completa, falta indicar: {missing.join(', ')}.</div>
      )}
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <form className="card stack" onSubmit={save}>
        <h3 style={{ margin: 0 }}>Entidade que explora a plataforma</h3>
        <p className="hint" style={{ margin: 0 }}>
          Estes dados aparecem na política de privacidade, que qualquer pessoa pode ler (mesmo sem conta).
          {!canEdit && ' Só o administrador principal da plataforma (super_admin) os pode alterar.'}
        </p>
        <fieldset disabled={!canEdit} style={{ border: 'none', padding: 0, margin: 0 }} className="stack">
          <div className="row form-row">
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label htmlFor="pv-name">Nome / firma *</label>
              <input id="pv-name" value={form.entity_name} onChange={set('entity_name')} placeholder="Ex: Domvus, Lda." />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="pv-nif">NIF *</label>
              <input id="pv-nif" value={form.entity_nif} onChange={set('entity_nif')} inputMode="numeric" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="pv-addr">Morada / sede</label>
            <input id="pv-addr" value={form.entity_address} onChange={set('entity_address')} placeholder="Rua, n.º, código postal, localidade" />
          </div>
          <div className="row form-row">
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label htmlFor="pv-email">Email para assuntos de privacidade *</label>
              <input id="pv-email" type="email" value={form.privacy_email} onChange={set('privacy_email')} placeholder="privacidade@exemplo.pt" />
              <span className="hint">É para aqui que os condóminos enviam pedidos de acesso, correção ou apagamento.</span>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="pv-phone">Telefone</label>
              <input id="pv-phone" type="tel" value={form.privacy_phone} onChange={set('privacy_phone')} />
            </div>
          </div>
          <div className="row form-row">
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="pv-dpo">Encarregado de proteção de dados (se existir)</label>
              <input id="pv-dpo" value={form.dpo_name} onChange={set('dpo_name')} placeholder="Nome" />
              <span className="hint">Só é obrigatório em casos específicos (ex: tratamento em grande escala). Deixa vazio se não tiveres.</span>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="pv-dpo-email">Email do encarregado</label>
              <input id="pv-dpo-email" type="email" value={form.dpo_email} onChange={set('dpo_email')} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="pv-loc">Onde ficam alojados os dados *</label>
            <input id="pv-loc" value={form.data_location} onChange={set('data_location')} placeholder="Ex: União Europeia (Supabase — Frankfurt; Render — Frankfurt)" />
            <span className="hint">Vê a região em Supabase → Project Settings → General, e em Render → o serviço → Settings (Region).</span>
          </div>
          <label className="remember" style={{ margin: 0 }}>
            <input type="checkbox" checked={form.transfers_outside_eu} onChange={set('transfers_outside_eu')} />
            Algum prestador trata dados fora do Espaço Económico Europeu (ex: região dos EUA, ou a Vercel a servir o site)
          </label>
          {canEdit && <div><button className="btn small" disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</button></div>}
        </fieldset>
      </form>

      <div className="card">
        <h3>O que a aplicação já faz</h3>
        <ul style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.7 }}>
          <li>Política de privacidade pública, com ligação no ecrã de entrada e no menu.</li>
          <li>Ao entrar, cada utilizador confirma que tomou conhecimento da versão em vigor (fica registado com data).</li>
          <li>Cada condómino pode descarregar os seus dados na página da política (direito de acesso e portabilidade).</li>
          <li>Podes corrigir a ficha de um condómino, desativar o acesso ou apagá-la em Condóminos (direitos de retificação e apagamento).</li>
          <li>Os condóminos só veem o seu condomínio e as suas frações; documentos privados abrem com ligações temporárias.</li>
          <li>Sem cookies de publicidade nem conteúdos de terceiros; cópias de segurança em Administração → Cópia de segurança.</li>
        </ul>
      </div>

      <div className="card">
        <h3>O que continua a ser da tua responsabilidade</h3>
        <ul style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.7 }}>
          <li>Responder aos pedidos dos titulares no prazo de um mês.</li>
          <li>Ter contrato de subcontratação (art. 28.º do RGPD) com cada condomínio que usa a plataforma, e aceitar os acordos de tratamento de dados da Supabase, Render e Vercel.</li>
          <li>Manter um registo das atividades de tratamento e avisar a CNPD em 72 horas se houver uma violação de dados com risco.</li>
          <li>Guardar as cópias de segurança em local seguro e apagar os dados que já não sejam necessários.</li>
          <li>Pedir a um jurista que reveja a política antes de a usares com clientes: o texto foi preparado com cuidado, mas não substitui aconselhamento jurídico.</li>
        </ul>
      </div>
    </div>
  )
}
