// Logótipo Domvus: símbolo (dois edifícios) + palavra "domvus".
// variant="dark"  → para fundos claros (símbolo azul-marinho)
// variant="light" → para fundos escuros (símbolo claro, como no logótipo original)
const COLORS = {
  dark: { front: '#0D274C', side: '#2B507C', text: '#0D274C' },
  light: { front: '#F2F2F2', side: '#2B507C', text: '#F2F2F2' },
}

export function DomvusMark({ size = 32, variant = 'dark', title }) {
  const c = COLORS[variant] || COLORS.dark
  return (
    <svg viewBox="0 0 164 240" height={size} width={(size * 164) / 240} role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true} aria-label={title} focusable="false" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M6 127 L53 96 L53 233 L34 233 Q6 233 6 205 Z" fill={c.front} />
      <path d="M53 96 L73 112 L73 233 L53 233 Z" fill={c.side} />
      <path d="M74 39 L120 7 L120 233 L74 233 Z" fill={c.front} />
      <path d="M120 7 L158 39 L158 233 L120 233 Z" fill={c.side} />
    </svg>
  )
}

export default function DomvusLogo({ size = 30, variant = 'dark', stacked = false, className = '' }) {
  const c = COLORS[variant] || COLORS.dark
  return (
    <span className={`domvus-logo${stacked ? ' stacked' : ''} ${className}`} aria-label="Domvus" role="img">
      <DomvusMark size={stacked ? size * 1.6 : size} variant={variant} />
      <span className="domvus-wordmark" style={{ color: c.text, fontSize: stacked ? size * 1.15 : size * 0.82 }} aria-hidden="true">domvus</span>
    </span>
  )
}
