"""
Geração de quotas, discriminadas por rubrica.

Cada condomínio tem rubricas configuráveis (models.ChargeType):
- Quota ordinária — por defeito, orçamento anual ÷ 12 repartido por permilagem
  (regra legal em Portugal: não é uma divisão igual entre frações);
- Fundo comum de reserva — por defeito, 10% da quota ordinária de cada fração
  (mínimo legal);
- outras rubricas periódicas (ex: seguro, elevador) e rubricas pontuais, como as
  quotas extraordinárias, lançadas à parte.
Cada rubrica pode ser configurada individualmente por fração (isenta, ou valor próprio).
"""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from calendar import monthrange
from sqlalchemy.orm import Session

from .. import models


class QuotaGenerationError(Exception):
    pass


CATEGORIES = {
    "ordinaria": "Quota ordinária",
    "fundo_reserva": "Fundo comum de reserva",
    "extraordinaria": "Quota extraordinária",
    "outra": "Outra",
}
METHODS = {"orcamento", "percentagem", "permilagem", "igual", "fixo"}


def _round2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def ensure_default_charge_types(db: Session, condominium_id: str) -> list:
    """Na primeira utilização cria as rubricas legais: quota ordinária e fundo de reserva."""
    types = (
        db.query(models.ChargeType)
        .filter(models.ChargeType.condominium_id == condominium_id)
        .order_by(models.ChargeType.position, models.ChargeType.created_at)
        .all()
    )
    if types:
        return types
    budget = (
        db.query(models.Budget)
        .filter(models.Budget.condominium_id == condominium_id)
        .order_by(models.Budget.year.desc())
        .first()
    )
    reserve = Decimal(str(budget.reserve_fund_percent)) if budget and budget.reserve_fund_percent is not None else Decimal("10")
    types = [
        models.ChargeType(condominium_id=condominium_id, name="Quota ordinária", category="ordinaria",
                          method="orcamento", value=0, recurring=True, active=True, position=0),
        models.ChargeType(condominium_id=condominium_id, name="Fundo comum de reserva", category="fundo_reserva",
                          method="percentagem", value=reserve, recurring=True, active=True, position=1),
    ]
    db.add_all(types)
    db.flush()
    return types


def _overrides(db: Session, charge_type_ids) -> dict:
    """{(fraction_id, charge_type_id): FractionCharge}"""
    if not charge_type_ids:
        return {}
    rows = db.query(models.FractionCharge).filter(models.FractionCharge.charge_type_id.in_(list(charge_type_ids))).all()
    return {(r.fraction_id, r.charge_type_id): r for r in rows}


def _distribute(total: Decimal, fractions: list, weight) -> dict:
    """Reparte total pelas frações segundo weight(f); a última absorve o arredondamento."""
    weights = [Decimal(str(weight(f))) for f in fractions]
    s = sum(weights)
    result = {}
    if not fractions or s <= 0:
        return result
    running = Decimal("0")
    for i, f in enumerate(fractions):
        if i == len(fractions) - 1:
            amount = _round2(total - running)
        else:
            amount = _round2(total * weights[i] / s)
        running += amount
        result[f.id] = amount
    return result


def compute_charge(ct: models.ChargeType, fractions: list, overrides: dict, total: Decimal = None,
                   ordinary_by_fraction: dict = None) -> dict:
    """Valor desta rubrica para cada fração → {fraction_id: Decimal}. Frações isentas ficam de fora
    (a parte delas é repartida pelas restantes); com valor próprio pagam esse valor."""
    exempt = {f.id for f in fractions if (o := overrides.get((f.id, ct.id))) and o.mode == "isento"}
    fixed = {f.id: Decimal(str(o.amount or 0)) for f in fractions
             if (o := overrides.get((f.id, ct.id))) and o.mode == "valor"}
    normal = [f for f in fractions if f.id not in exempt and f.id not in fixed]
    value = Decimal(str(total if total is not None else (ct.value or 0)))

    if ct.method in ("orcamento", "permilagem"):
        amounts = _distribute(value, normal, lambda f: f.permilagem)
    elif ct.method == "igual":
        amounts = _distribute(value, normal, lambda f: 1)
    elif ct.method == "fixo":
        amounts = {f.id: _round2(value) for f in normal}
    elif ct.method == "percentagem":
        base = ordinary_by_fraction or {}
        amounts = {f.id: _round2(base.get(f.id, Decimal("0")) * value / Decimal("100")) for f in normal}
    else:
        raise QuotaGenerationError(f"Método de cálculo desconhecido na rubrica {ct.name}.")
    amounts.update({fid: _round2(v) for fid, v in fixed.items()})
    return {fid: v for fid, v in amounts.items() if v > 0}


def compute_monthly_lines(db: Session, condominium_id: str, ref_month_start: date):
    """Calcula (sem gravar) as linhas da quota mensal de cada fração.
    Devolve (fractions, {fraction_id: [(ChargeType, Decimal)]}, budget)."""
    fractions = (
        db.query(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id, models.Fraction.is_active == True)  # noqa: E712
        .order_by(models.Fraction.id)
        .all()
    )
    if not fractions:
        raise QuotaGenerationError("Este condomínio não tem frações ativas.")
    if sum(Decimal(str(f.permilagem)) for f in fractions) <= 0:
        raise QuotaGenerationError("A soma das permilagens das frações é zero ou inválida.")

    types = [t for t in ensure_default_charge_types(db, condominium_id) if t.active and t.recurring]
    if not types:
        raise QuotaGenerationError("Não há rubricas mensais ativas. Ativa pelo menos a quota ordinária em Rubricas.")
    overrides = _overrides(db, [t.id for t in types])

    budget = None
    if any(t.method == "orcamento" for t in types):
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

    lines = {f.id: [] for f in fractions}
    ordinary = {f.id: Decimal("0") for f in fractions}
    # primeiro as rubricas de valor direto; as percentagens usam a quota ordinária já calculada
    for ct in sorted(types, key=lambda t: (t.method == "percentagem", t.position or 0)):
        total = Decimal(str(budget.total_amount)) / Decimal("12") if ct.method == "orcamento" else None
        amounts = compute_charge(ct, fractions, overrides, total=total, ordinary_by_fraction=ordinary)
        for fid, amount in amounts.items():
            lines[fid].append((ct, amount))
            if ct.category == "ordinaria":
                ordinary[fid] += amount
    for fid in lines:
        lines[fid].sort(key=lambda pair: pair[0].position or 0)
    return fractions, lines, budget


def _due_date(ref_month_start: date, due_day: int) -> date:
    last_day = monthrange(ref_month_start.year, ref_month_start.month)[1]
    return ref_month_start.replace(day=min(max(int(due_day or 1), 1), last_day))


def generate_monthly_quotas(
    db: Session,
    condominium_id: str,
    reference_month: date,
    due_day: int = 8,
    force: bool = False,
) -> dict:
    """Gera a quota mensal de cada fração ativa, discriminada por rubrica.
    force: apaga e regenera as quotas mensais já existentes para esse mês."""
    ref_month_start = reference_month.replace(day=1)

    condo = db.query(models.Condominium).filter(models.Condominium.id == condominium_id).first()
    if not condo:
        raise QuotaGenerationError("Condomínio não encontrado.")

    existing = (
        db.query(models.Quota)
        .join(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id, models.Quota.reference_month == ref_month_start,
                models.Quota.kind == "regular")
        .all()
    )
    if existing and not force:
        return {
            "created": 0,
            "skipped_existing": True,
            "existing_count": len(existing),
            "message": f"Já existem {len(existing)} quotas mensais geradas para este mês.",
        }

    fractions, lines, budget = compute_monthly_lines(db, condominium_id, ref_month_start)

    paid = [q for q in existing if float(q.amount_paid or 0) > 0 or q.payments]
    if paid and force:
        raise QuotaGenerationError(
            f"{len(paid)} das quotas deste mês já têm pagamentos registados: não é possível substituí-las."
        )
    if existing and force:
        for q in existing:
            db.query(models.ReminderLog).filter(models.ReminderLog.quota_id == q.id).delete(synchronize_session=False)
        for q in existing:
            db.delete(q)
        db.flush()

    due_date = _due_date(ref_month_start, due_day)
    created = []
    grand_total = Decimal("0")
    for fraction in fractions:
        flines = lines.get(fraction.id) or []
        amount = sum((a for _, a in flines), Decimal("0"))
        if amount <= 0:
            continue
        quota = models.Quota(
            fraction_id=fraction.id,
            budget_id=budget.id if budget else None,
            reference_month=ref_month_start,
            due_date=due_date,
            base_amount=amount,
            status=models.QuotaStatus.pending,
            kind="regular",
        )
        for i, (ct, a) in enumerate(flines):
            quota.lines.append(models.QuotaLine(charge_type_id=ct.id, name=ct.name, category=ct.category, amount=a, position=i))
        db.add(quota)
        created.append(quota)
        grand_total += amount

    db.add(models.AuditLog(
        condominium_id=condominium_id,
        action="quota.generated",
        entity_type="budget",
        entity_id=str(budget.id) if budget else None,
        details={"reference_month": ref_month_start.isoformat(), "count": len(created), "total": float(grand_total)},
    ))
    db.commit()

    return {
        "created": len(created),
        "skipped_existing": False,
        "reference_month": ref_month_start.isoformat(),
        "due_date": due_date.isoformat(),
        "monthly_total": float(grand_total),
        "quota_ids": [q.id for q in created],
    }


def launch_extra_quota(
    db: Session,
    condominium_id: str,
    charge_type: models.ChargeType,
    name: str,
    total: Decimal,
    method: str,
    reference_month: date,
    due_date: date,
    fraction_ids=None,
) -> dict:
    """Lança uma quota à parte (ex: extraordinária para obras) para todas as frações ou
    só para as indicadas, respeitando a configuração individual de cada fração."""
    q = db.query(models.Fraction).filter(models.Fraction.condominium_id == condominium_id, models.Fraction.is_active == True)  # noqa: E712
    if fraction_ids:
        q = q.filter(models.Fraction.id.in_(fraction_ids))
    fractions = q.order_by(models.Fraction.id).all()
    if not fractions:
        raise QuotaGenerationError("Nenhuma fração selecionada.")
    if method not in ("permilagem", "igual", "fixo"):
        raise QuotaGenerationError("Forma de repartição inválida.")
    tmp = models.ChargeType(id=charge_type.id, name=name, category=charge_type.category, method=method, value=total)
    amounts = compute_charge(tmp, fractions, _overrides(db, [charge_type.id]), total=total)
    ref = reference_month.replace(day=1)
    created = []
    for f in fractions:
        a = amounts.get(f.id)
        if not a:
            continue
        quota = models.Quota(
            fraction_id=f.id, reference_month=ref, due_date=due_date, base_amount=a,
            status=models.QuotaStatus.pending, kind="extraordinary", description=name,
        )
        quota.lines.append(models.QuotaLine(charge_type_id=charge_type.id, name=name, category=charge_type.category, amount=a, position=0))
        db.add(quota)
        created.append(quota)
    if not created:
        raise QuotaGenerationError("Todas as frações selecionadas estão isentas desta rubrica.")
    db.add(models.AuditLog(
        condominium_id=condominium_id, action="quota.extra_launched", entity_type="charge_type",
        entity_id=str(charge_type.id), details={"name": name, "count": len(created), "total": float(sum(amounts.values()))},
    ))
    db.commit()
    return {"created": len(created), "total": float(sum(amounts.values()))}
