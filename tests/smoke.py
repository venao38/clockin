"""End-to-end smoke test on throwaway demo data:  python tests/smoke.py"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run([sys.executable, str(root / "tools" / "seed_demo.py"), tmp], check=True, stdout=subprocess.DEVNULL)
    os.environ["CLOCKIN_DATA_DIR"] = tmp
    sys.path.insert(0, str(root))
    from clockin import create_app
    c = create_app().test_client(); c.environ_base["HTTP_X_CLOCKIN"] = "1"      # the app's CSRF header, as U.api sends it
    ok = lambda r, code=200: (r.status_code == code) or sys.exit(f"{r.request.method} {r.request.path} -> {r.status_code}: {r.data[:200]!r}")

    state = c.get("/api/state"); ok(state); d = state.get_json()
    assert len(d["clients"]) == 2 and d["timer"] is None
    # timer lifecycle
    ok(c.post("/api/timer/start", json={"client": "Personal", "description": "t"}), 201)
    assert c.get("/api/state").get_json()["timer"]["description"] == "t"
    ok(c.post("/api/timer/stop"))
    ok(c.post("/api/timer/start", json={"client": "Personal", "description": "oops"}), 201); ok(c.delete("/api/timer"))
    assert c.get("/api/timer").get_json() is None
    # tasks: add, done, undo, delete, restore
    t = c.post("/api/tasks", json={"task": "x", "client": "Personal"}); ok(t, 201); tid = t.get_json()["id"]
    ok(c.post(f"/api/tasks/{tid}/done")); ok(c.post(f"/api/tasks/{tid}/undone"))
    removed = c.delete(f"/api/tasks/{tid}"); ok(removed); ok(c.post("/api/tasks/restore", json=removed.get_json()))
    # pricing is optional: no rate -> no invoice; rate -> invoice zip
    ok(c.post("/api/invoice", json={"month": "2000-01", "client": "Personal", "invoice_number": "1"}), 400)
    ok(c.put("/api/clients/Personal", json={"rate": ""}))
    assert c.get("/api/clients").get_json()[1]["rate"] is None
    ok(c.put("/api/clients/Personal", json={"rate": "-3"}), 400)
    # project rename cascades
    ok(c.put("/api/projects/Reading list?client=Personal", json={"name": "Books"}))
    assert any(e["project"] == "Books" for e in c.get("/api/entries").get_json())
    # your invoice details: empty at first, saved into settings.json, other keys left alone
    import io, json, zipfile
    assert c.get("/api/state").get_json()["settings"]["sender_ready"] is False
    sfile = Path(tmp) / "settings.json"
    sfile.write_text(json.dumps({"port": 5999, "areas": ["Keep me"]}), encoding="utf-8")
    from clockin import settings as _s; _s.SOURCE = sfile          # as if load() had found it
    ok(c.put("/api/settings/invoice", json={"currency": "EURO1"}), 400)
    ok(c.put("/api/settings/invoice", json={"sender": {"name": "Jamie Doe", "payment_lines": "Bank\nIBAN 1"}, "currency": "€"}))
    saved = json.loads(sfile.read_text(encoding="utf-8"))
    assert saved["port"] == 5999 and saved["areas"] == ["Keep me"] and saved["sender"]["name"] == "Jamie Doe", saved
    assert saved["sender"]["payment_lines"] == ["Bank", "IBAN 1"]
    assert os.name == "nt" or oct(sfile.stat().st_mode)[-3:] == "600"      # Windows has no Unix file modes
    assert c.get("/api/state").get_json()["settings"]["sender_ready"] is True
    ok(c.post("/api/settings/avatar", data={"file": (io.BytesIO(b"GIF89a..."), "x.gif")}, content_type="multipart/form-data"), 400)
    # a real invoice for a client with a rate
    month = c.get("/api/entries?client=Acme Studio").get_json()[0]["start_time"][:7]
    r = c.post("/api/invoice", json={"month": month, "client": "Acme Studio", "invoice_number": "8", "email_message": "hi"})
    if r.status_code == 500 and b"fpdf2" in r.data:
        print("  (skipping the invoice check: fpdf2 isn't installed here)")
    else:
        ok(r)
        names = zipfile.ZipFile(io.BytesIO(r.data)).namelist()
        assert any(n.endswith("Timesheet.xlsx") for n in names) and any(n.endswith(".pdf") for n in names), names
        assert c.get("/api/clients").get_json()[0]["last_invoice_num"] == 8
    # security regressions
    ok(c.post("/api/timer/stop", environ_overrides={"HTTP_X_CLOCKIN": "0"}), 403)
    ok(c.get("/api/state", base_url="http://evil.com"), 400)
    ok(c.put("/api/presets", json=[{"id": 'x"><img>', "label": "a"}]), 400)
    ok(c.post("/api/entries", json={"client": "Personal", "link": "javascript:alert(1)"}), 400)
    ok(c.post("/api/entries", json={"client": "Personal", "link": "example.com:8080/x", "start_time": "2001-02-03 11:00", "end_time": "2001-02-03 12:00"}), 201)
    ok(c.put("/api/clients/Personal", json={"rate": "nan"}), 400)
    ok(c.get("/api/export?month=../x"), 400)
    ok(c.post("/api/entries", json={"client": "Personal", "description": "=1+1", "start_time": "2001-02-03 09:00", "end_time": "2001-02-03 10:00"}), 201); assert b"'=1+1" in c.get("/api/export?month=2001-02").data
    ok(c.post("/api/tasks/restore", json={"id": "z", "task": "z", "due": 5}), 400)
    ok(c.post("/api/tasks/restore", json={"id": "z", "task": "z", "series_id": "z", "occurrence": "9999-12-31", "recurrence": "daily"}), 400)
    # clearing presets is allowed (you may delete them all)
    ok(c.put("/api/presets", json=[]))
print("smoke test passed")
