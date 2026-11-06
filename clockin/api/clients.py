import io
import math
import zipfile
from datetime import datetime
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from .. import billing, services, store
from ..settings import SETTINGS
from ..store import P

bp = Blueprint("clients", __name__)

EDITABLE = ("short", "color", "notes", "bill_to_name", "bill_to_lines", "rate", "email_template")


class BadRate(ValueError):
    pass


def clean_rate(raw):
    """Pricing is optional: empty / null means 'this client isn't billed by the hour'."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    try:
        rate = float(raw)
        if not math.isfinite(rate):
            raise ValueError
    except (TypeError, ValueError):
        raise BadRate("Rate must be a number, or empty for no pricing")
    if rate <= 0:
        raise BadRate("Rate must be more than 0, or empty for no pricing")
    return int(rate) if rate == int(rate) else rate


@bp.errorhandler(BadRate)
def _bad_rate(e):
    return jsonify({"error": str(e)}), 400


@bp.route("/api/clients")
def list_clients():
    return jsonify(store.load_clients())


@bp.route("/api/clients", methods=["POST"])
def create_client():
    d = request.json or {}
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    client = {"name": name, "short": d.get("short") or name[:3].upper(), "color": d.get("color") or "#5e5ce6",
              "notes": d.get("notes", ""), "bill_to_name": d.get("bill_to_name") or name,
              "bill_to_lines": d.get("bill_to_lines", []), "rate": clean_rate(d.get("rate")),
              "last_invoice_num": d.get("last_invoice_num", 0)}
    if d.get("email_template"):
        client["email_template"] = d["email_template"]

    def add(rows):
        if any(c["name"] == name for c in rows):
            return False
        rows.append(client)
        return True
    if not store.mutate_clients(add):
        return jsonify({"error": "Client already exists"}), 409
    return jsonify(client), 201


@bp.route("/api/clients/<name>", methods=["PUT"])
def update_client(name):
    d = request.json or {}
    if "rate" in d:
        d["rate"] = clean_rate(d["rate"])

    def apply(rows):
        c = next((c for c in rows if c["name"] == name), None)
        if c:
            for f in EDITABLE:
                if f in d:
                    c[f] = d[f]
        return c
    c = store.mutate_clients(apply)
    return (jsonify(c), 200) if c else (jsonify({"error": "Client not found"}), 404)


@bp.route("/api/clients/<name>", methods=["DELETE"])
def delete_client(name):
    def apply(rows):
        n = len(rows)
        rows[:] = [c for c in rows if c["name"] != name]
        return len(rows) != n
    if not store.mutate_clients(apply, allow_shrink=1):
        return jsonify({"error": "Client not found"}), 404
    return jsonify({"ok": True})


# ── Invoice (only for clients that have a rate) ─────────────────────────────

@bp.route("/api/invoice", methods=["POST"])
def generate_invoice():
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "Expected a JSON object"}), 400
    month, client = data.get("month"), data.get("client", "")
    num, email_message = str(data.get("invoice_number", "")), data.get("email_message", "")
    if not month or not num:
        return jsonify({"error": "month and invoice_number are required"}), 400

    clients = store.load_clients()
    profile = next((c for c in clients if c["name"] == client), None)
    rate = (profile or {}).get("rate")
    if not rate:
        return jsonify({"error": "This client has no rate. Set one in the client's billing settings first."}), 400

    rows = sorted((e for e in store.load_entries()
                   if (e.get("start_time") or "").startswith(month) and e.get("client") == client),
                  key=lambda x: x.get("start_time") or "")
    if not rows:
        return jsonify({"error": "No entries found for that month/client"}), 404

    sheet = [{"Week": services.week_of_month(e["start_time"]), "Description": e.get("description", ""),
              "Project": e.get("project", ""), "Observations": e.get("observations", ""),
              "Area": e.get("area", ""), "Operation": e.get("operation", ""),
              "Start Time": e.get("start_time", ""), "End time": e.get("end_time", ""),
              "Duration (hours)": e.get("duration_hours", 0), "Link": e.get("link", "")} for e in rows]
    sample = datetime.strptime(rows[0]["start_time"], services.FMT)
    month_name, year = sample.strftime("%B"), sample.year
    prefix = f"{year}_{month_name[:3].upper()}"

    sender = SETTINGS["sender"]
    avatar = (P.data_dir / sender["avatar"]) if sender.get("avatar") else None
    try:
        billing._need_fpdf2()
    except billing.MissingDependency as e:
        return jsonify({"error": str(e)}), 500
    xlsx, total_hours = billing.make_timesheet(sheet, month_name, year)
    pdf = billing.make_invoice(num, month_name, year, total_hours, sender=sender,
                               bill_to_name=profile.get("bill_to_name") or client,
                               bill_to_lines=profile.get("bill_to_lines") or [], rate=rate,
                               currency=SETTINGS["currency"], avatar_path=avatar)
    who = f" - {sender['name']}" if sender.get("name") else ""

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{prefix}_Timesheet.xlsx", xlsx)
        zf.writestr(services.safe_name(f"{prefix}_Invoice_{num}{who}.pdf"), pdf)
        if email_message:
            zf.writestr(f"{prefix}_Email_Message.txt", email_message)

    try:                                              # the next invoice number auto-advances
        n = int(num)
        store.mutate_clients(lambda cs: [c.update(last_invoice_num=n) for c in cs if c["name"] == client])
    except ValueError:
        pass
    buf.seek(0)
    return send_file(buf, mimetype="application/zip", as_attachment=True,
                     download_name=services.safe_name(f"{prefix}_Invoice_{num}.zip"))
