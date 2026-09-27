import { api } from './api'

// Tipos aceites nos anexos privados (apólices, contratos) — os mesmos dos Documentos.
export const DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.odt,.ods,.txt'
export const DOC_MAX_MB = 20
const EXT_TYPES = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', txt: 'text/plain',
}

// Devolve uma mensagem de erro se o ficheiro não for aceite, ou null se estiver tudo bem.
export function checkDocFile(file) {
  if (!file) return null
  const ext = file.name.split('.').pop().toLowerCase()
  if (!EXT_TYPES[ext]) return 'Tipo de ficheiro não suportado. Usa PDF, imagem, Word, Excel, OpenDocument ou texto.'
  if (file.size > DOC_MAX_MB * 1048576) return `O ficheiro tem ${(file.size / 1048576).toFixed(1)} MB e o máximo é ${DOC_MAX_MB} MB.`
  return null
}

// Envia o ficheiro para o armazenamento privado do condomínio e devolve a referência (sb://…).
export async function uploadDocFile(condoId, file) {
  const ext = file.name.split('.').pop().toLowerCase()
  const res = await api.upload(`/condominiums/${condoId}/documents/upload?filename=${encodeURIComponent(file.name)}`, file, EXT_TYPES[ext])
  return res.file_ref
}
