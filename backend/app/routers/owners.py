"""Diretório de condóminos de um condomínio — a 'ficha' de cada um, vista do admin.
Junta os dados do User com as frações a que está ligado (via FractionOwner)."""
import os
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import require_condo_admin, require_admin
from ..services.storage import update_auth_email, invite_user, StorageError
from ..services.ownership import rebalance_on_add, set_share, normalize
from ..services.purge import remove_owner_from_condo, delete_orphan_owners

router = APIRouter(prefix="/condominiums/{condominium_id}/owners", tags=["Condóminos"])

PROFILE_FIELDS = ("full_name", "phone", "landline_phone", "nif", "correspondence_address", "iban", "notes")


def _clean(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def _find_user_by_email(db: Session, email: str):
    return db.query(models.User).filter(func.lower(models.User.email) == email.strip().lower()).first()


def _fraction_in_condo(db: Session, condominium_id: str, fraction_id: str) -> models.Fraction:
    fraction = db.query(models.Fraction).filter(
        models.Fraction.id == fraction_id, models.Fraction.condominium_id == condominium_id
    ).first()
    if not fraction:
        raise HTTPException(404, "Fração não encontrada neste condomínio.")
    return fraction


def _user_condo_ids(db: Session, user_id: str):
    return {
        r[0] for r in db.query(models.Fraction.condominium_id)
        .join(models.FractionOwner, models.FractionOwner.fraction_id == models.Fraction.id)
        .filter(models.FractionOwner.user_id == user_id).all()
    }


def _admin_can_see(db: Session, admin: models.User, user_id: str) -> bool:
    """Os administradores têm acesso a todos os condóminos registados na plataforma."""
    return admin.role in (models.UserRole.admin, models.UserRole.super_admin)


def _send_invite(user: models.User):
    """Envia o convite; devolve (estado, erro). Nunca rebenta o pedido principal."""
    redirect = (os.environ.get("FRONTEND_URL") or "").rstrip("/") or None
    try:
        return invite_user(user.email, user.full_name, (redirect + "/") if redirect else None), None
    except StorageError as e:
        return None, str(e)


def _fraction_link(link: models.FractionOwner, fraction: models.Fraction) -> schemas.OwnerFractionLink:
    return schemas.OwnerFractionLink(
        id=link.id,
        fraction_id=fraction.id,
        fraction_identifier=fraction.identifier,
        ownership_share=float(link.ownership_share or 1),
        is_primary_contact=bool(link.is_primary_contact),
        permilagem=float(fraction.permilagem or 0),
        owned_permilagem=round(float(fraction.permilagem or 0) * float(link.ownership_share or 1), 3),
        insurance_company=fraction.insurance_company,
        insurance_policy_number=fraction.insurance_policy_number,
        insurance_valid_until=fraction.insurance_valid_until,
        has_insurance_document=bool(fraction.insurance_document_url),
    )


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
        fraction_link = _fraction_link(link, fraction)
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

    registered = []
    for data in by_user.values():
        u = data["user"]
        registered.append(schemas.OwnerDirectoryEntry(
            id=u.id,
            email=u.email,
            full_name=u.full_name,
            phone=u.phone,
            landline_phone=u.landline_phone,
            is_active=u.is_active,
            is_pending=False,
            has_login=bool(u.supabase_user_id),
            nif=u.nif,
            correspondence_address=u.correspondence_address,
            iban=u.iban,
            notes=u.notes,
            fractions=sorted(data["fractions"], key=lambda f: f.fraction_identifier),
            total_permilagem=round(sum(f.owned_permilagem for f in data["fractions"]), 3),
        ))
    registered.sort(key=lambda o: o.full_name.lower())
    return registered + pending


@router.post("", response_model=schemas.OwnerDirectoryEntry)
def add_owner(
    condominium_id: str,
    payload: schemas.OwnerCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_condo_admin),
):
    """Cria a ficha de um condómino e associa-o a uma fração.
    Se já existir alguém com esse email (ex: condómino noutro prédio), é esse registo que
    fica associado — a ficha dele não é alterada. Quando a pessoa criar conta com este
    email, fica automaticamente ligada a esta ficha."""
    fraction = _fraction_in_condo(db, condominium_id, payload.fraction_id)
    email = payload.email.strip().lower()
    user = _find_user_by_email(db, email)
    if user is None:
        user = models.User(email=email, role=models.UserRole.owner, is_active=True,
                           **{k: _clean(getattr(payload, k)) for k in PROFILE_FIELDS})
        if not user.full_name:
            raise HTTPException(400, "Indica o nome do condómino.")
        db.add(user)
        db.flush()
    else:
        already = db.query(models.FractionOwner).filter(
            models.FractionOwner.fraction_id == fraction.id, models.FractionOwner.user_id == user.id
        ).first()
        if already:
            raise HTTPException(409, f"{user.full_name} já está associado à fração {fraction.identifier}.")

    link = models.FractionOwner(
        fraction_id=fraction.id, user_id=user.id, ownership_share=1, is_primary_contact=payload.is_primary_contact,
    )
    db.add(link)
    db.flush()
    rebalance_on_add(db, fraction.id, link, payload.ownership_share)
    db.commit()
    db.refresh(user)
    db.refresh(link)
    invite_status, invite_error = None, None
    if payload.send_invite:
        invite_status, invite_error = _send_invite(user)
    return schemas.OwnerDirectoryEntry(
        invite_status=invite_status, invite_error=invite_error,
        id=user.id, email=user.email, full_name=user.full_name, phone=user.phone,
        landline_phone=user.landline_phone, is_active=user.is_active, has_login=bool(user.supabase_user_id),
        nif=user.nif, correspondence_address=user.correspondence_address, iban=user.iban, notes=user.notes,
        fractions=[_fraction_link(link, fraction)],
        total_permilagem=_fraction_link(link, fraction).owned_permilagem,
    )


@router.post("/{user_id}/fractions", response_model=schemas.OwnerFractionLink)
def assign_fraction(
    condominium_id: str,
    user_id: str,
    payload: schemas.OwnerFractionAssign,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_condo_admin),
):
    """Associa um condómino já registado a mais uma fração deste condomínio (a permilagem
    dele passa a ser a soma das frações). Serve também para voltar a ligar um condómino
    que ficou sem condomínio."""
    fraction = _fraction_in_condo(db, condominium_id, payload.fraction_id)
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or user.role != models.UserRole.owner:
        raise HTTPException(404, "Condómino não encontrado.")
    if not _admin_can_see(db, admin, user.id):
        raise HTTPException(403, "Este condómino pertence a um condomínio que não geres.")
    already = db.query(models.FractionOwner).filter(
        models.FractionOwner.fraction_id == fraction.id, models.FractionOwner.user_id == user.id
    ).first()
    if already:
        raise HTTPException(409, f"{user.full_name} já está associado à fração {fraction.identifier}.")
    link = models.FractionOwner(
        fraction_id=fraction.id, user_id=user.id, ownership_share=1, is_primary_contact=payload.is_primary_contact,
    )
    db.add(link)
    db.flush()
    rebalance_on_add(db, fraction.id, link, payload.ownership_share)
    db.commit()
    db.refresh(link)
    return _fraction_link(link, fraction)


@router.put("/{user_id}/fractions/{link_id}", response_model=schemas.OwnerFractionLink)
def update_fraction_link(
    condominium_id: str,
    user_id: str,
    link_id: str,
    payload: schemas.OwnerFractionAssign,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_condo_admin),
):
    """Na ficha do condómino: trocar a fração associada (ex: registada por engano) e/ou
    alterar a quota de propriedade e o contacto principal."""
    link = (
        db.query(models.FractionOwner)
        .join(models.Fraction, models.FractionOwner.fraction_id == models.Fraction.id)
        .filter(models.FractionOwner.id == link_id, models.FractionOwner.user_id == user_id,
                models.Fraction.condominium_id == condominium_id)
        .first()
    )
    if not link:
        raise HTTPException(404, "Associação não encontrada neste condomínio.")
    new_fraction = _fraction_in_condo(db, condominium_id, payload.fraction_id)
    old_fraction_id = link.fraction_id
    link.is_primary_contact = payload.is_primary_contact
    if new_fraction.id != old_fraction_id:
        clash = db.query(models.FractionOwner).filter(
            models.FractionOwner.fraction_id == new_fraction.id, models.FractionOwner.user_id == user_id
        ).first()
        if clash:
            raise HTTPException(409, f"Este condómino já está associado à fração {new_fraction.identifier}.")
        link.fraction_id = new_fraction.id
        link.ownership_share = 1
        db.flush()
        normalize(db, old_fraction_id)  # os outros donos da fração antiga ficam com a parte dele
        rebalance_on_add(db, new_fraction.id, link, payload.ownership_share)
    elif payload.ownership_share is not None:
        db.flush()
        set_share(db, new_fraction.id, link, payload.ownership_share)
    if payload.is_primary_contact:
        normalize(db, new_fraction.id)
    db.commit()
    db.refresh(link)
    return _fraction_link(link, new_fraction)


@router.post("/{user_id}/invite")
def send_invite(
    condominium_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_condo_admin),
):
    """(Re)envia ao condómino o convite por email para criar a palavra-passe e entrar na app."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or user.role != models.UserRole.owner:
        raise HTTPException(404, "Condómino não encontrado.")
    status, error = _send_invite(user)
    if error:
        raise HTTPException(502, error)
    return {"ok": True, "status": status, "email": user.email}


@router.put("/pending/{link_id}", response_model=schemas.UserOut)
def complete_pending_invite(
    condominium_id: str,
    link_id: str,
    payload: schemas.OwnerProfile,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_condo_admin),
):
    """Transforma um convite pendente (só email) numa ficha completa — também serve
    para corrigir o email de um convite enviado com erro."""
    link = (
        db.query(models.FractionOwner)
        .join(models.Fraction, models.FractionOwner.fraction_id == models.Fraction.id)
        .filter(models.FractionOwner.id == link_id, models.Fraction.condominium_id == condominium_id,
                models.FractionOwner.user_id.is_(None))
        .first()
    )
    if not link:
        raise HTTPException(404, "Convite não encontrado.")
    email = payload.email.strip().lower()
    user = _find_user_by_email(db, email)
    if user is None:
        user = models.User(email=email, role=models.UserRole.owner, is_active=True,
                           **{k: _clean(getattr(payload, k)) for k in PROFILE_FIELDS})
        db.add(user)
        db.flush()
    elif db.query(models.FractionOwner).filter(
        models.FractionOwner.fraction_id == link.fraction_id, models.FractionOwner.user_id == user.id
    ).first():
        # já está associado a esta fração por outra via: o convite fica redundante
        db.delete(link)
        db.commit()
        return user
    link.user_id = user.id
    link.invited_email = None
    db.commit()
    db.refresh(user)
    return user


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

    changes = payload.model_dump(exclude_unset=True)
    new_email = changes.pop("email", None)
    if new_email:
        new_email = new_email.strip().lower()
    if new_email and new_email != (target.email or "").lower():
        # Só se muda o email de condóminos: mudar o email de um administrador daria
        # a quem o muda a possibilidade de entrar na conta dele.
        if target.role != models.UserRole.owner:
            raise HTTPException(403, "Este utilizador é administrador: só ele pode alterar o próprio email.")
        other = _find_user_by_email(db, new_email)
        if other and other.id != target.id:
            raise HTTPException(409, "Já existe outro utilizador com esse email.")
        if target.supabase_user_id:
            # a pessoa já tem conta: muda também o email com que entra na app
            try:
                update_auth_email(target.supabase_user_id, new_email)
            except StorageError as e:
                raise HTTPException(502, str(e))
        target.email = new_email

    if "is_active" in changes and changes["is_active"] is False and target.role != models.UserRole.owner:
        raise HTTPException(403, "Não é possível desativar a conta de um administrador a partir daqui.")
    for k, v in changes.items():
        if k == "full_name" and not _clean(v):
            raise HTTPException(400, "O nome não pode ficar vazio.")
        setattr(target, k, _clean(v) if k != "is_active" else v)
    db.commit()
    db.refresh(target)
    return target


@router.delete("/pending/{link_id}")
def delete_pending_invite(
    condominium_id: str,
    link_id: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_condo_admin),
):
    link = (
        db.query(models.FractionOwner)
        .join(models.Fraction, models.FractionOwner.fraction_id == models.Fraction.id)
        .filter(models.FractionOwner.id == link_id, models.Fraction.condominium_id == condominium_id,
                models.FractionOwner.user_id.is_(None))
        .first()
    )
    if not link:
        raise HTTPException(404, "Convite não encontrado.")
    db.delete(link)
    db.commit()
    return {"ok": True}


@router.delete("/{user_id}")
def delete_owner(
    condominium_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_condo_admin),
):
    """Elimina o condómino DESTE condomínio (tira-o de todas as frações daqui).
    Se não tiver frações noutros condomínios nem histórico, a ficha é apagada.
    As quotas e pagamentos ficam na fração (pertencem à fração, não à pessoa)."""
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        raise HTTPException(404, "Condómino não encontrado.")
    result = remove_owner_from_condo(db, user_id, condominium_id)
    if result["fractions_unlinked"] == 0:
        db.rollback()
        raise HTTPException(404, "Este condómino não está associado a nenhuma fração deste condomínio.")
    db.commit()
    return {"ok": True, **result}


# ---------------------------------------------------------------------------
# Todos os condóminos registados na plataforma (vista do administrador)
# ---------------------------------------------------------------------------
platform_router = APIRouter(prefix="/owners", tags=["Condóminos"])


@platform_router.get("", response_model=List[schemas.PlatformOwnerEntry])
def list_platform_owners(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    """Todos os condóminos registados na base de dados, qualquer que seja o condomínio
    (incluindo os que ficaram sem nenhum condomínio, que aparecem primeiro)."""
    condo_names = dict(db.query(models.Condominium.id, models.Condominium.name).all())
    rows = (
        db.query(models.FractionOwner.user_id, models.Fraction.condominium_id, models.Fraction.identifier,
                 models.Fraction.permilagem, models.FractionOwner.ownership_share)
        .join(models.Fraction, models.FractionOwner.fraction_id == models.Fraction.id)
        .filter(models.FractionOwner.user_id.isnot(None))
        .all()
    )
    by_user = {}
    for uid, cid, ident, perm, share in rows:
        c = by_user.setdefault(uid, {}).setdefault(cid, {"fractions": [], "permilagem": 0.0})
        c["fractions"].append(ident)
        c["permilagem"] += float(perm or 0) * float(share or 1)

    result = []
    for u in db.query(models.User).filter(models.User.role == models.UserRole.owner).all():
        condos = by_user.get(u.id, {})
        visible = condos
        result.append(schemas.PlatformOwnerEntry(
            id=u.id, email=u.email, full_name=u.full_name, phone=u.phone, nif=u.nif,
            is_active=u.is_active, has_login=bool(u.supabase_user_id), created_at=u.created_at,
            unassigned=not condos,
            condominiums=sorted([
                schemas.PlatformOwnerCondo(
                    condominium_id=cid, condominium_name=condo_names.get(cid, "?"),
                    fractions=sorted(c["fractions"]), permilagem=round(c["permilagem"], 3),
                ) for cid, c in visible.items()
            ], key=lambda c: c.condominium_name.lower()),
        ))
    result.sort(key=lambda o: (not o.unassigned, (o.full_name or "").lower()))
    return result


@platform_router.delete("/{user_id}")
def delete_unassigned_owner(user_id: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    """Apaga a ficha de um condómino que não tem nenhum condomínio. Se tiver histórico
    (pagamentos, ocorrências, votos…) a ficha fica guardada e o acesso é desativado."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or user.role != models.UserRole.owner:
        raise HTTPException(404, "Condómino não encontrado.")
    if _user_condo_ids(db, user.id):
        raise HTTPException(409, "Este condómino ainda tem frações associadas: retira-o primeiro no condomínio respetivo.")
    removed = delete_orphan_owners(db, [user.id])
    if not removed:
        user.is_active = False
    db.commit()
    return {"ok": True, "deleted": bool(removed), "deactivated": not removed}
