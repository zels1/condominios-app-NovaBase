"""Assembleias: ordem de trabalhos, procurações, presenças e votação (com peso por permilagem)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin, get_user_fraction_ids

router = APIRouter(prefix="/condominiums/{condominium_id}/assemblies", tags=["Assembleias"])


@router.post("", response_model=schemas.AssemblyOut)
def create_assembly(condominium_id: str, payload: schemas.AssemblyCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    assembly = models.Assembly(condominium_id=condominium_id, **payload.model_dump())
    db.add(assembly)
    db.commit()
    db.refresh(assembly)
    return assembly


@router.get("", response_model=List[schemas.AssemblyOut])
def list_assemblies(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return db.query(models.Assembly).filter(models.Assembly.condominium_id == condominium_id).order_by(models.Assembly.scheduled_at.desc()).all()


@router.post("/{assembly_id}/status")
def set_status(condominium_id: str, assembly_id: str, status: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    assembly = db.query(models.Assembly).filter(models.Assembly.id == assembly_id).first()
    if not assembly:
        raise HTTPException(404, "Assembleia não encontrada.")
    assembly.status = status
    db.commit()
    return {"ok": True, "status": assembly.status}


# ---------- Agenda ----------
@router.post("/{assembly_id}/agenda", response_model=schemas.AgendaItemOut)
def add_agenda_item(condominium_id: str, assembly_id: str, payload: schemas.AgendaItemCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    item = models.AgendaItem(assembly_id=assembly_id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/{assembly_id}/agenda", response_model=List[schemas.AgendaItemOut])
def list_agenda(condominium_id: str, assembly_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return db.query(models.AgendaItem).filter(models.AgendaItem.assembly_id == assembly_id).order_by(models.AgendaItem.order).all()


# ---------- Proxies (procurações) ----------
@router.post("/{assembly_id}/proxies", response_model=schemas.ProxyOut)
def submit_proxy(
    condominium_id: str,
    assembly_id: str,
    payload: schemas.ProxyCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Um condómino pode submeter a procuração da sua própria fração; o admin pode submeter
    para qualquer fração (ex: procuração em papel entregue à mão)."""
    if user.role == models.UserRole.owner and payload.fraction_id not in get_user_fraction_ids(db, user):
        raise HTTPException(403, "Essa fração não lhe pertence.")
    existing = db.query(models.Proxy).filter(models.Proxy.assembly_id == assembly_id, models.Proxy.fraction_id == payload.fraction_id).first()
    if existing:
        raise HTTPException(409, "Já existe uma procuração submetida para esta fração nesta assembleia.")
    proxy = models.Proxy(assembly_id=assembly_id, **payload.model_dump())
    db.add(proxy)
    db.commit()
    db.refresh(proxy)
    return proxy


@router.get("/{assembly_id}/proxies", response_model=List[schemas.ProxyOut])
def list_proxies(condominium_id: str, assembly_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    return db.query(models.Proxy).filter(models.Proxy.assembly_id == assembly_id).all()


@router.post("/{assembly_id}/proxies/{proxy_id}/validate")
def validate_proxy(
    condominium_id: str,
    assembly_id: str,
    proxy_id: str,
    approve: bool = True,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    proxy = db.query(models.Proxy).filter(models.Proxy.id == proxy_id, models.Proxy.assembly_id == assembly_id).first()
    if not proxy:
        raise HTTPException(404, "Procuração não encontrada.")
    proxy.status = models.ProxyStatus.validated if approve else models.ProxyStatus.rejected
    if approve:
        att = db.query(models.Attendance).filter(models.Attendance.assembly_id == assembly_id, models.Attendance.fraction_id == proxy.fraction_id).first()
        if not att:
            att = models.Attendance(assembly_id=assembly_id, fraction_id=proxy.fraction_id)
            db.add(att)
        att.attendance_type = "proxy"
        att.proxy_id = proxy.id
    db.commit()
    return {"ok": True, "status": proxy.status}


# ---------- Attendance (check-in) ----------
@router.post("/{assembly_id}/attendance/{fraction_id}/check-in")
def check_in(condominium_id: str, assembly_id: str, fraction_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    from datetime import datetime
    att = db.query(models.Attendance).filter(models.Attendance.assembly_id == assembly_id, models.Attendance.fraction_id == fraction_id).first()
    if not att:
        att = models.Attendance(assembly_id=assembly_id, fraction_id=fraction_id)
        db.add(att)
    att.attendance_type = "present"
    att.checked_in_at = datetime.utcnow()
    db.commit()
    return {"ok": True}


@router.get("/{assembly_id}/attendance")
def get_attendance_summary(condominium_id: str, assembly_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    """Resumo de quórum: soma de permilagem presente/representada vs. total do condomínio."""
    fractions = db.query(models.Fraction).filter(models.Fraction.condominium_id == condominium_id, models.Fraction.is_active == True).all()  # noqa: E712
    total_permilagem = sum(float(f.permilagem) for f in fractions)
    attendances = db.query(models.Attendance).filter(models.Attendance.assembly_id == assembly_id).all()
    by_fraction = {f.id: f for f in fractions}
    present_permilagem = 0.0
    entries = []
    for att in attendances:
        f = by_fraction.get(att.fraction_id)
        if not f or att.attendance_type == "absent":
            continue
        present_permilagem += float(f.permilagem)
        entries.append({"fraction_id": f.id, "identifier": f.identifier, "type": att.attendance_type, "permilagem": float(f.permilagem)})
    return {
        "total_permilagem": total_permilagem,
        "present_permilagem": present_permilagem,
        "quorum_percent": round((present_permilagem / total_permilagem * 100), 2) if total_permilagem else 0,
        "attendance": entries,
    }


# ---------- Votes ----------
@router.post("/{assembly_id}/agenda/{agenda_item_id}/votes", response_model=schemas.VoteOut)
def cast_vote(
    condominium_id: str,
    assembly_id: str,
    agenda_item_id: str,
    payload: schemas.VoteCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    if user.role == models.UserRole.owner and payload.fraction_id not in get_user_fraction_ids(db, user):
        # também permite votar se for o procurador designado
        proxy = db.query(models.Proxy).filter(
            models.Proxy.assembly_id == assembly_id,
            models.Proxy.fraction_id == payload.fraction_id,
            models.Proxy.proxy_holder_user_id == user.id,
            models.Proxy.status == models.ProxyStatus.validated,
        ).first()
        if not proxy:
            raise HTTPException(403, "Sem permissão para votar por esta fração.")

    fraction = db.query(models.Fraction).filter(models.Fraction.id == payload.fraction_id).first()
    if not fraction:
        raise HTTPException(404, "Fração não encontrada.")

    existing = db.query(models.Vote).filter(models.Vote.agenda_item_id == agenda_item_id, models.Vote.fraction_id == payload.fraction_id).first()
    if existing:
        raise HTTPException(409, "Esta fração já votou neste ponto da ordem de trabalhos.")

    vote = models.Vote(
        agenda_item_id=agenda_item_id,
        fraction_id=payload.fraction_id,
        choice=payload.choice,
        cast_via_proxy=payload.cast_via_proxy,
        cast_by_user_id=user.id,
        permilagem_at_vote=fraction.permilagem,
    )
    db.add(vote)
    db.commit()
    db.refresh(vote)
    return vote


@router.get("/{assembly_id}/agenda/{agenda_item_id}/results")
def vote_results(condominium_id: str, assembly_id: str, agenda_item_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    votes = db.query(models.Vote).filter(models.Vote.agenda_item_id == agenda_item_id).all()
    totals = {"favor": 0.0, "against": 0.0, "abstain": 0.0}
    for v in votes:
        totals[v.choice.value if hasattr(v.choice, "value") else v.choice] += float(v.permilagem_at_vote)
    total_voted = sum(totals.values())
    return {
        "agenda_item_id": agenda_item_id,
        "votes_cast": len(votes),
        "permilagem_totals": totals,
        "total_permilagem_voted": total_voted,
        "approved": totals["favor"] > totals["against"],
    }
