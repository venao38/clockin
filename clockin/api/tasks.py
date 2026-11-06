import copy
import uuid
from datetime import datetime

from flask import Blueprint, jsonify, request

from .. import store
from ..recurrence import (FREQS, UserError, _d, adjust, clean_due, materialize, norm_rule, validate_rule)

bp = Blueprint("tasks", __name__)

TASK_EDITABLE = ["task", "notes", "due", "trigger", "time_of_day", "subtasks",
                 "client", "project", "work_area", "operation", "order"]


def _find(tasks, task_id):
    return next((t for t in tasks if t.get("id") == task_id), None)


def _new_subtasks(raw):
    out = []
    for st in raw or []:
        text = (st.get("text") or "").strip()
        if text:
            out.append({"id": st.get("id") or str(uuid.uuid4()), "text": text, "done": bool(st.get("done"))})
    return out


def _result(t, ok=200):
    return (jsonify(t), ok) if t else (jsonify({"error": "Task not found"}), 404)


@bp.route("/api/tasks", methods=["POST"])
def create_task():
    d = request.json or {}
    name = (d.get("task") or "").strip()
    if not name:
        return jsonify({"error": "Task name is required"}), 400
    task = {
        "id": str(uuid.uuid4()), "task": name, "done": False, "created": datetime.now().isoformat(),
        "trigger": d.get("trigger") or "anywhere", "time_of_day": d.get("time_of_day") or "anytime",
        "due": clean_due(d.get("due")), "notes": d.get("notes") or None,
        "subtasks": _new_subtasks(d.get("subtasks")),
        "client": d.get("client") or None, "project": d.get("project") or None,
        "work_area": d.get("work_area") or "", "operation": d.get("operation") or "",
    }
    store.mutate_tasks(lambda tasks: tasks.append(task))
    return jsonify(task), 201


@bp.route("/api/tasks/<task_id>", methods=["PATCH"])
def patch_task(task_id):
    d = request.json or {}
    if "task" in d and not (d["task"] or "").strip():
        return jsonify({"error": "Task name can't be empty"}), 400
    if "due" in d:
        d["due"] = clean_due(d["due"])
    if "subtasks" in d:
        d["subtasks"] = _new_subtasks(d["subtasks"])
    if d.get("recurrence") is not None:
        validate_rule(d["recurrence"])
    if d.get("order") is not None and (isinstance(d["order"], bool) or not isinstance(d["order"], (int, float))):
        raise UserError("order must be a number")

    def apply(tasks):
        t = _find(tasks, task_id)
        if not t:
            return None
        old_due = t.get("due")
        for f in TASK_EDITABLE:
            if f in d:
                t[f] = d[f].strip() if f == "task" else d[f]
        if t.get("series_id") and d.get("due") and d["due"] != old_due:
            t["occurrence"] = d["due"]                      # moving a repeat moves its anchor
        if "recurrence" in d:
            _set_recurrence(tasks, t, d["recurrence"])
            materialize(tasks)
        return t

    return _result(store.mutate_tasks(apply))


def _set_recurrence(tasks, t, raw):
    """Start, change or stop the series `t` belongs to."""
    sid = t.get("series_id")
    if raw is None:                                         # stop repeating
        for x in tasks:
            if x is t or (sid and x.get("series_id") == sid):
                x.pop("recurrence", None)
        return
    if not sid:
        if not t.get("due"):
            raise UserError("Set a due date first — repeats count from it")
        sid = t["series_id"] = t["id"]
        t["occurrence"] = t["due"]
    rule = norm_rule(raw, _d(t["occurrence"]))
    for x in tasks:
        if x.get("series_id") == sid:
            x["recurrence"] = rule
            if not x.get("done") and x.get("occurrence"):
                x["due"] = adjust(rule, _d(x["occurrence"])).isoformat()


@bp.route("/api/tasks/<task_id>/done", methods=["POST"])
def task_done(task_id):
    def apply(tasks):
        t = _find(tasks, task_id)
        if t:
            t["done"], t["completed_at"] = True, datetime.now().isoformat()
            if request.args.get("skip"):
                t["skipped"] = True
        return t
    return _result(store.mutate_tasks(apply))


@bp.route("/api/tasks/<task_id>/undone", methods=["POST"])
def task_undone(task_id):
    def apply(tasks):
        t = _find(tasks, task_id)
        if t:
            t["done"] = False
            t.pop("completed_at", None)
            t.pop("skipped", None)
        return t
    return _result(store.mutate_tasks(apply))


@bp.route("/api/tasks/<task_id>/duplicate", methods=["POST"])
def task_duplicate(task_id):
    def apply(tasks):
        i = next((n for n, t in enumerate(tasks) if t.get("id") == task_id), None)
        if i is None:
            return None
        dup = copy.deepcopy(tasks[i])
        dup.update(id=str(uuid.uuid4()), done=False, created=datetime.now().isoformat())
        for k in ("completed_at", "series_id", "occurrence", "recurrence", "skipped"):
            dup.pop(k, None)
        for st in dup.get("subtasks") or []:
            st["id"], st["done"] = str(uuid.uuid4()), False
        if isinstance(tasks[i].get("order"), (int, float)):
            dup["order"] = tasks[i]["order"] + 0.5          # lands right under the original
        tasks.insert(i + 1, dup)
        return dup
    return _result(store.mutate_tasks(apply), 201)


@bp.route("/api/tasks/<task_id>", methods=["DELETE"])
def task_delete(task_id):
    def apply(tasks):
        i = next((n for n, t in enumerate(tasks) if t.get("id") == task_id), None)
        return tasks.pop(i) if i is not None else None
    return _result(store.mutate_tasks(apply, allow_shrink=1))


def _check_restored(t):
    """A restored row goes back verbatim, so it must not be able to break materialize() later."""
    if not all(isinstance(t[k], str) for k in ("id", "task")):
        raise UserError("Task id and name must be text")
    if not isinstance(t.get("series_id"), (str, type(None))):
        raise UserError("series_id must be text")
    for k in ("due", "occurrence"):
        if t.get(k) is not None:
            try:
                clean_due(t[k])                       # also keeps the year in 2000–2100
            except ValueError:
                raise UserError(f"{k} must be a YYYY-MM-DD date")
    r = t.get("recurrence")
    if r is not None and not (isinstance(r, str) and r in FREQS):     # legacy string rules are still accepted
        validate_rule(r)
    st = t.get("subtasks")
    if st is not None and not (isinstance(st, list) and all(isinstance(x, dict) for x in st)):
        raise UserError("subtasks must be a list")


@bp.route("/api/tasks/restore", methods=["POST"])
def task_restore():
    task = request.json or {}
    if not isinstance(task, dict) or not task.get("id") or not task.get("task"):
        return jsonify({"error": "Not a task"}), 400
    _check_restored(task)

    def apply(tasks):
        if not _find(tasks, task["id"]):
            tasks.append(task)
        return task
    return jsonify(store.mutate_tasks(apply)), 200
