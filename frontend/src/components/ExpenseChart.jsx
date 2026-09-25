// Gráfico simples "para onde vai o meu dinheiro" — donut por categoria de despesa.
// Sem biblioteca externa: um donut em SVG puro, desenhado à escala.
const PALETTE = ['#2f6f4f', '#4f8fb0', '#c98a3a', '#8a6fb0', '#c0574a', '#5a9e8f', '#a3a13a']

function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }

export default function ExpenseChart({ expenses }) {
  const totals = {}
  for (const e of expenses) {
    totals[e.category] = (totals[e.category] || 0) + Number(e.amount)
  }
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((s, [, v]) => s + v, 0)

  if (total === 0) {
    return <p className="hint">Ainda não há despesas registadas para mostrar aqui.</p>
  }

  const size = 180
  const r = 70
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r

  let offset = 0
  const arcs = entries.map(([category, value], i) => {
    const fraction = value / total
    const dash = fraction * circumference
    const arc = (
      <circle
        key={category}
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={PALETTE[i % PALETTE.length]}
        strokeWidth={28}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={-offset}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    )
    offset += dash
    return arc
  })

  return (
    <div className="row" style={{ gap: '1.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribuição das despesas por categoria">
        {arcs}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--text)">{money(total)}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="var(--text-muted)">total gasto</text>
      </svg>
      <div className="stack" style={{ gap: '.5rem', flex: 1, minWidth: 180 }}>
        {entries.map(([category, value], i) => (
          <div key={category} className="row between" style={{ gap: '.6rem' }}>
            <span className="row" style={{ gap: '.5rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: PALETTE[i % PALETTE.length], display: 'inline-block', flexShrink: 0 }} />
              {category}
            </span>
            <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {money(value)} <span style={{ opacity: .7 }}>({((value / total) * 100).toFixed(0)}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
