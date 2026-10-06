"""Política de privacidade (RGPD):
- identificação da entidade que explora a plataforma (pública: aparece na política);
- registo de que cada utilizador tomou conhecimento da versão em vigor;
- exportação dos dados pessoais do próprio utilizador (direito de acesso e de portabilidade)."""
import json
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, require_admin
from ..database import get_db

router = APIRouter(prefix="/legal", tags=["Privacidade"])
me_router = APIRouter(prefix="/me", tags=["Privacidade"])

SETTING_KEY = "privacy_entity"


def _entity(db: Session) -> dict:
    row = db.query(models.PlatformSetting).filter(models.PlatformSetting.key == SETTING_KEY).first()
    data = schemas.PrivacyEntity(**(row.value if row and row.value else {})).model_dump()
    data["updated_at"] = row.updated_at.isoformat() if row and row.updated_at else None
    return data


def _can_edit(db: Session, user: models.User) -> bool:
    """Quem define a identificação legal da plataforma: o super_admin; enquanto não houver
    nenhum super_admin, qualquer administrador (instalações com um só gestor)."""
    if user.role == models.UserRole.super_admin:
        return True
    has_super = db.query(models.User.id).filter(models.User.role == models.UserRole.super_admin).first()
    return user.role == models.UserRole.admin and not has_super


@router.get("/privacy")
def get_privacy_entity(db: Session = Depends(get_db)):
    """Público (sem login): a política de privacidade tem de poder ser lida antes de criar conta."""
    return _entity(db)


@router.get("/privacy/can-edit")
def can_edit(db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    return {"can_edit": _can_edit(db, user)}


@router.put("/privacy")
def update_privacy_entity(payload: schemas.PrivacyEntity, db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    if not _can_edit(db, user):
        raise HTTPException(403, "Só o administrador principal da plataforma (super_admin) pode alterar estes dados.")
    data = {k: (v.strip() or None) if isinstance(v, str) else v for k, v in payload.model_dump().items()}
    row = db.query(models.PlatformSetting).filter(models.PlatformSetting.key == SETTING_KEY).first()
    if not row:
        row = models.PlatformSetting(key=SETTING_KEY)
        db.add(row)
    row.value = data
    row.updated_at = datetime.utcnow()
    row.updated_by = user.id
    db.add(models.AuditLog(user_id=user.id, action="privacy.entity_updated", entity_type="platform"))
    db.commit()
    return _entity(db)


@me_router.post("/privacy-ack", response_model=schemas.UserOut)
def acknowledge_privacy(payload: schemas.PrivacyAck, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Regista que o utilizador tomou conhecimento da política de privacidade (versão indicada)."""
    user.privacy_ack_version = payload.version
    user.privacy_ack_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user


def _plain(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if hasattr(v, "value"):
        return v.value
    return v


def _rows(items, fields):
    return [{f: _plain(getattr(i, f, None)) for f in fields} for i in items]


@me_router.get("/data-export")
def export_my_data(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Todos os dados pessoais que a aplicação guarda sobre o próprio utilizador, num ficheiro
    JSON legível (RGPD, arts. 15.º e 20.º)."""
    links = db.query(models.FractionOwner).filter(models.FractionOwner.user_id == user.id).all()
    fraction_ids = [l.fraction_id for l in links]
    fractions = db.query(models.Fraction).filter(models.Fraction.id.in_(fraction_ids)).all() if fraction_ids else []
    condo_names = dict(db.query(models.Condominium.id, models.Condominium.name).filter(
        models.Condominium.id.in_({f.condominium_id for f in fractions})).all()) if fractions else {}
    by_id = {f.id: f for f in fractions}
    quotas = db.query(models.Quota).filter(models.Quota.fraction_id.in_(fraction_ids)).order_by(models.Quota.reference_month).all() if fraction_ids else []
    quota_ids = [q.id for q in quotas]
    payments = db.query(models.Payment).filter(models.Payment.quota_id.in_(quota_ids)).all() if quota_ids else []
    occurrences = db.query(models.Occurrence).filter(models.Occurrence.reported_by == user.id).all()
    votes = db.query(models.Vote).filter(models.Vote.fraction_id.in_(fraction_ids)).all() if fraction_ids else []
    proxies = db.query(models.Proxy).filter(
        (models.Proxy.fraction_id.in_(fraction_ids)) | (models.Proxy.proxy_holder_user_id == user.id)).all() if fraction_ids else \
        db.query(models.Proxy).filter(models.Proxy.proxy_holder_user_id == user.id).all()
    attendances = db.query(models.Attendance).filter(models.Attendance.fraction_id.in_(fraction_ids)).all() if fraction_ids else []

    data = {
        "exportado_em": datetime.now().isoformat(timespec="seconds"),
        "nota": "Dados pessoais guardados na plataforma Domvus sobre a sua conta. As palavras-passe não são guardadas de forma legível.",
        "conta": _rows([user], ["email", "full_name", "phone", "landline_phone", "nif", "correspondence_address", "iban",
                                "role", "is_active", "created_at", "privacy_ack_version", "privacy_ack_at"])[0],
        "fracoes": [{
            "condominio": condo_names.get(by_id[l.fraction_id].condominium_id) if l.fraction_id in by_id else None,
            "fracao": by_id[l.fraction_id].identifier if l.fraction_id in by_id else None,
            "permilagem": _plain(by_id[l.fraction_id].permilagem) if l.fraction_id in by_id else None,
            "quota_de_propriedade": _plain(l.ownership_share),
            "contacto_principal": l.is_primary_contact,
            "seguro": {
                "seguradora": by_id[l.fraction_id].insurance_company,
                "apolice": by_id[l.fraction_id].insurance_policy_number,
                "valido_ate": _plain(by_id[l.fraction_id].insurance_valid_until),
            } if l.fraction_id in by_id else None,
        } for l in links],
        "quotas": [{
            "fracao": by_id[q.fraction_id].identifier if q.fraction_id in by_id else None,
            "mes": _plain(q.reference_month), "descricao": q.description, "vencimento": _plain(q.due_date),
            "valor": _plain(q.base_amount), "juros": _plain(q.late_fee_amount), "pago": _plain(q.amount_paid),
            "estado": _plain(q.status),
        } for q in quotas],
        "pagamentos": _rows(payments, ["quota_id", "amount", "paid_at", "method", "reference"]),
        "ocorrencias_reportadas": _rows(occurrences, ["title", "description", "priority", "status", "photo_url", "created_at", "resolved_at"]),
        "assembleias": {
            "presencas": _rows(attendances, ["assembly_id", "fraction_id", "attendance_type", "checked_in_at"]),
            "votos": _rows(votes, ["agenda_item_id", "fraction_id", "choice", "cast_via_proxy", "created_at"]),
            "procuracoes": _rows(proxies, ["assembly_id", "fraction_id", "proxy_holder_name", "status", "created_at"]),
        },
    }
    # sem user_id: este registo não deve impedir que a ficha da pessoa seja apagada mais tarde
    db.add(models.AuditLog(action="privacy.data_exported", entity_type="user", entity_id=user.id))
    db.commit()
    body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    filename = f"os-meus-dados-domvus-{date.today():%Y-%m-%d}.json"
    return Response(content=body, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
