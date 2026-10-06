import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import { useSort, SortTh } from '../components/SortableTable'

function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }
function signed(v) { return `${v > 0 ? '+' : ''}${money(v)}` }

const MOVEMENT_COLUMNS = {
  date: (m) => m.date,
  type: (m) => m.type,
  category: (m) => m.category,
  description: (m) => m.description,
  amount: (m) => m.amount,
  balance: (m) => m.balance,
}
const MONTH_COLUMNS = {
  month: (m) => m.month,
  received: (m) => m.received,
  spent: (m) => m.spent,
  net: (m) => m.net,
}

export default function AccountStatement() {
  const { selectedCondo, isAdmin } = useCondo()
  const [year, setYear] = useState(new Date().getFullYear())
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [kind, setKind] = useState('all') // all | receita | despesa

  useEffect(() => {
    if (!selectedCondo) return
    setError(null)
    api.get(`/condominiums/${selectedCondo.id}/account-statement`, { year })
      .then(setData).catch((e) => setError(e.message))
  }, [selectedCondo, year])

  const movements = (data?.movements || []).filter((m) => kind === 'all' || m.type === kind)
  const mv = useSort(movements, MOVEMENT_COLUMNS, 'date', 'desc')
  const ms = useSort(data?.months || [], MONTH_COLUMNS, 'month', 'asc')

  if (!selectedCondo) return null
  const thisYear = new Date().getFullYear()
  const maxMonthly = Math.max(1, ...(data?.months || []).map((m) => Math.max(m.received, m.spent)))

  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '.6rem' }}>
        <h1 style={{ margin: 0 }}>Conta corrente do prédio</h1>
        <div className="year-switch" role="group" aria-label="Ano">
          <button type="button" className="btn secondary small" onClick={() => setYear(year - 1)}
            disabled={data && year <= data.first_year} aria-label="Ano anterior">‹ {year - 1}</button>
          <strong aria-live="polite">{year}</strong>
          <button type="button" className="btn secondary small" onClick={() => setYear(year + 1)}
            disabled={year >= thisYear} aria-label="Ano seguinte">{year + 1} ›</button>
        </div>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Tudo o que entrou e saiu da conta do condomínio {selectedCondo.name}. As receitas de quotas aparecem somadas por mês, sem identificar condóminos.
      </p>
      {error && <div className="msg error">{error}</div>}

      {data && (
        <>
          <div className="grid">
            <div className="card stat">
              <span className="label">Saldo em 1 de janeiro</span>
              <span className="value">{money(data.opening_balance)}</span>
            </div>
            <div className="card stat">
              <span className="label">Receitas (quotas recebidas)</span>
              <span className="value income-value">{money(data.total_received)}</span>
              {data.budget_total != null && <span className="hint" style={{ margin: 0 }}>Orçamento anual: {money(data.budget_total)}</span>}
            </div>
            <div className="card stat">
              <span className="label">Despesas</span>
              <span className="value" style={{ color: 'var(--danger)' }}>{money(data.total_spent)}</span>
            </div>
            <div className="card stat">
              <span className="label">{year === thisYear ? 'Saldo atual' : `Saldo em 31 de dezembro`}</span>
              <span className="value" style={{ color: data.closing_balance < 0 ? 'var(--danger)' : 'var(--text)' }}>{money(data.closing_balance)}</span>
              {data.outstanding_debt > 0 && <span className="hint" style={{ margin: 0 }}>Quotas em atraso no prédio: {money(data.outstanding_debt)}</span>}
            </div>
          </div>

          <div className="card">
            <h3>Mês a mês</h3>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <SortTh label="Mês" sortKey="month" sort={ms.sort} onSort={ms.toggle} />
                  <SortTh label="Receitas" sortKey="received" sort={ms.sort} onSort={ms.toggle} align="right" />
                  <SortTh label="Despesas" sortKey="spent" sort={ms.sort} onSort={ms.toggle} align="right" />
                  <SortTh label="Resultado" sortKey="net" sort={ms.sort} onSort={ms.toggle} align="right" />
                  <th className="month-bars-head"><span className="visually-hidden">Gráfico</span></th>
                </tr></thead>
                <tbody>
                  {ms.sorted.map((m) => (
                    <tr key={m.month} style={{ opacity: m.received || m.spent ? 1 : 0.45 }}>
                      <td style={{ textTransform: 'capitalize' }}>{m.label}</td>
                      <td className="num">{m.received ? money(m.received) : '—'}</td>
                      <td className="num">{m.spent ? money(m.spent) : '—'}</td>
                      <td className="num" style={{ color: m.net < 0 ? 'var(--danger)' : m.net > 0 ? 'var(--primary)' : undefined }}>
                        {m.received || m.spent ? signed(m.net) : '—'}
                      </td>
                      <td className="month-bars" aria-hidden="true">
                        <span className="bar in" style={{ width: `${(m.received / maxMonthly) * 100}%` }} />
                        <span className="bar out" style={{ width: `${(m.spent / maxMonthly) * 100}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="legend" aria-hidden="true"><span className="dot in" /> Receitas <span className="dot out" /> Despesas</div>
          </div>

          <div className="card">
            <div className="row between" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '.6rem', marginBottom: '.6rem' }}>
              <h3 style={{ margin: 0 }}>Movimentos</h3>
              <div className="filter-tabs" role="tablist" aria-label="Tipo de movimento">
                {[['all', 'Todos'], ['receita', 'Receitas'], ['despesa', 'Despesas']].map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={kind === k}
                    className={`filter-tab${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <SortTh label="Data" sortKey="date" sort={mv.sort} onSort={mv.toggle} />
                  <SortTh label="Tipo" sortKey="type" sort={mv.sort} onSort={mv.toggle} />
                  <SortTh label="Categoria" sortKey="category" sort={mv.sort} onSort={mv.toggle} />
                  <SortTh label="Descrição" sortKey="description" sort={mv.sort} onSort={mv.toggle} />
                  <SortTh label="Valor" sortKey="amount" sort={mv.sort} onSort={mv.toggle} align="right" />
                  <SortTh label="Saldo" sortKey="balance" sort={mv.sort} onSort={mv.toggle} align="right" />
                </tr></thead>
                <tbody>
                  {mv.sorted.map((m, i) => (
                    <tr key={`${m.date}-${i}-${m.description}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(m.date).toLocaleDateString('pt-PT')}</td>
                      <td><span className={`badge ${m.type === 'receita' ? 'income' : 'danger'}`}>{m.type === 'receita' ? 'Receita' : 'Despesa'}</span></td>
                      <td>{m.category}</td>
                      <td>{m.description}{m.supplier ? <span className="hint"> · {m.supplier}</span> : null}</td>
                      <td className="num" style={{ color: m.amount < 0 ? 'var(--danger)' : 'var(--income)' }}>{signed(m.amount)}</td>
                      <td className="num">{money(m.balance)}</td>
                    </tr>
                  ))}
                  {movements.length === 0 && <tr><td colSpan={6} className="empty">Sem movimentos em {year}.</td></tr>}
                </tbody>
              </table>
            </div>
            {!isAdmin && <p className="hint" style={{ marginBottom: 0 }}>Dúvidas sobre algum movimento? Fala com a administração do condomínio.</p>}
          </div>
        </>
      )}
    </div>
  )
}
