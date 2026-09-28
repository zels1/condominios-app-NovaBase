"""Painéis do administrador:
- /dashboard/overview — visão geral de todos os condomínios sob gestão (página inicial);
- /condominiums/{id}/dashboard — resumo detalhado de um condomínio."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, String
from datetime import date, datetime, timedelta

from .. import models, schemas
from ..database import get_db
from ..auth import require_condo_admin, get_current_user

router = APIRouter(prefix="/condominiums/{condominium_id}/dashboard", tags=["Dashboard"])
overview_router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

OPEN_OCCURRENCE_STATES = ["reported", "acknowledged", "in_progress"]


def _overdue_quotas(db: Session, condominium_id: str):
    return (
        db.query(models.Quota)
        .join(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id, models.Quota.status == models.QuotaStatus.overdue)
        .all()
    )


def _next_assembly(db: Session, condominium_id: str):
    return (
        db.query(models.Assembly)
        .filter(
            models.Assembly.condominium_id == condominium_id,
            models.Assembly.scheduled_at >= datetime.combine(date.today(), datetime.min.time()),
            models.Assembly.status == models.AssemblyStatus.scheduled,
        )
        .order_by(models.Assembly.scheduled_at)
        .first()
    )


def _month_money(db: Session, condominium_id: str):
    month_start = date.today().replace(day=1)
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
    return float(collected or 0), float(expected or 0)


@router.get("", response_model=schemas.DashboardSummary)
def summary(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    today = date.today()
    overdue_quotas = _overdue_quotas(db, condominium_id)

    pending_occurrences = (
        db.query(func.count(models.Occurrence.id))
        .filter(models.Occurrence.condominium_id == condominium_id, models.Occurrence.status.in_(OPEN_OCCURRENCE_STATES))
        .scalar()
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

    maint = (
        db.query(models.MaintenanceTask)
        .filter(
            models.MaintenanceTask.condominium_id == condominium_id,
            models.MaintenanceTask.active == True,  # noqa: E712
            models.MaintenanceTask.next_due.isnot(None),
            models.MaintenanceTask.next_due <= today + timedelta(days=30),
        )
        .all()
    )

    collected, expected = _month_money(db, condominium_id)
    return schemas.DashboardSummary(
        condominium_id=condominium_id,
        total_overdue_amount=float(sum(q.total_due for q in overdue_quotas)),
        overdue_quota_count=len(overdue_quotas),
        fractions_in_debt=len({q.fraction_id for q in overdue_quotas}),
        pending_occurrences=pending_occurrences or 0,
        upcoming_assembly=_next_assembly(db, condominium_id),
        documents_expiring_soon=docs_expiring,
        contracts_expiring_soon=contracts_expiring,
        this_month_collected=collected,
        this_month_expected=expected,
        maintenance_overdue=sum(1 for t in maint if t.next_due < today),
        maintenance_due_soon=sum(1 for t in maint if t.next_due >= today),
    )


@overview_router.get("/overview")
def overview(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Uma linha por condomínio gerido por este administrador, com os indicadores que
    pedem atenção: dívida, ocorrências abertas, manutenções, próxima assembleia…"""
    if user.role not in (models.UserRole.admin, models.UserRole.super_admin):
        raise HTTPException(403, "Apenas administradores.")
    q = db.query(models.Condominium)
    if user.role == models.UserRole.admin:
        q = q.filter(models.Condominium.admin_user_id == user.id)
    today = date.today()
    soon = today + timedelta(days=30)
    rows = []
    for condo in q.order_by(models.Condominium.name).all():
        cid = condo.id
        fraction_ids = [r[0] for r in db.query(models.Fraction.id).filter(models.Fraction.condominium_id == cid).all()]
        owners = (
            db.query(func.count(func.distinct(func.coalesce(cast(models.FractionOwner.user_id, String), models.FractionOwner.invited_email))))
            .filter(models.FractionOwner.fraction_id.in_(fraction_ids),
                    (models.FractionOwner.end_date == None) | (models.FractionOwner.end_date >= today))  # noqa: E711
            .scalar()
        ) if fraction_ids else 0
        overdue = _overdue_quotas(db, cid)
        occ = (
            db.query(models.Occurrence.priority)
            .filter(models.Occurrence.condominium_id == cid, models.Occurrence.status.in_(OPEN_OCCURRENCE_STATES))
            .all()
        )
        maint_dates = [
            r[0] for r in db.query(models.MaintenanceTask.next_due).filter(
                models.MaintenanceTask.condominium_id == cid,
                models.MaintenanceTask.active == True,  # noqa: E712
                models.MaintenanceTask.next_due.isnot(None),
                models.MaintenanceTask.next_due <= soon,
            ).all()
        ]
        docs = db.query(func.count(models.Document.id)).filter(
            models.Document.condominium_id == cid, models.Document.expires_at.isnot(None), models.Document.expires_at <= soon
        ).scalar() or 0
        contracts = (
            db.query(func.count(models.Contract.id)).join(models.Supplier)
            .filter(models.Supplier.condominium_id == cid, models.Contract.end_date.isnot(None), models.Contract.end_date <= soon)
            .scalar() or 0
        )
        insurance_expiring = bool(condo.insurance_valid_until and condo.insurance_valid_until <= soon)
        assembly = _next_assembly(db, cid)
        collected, expected = _month_money(db, cid)
        rows.append({
            "id": cid,
            "name": condo.name,
            "city": condo.city,
            "fractions": len(fraction_ids),
            "owners": owners or 0,
            "total_overdue_amount": round(float(sum(q.total_due for q in overdue)), 2),
            "fractions_in_debt": len({q.fraction_id for q in overdue}),
            "open_occurrences": len(occ),
            "urgent_occurrences": sum(1 for (p,) in occ if p in ("urgente", "alta")),
            "maintenance_overdue": sum(1 for d in maint_dates if d < today),
            "maintenance_due_soon": sum(1 for d in maint_dates if d >= today),
            "expiring_items": docs + contracts + (1 if insurance_expiring else 0),
            "next_assembly": {"id": assembly.id, "title": assembly.title, "scheduled_at": assembly.scheduled_at.isoformat()} if assembly else None,
            "this_month_collected": collected,
            "this_month_expected": expected,
        })
    totals = {
        "condominiums": len(rows),
        "fractions": sum(r["fractions"] for r in rows),
        "total_overdue_amount": round(sum(r["total_overdue_amount"] for r in rows), 2),
        "open_occurrences": sum(r["open_occurrences"] for r in rows),
        "maintenance_overdue": sum(r["maintenance_overdue"] for r in rows),
        "maintenance_due_soon": sum(r["maintenance_due_soon"] for r in rows),
        "this_month_collected": round(sum(r["this_month_collected"] for r in rows), 2),
        "this_month_expected": round(sum(r["this_month_expected"] for r in rows), 2),
    }
    return {"totals": totals, "condominiums": rows}
