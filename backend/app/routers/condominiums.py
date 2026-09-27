"""Gestão de condomínios: criação e listagem (o admin cria/gere; o condómino só vê os seus)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_admin, require_condo_admin, require_condo_member
from ..services.purge import condominium_summary, delete_condominium, delete_storage_files

router = APIRouter(prefix="/condominiums", tags=["Condomínios"])


@router.post("", response_model=schemas.CondominiumOut)
def create_condominium(
    payload: schemas.CondominiumSetup,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_admin),
):
    """Cria o condomínio e, se vierem, as frações e os proprietários — tudo de uma vez
    (se alguma coisa falhar, nada fica criado)."""
    data = payload.model_dump(exclude={"fractions"})
    condo = models.Condominium(**data, admin_user_id=user.id)
    db.add(condo)
    db.flush()

    seen = set()
    for i, f in enumerate(payload.fractions, start=1):
        ident = f.identifier.strip()
        if ident.lower() in seen:
            db.rollback()
            raise HTTPException(400, f"A fração \"{ident}\" aparece repetida.")
        seen.add(ident.lower())
        fraction = models.Fraction(condominium_id=condo.id, identifier=ident, permilagem=f.permilagem,
                                   fraction_type=f.fraction_type or "habitação")
        db.add(fraction)
        db.flush()
        name = (f.owner_name or "").strip()
        if f.owner_email:
            email = f.owner_email.strip().lower()
            owner = db.query(models.User).filter(func.lower(models.User.email) == email).first()
            if owner is None:
                if not name:
                    db.rollback()
                    raise HTTPException(400, f"Fração {ident}: indica o nome do proprietário ({email}).")
                owner = models.User(email=email, full_name=name, phone=(f.owner_phone or "").strip() or None,
                                    role=models.UserRole.owner, is_active=True)
                db.add(owner)
                db.flush()
            db.add(models.FractionOwner(fraction_id=fraction.id, user_id=owner.id, ownership_share=1, is_primary_contact=True))
        elif name:
            db.rollback()
            raise HTTPException(400, f"Fração {ident}: indica também o email de {name} (é com ele que vai entrar na app).")
    db.commit()
    db.refresh(condo)
    return condo


@router.get("", response_model=List[schemas.CondominiumOut])
def list_condominiums(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    if user.role in (models.UserRole.admin, models.UserRole.super_admin):
        q = db.query(models.Condominium)
        if user.role == models.UserRole.admin:
            q = q.filter(models.Condominium.admin_user_id == user.id)
        return q.order_by(models.Condominium.name).all()
    # condómino: só os condomínios onde tem frações
    fraction_ids = (
        db.query(models.Fraction.condominium_id)
        .join(models.FractionOwner)
        .filter(models.FractionOwner.user_id == user.id)
        .distinct()
    )
    return db.query(models.Condominium).filter(models.Condominium.id.in_(fraction_ids)).all()


@router.get("/{condominium_id}", response_model=schemas.CondominiumOut)
def get_condominium(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    require_condo_member(db, user, condominium_id)
    condo = db.query(models.Condominium).filter(models.Condominium.id == condominium_id).first()
    if not condo:
        raise HTTPException(404, "Condomínio não encontrado.")
    return condo


@router.put("/{condominium_id}", response_model=schemas.CondominiumOut)
def update_condominium(
    condominium_id: str,
    payload: schemas.CondominiumCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    condo = db.query(models.Condominium).filter(models.Condominium.id == condominium_id).first()
    if not condo:
        raise HTTPException(404, "Condomínio não encontrado.")
    for k, v in payload.model_dump().items():
        setattr(condo, k, v)
    db.commit()
    db.refresh(condo)
    return condo


@router.get("/{condominium_id}/delete-preview")
def preview_condominium_delete(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    """O que se perde ao eliminar o condomínio (para mostrar antes de confirmar)."""
    condo = db.query(models.Condominium).filter(models.Condominium.id == condominium_id).first()
    if not condo:
        raise HTTPException(404, "Condomínio não encontrado.")
    return {"name": condo.name, **condominium_summary(db, condominium_id)}


@router.delete("/{condominium_id}")
def remove_condominium(
    condominium_id: str,
    confirm_name: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """Elimina definitivamente o condomínio e TUDO o que lhe pertence. Por segurança exige
    que se escreva o nome exato do condomínio em confirm_name."""
    condo = db.query(models.Condominium).filter(models.Condominium.id == condominium_id).first()
    if not condo:
        raise HTTPException(404, "Condomínio não encontrado.")
    if confirm_name.strip() != (condo.name or "").strip():
        raise HTTPException(400, "O nome escrito não corresponde ao nome do condomínio. Nada foi apagado.")
    summary = delete_condominium(db, condo)
    doc_refs = summary.pop("_doc_refs", [])
    db.commit()
    delete_storage_files(doc_refs)
    return {"ok": True, "deleted": summary}
