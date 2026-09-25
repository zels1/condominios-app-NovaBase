import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

export default function AdminLateFees() {
  const { selectedCondo } = useCondo()
  const [form, setForm] = useState(null)
  const [runResult, setRunResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!selectedCondo) return
    api.get(`/condominiums/${selectedCondo.id}/late-fee-config`)
      .then((c) => setForm(c))
      .catch(() => {
        const defaults = { enabled: true, grace_period_days: 8, fee_type: 'percentage', fee_value: 10, max_fee_amount: '' }
        setForm(defaults)
      })
  }, [selectedCondo])

  async function save(e) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      const payload = {
        enabled: form.enabled,
        grace_period_days: parseInt(form.grace_period_days),
        fee_type: form.fee_type,
        fee_value: parseFloat(form.fee_value),
        max_fee_amount: form.max_fee_amount ? parseFloat(form.max_fee_amount) : null,
      }
      const saved = await api.put(`/condominiums/${selectedCondo.id}/late-fee-config`, payload)
      setForm(saved)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function run() {
    setRunResult(null)
    const result = await api.post(`/condominiums/${selectedCondo.id}/late-fee-config/run`)
    setRunResult(result)
  }

  if (!selectedCondo || !form) return null

  return (
    <div className="stack">
      <h1>Juros de mora</h1>
      <p style={{ color: 'var(--text-muted)' }}>Configura como e quando os juros de mora são aplicados automaticamente às quotas em atraso.</p>

      <div className="card">
        {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
        <form onSubmit={save} className="stack">
          <label className="row" style={{ gap: '.6em' }}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Aplicar juros de mora automaticamente
          </label>
          <div className="field">
            <label>Período de tolerância (dias após vencimento)</label>
            <input type="number" min={0} value={form.grace_period_days} onChange={(e) => setForm({ ...form, grace_period_days: e.target.value })} />
            <span className="hint">Padrão legal comum em Portugal: 8 dias.</span>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Tipo de juro</label>
              <select value={form.fee_type} onChange={(e) => setForm({ ...form, fee_type: e.target.value })}>
                <option value="percentage">Percentagem sobre a dívida</option>
                <option value="fixed">Valor fixo (€)</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Valor {form.fee_type === 'percentage' ? '(%)' : '(€)'}</label>
              <input type="number" step="0.01" value={form.fee_value} onChange={(e) => setForm({ ...form, fee_value: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Limite máximo de juro (opcional, €)</label>
            <input type="number" step="0.01" value={form.max_fee_amount ?? ''} onChange={(e) => setForm({ ...form, max_fee_amount: e.target.value })} />
          </div>
          <button className="btn" disabled={busy}>{busy ? 'A guardar…' : 'Guardar configuração'}</button>
        </form>
      </div>

      <div className="card">
        <h3>Aplicar agora</h3>
        <p style={{ color: 'var(--text-muted)' }}>
          Corre o motor de juros de mora imediatamente para todas as quotas elegíveis. O juro fica sempre discriminado à
          parte do valor base — nunca é somado sem se perceber a origem.
        </p>
        <button className="btn" onClick={run}>Aplicar juros de mora agora</button>
        {runResult && (
          <div className="msg success" style={{ marginTop: '1em' }}>
            {runResult.applied > 0 ? `Juro aplicado a ${runResult.applied} quota(s).` : (runResult.message || 'Nenhuma quota elegível neste momento.')}
          </div>
        )}
        <p className="hint" style={{ marginTop: '1em' }}>
          Dica: em produção, agenda esta chamada para correr automaticamente todos os dias (ex: um cron job no Render
          que chama este endpoint), em vez de teres de carregar aqui manualmente.
        </p>
      </div>
    </div>
  )
}
