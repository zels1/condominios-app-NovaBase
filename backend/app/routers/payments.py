"""Registo de pagamentos de quotas — atualiza automaticamente o estado da quota."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from decimal import Decimal
from typing import List

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin, get_user_fraction_ids, require_condo_member
from ..services.late_fee_engine import recompute_status

router = APIRouter(prefix="/condominiums/{condominium_id}/quotas/{quota_id}/payments", tags=["Pagamentos"])


def _get_quota(db: Session, condominium_id: str, quota_id: str) -> models.Quota:
    """A quota tem de pertencer a este condomínio (evita mexer em quotas de outros prédios)."""
    quota = (
        db.query(models.Quota).join(models.Fraction)
        .filter(models.Quota.id == quota_id, models.Fraction.condominium_id == condominium_id)
        .first()
    )
    if not quota:
        raise HTTPException(404, "Quota não encontrada.")
    return quota


def _refresh_quota_status(quota: models.Quota):
    recompute_status(quota)


@router.post("", response_model=schemas.PaymentOut)
def register_payment(
    condominium_id: str,
    quota_id: str,
    payload: schemas.PaymentCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    quota = _get_quota(db, condominium_id, quota_id)
    payment = models.Payment(quota_id=quota_id, recorded_by=user.id, **payload.model_dump())
    db.add(payment)
    quota.amount_paid = Decimal(str(quota.amount_paid)) + Decimal(str(payload.amount))
    _refresh_quota_status(quota)
    db.commit()
    db.refresh(payment)
    return payment


@router.get("", response_model=List[schemas.PaymentOut])
def list_payments(
    condominium_id: str,
    quota_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    require_condo_member(db, user, condominium_id)
    quota = _get_quota(db, condominium_id, quota_id)
    if user.role == models.UserRole.owner and quota.fraction_id not in get_user_fraction_ids(db, user):
        raise HTTPException(403, "Sem acesso a esta quota.")
    return db.query(models.Payment).filter(models.Payment.quota_id == quota_id).order_by(models.Payment.paid_at.desc()).all()


@router.delete("/{payment_id}")
def delete_payment(
    condominium_id: str,
    quota_id: str,
    payment_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """Anula um pagamento registado por engano e recalcula o estado da quota."""
    quota = _get_quota(db, condominium_id, quota_id)
    payment = db.query(models.Payment).filter(models.Payment.id == payment_id, models.Payment.quota_id == quota_id).first()
    if not payment:
        raise HTTPException(404, "Pagamento não encontrado.")
    quota.amount_paid = max(Decimal("0"), Decimal(str(quota.amount_paid)) - Decimal(str(payment.amount)))
    db.delete(payment)
    _refresh_quota_status(quota)
    db.commit()
    return {"ok": True}
