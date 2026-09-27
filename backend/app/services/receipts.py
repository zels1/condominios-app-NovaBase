"""Recibo de pagamento de quota, em PDF (reportlab, fontes base com suporte a €, ã, ç, º)."""
import io
from datetime import date, datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

NAVY = colors.HexColor("#0D274C")
BLUE = colors.HexColor("#2B507C")
LIGHT = colors.HexColor("#F2F2F2")
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
    c.setFillColor(NAVY)
    c.roundRect(x, y, h, h, h * 0.18, stroke=0, fill=1)
    pad = h * 0.18
    x, y, h = x + (h - (h - 2 * pad) * 164 / 240) / 2, y + pad, h - 2 * pad
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

    poly([(6, 127), (53, 96), (53, 233), (6, 233)], LIGHT)
    poly([(53, 96), (73, 112), (73, 233), (53, 233)], BLUE)
    poly([(74, 39), (120, 7), (120, 233), (74, 233)], LIGHT)
    poly([(120, 7), (158, 39), (158, 233), (120, 233)], BLUE)


def build_quota_receipt(condo, fraction, owner, quota, payments) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    left, right = 20 * mm, W - 20 * mm
    number = receipt_number(quota)
    c.setTitle(f"Recibo {number} - {condo.name}")
    c.setAuthor(condo.name)

    # Cabeçalho: logótipo + nome do condomínio (emitente)
    top = H - 20 * mm
    _logo(c, left, top - 14 * mm, 14 * mm)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(left + 17 * mm, top - 6 * mm, condo.name or "Condomínio")
    c.setFont("Helvetica", 9)
    c.setFillColor(MUTED)
    addr = ", ".join(filter(None, [condo.address, " ".join(filter(None, [condo.postal_code, condo.city]))]))
    c.drawString(left + 17 * mm, top - 11 * mm, addr or "")
    c.drawString(left + 17 * mm, top - 15 * mm, f"NIF do condomínio: {condo.nif}" if condo.nif else "")

    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 20)
    c.drawRightString(right, top - 6 * mm, "RECIBO")
    c.setFont("Helvetica", 10)
    c.setFillColor(colors.black)
    c.drawRightString(right, top - 12 * mm, f"Nº {number}")
    c.setFillColor(MUTED)
    c.drawRightString(right, top - 17 * mm, f"Emitido em {fmt_date(date.today())}")

    y = top - 28 * mm
    c.setStrokeColor(LINE)
    c.line(left, y, right, y)

    # Recebido de
    y -= 9 * mm
    c.setFont("Helvetica", 9)
    c.setFillColor(MUTED)
    c.drawString(left, y, "RECEBEMOS DE")
    c.drawString(W / 2, y, "REFERENTE A")
    y -= 6 * mm
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(left, y, (owner.full_name if owner else "Condómino")[:48])
    c.drawString(W / 2, y, f"Quota de {MONTHS[quota.reference_month.month - 1]} de {quota.reference_month.year}")
    c.setFont("Helvetica", 10)
    y -= 5.5 * mm
    if owner and owner.nif:
        c.drawString(left, y, f"NIF: {owner.nif}")
    c.drawString(W / 2, y, f"Fração {fraction.identifier}  ·  permilagem {float(fraction.permilagem):.3f}‰")
    y -= 5 * mm
    c.drawString(W / 2, y, f"Vencimento: {fmt_date(quota.due_date)}")

    # Tabela de pagamentos
    y -= 14 * mm
    c.setFillColor(colors.HexColor("#F3F5F8"))
    c.rect(left, y - 2 * mm, right - left, 8 * mm, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 9)
    cols = [left + 3 * mm, left + 35 * mm, left + 75 * mm]
    c.drawString(cols[0], y + 0.5 * mm, "DATA")
    c.drawString(cols[1], y + 0.5 * mm, "MEIO DE PAGAMENTO")
    c.drawString(cols[2], y + 0.5 * mm, "REFERÊNCIA")
    c.drawRightString(right - 3 * mm, y + 0.5 * mm, "VALOR")
    c.setFont("Helvetica", 10)
    c.setFillColor(colors.black)
    total_paid = 0
    for p in payments:
        y -= 8 * mm
        c.drawString(cols[0], y, fmt_date(p.paid_at))
        c.drawString(cols[1], y, (p.method or "").capitalize())
        c.drawString(cols[2], y, (p.reference or "—")[:30])
        c.drawRightString(right - 3 * mm, y, money(p.amount))
        total_paid += float(p.amount)
        c.setStrokeColor(LINE)
        c.line(left, y - 3 * mm, right, y - 3 * mm)

    # Resumo
    y -= 12 * mm
    summary = [
        ("Valor da quota", money(quota.base_amount)),
        ("Juros de mora", money(quota.late_fee_amount) if float(quota.late_fee_amount or 0) > 0 else "—"),
        ("Total pago", money(total_paid)),
        ("Em dívida", money(max(0.0, float(quota.base_amount) + float(quota.late_fee_amount or 0) - total_paid))),
    ]
    for i, (label, value) in enumerate(summary):
        bold = label == "Total pago"
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 12 if bold else 10)
        c.setFillColor(NAVY if bold else colors.black)
        c.drawString(right - 85 * mm, y, label)
        c.drawRightString(right - 3 * mm, y, value)
        y -= 7 * mm

    status = "PAGA" if total_paid >= float(quota.base_amount) + float(quota.late_fee_amount or 0) - 0.005 else "PAGAMENTO PARCIAL"
    c.setFillColor(colors.HexColor("#2B507C") if status == "PAGA" else colors.HexColor("#B8860B"))
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y + 7 * mm, f"Estado: {status}")

    # Rodapé
    c.setStrokeColor(LINE)
    c.line(left, 30 * mm, right, 30 * mm)
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    c.drawString(left, 25 * mm, "Documento comprovativo do pagamento da quota de condomínio acima indicada.")
    c.drawString(left, 21 * mm, f"Emitido através da plataforma Domvus em {datetime.now():%d/%m/%Y %H:%M}.")
    c.showPage()
    c.save()
    return buf.getvalue()
