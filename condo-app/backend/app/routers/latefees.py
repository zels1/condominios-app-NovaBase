"""Configuração e execução do motor de juros de mora automáticos."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin
from ..services.late_fee_engine import apply_late_fees_for_condominium, waive_late_fee, refresh_overdue_status

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


@router.post("/quotas/{quota_id}/waive")
def waive(
    condominium_id: str,
    quota_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    quota = waive_late_fee(db, quota_id)
    return {"ok": True, "quota_id": quota.id}
