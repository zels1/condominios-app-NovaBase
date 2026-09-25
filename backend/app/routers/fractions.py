"""Frações (unidades) de um condomínio e respetivos proprietários."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from decimal import Decimal

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin

router = APIRouter(prefix="/condominiums/{condominium_id}/fractions", tags=["Frações"])


@router.post("", response_model=schemas.FractionOut)
def create_fraction(
    condominium_id: str,
    payload: schemas.FractionCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    fraction = models.Fraction(condominium_id=condominium_id, **payload.model_dump())
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
    fraction = db.query(models.Fraction).filter(
        models.Fraction.id == fraction_id, models.Fraction.condominium_id == condominium_id
    ).first()
    if not fraction:
        raise HTTPException(404, "Fração não encontrada.")
    for k, v in payload.model_dump().items():
        setattr(fraction, k, v)
    db.commit()
    db.refresh(fraction)
    return fraction


@router.delete("/{fraction_id}")
def deactivate_fraction(
    condominium_id: str,
    fraction_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    fraction = db.query(models.Fraction).filter(
        models.Fraction.id == fraction_id, models.Fraction.condominium_id == condominium_id
    ).first()
    if not fraction:
        raise HTTPException(404, "Fração não encontrada.")
    fraction.is_active = False
    db.commit()
    return {"ok": True}


# ---------- Proprietários ----------
@router.post("/{fraction_id}/owners", response_model=schemas.FractionOwnerOut)
def add_owner(
    condominium_id: str,
    fraction_id: str,
    payload: schemas.FractionOwnerCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    fraction = db.query(models.Fraction).filter(
        models.Fraction.id == fraction_id, models.Fraction.condominium_id == condominium_id
    ).first()
    if not fraction:
        raise HTTPException(404, "Fração não encontrada.")
    owner_user = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not owner_user:
        raise HTTPException(404, "Utilizador não encontrado.")
    link = models.FractionOwner(fraction_id=fraction_id, **payload.model_dump())
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.get("/{fraction_id}/owners", response_model=List[schemas.FractionOwnerOut])
def list_owners(
    condominium_id: str,
    fraction_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    return db.query(models.FractionOwner).filter(models.FractionOwner.fraction_id == fraction_id).all()


@router.delete("/{fraction_id}/owners/{owner_link_id}")
def remove_owner(
    condominium_id: str,
    fraction_id: str,
    owner_link_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    link = db.query(models.FractionOwner).filter(models.FractionOwner.id == owner_link_id).first()
    if not link:
        raise HTTPException(404, "Associação não encontrada.")
    db.delete(link)
    db.commit()
    return {"ok": True}
