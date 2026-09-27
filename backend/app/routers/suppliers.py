"""Fornecedores, contratos e despesas do condomínio."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from .. import models, schemas
from ..database import get_db
import re

from ..auth import get_current_user, require_condo_admin, require_condo_member
from ..services.storage import signed_url, delete_file, is_private_ref, StorageError, STORAGE_PREFIX, DOCUMENT_BUCKET


def _check_doc_ref(condominium_id: str, ref):
    ref = (ref or "").strip() or None
    if not ref:
        return None
    if is_private_ref(ref):
        if not ref.startswith(f"{STORAGE_PREFIX}{DOCUMENT_BUCKET}/{condominium_id}/"):
            raise HTTPException(400, "Ficheiro do contrato inválido.")
    elif not re.match(r"^https?://", ref, re.I):
        raise HTTPException(400, "O documento do contrato tem de ser um ficheiro anexado ou um link http(s).")
    return ref


def _contract_out(c: models.Contract, supplier_name=None) -> schemas.ContractOut:
    out = schemas.ContractOut.model_validate(c)
    return out.model_copy(update={"has_document": bool(c.document_url), "supplier_name": supplier_name})

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
    require_condo_member(db, user, condominium_id)
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
    if payload.start_date and payload.end_date and payload.end_date < payload.start_date:
        raise HTTPException(400, "A data de fim não pode ser anterior à de início.")
    data = payload.model_dump()
    data["supplier_id"] = supplier_id
    data["title"] = data["title"].strip()
    data["document_url"] = _check_doc_ref(condominium_id, data.get("document_url"))
    contract = models.Contract(**data)
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return _contract_out(contract, supplier.name)


@router.get("/contracts", response_model=List[schemas.ContractOut])
def list_contracts(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    require_condo_member(db, user, condominium_id)
    rows = (
        db.query(models.Contract, models.Supplier.name)
        .join(models.Supplier)
        .filter(models.Supplier.condominium_id == condominium_id)
        .order_by(models.Contract.end_date)
        .all()
    )
    return [_contract_out(c, name) for c, name in rows]


def _get_contract(db: Session, condominium_id: str, contract_id: str) -> models.Contract:
    contract = (
        db.query(models.Contract).join(models.Supplier)
        .filter(models.Contract.id == contract_id, models.Supplier.condominium_id == condominium_id)
        .first()
    )
    if not contract:
        raise HTTPException(404, "Contrato não encontrado.")
    return contract


@router.get("/contracts/{contract_id}/document")
def open_contract_document(condominium_id: str, contract_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    """Link para abrir o documento do contrato (temporário, se for um ficheiro anexado)."""
    contract = _get_contract(db, condominium_id, contract_id)
    if not contract.document_url:
        raise HTTPException(404, "Este contrato não tem documento anexado.")
    if not is_private_ref(contract.document_url):
        return {"url": contract.document_url}
    try:
        return {"url": signed_url(contract.document_url, expires_in=3600)}
    except StorageError as e:
        raise HTTPException(503, str(e))


@router.delete("/contracts/{contract_id}")
def delete_contract(condominium_id: str, contract_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    contract = _get_contract(db, condominium_id, contract_id)
    ref = contract.document_url
    db.delete(contract)
    db.commit()
    if is_private_ref(ref):
        delete_file(ref)
    return {"ok": True}


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
    require_condo_member(db, user, condominium_id)
    return db.query(models.Expense).filter(models.Expense.condominium_id == condominium_id).order_by(models.Expense.expense_date.desc()).all()


@router.delete("/expenses/{expense_id}")
def delete_expense(condominium_id: str, expense_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id, models.Expense.condominium_id == condominium_id).first()
    if not expense:
        raise HTTPException(404, "Despesa não encontrada.")
    db.delete(expense)
    db.commit()
    return {"ok": True}
