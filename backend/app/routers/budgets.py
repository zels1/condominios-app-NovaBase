"""Orçamentos anuais, base para a geração automática de quotas."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin

router = APIRouter(prefix="/condominiums/{condominium_id}/budgets", tags=["Orçamentos"])


@router.post("", response_model=schemas.BudgetOut)
def create_budget(
    condominium_id: str,
    payload: schemas.BudgetCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    budget = models.Budget(condominium_id=condominium_id, **payload.model_dump())
    db.add(budget)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"Já existe um orçamento para o ano {payload.year}.")
    db.refresh(budget)
    return budget


@router.get("", response_model=List[schemas.BudgetOut])
def list_budgets(
    condominium_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    return (
        db.query(models.Budget)
        .filter(models.Budget.condominium_id == condominium_id)
        .order_by(models.Budget.year.desc())
        .all()
    )


@router.put("/{budget_id}", response_model=schemas.BudgetOut)
def update_budget(
    condominium_id: str,
    budget_id: str,
    payload: schemas.BudgetCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    budget = db.query(models.Budget).filter(
        models.Budget.id == budget_id, models.Budget.condominium_id == condominium_id
    ).first()
    if not budget:
        raise HTTPException(404, "Orçamento não encontrado.")
    for k, v in payload.model_dump().items():
        setattr(budget, k, v)
    db.commit()
    db.refresh(budget)
    return budget
