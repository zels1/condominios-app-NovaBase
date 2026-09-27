"""Eliminação definitiva de frações, condóminos e condomínios.

Apaga tudo o que depende do registo, pela ordem certa (para não violar chaves
estrangeiras), e devolve um resumo do que foi (ou seria) apagado — usado também
para mostrar ao administrador o que vai perder antes de confirmar."""
from sqlalchemy.orm import Session

from .. import models
from .storage import is_private_ref, delete_file


def _ids(q):
    return [r[0] for r in q.all()]


# ---------------------------------------------------------------------------
# Fração
# ---------------------------------------------------------------------------
def fraction_summary(db: Session, fraction_id: str) -> dict:
    quota_ids = _ids(db.query(models.Quota.id).filter(models.Quota.fraction_id == fraction_id))
    return {
        "owners": db.query(models.FractionOwner).filter(models.FractionOwner.fraction_id == fraction_id).count(),
        "quotas": len(quota_ids),
        "payments": db.query(models.Payment).filter(models.Payment.quota_id.in_(quota_ids)).count() if quota_ids else 0,
        "votes": db.query(models.Vote).filter(models.Vote.fraction_id == fraction_id).count(),
        "occurrences": db.query(models.Occurrence).filter(models.Occurrence.fraction_id == fraction_id).count(),
    }


def delete_fraction(db: Session, fraction: models.Fraction) -> dict:
    """Apaga a fração e o seu histórico (quotas, pagamentos, votos, presenças, procurações).
    As ocorrências dessa fração não se perdem: passam a 'zona comum'."""
    fid = fraction.id
    summary = fraction_summary(db, fid)
    quota_ids = _ids(db.query(models.Quota.id).filter(models.Quota.fraction_id == fid))
    if quota_ids:
        db.query(models.ReminderLog).filter(models.ReminderLog.quota_id.in_(quota_ids)).delete(synchronize_session=False)
        db.query(models.Payment).filter(models.Payment.quota_id.in_(quota_ids)).delete(synchronize_session=False)
        db.query(models.Quota).filter(models.Quota.id.in_(quota_ids)).delete(synchronize_session=False)
    db.query(models.Vote).filter(models.Vote.fraction_id == fid).delete(synchronize_session=False)
    db.query(models.Attendance).filter(models.Attendance.fraction_id == fid).delete(synchronize_session=False)
    db.query(models.Proxy).filter(models.Proxy.fraction_id == fid).delete(synchronize_session=False)
    db.query(models.Occurrence).filter(models.Occurrence.fraction_id == fid).update(
        {models.Occurrence.fraction_id: None}, synchronize_session=False)
    user_ids = _ids(db.query(models.FractionOwner.user_id).filter(
        models.FractionOwner.fraction_id == fid, models.FractionOwner.user_id.isnot(None)))
    db.query(models.FractionOwner).filter(models.FractionOwner.fraction_id == fid).delete(synchronize_session=False)
    db.query(models.Fraction).filter(models.Fraction.id == fid).delete(synchronize_session=False)
    db.flush()
    summary["users_removed"] = delete_orphan_owners(db, user_ids)
    return summary


# ---------------------------------------------------------------------------
# Condómino (no contexto de um condomínio)
# ---------------------------------------------------------------------------
def delete_orphan_owners(db: Session, user_ids) -> int:
    """Apaga fichas de condóminos que ficaram sem nenhuma fração em lado nenhum e
    sem histórico ligado a eles (ocorrências, votos, pagamentos…). Quem ainda tem
    histórico fica guardado mas sem acesso a nenhum condomínio."""
    removed = 0
    for uid in set(u for u in user_ids if u):
        user = db.query(models.User).filter(models.User.id == uid).first()
        if not user or user.role != models.UserRole.owner:
            continue
        refs = [
            db.query(models.FractionOwner).filter(models.FractionOwner.user_id == uid),
            db.query(models.Occurrence).filter(models.Occurrence.reported_by == uid),
            db.query(models.OccurrenceUpdate).filter(models.OccurrenceUpdate.updated_by == uid),
            db.query(models.Vote).filter(models.Vote.cast_by_user_id == uid),
            db.query(models.Payment).filter(models.Payment.recorded_by == uid),
            db.query(models.Proxy).filter(models.Proxy.proxy_holder_user_id == uid),
            db.query(models.Document).filter(models.Document.uploaded_by == uid),
            db.query(models.Communication).filter(models.Communication.sent_by == uid),
            db.query(models.Condominium).filter(models.Condominium.admin_user_id == uid),
            db.query(models.AuditLog).filter(models.AuditLog.user_id == uid),
        ]
        if any(q.first() for q in refs):
            continue
        db.delete(user)
        removed += 1
    db.flush()
    return removed


def remove_owner_from_condo(db: Session, user_id: str, condominium_id: str) -> dict:
    """Tira o condómino de todas as frações deste condomínio. Se não lhe restar mais
    nada (outros prédios, histórico), a ficha é apagada."""
    fraction_ids = _ids(db.query(models.Fraction.id).filter(models.Fraction.condominium_id == condominium_id))
    links = db.query(models.FractionOwner).filter(
        models.FractionOwner.user_id == user_id, models.FractionOwner.fraction_id.in_(fraction_ids)
    ).count() if fraction_ids else 0
    if fraction_ids:
        db.query(models.FractionOwner).filter(
            models.FractionOwner.user_id == user_id, models.FractionOwner.fraction_id.in_(fraction_ids)
        ).delete(synchronize_session=False)
        # procurações em que era procurador neste condomínio deixam de apontar para ele
        assembly_ids = _ids(db.query(models.Assembly.id).filter(models.Assembly.condominium_id == condominium_id))
        if assembly_ids:
            db.query(models.Proxy).filter(
                models.Proxy.assembly_id.in_(assembly_ids), models.Proxy.proxy_holder_user_id == user_id
            ).update({models.Proxy.proxy_holder_user_id: None}, synchronize_session=False)
    db.flush()
    return {"fractions_unlinked": links, "user_deleted": delete_orphan_owners(db, [user_id]) == 1}


# ---------------------------------------------------------------------------
# Condomínio
# ---------------------------------------------------------------------------
def condominium_summary(db: Session, condominium_id: str) -> dict:
    fraction_ids = _ids(db.query(models.Fraction.id).filter(models.Fraction.condominium_id == condominium_id))
    return {
        "fractions": len(fraction_ids),
        "owners": db.query(models.FractionOwner.user_id).filter(
            models.FractionOwner.fraction_id.in_(fraction_ids)).distinct().count() if fraction_ids else 0,
        "quotas": db.query(models.Quota).filter(models.Quota.fraction_id.in_(fraction_ids)).count() if fraction_ids else 0,
        "occurrences": db.query(models.Occurrence).filter(models.Occurrence.condominium_id == condominium_id).count(),
        "assemblies": db.query(models.Assembly).filter(models.Assembly.condominium_id == condominium_id).count(),
        "documents": db.query(models.Document).filter(models.Document.condominium_id == condominium_id).count(),
        "expenses": db.query(models.Expense).filter(models.Expense.condominium_id == condominium_id).count(),
    }


def delete_condominium(db: Session, condo: models.Condominium) -> dict:
    cid = condo.id
    summary = condominium_summary(db, cid)
    fraction_ids = _ids(db.query(models.Fraction.id).filter(models.Fraction.condominium_id == cid))
    quota_ids = _ids(db.query(models.Quota.id).filter(models.Quota.fraction_id.in_(fraction_ids))) if fraction_ids else []
    assembly_ids = _ids(db.query(models.Assembly.id).filter(models.Assembly.condominium_id == cid))
    agenda_ids = _ids(db.query(models.AgendaItem.id).filter(models.AgendaItem.assembly_id.in_(assembly_ids))) if assembly_ids else []
    occurrence_ids = _ids(db.query(models.Occurrence.id).filter(models.Occurrence.condominium_id == cid))
    supplier_ids = _ids(db.query(models.Supplier.id).filter(models.Supplier.condominium_id == cid))
    user_ids = _ids(db.query(models.FractionOwner.user_id).filter(
        models.FractionOwner.fraction_id.in_(fraction_ids), models.FractionOwner.user_id.isnot(None))) if fraction_ids else []
    doc_refs = [r for r in _ids(db.query(models.Document.file_url).filter(models.Document.condominium_id == cid)) if is_private_ref(r)]

    def wipe(model, *conds):
        db.query(model).filter(*conds).delete(synchronize_session=False)

    if agenda_ids:
        wipe(models.Vote, models.Vote.agenda_item_id.in_(agenda_ids))
    if assembly_ids:
        wipe(models.Attendance, models.Attendance.assembly_id.in_(assembly_ids))
        wipe(models.Proxy, models.Proxy.assembly_id.in_(assembly_ids))
        wipe(models.AgendaItem, models.AgendaItem.assembly_id.in_(assembly_ids))
        wipe(models.Assembly, models.Assembly.id.in_(assembly_ids))
    if occurrence_ids:
        wipe(models.OccurrenceUpdate, models.OccurrenceUpdate.occurrence_id.in_(occurrence_ids))
        wipe(models.Occurrence, models.Occurrence.id.in_(occurrence_ids))
    if quota_ids:
        wipe(models.ReminderLog, models.ReminderLog.quota_id.in_(quota_ids))
        wipe(models.Payment, models.Payment.quota_id.in_(quota_ids))
        wipe(models.Quota, models.Quota.id.in_(quota_ids))
    wipe(models.Budget, models.Budget.condominium_id == cid)
    wipe(models.ReminderConfig, models.ReminderConfig.condominium_id == cid)
    wipe(models.LateFeeConfig, models.LateFeeConfig.condominium_id == cid)
    wipe(models.Expense, models.Expense.condominium_id == cid)
    if supplier_ids:
        wipe(models.Contract, models.Contract.supplier_id.in_(supplier_ids))
        wipe(models.Supplier, models.Supplier.id.in_(supplier_ids))
    wipe(models.Document, models.Document.condominium_id == cid)
    wipe(models.Communication, models.Communication.condominium_id == cid)
    wipe(models.AuditLog, models.AuditLog.condominium_id == cid)
    if fraction_ids:
        # votos/presenças/procurações desta fração noutros sítios (não deve haver, mas por segurança)
        wipe(models.Vote, models.Vote.fraction_id.in_(fraction_ids))
        wipe(models.Attendance, models.Attendance.fraction_id.in_(fraction_ids))
        wipe(models.Proxy, models.Proxy.fraction_id.in_(fraction_ids))
        wipe(models.FractionOwner, models.FractionOwner.fraction_id.in_(fraction_ids))
        wipe(models.Fraction, models.Fraction.id.in_(fraction_ids))
    wipe(models.Condominium, models.Condominium.id == cid)
    db.flush()
    summary["users_removed"] = delete_orphan_owners(db, user_ids)
    summary["_doc_refs"] = doc_refs  # ficheiros a apagar do Storage depois do commit
    return summary


def delete_storage_files(refs) -> None:
    for ref in refs or []:
        delete_file(ref)
