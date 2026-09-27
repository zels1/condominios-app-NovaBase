import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'
import { useSort, SortTh } from '../components/SortableTable'
import FilePicker from '../components/FilePicker'
import { DOC_ACCEPT, DOC_MAX_MB, checkDocFile, uploadDocFile } from '../lib/files'

const SUPPLIER_COLUMNS = {
  name: (s) => s.name,
  category: (s) => s.category,
  contact: (s) => s.contact_phone || s.contact_email,
}
// Estado de um contrato a partir das datas
function contractState(c) {
  const today = new Date().toISOString().slice(0, 10)
  if (c.start_date && c.start_date > today) return { key: 'future', rank: 2, label: 'Ainda não começou', cls: '' }
  if (!c.end_date) return { key: 'active', rank: 1, label: 'Em vigor (sem data de fim)', cls: 'ok' }
  if (c.end_date < today) return { key: 'expired', rank: 3, label: 'Expirado', cls: 'danger' }
  const days = Math.round((new Date(c.end_date) - new Date(today)) / 86400000)
  if (days <= (c.renewal_alert_days ?? 30)) return { key: 'active', rank: 0, label: days === 0 ? 'Expira hoje' : `Expira em ${days} dia(s)`, cls: 'warn' }
  return { key: 'active', rank: 1, label: 'Em vigor', cls: 'ok' }
}
const CONTRACT_COLUMNS = {
  title: (c) => c.title,
  supplier: (c) => c.supplier_name,
  start: (c) => c.start_date,
  end: (c) => c.end_date,
  value: (c) => (c.annual_value == null ? null : Number(c.annual_value)),
  status: (c) => contractState(c).rank,
}

function money(v) { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v || 0) }

export default function AdminSuppliers() {
  const { selectedCondo } = useCondo()
  const [tab, setTab] = useState('suppliers')
  const [suppliers, setSuppliers] = useState([])
  const [contracts, setContracts] = useState([])
  const [expenses, setExpenses] = useState([])
  const [supplierForm, setSupplierForm] = useState({ name: '', nif: '', category: '', contact_phone: '', contact_email: '' })
  const [expenseForm, setExpenseForm] = useState({ category: '', description: '', amount: '', supplier_id: '' })

  async function load() {
    const [s, c, e] = await Promise.all([
      api.get(`/condominiums/${selectedCondo.id}/suppliers`),
      api.get(`/condominiums/${selectedCondo.id}/contracts`),
      api.get(`/condominiums/${selectedCondo.id}/expenses`),
    ])
    setSuppliers(s); setContracts(c); setExpenses(e)
  }
  useEffect(() => { if (selectedCondo) load() }, [selectedCondo])

  async function createSupplier(e) {
    e.preventDefault()
    await api.post(`/condominiums/${selectedCondo.id}/suppliers`, supplierForm)
    setSupplierForm({ name: '', nif: '', category: '', contact_phone: '', contact_email: '' })
    load()
  }

  async function createExpense(e) {
    e.preventDefault()
    await api.post(`/condominiums/${selectedCondo.id}/expenses`, {
      category: expenseForm.category, description: expenseForm.description || undefined,
      amount: parseFloat(expenseForm.amount), supplier_id: expenseForm.supplier_id || undefined,
    })
    setExpenseForm({ category: '', description: '', amount: '', supplier_id: '' })
    load()
  }

  const supplierName = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s.name])), [suppliers])
  const expenseColumns = useMemo(() => ({
    date: (e) => e.expense_date,
    category: (e) => e.category,
    description: (e) => e.description,
    supplier: (e) => supplierName[e.supplier_id],
    amount: (e) => Number(e.amount),
  }), [supplierName])
  const sSort = useSort(suppliers, SUPPLIER_COLUMNS, 'name')
  const [contractFilter, setContractFilter] = useState('active') // active | expired | all
  const visibleContracts = useMemo(() => contracts.filter((c) => {
    const st = contractState(c).key
    return contractFilter === 'all' || (contractFilter === 'active' ? st !== 'expired' : st === 'expired')
  }), [contracts, contractFilter])
  const cSort = useSort(visibleContracts, CONTRACT_COLUMNS, 'status')
  const eSort = useSort(expenses, expenseColumns, 'date', 'desc')
  const expenseTotal = expenses.reduce((t, e) => t + Number(e.amount), 0)

  if (!selectedCondo) return null

  return (
    <div className="stack">
      <h1>Fornecedores e Despesas</h1>
      <div className="tabs">
        <button className={tab === 'suppliers' ? 'active' : ''} onClick={() => setTab('suppliers')}>Fornecedores</button>
        <button className={tab === 'contracts' ? 'active' : ''} onClick={() => setTab('contracts')}>Contratos</button>
        <button className={tab === 'expenses' ? 'active' : ''} onClick={() => setTab('expenses')}>Despesas</button>
      </div>

      {tab === 'suppliers' && (
        <div className="stack">
          <div className="card">
            <h3>Novo fornecedor</h3>
            <form onSubmit={createSupplier} className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1, minWidth: 160 }}><label>Nome *</label><input value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} required /></div>
              <div className="field" style={{ width: 150 }}><label>Categoria</label><input value={supplierForm.category} onChange={(e) => setSupplierForm({ ...supplierForm, category: e.target.value })} placeholder="limpeza, jardim…" /></div>
              <div className="field" style={{ width: 160 }}><label>Telefone</label><input value={supplierForm.contact_phone} onChange={(e) => setSupplierForm({ ...supplierForm, contact_phone: e.target.value })} /></div>
              <button className="btn" style={{ marginBottom: '.9em' }}>Adicionar</button>
            </form>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table><thead><tr>
                <SortTh label="Nome" sortKey="name" sort={sSort.sort} onSort={sSort.toggle} />
                <SortTh label="Categoria" sortKey="category" sort={sSort.sort} onSort={sSort.toggle} />
                <SortTh label="Contacto" sortKey="contact" sort={sSort.sort} onSort={sSort.toggle} />
              </tr></thead>
                <tbody>
                  {sSort.sorted.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.category || '—'}</td><td>{s.contact_phone || s.contact_email || '—'}</td></tr>)}
                  {suppliers.length === 0 && <tr><td colSpan={3} className="empty">Sem fornecedores.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'contracts' && (
        <div className="stack">
          <ContractForm condoId={selectedCondo.id} suppliers={suppliers} onCreated={load} onGoSuppliers={() => setTab('suppliers')} />
          <div className="card">
            <div className="row between" style={{ alignItems: 'center', gap: '.6rem', marginBottom: '.6rem' }}>
              <h3 style={{ margin: 0 }}>Contratos</h3>
              <div className="filter-tabs" role="tablist" aria-label="Filtrar contratos">
                {[['active', 'Em vigor'], ['expired', 'Expirados'], ['all', 'Todos']].map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={contractFilter === k}
                    className={`filter-tab${contractFilter === k ? ' active' : ''}`} onClick={() => setContractFilter(k)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="table-wrap">
              <table><thead><tr>
                <SortTh label="Contrato" sortKey="title" sort={cSort.sort} onSort={cSort.toggle} />
                <SortTh label="Fornecedor" sortKey="supplier" sort={cSort.sort} onSort={cSort.toggle} />
                <SortTh label="Início" sortKey="start" sort={cSort.sort} onSort={cSort.toggle} />
                <SortTh label="Fim" sortKey="end" sort={cSort.sort} onSort={cSort.toggle} />
                <SortTh label="Valor anual" sortKey="value" sort={cSort.sort} onSort={cSort.toggle} align="right" />
                <SortTh label="Estado" sortKey="status" sort={cSort.sort} onSort={cSort.toggle} />
                <th><span className="visually-hidden">Ações</span></th>
              </tr></thead>
                <tbody>
                  {cSort.sorted.map((c) => {
                    const st = contractState(c)
                    return (
                      <tr key={c.id}>
                        <td><strong>{c.title}</strong></td>
                        <td>{c.supplier_name || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{c.start_date ? new Date(c.start_date).toLocaleDateString('pt-PT') : '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{c.end_date ? new Date(c.end_date).toLocaleDateString('pt-PT') : '—'}</td>
                        <td className="num">{c.annual_value != null ? money(c.annual_value) : '—'}</td>
                        <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                        <td>
                          <div className="row" style={{ gap: '.3rem', flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                            {c.has_document && (
                              <button type="button" className="btn secondary small"
                                onClick={() => api.openFile(`/condominiums/${selectedCondo.id}/contracts/${c.id}/document`).catch((e) => alert(e.message))}>Ver contrato</button>
                            )}
                            <button type="button" className="btn secondary small" onClick={async () => {
                              if (!window.confirm(`Apagar o contrato "${c.title}"?`)) return
                              try { await api.del(`/condominiums/${selectedCondo.id}/contracts/${c.id}`); load() } catch (e) { alert(e.message) }
                            }}>Apagar</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {visibleContracts.length === 0 && (
                    <tr><td colSpan={7} className="empty">
                      {contracts.length === 0 ? 'Ainda não há contratos. Adiciona o primeiro acima.' : contractFilter === 'expired' ? 'Não há contratos expirados.' : 'Não há contratos em vigor.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'expenses' && (
        <div className="stack">
          <div className="card">
            <h3>Nova despesa</h3>
            <form onSubmit={createExpense} className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ width: 160 }}><label>Categoria *</label><input value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })} required /></div>
              <div className="field" style={{ flex: 1, minWidth: 160 }}><label>Descrição</label><input value={expenseForm.description} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} /></div>
              <div className="field" style={{ width: 140 }}><label>Valor (€) *</label><input type="number" step="0.01" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} required /></div>
              <div className="field" style={{ width: 180 }}>
                <label>Fornecedor</label>
                <select value={expenseForm.supplier_id} onChange={(e) => setExpenseForm({ ...expenseForm, supplier_id: e.target.value })}>
                  <option value="">—</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <button className="btn" style={{ marginBottom: '.9em' }}>Adicionar</button>
            </form>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table><thead><tr>
                <SortTh label="Data" sortKey="date" sort={eSort.sort} onSort={eSort.toggle} />
                <SortTh label="Categoria" sortKey="category" sort={eSort.sort} onSort={eSort.toggle} />
                <SortTh label="Descrição" sortKey="description" sort={eSort.sort} onSort={eSort.toggle} />
                <SortTh label="Fornecedor" sortKey="supplier" sort={eSort.sort} onSort={eSort.toggle} />
                <SortTh label="Valor" sortKey="amount" sort={eSort.sort} onSort={eSort.toggle} align="right" />
              </tr></thead>
                <tbody>
                  {eSort.sorted.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.expense_date).toLocaleDateString('pt-PT')}</td>
                      <td>{e.category}</td>
                      <td>{e.description || '—'}</td>
                      <td>{supplierName[e.supplier_id] || '—'}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(e.amount)}</td>
                    </tr>
                  ))}
                  {expenses.length === 0 && <tr><td colSpan={5} className="empty">Sem despesas registadas.</td></tr>}
                </tbody>
                {expenses.length > 0 && (
                  <tfoot><tr><td colSpan={4}><strong>Total ({expenses.length} despesas)</strong></td><td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><strong>{money(expenseTotal)}</strong></td></tr></tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const EMPTY_CONTRACT = { supplier_id: '', title: '', start_date: '', end_date: '', renewal_alert_days: '30', annual_value: '' }

function ContractForm({ condoId, suppliers, onCreated, onGoSuppliers }) {
  const [form, setForm] = useState(EMPTY_CONTRACT)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [ok, setOk] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setErr(null); setOk(null)
    if (form.start_date && form.end_date && form.end_date < form.start_date) { setErr('A data de fim não pode ser anterior à de início.'); return }
    setBusy(true)
    try {
      const document_url = file ? await uploadDocFile(condoId, file) : undefined
      await api.post(`/condominiums/${condoId}/suppliers/${form.supplier_id}/contracts`, {
        supplier_id: form.supplier_id,
        title: form.title.trim(),
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
        renewal_alert_days: parseInt(form.renewal_alert_days, 10) || 30,
        annual_value: form.annual_value === '' ? undefined : parseFloat(String(form.annual_value).replace(',', '.')),
        document_url,
      })
      setOk(`Contrato "${form.title.trim()}" adicionado.`)
      setForm(EMPTY_CONTRACT); setFile(null)
      onCreated()
    } catch (e2) { setErr(e2.message) }
    setBusy(false)
  }

  if (suppliers.length === 0) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Novo contrato</h3>
        <p className="hint">Para adicionar um contrato, cria primeiro o fornecedor.</p>
        <button type="button" className="btn secondary" onClick={onGoSuppliers}>Ir para Fornecedores</button>
      </div>
    )
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Novo contrato</h3>
      {err && <div className="msg error" style={{ marginBottom: '.8em' }}>{err}</div>}
      {ok && <div className="msg success" style={{ marginBottom: '.8em' }}>{ok}</div>}
      <form onSubmit={submit} className="stack">
        <div className="row form-row">
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="ct-supplier">Fornecedor *</label>
            <select id="ct-supplier" value={form.supplier_id} onChange={set('supplier_id')} required>
              <option value="">Selecionar…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 2, minWidth: 220 }}>
            <label htmlFor="ct-title">Título *</label>
            <input id="ct-title" value={form.title} onChange={set('title')} required placeholder="Ex: Manutenção do elevador 2026–2027" />
          </div>
        </div>
        <div className="row form-row">
          <div className="field" style={{ width: 160 }}>
            <label htmlFor="ct-start">Início</label>
            <input id="ct-start" type="date" value={form.start_date} onChange={set('start_date')} />
          </div>
          <div className="field" style={{ width: 160 }}>
            <label htmlFor="ct-end">Fim</label>
            <input id="ct-end" type="date" value={form.end_date} onChange={set('end_date')} />
          </div>
          <div className="field" style={{ width: 170 }}>
            <label htmlFor="ct-alert">Avisar (dias antes do fim)</label>
            <input id="ct-alert" type="number" min={0} max={365} value={form.renewal_alert_days} onChange={set('renewal_alert_days')} />
          </div>
          <div className="field" style={{ width: 160 }}>
            <label htmlFor="ct-value">Valor anual (€)</label>
            <input id="ct-value" type="number" step="0.01" min="0" value={form.annual_value} onChange={set('annual_value')} />
          </div>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="ct-file">Contrato (ficheiro)</label>
          <FilePicker id="ct-file" accept={DOC_ACCEPT} file={file} disabled={busy} emptyText="Opcional"
            onFile={(f) => { const p = checkDocFile(f); if (p) { setErr(p); return } setErr(null); setFile(f) }}
            hint={`PDF, imagem ou Word. Máximo ${DOC_MAX_MB} MB. Fica privado — só a administração o pode abrir.`} />
        </div>
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy}>{busy ? 'A guardar…' : 'Adicionar contrato'}</button>
      </form>
    </div>
  )
}
