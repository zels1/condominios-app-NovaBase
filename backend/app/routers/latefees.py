"""Configuração e execução do motor de juros de mora automáticos."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin
from datetime import date, datetime
from decimal import Decimal

from ..services.late_fee_engine import (
    apply_late_fees_for_condominium, waive_late_fee, refresh_overdue_status, compute_late_fee, recompute_status,
)

router = APIRouter(prefix="/condominiums/{condominium_id}/late-fee-config", tags=["Juros de mora"])


@router.get("", response_model=schemas.LateFeeConfigOut)
def get_config(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    config = db.query(models.LateFeeConfig).filter(models.LateFeeConfig.condominium_id == condominium_id).first()
    if not config:
        raise HTTPException(404, "Ainda sem configuração de juros de mora — crie uma com PUT.")
    return config


@router.put("", response_model=schemas.LateFeeConfigOut)
def upsert_config(
    condominium_id: str,
    payload: schemas.LateFeeConfigUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    config = db.query(models.LateFeeConfig).filter(models.LateFeeConfig.condominium_id == condominium_id).first()
    if not config:
        config = models.LateFeeConfig(condominium_id=condominium_id, **payload.model_dump())
        db.add(config)
    else:
        for k, v in payload.model_dump().items():
            setattr(config, k, v)
    db.commit()
    db.refresh(config)
    return config


@router.post("/run")
def run_late_fees(
    condominium_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """Aplica juros de mora a todas as quotas elegíveis. Pode ser chamado manualmente
    pelo admin ou por um agendamento externo (ex: cron diário no Render)."""
    refresh_overdue_status(db, condominium_id)
    return apply_late_fees_for_condominium(db, condominium_id)


# ---------- Juro de uma quota (manual) ----------
def _get_quota(db: Session, condominium_id: str, quota_id: str) -> models.Quota:
    quota = (
        db.query(models.Quota).join(models.Fraction)
        .filter(models.Quota.id == quota_id, models.Fraction.condominium_id == condominium_id)
        .first()
    )
    if not quota:
        raise HTTPException(404, "Quota não encontrada.")
    return quota


def _get_config(db: Session, condominium_id: str):
    return db.query(models.LateFeeConfig).filter(models.LateFeeConfig.condominium_id == condominium_id).first()


def _fee_info(db: Session, condominium_id: str, quota: models.Quota) -> dict:
    config = _get_config(db, condominium_id)
    days = (date.today() - quota.due_date).days
    suggested = compute_late_fee(config, quota) if config else Decimal("0")
    if not config:
        rule = "Sem regra de juros configurada (em Juros de mora)."
    elif config.fee_type == models.LateFeeType.fixed:
        rule = f"Valor fixo de {float(config.fee_value):.2f} €"
    else:
        rule = f"{float(config.fee_value):g}% sobre o valor em falta"
    if config and config.max_fee_amount is not None:
        rule += f" (máximo {float(config.max_fee_amount):.2f} €)"
    return {
        "quota_id": quota.id,
        "late_fee_amount": float(quota.late_fee_amount or 0),
        "late_fee_waived": bool(quota.late_fee_waived),
        "late_fee_applied_at": quota.late_fee_applied_at.isoformat() if quota.late_fee_applied_at else None,
        "days_overdue": max(0, days),
        "grace_period_days": config.grace_period_days if config else None,
        "within_grace": bool(config) and 0 < days <= config.grace_period_days,
        "rule": rule,
        "suggested_fee": float(suggested),
        "status": quota.status.value if hasattr(quota.status, "value") else quota.status,
    }


@router.get("/quotas/{quota_id}")
def quota_late_fee_info(condominium_id: str, quota_id: str, db: Session = Depends(get_db),
                        user: models.User = Depends(require_condo_admin)):
    """Juro atual da quota e o que a regra do condomínio daria hoje."""
    return _fee_info(db, condominium_id, _get_quota(db, condominium_id, quota_id))


@router.post("/quotas/{quota_id}/apply")
def apply_quota_late_fee(condominium_id: str, quota_id: str, db: Session = Depends(get_db),
                         user: models.User = Depends(require_condo_admin)):
    """Aplica já o juro calculado pela regra (mesmo dentro do período de tolerância)."""
    quota = _get_quota(db, condominium_id, quota_id)
    if quota.due_date >= date.today():
        raise HTTPException(400, "Esta quota ainda não venceu.")
    config = _get_config(db, condominium_id)
    if not config:
        raise HTTPException(400, "Configura primeiro a regra de juros em \"Juros de mora\", ou define o valor à mão.")
    fee = compute_late_fee(config, quota)
    if fee <= 0:
        raise HTTPException(400, "Não há valor em falta sobre o qual aplicar juro.")
    quota.late_fee_amount = fee
    quota.late_fee_waived = False
    quota.late_fee_applied_at = datetime.utcnow()
    recompute_status(quota)
    db.add(models.AuditLog(condominium_id=condominium_id, user_id=user.id, action="late_fee.manual_apply",
                           entity_type="quota", entity_id=quota.id, details={"fee": float(fee)}))
    db.commit()
    return _fee_info(db, condominium_id, quota)


@router.put("/quotas/{quota_id}")
def set_quota_late_fee(condominium_id: str, quota_id: str, payload: schemas.ManualLateFee,
                       db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    """Define o juro à mão (ex: acordo com o condómino). 0 = sem juro."""
    quota = _get_quota(db, condominium_id, quota_id)
    fee = Decimal(str(payload.amount)).quantize(Decimal("0.01"))
    quota.late_fee_amount = fee
    quota.late_fee_waived = fee == 0
    quota.late_fee_applied_at = datetime.utcnow()
    recompute_status(quota)
    db.add(models.AuditLog(condominium_id=condominium_id, user_id=user.id, action="late_fee.manual_set",
                           entity_type="quota", entity_id=quota.id, details={"fee": float(fee), "note": payload.note}))
    db.commit()
    return _fee_info(db, condominium_id, quota)


@router.post("/quotas/{quota_id}/waive")
def waive(
    condominium_id: str,
    quota_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    quota = _get_quota(db, condominium_id, quota_id)
    waive_late_fee(db, quota.id)
    return _fee_info(db, condominium_id, quota)
