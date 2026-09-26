"""Documentos (com alerta de expiração) e comunicados gerais.

Os documentos podem ser um link externo (Google Drive, etc.) ou um ficheiro anexado na
própria app. Os ficheiros anexados ficam num bucket PRIVADO do Supabase Storage e só se
abrem com um link temporário gerado para quem é membro do condomínio."""
import re
import unicodedata
import uuid
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin, require_condo_member
from ..services.storage import (
    upload_private_file, signed_url, delete_file, is_private_ref, StorageError, DOCUMENT_BUCKET, STORAGE_PREFIX,
)

router = APIRouter(prefix="/condominiums/{condominium_id}", tags=["Documentos e Comunicados"])

MAX_DOCUMENT_MB = 20
ALLOWED_DOCUMENT_TYPES = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.oasis.opendocument.text": "odt",
    "application/vnd.oasis.opendocument.spreadsheet": "ods",
    "text/plain": "txt",
}


def _safe_filename(name: str, ext: str) -> str:
    # "Ata março 2026.pdf" → "Ata-marco-2026.pdf" (sem acentos nem espaços)
    name = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", (name or "").rsplit(".", 1)[0]).strip("-.")[:60] or "documento"
    return f"{base}.{ext}"


def _doc_out(doc: models.Document) -> schemas.DocumentOut:
    out = schemas.DocumentOut.model_validate(doc)
    if is_private_ref(doc.file_url):
        try:
            url = signed_url(doc.file_url, expires_in=3600)
        except StorageError:
            url = ""  # o frontend mostra "indisponível" em vez de rebentar a lista
        return out.model_copy(update={"file_url": url, "is_file": True})
    return out


@router.post("/documents/upload")
async def upload_document_file(
    condominium_id: str,
    request: Request,
    filename: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """Recebe o ficheiro em bruto (corpo = bytes, Content-Type do ficheiro) e guarda-o.
    Devolve {"file_ref": "sb://..."} para usar em file_url ao criar o documento."""
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_DOCUMENT_TYPES:
        raise HTTPException(415, "Tipo de ficheiro não suportado. Usa PDF, imagem, Word, Excel, OpenDocument ou texto.")
    max_bytes = MAX_DOCUMENT_MB * 1024 * 1024
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes:
        raise HTTPException(413, f"O ficheiro é demasiado grande ({int(declared) / 1048576:.1f} MB). O máximo é {MAX_DOCUMENT_MB} MB.")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > max_bytes:
            raise HTTPException(413, f"O ficheiro é demasiado grande. O máximo é {MAX_DOCUMENT_MB} MB.")
        chunks.append(chunk)
    if size == 0:
        raise HTTPException(400, "Não foi recebido nenhum ficheiro.")

    name = _safe_filename(filename, ALLOWED_DOCUMENT_TYPES[content_type])
    path = f"{condominium_id}/{datetime.utcnow():%Y/%m}/{uuid.uuid4().hex[:12]}-{name}"
    try:
        ref = upload_private_file(b"".join(chunks), path, content_type)
    except StorageError as e:
        raise HTTPException(503, str(e))
    return {"file_ref": ref, "size_bytes": size, "file_name": name}


@router.post("/documents", response_model=schemas.DocumentOut)
def create_document(condominium_id: str, payload: schemas.DocumentCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    file_url = (payload.file_url or "").strip()
    if is_private_ref(file_url):
        # só aceita ficheiros deste condomínio, enviados pelo endpoint de upload
        if not file_url.startswith(f"{STORAGE_PREFIX}{DOCUMENT_BUCKET}/{condominium_id}/"):
            raise HTTPException(400, "Referência de ficheiro inválida.")
    elif not re.match(r"^https?://", file_url, re.I):
        raise HTTPException(400, "Indica um link que comece por http:// ou https://, ou anexa um ficheiro.")
    doc = models.Document(condominium_id=condominium_id, uploaded_by=user.id,
                          **{**payload.model_dump(), "file_url": file_url})
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _doc_out(doc)


@router.get("/documents", response_model=List[schemas.DocumentOut])
def list_documents(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    require_condo_member(db, user, condominium_id)
    docs = db.query(models.Document).filter(models.Document.condominium_id == condominium_id).order_by(models.Document.created_at.desc()).all()
    return [_doc_out(d) for d in docs]


@router.delete("/documents/{document_id}")
def delete_document(condominium_id: str, document_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    doc = db.query(models.Document).filter(models.Document.id == document_id, models.Document.condominium_id == condominium_id).first()
    if not doc:
        raise HTTPException(404, "Documento não encontrado.")
    ref = doc.file_url
    db.delete(doc)
    db.commit()
    if is_private_ref(ref):
        delete_file(ref)
    return {"ok": True}


@router.post("/communications", response_model=schemas.CommunicationOut)
def send_communication(condominium_id: str, payload: schemas.CommunicationCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    comm = models.Communication(condominium_id=condominium_id, sent_by=user.id, **payload.model_dump())
    db.add(comm)
    db.commit()
    db.refresh(comm)
    return comm


@router.get("/communications", response_model=List[schemas.CommunicationOut])
def list_communications(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    require_condo_member(db, user, condominium_id)
    return db.query(models.Communication).filter(models.Communication.condominium_id == condominium_id).order_by(models.Communication.created_at.desc()).all()
