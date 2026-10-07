"""Quotas mensais: geração automática e consulta (admin vê tudo, condómino só as suas)."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session
from typing import List, Optional

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin, require_condo_member, owner_can_see_quota
from ..services.quota_generation import generate_monthly_quotas, create_invoice, QuotaGenerationError

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
        db.rollback()
        raise HTTPException(422, str(e))
    return result


def _responsible(quota):
    """(nome, user_id) de quem responde por esta cobrança: o comproprietário a quem foi emitida;
    senão, o nome guardado na emissão; senão, o contacto principal da fração."""
    link = quota.owner_link
    if link:
        return _owner_name(link), link.user_id
    if quota.billed_to:
        return quota.billed_to, None
    primary = next((o for o in quota.fraction.owners if o.is_primary_contact), None)
    return _owner_name(primary), primary.user_id if primary else None


def _out(quota, with_payments: bool = False) -> schemas.QuotaWithFraction:
    name, uid = _responsible(quota)
    payments = None
    if with_payments:
        payments = [{
            "id": p.id, "amount": float(p.amount), "paid_at": p.paid_at.isoformat() if p.paid_at else None,
            "method": p.method, "reference": p.reference,
        } for p in sorted(quota.payments, key=lambda p: (p.paid_at or date.min))]
    return schemas.QuotaWithFraction(
        **schemas.QuotaOut.model_validate(quota).model_dump(),
        fraction_identifier=quota.fraction.identifier,
        owner_name=name, owner_user_id=uid,
        total_due=quota.total_due,
        payments=payments,
    )


def _visible_to_owner(q, db: Session, user: models.User):
    """Filtra a consulta às cobranças que o condómino pode ver: as das suas frações que sejam
    da fração como um todo ou emitidas em nome dele."""
    my_links = db.query(models.FractionOwner).filter(models.FractionOwner.user_id == user.id).all()
    return q.filter(
        models.Quota.fraction_id.in_([l.fraction_id for l in my_links]),
        or_(models.Quota.owner_link_id == None, models.Quota.owner_link_id.in_([l.id for l in my_links])),  # noqa: E711
    )


@router.post("/invoice")
def create_invoice_endpoint(
    condominium_id: str,
    payload: schemas.InvoiceCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """Fatura avulsa a uma fração, com o valor e a descrição indicados."""
    fraction = db.query(models.Fraction).filter(
        models.Fraction.id == payload.fraction_id, models.Fraction.condominium_id == condominium_id).first()
    if not fraction:
        raise HTTPException(404, "Fração não encontrada neste condomínio.")
    try:
        created = create_invoice(
            db, condominium_id, fraction, payload.description.strip(), payload.amount, payload.due_date,
            payload.reference_month, payload.responsible, user.id)
    except QuotaGenerationError as e:
        db.rollback()
        raise HTTPException(422, str(e))
    return {"created": len(created), "quotas": [_out(q) for q in created]}


@router.get("", response_model=List[schemas.QuotaWithFraction])
def list_quotas(
    condominium_id: str,
    status: Optional[str] = None,
    fraction_id: Optional[str] = None,
    owner_user_id: Optional[str] = None,
    include_payments: bool = False,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    is_admin = require_condo_member(db, user, condominium_id)
    q = (
        db.query(models.Quota)
        .join(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id)
    )
    if not is_admin:
        q = _visible_to_owner(q, db, user)
    elif owner_user_id:
        # todas as cobranças de um condómino: as emitidas em nome dele e as das frações dele
        target = db.query(models.User).filter(models.User.id == owner_user_id).first()
        if not target:
            raise HTTPException(404, "Condómino não encontrado.")
        q = _visible_to_owner(q, db, target)
    if fraction_id:
        q = q.filter(models.Quota.fraction_id == fraction_id)
    if status:
        q = q.filter(models.Quota.status == status)
    quotas = q.order_by(models.Quota.reference_month.desc(), models.Quota.kind.desc()).all()
    return [_out(quota, include_payments) for quota in quotas]


@router.get("/{quota_id}", response_model=schemas.QuotaWithFraction)
def get_quota(
    condominium_id: str,
    quota_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    is_admin = require_condo_member(db, user, condominium_id)
    quota = (
        db.query(models.Quota).join(models.Fraction)
        .filter(models.Quota.id == quota_id, models.Fraction.condominium_id == condominium_id)
        .first()
    )
    if not quota:
        raise HTTPException(404, "Quota não encontrada.")
    if not is_admin and not owner_can_see_quota(db, user, quota):
        raise HTTPException(403, "Sem acesso a esta quota.")
    return _out(quota, True)


@router.post("/{quota_id}/waive")
def waive_quota(
    condominium_id: str,
    quota_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    quota = (
        db.query(models.Quota).join(models.Fraction)
        .filter(models.Quota.id == quota_id, models.Fraction.condominium_id == condominium_id)
        .first()
    )
    if not quota:
        raise HTTPException(404, "Quota não encontrada.")
    quota.status = models.QuotaStatus.waived
    db.commit()
    return {"ok": True}


@router.delete("/{quota_id}")
def delete_quota(
    condominium_id: str,
    quota_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """Apaga uma quota lançada por engano (só se ainda não tiver pagamentos)."""
    quota = (
        db.query(models.Quota).join(models.Fraction)
        .filter(models.Quota.id == quota_id, models.Fraction.condominium_id == condominium_id)
        .first()
    )
    if not quota:
        raise HTTPException(404, "Quota não encontrada.")
    if float(quota.amount_paid or 0) > 0 or quota.payments:
        raise HTTPException(409, "Esta quota já tem pagamentos registados: não pode ser apagada.")
    db.query(models.ReminderLog).filter(models.ReminderLog.quota_id == quota.id).delete(synchronize_session=False)
    db.delete(quota)
    db.commit()
    return {"ok": True}
