"""Frações (unidades) de um condomínio e respetivos proprietários."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from decimal import Decimal

from sqlalchemy import func

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin, require_condo_member, get_user_fraction_ids
from ..services.storage import signed_url, delete_file, StorageError, STORAGE_PREFIX, DOCUMENT_BUCKET
from ..services.purge import delete_fraction, fraction_summary, delete_orphan_owners
from ..services.fraction_ids import find_equivalent
from ..services.ownership import rebalance_on_add, normalize


def _get_fraction(db: Session, condominium_id: str, fraction_id: str) -> models.Fraction:
    fraction = db.query(models.Fraction).filter(
        models.Fraction.id == fraction_id, models.Fraction.condominium_id == condominium_id
    ).first()
    if not fraction:
        raise HTTPException(404, "Fração não encontrada.")
    return fraction

router = APIRouter(prefix="/condominiums/{condominium_id}/fractions", tags=["Frações"])


def _check_duplicate(db: Session, condominium_id: str, identifier: str, exclude_id=None):
    """Impede frações equivalentes no mesmo condomínio ("1º Dto" = "1ºdto" = "1 Direito")."""
    existing = db.query(models.Fraction).filter(models.Fraction.condominium_id == condominium_id).all()
    clash = find_equivalent(existing, identifier, exclude_id=exclude_id)
    if clash:
        raise HTTPException(409, f"Já existe a fração \"{clash.identifier}\" neste condomínio — \"{identifier}\" seria a mesma fração.")


@router.post("", response_model=schemas.FractionOut)
def create_fraction(
    condominium_id: str,
    payload: schemas.FractionCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    data = payload.model_dump()
    data["identifier"] = (data.get("identifier") or "").strip()
    if not data["identifier"]:
        raise HTTPException(400, "Indica o identificador da fração.")
    _check_duplicate(db, condominium_id, data["identifier"])
    fraction = models.Fraction(condominium_id=condominium_id, **data)
    db.add(fraction)
    db.commit()
    db.refresh(fraction)
    return fraction


@router.get("", response_model=List[schemas.FractionOut])
def list_fractions(
    condominium_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    require_condo_member(db, user, condominium_id)
    return (
        db.query(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id, models.Fraction.is_active == True)  # noqa: E712
        .order_by(models.Fraction.identifier)
        .all()
    )


@router.get("/permilagem-check")
def check_permilagem_total(
    condominium_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Soma da permilagem de todas as frações ativas — deve idealmente ser 1000.000."""
    fractions = (
        db.query(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id, models.Fraction.is_active == True)  # noqa: E712
        .all()
    )
    total = sum((Decimal(str(f.permilagem)) for f in fractions), Decimal("0"))
    return {"total_permilagem": float(total), "is_balanced": total == Decimal("1000"), "fraction_count": len(fractions)}


@router.put("/{fraction_id}", response_model=schemas.FractionOut)
def update_fraction(
    condominium_id: str,
    fraction_id: str,
    payload: schemas.FractionCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    fraction = _get_fraction(db, condominium_id, fraction_id)
    # só altera os campos enviados (ex: mudar o identificador não apaga o seguro)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(fraction, k, v.strip() if isinstance(v, str) and k == "identifier" else v)
    if not (fraction.identifier or "").strip():
        db.rollback()
        raise HTTPException(400, "Indica o identificador da fração.")
    try:
        _check_duplicate(db, condominium_id, fraction.identifier, exclude_id=fraction.id)
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    db.refresh(fraction)
    return fraction


@router.put("/{fraction_id}/insurance", response_model=schemas.FractionOut)
def update_fraction_insurance(
    condominium_id: str,
    fraction_id: str,
    payload: schemas.FractionInsuranceUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """Atualiza só o seguro da fração (usado na ficha do condómino)."""
    fraction = _get_fraction(db, condominium_id, fraction_id)
    changes = payload.model_dump(exclude_unset=True)  # só mexe no que foi enviado
    old_doc = fraction.insurance_document_url
    if "insurance_document_url" in changes:
        ref = (changes["insurance_document_url"] or "").strip() or None
        if ref and not ref.startswith(f"{STORAGE_PREFIX}{DOCUMENT_BUCKET}/{condominium_id}/"):
            raise HTTPException(400, "Ficheiro da apólice inválido.")
        changes["insurance_document_url"] = ref
    for k, v in changes.items():
        setattr(fraction, k, (v.strip() or None) if isinstance(v, str) else v)
    db.commit()
    db.refresh(fraction)
    if old_doc and old_doc != fraction.insurance_document_url:
        delete_file(old_doc)  # apólice substituída ou removida: apaga o ficheiro antigo
    return fraction


@router.get("/{fraction_id}/insurance/document")
def open_insurance_document(
    condominium_id: str,
    fraction_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Link temporário (1 hora) para abrir a apólice. Admin ou proprietário da fração."""
    is_admin = require_condo_member(db, user, condominium_id)
    fraction = _get_fraction(db, condominium_id, fraction_id)
    if not is_admin and fraction.id not in get_user_fraction_ids(db, user):
        raise HTTPException(403, "Sem acesso a esta fração.")
    if not fraction.insurance_document_url:
        raise HTTPException(404, "Esta fração não tem a apólice anexada.")
    try:
        return {"url": signed_url(fraction.insurance_document_url, expires_in=3600)}
    except StorageError as e:
        raise HTTPException(503, str(e))


@router.get("/{fraction_id}/delete-preview")
def preview_fraction_delete(
    condominium_id: str,
    fraction_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """O que se perde ao apagar esta fração (para mostrar antes de confirmar)."""
    fraction = _get_fraction(db, condominium_id, fraction_id)
    return {"identifier": fraction.identifier, **fraction_summary(db, fraction.id)}


@router.delete("/{fraction_id}")
def remove_fraction(
    condominium_id: str,
    fraction_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """Apaga definitivamente a fração, com as quotas, pagamentos, votos e associações.
    As ocorrências registadas nessa fração passam a 'zona comum'."""
    fraction = _get_fraction(db, condominium_id, fraction_id)
    summary = delete_fraction(db, fraction)
    db.commit()
    return {"ok": True, "deleted": summary}


@router.post("/{fraction_id}/transfer")
def transfer_fraction(
    condominium_id: str,
    fraction_id: str,
    payload: schemas.FractionTransfer,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """Muda o proprietário (ex: venda da fração). As quotas e o histórico ficam na fração."""
    fraction = _get_fraction(db, condominium_id, fraction_id)
    email = payload.email.strip().lower()
    new_owner = db.query(models.User).filter(func.lower(models.User.email) == email).first()
    if new_owner is None:
        name = (payload.full_name or "").strip()
        if not name:
            raise HTTPException(400, "Ainda não existe ninguém com este email: indica também o nome do novo proprietário.")
        new_owner = models.User(email=email, full_name=name, phone=(payload.phone or "").strip() or None,
                                role=models.UserRole.owner, is_active=True)
        db.add(new_owner)
        db.flush()
    old_links = db.query(models.FractionOwner).filter(models.FractionOwner.fraction_id == fraction.id).all()
    old_user_ids = [l.user_id for l in old_links if l.user_id and l.user_id != new_owner.id]
    for link in old_links:
        db.delete(link)
    db.flush()
    db.add(models.FractionOwner(fraction_id=fraction.id, user_id=new_owner.id, ownership_share=1, is_primary_contact=True))
    db.flush()
    removed = delete_orphan_owners(db, old_user_ids)
    db.commit()
    return {"ok": True, "new_owner": new_owner.full_name, "previous_owners": len(old_user_ids), "previous_records_deleted": removed}


# ---------- Proprietários ----------
@router.post("/{fraction_id}/owners", response_model=schemas.FractionOwnerOut)
def add_owner(
    condominium_id: str,
    fraction_id: str,
    payload: schemas.FractionOwnerCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """Associa um condómino a uma fração. Podes indicar o user_id diretamente (se já
    o souberes) ou, mais simples, o email — se essa pessoa já tiver conta é associada
    logo; caso contrário fica como convite pendente e liga-se sozinha assim que ela
    criar conta com esse email."""
    fraction = db.query(models.Fraction).filter(
        models.Fraction.id == fraction_id, models.Fraction.condominium_id == condominium_id
    ).first()
    if not fraction:
        raise HTTPException(404, "Fração não encontrada.")

    if not payload.user_id and not payload.email:
        raise HTTPException(400, "Indica o email (ou o id) do condómino.")

    owner_user_id = payload.user_id
    invited_email = None
    if not owner_user_id:
        existing = db.query(models.User).filter(func.lower(models.User.email) == payload.email.strip().lower()).first()
        if existing:
            owner_user_id = existing.id
        else:
            invited_email = payload.email
    else:
        owner_user = db.query(models.User).filter(models.User.id == owner_user_id).first()
        if not owner_user:
            raise HTTPException(404, "Utilizador não encontrado.")

    if owner_user_id and db.query(models.FractionOwner).filter(
        models.FractionOwner.fraction_id == fraction_id, models.FractionOwner.user_id == owner_user_id
    ).first():
        raise HTTPException(409, "Esse condómino já está associado a esta fração.")
    link = models.FractionOwner(
        fraction_id=fraction_id,
        user_id=owner_user_id,
        invited_email=invited_email,
        ownership_share=1,
        is_primary_contact=payload.is_primary_contact,
    )
    db.add(link)
    db.flush()
    rebalance_on_add(db, fraction_id, link, payload.ownership_share)
    db.commit()
    db.refresh(link)
    return link


@router.get("/{fraction_id}/owners", response_model=List[schemas.FractionOwnerOut])
def list_owners(
    condominium_id: str,
    fraction_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    _get_fraction(db, condominium_id, fraction_id)
    return db.query(models.FractionOwner).filter(models.FractionOwner.fraction_id == fraction_id).all()


@router.delete("/{fraction_id}/owners/{owner_link_id}")
def remove_owner(
    condominium_id: str,
    fraction_id: str,
    owner_link_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    _get_fraction(db, condominium_id, fraction_id)
    link = db.query(models.FractionOwner).filter(
        models.FractionOwner.id == owner_link_id, models.FractionOwner.fraction_id == fraction_id
    ).first()
    if not link:
        raise HTTPException(404, "Associação não encontrada.")
    user_id = link.user_id
    db.delete(link)
    db.flush()
    normalize(db, fraction_id)
    delete_orphan_owners(db, [user_id])
    db.commit()
    return {"ok": True}
