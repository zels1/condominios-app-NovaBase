"""Registo de pagamentos de quotas — atualiza automaticamente o estado da quota."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from decimal import Decimal
from typing import List

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin, get_user_fraction_ids

router = APIRouter(prefix="/condominiums/{condominium_id}/quotas/{quota_id}/payments", tags=["Pagamentos"])


def _refresh_quota_status(quota: models.Quota):
    total_due = Decimal(str(quota.base_amount)) + Decimal(str(quota.late_fee_amount))
    paid = Decimal(str(quota.amount_paid))
    if paid <= 0:
        quota.status = models.QuotaStatus.overdue if quota.status == models.QuotaStatus.overdue else models.QuotaStatus.pending
    elif paid >= total_due:
        quota.status = models.QuotaStatus.paid
    else:
        quota.status = models.QuotaStatus.partially_paid


@router.post("", response_model=schemas.PaymentOut)
def register_payment(
    condominium_id: str,
    quota_id: str,
    payload: schemas.PaymentCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    quota = db.query(models.Quota).filter(models.Quota.id == quota_id).first()
    if not quota:
        raise HTTPException(404, "Quota não encontrada.")

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
    quota = db.query(models.Quota).filter(models.Quota.id == quota_id).first()
    if not quota:
        raise HTTPException(404, "Quota não encontrada.")
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
    payment = db.query(models.Payment).filter(models.Payment.id == payment_id, models.Payment.quota_id == quota_id).first()
    if not payment:
        raise HTTPException(404, "Pagamento não encontrado.")
    quota = db.query(models.Quota).filter(models.Quota.id == quota_id).first()
    quota.amount_paid = max(Decimal("0"), Decimal(str(quota.amount_paid)) - Decimal(str(payment.amount)))
    db.delete(payment)
    _refresh_quota_status(quota)
    db.commit()
    return {"ok": True}
