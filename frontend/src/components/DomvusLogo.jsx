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

// Logótipo tal como o original: fundo azul-marinho, prédios claros com o lado azul e
// a palavra "domvus" a branco. badge={false} desenha só o símbolo e a palavra, sem fundo.
export default function DomvusLogo({ size = 30, stacked = false, badge = true, variant = 'light', className = '' }) {
  const c = COLORS[variant] || COLORS.light
  const logo = (
    <span className={`domvus-logo${stacked ? ' stacked' : ''}`} aria-hidden={badge ? true : undefined}>
      <DomvusMark size={stacked ? size * 1.6 : size} variant={variant} />
      <span className="domvus-wordmark" style={{ color: c.text, fontSize: stacked ? size * 1.15 : size * 0.82 }} aria-hidden="true">domvus</span>
    </span>
  )
  if (!badge) return <span className={className} role="img" aria-label="Domvus">{logo}</span>
  return <span className={`domvus-badge${stacked ? ' stacked' : ''} ${className}`} role="img" aria-label="Domvus">{logo}</span>
}
