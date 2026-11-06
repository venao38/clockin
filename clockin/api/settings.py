"""Your invoice details: who invoices are from, how to pay you, and how the email is signed.
Saved into the settings.json in use; only these keys are touched, everything else in the file stays."""
import os
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from .. import settings, store
from ..settings import DEFAULTS, SETTINGS

bp = Blueprint("settings", __name__)

TEXT = {"name": 120, "email": 160, "payment_title": 60, "notes": 600, "signature": 80}
LINES = {"address_lines": 6, "payment_lines": 8}
MAX_AVATAR = 2 * 1024 * 1024


class BadSetting(ValueError):
    pass


@bp.errorhandler(BadSetting)
def _bad(e):
    return jsonify({"error": str(e)}), 400


def _clean(d):
    src, sender = d.get("sender") or {}, {}
    if not isinstance(src, dict):
        raise BadSetting("sender must be an object")
    for k, cap in TEXT.items():
        if k in src:
            v = src[k] if src[k] is not None else ""
            if not isinstance(v, str):
                raise BadSetting(f"{k} must be text")
            if len(v.strip()) > cap:
                raise BadSetting(f"{k.replace('_', ' ').capitalize()} is too long (at most {cap} characters)")
            sender[k] = v.strip()
    for k, cap in LINES.items():
        if k in src:
            v = src[k] or []
            if isinstance(v, str):
                v = v.splitlines()
            if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
                raise BadSetting(f"{k} must be a list of lines")
            v = [x.strip()[:120] for x in v if x.strip()]
            if len(v) > cap:
                raise BadSetting(f"At most {cap} {k.split('_')[0]} lines")
            sender[k] = v
    if "avatar" in src and not src["avatar"]:
        sender["avatar"] = None                                   # removing is allowed here; setting one goes through the upload
    out = {"sender": sender}
    if "currency" in d:
        c = (d["currency"] or "").strip()
        if not 1 <= len(c) <= 4:
            raise BadSetting("Currency must be 1 to 4 characters, like $ or EUR")
        out["currency"] = c
    if "email_template" in d:
        t = d["email_template"] or ""
        if not isinstance(t, str) or len(t) > 4000:
            raise BadSetting("Email text must be under 4000 characters")
        out["email_template"] = t
    return out


def _save(upd):
    path = Path(settings.SOURCE)

    def apply(raw):
        if not isinstance(raw.get("sender"), dict):
            raw["sender"] = {}
        raw["sender"].update(upd.get("sender", {}))
        if "currency" in upd:
            raw["currency"] = upd["currency"]
        if "email_template" in upd:
            if upd["email_template"].strip():
                raw["email_template"] = upd["email_template"]
            else:
                raw.pop("email_template", None)                 # empty: back to the built-in text
    store.mutate_json(path, apply, default={})
    os.chmod(path, 0o600)                                         # holds your address and payment details
    SETTINGS["sender"] = {**SETTINGS["sender"], **upd.get("sender", {})}
    if "currency" in upd:
        SETTINGS["currency"] = upd["currency"]
    if "email_template" in upd:
        SETTINGS["email_template"] = upd["email_template"] if upd["email_template"].strip() else DEFAULTS["email_template"]


def _avatar_path():
    a = SETTINGS["sender"].get("avatar")
    if not a:
        return None
    p = Path(a) if Path(a).is_absolute() else store.P.data_dir / a
    return p if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg") else None


def _public():
    s = dict(SETTINGS["sender"])
    s["avatar"] = bool(_avatar_path())
    return {"sender": s, "currency": SETTINGS["currency"], "email_template": SETTINGS["email_template"],
            "default_email_template": DEFAULTS["email_template"]}


@bp.route("/api/settings/invoice")
def get_invoice():
    return jsonify(_public())


@bp.route("/api/settings/invoice", methods=["PUT"])
def put_invoice():
    d = request.get_json()
    if not isinstance(d, dict):
        raise BadSetting("Expected a JSON object")
    _save(_clean(d))
    return jsonify(_public())


@bp.route("/api/settings/avatar")
def get_avatar():
    p = _avatar_path()
    return send_file(p, max_age=0) if p else (jsonify({"error": "No picture"}), 404)


@bp.route("/api/settings/avatar", methods=["POST"])
def post_avatar():
    f = request.files.get("file")
    if not f:
        raise BadSetting("Choose a picture to upload")
    data = f.read(MAX_AVATAR + 1)
    if len(data) > MAX_AVATAR:
        raise BadSetting("That picture is over 2 MB")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        ext = "png"
    elif data[:3] == b"\xff\xd8\xff":
        ext = "jpg"
    else:
        raise BadSetting("Use a PNG or JPEG picture")
    dest = store.P.data_dir / f"avatar.{ext}"
    tmp = dest.with_name(dest.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, dest)
    _save({"sender": {"avatar": dest.name}})
    return jsonify(_public())
