"""Manutenção do prédio (separada das ocorrências reportadas pelos condóminos):
- preventiva: tarefas periódicas (extintores, inspeção/manutenção de elevadores, limpeza…),
  com próxima data calculada a partir da periodicidade;
- corretiva: reparações pontuais.
O administrador gere tudo; os condóminos podem consultar."""
import calendar
from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin, require_condo_member

router = APIRouter(prefix="/condominiums/{condominium_id}/maintenance", tags=["Manutenção"])

CATEGORIES = {
    "extintores": "Extintores",
    "elevador": "Elevadores",
    "limpeza": "Limpeza",
    "jardinagem": "Jardinagem",
    "canalizacao": "Canalização",
    "eletricidade": "Eletricidade",
    "gas": "Gás",
    "desinfestacao": "Desinfestação",
    "portao": "Portão / garagem",
    "outro": "Outro",
}
KINDS = {"preventiva", "corretiva"}
FREQUENCY_MONTHS = {
    "unica": None,
    "semanal": 0,  # tratado à parte (7 dias)
    "mensal": 1,
    "trimestral": 3,
    "semestral": 6,
    "anual": 12,
    "bienal": 24,
}


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def next_due_after(done: date, frequency: str):
    if frequency == "semanal":
        from datetime import timedelta
        return done + timedelta(days=7)
    months = FREQUENCY_MONTHS.get(frequency)
    return add_months(done, months) if months else None


def _validate(db: Session, condominium_id: str, payload: schemas.MaintenanceTaskCreate):
    if payload.category not in CATEGORIES:
        raise HTTPException(400, "Categoria inválida.")
    if payload.kind not in KINDS:
        raise HTTPException(400, "Tipo inválido: usa preventiva ou corretiva.")
    if payload.frequency not in FREQUENCY_MONTHS:
        raise HTTPException(400, "Periodicidade inválida.")
    if payload.supplier_id:
        ok = db.query(models.Supplier).filter(
            models.Supplier.id == payload.supplier_id, models.Supplier.condominium_id == condominium_id
        ).first()
        if not ok:
            raise HTTPException(400, "Fornecedor não encontrado neste condomínio.")
    if payload.estimated_cost is not None and payload.estimated_cost < 0:
        raise HTTPException(400, "O custo não pode ser negativo.")


def _get_task(db: Session, condominium_id: str, task_id: str) -> models.MaintenanceTask:
    task = db.query(models.MaintenanceTask).filter(
        models.MaintenanceTask.id == task_id, models.MaintenanceTask.condominium_id == condominium_id
    ).first()
    if not task:
        raise HTTPException(404, "Manutenção não encontrada.")
    return task


def _out(db: Session, tasks: list) -> list:
    sup_ids = {t.supplier_id for t in tasks if t.supplier_id}
    names = dict(db.query(models.Supplier.id, models.Supplier.name).filter(models.Supplier.id.in_(sup_ids)).all()) if sup_ids else {}
    result = []
    for t in tasks:
        o = schemas.MaintenanceTaskOut.model_validate(t)
        o.supplier_name = names.get(t.supplier_id)
        result.append(o)
    return result


@router.get("/options")
def options(condominium_id: str):
    return {
        "categories": CATEGORIES,
        "frequencies": list(FREQUENCY_MONTHS.keys()),
    }


@router.get("", response_model=List[schemas.MaintenanceTaskOut])
def list_tasks(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    require_condo_member(db, user, condominium_id)
    tasks = (
        db.query(models.MaintenanceTask)
        .filter(models.MaintenanceTask.condominium_id == condominium_id)
        .order_by(models.MaintenanceTask.next_due.is_(None), models.MaintenanceTask.next_due, models.MaintenanceTask.title)
        .all()
    )
    return _out(db, tasks)


@router.post("", response_model=schemas.MaintenanceTaskOut)
def create_task(condominium_id: str, payload: schemas.MaintenanceTaskCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    _validate(db, condominium_id, payload)
    data = payload.model_dump()
    data["title"] = data["title"].strip()
    if not data["next_due"] and data["last_done"]:
        data["next_due"] = next_due_after(data["last_done"], data["frequency"])
    task = models.MaintenanceTask(condominium_id=condominium_id, **data)
    db.add(task)
    db.commit()
    db.refresh(task)
    return _out(db, [task])[0]


@router.put("/{task_id}", response_model=schemas.MaintenanceTaskOut)
def update_task(condominium_id: str, task_id: str, payload: schemas.MaintenanceTaskCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    task = _get_task(db, condominium_id, task_id)
    _validate(db, condominium_id, payload)
    for k, v in payload.model_dump().items():
        setattr(task, k, v.strip() if k == "title" else v)
    db.commit()
    db.refresh(task)
    return _out(db, [task])[0]


@router.delete("/{task_id}")
def delete_task(condominium_id: str, task_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    task = _get_task(db, condominium_id, task_id)
    db.delete(task)  # os registos (logs) vão com ela; as despesas criadas ficam
    db.commit()
    return {"ok": True}


@router.post("/{task_id}/done", response_model=schemas.MaintenanceTaskOut)
def mark_done(condominium_id: str, task_id: str, payload: schemas.MaintenanceDone, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    """Regista que a manutenção foi feita. Nas periódicas calcula a próxima data;
    nas únicas/corretivas fica concluída (sem próxima data). Opcionalmente lança a despesa."""
    task = _get_task(db, condominium_id, task_id)
    if payload.cost is not None and payload.cost < 0:
        raise HTTPException(400, "O custo não pode ser negativo.")
    expense_id = None
    if payload.register_expense:
        if not payload.cost:
            raise HTTPException(400, "Indica o custo para lançar a despesa.")
        expense = models.Expense(
            condominium_id=condominium_id,
            supplier_id=task.supplier_id,
            category=CATEGORIES.get(task.category, "Manutenção"),
            description=f"Manutenção: {task.title}",
            amount=payload.cost,
            expense_date=payload.done_at,
        )
        db.add(expense)
        db.flush()
        expense_id = expense.id
    db.add(models.MaintenanceLog(
        task_id=task.id, done_at=payload.done_at, cost=payload.cost,
        notes=(payload.notes or "").strip() or None, expense_id=expense_id, created_by=user.id,
    ))
    if not task.last_done or payload.done_at >= task.last_done:
        task.last_done = payload.done_at
        task.next_due = next_due_after(payload.done_at, task.frequency)
    db.commit()
    db.refresh(task)
    return _out(db, [task])[0]


@router.get("/{task_id}/logs", response_model=List[schemas.MaintenanceLogOut])
def list_logs(condominium_id: str, task_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    require_condo_member(db, user, condominium_id)
    task = _get_task(db, condominium_id, task_id)
    return (
        db.query(models.MaintenanceLog)
        .filter(models.MaintenanceLog.task_id == task.id)
        .order_by(models.MaintenanceLog.done_at.desc(), models.MaintenanceLog.created_at.desc())
        .all()
    )


@router.delete("/{task_id}/logs/{log_id}")
def delete_log(condominium_id: str, task_id: str, log_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    task = _get_task(db, condominium_id, task_id)
    log = db.query(models.MaintenanceLog).filter(models.MaintenanceLog.id == log_id, models.MaintenanceLog.task_id == task.id).first()
    if not log:
        raise HTTPException(404, "Registo não encontrado.")
    db.delete(log)
    db.flush()
    # recalcula a última execução a partir do histórico que sobra
    last = (
        db.query(models.MaintenanceLog.done_at)
        .filter(models.MaintenanceLog.task_id == task.id)
        .order_by(models.MaintenanceLog.done_at.desc())
        .first()
    )
    task.last_done = last[0] if last else None
    if last:
        task.next_due = next_due_after(last[0], task.frequency)
    db.commit()
    return {"ok": True}
