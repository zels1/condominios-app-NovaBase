"""Ocorrências/manutenção: qualquer condómino pode reportar e ver as ocorrências do seu
condomínio; o admin acompanha e atualiza o estado."""
import uuid
from datetime import datetime, date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin, get_user_fraction_ids
from ..services.storage import upload_public_file, StorageError

router = APIRouter(prefix="/condominiums/{condominium_id}/occurrences", tags=["Manutenção"])

DEFAULT_MAX_UPLOAD_MB = 5
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
}


# ---------- Helpers ----------
def _get_condo(db: Session, condominium_id: str) -> models.Condominium:
    condo = db.query(models.Condominium).filter(models.Condominium.id == condominium_id).first()
    if not condo:
        raise HTTPException(404, "Condomínio não encontrado.")
    return condo


def _is_condo_admin(user: models.User, condo: models.Condominium) -> bool:
    if user.role == models.UserRole.super_admin:
        return True
    return user.role == models.UserRole.admin and condo.admin_user_id == user.id


def _owner_fraction_ids_in_condo(db: Session, user: models.User, condominium_id: str) -> list:
    today = date.today()
    rows = (
        db.query(models.Fraction.id)
        .join(models.FractionOwner, models.FractionOwner.fraction_id == models.Fraction.id)
        .filter(
            models.FractionOwner.user_id == user.id,
            models.Fraction.condominium_id == condominium_id,
            (models.FractionOwner.end_date == None) | (models.FractionOwner.end_date >= today),  # noqa: E711
        )
        .all()
    )
    return [r[0] for r in rows]


def _require_member(db: Session, user: models.User, condo: models.Condominium) -> bool:
    """Devolve True se for admin do condomínio; se for condómino, exige que tenha
    pelo menos uma fração neste condomínio."""
    if _is_condo_admin(user, condo):
        return True
    if not _owner_fraction_ids_in_condo(db, user, condo.id):
        raise HTTPException(403, "Não tens nenhuma fração associada a este condomínio.")
    return False


def _to_out(occ: models.Occurrence, user: models.User, is_admin: bool, fractions: dict, reporters: dict) -> schemas.OccurrenceOut:
    base = schemas.OccurrenceOut.model_validate(occ).model_dump(
        exclude={"fraction_identifier", "reported_by_me", "reporter_name"}
    )
    return schemas.OccurrenceOut(
        **base,
        fraction_identifier=fractions.get(occ.fraction_id),
        reported_by_me=occ.reported_by == user.id,
        reporter_name=reporters.get(occ.reported_by),
    )


def _serialize(db: Session, occs: list, user: models.User, is_admin: bool) -> list:
    fraction_ids = {o.fraction_id for o in occs if o.fraction_id}
    fractions = {
        f.id: f.identifier
        for f in db.query(models.Fraction).filter(models.Fraction.id.in_(fraction_ids)).all()
    } if fraction_ids else {}
    # Nome de quem publicou, visível a todos os membros do condomínio.
    # Se foi o administrador do condomínio, mostra "Administração do condomínio".
    reporters = {}
    ids = {o.reported_by for o in occs}
    if ids:
        admin_ids = {
            c.admin_user_id
            for c in db.query(models.Condominium).filter(models.Condominium.id.in_({o.condominium_id for o in occs})).all()
        }
        for u in db.query(models.User).filter(models.User.id.in_(ids)).all():
            if u.id in admin_ids or u.role == models.UserRole.super_admin:
                reporters[u.id] = "Administração do condomínio"
            else:
                reporters[u.id] = u.full_name or u.email
    return [_to_out(o, user, is_admin, fractions, reporters) for o in occs]


# ---------- Frações que se podem indicar ao reportar ----------
@router.get("/fractions")
def reportable_fractions(
    condominium_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Admin: todas as frações ativas. Condómino: só as suas frações neste condomínio."""
    condo = _get_condo(db, condominium_id)
    is_admin = _require_member(db, user, condo)
    q = db.query(models.Fraction).filter(models.Fraction.condominium_id == condominium_id, models.Fraction.is_active == True)  # noqa: E712
    if not is_admin:
        q = q.filter(models.Fraction.id.in_(_owner_fraction_ids_in_condo(db, user, condominium_id)))
    return [{"id": f.id, "identifier": f.identifier} for f in q.order_by(models.Fraction.identifier).all()]


# ---------- Foto ----------
@router.post("/photo")
async def upload_occurrence_photo(
    condominium_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Recebe a foto em bruto (corpo do pedido = bytes da imagem, Content-Type image/...),
    verifica o tamanho máximo definido pelo administrador e guarda-a no Storage.
    Devolve {"url": ...} para usar em photo_url ao criar a ocorrência."""
    condo = _get_condo(db, condominium_id)
    _require_member(db, user, condo)

    max_mb = condo.max_upload_mb or DEFAULT_MAX_UPLOAD_MB
    max_bytes = max_mb * 1024 * 1024
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(415, "Formato não suportado. Envia uma foto em JPG, PNG, WEBP ou HEIC.")

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes:
        raise HTTPException(413, f"A foto é demasiado grande ({int(declared) / 1048576:.1f} MB). O limite neste condomínio é {max_mb} MB.")

    # Lê em blocos e pára logo que passe o limite (não confia só no Content-Length)
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > max_bytes:
            raise HTTPException(413, f"A foto é demasiado grande. O limite neste condomínio é {max_mb} MB.")
        chunks.append(chunk)
    if size == 0:
        raise HTTPException(400, "Não foi recebida nenhuma foto.")

    path = f"{condominium_id}/{datetime.utcnow():%Y/%m}/{uuid.uuid4().hex}.{ALLOWED_IMAGE_TYPES[content_type]}"
    try:
        url = upload_public_file(b"".join(chunks), path, content_type)
    except StorageError as e:
        raise HTTPException(503, str(e))
    return {"url": url, "size_bytes": size, "max_upload_mb": max_mb}


# ---------- Ocorrências ----------
@router.post("", response_model=schemas.OccurrenceOut)
def report_occurrence(
    condominium_id: str,
    payload: schemas.OccurrenceCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    condo = _get_condo(db, condominium_id)
    is_admin = _require_member(db, user, condo)
    if payload.fraction_id:
        fraction = db.query(models.Fraction).filter(
            models.Fraction.id == payload.fraction_id, models.Fraction.condominium_id == condominium_id
        ).first()
        if not fraction:
            raise HTTPException(404, "Fração não encontrada neste condomínio.")
        # um condómino só pode reportar em nome de uma fração que é sua
        if not is_admin and payload.fraction_id not in get_user_fraction_ids(db, user):
            raise HTTPException(403, "Essa fração não lhe pertence.")
    occ = models.Occurrence(condominium_id=condominium_id, reported_by=user.id, **payload.model_dump())
    db.add(occ)
    db.commit()
    db.refresh(occ)
    return _serialize(db, [occ], user, is_admin)[0]


@router.get("", response_model=List[schemas.OccurrenceOut])
def list_occurrences(
    condominium_id: str,
    status: Optional[str] = None,
    mine: bool = False,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Todos os membros do condomínio veem todas as ocorrências (zonas comuns e frações),
    para saberem o que já foi reportado e acompanharem a resolução.
    mine=true → só as reportadas pelo próprio utilizador."""
    condo = _get_condo(db, condominium_id)
    is_admin = _require_member(db, user, condo)
    q = db.query(models.Occurrence).filter(models.Occurrence.condominium_id == condominium_id)
    if mine:
        q = q.filter(models.Occurrence.reported_by == user.id)
    if status:
        q = q.filter(models.Occurrence.status == status)
    occs = q.order_by(models.Occurrence.created_at.desc()).all()
    return _serialize(db, occs, user, is_admin)


@router.post("/{occurrence_id}/updates", response_model=schemas.OccurrenceOut)
def add_update(
    condominium_id: str,
    occurrence_id: str,
    payload: schemas.OccurrenceUpdateCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    valid = [s.value for s in models.OccurrenceStatus]
    if payload.status not in valid:
        raise HTTPException(400, f"Estado inválido. Usa um de: {', '.join(valid)}.")
    occ = db.query(models.Occurrence).filter(models.Occurrence.id == occurrence_id, models.Occurrence.condominium_id == condominium_id).first()
    if not occ:
        raise HTTPException(404, "Ocorrência não encontrada.")
    update = models.OccurrenceUpdate(occurrence_id=occ.id, updated_by=user.id, **payload.model_dump())
    db.add(update)
    occ.status = payload.status
    if payload.status in ("resolved", "closed"):
        occ.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(occ)
    return _serialize(db, [occ], user, True)[0]
