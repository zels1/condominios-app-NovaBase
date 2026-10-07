"""Recibo de pagamento de quota, em PDF (reportlab, fontes base com suporte a €, ã, ç, º)."""
import io
import os
from datetime import date, datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

NAVY = colors.HexColor("#262627")
BLUE = colors.HexColor("#262627")
SIDE = colors.HexColor("#8E8E90")  # lado dos prédios no logótipo
LIGHT = colors.HexColor("#F2F2F2")
SIDE_LIGHT = colors.HexColor("#D2D2D4")
LOGO_PNG = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "domvus-logo.png")
MUTED = colors.HexColor("#667085")
LINE = colors.HexColor("#E3E6EA")

MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
          "agosto", "setembro", "outubro", "novembro", "dezembro"]


def money(v) -> str:
    s = f"{float(v or 0):,.2f}"  # 1,234.56
    return s.replace(",", " ").replace(".", ",") + " €"


def fmt_date(d) -> str:
    return d.strftime("%d/%m/%Y") if d else "—"


def receipt_number(quota) -> str:
    return f"R{quota.reference_month:%Y%m}-{quota.id.replace('-', '')[:6].upper()}"


def _logo(c, x, y, h):
    """Símbolo da Domvus como no original: quadrado azul-marinho, prédios claros com o lado azul.
    h = altura do quadrado; (x, y) = canto inferior esquerdo."""
    x = x + (h - h * 164 / 240) / 2
    s = h / 240.0

    def poly(points, color):
        p = c.beginPath()
        px, py = points[0]
        p.moveTo(x + px * s, y + (240 - py) * s)
        for px, py in points[1:]:
            p.lineTo(x + px * s, y + (240 - py) * s)
        p.close()
        c.setFillColor(color)
        c.drawPath(p, stroke=0, fill=1)

    poly([(6, 127), (53, 96), (53, 233), (6, 233)], NAVY)
    poly([(53, 96), (73, 112), (73, 233), (53, 233)], SIDE_LIGHT)
    poly([(74, 39), (120, 7), (120, 233), (74, 233)], NAVY)
    poly([(120, 7), (158, 39), (158, 233), (120, 233)], SIDE_LIGHT)


def _quota_title(quota) -> str:
    month = f"{MONTHS[quota.reference_month.month - 1]} de {quota.reference_month.year}"
    if getattr(quota, "kind", "regular") != "regular":
        return f"{quota.description or 'Quota extraordinária'} ({month})"
    return f"Quota de {month}"


def build_quota_receipt(condo, fraction, owner, quota, payments) -> bytes:
    """Recibo (se houver pagamentos) ou aviso de cobrança (se ainda não houver), sempre com a
    quota discriminada por rubrica: quota ordinária, fundo comum de reserva, etc."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    left, right = 20 * mm, W - 20 * mm
    is_receipt = bool(payments)
    number = receipt_number(quota)
    doc_title = "RECIBO" if is_receipt else "AVISO DE COBRANÇA"
    c.setTitle(f"{doc_title.capitalize()} {number} - {condo.name}")
    c.setAuthor(condo.name)

    # Cabeçalho: logótipo + nome do condomínio (emitente)
    top = H - 20 * mm
    _logo(c, left, top - 14 * mm, 14 * mm)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(left + 17 * mm, top - 6 * mm, (condo.name or "Condomínio")[:40])
    c.setFont("Helvetica", 9)
    c.setFillColor(MUTED)
    addr = ", ".join(filter(None, [condo.address, " ".join(filter(None, [condo.postal_code, condo.city]))]))
    c.drawString(left + 17 * mm, top - 11 * mm, addr or "")
    c.drawString(left + 17 * mm, top - 15 * mm, f"NIF do condomínio: {condo.nif}" if condo.nif else "")

    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 20 if is_receipt else 16)
    c.drawRightString(right, top - 6 * mm, doc_title)
    c.setFont("Helvetica", 10)
    c.setFillColor(colors.black)
    c.drawRightString(right, top - 12 * mm, f"Nº {number}")
    c.setFillColor(MUTED)
    c.drawRightString(right, top - 17 * mm, f"Emitido em {fmt_date(date.today())}")

    y = top - 28 * mm
    c.setStrokeColor(LINE)
    c.line(left, y, right, y)

    # Recebido de / Referente a
    y -= 9 * mm
    c.setFont("Helvetica", 9)
    c.setFillColor(MUTED)
    c.drawString(left, y, "RECEBEMOS DE" if is_receipt else "CONDÓMINO")
    c.drawString(W / 2, y, "REFERENTE A")
    y -= 6 * mm
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(left, y, (owner.full_name if owner else (getattr(quota, "billed_to", None) or "Condómino"))[:40])
    c.setFont("Helvetica-Bold", 11)
    c.drawString(W / 2, y, _quota_title(quota)[:48])
    c.setFont("Helvetica", 10)
    y -= 5.5 * mm
    if owner and owner.nif:
        c.drawString(left, y, f"NIF: {owner.nif}")
    c.drawString(W / 2, y, f"Fração {fraction.identifier}  ·  permilagem {float(fraction.permilagem):.3f}‰")
    y -= 5 * mm
    c.drawString(W / 2, y, f"Vencimento: {fmt_date(quota.due_date)}")

    # Discriminação por rubrica
    y -= 13 * mm

    def header_row(y, labels_right):
        c.setFillColor(colors.HexColor("#F1F1F2"))
        c.rect(left, y - 2 * mm, right - left, 8 * mm, stroke=0, fill=1)
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 9)
        for x, label in labels_right:
            c.drawString(x, y + 0.5 * mm, label)

    header_row(y, [(left + 3 * mm, "DISCRIMINAÇÃO")])
    c.drawRightString(right - 3 * mm, y + 0.5 * mm, "VALOR")
    lines = list(getattr(quota, "lines", None) or [])
    items = [(l.name, float(l.amount)) for l in lines] or [(_quota_title(quota), float(quota.base_amount))]
    if float(quota.late_fee_amount or 0) > 0:
        items.append(("Juros de mora", float(quota.late_fee_amount)))
    c.setFont("Helvetica", 10)
    c.setFillColor(colors.black)
    for name, amount in items:
        y -= 7.5 * mm
        c.drawString(left + 3 * mm, y, name[:70])
        c.drawRightString(right - 3 * mm, y, money(amount))
        c.setStrokeColor(LINE)
        c.line(left, y - 2.8 * mm, right, y - 2.8 * mm)
    total = float(quota.base_amount) + float(quota.late_fee_amount or 0)
    y -= 7.5 * mm
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(left + 3 * mm, y, "Total da quota")
    c.drawRightString(right - 3 * mm, y, money(total))

    total_paid = 0.0
    if is_receipt:
        # Pagamentos
        y -= 13 * mm
        cols = [left + 3 * mm, left + 35 * mm, left + 75 * mm]
        header_row(y, [(cols[0], "DATA DO PAGAMENTO"), (cols[1] + 12 * mm, "MEIO"), (cols[2] + 10 * mm, "REFERÊNCIA")])
        c.drawRightString(right - 3 * mm, y + 0.5 * mm, "VALOR")
        c.setFont("Helvetica", 10)
        c.setFillColor(colors.black)
        for p in payments:
            y -= 7.5 * mm
            c.drawString(cols[0], y, fmt_date(p.paid_at))
            c.drawString(cols[1] + 12 * mm, y, (p.method or "").capitalize())
            c.drawString(cols[2] + 10 * mm, y, (p.reference or "—")[:28])
            c.drawRightString(right - 3 * mm, y, money(p.amount))
            total_paid += float(p.amount)
            c.setStrokeColor(LINE)
            c.line(left, y - 2.8 * mm, right, y - 2.8 * mm)

    # Resumo
    y -= 12 * mm
    summary = [("Total da quota", money(total))]
    if is_receipt:
        summary.append(("Total pago", money(total_paid)))
    summary.append(("Em dívida", money(max(0.0, total - total_paid))))
    for label, value in summary:
        bold = label == ("Total pago" if is_receipt else "Em dívida")
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 12 if bold else 10)
        c.setFillColor(NAVY if bold else colors.black)
        c.drawString(right - 85 * mm, y, label)
        c.drawRightString(right - 3 * mm, y, value)
        y -= 7 * mm

    if is_receipt:
        status = "PAGA" if total_paid >= total - 0.005 else "PAGAMENTO PARCIAL"
        c.setFillColor(BLUE if status == "PAGA" else colors.HexColor("#B8860B"))
    else:
        status = "POR PAGAR"
        c.setFillColor(colors.HexColor("#B8860B"))
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y + 7 * mm, f"Estado: {status}")

    if not is_receipt and getattr(condo, "iban", None):
        c.setFont("Helvetica", 10)
        c.setFillColor(colors.black)
        c.drawString(left, y - 4 * mm, f"Pagamento por transferência para o IBAN {condo.iban}")
        c.drawString(left, y - 9 * mm, f"Indique na descrição: Fração {fraction.identifier} — {_quota_title(quota)}"[:95])

    # Rodapé
    c.setStrokeColor(LINE)
    c.line(left, 30 * mm, right, 30 * mm)
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    c.drawString(left, 25 * mm, "Documento comprovativo do pagamento da quota de condomínio acima indicada." if is_receipt
                 else "Aviso de cobrança da quota de condomínio acima indicada. Não serve de recibo.")
    c.drawString(left, 21 * mm, f"Emitido através da plataforma Domvus em {datetime.now():%d/%m/%Y %H:%M}.")
    try:  # logótipo Domvus no rodapé
        lh = 8 * mm
        c.drawImage(LOGO_PNG, right - lh * 720 / 212, 19.5 * mm, width=lh * 720 / 212, height=lh, mask="auto")
    except Exception:
        pass
    c.showPage()
    c.save()
    return buf.getvalue()
