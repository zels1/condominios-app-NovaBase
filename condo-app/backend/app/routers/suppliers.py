"""Fornecedores, contratos e despesas do condomínio."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin

router = APIRouter(prefix="/condominiums/{condominium_id}", tags=["Fornecedores e Despesas"])


# ---------- Suppliers ----------
@router.post("/suppliers", response_model=schemas.SupplierOut)
def create_supplier(condominium_id: str, payload: schemas.SupplierCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    supplier = models.Supplier(condominium_id=condominium_id, **payload.model_dump())
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.get("/suppliers", response_model=List[schemas.SupplierOut])
def list_suppliers(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return db.query(models.Supplier).filter(models.Supplier.condominium_id == condominium_id).order_by(models.Supplier.name).all()


@router.delete("/suppliers/{supplier_id}")
def delete_supplier(condominium_id: str, supplier_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id, models.Supplier.condominium_id == condominium_id).first()
    if not supplier:
        raise HTTPException(404, "Fornecedor não encontrado.")
    db.delete(supplier)
    db.commit()
    return {"ok": True}


# ---------- Contracts ----------
@router.post("/suppliers/{supplier_id}/contracts", response_model=schemas.ContractOut)
def create_contract(condominium_id: str, supplier_id: str, payload: schemas.ContractCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id, models.Supplier.condominium_id == condominium_id).first()
    if not supplier:
        raise HTTPException(404, "Fornecedor não encontrado.")
    data = payload.model_dump()
    data["supplier_id"] = supplier_id
    contract = models.Contract(**data)
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return contract


@router.get("/contracts", response_model=List[schemas.ContractOut])
def list_contracts(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return (
        db.query(models.Contract)
        .join(models.Supplier)
        .filter(models.Supplier.condominium_id == condominium_id)
        .order_by(models.Contract.end_date)
        .all()
    )


# ---------- Expenses ----------
@router.post("/expenses", response_model=schemas.ExpenseOut)
def create_expense(condominium_id: str, payload: schemas.ExpenseCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    expense = models.Expense(condominium_id=condominium_id, **payload.model_dump())
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense


@router.get("/expenses", response_model=List[schemas.ExpenseOut])
def list_expenses(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return db.query(models.Expense).filter(models.Expense.condominium_id == condominium_id).order_by(models.Expense.expense_date.desc()).all()


@router.delete("/expenses/{expense_id}")
def delete_expense(condominium_id: str, expense_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id, models.Expense.condominium_id == condominium_id).first()
    if not expense:
        raise HTTPException(404, "Despesa não encontrada.")
    db.delete(expense)
    db.commit()
    return {"ok": True}
