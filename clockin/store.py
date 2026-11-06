"""Flat-JSON storage. Every write in the app goes through here.

Rules, lifted from the old Projects app and now applied to every file:
  * an exclusive flock (msvcrt.locking on Windows) around each read-modify-write, so requests can't interleave;
  * a shrink guard: a write may not drop more records than the action intends;
  * a rolling backup of whatever a write replaces (newest ROLLING_KEEP per file);
  * atomic temp-file + os.replace.

Never nest file_lock() on the *same* path (flock on a second descriptor blocks forever).
To lock several files, use locked(*paths): it takes them in a fixed order.
"""
import copy
import errno
import json
import os
import shutil
import time
from contextlib import ExitStack, contextmanager
from datetime import datetime
from pathlib import Path

try:
    import fcntl
except ImportError:                                   # Windows: lock the first byte of the .lock file instead
    fcntl = None
    import msvcrt

ROLLING_KEEP = 50


class UnsafeWrite(Exception):
    """A write was refused because it would lose records."""


class Paths:
    entries = clients = projects = presets = timer = tasks = rolling = data_dir = None

    def configure(self, data_dir, tasks_file=None):
        d = Path(data_dir)
        d.mkdir(parents=True, exist_ok=True)
        self.data_dir = d
        self.entries = d / "entries.json"
        self.clients = d / "clients.json"
        self.projects = d / "projects.json"
        self.presets = d / "presets.json"
        self.timer = d / ".timer.json"
        t = Path(tasks_file).expanduser() if tasks_file else Path("tasks.json")
        self.tasks = t if t.is_absolute() else d / t        # a relative path is relative to the data folder
        self.rolling = d / "backups" / "rolling"
        return self


P = Paths()


def atomic_write(path, text):
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


@contextmanager
def file_lock(path):
    path = Path(path)
    with open(path.with_name(path.name + ".lock"), "a+", encoding="utf-8") as lf:   # "w" would truncate a locked file
        _lock(lf)
        try:
            yield
        finally:
            _unlock(lf)


def _lock(f):
    """Exclusive and blocking, like flock(LOCK_EX)."""
    if fcntl:
        return fcntl.flock(f, fcntl.LOCK_EX)
    while True:
        f.seek(0)                                     # msvcrt locks bytes from the current position
        try:
            return msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as e:                          # held by someone else: wait and retry
            if e.errno not in (errno.EACCES, errno.EDEADLOCK):
                raise
            time.sleep(0.02)


def _unlock(f):
    if fcntl:
        return fcntl.flock(f, fcntl.LOCK_UN)
    f.seek(0)
    msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)


@contextmanager
def locked(*paths):
    """Lock several files at once, always in the same order (no deadlocks)."""
    with ExitStack() as stack:
        for p in sorted({str(x) for x in paths}):
            stack.enter_context(file_lock(p))
        yield


def read_json(path, default):
    path = Path(path)
    if not path.exists():
        return copy.deepcopy(default)
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return copy.deepcopy(default)
    return json.loads(text)


def _rolling_backup(path):
    path = Path(path)
    if not path.exists():
        return
    P.rolling.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    shutil.copy2(path, P.rolling / f"{path.stem}.{stamp}{path.suffix}")
    old = sorted(P.rolling.glob(f"{path.stem}.*{path.suffix}"))
    for f in old[:-ROLLING_KEEP]:
        f.unlink(missing_ok=True)


def safe_write_json(path, data, allow_shrink=0, backup=True):
    """Caller must hold file_lock(path)."""
    path = Path(path)
    if path.exists() and isinstance(data, list):
        try:
            current = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            current = None
        if isinstance(current, list) and len(data) < len(current) - allow_shrink:
            raise UnsafeWrite(f"{path.name}: refusing to write {len(data)} records over {len(current)}")
    if backup:
        _rolling_backup(path)
    atomic_write(path, json.dumps(data, indent=2, default=str))


def mutate_json(path, fn, default, allow_shrink=0, only_if_changed=False, backup=True):
    """Under lock: read `path`, call fn(data) -> result (fn edits data in place), write back."""
    with file_lock(path):
        data = read_json(path, default)
        before = json.dumps(data, sort_keys=True, default=str) if only_if_changed else None
        result = fn(data)
        if not only_if_changed or json.dumps(data, sort_keys=True, default=str) != before:
            safe_write_json(path, data, allow_shrink=allow_shrink, backup=backup)
    return result


# ── Typed shortcuts ───────────────────────────────────────────────────────────

def load_entries():
    return read_json(P.entries, [])


def load_clients():
    return read_json(P.clients, [])


def load_presets():
    return read_json(P.presets, [])


def load_tasks():
    return read_json(P.tasks, [])


def load_timer():
    t = read_json(P.timer, None)
    return t if isinstance(t, dict) else None


def mutate_entries(fn, **kw):
    return mutate_json(P.entries, fn, [], **kw)


def mutate_clients(fn, **kw):
    return mutate_json(P.clients, fn, [], **kw)


def mutate_presets(fn, **kw):
    return mutate_json(P.presets, fn, [], **kw)


def mutate_tasks(fn, **kw):
    return mutate_json(P.tasks, fn, [], **kw)


def load_project_meta():
    """{(name, client): record}. A project is identified by (name, client)."""
    return {(p["name"], p.get("client", "")): p for p in read_json(P.projects, [])}


def mutate_projects(fn, **kw):
    """fn receives the {(name, client): record} dict and edits it in place."""
    def wrapper(rows):
        meta = {(p["name"], p.get("client", "")): p for p in rows}
        result = fn(meta)
        rows[:] = sorted(meta.values(), key=lambda p: (p.get("client", ""), p["name"]))
        return result
    return mutate_json(P.projects, wrapper, [], **kw)


def write_timer(timer):
    atomic_write(P.timer, json.dumps(timer, indent=2, default=str))


def clear_timer():
    P.timer.unlink(missing_ok=True)
