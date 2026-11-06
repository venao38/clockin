"""Clock-in': time tracking, projects and tasks in one small local app."""
import socket
import threading
import time

from flask import Flask, jsonify, render_template, request

from . import settings, store
from .recurrence import UserError, run_materialize
from .store import UnsafeWrite

ANY_HOST = ("0.0.0.0", "::", "")     # bind addresses that mean "every interface", not a host name


def host_entry(h):
    """A host as request.host shows it: lowercase (browsers lowercase it, Werkzeug compares exactly), IPv6 in []."""
    h = h.strip().lower()
    return f"[{h}]" if ":" in h and not h.startswith("[") else h


def local_names(ipv6=False):
    """This machine's own names and IP addresses, so other devices on the network can open it by them."""
    name = socket.gethostname()
    short = name.split(".")[0]
    names = {name, short, f"{short}.local"}
    for fam in (socket.AF_INET, socket.AF_INET6) if ipv6 else (socket.AF_INET,):
        try:
            names |= {a[4][0] for a in socket.getaddrinfo(name, None, fam) if "%" not in a[4][0]}   # no link-local zones
        except OSError:
            pass
    try:                                    # the LAN address; a UDP connect sends nothing
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            names.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted({host_entry(n) for n in names} - {"127.0.0.1", "0.0.0.0", "[::1]"})


def create_app(data_dir=None):
    cfg = settings.load(data_dir)
    settings.SETTINGS.clear()
    settings.SETTINGS.update(cfg)
    store.P.configure(cfg["data_dir"], cfg.get("tasks_file"))

    app = Flask(__name__, template_folder=str(settings.ROOT / "templates"),
                static_folder=str(settings.ROOT / "static"))
    app.config["TEMPLATES_AUTO_RELOAD"] = True
    # Only answer to known Host headers (blocks DNS rebinding); the port is ignored.
    # shortcut: hosts are resolved once at startup, restart after an IP change
    bound = local_names(ipv6=cfg["host"] == "::") if cfg["host"] in ANY_HOST else [cfg["host"]]
    app.config["TRUSTED_HOSTS"] = ["localhost", "127.0.0.1", "[::1]",
                                   *{host_entry(h) for h in [*bound, *cfg.get("trusted_hosts", [])]}]

    from .api import clients, projects, settings as settings_api, state, tasks, time as time_api
    for mod in (state, tasks, projects, clients, time_api, settings_api):
        app.register_blueprint(mod.bp)

    @app.before_request
    def _same_origin():
        """Refuse cross-site writes (CSRF): every write must carry X-Clockin: 1, which another site can't send
        without a CORS preflight, and this app never answers preflights."""
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return None
        if request.headers.get("X-Clockin") != "1":
            return jsonify({"error": "Missing X-Clockin: 1 header"}), 403

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.errorhandler(UnsafeWrite)
    def _unsafe(e):
        return jsonify({"error": str(e)}), 500

    @app.errorhandler(UserError)
    def _user_error(e):
        return jsonify({"error": str(e)}), 400

    @app.errorhandler(ValueError)
    def _bad_value(e):
        return jsonify({"error": f"Invalid value: {e}"}), 400

    return app


def start_background_jobs():
    """Hourly: create repeating-task copies whose show-date has arrived (also done on every /api/state)."""
    def loop():
        while True:
            try:
                run_materialize()
            except Exception as e:                       # keep the loop alive
                print("materialize failed:", e, flush=True)
            time.sleep(3600)
    threading.Thread(target=loop, daemon=True).start()
