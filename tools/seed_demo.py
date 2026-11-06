"""Write a small demo dataset (dates relative to today) so a fresh clone has something to look at.

    python3 tools/seed_demo.py ./data
"""
import json
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

out = Path(sys.argv[1] if len(sys.argv) > 1 else "data")
out.mkdir(parents=True, exist_ok=True)
for name in ("entries.json", "clients.json"):
    if (out / name).exists():
        sys.exit(f"{out / name} already exists; refusing to overwrite your data.")

now = datetime.now().replace(second=0, microsecond=0)
mon = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0)
F = "%Y-%m-%d %H:%M"
clients = [
    {"name": "Acme Studio", "short": "ACM", "color": "#3a5a78", "notes": "", "bill_to_name": "Acme Studio Ltd",
     "bill_to_lines": ["1 Example Street", "Springfield"], "rate": 40, "last_invoice_num": 7},
    {"name": "Personal", "short": "PER", "color": "#4a8a6e", "notes": "No rate: hours only, never priced.",
     "bill_to_name": "Personal", "bill_to_lines": [], "rate": None, "last_invoice_num": 0},
]
projects = [
    {"name": "Website redesign", "client": "Acme Studio", "status": "active", "description": "", "deadline": None, "notes": ""},
    {"name": "Brand video", "client": "Acme Studio", "status": "active", "description": "", "deadline": None, "notes": ""},
    {"name": "Reading list", "client": "Personal", "status": "active", "description": "", "deadline": None, "notes": ""},
]


def entry(i, day, start_h, hours, client, project, desc, area, op):
    s = mon + timedelta(days=day, hours=start_h)
    e = s + timedelta(hours=hours)
    return {"id": i, "client": client, "description": desc, "project": project, "area": area, "operation": op,
            "start_time": s.strftime(F), "end_time": e.strftime(F), "duration_hours": hours, "observations": "", "link": ""}


rows = [(0, 9, 1.5, "Acme Studio", "Website redesign", "Wireframes", "Design", "Editing"),
        (0, 11, 1.0, "Acme Studio", "Brand video", "Rough cut", "Marketing", "Editing"),
        (1, 9, 2.0, "Acme Studio", "Website redesign", "Homepage layout", "Design", "Editing"),
        (1, 14, 0.5, "Acme Studio", "Website redesign", "Weekly sync", "Admin", "Meetings"),
        (2, 10, 1.0, "Personal", "Reading list", "Read two chapters", "Writing", "Research")]
entries = [entry(i + 1, *r) for i, r in enumerate(rows) if mon + timedelta(days=r[0]) <= now]


def task(name, client, project, due_days=None, **kw):
    return {"id": str(uuid.uuid4()), "task": name, "done": False, "created": now.isoformat(), "trigger": "anywhere",
            "time_of_day": "anytime", "due": (now + timedelta(days=due_days)).strftime("%Y-%m-%d") if due_days is not None else None,
            "notes": None, "subtasks": [], "client": client, "project": project, "work_area": kw.get("area", ""), "operation": kw.get("op", "")}


tasks = [task("Send wireframes for review", "Acme Studio", "Website redesign", 1, area="Design", op="Editing"),
         task("Color-grade the brand video", "Acme Studio", "Brand video", 3, area="Marketing", op="Editing"),
         task("Plan next sprint", "Acme Studio", None, -1, area="Admin", op="Meetings"),
         task("Finish chapter 3", "Personal", "Reading list", 5)]
presets = [{"id": 1, "label": "Design", "description": "Design work", "project": "Website redesign", "area": "Design", "operation": "Editing", "client": "Acme Studio"},
           {"id": 2, "label": "Weekly sync", "description": "Weekly sync", "project": "Website redesign", "area": "Admin", "operation": "Meetings", "client": "Acme Studio"}]

for name, data in {"entries": entries, "clients": clients, "projects": projects, "tasks": tasks, "presets": presets}.items():
    (out / f"{name}.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
print(f"Demo data written to {out}")
