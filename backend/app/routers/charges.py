"""Rubricas das quotas (quota ordinária, fundo comum de reserva, extraordinária, outras),
a sua configuração individual por fração, a pré-visualização da quota mensal e o
lançamento de quotas extraordinárias."""
from datetime import date
from decimal import Decimal
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import require_condo_admin
from ..services.quota_generation import (
    CATEGORIES, METHODS, QuotaGenerationError, ensure_default_charge_types, compute_monthly_lines, launch_extra_quota,
)

router = APIRouter(prefix="/condominiums/{condominium_id}/charge-types", tags=["Rubricas"])


def _get(db: Session, condominium_id: str, charge_type_id: str) -> models.ChargeType:
    ct = db.query(models.ChargeType).filter(
        models.ChargeType.id == charge_type_id, models.ChargeType.condominium_id == condominium_id
    ).first()
    if not ct:
        raise HTTPException(404, "Rubrica não encontrada.")
    return ct


def _validate(payload: schemas.ChargeTypeCreate):
    if payload.category not in CATEGORIES:
        raise HTTPException(400, "Categoria inválida.")
    if payload.method not in METHODS:
        raise HTTPException(400, "Forma de cálculo inválida.")
    if payload.method == "orcamento" and not payload.recurring:
        raise HTTPException(400, "O cálculo pelo orçamento anual só se aplica a rubricas mensais.")
    if payload.method == "percentagem" and payload.value > 100:
        raise HTTPException(400, "A percentagem não pode passar de 100%.")


@router.get("", response_model=List[schemas.ChargeTypeOut])
def list_charge_types(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    types = ensure_default_charge_types(db, condominium_id)
    db.commit()
    return types


@router.post("", response_model=schemas.ChargeTypeOut)
def create_charge_type(condominium_id: str, payload: schemas.ChargeTypeCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    _validate(payload)
    existing = ensure_default_charge_types(db, condominium_id)
    data = payload.model_dump()
    data["name"] = data["name"].strip()
    if not payload.position:
        data["position"] = max([t.position or 0 for t in existing] + [0]) + 1
    ct = models.ChargeType(condominium_id=condominium_id, **data)
    db.add(ct)
    db.commit()
    db.refresh(ct)
    return ct


@router.put("/{charge_type_id}", response_model=schemas.ChargeTypeOut)
def update_charge_type(condominium_id: str, charge_type_id: str, payload: schemas.ChargeTypeCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    _validate(payload)
    ct = _get(db, condominium_id, charge_type_id)
    for k, v in payload.model_dump().items():
        setattr(ct, k, v.strip() if k == "name" else v)
    db.commit()
    db.refresh(ct)
    return ct


@router.delete("/{charge_type_id}")
def delete_charge_type(condominium_id: str, charge_type_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    """Se a rubrica já foi usada em quotas, fica desativada (o histórico mantém-se)."""
    ct = _get(db, condominium_id, charge_type_id)
    used = db.query(models.QuotaLine).filter(models.QuotaLine.charge_type_id == ct.id).first()
    if used:
        ct.active = False
        db.commit()
        return {"ok": True, "deactivated": True}
    db.query(models.FractionCharge).filter(models.FractionCharge.charge_type_id == ct.id).delete(synchronize_session=False)
    db.delete(ct)
    db.commit()
    return {"ok": True, "deleted": True}


# ---------- Configuração individual por fração ----------
@router.get("/overrides", response_model=List[schemas.FractionChargeOut])
def list_overrides(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    return (
        db.query(models.FractionCharge)
        .join(models.ChargeType, models.FractionCharge.charge_type_id == models.ChargeType.id)
        .filter(models.ChargeType.condominium_id == condominium_id)
        .all()
    )


@router.put("/{charge_type_id}/overrides/{fraction_id}")
def set_override(condominium_id: str, charge_type_id: str, fraction_id: str, payload: schemas.FractionChargeSet,
                 db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    ct = _get(db, condominium_id, charge_type_id)
    fraction = db.query(models.Fraction).filter(
        models.Fraction.id == fraction_id, models.Fraction.condominium_id == condominium_id
    ).first()
    if not fraction:
        raise HTTPException(404, "Fração não encontrada neste condomínio.")
    row = db.query(models.FractionCharge).filter(
        models.FractionCharge.fraction_id == fraction.id, models.FractionCharge.charge_type_id == ct.id
    ).first()
    if payload.mode == "normal":
        if row:
            db.delete(row)
        db.commit()
        return {"ok": True, "mode": "normal"}
    if payload.mode not in ("isento", "valor"):
        raise HTTPException(400, "Configuração inválida: usa normal, isento ou valor.")
    if payload.mode == "valor" and payload.amount is None:
        raise HTTPException(400, "Indica o valor para esta fração.")
    if not row:
        row = models.FractionCharge(fraction_id=fraction.id, charge_type_id=ct.id)
        db.add(row)
    row.mode = payload.mode
    row.amount = payload.amount if payload.mode == "valor" else None
    db.commit()
    return {"ok": True, "mode": row.mode, "amount": float(row.amount) if row.amount is not None else None}


# ---------- Pré-visualização e quotas extraordinárias ----------
@router.get("/preview")
def preview_month(condominium_id: str, month: date, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    """Como ficaria a quota mensal de cada fração, por rubrica (sem gravar nada)."""
    try:
        fractions, lines, _ = compute_monthly_lines(db, condominium_id, month.replace(day=1))
    except QuotaGenerationError as e:
        db.rollback()
        raise HTTPException(422, str(e))
    db.commit()  # grava as rubricas por defeito, se tiverem sido criadas agora
    rows = []
    for f in sorted(fractions, key=lambda f: f.identifier):
        fl = lines.get(f.id) or []
        rows.append({
            "fraction_id": f.id,
            "identifier": f.identifier,
            "permilagem": float(f.permilagem),
            "lines": [{"charge_type_id": ct.id, "name": ct.name, "amount": float(a)} for ct, a in fl],
            "total": float(sum((a for _, a in fl), Decimal("0"))),
        })
    return {"month": month.replace(day=1).isoformat(), "fractions": rows, "total": round(sum(r["total"] for r in rows), 2)}


@router.post("/extra-quota")
def create_extra_quota(condominium_id: str, payload: schemas.ExtraQuotaCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    ct = _get(db, condominium_id, payload.charge_type_id)
    name = (payload.name or ct.name).strip()
    if payload.due_date < payload.reference_month.replace(day=1):
        raise HTTPException(400, "A data de vencimento não pode ser anterior ao mês de referência.")
    try:
        return launch_extra_quota(
            db, condominium_id, ct, name, Decimal(str(payload.total_amount)), payload.method,
            payload.reference_month, payload.due_date, payload.fraction_ids,
        )
    except QuotaGenerationError as e:
        db.rollback()
        raise HTTPException(422, str(e))
