import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useCondo } from '../lib/CondoContext'

export default function AdminReminders() {
  const { selectedCondo } = useCondo()
  const [steps, setSteps] = useState([])
  const [form, setForm] = useState({ days_after_due: '', channel: 'email', message_template: 'A sua quota de {mes} está em atraso. Valor em dívida: {valor}€.' })
  const [runResult, setRunResult] = useState(null)
  const [error, setError] = useState(null)

  async function load() { setSteps(await api.get(`/condominiums/${selectedCondo.id}/reminder-configs`)) }
  useEffect(() => { if (selectedCondo) load() }, [selectedCondo])

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    try {
      await api.post(`/condominiums/${selectedCondo.id}/reminder-configs`, {
        days_after_due: parseInt(form.days_after_due), channel: form.channel, message_template: form.message_template, enabled: true,
      })
      setForm({ ...form, days_after_due: '' })
      load()
    } catch (err) { setError(err.message) }
  }

  async function toggle(step) {
    await api.put(`/condominiums/${selectedCondo.id}/reminder-configs/${step.id}`, { ...step, enabled: !step.enabled })
    load()
  }

  async function remove(id) {
    await api.del(`/condominiums/${selectedCondo.id}/reminder-configs/${id}`)
    load()
  }

  async function run() {
    setRunResult(null)
    setRunResult(await api.post(`/condominiums/${selectedCondo.id}/reminder-configs/run`))
  }

  if (!selectedCondo) return null

  return (
    <div className="stack">
      <h1>Lembretes automáticos</h1>
      <p style={{ color: 'var(--text-muted)' }}>
        Define os "degraus" do calendário de lembretes (ex: 7, 15, 30 dias após o vencimento). Cada quota em atraso só recebe
        um lembrete de cada degrau uma única vez.
      </p>

      <div className="card">
        <h3>Novo degrau</h3>
        {error && <div className="msg error" style={{ marginBottom: '1em' }}>{error}</div>}
        <form onSubmit={handleCreate} className="stack">
          <div className="row">
            <div className="field" style={{ width: 160 }}>
              <label>Dias após vencimento</label>
              <input type="number" min={1} value={form.days_after_due} onChange={(e) => setForm({ ...form, days_after_due: e.target.value })} required />
            </div>
            <div className="field" style={{ width: 160 }}>
              <label>Canal</label>
              <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                <option value="email">Email</option>
                <option value="in_app">Notificação na app</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Mensagem (usa {'{mes}'} e {'{valor}'})</label>
            <textarea rows={2} value={form.message_template} onChange={(e) => setForm({ ...form, message_template: e.target.value })} />
          </div>
          <button className="btn" style={{ alignSelf: 'flex-start' }}>Adicionar degrau</button>
        </form>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Dias</th><th>Canal</th><th>Mensagem</th><th>Ativo</th><th></th></tr></thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.id}>
                  <td>{s.days_after_due}</td>
                  <td>{s.channel}</td>
                  <td style={{ maxWidth: 320 }}>{s.message_template}</td>
                  <td><button className={`badge ${s.enabled ? 'ok' : ''}`} style={{ cursor: 'pointer', border: 'none' }} onClick={() => toggle(s)}>{s.enabled ? 'Ativo' : 'Inativo'}</button></td>
                  <td><button className="btn danger small" onClick={() => remove(s.id)}>Remover</button></td>
                </tr>
              ))}
              {steps.length === 0 && <tr><td colSpan={5} className="empty">Sem lembretes configurados.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Disparar lembretes agora</h3>
        <button className="btn" onClick={run}>Correr motor de lembretes</button>
        {runResult && <div className="msg success" style={{ marginTop: '1em' }}>{runResult.queued} lembrete(s) colocado(s) na fila.</div>}
        <p className="hint" style={{ marginTop: '1em' }}>
          Isto cria os registos na fila (estado "queued"). O envio real (email/SMS) precisa de um serviço externo ligado
          a este endpoint — em produção, agenda esta chamada diariamente.
        </p>
      </div>
    </div>
  )
}
