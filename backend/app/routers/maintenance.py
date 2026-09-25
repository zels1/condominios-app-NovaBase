"""Ocorrências/manutenção: qualquer condómino pode reportar; o admin acompanha e atualiza estado."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin, get_user_fraction_ids

router = APIRouter(prefix="/condominiums/{condominium_id}/occurrences", tags=["Manutenção"])


@router.post("", response_model=schemas.OccurrenceOut)
def report_occurrence(
    condominium_id: str,
    payload: schemas.OccurrenceCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    # um condómino só pode reportar em nome de uma fração que é sua
    if payload.fraction_id and user.role == models.UserRole.owner:
        if payload.fraction_id not in get_user_fraction_ids(db, user):
            raise HTTPException(403, "Essa fração não lhe pertence.")
    occ = models.Occurrence(condominium_id=condominium_id, reported_by=user.id, **payload.model_dump())
    db.add(occ)
    db.commit()
    db.refresh(occ)
    return occ


@router.get("", response_model=List[schemas.OccurrenceOut])
def list_occurrences(
    condominium_id: str,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    q = db.query(models.Occurrence).filter(models.Occurrence.condominium_id == condominium_id)
    if user.role == models.UserRole.owner:
        owned = get_user_fraction_ids(db, user)
        q = q.filter((models.Occurrence.fraction_id.in_(owned)) | (models.Occurrence.fraction_id.is_(None)) | (models.Occurrence.reported_by == user.id))
    if status:
        q = q.filter(models.Occurrence.status == status)
    return q.order_by(models.Occurrence.created_at.desc()).all()


@router.post("/{occurrence_id}/updates", response_model=schemas.OccurrenceOut)
def add_update(
    condominium_id: str,
    occurrence_id: str,
    payload: schemas.OccurrenceUpdateCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    occ = db.query(models.Occurrence).filter(models.Occurrence.id == occurrence_id, models.Occurrence.condominium_id == condominium_id).first()
    if not occ:
        raise HTTPException(404, "Ocorrência não encontrada.")
    update = models.OccurrenceUpdate(occurrence_id=occ.id, updated_by=user.id, **payload.model_dump())
    db.add(update)
    occ.status = payload.status
    if payload.status in ("resolved", "closed"):
        occ.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(occ)
    return occ
