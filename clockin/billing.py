"""Timesheet (xlsx) and invoice (pdf) generation, in memory.
Sender details, currency and avatar come from settings; nothing personal lives here.
"""

import math
import io
from datetime import datetime
from pathlib import Path

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter
import fpdf
from fpdf import FPDF


class MissingDependency(RuntimeError):
    """Invoices need fpdf2; the older PyFPDF would silently print the PDF to stdout."""


# The PDF uses the built-in Helvetica, which only covers Latin-1. Swap the usual suspects for safe
# look-alikes instead of failing the whole invoice (e.g. a "€" currency, curly quotes, an em dash).
_SWAPS = {"€": "EUR ", "—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "•": "-", "\u00a0": " "}


def _latin(text):
    text = "".join(_SWAPS.get(ch, ch) for ch in str(text))
    return text.encode("latin-1", "replace").decode("latin-1")


class _PDF(FPDF):
    def normalize_text(self, text):
        return super().normalize_text(_latin(text))


def _need_fpdf2():
    major = str(getattr(fpdf, "__version__", "0")).split(".")[0]
    if not major.isdigit() or int(major) < 2:
        raise MissingDependency("Invoices need the fpdf2 package: pip install fpdf2 (found the old PyFPDF).")

# ─── Helpers ──────────────────────────────────────────────────────────────────
def hours_to_hhmm(h):
    if not h or math.isnan(h) or h == 0:
        return "0 hr 0 min"
    total_min = int(round(h * 60))
    return f"{total_min // 60} hr {total_min % 60} min"

def parse_duration(val):
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    val = str(val).strip()
    if "hr" in val:
        parts = val.replace("hr", "").replace("min", "").split()
        return float(parts[0] if parts else 0) + float(parts[1] if len(parts) > 1 else 0) / 60
    if ":" in val:
        p = val.split(":")
        return float(p[0]) + float(p[1]) / 60
    try:
        return float(val)
    except Exception:
        return 0.0

def week_of_month(date_str):
    """ceil(day / 7) — consistent with Notion workflow."""
    try:
        day = int(str(date_str)[8:10])
        return math.ceil(day / 7)
    except Exception:
        return 1

# ─── Timesheet ────────────────────────────────────────────────────────────────
HEADER_GREEN = "1A3D2B"
WHITE        = "FFFFFF"

def make_timesheet(rows, month_name, year):
    """
    rows: list of dicts with keys matching the timesheet columns.
    Returns xlsx bytes.
    """
    df = pd.DataFrame(rows)
    df["_dur"] = df["Duration (hours)"].apply(parse_duration)
    df = df.sort_values("Week", ascending=False).reset_index(drop=True)

    wb = Workbook()
    ws = wb.active
    ws.title = month_name

    hdr_fill   = PatternFill("solid", fgColor=HEADER_GREEN)
    hdr_font   = Font(name="Roboto", bold=True, color=WHITE, size=10)
    alt_fill   = PatternFill("solid", fgColor="F5F5F5")
    norm_font  = Font(name="Roboto", size=10)
    center     = Alignment(horizontal="center", vertical="center")
    left       = Alignment(horizontal="left",   vertical="center")
    thin       = Side(style="thin", color="CCCCCC")
    border     = Border(left=thin, right=thin, top=thin, bottom=thin)

    headers   = ["#", "Week", "Description", "Project", "Observations",
                 "Area", "Operation", "Start Time", "End time",
                 "Duration II", "Duration (hours)", "Link"]
    col_widths = [4, 6, 28, 24, 30, 14, 16, 22, 22, 14, 16, 40]

    for i, (h, w) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=1, column=i, value=h)
        cell.fill = hdr_fill; cell.font = hdr_font
        cell.alignment = center; cell.border = border
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 22

    for idx, row in df.iterrows():
        r   = idx + 2
        dur = row["_dur"]
        vals = [
            idx + 1,
            row.get("Week", ""),
            row.get("Description", ""),
            row.get("Project", ""),
            row.get("Observations", ""),
            row.get("Area", ""),
            row.get("Operation", ""),
            row.get("Start Time", ""),
            row.get("End time", ""),
            hours_to_hhmm(dur),
            round(dur, 2),
            row.get("Link", ""),
        ]
        fill = alt_fill if idx % 2 == 1 else None
        for c, val in enumerate(vals, 1):
            cell = ws.cell(row=r, column=c, value=val)
            if isinstance(val, str): cell.data_type = "s"     # text stays text, never a formula
            cell.font = norm_font; cell.border = border
            cell.alignment = center if c in [1, 2, 10, 11] else left
            if fill: cell.fill = fill
        ws.row_dimensions[r].height = 18

    total_hours = df["_dur"].sum()
    tr = len(df) + 2
    tc = ws.cell(row=tr, column=11, value=round(total_hours, 2))
    tc.fill  = PatternFill("solid", fgColor=HEADER_GREEN)
    tc.font  = Font(name="Roboto", bold=True, color=WHITE, size=10)
    tc.alignment = center; tc.border = border
    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), round(total_hours, 2)

# ─── Invoice PDF ──────────────────────────────────────────────────────────────
def make_invoice(invoice_num, month_name, year, total_hours, *, sender, bill_to_name, bill_to_lines,
                 rate, currency="$", avatar_path=None):
    """Returns pdf bytes. `sender` is the settings["sender"] block."""
    _need_fpdf2()
    cur = currency or "$"
    pdf = _PDF(orientation="P", unit="mm", format="A4")
    pdf.add_page()
    pdf.set_auto_page_break(False)
    pdf.set_margins(18, 18, 18)

    W, M = 210, 18

    # Avatar
    avatar_size = 32
    if avatar_path and Path(avatar_path).exists():
        pdf.image(str(avatar_path), x=M, y=16, w=avatar_size, h=avatar_size)

    # Title
    pdf.set_font("Helvetica", "B", 36)
    pdf.set_text_color(40, 40, 40)
    pdf.set_xy(M, 16)
    pdf.cell(W - M * 2, 14, "INVOICE", align="R")

    pdf.set_font("Helvetica", "", 13)
    pdf.set_text_color(100, 100, 100)
    pdf.set_xy(M, 30)
    pdf.cell(W - M * 2, 8, f"# {invoice_num}", align="R")

    # Date + balance
    box_x = W - M - 90
    box_y = 48
    box_w = 90
    box_h = 14
    now = datetime.now()
    invoice_date = f"{now:%b} {now.day}, {now.year}"           # %-d is not portable (fails on Windows)
    total_amount = total_hours * rate

    pdf.set_xy(box_x - 30, box_y)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(30, 7, "Date:", align="R")
    pdf.set_text_color(40, 40, 40)
    pdf.set_xy(box_x, box_y)
    pdf.cell(box_w, 7, invoice_date, align="R")

    pdf.set_fill_color(245, 245, 245)
    pdf.rect(box_x - 30, box_y + 7, box_w + 30, box_h, style="F")
    pdf.set_xy(box_x - 30, box_y + 7)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(40, 40, 40)
    pdf.cell(60, box_h, "Balance Due:", align="L")
    pdf.set_xy(box_x - 30, box_y + 7)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(box_w + 30, box_h, f"{cur}{total_amount:,.2f}", align="R")

    # From
    pdf.set_xy(M, 52)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(40, 40, 40)
    pdf.cell(80, 6, sender.get("name", ""))
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(80, 80, 80)
    for line in [*sender.get("address_lines", []), sender.get("email", "")]:
        if line:
            pdf.set_xy(M, pdf.get_y() + 5)
            pdf.cell(80, 5, line)

    # Bill to, and payment details
    sy = 85
    pdf.set_xy(M, sy); pdf.set_font("Helvetica", "", 8); pdf.set_text_color(130, 130, 130)
    pdf.cell(60, 5, "Bill To:")

    pdf.set_xy(M, sy + 5); pdf.set_font("Helvetica", "B", 9); pdf.set_text_color(40, 40, 40)
    pdf.cell(60, 5, bill_to_name)
    pdf.set_font("Helvetica", "", 9)
    for line in bill_to_lines:
        pdf.set_xy(M, pdf.get_y() + 5); pdf.cell(60, 5, line)

    ship_y = sy + 5
    pdf.set_xy(W / 2 - 10, ship_y); pdf.set_font("Helvetica", "B", 9); pdf.set_text_color(40, 40, 40)
    pay_lines = sender.get("payment_lines") or []
    if pay_lines:
        pdf.cell(80, 5, sender.get("payment_title") or "Payment details")
        pdf.set_font("Helvetica", "", 9)
        for line in pay_lines:
            pdf.set_xy(W / 2 - 10, pdf.get_y() + 5); pdf.cell(80, 5, line)

    # Line items
    ty = 130
    tw = W - M * 2
    cws = [tw - 90, 30, 30, 30]
    hdrs = ["Item", "Quantity", "Rate", "Amount"]

    pdf.set_fill_color(50, 50, 50); pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 9)
    x = M
    for h, cw in zip(hdrs, cws):
        pdf.set_xy(x, ty)
        pdf.cell(cw, 9, h, fill=True, align="L" if h == "Item" else "C")
        x += cw

    ry = ty + 9
    pdf.set_text_color(40, 40, 40); pdf.set_font("Helvetica", "B", 9)
    row_vals = [f"Remote hours {month_name}", f"{total_hours:.2f}", f"{cur}{rate:.2f}", f"{cur}{total_amount:,.2f}"]
    x = M
    for i, (val, cw) in enumerate(zip(row_vals, cws)):
        pdf.set_xy(x, ry)
        pdf.cell(cw, 9, val, align="L" if i == 0 else "C")
        x += cw

    # Totals
    tots_y = ry + 18
    right_x = W - M - cws[-1]
    for label, val in [("Subtotal:", f"{cur}{total_amount:,.2f}"), ("Tax (0%):", f"{cur}0.00"), ("Total:", f"{cur}{total_amount:,.2f}")]:
        pdf.set_font("Helvetica", "", 9); pdf.set_text_color(100, 100, 100)
        pdf.set_xy(right_x - 40, tots_y); pdf.cell(40, 6, label, align="R")
        pdf.set_text_color(40, 40, 40)
        pdf.set_xy(right_x, tots_y); pdf.cell(cws[-1], 6, val, align="C")
        tots_y += 7

    # Notes
    ny = tots_y + 14
    if sender.get("notes"):
        pdf.set_xy(M, ny); pdf.set_font("Helvetica", "", 8); pdf.set_text_color(130, 130, 130)
        pdf.cell(40, 5, "Notes:")
        pdf.set_xy(M, ny + 5); pdf.set_text_color(60, 60, 60)
        pdf.multi_cell(W - M * 2, 5, sender["notes"])

    return bytes(pdf.output())
