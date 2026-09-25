"""Configuração e execução do motor de lembretes automáticos de pagamento em atraso."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin
from ..services.reminder_engine import run_reminders_for_condominium, mark_reminder_sent

router = APIRouter(prefix="/condominiums/{condominium_id}/reminder-configs", tags=["Lembretes"])


@router.post("", response_model=schemas.ReminderConfigOut)
def create_step(
    condominium_id: str,
    payload: schemas.ReminderConfigCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    step = models.ReminderConfig(condominium_id=condominium_id, **payload.model_dump())
    db.add(step)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Já existe um lembrete configurado para esse número de dias.")
    db.refresh(step)
    return step


@router.get("", response_model=List[schemas.ReminderConfigOut])
def list_steps(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return (
        db.query(models.ReminderConfig)
        .filter(models.ReminderConfig.condominium_id == condominium_id)
        .order_by(models.ReminderConfig.days_after_due)
        .all()
    )


@router.put("/{config_id}", response_model=schemas.ReminderConfigOut)
def update_step(
    condominium_id: str,
    config_id: str,
    payload: schemas.ReminderConfigCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    step = db.query(models.ReminderConfig).filter(
        models.ReminderConfig.id == config_id, models.ReminderConfig.condominium_id == condominium_id
    ).first()
    if not step:
        raise HTTPException(404, "Configuração não encontrada.")
    for k, v in payload.model_dump().items():
        setattr(step, k, v)
    db.commit()
    db.refresh(step)
    return step


@router.delete("/{config_id}")
def delete_step(
    condominium_id: str,
    config_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    step = db.query(models.ReminderConfig).filter(
        models.ReminderConfig.id == config_id, models.ReminderConfig.condominium_id == condominium_id
    ).first()
    if not step:
        raise HTTPException(404, "Configuração não encontrada.")
    db.delete(step)
    db.commit()
    return {"ok": True}


@router.post("/run")
def run_reminders(
    condominium_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """Gera os lembretes em falta (fila 'queued'). O envio real (email/SMS) fica a cargo
    de um worker externo que lê os registos 'queued' e chama /reminder-logs/{id}/mark-sent."""
    return run_reminders_for_condominium(db, condominium_id)


@router.get("/logs", response_model=List[schemas.ReminderLogOut])
def list_logs(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    return (
        db.query(models.ReminderLog)
        .join(models.Quota)
        .join(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id)
        .order_by(models.ReminderLog.sent_at.desc())
        .all()
    )


@router.post("/logs/{log_id}/mark-sent")
def mark_sent(
    condominium_id: str,
    log_id: str,
    success: bool = True,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    entry = mark_reminder_sent(db, log_id, success)
    return {"ok": True, "status": entry.delivery_status}
