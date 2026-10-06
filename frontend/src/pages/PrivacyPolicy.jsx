import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/AuthContext'
import DomvusLogo from '../components/DomvusLogo'
import { POLICY_VERSION, POLICY_DATE_LABEL } from '../lib/privacy'

// Política de privacidade (RGPD). É pública: pode ser lida antes de criar conta.
// A identificação da entidade vem das definições (Administração → Privacidade (RGPD)).
export default function PrivacyPolicy() {
  const { user } = useAuth()
  const [e, setE] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { api.get('/legal/privacy').then(setE).catch(() => setE({})) }, [])
  useEffect(() => { document.title = 'Política de privacidade — Domvus'; return () => { document.title = 'Domvus' } }, [])

  async function exportMine() {
    setBusy(true); setErr(null)
    try { await api.download('/me/data-export', 'os-meus-dados-domvus.json') } catch (x) { setErr(x.message) }
    setBusy(false)
  }

  if (!e) return <div className="empty">A carregar…</div>
  // um ou dois responsáveis pela plataforma, em pé de igualdade
  const people = [[e.entity_name, e.entity_nif], [e.entity2_name, e.entity2_nif]].filter(([n]) => n)
  const two = people.length === 2
  const contact = e.privacy_email
    ? <a href={`mailto:${e.privacy_email}`}>{e.privacy_email}</a>
    : 'o administrador do seu condomínio'

  return (
    <div className="legal-page">
      <header className="legal-head">
        <Link to="/" aria-label="Domvus — início"><DomvusLogo size={26} /></Link>
        <Link to="/" className="btn secondary small" style={{ textDecoration: 'none' }}>{user ? '← Voltar à aplicação' : '← Iniciar sessão'}</Link>
      </header>

      <article className="card legal">
        <h1>Política de privacidade</h1>
        <p className="hint">Versão de {POLICY_DATE_LABEL} ({POLICY_VERSION})</p>

        <p>
          Esta política explica, em linguagem simples, que dados pessoais são tratados na plataforma <strong>Domvus</strong> — a aplicação de
          gestão de condomínios —, para quê, durante quanto tempo, com quem são partilhados e que direitos tem. Foi escrita de acordo com o
          Regulamento (UE) 2016/679 (Regulamento Geral sobre a Proteção de Dados, «RGPD») e com a Lei n.º 58/2019, que o executa em Portugal.
        </p>

        <h2>1. Quem é responsável pelos seus dados</h2>
        <p>Na Domvus há dois papéis diferentes:</p>
        <ul>
          <li>
            <strong>O seu condomínio</strong>, representado pela respetiva administração, é o <strong>responsável pelo tratamento</strong> dos dados
            dos condóminos: é quem decide que dados regista e para quê (quotas, assembleias, ocorrências, etc.).
          </li>
          <li>
            {people.length === 0 && <strong>A entidade que explora a plataforma Domvus</strong>}
            {people.map(([n, nif], i) => (
              <span key={n}>{i > 0 && ' e '}<strong>{n}</strong>{nif && <>, NIF {nif}</>}</span>
            ))}
            {e.entity_address && <>, com morada em {e.entity_address}</>}, {two ? 'disponibilizam e mantêm' : 'disponibiliza e mantém'} a plataforma
            {two && <>, em conjunto (responsáveis conjuntos, nos termos do art. 26.º do RGPD)</>}.
            {' '}{two ? 'Tratam' : 'Trata'} os dados dos condóminos <strong>por conta do condomínio</strong> (como {two ? 'subcontratantes' : 'subcontratante'}) e
            {two ? ' são responsáveis' : ' é responsável'} pelo tratamento dos dados das contas de acesso (email e autenticação) e pela segurança da plataforma.
            {two && ' Pode exercer os seus direitos junto de qualquer um deles, através do contacto abaixo.'}
          </li>
        </ul>
        <p>
          <strong>Contacto para assuntos de privacidade:</strong> {contact}{e.privacy_phone && <> · {e.privacy_phone}</>}.
          {(e.dpo_name || e.dpo_email) && (
            <> Encarregado de proteção de dados: {e.dpo_name}{e.dpo_email && <> (<a href={`mailto:${e.dpo_email}`}>{e.dpo_email}</a>)</>}.</>
          )}
        </p>

        <h2>2. Que dados tratamos</h2>
        <ul>
          <li><strong>Identificação e contacto:</strong> nome, email, telemóvel e telefone fixo, NIF e morada para correspondência.</li>
          <li><strong>Dados da fração:</strong> fração e permilagem, quota de propriedade, e o seguro da fração (seguradora, n.º da apólice, validade e cópia da apólice, se for carregada).</li>
          <li><strong>Dados financeiros:</strong> quotas emitidas, pagamentos, valores em dívida e juros de mora; IBAN, apenas se for indicado para reembolsos.</li>
          <li><strong>Ocorrências:</strong> as avarias que reporta, incluindo descrição, fotografias e respostas da administração.</li>
          <li><strong>Assembleias:</strong> presenças, procurações e o sentido de voto de cada fração.</li>
          <li><strong>Documentos e comunicados</strong> partilhados pela administração, e contratos e despesas do condomínio (que podem identificar fornecedores).</li>
          <li><strong>Conta de acesso:</strong> email, palavra-passe (guardada cifrada, nunca legível) e datas de acesso.</li>
          <li><strong>Dados técnicos:</strong> registos de operações relevantes (por exemplo, quem gerou quotas ou criou uma cópia de segurança) e registos técnicos dos servidores.</li>
        </ul>
        <p>
          Os dados são fornecidos por si ou registados pela administração do condomínio (por exemplo, a partir do título de propriedade ou das atas).
          Não pedimos nem tratamos categorias especiais de dados (saúde, convicções, etc.) — por favor não os inclua em ocorrências ou mensagens.
        </p>

        <h2>3. Para que usamos os dados e com que fundamento</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Finalidade</th><th>Fundamento (art. 6.º, n.º 1 do RGPD)</th></tr></thead>
            <tbody>
              <tr><td>Gerir o condomínio: calcular e cobrar quotas, registar pagamentos, emitir avisos e recibos, gerir manutenção e ocorrências</td><td>Cumprimento de obrigações legais da administração do condomínio (Código Civil, arts. 1414.º e seguintes, e Decreto-Lei n.º 268/94) — al. c); execução da relação entre o condómino e o condomínio — al. b)</td></tr>
              <tr><td>Convocar e realizar assembleias, registar presenças, procurações e votos, e elaborar atas</td><td>Obrigação legal — al. c)</td></tr>
              <tr><td>Criar e manter a sua conta e permitir-lhe consultar a sua informação</td><td>Execução do serviço — al. b)</td></tr>
              <tr><td>Enviar comunicações do condomínio (avisos, lembretes de pagamento, convocatórias)</td><td>Obrigação legal e interesse legítimo do condomínio em comunicar com os condóminos — als. c) e f)</td></tr>
              <tr><td>Cobrar dívidas e aplicar juros de mora segundo as regras aprovadas</td><td>Interesse legítimo do condomínio e obrigação legal — als. f) e c)</td></tr>
              <tr><td>Segurança, prevenção de abusos, cópias de segurança e resolução de problemas técnicos</td><td>Interesse legítimo — al. f)</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          Não usamos os seus dados para publicidade, não os vendemos e não criamos perfis. Não há decisões exclusivamente automatizadas com efeitos
          jurídicos: os juros de mora são calculados pela aplicação segundo a regra definida pelo condomínio, mas podem sempre ser revistos pela administração.
        </p>

        <h2>4. Quem pode ver os seus dados</h2>
        <ul>
          <li><strong>A administração do seu condomínio</strong> vê a ficha completa dos condóminos desse condomínio.</li>
          <li>
            <strong>Os outros condóminos do mesmo prédio</strong> veem apenas o que diz respeito à vida comum: as ocorrências reportadas (com o nome de
            quem reportou), os documentos e comunicados, a conta corrente do prédio e os resultados das votações. Não veem os seus contactos, NIF, IBAN,
            quotas ou dívidas.
          </li>
          <li>
            <strong>Prestadores de serviços técnicos</strong> (subcontratantes), que só tratam os dados para alojar e fazer funcionar a plataforma:
            Supabase (base de dados, autenticação e ficheiros), Render (servidor da aplicação) e Vercel (alojamento do site).
          </li>
          <li><strong>Autoridades</strong> (tribunais, Autoridade Tributária, etc.), quando a lei o exija.</li>
        </ul>
        <p>
          {e.data_location ? <>Os dados ficam alojados em: <strong>{e.data_location}</strong>. </> : null}
          {e.transfers_outside_eu || !e.data_location
            ? 'Alguns destes prestadores têm sede ou infraestrutura fora do Espaço Económico Europeu (nomeadamente nos Estados Unidos). Quando há transferência de dados para fora do EEE, é feita com as garantias previstas no RGPD: decisão de adequação da Comissão Europeia (EU–U.S. Data Privacy Framework) ou cláusulas contratuais-tipo.'
            : 'Os dados não são transferidos para fora do Espaço Económico Europeu.'}
        </p>

        <h2>5. Durante quanto tempo guardamos os dados</h2>
        <ul>
          <li><strong>Enquanto for condómino</strong> (ou tiver uma fração associada), os dados necessários à gestão do condomínio são mantidos.</li>
          <li><strong>Depois de deixar de ser condómino</strong>, os seus contactos deixam de ser usados; os registos financeiros (quotas, pagamentos, recibos) são conservados pelos prazos legais aplicáveis, em regra 10 anos.</li>
          <li><strong>Atas e deliberações das assembleias</strong> (incluindo presenças e votos) são conservadas pelo condomínio nos termos da lei.</li>
          <li><strong>Ocorrências e fotografias</strong> são conservadas enquanto forem úteis para a gestão e histórico do prédio, e apagadas a pedido quando já não forem necessárias.</li>
          <li><strong>Contas sem qualquer fração associada e sem histórico</strong> são apagadas pela administração.</li>
          <li><strong>Cópias de segurança</strong> seguem os mesmos prazos e são guardadas em local de acesso restrito.</li>
        </ul>

        <h2>6. Os seus direitos</h2>
        <p>Pode, a qualquer momento e sem custos:</p>
        <ul>
          <li><strong>aceder</strong> aos seus dados e obter uma cópia;</li>
          <li><strong>corrigir</strong> dados errados ou desatualizados;</li>
          <li>pedir o <strong>apagamento</strong> dos dados que já não sejam necessários ou que não tenham de ser conservados por lei;</li>
          <li>pedir a <strong>limitação</strong> do tratamento ou <strong>opor-se</strong> a tratamentos baseados em interesse legítimo;</li>
          <li>receber os seus dados num formato estruturado (<strong>portabilidade</strong>).</li>
        </ul>
        <p>
          Para exercer estes direitos, contacte {contact}. Respondemos no prazo de um mês. Alguns dados (por exemplo, registos de quotas e atas) têm
          de ser conservados por obrigação legal e não podem ser apagados antes do prazo.
        </p>
        {user && (
          <div className="assign-box" style={{ maxWidth: 'none' }}>
            <strong>Descarregar os meus dados</strong>
            <p className="hint" style={{ margin: '.2rem 0 .6rem' }}>Um ficheiro com todos os dados pessoais guardados sobre a sua conta: ficha, frações, quotas, pagamentos, ocorrências e participação em assembleias.</p>
            <button type="button" className="btn small" disabled={busy} onClick={exportMine}>{busy ? 'A preparar…' : '⬇ Descarregar os meus dados'}</button>
            {err && <div className="msg error" style={{ marginTop: '.5rem' }}>{err}</div>}
          </div>
        )}
        <p>
          Se considerar que os seus dados não estão a ser tratados corretamente, tem o direito de apresentar reclamação à autoridade de controlo:
          {' '}<strong>Comissão Nacional de Proteção de Dados (CNPD)</strong> — <a href="https://www.cnpd.pt" target="_blank" rel="noreferrer">www.cnpd.pt</a>.
        </p>

        <h2>7. Como protegemos os dados</h2>
        <ul>
          <li>Todas as ligações são cifradas (HTTPS).</li>
          <li>Cada pessoa só vê o que lhe diz respeito: os condóminos só acedem ao seu condomínio e às suas frações; a administração só aos condomínios que gere.</li>
          <li>Os documentos privados (apólices, contratos, documentos do condomínio) só se abrem com ligações temporárias, depois de iniciar sessão.</li>
          <li>As palavras-passe são guardadas cifradas e nunca são visíveis, nem para a administração.</li>
          <li>A administração pode desativar o acesso de uma conta, e as operações sensíveis ficam registadas.</li>
        </ul>
        <p>Se ocorrer uma violação de dados com risco para os seus direitos, será informado e a CNPD será notificada, nos termos do RGPD.</p>

        <h2>8. Cookies e armazenamento no seu dispositivo</h2>
        <p>
          A Domvus <strong>não usa cookies de publicidade nem de seguimento</strong> e não carrega conteúdos de terceiros para esse fim. Guarda apenas, no
          seu browser, o estritamente necessário para funcionar: a sessão iniciada, o condomínio que selecionou e — só se escolher «Lembrar este email»
          — o seu email, para facilitar o próximo acesso. Pode apagar esta informação terminando a sessão ou limpando os dados do site no browser.
        </p>

        <h2>9. Menores</h2>
        <p>A plataforma destina-se a condóminos e administradores de condomínios, maiores de idade. Não recolhemos conscientemente dados de menores.</p>

        <h2>10. Alterações a esta política</h2>
        <p>
          Esta política pode ser atualizada, por exemplo quando forem acrescentadas funcionalidades ou mudarem os prestadores de serviços. Quando houver
          alterações relevantes, a data no topo é atualizada e é-lhe pedido, ao entrar na aplicação, que confirme que tomou conhecimento da nova versão.
        </p>
      </article>
    </div>
  )
}
