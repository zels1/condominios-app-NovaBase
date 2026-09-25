"""Painel de resumo do administrador — a primeira coisa que vê ao entrar."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date, timedelta

from .. import models, schemas
from ..database import get_db
from ..auth import require_condo_admin

router = APIRouter(prefix="/condominiums/{condominium_id}/dashboard", tags=["Dashboard"])


@router.get("", response_model=schemas.DashboardSummary)
def summary(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    today = date.today()
    month_start = today.replace(day=1)

    overdue_quotas = (
        db.query(models.Quota)
        .join(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id, models.Quota.status == models.QuotaStatus.overdue)
        .all()
    )
    total_overdue = sum(q.total_due for q in overdue_quotas)
    fractions_in_debt = len({q.fraction_id for q in overdue_quotas})

    pending_occurrences = (
        db.query(func.count(models.Occurrence.id))
        .filter(models.Occurrence.condominium_id == condominium_id, models.Occurrence.status.in_(["reported", "acknowledged", "in_progress"]))
        .scalar()
    )

    upcoming_assembly = (
        db.query(models.Assembly)
        .filter(models.Assembly.condominium_id == condominium_id, models.Assembly.scheduled_at >= today, models.Assembly.status == models.AssemblyStatus.scheduled)
        .order_by(models.Assembly.scheduled_at)
        .first()
    )

    docs_expiring = (
        db.query(models.Document)
        .filter(models.Document.condominium_id == condominium_id, models.Document.expires_at.isnot(None), models.Document.expires_at <= today + timedelta(days=30))
        .all()
    )

    contracts_expiring = (
        db.query(models.Contract)
        .join(models.Supplier)
        .filter(models.Supplier.condominium_id == condominium_id, models.Contract.end_date.isnot(None), models.Contract.end_date <= today + timedelta(days=30))
        .all()
    )

    collected = (
        db.query(func.coalesce(func.sum(models.Payment.amount), 0))
        .join(models.Quota)
        .join(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id, models.Payment.paid_at >= month_start)
        .scalar()
    )
    expected = (
        db.query(func.coalesce(func.sum(models.Quota.base_amount), 0))
        .join(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id, models.Quota.reference_month == month_start)
        .scalar()
    )

    return schemas.DashboardSummary(
        condominium_id=condominium_id,
        total_overdue_amount=float(total_overdue),
        overdue_quota_count=len(overdue_quotas),
        fractions_in_debt=fractions_in_debt,
        pending_occurrences=pending_occurrences or 0,
        upcoming_assembly=upcoming_assembly,
        documents_expiring_soon=docs_expiring,
        contracts_expiring_soon=contracts_expiring,
        this_month_collected=float(collected or 0),
        this_month_expected=float(expected or 0),
    )
