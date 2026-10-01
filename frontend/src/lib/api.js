import { supabase } from './supabase'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function request(path, { method = 'GET', body, params } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  let url = `${BASE_URL}${path}`
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString()
    if (qs) url += `?${qs}`
  }

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    let detail = res.statusText
    try {
      const errJson = await res.json()
      detail = errJson.detail || JSON.stringify(errJson)
    } catch {
      // resposta sem corpo JSON
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  if (res.status === 204) return null
  return res.json()
}

// Envia um ficheiro em bruto (ex: foto) — o corpo do pedido são os bytes do ficheiro.
async function upload(path, blob, contentType) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType || blob.type || 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: blob,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const errJson = await res.json()
      detail = errJson.detail || JSON.stringify(errJson)
    } catch {
      if (res.status === 413) detail = 'O ficheiro é demasiado grande.'
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return res.json()
}

// Descarrega um ficheiro da API (ex: recibo em PDF) e oferece-o ao utilizador para guardar.
async function download(path, fallbackName = 'ficheiro') {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`${BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    let detail = res.statusText
    try { detail = (await res.json()).detail || detail } catch { /* sem JSON */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  const blob = await res.blob()
  const match = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = match ? match[1] : fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// Vai buscar um ficheiro à API e devolve-o (sem o guardar): { blob, filename }
async function fetchFile(path, fallbackName = 'ficheiro') {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`${BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    let detail = res.statusText
    try { detail = (await res.json()).detail || detail } catch { /* sem JSON */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  const match = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '')
  return { blob: await res.blob(), filename: match ? match[1] : fallbackName }
}

// Abre um ficheiro privado: pede à API um link temporário e abre-o num separador novo.
// A janela é aberta logo no clique (senão o browser bloqueia-a como pop-up).
async function openFile(path) {
  const win = window.open('', '_blank')
  try {
    const { url } = await request(path)
    if (win) win.location.href = url
    else window.location.href = url
  } catch (err) {
    if (win) win.close()
    throw err
  }
}

export const api = {
  get: (path, params) => request(path, { params }),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload,
  download,
  fetchFile,
  openFile,
}
