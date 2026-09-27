import { useMemo, useState } from 'react'

// Ordenação de tabelas por coluna: clicar num cabeçalho ordena; clicar outra vez inverte.
// columns: { chave: (linha) => valor } — valores numéricos, datas (AAAA-MM-DD) ou texto.
const collator = new Intl.Collator('pt', { numeric: true, sensitivity: 'base' })

export function useSort(rows, columns, initialKey, initialDir = 'asc') {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir })
  const sorted = useMemo(() => {
    const get = columns[sort.key]
    if (!get) return rows
    const factor = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = get(a); const vb = get(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1 // vazios sempre no fim
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor
      return collator.compare(String(va), String(vb)) * factor
    })
  }, [rows, sort, columns])
  function toggle(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }
  return { sorted, sort, toggle }
}

export function SortTh({ label, sortKey, sort, onSort, align }) {
  const active = sort.key === sortKey
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <th aria-sort={ariaSort} style={align ? { textAlign: align } : undefined}>
      <button type="button" className={`sort-th${active ? ' active' : ''}`} onClick={() => onSort(sortKey)}
        title={`Ordenar por ${label.toLowerCase()}`}>
        {label}
        <span className="sort-icon" aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  )
}
