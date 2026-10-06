import logoUrl from '../assets/domvus-logo.png'

// Logótipo Domvus: símbolo (dois edifícios) + palavra "domvus".
// variant="dark"  → para fundos claros (símbolo cinzento-escuro)
// variant="light" → para fundos escuros (símbolo claro, como no logótipo original)
const COLORS = {
  dark: { front: '#262627', side: '#8E8E90', text: '#262627' },
  light: { front: '#F2F2F2', side: '#8E8E90', text: '#F2F2F2' },
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

// Logótipo completo (símbolo + "domvus" + "Gestão de Condomínios"), para fundos claros.
export default function DomvusLogo({ size = 30, stacked = false, className = '' }) {
  return <img src={logoUrl} alt="Domvus — Gestão de Condomínios" className={`domvus-logo-img ${className}`}
    style={{ height: stacked ? size * 1.9 : size * 1.5, width: 'auto', maxWidth: '100%', display: 'block' }} />
}
