"""
Geração automática de quotas mensais.

Regra legal padrão em Portugal: a quota de cada fração é o orçamento anual
aprovado, dividido por 12, e repartido por cada fração de acordo com a sua
permilagem (não é uma divisão igual entre frações).
"""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from calendar import monthrange
from sqlalchemy.orm import Session
from sqlalchemy import func

from .. import models


class QuotaGenerationError(Exception):
    pass


def _round2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def generate_monthly_quotas(
    db: Session,
    condominium_id: str,
    reference_month: date,
    due_day: int = 8,
    force: bool = False,
) -> dict:
    """Gera uma quota por cada fração ativa do condomínio, para o mês indicado.

    reference_month: qualquer data dentro do mês a faturar (usa-se o dia 1 internamente).
    due_day: dia do mês em que a quota vence.
    force: se True, apaga e regenera quotas já existentes para esse mês (usar com cautela).

    Devolve um resumo: {"created": n, "skipped_existing": bool, "quotas": [...]}
    """
    ref_month_start = reference_month.replace(day=1)

    condo = db.query(models.Condominium).filter(models.Condominium.id == condominium_id).first()
    if not condo:
        raise QuotaGenerationError("Condomínio não encontrado.")

    # Orçamento aprovado para o ano em causa
    budget = (
        db.query(models.Budget)
        .filter(models.Budget.condominium_id == condominium_id, models.Budget.year == ref_month_start.year)
        .first()
    )
    if not budget:
        raise QuotaGenerationError(
            f"Não existe orçamento aprovado para o ano {ref_month_start.year}. "
            "Cria o orçamento antes de gerar quotas."
        )

    fractions = (
        db.query(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id, models.Fraction.is_active == True)  # noqa: E712
        .all()
    )
    if not fractions:
        raise QuotaGenerationError("Este condomínio não tem frações ativas.")

    total_permilagem = sum(Decimal(str(f.permilagem)) for f in fractions)
    if total_permilagem <= 0:
        raise QuotaGenerationError("A soma das permilagens das frações é zero ou inválida.")

    # Verifica duplicados
    existing = (
        db.query(models.Quota)
        .join(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id, models.Quota.reference_month == ref_month_start)
        .all()
    )
    if existing and not force:
        return {
            "created": 0,
            "skipped_existing": True,
            "existing_count": len(existing),
            "message": (
                f"Já existem {len(existing)} quotas geradas para {ref_month_start.strftime('%B %Y')}. "
                "Usa force=true para regenerar (as existentes serão substituídas)."
            ),
        }

    if existing and force:
        for q in existing:
            db.delete(q)
        db.flush()

    monthly_total = Decimal(str(budget.total_amount)) / Decimal("12")

    # dia de vencimento seguro mesmo em meses curtos (ex: dia 31 em fevereiro)
    last_day_of_month = monthrange(ref_month_start.year, ref_month_start.month)[1]
    safe_due_day = min(due_day, last_day_of_month)
    due_date = ref_month_start.replace(day=safe_due_day)

    created_quotas = []
    running_total = Decimal("0.00")
    fractions_sorted = sorted(fractions, key=lambda f: f.id)

    for idx, fraction in enumerate(fractions_sorted):
        share = Decimal(str(fraction.permilagem)) / total_permilagem
        amount = _round2(monthly_total * share)

        # a última fração absorve o resto de arredondamento, para o somatório bater certo com o orçamento
        if idx == len(fractions_sorted) - 1:
            amount = _round2(monthly_total - running_total)
        running_total += amount

        quota = models.Quota(
            fraction_id=fraction.id,
            budget_id=budget.id,
            reference_month=ref_month_start,
            due_date=due_date,
            base_amount=amount,
            status=models.QuotaStatus.pending,
        )
        db.add(quota)
        created_quotas.append(quota)

    db.commit()

    log = models.AuditLog(
        condominium_id=condominium_id,
        action="quota.generated",
        entity_type="budget",
        entity_id=str(budget.id),
        details={
            "reference_month": ref_month_start.isoformat(),
            "count": len(created_quotas),
            "total": float(monthly_total),
        },
    )
    db.add(log)
    db.commit()

    for q in created_quotas:
        db.refresh(q)

    return {
        "created": len(created_quotas),
        "skipped_existing": False,
        "reference_month": ref_month_start.isoformat(),
        "due_date": due_date.isoformat(),
        "monthly_total": float(monthly_total),
        "quota_ids": [q.id for q in created_quotas],
    }
