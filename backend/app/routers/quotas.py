"""Quotas mensais: geração automática e consulta (admin vê tudo, condómino só as suas)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin, get_user_fraction_ids
from ..services.quota_generation import generate_monthly_quotas, QuotaGenerationError

router = APIRouter(prefix="/condominiums/{condominium_id}/quotas", tags=["Quotas"])



def _owner_name(link):
    """Nome do contacto principal; se o convite ainda estiver pendente (sem conta), mostra o email."""
    if not link:
        return None
    if link.user:
        return link.user.full_name
    return f"{link.invited_email} (convite pendente)" if link.invited_email else None

@router.post("/generate")
def generate_quotas(
    condominium_id: str,
    payload: schemas.QuotaGenerateRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    try:
        result = generate_monthly_quotas(
            db, condominium_id, payload.reference_month, due_day=payload.due_day, force=payload.force
        )
    except QuotaGenerationError as e:
        raise HTTPException(422, str(e))
    return result


@router.get("", response_model=List[schemas.QuotaWithFraction])
def list_quotas(
    condominium_id: str,
    status: Optional[str] = None,
    fraction_id: Optional[str] = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    q = (
        db.query(models.Quota)
        .join(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id)
    )
    if user.role == models.UserRole.owner:
        owned = get_user_fraction_ids(db, user)
        q = q.filter(models.Quota.fraction_id.in_(owned))
    if fraction_id:
        q = q.filter(models.Quota.fraction_id == fraction_id)
    if status:
        q = q.filter(models.Quota.status == status)
    quotas = q.order_by(models.Quota.reference_month.desc()).all()

    out = []
    for quota in quotas:
        primary = next((o for o in quota.fraction.owners if o.is_primary_contact), None)
        out.append(schemas.QuotaWithFraction(
            **schemas.QuotaOut.model_validate(quota).model_dump(),
            fraction_identifier=quota.fraction.identifier,
            owner_name=_owner_name(primary),
            total_due=quota.total_due,
        ))
    return out


@router.get("/{quota_id}", response_model=schemas.QuotaWithFraction)
def get_quota(
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
    primary = next((o for o in quota.fraction.owners if o.is_primary_contact), None)
    return schemas.QuotaWithFraction(
        **schemas.QuotaOut.model_validate(quota).model_dump(),
        fraction_identifier=quota.fraction.identifier,
        owner_name=_owner_name(primary),
        total_due=quota.total_due,
    )


@router.post("/{quota_id}/waive")
def waive_quota(
    condominium_id: str,
    quota_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    quota = db.query(models.Quota).filter(models.Quota.id == quota_id).first()
    if not quota:
        raise HTTPException(404, "Quota não encontrada.")
    quota.status = models.QuotaStatus.waived
    db.commit()
    return {"ok": True}
