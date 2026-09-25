import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

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
              <table><thead><tr><th>Nome</th><th>Categoria</th><th>Contacto</th></tr></thead>
                <tbody>
                  {suppliers.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.category || '—'}</td><td>{s.contact_phone || s.contact_email || '—'}</td></tr>)}
                  {suppliers.length === 0 && <tr><td colSpan={3} className="empty">Sem fornecedores.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'contracts' && (
        <div className="card">
          <div className="table-wrap">
            <table><thead><tr><th>Título</th><th>Fim</th><th>Alerta (dias antes)</th><th>Valor anual</th></tr></thead>
              <tbody>
                {contracts.map((c) => <tr key={c.id}><td>{c.title}</td><td>{c.end_date ? new Date(c.end_date).toLocaleDateString('pt-PT') : '—'}</td><td>{c.renewal_alert_days}</td><td>{c.annual_value ? money(c.annual_value) : '—'}</td></tr>)}
                {contracts.length === 0 && <tr><td colSpan={4} className="empty">Sem contratos. Adiciona-os a partir da página de um fornecedor específico via API, ou pede para adicionarmos aqui um formulário dedicado.</td></tr>}
              </tbody>
            </table>
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
              <table><thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Valor</th></tr></thead>
                <tbody>
                  {expenses.map((e) => <tr key={e.id}><td>{new Date(e.expense_date).toLocaleDateString('pt-PT')}</td><td>{e.category}</td><td>{e.description || '—'}</td><td>{money(e.amount)}</td></tr>)}
                  {expenses.length === 0 && <tr><td colSpan={4} className="empty">Sem despesas registadas.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
