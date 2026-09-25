"""
Motor de juros de mora, configurável por condomínio.

Corre sob pedido (endpoint /run) ou pode ser agendado externamente (ex: cron
diário no Render). Percorre as quotas pendentes de cada condomínio e aplica
o juro configurado a quem já passou o período de tolerância.

O juro fica sempre registado como um campo separado (late_fee_amount),
nunca somado ao valor base — para que o extrato do condómino mostre sempre
os dois valores discriminados.
"""
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy.orm import Session

from .. import models


def _round2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def apply_late_fees_for_condominium(db: Session, condominium_id: str, as_of: date = None) -> dict:
    as_of = as_of or date.today()

    config = (
        db.query(models.LateFeeConfig)
        .filter(models.LateFeeConfig.condominium_id == condominium_id)
        .first()
    )
    if not config or not config.enabled:
        return {"applied": 0, "message": "Juros de mora desativados ou sem configuração para este condomínio."}

    # Quotas em atraso, sem juro ainda aplicado, sem estar perdoado, e já paga total/parcialmente não conta
    candidates = (
        db.query(models.Quota)
        .join(models.Fraction)
        .filter(
            models.Fraction.condominium_id == condominium_id,
            models.Quota.status.in_([models.QuotaStatus.pending, models.QuotaStatus.overdue]),
            models.Quota.late_fee_applied_at.is_(None),
            models.Quota.late_fee_waived == False,  # noqa: E712
        )
        .all()
    )

    applied = []
    for quota in candidates:
        days_overdue = (as_of - quota.due_date).days
        if days_overdue <= config.grace_period_days:
            continue

        outstanding = Decimal(str(quota.base_amount)) - Decimal(str(quota.amount_paid))
        if outstanding <= 0:
            continue

        if config.fee_type == models.LateFeeType.fixed:
            fee = Decimal(str(config.fee_value))
        else:  # percentage
            fee = outstanding * (Decimal(str(config.fee_value)) / Decimal("100"))

        fee = _round2(fee)
        if config.max_fee_amount is not None:
            fee = min(fee, Decimal(str(config.max_fee_amount)))

        quota.late_fee_amount = fee
        quota.late_fee_applied_at = datetime.utcnow()
        quota.status = models.QuotaStatus.overdue
        applied.append(quota)

    if applied:
        db.commit()
        log = models.AuditLog(
            condominium_id=condominium_id,
            action="late_fee.applied",
            entity_type="quota",
            details={"count": len(applied), "as_of": as_of.isoformat(),
                     "quota_ids": [q.id for q in applied]},
        )
        db.add(log)
        db.commit()

    return {"applied": len(applied), "quota_ids": [q.id for q in applied]}


def waive_late_fee(db: Session, quota_id: str) -> models.Quota:
    quota = db.query(models.Quota).filter(models.Quota.id == quota_id).first()
    if not quota:
        raise ValueError("Quota não encontrada.")
    quota.late_fee_amount = Decimal("0.00")
    quota.late_fee_waived = True
    db.commit()
    db.refresh(quota)
    return quota


def refresh_overdue_status(db: Session, condominium_id: str, as_of: date = None) -> int:
    """Marca como 'overdue' quotas pendentes cujo vencimento já passou,
    mesmo antes de o juro de mora disparar (útil para o dashboard/relatórios).

    Nota: Query.update() não pode ser combinado com join() no SQLAlchemy ORM,
    por isso filtramos por uma subquery dos ids de fração deste condomínio."""
    as_of = as_of or date.today()
    fraction_ids = db.query(models.Fraction.id).filter(models.Fraction.condominium_id == condominium_id)
    updated = (
        db.query(models.Quota)
        .filter(
            models.Quota.fraction_id.in_(fraction_ids),
            models.Quota.status == models.QuotaStatus.pending,
            models.Quota.due_date < as_of,
        )
        .update({models.Quota.status: models.QuotaStatus.overdue}, synchronize_session=False)
    )
    db.commit()
    return updated
