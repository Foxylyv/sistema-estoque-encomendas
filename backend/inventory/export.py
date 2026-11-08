"""Geração de planilhas Excel (.xlsx) com a identidade do Sr. Grão."""

from io import BytesIO

from django.http import HttpResponse
from django.utils import timezone
from django.utils.text import slugify
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

BRAND = "5A2214"
STATUS_FILL = {"zerado": "FDE2E1", "baixo": "FFF1D6"}
STATUS_LABEL = {"normal": "Normal", "baixo": "Estoque baixo", "zerado": "Zerado"}
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _workbook(title, subtitle, headers, widths):
    wb = Workbook()
    ws = wb.active
    ws.title = title[:31]
    ws["A1"] = title
    ws["A1"].font = Font(bold=True, size=14, color=BRAND)
    ws["A2"] = subtitle
    ws["A2"].font = Font(italic=True, color="7B6A5D")
    ws.append([])
    ws.append(headers)
    for col, width in enumerate(widths, start=1):
        cell = ws.cell(row=4, column=col)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor=BRAND)
        cell.alignment = Alignment(vertical="center")
        ws.column_dimensions[get_column_letter(col)].width = width
    ws.row_dimensions[4].height = 22
    ws.freeze_panes = "A5"
    return wb, ws


def _response(wb, ws, name, establishment):
    if ws.max_row > 4:
        ws.auto_filter.ref = f"A4:{get_column_letter(ws.max_column)}{ws.max_row}"
    buf = BytesIO()
    wb.save(buf)
    stamp = timezone.localtime().strftime("%Y-%m-%d")
    filename = f"{name}-{slugify(establishment.name)}-{stamp}.xlsx"
    resp = HttpResponse(buf.getvalue(), content_type=XLSX)
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    resp["Access-Control-Expose-Headers"] = "Content-Disposition"
    return resp


def _subtitle(establishment, extra=""):
    now = timezone.localtime().strftime("%d/%m/%Y %H:%M")
    return f"{establishment.name} · gerado em {now}{extra}"


def ingredients_xlsx(rows, establishment):
    from .models import stock_status

    wb, ws = _workbook(
        "Estoque", _subtitle(establishment),
        ["Ingrediente", "Categoria", "Unidade", "Saldo", "Estoque mínimo", "Situação", "Ativo"],
        [32, 24, 10, 12, 16, 16, 8],
    )
    for i in rows:
        status = stock_status(i.stock, i.min_stock)
        ws.append([i.name, i.category.name, i.unit, float(i.stock), float(i.min_stock),
                   STATUS_LABEL[status], "Sim" if i.active else "Não"])
        if status in STATUS_FILL:
            ws.cell(row=ws.max_row, column=6).fill = PatternFill("solid", fgColor=STATUS_FILL[status])
        for col in (4, 5):
            ws.cell(row=ws.max_row, column=col).number_format = "#,##0.###"
    return _response(wb, ws, "estoque", establishment)


def movements_xlsx(rows, establishment, limited=False):
    wb, ws = _workbook(
        "Histórico de movimentações",
        _subtitle(establishment, " · limitado aos 10.000 mais recentes" if limited else ""),
        ["Data/hora", "Tipo", "Ingrediente", "Quantidade", "Unidade", "Qtd. informada",
         "Unid. informada", "Saldo antes", "Saldo após", "Valor (R$)", "Nota / fornecedor",
         "Observação", "Responsável", "Estornado"],
        [17, 15, 30, 12, 9, 14, 14, 12, 12, 12, 30, 30, 22, 10],
    )
    for m in rows:
        ws.append([
            timezone.localtime(m.created_at).replace(tzinfo=None),
            m.get_kind_display(), m.ingredient.name, float(m.quantity), m.ingredient.unit,
            float(m.input_quantity), m.input_unit, float(m.balance_before), float(m.balance_after),
            float(m.total_cost) if m.total_cost is not None else None,
            str(m.entry) if m.entry_id else "", m.notes,
            m.user.get_full_name() or m.user.username, "Sim" if m.is_reversed else "",
        ])
        r = ws.max_row
        ws.cell(row=r, column=1).number_format = "dd/mm/yyyy hh:mm"
        for col in (4, 6, 8, 9):
            ws.cell(row=r, column=col).number_format = "#,##0.###"
        ws.cell(row=r, column=10).number_format = '"R$" #,##0.00'
    return _response(wb, ws, "historico", establishment)
