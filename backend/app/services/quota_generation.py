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
from .late_fee_engine import recompute_status


class QuotaGenerationError(Exception):
    pass


CATEGORIES = {
    "ordinaria": "Quota ordinária",
    "fundo_reserva": "Fundo comum de reserva",
    "extraordinaria": "Quota extraordinária",
    "outra": "Outra",
}
METHODS = {"orcamento", "percentagem", "permilagem", "igual", "fixo", "manual"}
FREQUENCY_MONTHS = {"mensal": 1, "trimestral": 3, "semestral": 6, "anual": 12}


def applies_in_month(ct, month_start: date) -> bool:
    """Uma rubrica recorrente entra na quota deste mês? (mensal: sempre; trimestral: de 3 em
    3 meses a contar do 1º mês de cobrança; etc.)"""
    step = FREQUENCY_MONTHS.get(ct.frequency or "mensal", 1)
    start = ct.start_month.replace(day=1) if ct.start_month else None
    if start and month_start < start:
        return False
    if step == 1:
        return True
    if not start:
        start = date(month_start.year, 1, 1)
    diff = (month_start.year - start.year) * 12 + (month_start.month - start.month)
    return diff % step == 0


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

    if ct.method == "manual":
        amounts = {}  # só pagam as frações com valor definido (mode=valor)
    elif ct.method in ("orcamento", "permilagem"):
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

    types = [t for t in ensure_default_charge_types(db, condominium_id)
             if t.active and t.recurring and applies_in_month(t, ref_month_start)]
    if not types:
        raise QuotaGenerationError("Não há rubricas ativas a cobrar neste mês. Ativa pelo menos a quota ordinária em Rubricas.")
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
        if ct.method == "orcamento" and (ct.frequency or "mensal") != "mensal":
            total = total * FREQUENCY_MONTHS.get(ct.frequency, 1)  # ex: trimestral cobra 3 meses de orçamento
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


# ---------- Repartição pelos proprietários da fração ----------
def active_links(fraction) -> list:
    today = date.today()
    return sorted((l for l in fraction.owners if l.end_date is None or l.end_date >= today), key=lambda l: l.id)


def link_name(link):
    if not link:
        return None
    if link.user:
        return link.user.full_name
    return link.invited_email


def billing_targets(fraction, mode: str = None, owner_link_id: str = None) -> list:
    """A quem se cobra esta fração → [(FractionOwner | None, parte)], com as partes a somar 1.
    Um só proprietário: paga tudo. Vários: cada um a sua quota de propriedade (split), ou
    um único responsável (single)."""
    links = active_links(fraction)
    if not links:
        return [(None, Decimal("1"))]
    if len(links) == 1:
        return [(links[0], Decimal("1"))]
    mode = mode or fraction.billing_mode or "split"
    if mode == "single":
        wanted = owner_link_id or fraction.billing_owner_link_id
        resp = next((l for l in links if l.id == wanted), None) \
            or next((l for l in links if l.is_primary_contact), None) or links[0]
        return [(resp, Decimal("1"))]
    shares = [Decimal(str(l.ownership_share or 0)) for l in links]
    total = sum(shares)
    if total <= 0:
        return [(l, Decimal("1") / len(links)) for l in links]
    return [(l, sh / total) for l, sh in zip(links, shares)]


def split_lines(flines: list, targets: list) -> list:
    """Reparte cada rubrica pelos responsáveis → [(link, [(rubrica, valor)])]; o último
    absorve o arredondamento, para a soma bater certo ao cêntimo."""
    out = [(link, []) for link, _ in targets]
    for item, amount in flines:
        running = Decimal("0")
        for i, (link, share) in enumerate(targets):
            part = _round2(amount - running) if i == len(targets) - 1 else _round2(amount * share)
            running += part
            if part > 0:
                out[i][1].append((item, part))
    return [(link, lines) for link, lines in out if lines]


def _set_lines(quota, lines):
    """lines: [((charge_type_id, name, category), valor)]"""
    quota.lines.clear()
    for i, ((ct_id, name, category), a) in enumerate(lines):
        quota.lines.append(models.QuotaLine(charge_type_id=ct_id, name=name, category=category, amount=a, position=i))
    quota.base_amount = sum((a for _, a in lines), Decimal("0"))


def _has_payments(q) -> bool:
    return float(q.amount_paid or 0) > 0 or bool(q.payments)


def _delete_quota(db, q):
    db.query(models.ReminderLog).filter(models.ReminderLog.quota_id == q.id).delete(synchronize_session=False)
    db.delete(q)


def generate_monthly_quotas(
    db: Session,
    condominium_id: str,
    reference_month: date,
    due_day: int = 8,
    force: bool = False,
) -> dict:
    """Gera a quota mensal de cada fração ativa, discriminada por rubrica e repartida pelos
    proprietários. Frações que já têm quota neste mês não são tocadas, a não ser com
    force: nesse caso os valores são recalculados (os pagamentos já registados mantêm-se)."""
    ref_month_start = reference_month.replace(day=1)

    # bloqueia o condomínio durante a geração: dois cliques seguidos não duplicam quotas
    condo = db.query(models.Condominium).filter(models.Condominium.id == condominium_id).with_for_update().first()
    if not condo:
        raise QuotaGenerationError("Condomínio não encontrado.")

    existing = (
        db.query(models.Quota)
        .join(models.Fraction)
        .filter(models.Fraction.condominium_id == condominium_id, models.Quota.reference_month == ref_month_start,
                models.Quota.kind == "regular")
        .all()
    )
    by_fraction = {}
    for q in existing:
        by_fraction.setdefault(q.fraction_id, []).append(q)

    fractions, lines, budget = compute_monthly_lines(db, condominium_id, ref_month_start)
    due_date = _due_date(ref_month_start, due_day)
    created, updated, removed, kept_fractions = [], 0, 0, []

    def new_quota(fraction, link, qlines):
        quota = models.Quota(
            fraction_id=fraction.id, budget_id=budget.id if budget else None, reference_month=ref_month_start,
            due_date=due_date, base_amount=0, status=models.QuotaStatus.pending, kind="regular",
            owner_link_id=link.id if link else None, billed_to=link_name(link),
        )
        _set_lines(quota, qlines)
        db.add(quota)
        created.append(quota)

    for fraction in fractions:
        flines = [((ct.id, ct.name, ct.category), a) for ct, a in (lines.get(fraction.id) or [])]
        wanted = split_lines(flines, billing_targets(fraction))
        ex = by_fraction.get(fraction.id, [])
        if not ex:
            for link, qlines in wanted:
                new_quota(fraction, link, qlines)
            continue
        if not force:
            continue
        # recalcular: casa as quotas existentes com os responsáveis atuais
        pairs, free = [], list(ex)
        if len(wanted) == 1 and len(ex) == 1:
            pairs, free = [(wanted[0], ex[0])], []
        else:
            for w in wanted:
                match = next((q for q in free if q.owner_link_id == (w[0].id if w[0] else None)), None)
                if match:
                    free.remove(match)
                pairs.append((w, match))
        if any(_has_payments(q) for q in free):
            # a repartição mudou e já há pagamentos nas quotas antigas: não mexe nesta fração
            kept_fractions.append(fraction.identifier)
            continue
        for q in free:
            _delete_quota(db, q)
            removed += 1
        for (link, qlines), q in pairs:
            if q is None:
                new_quota(fraction, link, qlines)
                continue
            _set_lines(q, qlines)
            q.owner_link_id = link.id if link else None
            q.billed_to = link_name(link)
            q.budget_id = budget.id if budget else q.budget_id
            if not _has_payments(q):
                q.due_date = due_date
            recompute_status(q)
            updated += 1

    if existing and not force and not created:
        db.rollback()
        return {
            "created": 0, "updated": 0,
            "skipped_existing": True,
            "existing_count": len(existing),
            "message": f"Todas as frações já têm quota mensal neste mês ({len(existing)} quotas).",
        }

    db.flush()
    grand_total = sum((Decimal(str(q.base_amount)) for q in created), Decimal("0"))
    db.add(models.AuditLog(
        condominium_id=condominium_id,
        action="quota.generated",
        entity_type="budget",
        entity_id=str(budget.id) if budget else None,
        details={"reference_month": ref_month_start.isoformat(), "count": len(created), "updated": updated,
                 "removed": removed, "total": float(grand_total)},
    ))
    db.commit()

    return {
        "created": len(created),
        "updated": updated,
        "removed": removed,
        "kept_fractions": kept_fractions,
        "existing_count": len(existing),
        "skipped_existing": False,
        "reference_month": ref_month_start.isoformat(),
        "due_date": due_date.isoformat(),
        "monthly_total": float(grand_total),
        "quota_ids": [q.id for q in created],
    }


def _create_split(db, fraction, name, category, charge_type_id, amount, ref, due_date, kind, mode=None, owner_link_id=None) -> list:
    """Cria a cobrança de uma fração, repartida pelos responsáveis."""
    out = []
    for link, qlines in split_lines([((charge_type_id, name, category), amount)], billing_targets(fraction, mode, owner_link_id)):
        quota = models.Quota(
            fraction_id=fraction.id, reference_month=ref, due_date=due_date, base_amount=0,
            status=models.QuotaStatus.pending, kind=kind, description=name,
            owner_link_id=link.id if link else None, billed_to=link_name(link),
        )
        _set_lines(quota, qlines)
        recompute_status(quota)
        db.add(quota)
        out.append(quota)
    return out


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
    if method not in ("permilagem", "igual", "fixo", "manual"):
        raise QuotaGenerationError("Forma de repartição inválida.")
    tmp = models.ChargeType(id=charge_type.id, name=name, category=charge_type.category, method=method, value=total)
    amounts = compute_charge(tmp, fractions, _overrides(db, [charge_type.id]), total=total)
    ref = reference_month.replace(day=1)
    created = []
    for f in fractions:
        a = amounts.get(f.id)
        if not a:
            continue
        created += _create_split(db, f, name, charge_type.category, charge_type.id, a, ref, due_date, "extraordinary")
    if not created:
        raise QuotaGenerationError("Todas as frações selecionadas estão isentas desta rubrica.")
    db.add(models.AuditLog(
        condominium_id=condominium_id, action="quota.extra_launched", entity_type="charge_type",
        entity_id=str(charge_type.id), details={"name": name, "count": len(created), "total": float(sum(amounts.values()))},
    ))
    db.commit()
    return {"created": len(created), "total": float(sum(amounts.values()))}


def create_invoice(db: Session, condominium_id: str, fraction, description: str, amount: Decimal,
                   due_date: date, reference_month: date = None, responsible: str = None, user_id: str = None) -> list:
    """Fatura avulsa a uma fração, com o valor indicado. responsible: None = como a fração
    está configurada; "split" = repartida pelos proprietários; ou o id do proprietário que paga tudo."""
    amount = _round2(Decimal(str(amount)))
    if amount <= 0:
        raise QuotaGenerationError("Indica o valor da fatura.")
    mode, link_id = None, None
    if responsible == "split":
        mode = "split"
    elif responsible:
        if not any(l.id == responsible for l in active_links(fraction)):
            raise QuotaGenerationError("O responsável indicado não é proprietário desta fração.")
        mode, link_id = "single", responsible
    ref = (reference_month or due_date).replace(day=1)
    created = _create_split(db, fraction, description, "outra", None, amount, ref, due_date, "invoice", mode, link_id)
    db.add(models.AuditLog(
        condominium_id=condominium_id, user_id=user_id, action="quota.invoice_created", entity_type="fraction",
        entity_id=str(fraction.id), details={"description": description, "amount": float(amount), "count": len(created)},
    ))
    db.commit()
    return created
