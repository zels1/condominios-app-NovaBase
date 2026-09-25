"""Assembleias: ordem de trabalhos, procurações, presenças e votação (com peso por permilagem)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import date, datetime

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin, get_user_fraction_ids

router = APIRouter(prefix="/condominiums/{condominium_id}/assemblies", tags=["Assembleias"])


# ---------- Helpers ----------
def _get_assembly(db: Session, condominium_id: str, assembly_id: str) -> models.Assembly:
    """Garante que a assembleia existe E pertence a este condomínio."""
    assembly = db.query(models.Assembly).filter(
        models.Assembly.id == assembly_id, models.Assembly.condominium_id == condominium_id
    ).first()
    if not assembly:
        raise HTTPException(404, "Assembleia não encontrada.")
    return assembly


def _get_agenda_item(db: Session, assembly: models.Assembly, agenda_item_id: str) -> models.AgendaItem:
    item = db.query(models.AgendaItem).filter(
        models.AgendaItem.id == agenda_item_id, models.AgendaItem.assembly_id == assembly.id
    ).first()
    if not item:
        raise HTTPException(404, "Ponto da ordem de trabalhos não encontrado nesta assembleia.")
    return item


def _status_value(status) -> str:
    return status.value if hasattr(status, "value") else status


def _is_condo_admin(db: Session, user: models.User, condominium_id: str) -> bool:
    if user.role == models.UserRole.super_admin:
        return True
    if user.role != models.UserRole.admin:
        return False
    condo = db.query(models.Condominium).filter(models.Condominium.id == condominium_id).first()
    return bool(condo and condo.admin_user_id == user.id)


def _voting_fractions_for_user(db: Session, user: models.User, condominium_id: str, assembly_id: str) -> list:
    """Frações em nome das quais este utilizador pode votar nesta assembleia:
    as suas (neste condomínio) e as que lhe foram delegadas por procuração validada."""
    today = date.today()
    own = (
        db.query(models.Fraction)
        .join(models.FractionOwner, models.FractionOwner.fraction_id == models.Fraction.id)
        .filter(
            models.FractionOwner.user_id == user.id,
            models.Fraction.condominium_id == condominium_id,
            models.Fraction.is_active == True,  # noqa: E712
            (models.FractionOwner.end_date == None) | (models.FractionOwner.end_date >= today),  # noqa: E711
        )
        .all()
    )
    result = {f.id: (f, False) for f in own}
    proxied = (
        db.query(models.Fraction)
        .join(models.Proxy, models.Proxy.fraction_id == models.Fraction.id)
        .filter(
            models.Proxy.assembly_id == assembly_id,
            models.Proxy.proxy_holder_user_id == user.id,
            models.Proxy.status == models.ProxyStatus.validated,
            models.Fraction.condominium_id == condominium_id,
        )
        .all()
    )
    for f in proxied:
        result.setdefault(f.id, (f, True))
    return sorted(result.values(), key=lambda t: t[0].identifier)


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
    """Estados: scheduled (agendada) → in_progress (em curso, votação aberta) → closed (encerrada)."""
    valid = [s.value for s in models.AssemblyStatus]
    if status not in valid:
        raise HTTPException(400, f"Estado inválido. Usa um de: {', '.join(valid)}.")
    assembly = _get_assembly(db, condominium_id, assembly_id)
    assembly.status = models.AssemblyStatus(status)
    db.commit()
    return {"ok": True, "status": status}


# ---------- Agenda ----------
@router.post("/{assembly_id}/agenda", response_model=schemas.AgendaItemOut)
def add_agenda_item(condominium_id: str, assembly_id: str, payload: schemas.AgendaItemCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    _get_assembly(db, condominium_id, assembly_id)
    item = models.AgendaItem(assembly_id=assembly_id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/{assembly_id}/agenda", response_model=List[schemas.AgendaItemOut])
def list_agenda(condominium_id: str, assembly_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _get_assembly(db, condominium_id, assembly_id)
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
@router.get("/{assembly_id}/my-fractions")
def my_voting_fractions(condominium_id: str, assembly_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Para o ecrã do condómino: frações em que pode votar (próprias + procurações
    validadas) e o voto já registado em cada ponto."""
    _get_assembly(db, condominium_id, assembly_id)
    fractions = _voting_fractions_for_user(db, user, condominium_id, assembly_id)
    ids = [f.id for f, _ in fractions]
    votes = (
        db.query(models.Vote)
        .join(models.AgendaItem, models.Vote.agenda_item_id == models.AgendaItem.id)
        .filter(models.AgendaItem.assembly_id == assembly_id, models.Vote.fraction_id.in_(ids))
        .all()
    ) if ids else []
    by_fraction = {}
    for v in votes:
        by_fraction.setdefault(v.fraction_id, {})[v.agenda_item_id] = _status_value(v.choice)
    return [
        {
            "fraction_id": f.id,
            "identifier": f.identifier,
            "permilagem": float(f.permilagem),
            "via_proxy": via_proxy,
            "votes": by_fraction.get(f.id, {}),
        }
        for f, via_proxy in fractions
    ]


@router.get("/{assembly_id}/voting-sheet")
def voting_sheet(condominium_id: str, assembly_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    """Folha de votação para o admin: todas as frações ativas, presença e voto em cada ponto."""
    _get_assembly(db, condominium_id, assembly_id)
    fractions = (
        db.query(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id, models.Fraction.is_active == True)  # noqa: E712
        .order_by(models.Fraction.identifier)
        .all()
    )
    attendance = {
        a.fraction_id: a.attendance_type
        for a in db.query(models.Attendance).filter(models.Attendance.assembly_id == assembly_id).all()
    }
    votes = (
        db.query(models.Vote)
        .join(models.AgendaItem, models.Vote.agenda_item_id == models.AgendaItem.id)
        .filter(models.AgendaItem.assembly_id == assembly_id)
        .all()
    )
    by_fraction = {}
    for v in votes:
        by_fraction.setdefault(v.fraction_id, {})[v.agenda_item_id] = _status_value(v.choice)
    return [
        {
            "fraction_id": f.id,
            "identifier": f.identifier,
            "permilagem": float(f.permilagem),
            "attendance": attendance.get(f.id, "absent"),
            "votes": by_fraction.get(f.id, {}),
        }
        for f in fractions
    ]


@router.post("/{assembly_id}/agenda/{agenda_item_id}/votes", response_model=schemas.VoteOut)
def cast_vote(
    condominium_id: str,
    assembly_id: str,
    agenda_item_id: str,
    payload: schemas.VoteCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Condómino: vota pelas suas frações ou pelas que representa por procuração validada;
    não pode alterar um voto já dado.
    Admin do condomínio: regista/corrige o voto de qualquer fração (votos dados na sala).
    Em ambos os casos a fração fica marcada como presente (ou representada), para o quórum."""
    assembly = _get_assembly(db, condominium_id, assembly_id)
    if _status_value(assembly.status) != models.AssemblyStatus.in_progress.value:
        raise HTTPException(400, "A votação só está aberta enquanto a assembleia está em curso.")
    item = _get_agenda_item(db, assembly, agenda_item_id)
    if not item.requires_vote:
        raise HTTPException(400, "Este ponto da ordem de trabalhos não é votado.")

    valid_choices = [c.value for c in models.VoteChoice]
    if payload.choice not in valid_choices:
        raise HTTPException(400, f"Voto inválido. Usa um de: {', '.join(valid_choices)}.")

    fraction = db.query(models.Fraction).filter(
        models.Fraction.id == payload.fraction_id,
        models.Fraction.condominium_id == condominium_id,
        models.Fraction.is_active == True,  # noqa: E712
    ).first()
    if not fraction:
        raise HTTPException(404, "Fração não encontrada neste condomínio.")

    is_admin = _is_condo_admin(db, user, condominium_id)
    via_proxy = False
    if not is_admin:
        allowed = {f.id: p for f, p in _voting_fractions_for_user(db, user, condominium_id, assembly_id)}
        if fraction.id not in allowed:
            raise HTTPException(403, "Sem permissão para votar por esta fração.")
        via_proxy = allowed[fraction.id]

    attendance = db.query(models.Attendance).filter(
        models.Attendance.assembly_id == assembly_id, models.Attendance.fraction_id == fraction.id
    ).first()
    # Votar implica participar: a fração passa a contar para o quórum.
    if not attendance:
        attendance = models.Attendance(assembly_id=assembly_id, fraction_id=fraction.id)
        db.add(attendance)
    if attendance.attendance_type in (None, "absent"):
        attendance.attendance_type = "proxy" if via_proxy else "present"
        attendance.checked_in_at = datetime.utcnow()
    if is_admin:
        via_proxy = attendance.attendance_type == "proxy"

    existing = db.query(models.Vote).filter(
        models.Vote.agenda_item_id == item.id, models.Vote.fraction_id == fraction.id
    ).first()
    if existing:
        if not is_admin:
            raise HTTPException(409, "Esta fração já votou neste ponto da ordem de trabalhos.")
        existing.choice = models.VoteChoice(payload.choice)
        existing.cast_by_user_id = user.id
        existing.cast_via_proxy = via_proxy
        vote = existing
    else:
        vote = models.Vote(
            agenda_item_id=item.id,
            fraction_id=fraction.id,
            choice=models.VoteChoice(payload.choice),
            cast_via_proxy=via_proxy,
            cast_by_user_id=user.id,
            permilagem_at_vote=fraction.permilagem,
        )
        db.add(vote)
    db.commit()
    db.refresh(vote)
    return vote


@router.delete("/{assembly_id}/agenda/{agenda_item_id}/votes/{fraction_id}")
def delete_vote(
    condominium_id: str,
    assembly_id: str,
    agenda_item_id: str,
    fraction_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_condo_admin),
):
    """Admin: anula um voto registado por engano (só com a assembleia em curso)."""
    assembly = _get_assembly(db, condominium_id, assembly_id)
    if _status_value(assembly.status) != models.AssemblyStatus.in_progress.value:
        raise HTTPException(400, "Só é possível alterar votos enquanto a assembleia está em curso.")
    item = _get_agenda_item(db, assembly, agenda_item_id)
    vote = db.query(models.Vote).filter(models.Vote.agenda_item_id == item.id, models.Vote.fraction_id == fraction_id).first()
    if vote:
        db.delete(vote)
        db.commit()
    return {"ok": True}


@router.get("/{assembly_id}/agenda/{agenda_item_id}/results")
def vote_results(condominium_id: str, assembly_id: str, agenda_item_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    assembly = _get_assembly(db, condominium_id, assembly_id)
    item = _get_agenda_item(db, assembly, agenda_item_id)
    votes = db.query(models.Vote).filter(models.Vote.agenda_item_id == item.id).all()
    totals = {"favor": 0.0, "against": 0.0, "abstain": 0.0}
    for v in votes:
        totals[_status_value(v.choice)] += float(v.permilagem_at_vote)
    total_voted = sum(totals.values())
    return {
        "agenda_item_id": item.id,
        "votes_cast": len(votes),
        "permilagem_totals": totals,
        "total_permilagem_voted": total_voted,
        "approved": totals["favor"] > totals["against"],
    }
