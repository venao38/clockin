"""Repeating tasks. Each occurrence is an ordinary task row sharing a series_id, with its
nominal date in `occurrence` and the rule in `recurrence`. Occurrences are created by the
calendar (materialize), not by completion, so missed periods stack up.
(Ported unchanged from the Projects app.)
"""
import calendar
import copy
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta

from . import store

FREQS        = ("daily", "weekdays", "weekly", "monthly", "yearly")
WEEKEND      = ("before", "after", "keep")
MAX_PER_RUN  = 31


class UserError(Exception):
    """Bad input whose message is meant for the user."""


def _d(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def norm_rule(r, anchor=None):
    """Return a full rule dict, or None. Accepts TaskBrain's legacy strings."""
    legacy = isinstance(r, str)
    if legacy:
        r = {"freq": r, "weekend": "keep"}
    if not isinstance(r, dict) or r.get("freq") not in FREQS:
        return None
    anchor = anchor or date.today()
    day, wd, lead = r.get("day"), r.get("weekday"), r.get("lead_days", 3)
    return {
        "freq":      r["freq"],
        "day":       day if isinstance(day, int) and 1 <= day <= 31 else anchor.day,
        "weekday":   wd if isinstance(wd, int) and 0 <= wd <= 6 else anchor.weekday(),
        "weekend":   r.get("weekend") if r.get("weekend") in WEEKEND else ("keep" if legacy else "before"),
        "lead_days": lead if isinstance(lead, int) and 0 <= lead <= 60 else 3,
    }


def validate_rule(r):
    if not isinstance(r, dict) or r.get("freq") not in FREQS:
        raise UserError("Repeat must be daily, weekdays, weekly, monthly or yearly")
    if r.get("weekend", "before") not in WEEKEND:
        raise UserError("Weekend rule must be before, after or keep")
    lead = r.get("lead_days", 3)
    if not isinstance(lead, int) or not 0 <= lead <= 60:
        raise UserError("'Show it … days before' must be a whole number from 0 to 60")
    day = r.get("day")
    if day is not None and (not isinstance(day, int) or not 1 <= day <= 31):
        raise UserError("Day of month must be 1–31")
    return r


def _clamp(y, m, day):
    return date(y, m, min(day, calendar.monthrange(y, m)[1]))


def nominal_next(rule, d):
    f = rule["freq"]
    if f == "daily":
        return d + timedelta(days=1)
    if f == "weekdays":
        n = d + timedelta(days=1)
        while n.weekday() >= 5:
            n += timedelta(days=1)
        return n
    if f == "weekly":
        return d + timedelta(days=7)
    if f == "monthly":
        y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
        return _clamp(y, m, rule["day"])
    return _clamp(d.year + 1, d.month, d.day if d.month != 2 else rule["day"])   # yearly


def adjust(rule, d):
    """Move a weekend date per the rule. Daily/weekdays never move."""
    if rule["freq"] in ("daily", "weekdays") or d.weekday() < 5 or rule["weekend"] == "keep":
        return d
    if rule["weekend"] == "before":
        return d - timedelta(days=d.weekday() - 4)
    return d + timedelta(days=7 - d.weekday())


def materialize(tasks, today=None):
    """Create every occurrence whose show date (due − lead_days) has arrived.
    Mutates `tasks`; returns how many were created."""
    today = today or date.today()
    series = defaultdict(list)
    for t in tasks:
        if t.get("series_id") and t.get("occurrence"):
            series[t["series_id"]].append(t)
    made = 0
    for sid, occ in series.items():
        try:
            latest = max(occ, key=lambda t: t["occurrence"])
            rule   = norm_rule(latest.get("recurrence"), _d(latest["occurrence"]))
        except (TypeError, ValueError):
            continue                                  # a malformed occurrence: leave the series alone
        if not rule:
            continue                                  # series stopped
        have = {t["occurrence"] for t in occ}
        nom, n = _d(latest["occurrence"]), 0
        while n < MAX_PER_RUN:
            try:
                nom = nominal_next(rule, nom)
                due = adjust(rule, nom)
                show = due - timedelta(days=rule["lead_days"])
            except (OverflowError, ValueError):       # ran past year 9999: the series ends here
                break
            if show > today:
                break
            if nom.isoformat() in have:
                continue
            new = copy.deepcopy(latest)
            for k in ("completed_at", "skipped", "show_after", "missed"):
                new.pop(k, None)
            new.update(id=str(uuid.uuid4()), done=False, flagged=False,
                       created=datetime.now().isoformat(),
                       occurrence=nom.isoformat(), due=due.isoformat())
            for st in new.get("subtasks") or []:
                st["id"], st["done"] = str(uuid.uuid4()), False
            tasks.append(new)
            have.add(nom.isoformat())
            n += 1
        made += n
    return made


def run_materialize():
    """Locked check-and-create; writes only when something new appeared."""
    return store.mutate_tasks(materialize, only_if_changed=True)


def with_missed(tasks):
    """Copy of tasks where the newest open occurrence of each series carries
    `missed`: how many older open occurrences are already past due."""
    today = date.today().isoformat()
    out   = [dict(t) for t in tasks]
    open_by = defaultdict(list)
    for t in out:
        if t.get("series_id") and t.get("occurrence") and not t.get("done"):
            open_by[t["series_id"]].append(t)
    for occ in open_by.values():
        occ.sort(key=lambda t: t["occurrence"])
        missed = sum(1 for t in occ[:-1] if (t.get("due") or "9999") < today)
        if missed:
            occ[-1]["missed"] = missed
    return out


def clean_due(raw):
    """Only ISO dates (years 2000–2100) are accepted from the UI date picker."""
    if not raw:
        return None
    if not isinstance(raw, str) or not 2000 <= datetime.strptime(raw, "%Y-%m-%d").year <= 2100:
        raise UserError("Dates must be YYYY-MM-DD, between the years 2000 and 2100")
    return raw

