"""Settings: environment + an optional settings.json. Nothing personal lives in code."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DEFAULTS = {
    "host": "127.0.0.1",          # set CLOCKIN_HOST=0.0.0.0 to reach it from other machines
    "port": 5002,
    "trusted_hosts": [],          # extra host names / IPs allowed in the Host header (LAN use); localhost always is
    "currency": "$",
    "areas": ["Admin", "Design", "Development", "Marketing", "Writing"],
    "operations": ["Editing", "Meetings", "Planning", "Research", "Review"],
    "forgotten_timer_hours": 8,   # a timer running this long is stopped and flagged for review
    "tasks_file": None,           # path to tasks.json; default is <data_dir>/tasks.json
    # Invoice sender. Only used if a client has a rate and you generate an invoice.
    "sender": {
        "name": "",
        "address_lines": [],
        "email": "",
        "payment_title": "Payment details",
        "payment_lines": [],
        "notes": "",
        "avatar": None,           # path to an image, relative to the data dir
        "signature": "",          # how invoice emails are signed
    },
    "email_template": (
        "Hi,\n\n"
        "Please find attached invoice #{invoice_num} for {month} {year} — "
        "{total_hours} h at {currency}{rate}/h, total {currency}{total_amount}.\n\n"
        "{payment}\n\n"
        "Thanks,\n{signature}"
    ),
}


def data_dir():
    return Path(os.environ.get("CLOCKIN_DATA_DIR") or ROOT / "data").expanduser().resolve()


def _merge(base, extra):
    out = dict(base)
    for k, v in (extra or {}).items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def load(dd=None):
    """Defaults < settings.json < environment."""
    dd = Path(dd) if dd else data_dir()
    candidates = [os.environ.get("CLOCKIN_SETTINGS"), dd / "settings.json", ROOT / "settings.json"]
    global SOURCE
    found, SOURCE = {}, dd / "settings.json"      # where "Your invoice details" saves when no file exists yet
    for c in candidates:
        if c and Path(c).is_file():
            found, SOURCE = json.loads(Path(c).read_text(encoding="utf-8")), Path(c)
            break
    s = _merge(DEFAULTS, found)
    if os.environ.get("CLOCKIN_HOST"):
        s["host"] = os.environ["CLOCKIN_HOST"]
    if os.environ.get("CLOCKIN_PORT"):
        s["port"] = int(os.environ["CLOCKIN_PORT"])
    if os.environ.get("CLOCKIN_TRUSTED_HOSTS"):
        s["trusted_hosts"] = [h.strip() for h in os.environ["CLOCKIN_TRUSTED_HOSTS"].split(",") if h.strip()]
    s["data_dir"] = str(dd)
    return s


# Filled in by create_app(); read everywhere else.
SETTINGS = dict(DEFAULTS)
SOURCE = None                 # the settings.json in use (set by load())
