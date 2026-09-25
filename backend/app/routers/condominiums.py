"""Gestão de condomínios: criação e listagem (o admin cria/gere; o condómino só vê os seus)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_admin, require_condo_admin

router = APIRouter(prefix="/condominiums", tags=["Condomínios"])


@router.post("", response_model=schemas.CondominiumOut)
def create_condominium(
    payload: schemas.CondominiumCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_admin),
):
    condo = models.Condominium(**payload.model_dump(), admin_user_id=user.id)
    db.add(condo)
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
