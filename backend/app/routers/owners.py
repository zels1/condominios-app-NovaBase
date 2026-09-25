"""Diretório de condóminos de um condomínio — a 'ficha' de cada um, vista do admin.
Junta os dados do User com as frações a que está ligado (via FractionOwner)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from .. import models, schemas
from ..database import get_db
from ..auth import require_condo_admin

router = APIRouter(prefix="/condominiums/{condominium_id}/owners", tags=["Condóminos"])


@router.get("", response_model=List[schemas.OwnerDirectoryEntry])
def list_owners_directory(
    condominium_id: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_condo_admin),
):
    links = (
        db.query(models.FractionOwner, models.Fraction)
        .join(models.Fraction, models.FractionOwner.fraction_id == models.Fraction.id)
        .filter(models.Fraction.condominium_id == condominium_id)
        .all()
    )

    by_user = {}
    pending = []
    for link, fraction in links:
        fraction_link = schemas.OwnerFractionLink(
            id=link.id,
            fraction_id=fraction.id,
            fraction_identifier=fraction.identifier,
            ownership_share=float(link.ownership_share),
            is_primary_contact=link.is_primary_contact,
        )
        if link.user_id:
            entry = by_user.setdefault(link.user_id, {"user": link.user, "fractions": []})
            entry["fractions"].append(fraction_link)
        else:
            pending.append(
                schemas.OwnerDirectoryEntry(
                    id=f"pending-{link.id}",
                    email=link.invited_email or "",
                    full_name=link.invited_email or "Convite pendente",
                    is_active=False,
                    is_pending=True,
                    fractions=[fraction_link],
                )
            )

    registered = [
        schemas.OwnerDirectoryEntry(
            id=data["user"].id,
            email=data["user"].email,
            full_name=data["user"].full_name,
            phone=data["user"].phone,
            is_active=data["user"].is_active,
            is_pending=False,
            fractions=data["fractions"],
        )
        for data in by_user.values()
    ]
    registered.sort(key=lambda o: o.full_name.lower())
    return registered + pending


@router.put("/{user_id}", response_model=schemas.UserOut)
def update_owner_profile(
    condominium_id: str,
    user_id: str,
    payload: schemas.UserUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_condo_admin),
):
    """O admin só pode editar a ficha de um condómino que tenha mesmo uma fração
    neste condomínio (evita editar utilizadores de outros condomínios)."""
    linked = (
        db.query(models.FractionOwner)
        .join(models.Fraction, models.FractionOwner.fraction_id == models.Fraction.id)
        .filter(models.Fraction.condominium_id == condominium_id, models.FractionOwner.user_id == user_id)
        .first()
    )
    if not linked:
        raise HTTPException(404, "Este condómino não está associado a nenhuma fração deste condomínio.")

    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(404, "Utilizador não encontrado.")

    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(target, k, v)
    db.commit()
    db.refresh(target)
    return target
