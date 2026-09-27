"""Conta corrente do prédio (visível a todos os membros) e recibos de quotas em PDF."""
import calendar
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import func, extract
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..auth import get_current_user, require_condo_member, get_user_fraction_ids
from ..services.receipts import build_quota_receipt, receipt_number, MONTHS

router = APIRouter(prefix="/condominiums/{condominium_id}", tags=["Conta corrente e recibos"])


def _f(v) -> float:
    return round(float(v or 0), 2)


@router.get("/account-statement")
def account_statement(
    condominium_id: str,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Receitas (quotas recebidas, agregadas por mês — sem identificar condóminos),
    despesas (uma a uma) e saldo acumulado do prédio para o ano pedido."""
    require_condo_member(db, user, condominium_id)
    year = year or date.today().year
    start, end = date(year, 1, 1), date(year, 12, 31)

    paid_q = (
        db.query(models.Payment)
        .join(models.Quota, models.Payment.quota_id == models.Quota.id)
        .join(models.Fraction, models.Quota.fraction_id == models.Fraction.id)
        .filter(models.Fraction.condominium_id == condominium_id)
    )
    exp_q = db.query(models.Expense).filter(models.Expense.condominium_id == condominium_id)

    # Saldo transitado = tudo o que entrou menos tudo o que saiu antes deste ano
    received_before = paid_q.filter(models.Payment.paid_at < start).with_entities(func.coalesce(func.sum(models.Payment.amount), 0)).scalar()
    spent_before = exp_q.filter(models.Expense.expense_date < start).with_entities(func.coalesce(func.sum(models.Expense.amount), 0)).scalar()
    opening = _f(Decimal(received_before) - Decimal(spent_before))

    # Receitas agregadas por mês
    rows = (
        paid_q.filter(models.Payment.paid_at >= start, models.Payment.paid_at <= end)
        .with_entities(extract("month", models.Payment.paid_at), func.sum(models.Payment.amount), func.count(models.Payment.id))
        .group_by(extract("month", models.Payment.paid_at))
        .all()
    )
    received_by_month = {int(m): (total, count) for m, total, count in rows}
    suppliers = {s.id: s.name for s in db.query(models.Supplier).filter(models.Supplier.condominium_id == condominium_id)}
    expenses = exp_q.filter(models.Expense.expense_date >= start, models.Expense.expense_date <= end).all()

    movements = []
    for m, (total, count) in received_by_month.items():
        # a receita do mês aparece no último dia do mês (ou hoje, se for o mês corrente)
        month_end = date(year, m, calendar.monthrange(year, m)[1])
        movements.append({
            "date": min(month_end, date.today()).isoformat(),
            "type": "receita",
            "category": "Quotas",
            "description": f"Quotas recebidas em {MONTHS[m - 1]} ({count} pagamento{'s' if count != 1 else ''})",
            "amount": _f(total),
        })
    for e in expenses:
        movements.append({
            "date": e.expense_date.isoformat(),
            "type": "despesa",
            "category": (e.category or "Outros").capitalize(),
            "description": e.description or e.category,
            "supplier": suppliers.get(e.supplier_id),
            "amount": -_f(e.amount),
        })
    # ordem cronológica com saldo acumulado (no mesmo dia, receitas primeiro)
    movements.sort(key=lambda mv: (mv["date"], mv["type"] != "receita"))
    balance = opening
    for mv in movements:
        balance = round(balance + mv["amount"], 2)
        mv["balance"] = balance

    months = []
    for m in range(1, 13):
        rec = _f(received_by_month.get(m, (0, 0))[0])
        spent = _f(sum(float(e.amount) for e in expenses if e.expense_date.month == m))
        months.append({"month": m, "label": MONTHS[m - 1], "received": rec, "spent": spent, "net": round(rec - spent, 2)})

    total_received = _f(sum(mo["received"] for mo in months))
    total_spent = _f(sum(mo["spent"] for mo in months))

    # Dívida total do prédio (quotas vencidas por pagar), sem identificar frações
    today = date.today()
    owed = (
        db.query(func.coalesce(func.sum(models.Quota.base_amount + models.Quota.late_fee_amount - models.Quota.amount_paid), 0))
        .join(models.Fraction, models.Quota.fraction_id == models.Fraction.id)
        .filter(models.Fraction.condominium_id == condominium_id, models.Quota.due_date < today,
                models.Quota.status.notin_([models.QuotaStatus.paid, models.QuotaStatus.waived]))
        .scalar()
    )
    budget = db.query(models.Budget).filter(models.Budget.condominium_id == condominium_id, models.Budget.year == year).first()
    first_year = min(filter(None, [
        paid_q.with_entities(func.min(models.Payment.paid_at)).scalar(),
        exp_q.with_entities(func.min(models.Expense.expense_date)).scalar(),
    ]), default=date(year, 1, 1))

    return {
        "year": year,
        "first_year": first_year.year,
        "opening_balance": opening,
        "total_received": total_received,
        "total_spent": total_spent,
        "closing_balance": round(opening + total_received - total_spent, 2),
        "outstanding_debt": _f(owed),
        "budget_total": _f(budget.total_amount) if budget else None,
        "months": months,
        "movements": movements,
    }


@router.get("/quotas/{quota_id}/receipt")
def quota_receipt(
    condominium_id: str,
    quota_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Recibo em PDF de uma quota com pagamentos. O condómino só obtém os das suas frações."""
    is_admin = require_condo_member(db, user, condominium_id)
    quota = (
        db.query(models.Quota)
        .join(models.Fraction, models.Quota.fraction_id == models.Fraction.id)
        .filter(models.Quota.id == quota_id, models.Fraction.condominium_id == condominium_id)
        .first()
    )
    if not quota:
        raise HTTPException(404, "Quota não encontrada.")
    if not is_admin and quota.fraction_id not in get_user_fraction_ids(db, user):
        raise HTTPException(403, "Sem acesso a esta quota.")
    payments = db.query(models.Payment).filter(models.Payment.quota_id == quota.id).order_by(models.Payment.paid_at).all()
    if not payments:
        raise HTTPException(400, "Esta quota ainda não tem pagamentos, por isso não há recibo.")
    condo = db.query(models.Condominium).filter(models.Condominium.id == condominium_id).first()
    fraction = quota.fraction
    primary = next((o for o in fraction.owners if o.is_primary_contact and o.user), None) \
        or next((o for o in fraction.owners if o.user), None)
    owner = user if (not is_admin and any(o.user_id == user.id for o in fraction.owners)) else (primary.user if primary else None)
    pdf = build_quota_receipt(condo, fraction, owner, quota, payments)
    filename = f"recibo-{receipt_number(quota)}-{fraction.identifier}.pdf".replace(" ", "").replace("/", "-").replace("º", "")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
