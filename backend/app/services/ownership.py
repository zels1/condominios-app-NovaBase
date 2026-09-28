"""Quotas de propriedade de uma fração com vários proprietários (compropriedade).

A soma das quotas dos proprietários de uma fração é sempre 1 (= 1000‰). Ao juntar um
novo proprietário, a fração é repartida: por igual, ou dando ao novo a parte indicada e
reduzindo os outros na mesma proporção. Ao retirar um, os restantes ficam com a parte dele."""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.orm import Session

from .. import models

STEP = Decimal("0.0001")  # precisão da coluna ownership_share (Numeric(5,4))


def _current_links(db: Session, fraction_id: str):
    today = date.today()
    return (
        db.query(models.FractionOwner)
        .filter(
            models.FractionOwner.fraction_id == fraction_id,
            (models.FractionOwner.end_date == None) | (models.FractionOwner.end_date >= today),  # noqa: E711
        )
        .order_by(models.FractionOwner.id)
        .all()
    )


def _assign(links, shares):
    """Grava as quotas arredondadas; o arredondamento vai para o primeiro, para somar 1."""
    rounded = [Decimal(str(s)).quantize(STEP, rounding=ROUND_HALF_UP) for s in shares]
    if rounded:
        rounded[0] += Decimal("1") - sum(rounded)
    for link, s in zip(links, rounded):
        link.ownership_share = s


def rebalance_on_add(db: Session, fraction_id: str, new_link, share=None):
    """Chamar depois de db.add(new_link) + flush. share=None → reparte por igual."""
    links = _current_links(db, fraction_id)
    if new_link not in links:
        links.append(new_link)
    others = [l for l in links if l is not new_link]
    if not others:
        new_link.ownership_share = Decimal("1")
        return
    if share is None:
        _assign(links, [Decimal("1") / len(links)] * len(links))
        return
    share = min(max(Decimal(str(share)), STEP), Decimal("1"))
    rest = Decimal("1") - share
    total_others = sum(Decimal(str(l.ownership_share or 0)) for l in others)
    if total_others <= 0:
        other_shares = [rest / len(others)] * len(others)
    else:
        other_shares = [rest * Decimal(str(l.ownership_share or 0)) / total_others for l in others]
    ordered = others + [new_link]
    _assign(ordered, other_shares + [share])


def set_share(db: Session, fraction_id: str, link, share):
    """Muda a quota de um proprietário; os outros ajustam-se proporcionalmente."""
    rebalance_on_add(db, fraction_id, link, share)


def normalize(db: Session, fraction_id: str):
    """Depois de retirar um proprietário: os restantes passam a somar 1 (proporcionalmente)."""
    links = _current_links(db, fraction_id)
    if not links:
        return
    if not any(l.is_primary_contact for l in links):
        links[0].is_primary_contact = True  # a fração fica sempre com um contacto principal
    total = sum(Decimal(str(l.ownership_share or 0)) for l in links)
    if total <= 0:
        _assign(links, [Decimal("1") / len(links)] * len(links))
    else:
        _assign(links, [Decimal(str(l.ownership_share or 0)) / total for l in links])
