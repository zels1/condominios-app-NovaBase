"""
Motor de lembretes automáticos de pagamento em atraso.

Para cada condomínio, o admin configura uma lista de "degraus"
(ex: 7, 15, 30 dias após o vencimento). Este motor verifica, para cada
quota em atraso, se já passou algum desses degraus e ainda não foi
enviado o lembrete correspondente — evitando duplicados através do
ReminderLog (restrição de unicidade quota+config na base de dados).
"""
from datetime import date, datetime
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from .. import models


def _render_template(template: str, quota: models.Quota) -> str:
    mes = quota.reference_month.strftime("%B %Y")
    valor = f"{quota.total_due:.2f}"
    return template.replace("{mes}", mes).replace("{valor}", valor)


def run_reminders_for_condominium(db: Session, condominium_id: str, as_of: date = None) -> dict:
    as_of = as_of or date.today()

    steps = (
        db.query(models.ReminderConfig)
        .filter(models.ReminderConfig.condominium_id == condominium_id, models.ReminderConfig.enabled == True)  # noqa: E712
        .order_by(models.ReminderConfig.days_after_due)
        .all()
    )
    if not steps:
        return {"queued": 0, "message": "Sem lembretes configurados para este condomínio."}

    overdue_quotas = (
        db.query(models.Quota)
        .join(models.Fraction)
        .filter(
            models.Fraction.condominium_id == condominium_id,
            models.Quota.status.in_([models.QuotaStatus.pending, models.QuotaStatus.overdue]),
        )
        .all()
    )

    queued = []
    for quota in overdue_quotas:
        days_overdue = (as_of - quota.due_date).days
        if days_overdue <= 0:
            continue

        # aplica o degrau mais alto já atingido que ainda não foi enviado
        for step in steps:
            if days_overdue < step.days_after_due:
                continue
            already_sent = (
                db.query(models.ReminderLog)
                .filter(models.ReminderLog.quota_id == quota.id, models.ReminderLog.reminder_config_id == step.id)
                .first()
            )
            if already_sent:
                continue

            entry = models.ReminderLog(
                quota_id=quota.id,
                reminder_config_id=step.id,
                channel=step.channel,
                delivery_status="queued",
                sent_at=datetime.utcnow(),
            )
            db.add(entry)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
                continue
            queued.append({
                "quota_id": quota.id,
                "step_days": step.days_after_due,
                "message": _render_template(step.message_template, quota),
            })

    db.commit()
    if queued:
        log = models.AuditLog(
            condominium_id=condominium_id,
            action="reminder.queued",
            entity_type="quota",
            details={"count": len(queued)},
        )
        db.add(log)
        db.commit()

    return {"queued": len(queued), "reminders": queued}


def mark_reminder_sent(db: Session, reminder_log_id: str, success: bool = True) -> models.ReminderLog:
    entry = db.query(models.ReminderLog).filter(models.ReminderLog.id == reminder_log_id).first()
    if not entry:
        raise ValueError("Registo de lembrete não encontrado.")
    entry.delivery_status = "sent" if success else "failed"
    db.commit()
    db.refresh(entry)
    return entry
