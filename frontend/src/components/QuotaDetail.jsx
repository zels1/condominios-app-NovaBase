// Mostra a que se refere uma quota (mês ou descrição da extraordinária) e a sua
// discriminação por rubrica: quota ordinária, fundo comum de reserva, etc.
function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }

export function quotaMonth(q) {
  return new Date(q.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
}

export function linesText(quota) {
  return (quota.lines || []).map((l) => `${l.name}: ${money(l.amount)}`).join('\n')
}

export function QuotaTitle({ quota, showLines = true }) {
  const extra = quota.kind && quota.kind !== 'regular'
  const invoice = quota.kind === 'invoice'
  return (
    <div>
      <span style={{ whiteSpace: extra ? undefined : 'nowrap' }}>{extra ? (quota.description || (invoice ? 'Fatura' : 'Quota extraordinária')) : quotaMonth(quota)}</span>
      {extra && <span className="badge warn" style={{ marginLeft: '.35rem' }}>{invoice ? 'fatura' : 'extraordinária'}</span>}
      {extra && <div className="hint" style={{ fontSize: '.78rem' }}>{quotaMonth(quota)}</div>}
      {showLines && !extra && quota.lines && quota.lines.length > 1 && (
        <div className="hint quota-lines">
          {quota.lines.map((l) => `${l.name} ${money(l.amount)}`).join(' · ')}
        </div>
      )}
    </div>
  )
}
