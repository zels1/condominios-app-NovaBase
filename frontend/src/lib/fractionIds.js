// Igual ao backend (services/fraction_ids.py): "1º Dto", "1ºdto", "1.º Direito" e "1 dto"
// são a mesma fração.
const SYNONYMS = {
  direito: 'dto', direita: 'dto', dir: 'dto', dto: 'dto', dt: 'dto', drt: 'dto',
  esquerdo: 'esq', esquerda: 'esq', esq: 'esq', esqdo: 'esq',
  frente: 'fte', fte: 'fte', frt: 'fte',
  centro: 'ctr', ctr: 'ctr', cto: 'ctr',
  rc: 'rc', rch: 'rc',
  cave: 'cv', cv: 'cv',
  sobreloja: 'slj', sl: 'slj',
}
const DROP = new Set(['andar', 'piso', 'fracao', 'fr', 'no'])

export function normalizeIdentifier(value) {
  let s = String(value || '').trim().toLowerCase().replace(/[ºª°]/g, ' ')
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  s = s.replace(/r\s*\/\s*c(?![a-z])/g, ' rc ').replace(/res\W*do\W*chao/g, ' rc ')
  const tokens = s.match(/[a-z]+|\d+/g) || []
  const out = []
  tokens.forEach((t, i) => {
    if (/^\d+$/.test(t)) { out.push(String(parseInt(t, 10))); return }
    if (DROP.has(t)) return
    if (t === 'o' && i > 0 && /^\d+$/.test(tokens[i - 1]) && i < tokens.length - 1) return
    out.push(SYNONYMS[t] || t)
  })
  return out.join('')
}

// Devolve { índice: identificador anterior equivalente } para as linhas repetidas
export function findDuplicates(identifiers) {
  const seen = new Map()
  const dups = {}
  identifiers.forEach((id, i) => {
    const key = normalizeIdentifier(id)
    if (!key) return
    if (seen.has(key)) dups[i] = identifiers[seen.get(key)]
    else seen.set(key, i)
  })
  return dups
}
