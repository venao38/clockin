"""Logic shared by several API modules: entries, projects, timer, quick-start seeding."""
import re
from collections import defaultdict
from datetime import date, datetime, timedelta

from . import store
from .settings import SETTINGS
from .store import P

FMT = "%Y-%m-%d %H:%M"


# ── Entries ──────────────────────────────────────────────────────────────────

def next_id(entries):
    return max((e["id"] for e in entries), default=0) + 1


def calc_duration(s, e):
    return round((datetime.strptime(e, FMT) - datetime.strptime(s, FMT)).total_seconds() / 3600, 2)


def week_of_month(start):
    """ceil(day / 7): days 1–7 are week 1, 8–14 week 2, … (independent of weekday)."""
    return (datetime.strptime(start, FMT).day - 1) // 7 + 1


def safe_cell(v):
    """Text a spreadsheet could run as a formula gets a leading quote (CSV injection)."""
    return "'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r", "\n") else v


def safe_name(s):
    """A file name from user text: no path separators, '..', control or quote characters."""
    s = re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]', "_", str(s))
    return re.sub(r"\.{2,}", ".", s).strip(" .") or "_"


def with_week(e):
    s = e.get("start_time")
    return {**e, "week": week_of_month(s) if s else None}


# ── Projects ─────────────────────────────────────────────────────────────────

STATUSES = ["active", "on_hold", "completed", "archived"]

# One colour per project. Mint is left out: it means "running".
PROJECT_PALETTE = ["#5B8DEF", "#EC6FA6", "#E5A03C", "#9B7BF0", "#3BBCD6",
                   "#EF6B5A", "#B8A13B", "#C462D8", "#6E86B8", "#B07A55"]


def new_project(name, client, **extra):
    return {"name": name, "status": "active", "description": "", "deadline": None,
            "notes": "", "client": client or "", **extra}


def ensure_project_meta(name, client, meta):
    key = (name, client or "")
    if key not in meta:
        meta[key] = new_project(name, client)
    return meta[key]


def assign_colors(meta):
    """Give every project without a colour the palette colour least used by its client's
    projects (ties: palette order). Active and on-hold projects are coloured first,
    counting only each other, so the ones in use stay distinct."""
    by_client = defaultdict(list)
    for (_, client), m in meta.items():
        by_client[client].append(m)
    for projects in by_client.values():
        live = [m for m in projects if m.get("status") in ("active", "on_hold", "", None)]
        rest = [m for m in projects if m not in live]
        for group, pool in ((live, live), (rest, projects)):
            used = defaultdict(int)
            for m in pool:
                if m.get("color"):
                    used[m["color"]] += 1
            for m in sorted(group, key=lambda m: m["name"].lower()):
                if not m.get("color"):
                    m["color"] = min(PROJECT_PALETTE, key=lambda c: (used[c], PROJECT_PALETTE.index(c)))
                    used[m["color"]] += 1


def aggregate_projects(entries, meta):
    """Project records plus hours/operations from entries. Projects that appear in entries
    but have no metadata are created (status active)."""
    month = date.today().strftime("%Y-%m")
    data = defaultdict(lambda: {"total_hours": 0.0, "month_hours": 0.0, "operations": defaultdict(float),
                                "first_date": None, "last_date": None, "entry_count": 0})
    for e in entries:
        if not e.get("duration_hours"):
            continue
        key = ((e.get("project") or "").strip() or "Unassigned", (e.get("client") or "").strip())
        p, h = data[key], float(e.get("duration_hours") or 0)
        p["total_hours"] += h
        p["entry_count"] += 1
        p["operations"][(e.get("operation") or "Other").strip()] += h
        start = (e.get("start_time") or "")[:10]
        if start:
            p["first_date"] = min(filter(None, [p["first_date"], start]))
            p["last_date"] = max(filter(None, [p["last_date"], start]))
        if (e.get("start_time") or "").startswith(month):
            p["month_hours"] += h

    new_keys = [k for k in data if k not in meta]
    if new_keys:
        def add_missing(m):
            for n, c in new_keys:
                ensure_project_meta(n, c, m)
            return dict(m)
        meta = store.mutate_projects(add_missing)

    result = []
    for key in set(data) | set(meta):
        name, client = key
        p = data.get(key) or {"total_hours": 0.0, "month_hours": 0.0, "operations": {},
                              "first_date": None, "last_date": None, "entry_count": 0}
        m = meta.get(key, {})
        ops = sorted(p["operations"].items(), key=lambda x: x[1], reverse=True)
        result.append({
            "name": name, "status": m.get("status") or "", "description": m.get("description", ""),
            "deadline": m.get("deadline"), "notes": m.get("notes", ""), "client": m.get("client", client),
            "color": m.get("color", ""),
            "total_hours": round(p["total_hours"], 2), "month_hours": round(p["month_hours"], 2),
            "operations": [{"op": k, "hours": round(v, 2)} for k, v in ops],
            "first_date": p["first_date"], "last_date": p["last_date"], "entry_count": p["entry_count"],
        })
    result.sort(key=lambda x: x["last_date"] or "", reverse=True)
    return result


def options_for(entries, client=None):
    rows = [e for e in entries if not client or e.get("client") == client]
    areas = sorted(set(SETTINGS["areas"] + [e["area"] for e in rows if e.get("area")]))
    ops = sorted(set(SETTINGS["operations"] + [e["operation"] for e in rows if e.get("operation")]))
    return {"areas": areas, "operations": ops}


# ── Timer ────────────────────────────────────────────────────────────────────

def resolve_timer():
    """-> (timer | None, auto_stopped_entry | None).

    Self-heals a missing timer file from an open entry (interrupted write), and stops a
    timer left running past `forgotten_timer_hours` at start + cutoff, flagging the entry."""
    with store.locked(P.entries, P.timer):
        timer = store.load_timer()
        if not timer:
            entries = store.load_entries()
            open_entry = next((e for e in reversed(entries)
                               if e.get("start_time") and not e.get("end_time")), None)
            if open_entry:
                try:
                    epoch = datetime.strptime(open_entry["start_time"], FMT).timestamp()
                except ValueError:
                    epoch = None
                if epoch:
                    timer = {k: open_entry.get(k, "") for k in
                             ("client", "description", "project", "area", "operation", "start_time")}
                    timer.update(entry_id=open_entry["id"], start_epoch=epoch)
                    store.write_timer(timer)
        limit = SETTINGS["forgotten_timer_hours"]
        if timer and timer.get("start_epoch"):
            if (datetime.now().timestamp() - timer["start_epoch"]) / 3600 >= limit:
                entries = store.load_entries()
                entry = next((e for e in entries if e["id"] == timer.get("entry_id")), None)
                store.clear_timer()
                if entry and not entry.get("end_time"):
                    end = datetime.fromtimestamp(timer["start_epoch"]) + timedelta(hours=limit)
                    entry["end_time"] = end.strftime(FMT)
                    entry["duration_hours"] = calc_duration(entry["start_time"], entry["end_time"])
                    entry["auto_stopped"] = True
                    store.safe_write_json(P.entries, entries)
                    return None, with_week(entry)
                return None, None
        return timer, None


# ── Quick-start seeding ──────────────────────────────────────────────────────

def _last_op_area(entries, project, client):
    matches = [e for e in entries if e.get("project") == project and e.get("client") == client
               and e.get("start_time")]
    if not matches:
        return "", ""
    last = max(matches, key=lambda e: e["start_time"])
    return last.get("operation", ""), last.get("area", "")


def _last_entry_for_client(entries, client):
    matches = [e for e in entries if e.get("client") == client and e.get("start_time")]
    return max(matches, key=lambda e: e["start_time"]) if matches else None


def seed_preset(entries, preset):
    """Overlay a preset with remembered labels so recurring timers begin where you left off.
    Memory is per project: the preset's base project is preferred and each (preset, project)
    pair keeps its own last description/area/operation. Chain: last run on the base project →
    last run on any project → client+operation+area match (pre-preset history) → static values."""
    pid = preset.get("id")
    tagged = [e for e in entries if e.get("preset_id") == pid and e.get("start_time")]
    pool = [e for e in tagged if e.get("project") == preset.get("project")] or tagged
    if not pool:
        pool = [e for e in entries if e.get("client") == preset.get("client")
                and e.get("operation") == preset.get("operation")
                and e.get("area") == preset.get("area") and e.get("start_time")]
    seeded = {**preset, "preset_id": pid}
    if pool:
        last = max(pool, key=lambda e: e["start_time"])
        for f in ("description", "project", "area", "operation"):
            seeded[f] = last.get(f) or preset.get(f, "")
    return seeded


def seed_task(entries, t, client):
    """Pre-fill a task's timer. Each field comes from the first source that has it: the task's
    last time entry, the task's own labels, the project's latest entry, the client's latest entry."""
    mine = [e for e in entries if e.get("task_id") == t.get("id") and e.get("start_time")]
    last = max(mine, key=lambda e: e["start_time"]) if mine else None
    client_seed = _last_entry_for_client(entries, client) or {}
    project = t.get("project") or (last or {}).get("project") or client_seed.get("project", "")
    p_op, p_area = _last_op_area(entries, project, client)
    return {
        "id": t.get("id"), "task": t.get("task", ""), "client": client, "project": project,
        "description": (last or {}).get("description") or t.get("task", ""),
        "operation": (last or {}).get("operation") or t.get("operation") or p_op or client_seed.get("operation", ""),
        "area": (last or {}).get("area") or t.get("work_area") or p_area or client_seed.get("area", ""),
        "due": t.get("due"),
    }


def preset_memory(entries, pid, project, client):
    matches = [e for e in entries if e.get("preset_id") == pid and e.get("project") == project
               and e.get("start_time")]
    if matches:
        last = max(matches, key=lambda e: e["start_time"])
        return {"description": last.get("description", ""), "area": last.get("area", ""),
                "operation": last.get("operation", ""), "source": "preset+project"}
    op, area = _last_op_area(entries, project, client)
    if op or area:
        return {"description": "", "area": area, "operation": op, "source": "project"}
    return {"description": "", "area": "", "operation": "", "source": "none"}
