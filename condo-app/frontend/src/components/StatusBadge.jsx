const QUOTA_LABELS = {
  pending: ['Pendente', ''],
  paid: ['Paga', 'ok'],
  partially_paid: ['Pagamento parcial', 'warn'],
  overdue: ['Em atraso', 'danger'],
  waived: ['Perdoada', 'ok'],
}

export function QuotaStatusBadge({ status }) {
  const [label, cls] = QUOTA_LABELS[status] || [status, '']
  return <span className={`badge ${cls}`}>{label}</span>
}

const OCC_LABELS = {
  reported: ['Reportada', ''],
  acknowledged: ['Reconhecida', 'warn'],
  in_progress: ['Em curso', 'warn'],
  resolved: ['Resolvida', 'ok'],
  closed: ['Fechada', 'ok'],
}

export function OccurrenceStatusBadge({ status }) {
  const [label, cls] = OCC_LABELS[status] || [status, '']
  return <span className={`badge ${cls}`}>{label}</span>
}
