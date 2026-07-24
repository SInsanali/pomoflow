# Pomoflow Persistence & Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Pomoflow from an ephemeral single-file timer into a durable, auto-starting local service that logs every focus block to SQLite, resumes the live timer after a disconnect, shows a metrics dashboard, and opens in its own Chrome session via a double-click app icon.

**Architecture:** A Python stdlib HTTP server (`pomoflow.py`) serves static pages and a small JSON REST API backed by SQLite (`db.py`). The heartbeat/auto-timeout is removed; the server runs until deliberately quit. A `pomoflow` launcher (wrapped by a zero-dependency `Pomoflow.app`) ensures the server is running and opens an app-mode Chrome window. The 2,882-line `index.html` is split into `web/` pages (landing, timer, dashboard) with extracted shared CSS/JS. Live timer state persists to localStorage and reconciles on load; completed blocks post to the API idempotently by UUID.

**Tech Stack:** Python 3.6+ stdlib (`http.server`, `sqlite3`, `socketserver`), vanilla HTML/CSS/JS (no framework, no chart library — inline SVG), pytest for server tests, Node's built-in `node:test` for client-logic tests.

## Global Constraints

- **Zero runtime dependencies.** Server uses only the Python standard library; pages use only vanilla HTML/CSS/JS. No chart libraries, no frameworks, no pip/npm runtime installs. (Test-only tools — `pytest`, `node:test` — are allowed and already available.)
- **Python 3.6+** compatibility for the server.
- **Offline-capable.** No external network calls, no CDN assets, no remote fonts. All assets local.
- **Localhost only.** Server binds `localhost`; all API endpoints are localhost-only.
- **Cross-platform launch** must still work on macOS, Linux, Windows, WSL (preserve existing browser-detection approach); `Pomoflow.app` is a macOS-only convenience on top.
- **No auto-close timeout.** The server never self-terminates on inactivity; it stops only via `POST /api/quit` or `./pomoflow stop`.
- **Default port 8888**, overridable via existing config file / `--port`.
- **Timestamps stored UTC ISO8601**; all date bucketing done in the user's **local** timezone.
- **Session logging is idempotent by client-generated `id`** — re-posting the same block must not create a duplicate.

---

## File Structure

```
pomoflow.py                 # NEW server: static files + REST API + SQLite; no heartbeat
db.py                       # NEW SQLite schema + query functions
pomoflow                    # NEW launcher script (executable): ensure-running, open, stop
Pomoflow.app/               # NEW macOS bundle wrapping the launcher
  Contents/Info.plist
  Contents/MacOS/Pomoflow
web/                        # NEW home for pages/assets (moved out of root)
  landing.html              # friendly root router → Timer / Dashboard
  index.html                # timer page (structure only)
  dashboard.html            # metrics page
  css/app.css               # shared styles (extracted from old inline <style>)
  css/dashboard.css         # dashboard-specific styles
  js/timer.js               # timer logic (extracted)
  js/resume.js              # pure reconcile logic (unit-tested)
  js/api.js                 # fetch wrappers for the REST API
  js/dashboard.js           # dashboard rendering (inline-SVG charts)
  js/charts.js              # pure chart-geometry helpers (unit-tested)
fonts/                      # unchanged (referenced from web/ pages)
tests/
  test_db.py                # pytest: schema, idempotent insert, rollups, settings/presets
  test_api.py               # pytest: endpoint status codes, JSON shapes, idempotency
  test_launcher.py          # pytest: port-check / ensure-running helpers
  resume.test.mjs           # node:test: reconcile logic
  charts.test.mjs           # node:test: bucketing + chart geometry
run.py                      # REMOVED at the end (replaced by pomoflow.py + launcher)
```

**Module interfaces (locked here, referenced by tasks):**

`db.py`
- `connect(db_path) -> sqlite3.Connection` — opens with `row_factory = sqlite3.Row`, runs `init_schema`.
- `init_schema(conn) -> None` — creates `sessions`, `settings`, `presets` tables if absent.
- `insert_session(conn, session: dict) -> bool` — idempotent upsert by `id`; returns `True` if newly inserted, `False` if it already existed. `session` keys: `id, mode, started_at, ended_at, planned_seconds, actual_seconds, completed`.
- `get_sessions(conn, frm: str|None, to: str|None) -> list[dict]` — rows in `[frm, to)` by `started_at`, newest first.
- `get_stats(conn, frm: str|None, to: str|None, tz_offset_minutes: int) -> dict` — `{daily: [{date, focus_seconds, blocks}], totals: {today_seconds, week_seconds, all_time_blocks}}`, bucketed in local time using `tz_offset_minutes`.
- `get_settings(conn) -> dict|None` / `put_settings(conn, obj: dict) -> None`.
- `list_presets(conn) -> list[dict]` / `create_preset(conn, name: str, config: dict) -> dict` / `delete_preset(conn, preset_id: str) -> bool`.

`web/js/resume.js` (ES module)
- `export function reconcile(snapshot, nowMs, getDurationSeconds)` → `{ action: 'resume'|'complete'|'fresh', remainingSeconds?, completedBlock? }`. Pure; no DOM, no clock access.

`web/js/charts.js` (ES module)
- `export function bucketDaily(sessions, tzOffsetMinutes)` → `[{date:'YYYY-MM-DD', focusSeconds, blocks}]` sorted ascending.
- `export function barGeometry(values, {width, height, gap})` → `[{x,y,w,h}]`.
- `export function heatmapCells(daily, {weeks, cell, gap})` → `[{x,y,date,focusSeconds,level}]` (level 0–4).

`web/js/api.js` (ES module)
- `export const api = { logSession, getSessions, getStats, getSettings, putSettings, listPresets, createPreset, deletePreset, quit }` — thin `fetch` wrappers returning parsed JSON; each swallows network errors and reports via a returned `{ok, data|error}` shape.

---

## Phase 1 — Server split & de-heartbeat

### Task 1: Create `db.py` schema and connection

**Files:**
- Create: `db.py`
- Test: `tests/test_db.py`

**Interfaces:**
- Produces: `connect`, `init_schema` (see File Structure).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_db.py
import sqlite3
import db

def test_init_schema_creates_tables(tmp_path):
    conn = db.connect(str(tmp_path / "t.db"))
    names = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    assert {"sessions", "settings", "presets"} <= names

def test_connect_uses_row_factory(tmp_path):
    conn = db.connect(str(tmp_path / "t.db"))
    row = conn.execute("SELECT 1 AS one").fetchone()
    assert row["one"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_db.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'db'`

- [ ] **Step 3: Write minimal implementation**

```python
# db.py
import sqlite3

def connect(db_path):
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    init_schema(conn)
    return conn

def init_schema(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            mode TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL,
            planned_seconds INTEGER NOT NULL,
            actual_seconds INTEGER NOT NULL,
            completed INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS presets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            config TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )
    conn.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_db.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add db.py tests/test_db.py
git commit -m "feat: add SQLite schema and connection"
```

### Task 2: Idempotent session insert + queries

**Files:**
- Modify: `db.py`
- Test: `tests/test_db.py`

**Interfaces:**
- Consumes: `connect` (Task 1).
- Produces: `insert_session`, `get_sessions`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_db.py  (append)
def _mk(id="a", started="2026-07-23T10:00:00Z", mode="pomodoro"):
    return dict(id=id, mode=mode, started_at=started,
                ended_at="2026-07-23T10:25:00Z",
                planned_seconds=1500, actual_seconds=1500, completed=1)

def test_insert_is_idempotent(tmp_path):
    conn = db.connect(str(tmp_path / "t.db"))
    assert db.insert_session(conn, _mk()) is True
    assert db.insert_session(conn, _mk()) is False  # same id, no dup
    assert len(db.get_sessions(conn, None, None)) == 1

def test_get_sessions_range_and_order(tmp_path):
    conn = db.connect(str(tmp_path / "t.db"))
    db.insert_session(conn, _mk(id="1", started="2026-07-20T10:00:00Z"))
    db.insert_session(conn, _mk(id="2", started="2026-07-22T10:00:00Z"))
    rows = db.get_sessions(conn, "2026-07-21T00:00:00Z", "2026-07-23T00:00:00Z")
    assert [r["id"] for r in rows] == ["2"]
    newest_first = db.get_sessions(conn, None, None)
    assert [r["id"] for r in newest_first] == ["2", "1"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_db.py -k "idempotent or range" -v`
Expected: FAIL with `AttributeError: module 'db' has no attribute 'insert_session'`

- [ ] **Step 3: Write minimal implementation**

```python
# db.py  (append)
def insert_session(conn, s):
    cur = conn.execute(
        """INSERT OR IGNORE INTO sessions
           (id, mode, started_at, ended_at, planned_seconds, actual_seconds, completed)
           VALUES (:id, :mode, :started_at, :ended_at, :planned_seconds, :actual_seconds, :completed)""",
        s,
    )
    conn.commit()
    return cur.rowcount == 1

def get_sessions(conn, frm, to):
    clauses, params = [], []
    if frm:
        clauses.append("started_at >= ?"); params.append(frm)
    if to:
        clauses.append("started_at < ?"); params.append(to)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM sessions {where} ORDER BY started_at DESC", params
    ).fetchall()
    return [dict(r) for r in rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_db.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add db.py tests/test_db.py
git commit -m "feat: idempotent session insert and range query"
```

### Task 3: Stats rollups (local-time bucketing)

**Files:**
- Modify: `db.py`
- Test: `tests/test_db.py`

**Interfaces:**
- Consumes: `insert_session` (Task 2).
- Produces: `get_stats`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_db.py  (append)
def test_stats_buckets_in_local_time(tmp_path):
    conn = db.connect(str(tmp_path / "t.db"))
    # 2026-07-23T02:30:00Z with tz offset -180 (UTC-3) => local 2026-07-22 23:30
    db.insert_session(conn, _mk(id="x", started="2026-07-23T02:30:00Z"))
    stats = db.get_stats(conn, None, None, tz_offset_minutes=-180)
    day = {d["date"]: d for d in stats["daily"]}
    assert "2026-07-22" in day
    assert day["2026-07-22"]["focus_seconds"] == 1500
    assert day["2026-07-22"]["blocks"] == 1
    assert stats["totals"]["all_time_blocks"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_db.py -k stats -v`
Expected: FAIL with `AttributeError: module 'db' has no attribute 'get_stats'`

- [ ] **Step 3: Write minimal implementation**

```python
# db.py  (top: add imports)
from datetime import datetime, timedelta, timezone

def _local_date(iso_utc, tz_offset_minutes):
    dt = datetime.fromisoformat(iso_utc.replace("Z", "+00:00"))
    local = dt.astimezone(timezone(timedelta(minutes=tz_offset_minutes)))
    return local.strftime("%Y-%m-%d")

def get_stats(conn, frm, to, tz_offset_minutes):
    rows = get_sessions(conn, frm, to)
    daily = {}
    for r in rows:
        d = _local_date(r["started_at"], tz_offset_minutes)
        b = daily.setdefault(d, {"date": d, "focus_seconds": 0, "blocks": 0})
        if r["mode"] == "pomodoro":
            b["focus_seconds"] += r["actual_seconds"]
            b["blocks"] += 1
    today = _local_date(
        datetime.now(timezone.utc).isoformat(), tz_offset_minutes
    )
    week_start = (
        datetime.strptime(today, "%Y-%m-%d") - timedelta(days=6)
    ).strftime("%Y-%m-%d")
    return {
        "daily": sorted(daily.values(), key=lambda x: x["date"]),
        "totals": {
            "today_seconds": daily.get(today, {}).get("focus_seconds", 0),
            "week_seconds": sum(
                v["focus_seconds"] for v in daily.values() if v["date"] >= week_start
            ),
            "all_time_blocks": sum(v["blocks"] for v in daily.values()),
        },
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_db.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add db.py tests/test_db.py
git commit -m "feat: local-time stats rollups"
```

### Task 4: Settings + presets CRUD

**Files:**
- Modify: `db.py`
- Test: `tests/test_db.py`

**Interfaces:**
- Produces: `get_settings`, `put_settings`, `list_presets`, `create_preset`, `delete_preset`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_db.py  (append)
def test_settings_roundtrip(tmp_path):
    conn = db.connect(str(tmp_path / "t.db"))
    assert db.get_settings(conn) is None
    db.put_settings(conn, {"theme": "ocean", "pomodoroDuration": 50})
    assert db.get_settings(conn)["theme"] == "ocean"
    db.put_settings(conn, {"theme": "mono"})   # overwrites
    assert db.get_settings(conn)["theme"] == "mono"

def test_presets_crud(tmp_path):
    conn = db.connect(str(tmp_path / "t.db"))
    p = db.create_preset(conn, "Deep Work Ocean", {"pomodoroDuration": 50, "theme": "ocean"})
    assert p["name"] == "Deep Work Ocean" and p["id"]
    assert len(db.list_presets(conn)) == 1
    assert db.delete_preset(conn, p["id"]) is True
    assert db.delete_preset(conn, "missing") is False
    assert db.list_presets(conn) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_db.py -k "settings_roundtrip or presets_crud" -v`
Expected: FAIL with `AttributeError: module 'db' has no attribute 'get_settings'`

- [ ] **Step 3: Write minimal implementation**

```python
# db.py  (top: add imports)
import json
import uuid

def get_settings(conn):
    row = conn.execute("SELECT data FROM settings WHERE id=1").fetchone()
    return json.loads(row["data"]) if row else None

def put_settings(conn, obj):
    conn.execute(
        "INSERT INTO settings (id, data) VALUES (1, ?) "
        "ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        (json.dumps(obj),),
    )
    conn.commit()

def list_presets(conn):
    rows = conn.execute(
        "SELECT id, name, config, created_at FROM presets ORDER BY created_at DESC"
    ).fetchall()
    return [{**dict(r), "config": json.loads(r["config"])} for r in rows]

def create_preset(conn, name, config):
    pid = uuid.uuid4().hex
    created = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO presets (id, name, config, created_at) VALUES (?, ?, ?, ?)",
        (pid, name, json.dumps(config), created),
    )
    conn.commit()
    return {"id": pid, "name": name, "config": config, "created_at": created}

def delete_preset(conn, preset_id):
    cur = conn.execute("DELETE FROM presets WHERE id=?", (preset_id,))
    conn.commit()
    return cur.rowcount == 1
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_db.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add db.py tests/test_db.py
git commit -m "feat: settings and presets CRUD"
```

### Task 5: New server `pomoflow.py` — static files, no heartbeat, from `web/`

**Files:**
- Create: `pomoflow.py`
- Create: `web/index.html` (temporary stub for this task: `<!doctype html><title>Pomoflow</title>ok`)
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `db.connect` (Task 1).
- Produces: `make_server(port, db_path, web_dir) -> (server, thread_start_callable)`; `PomoHandler`; module constants `DEFAULT_PORT=8888`. Serves files from `web/`. No `/heartbeat`, no `/shutdown`, no timeout thread.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_api.py
import json, threading, urllib.request, urllib.error
import pomoflow

def _start(tmp_path):
    srv = pomoflow.make_server(0, str(tmp_path / "t.db"), "web")
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    return srv, port

def _get(port, path):
    with urllib.request.urlopen(f"http://localhost:{port}{path}") as r:
        return r.status, r.read().decode()

def test_serves_index(tmp_path):
    srv, port = _start(tmp_path)
    try:
        status, body = _get(port, "/index.html")
        assert status == 200 and "ok" in body
    finally:
        srv.shutdown()

def test_no_heartbeat_endpoint(tmp_path):
    srv, port = _start(tmp_path)
    try:
        try:
            _get(port, "/heartbeat")
            assert False, "heartbeat should not exist"
        except urllib.error.HTTPError as e:
            assert e.code == 404
    finally:
        srv.shutdown()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_api.py -k "serves_index or no_heartbeat" -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pomoflow'`

- [ ] **Step 3: Write minimal implementation**

```python
# pomoflow.py
import http.server, socketserver, os, json
from functools import partial
import db as dbmod

DEFAULT_PORT = 8888

class PomoHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, directory=None, conn=None, **k):
        self.conn = conn
        super().__init__(*a, directory=directory, **k)

    def log_message(self, fmt, *args):
        pass  # quiet; API tasks add real logging if desired

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/":
            self.path = "/landing.html"
        if self.path.endswith(".html"):
            self.send_header  # no-op guard
        return super().do_GET()

class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

def make_server(port, db_path, web_dir):
    conn = dbmod.connect(db_path)
    handler = partial(PomoHandler, directory=web_dir, conn=conn)
    srv = ReusableTCPServer(("localhost", port), handler)
    srv.pomo_conn = conn
    return srv
```

Note: root `/` maps to `landing.html`; this task ships an `index.html` stub only, so tests hit `/index.html` directly. `landing.html` arrives in Task 13.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_api.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add pomoflow.py web/index.html tests/test_api.py
git commit -m "feat: new server serving web/ with no heartbeat"
```

## Phase 2 — REST API

### Task 6: `POST /api/sessions` (idempotent) + `GET /api/sessions`

**Files:**
- Modify: `pomoflow.py`
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `db.insert_session`, `db.get_sessions`.
- Produces: `POST /api/sessions` → `{created: bool}`; `GET /api/sessions?from=&to=` → `{sessions: [...]}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_api.py  (append)
def _post(port, path, obj):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(f"http://localhost:{port}{path}", data=data,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read())

def _sess(id="a"):
    return dict(id=id, mode="pomodoro", started_at="2026-07-23T10:00:00Z",
                ended_at="2026-07-23T10:25:00Z", planned_seconds=1500,
                actual_seconds=1500, completed=1)

def test_post_session_idempotent(tmp_path):
    srv, port = _start(tmp_path)
    try:
        assert _post(port, "/api/sessions", _sess())[1] == {"created": True}
        assert _post(port, "/api/sessions", _sess())[1] == {"created": False}
        status, body = _get(port, "/api/sessions")
        assert len(json.loads(body)["sessions"]) == 1
    finally:
        srv.shutdown()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_api.py -k post_session -v`
Expected: FAIL (405/404 — no POST handler yet)

- [ ] **Step 3: Write minimal implementation**

```python
# pomoflow.py  — add to PomoHandler
from urllib.parse import urlparse, parse_qs

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/sessions":
            q = parse_qs(parsed.query)
            rows = dbmod.get_sessions(self.conn, q.get("from", [None])[0], q.get("to", [None])[0])
            return self._send_json({"sessions": rows})
        if self.path == "/":
            self.path = "/landing.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/sessions":
            created = dbmod.insert_session(self.conn, self._read_json())
            return self._send_json({"created": created})
        self._send_json({"error": "not found"}, 404)
```

(Add `import db as dbmod` already present; add the `urllib.parse` import at top.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_api.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pomoflow.py tests/test_api.py
git commit -m "feat: sessions API (idempotent post + list)"
```

### Task 7: `GET /api/stats`, settings + presets endpoints, `POST /api/quit`

**Files:**
- Modify: `pomoflow.py`
- Test: `tests/test_api.py`

**Interfaces:**
- Produces: `GET /api/stats?from=&to=&tz=` → stats dict; `GET/PUT /api/settings`; `GET/POST /api/presets`, `DELETE /api/presets/:id`; `POST /api/quit` → `{quitting: true}` then triggers server shutdown.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_api.py  (append)
def _put(port, path, obj):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(f"http://localhost:{port}{path}", data=data,
                                 headers={"Content-Type": "application/json"}, method="PUT")
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read())

def test_stats_endpoint(tmp_path):
    srv, port = _start(tmp_path)
    try:
        _post(port, "/api/sessions", _sess())
        status, body = _get(port, "/api/stats?tz=0")
        assert json.loads(body)["totals"]["all_time_blocks"] == 1
    finally:
        srv.shutdown()

def test_settings_and_presets(tmp_path):
    srv, port = _start(tmp_path)
    try:
        _put(port, "/api/settings", {"theme": "ocean"})
        assert json.loads(_get(port, "/api/settings")[1])["theme"] == "ocean"
        created = _post(port, "/api/presets", {"name": "P1", "config": {"theme": "ocean"}})[1]
        assert created["name"] == "P1"
        assert len(json.loads(_get(port, "/api/presets")[1])["presets"]) == 1
    finally:
        srv.shutdown()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_api.py -k "stats_endpoint or settings_and_presets" -v`
Expected: FAIL (404s)

- [ ] **Step 3: Write minimal implementation**

```python
# pomoflow.py — extend do_GET / do_POST, add do_PUT / do_DELETE
    def do_GET(self):
        parsed = urlparse(self.path)
        p, q = parsed.path, parse_qs(parsed.query)
        if p == "/api/sessions":
            return self._send_json({"sessions": dbmod.get_sessions(
                self.conn, q.get("from", [None])[0], q.get("to", [None])[0])})
        if p == "/api/stats":
            tz = int(q.get("tz", ["0"])[0])
            return self._send_json(dbmod.get_stats(
                self.conn, q.get("from", [None])[0], q.get("to", [None])[0], tz))
        if p == "/api/settings":
            return self._send_json(dbmod.get_settings(self.conn) or {})
        if p == "/api/presets":
            return self._send_json({"presets": dbmod.list_presets(self.conn)})
        if self.path == "/":
            self.path = "/landing.html"
        return super().do_GET()

    def do_POST(self):
        p = urlparse(self.path).path
        if p == "/api/sessions":
            return self._send_json({"created": dbmod.insert_session(self.conn, self._read_json())})
        if p == "/api/presets":
            body = self._read_json()
            return self._send_json(dbmod.create_preset(self.conn, body["name"], body["config"]))
        if p == "/api/quit":
            self._send_json({"quitting": True})
            import threading; threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        self._send_json({"error": "not found"}, 404)

    def do_PUT(self):
        if urlparse(self.path).path == "/api/settings":
            dbmod.put_settings(self.conn, self._read_json())
            return self._send_json({"saved": True})
        self._send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        parts = urlparse(self.path).path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "presets":
            return self._send_json({"deleted": dbmod.delete_preset(self.conn, parts[2])})
        self._send_json({"error": "not found"}, 404)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_api.py -v`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add pomoflow.py tests/test_api.py
git commit -m "feat: stats, settings, presets, and quit endpoints"
```

## Phase 3 — Launcher, service model, Chrome app mode

### Task 8: `pomoflow` launcher — ensure-running, open, stop

**Files:**
- Create: `pomoflow` (executable, `#!/usr/bin/env python3`)
- Modify: `pomoflow.py` (add `run_detached_main()` entrypoint reused by launcher; port config load/save carried over from old `run.py`)
- Test: `tests/test_launcher.py`

**Interfaces:**
- Produces (in a shared module `launcher.py` imported by the `pomoflow` script so it is unit-testable): `is_server_up(port) -> bool`; `find_chrome() -> str|None`; `chrome_app_cmd(url, profile_dir) -> list[str]`; `resolve_port() -> int`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_launcher.py
import launcher

def test_is_server_up_false_on_closed_port():
    assert launcher.is_server_up(1) is False  # port 1 not listening

def test_chrome_app_cmd_shape():
    cmd = launcher.chrome_app_cmd("http://localhost:8888", "/tmp/prof")
    assert any(a.startswith("--app=") for a in cmd)
    assert any(a.startswith("--user-data-dir=") for a in cmd)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_launcher.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'launcher'`

- [ ] **Step 3: Write minimal implementation**

```python
# launcher.py
import os, sys, socket, subprocess, shutil, time, urllib.request

PROFILE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".chrome-profile")

def is_server_up(port):
    try:
        with socket.create_connection(("localhost", port), timeout=0.3):
            return True
    except OSError:
        return False

_CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
]

def find_chrome():
    for c in _CHROME_CANDIDATES:
        if os.path.isfile(c):
            return c
        found = shutil.which(c)
        if found:
            return found
    return None

def chrome_app_cmd(url, profile_dir):
    return [find_chrome() or "google-chrome",
            f"--app={url}", f"--user-data-dir={profile_dir}", "--new-window"]

def resolve_port():
    # reuse existing config loader for the saved port
    import pomoflow
    return pomoflow.load_config().get("port", pomoflow.DEFAULT_PORT)
```

```python
# pomoflow.py — port config carried over from old run.py (append)
import json as _json
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".pomodoro_config.json")

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE) as f:
                return {"port": DEFAULT_PORT, **_json.load(f)}
        except Exception:
            pass
    return {"port": DEFAULT_PORT}

def serve_main(port=None, db_path=None, web_dir=None):
    port = port or load_config().get("port", DEFAULT_PORT)
    db_path = db_path or os.path.join(os.path.dirname(os.path.abspath(__file__)), "pomoflow.db")
    web_dir = web_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
    srv = make_server(port, db_path, web_dir)
    print(f"Pomoflow running at http://localhost:{port}  (Ctrl+C or Quit button to stop)")
    try:
        srv.serve_forever()
    finally:
        srv.server_close()

if __name__ == "__main__":
    serve_main()
```

```python
# pomoflow  (executable launcher script)
#!/usr/bin/env python3
import os, sys, subprocess, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import launcher, pomoflow

def ensure_running(port):
    if launcher.is_server_up(port):
        return
    subprocess.Popen([sys.executable, os.path.join(os.path.dirname(__file__), "pomoflow.py")],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)
    for _ in range(50):
        if launcher.is_server_up(port):
            return
        time.sleep(0.1)

def open_window(port):
    url = f"http://localhost:{port}"
    chrome = launcher.find_chrome()
    if chrome:
        subprocess.Popen(launcher.chrome_app_cmd(url, launcher.PROFILE_DIR),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        import webbrowser; webbrowser.open(url)

def stop(port):
    import urllib.request
    try:
        urllib.request.urlopen(urllib.request.Request(
            f"http://localhost:{port}/api/quit", data=b"{}", method="POST"), timeout=2)
    except Exception:
        pass

def main():
    port = launcher.resolve_port()
    if len(sys.argv) > 1 and sys.argv[1] == "stop":
        stop(port); print("Pomoflow stopped."); return
    ensure_running(port)
    open_window(port)

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Make launcher executable + run tests**

Run:
```bash
chmod +x pomoflow
python3 -m pytest tests/test_launcher.py -v
```
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add pomoflow launcher.py pomoflow.py tests/test_launcher.py
git commit -m "feat: launcher with ensure-running, chrome app mode, stop"
```

### Task 9: `Pomoflow.app` bundle

**Files:**
- Create: `Pomoflow.app/Contents/Info.plist`
- Create: `Pomoflow.app/Contents/MacOS/Pomoflow` (executable shell script)

**Interfaces:** none (manual smoke test — no unit test; folded into this task's deliverable).

- [ ] **Step 1: Create the bundle files**

```xml
<!-- Pomoflow.app/Contents/Info.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Pomoflow</string>
  <key>CFBundleDisplayName</key><string>Pomoflow</string>
  <key>CFBundleIdentifier</key><string>local.pomoflow.app</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Pomoflow</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
```

```bash
# Pomoflow.app/Contents/MacOS/Pomoflow
#!/bin/bash
# Resolve the repo root relative to this bundle (bundle lives at repo root).
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec /usr/bin/env python3 "$DIR/pomoflow"
```

- [ ] **Step 2: Make the bundle executable + smoke test**

Run:
```bash
chmod +x "Pomoflow.app/Contents/MacOS/Pomoflow"
open "Pomoflow.app"
```
Expected: a Chrome app window opens at the timer; `curl -s localhost:8888/index.html` returns HTML. Then `./pomoflow stop`.

- [ ] **Step 3: Commit**

```bash
git add Pomoflow.app
git commit -m "feat: double-click Pomoflow.app front door"
```

## Phase 4 — Client: extract, resume, API wiring

### Task 10: Extract CSS/JS from monolith into `web/`

**Files:**
- Create: `web/css/app.css`, `web/js/timer.js`, `web/js/api.js`
- Rewrite: `web/index.html` (replace stub) — copy the `<body>` markup from the original `index.html` (git history `HEAD:index.html`), link external `css/app.css` and `js/timer.js` instead of inline blocks
- Reference: original inline `<style>` (lines 8–1150) and `<script>` (1450–2880) in `HEAD:index.html`

**Interfaces:**
- Produces: `web/js/timer.js` with the existing timer functions (module-scoped); `web/js/api.js` per interface in File Structure.

- [ ] **Step 1: Extract, don't rewrite.** Move the original inline `<style>` contents verbatim into `web/css/app.css`; move the inline `<script>` contents into `web/js/timer.js`. In `web/index.html`, keep the original body markup and replace the inline blocks with:

```html
<link rel="stylesheet" href="/css/app.css">
<script type="module" src="/js/timer.js"></script>
```

Delete the heartbeat block from `timer.js` (the `sendHeartbeat`, `MAX_FAILURES`, `showDisconnected`, `beforeunload sendBeacon`, and the `setInterval(sendHeartbeat, 2000)` lines — lines ~2794–2845 of the original).

- [ ] **Step 2: Add `web/js/api.js`**

```javascript
// web/js/api.js
async function call(method, path, body) {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
export const api = {
  logSession: (s) => call("POST", "/api/sessions", s),
  getSessions: (from, to) => call("GET", `/api/sessions?from=${from ?? ""}&to=${to ?? ""}`),
  getStats: (tz) => call("GET", `/api/stats?tz=${tz}`),
  getSettings: () => call("GET", "/api/settings"),
  putSettings: (o) => call("PUT", "/api/settings", o),
  listPresets: () => call("GET", "/api/presets"),
  createPreset: (name, config) => call("POST", "/api/presets", { name, config }),
  deletePreset: (id) => call("DELETE", `/api/presets/${id}`),
  quit: () => call("POST", "/api/quit", {}),
};
```

- [ ] **Step 3: Manual verify**

Run: `python3 pomoflow.py &` then open `http://localhost:8888/index.html`.
Expected: timer renders and runs exactly as before (themes, fonts, styles, sounds work). Stop with `./pomoflow stop`.

- [ ] **Step 4: Commit**

```bash
git add web/ && git commit -m "refactor: extract timer CSS/JS into web/, remove heartbeat, add api.js"
```

### Task 11: Pure resume-reconcile logic

**Files:**
- Create: `web/js/resume.js`
- Test: `tests/resume.test.mjs`

**Interfaces:**
- Produces: `reconcile(snapshot, nowMs, getDurationSeconds)` per File Structure.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/resume.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile } from "../web/js/resume.js";

const dur = () => 1500; // 25 min

test("resumes a still-running block with correct remaining", () => {
  const snap = { id: "a", mode: "pomodoro", startTime: 1000, plannedSeconds: 1500, isRunning: true };
  const r = reconcile(snap, 1000 + 600 * 1000, dur); // 600s elapsed
  assert.equal(r.action, "resume");
  assert.equal(r.remainingSeconds, 900);
});

test("completes a block that finished while away", () => {
  const snap = { id: "a", mode: "pomodoro", startTime: 1000, plannedSeconds: 1500, isRunning: true };
  const r = reconcile(snap, 1000 + 2000 * 1000, dur); // 2000s elapsed > 1500
  assert.equal(r.action, "complete");
  assert.equal(r.completedBlock.id, "a");
  assert.equal(r.completedBlock.actual_seconds, 1500);
  assert.equal(r.completedBlock.completed, 1);
});

test("returns fresh on missing/corrupt snapshot", () => {
  assert.equal(reconcile(null, 5, dur).action, "fresh");
  assert.equal(reconcile({ bogus: true }, 5, dur).action, "fresh");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/resume.test.mjs`
Expected: FAIL (cannot find `reconcile` export)

- [ ] **Step 3: Write minimal implementation**

```javascript
// web/js/resume.js
function isValid(s) {
  return s && typeof s.startTime === "number" && typeof s.plannedSeconds === "number"
    && typeof s.mode === "string" && typeof s.id === "string";
}

export function reconcile(snapshot, nowMs, getDurationSeconds) {
  if (!isValid(snapshot)) return { action: "fresh" };
  const elapsed = Math.floor((nowMs - snapshot.startTime) / 1000);
  if (elapsed >= snapshot.plannedSeconds) {
    const endMs = snapshot.startTime + snapshot.plannedSeconds * 1000;
    return {
      action: "complete",
      completedBlock: {
        id: snapshot.id,
        mode: snapshot.mode,
        started_at: new Date(snapshot.startTime).toISOString(),
        ended_at: new Date(endMs).toISOString(),
        planned_seconds: snapshot.plannedSeconds,
        actual_seconds: snapshot.plannedSeconds,
        completed: 1,
      },
    };
  }
  return { action: "resume", remainingSeconds: snapshot.plannedSeconds - elapsed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/resume.test.mjs`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add web/js/resume.js tests/resume.test.mjs
git commit -m "feat: pure resume-reconcile logic with tests"
```

### Task 12: Wire persistence, resume, and session logging into the timer

**Files:**
- Modify: `web/js/timer.js`
- Manual test (DOM integration; reconcile logic already unit-tested in Task 11)

**Interfaces:**
- Consumes: `reconcile` (Task 11), `api` (Task 10).

- [ ] **Step 1: Persist a live snapshot.** In `timer.js`, add and call `saveSnapshot()` from `startTimer`, `pauseTimer`, `switchMode`, and each tick where state changes:

```javascript
import { reconcile } from "/js/resume.js";
import { api } from "/js/api.js";

const SNAP_KEY = "pomoflow-snapshot";
function saveSnapshot() {
  if (!state.currentBlockId) state.currentBlockId = crypto.randomUUID();
  localStorage.setItem(SNAP_KEY, JSON.stringify({
    id: state.currentBlockId,
    mode: state.mode,
    startTime: state.startTime,             // epoch ms set when a block starts
    plannedSeconds: getDuration(state.mode),
    isRunning: state.isRunning,
  }));
}
function clearSnapshot() { localStorage.removeItem(SNAP_KEY); state.currentBlockId = null; }
```

- [ ] **Step 2: Log completed blocks idempotently.** In `onTimerComplete`, before advancing, post the block:

```javascript
async function logCurrentBlock(completed = 1, actualSeconds = null) {
  const startMs = state.startTime;
  const planned = getDuration(state.mode);
  await api.logSession({
    id: state.currentBlockId || crypto.randomUUID(),
    mode: state.mode,
    started_at: new Date(startMs).toISOString(),
    ended_at: new Date().toISOString(),
    planned_seconds: planned,
    actual_seconds: actualSeconds ?? planned,
    completed,
  });
  clearSnapshot();
}
```

Call `logCurrentBlock(1)` in `onTimerComplete` (all modes, so breaks are logged too), and `logCurrentBlock(0, elapsedSoFar)` inside `skipTimer` when a running block is skipped.

- [ ] **Step 3: Reconcile on load.** In `init()`, after `loadSettings()`:

```javascript
function restoreFromSnapshot() {
  const snap = JSON.parse(localStorage.getItem(SNAP_KEY) || "null");
  const r = reconcile(snap, Date.now(), getDuration);
  if (r.action === "resume") {
    state.currentBlockId = snap.id;
    state.mode = snap.mode;
    switchMode(snap.mode);
    state.timeRemaining = r.remainingSeconds;
    if (snap.isRunning) startTimer();   // continues from remaining
    updateDisplay();
  } else if (r.action === "complete") {
    api.logSession(r.completedBlock);   // idempotent
    clearSnapshot();
    advanceToNextMode();
  }
}
```

Replace the old `loadState()` reset with `restoreFromSnapshot()`.

- [ ] **Step 4: Manual verify (the disconnect fix).**

Run `python3 pomoflow.py &`, open the timer, start a pomodoro, note remaining time, hard-refresh (Cmd-R). Expected: it resumes within ~1s of the same remaining time and keeps running. Let one complete → `curl -s "localhost:8888/api/sessions" | python3 -m json.tool` shows the block. Start another, close the tab, wait past its end, reopen → the completed block is logged once (no duplicate).

- [ ] **Step 5: Commit**

```bash
git add web/js/timer.js
git commit -m "feat: persist and resume live timer, log completed blocks"
```

## Phase 5 — Settings persistence, presets, clock-style on front page

### Task 13: Landing page + Timer⇆Dashboard header nav

**Files:**
- Create: `web/landing.html`
- Modify: `web/index.html` (add header with nav + Quit button)
- Modify: `web/css/app.css` (header styles)

- [ ] **Step 1: Landing page**

```html
<!-- web/landing.html -->
<!doctype html>
<meta charset="utf-8"><title>Pomoflow</title>
<link rel="stylesheet" href="/css/app.css">
<main class="landing">
  <h1>Pomoflow</h1>
  <nav class="landing-nav">
    <a class="landing-card" href="/index.html">▶ Timer</a>
    <a class="landing-card" href="/dashboard.html">▤ Dashboard</a>
  </nav>
</main>
```

- [ ] **Step 2: Header nav + Quit in `index.html`.** Add a top header:

```html
<header class="app-header">
  <a href="/index.html" class="nav-active">Timer</a>
  <a href="/dashboard.html">Dashboard</a>
  <button id="quit-btn" class="quit-btn" title="Stop Pomoflow">⏻ Quit</button>
</header>
```

Wire in `timer.js`:

```javascript
document.getElementById("quit-btn").addEventListener("click", async () => {
  await api.quit();
  document.body.innerHTML = "<main class='landing'><h1>Pomoflow stopped.</h1>" +
    "<p>You can close this window.</p></main>";
});
```

- [ ] **Step 3: Manual verify.** Visit `/` → landing routes to both pages; Quit button stops the server (subsequent `curl localhost:8888` fails).

- [ ] **Step 4: Commit**

```bash
git add web/landing.html web/index.html web/css/app.css
git commit -m "feat: landing page, header nav, and quit button"
```

### Task 14: Server-backed settings with localStorage cache + migration

**Files:**
- Modify: `web/js/timer.js` (`loadSettings`, `saveSettings`)

**Interfaces:**
- Consumes: `api.getSettings`, `api.putSettings`.

- [ ] **Step 1: Load from server, fall back to cache, migrate once.**

```javascript
async function loadSettings() {
  const cached = JSON.parse(localStorage.getItem("pomodoro-settings") || "null");
  const res = await api.getSettings();
  let server = res.ok ? res.data : null;
  if (server && Object.keys(server).length) {
    Object.assign(settings, server);
  } else if (cached) {
    Object.assign(settings, cached);      // migrate existing localStorage → server
    await api.putSettings(settings);
  }
  localStorage.setItem("pomodoro-settings", JSON.stringify(settings));
}

async function saveSettings() {
  localStorage.setItem("pomodoro-settings", JSON.stringify(settings));
  await api.putSettings(settings);        // durable
}
```

`init()` must `await loadSettings()` before applying theme/style (make `init` async).

- [ ] **Step 2: Manual verify.** Change a setting, restart server, reload → setting persists. Clear localStorage only, reload → setting still comes back from the server.

- [ ] **Step 3: Commit**

```bash
git add web/js/timer.js
git commit -m "feat: server-backed durable settings with cache + migration"
```

### Task 15: Presets (save/apply/delete) covering timing + appearance

**Files:**
- Modify: `web/index.html` (Presets UI in settings modal, Timing group)
- Modify: `web/js/timer.js` (preset logic)

**Interfaces:**
- Consumes: `api.listPresets`, `api.createPreset`, `api.deletePreset`.

- [ ] **Step 1: Preset snapshot fields.** Define exactly which settings a preset captures:

```javascript
const PRESET_FIELDS = [
  "pomodoroDuration", "shortBreakDuration", "longBreakDuration",
  "autoStartBreaks", "autoStartPomodoros",
  "theme", "timerStyle", "timerFont", "colorBackground", "hideBgWhenRunning",
];
function snapshotConfig() {
  return Object.fromEntries(PRESET_FIELDS.map(k => [k, settings[k]]));
}
async function saveCurrentAsPreset(name) {
  await api.createPreset(name, snapshotConfig());
  await renderPresets();
}
async function applyPreset(config) {
  Object.assign(settings, config);
  await saveSettings();
  applyTheme(settings.theme);
  updateTimerStyle(); updateTimerFont(); updateColorBackground();
  state.timeRemaining = getDuration(state.mode); updateDisplay();
}
```

- [ ] **Step 2: Render the preset list** in the Timing group with name, Apply, and Delete (× ) controls, plus a "Save current as preset" input+button that calls `saveCurrentAsPreset`.

```javascript
async function renderPresets() {
  const res = await api.listPresets();
  const list = document.getElementById("preset-list");
  list.innerHTML = "";
  (res.ok ? res.data.presets : []).forEach(p => {
    const row = document.createElement("div");
    row.className = "preset-row";
    row.innerHTML = `<span>${p.name}</span>`;
    const apply = document.createElement("button"); apply.textContent = "Apply";
    apply.onclick = () => applyPreset(p.config);
    const del = document.createElement("button"); del.textContent = "×";
    del.onclick = async () => { await api.deletePreset(p.id); renderPresets(); };
    row.append(apply, del); list.appendChild(row);
  });
}
```

Call `renderPresets()` in `openSettings()`.

- [ ] **Step 3: Manual verify.** Set 50/10 + ocean + flip, save as "Deep Work Ocean". Change everything, click Apply → durations, theme, and style all restore. Delete removes it. Restart server → preset persists.

- [ ] **Step 4: Commit**

```bash
git add web/index.html web/js/timer.js
git commit -m "feat: named presets snapshotting timing + appearance"
```

### Task 16: Move clock-style switcher onto the timer screen + ultrawide scaling

**Files:**
- Modify: `web/index.html` (add on-screen style switcher; remove style control from settings)
- Modify: `web/css/app.css` (viewport-scaled timer, big centered layout)
- Modify: `web/js/timer.js` (wire on-screen switcher to `updateTimerStyle`)

- [ ] **Step 1: On-screen style switcher.** Add near the mode tabs:

```html
<div class="style-switch" role="tablist" aria-label="Clock style">
  <button data-style="minimal">Minimal</button>
  <button data-style="circular">Circular</button>
  <button data-style="flip">Flip</button>
</div>
```

```javascript
document.querySelectorAll(".style-switch button").forEach(b =>
  b.addEventListener("click", () => {
    settings.timerStyle = b.dataset.style;
    updateTimerStyle(); saveSettings();
    document.querySelectorAll(".style-switch button").forEach(x =>
      x.classList.toggle("active", x === b));
  }));
```

Remove the timer-style selector from the settings modal (Appearance group).

- [ ] **Step 2: Ultrawide scaling.** Replace the fixed `.container { max-width: 480px }` with a viewport-responsive layout:

```css
.container {
  width: min(92vw, 900px);
  margin: 0 auto;
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; min-height: calc(100vh - var(--header-h, 56px));
}
.timer-display { font-size: clamp(4rem, 18vw, 16rem); line-height: 1; }
.progress-ring { width: clamp(240px, 44vh, 560px); height: clamp(240px, 44vh, 560px); }
@media (min-width: 1600px) { .container { width: min(70vw, 1100px); } }
```

(Adjust the flip-clock and circular sizes to inherit from these clamps.)

- [ ] **Step 3: Manual verify.** On a wide window the timer is large and centered (not a small island). The on-screen switcher changes styles instantly and the choice persists across reload.

- [ ] **Step 4: Commit**

```bash
git add web/index.html web/css/app.css web/js/timer.js
git commit -m "feat: on-screen clock-style switcher and ultrawide scaling"
```

## Phase 6 — Dashboard

### Task 17: Pure chart geometry + bucketing helpers

**Files:**
- Create: `web/js/charts.js`
- Test: `tests/charts.test.mjs`

**Interfaces:**
- Produces: `bucketDaily`, `barGeometry`, `heatmapCells` per File Structure.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/charts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketDaily, barGeometry, heatmapCells } from "../web/js/charts.js";

test("bucketDaily sums pomodoro focus per local day", () => {
  const sessions = [
    { mode: "pomodoro", started_at: "2026-07-23T02:30:00Z", actual_seconds: 1500 },
    { mode: "pomodoro", started_at: "2026-07-23T03:00:00Z", actual_seconds: 1500 },
    { mode: "shortBreak", started_at: "2026-07-23T03:30:00Z", actual_seconds: 300 },
  ];
  const out = bucketDaily(sessions, 0); // UTC
  const day = Object.fromEntries(out.map(d => [d.date, d]));
  assert.equal(day["2026-07-23"].focusSeconds, 3000);
  assert.equal(day["2026-07-23"].blocks, 2);
});

test("barGeometry scales tallest bar to full height", () => {
  const g = barGeometry([0, 50, 100], { width: 30, height: 100, gap: 0 });
  assert.equal(g[2].h, 100);
  assert.equal(g[0].h, 0);
});

test("heatmapCells assigns level 0 for empty days", () => {
  const cells = heatmapCells([{ date: "2026-07-23", focusSeconds: 0, blocks: 0 }],
                             { weeks: 1, cell: 10, gap: 2 });
  assert.equal(cells[0].level, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/charts.test.mjs`
Expected: FAIL (missing exports)

- [ ] **Step 3: Write minimal implementation**

```javascript
// web/js/charts.js
function localDate(iso, tzOffsetMinutes) {
  const d = new Date(iso);
  const shifted = new Date(d.getTime() + tzOffsetMinutes * 60000);
  return shifted.toISOString().slice(0, 10);
}

export function bucketDaily(sessions, tzOffsetMinutes) {
  const map = new Map();
  for (const s of sessions) {
    const date = localDate(s.started_at, tzOffsetMinutes);
    const b = map.get(date) || { date, focusSeconds: 0, blocks: 0 };
    if (s.mode === "pomodoro") { b.focusSeconds += s.actual_seconds; b.blocks += 1; }
    map.set(date, b);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function barGeometry(values, { width, height, gap }) {
  const max = Math.max(1, ...values);
  return values.map((v, i) => {
    const h = Math.round((v / max) * height);
    return { x: i * (width + gap), y: height - h, w: width, h };
  });
}

export function heatmapCells(daily, { weeks, cell, gap }) {
  const byDate = new Map(daily.map(d => [d.date, d]));
  const max = Math.max(1, ...daily.map(d => d.focusSeconds));
  const level = (s) => (s <= 0 ? 0 : Math.min(4, 1 + Math.floor((s / max) * 3.999)));
  const cells = [];
  daily.forEach((d, i) => {
    const col = Math.floor(i / 7), row = i % 7;
    cells.push({
      x: col * (cell + gap), y: row * (cell + gap),
      date: d.date, focusSeconds: d.focusSeconds, level: level(d.focusSeconds),
    });
  });
  return cells;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/charts.test.mjs`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add web/js/charts.js tests/charts.test.mjs
git commit -m "feat: pure chart geometry and daily bucketing helpers"
```

### Task 18: Dashboard page rendering

**Files:**
- Create: `web/dashboard.html`, `web/css/dashboard.css`, `web/js/dashboard.js`

**Interfaces:**
- Consumes: `api.getStats`, `api.getSessions` (Task 10), `barGeometry`, `heatmapCells`, `bucketDaily` (Task 17).

- [ ] **Step 1: Page shell** with the shared header (Timer active-swapped to Dashboard), three stat tiles, a trends `<svg>`, a heatmap `<svg>`, and a recent-sessions `<table>`:

```html
<!-- web/dashboard.html -->
<!doctype html>
<meta charset="utf-8"><title>Pomoflow · Dashboard</title>
<link rel="stylesheet" href="/css/app.css">
<link rel="stylesheet" href="/css/dashboard.css">
<header class="app-header">
  <a href="/index.html">Timer</a>
  <a href="/dashboard.html" class="nav-active">Dashboard</a>
</header>
<main class="dash">
  <section class="tiles">
    <div class="tile"><span id="t-today">–</span><label>Today</label></div>
    <div class="tile"><span id="t-week">–</span><label>This week</label></div>
    <div class="tile"><span id="t-blocks">–</span><label>All-time blocks</label></div>
  </section>
  <section class="card"><h2>Focus time</h2><div id="trends"></div></section>
  <section class="card"><h2>Activity</h2><div id="heatmap"></div></section>
  <section class="card"><h2>Recent sessions</h2><table id="log"></table></section>
</main>
<script type="module" src="/js/dashboard.js"></script>
```

- [ ] **Step 2: Render logic** (inline SVG, colors via CSS custom properties so light/dark + colorblind-safe palette live in `dashboard.css`):

```javascript
// web/js/dashboard.js
import { api } from "/js/api.js";
import { bucketDaily, barGeometry, heatmapCells } from "/js/charts.js";

const tz = -new Date().getTimezoneOffset(); // minutes east of UTC
const fmt = (s) => `${Math.round(s / 60)}m`;

async function render() {
  const stats = (await api.getStats(tz)).data || { daily: [], totals: {} };
  document.getElementById("t-today").textContent = fmt(stats.totals.today_seconds || 0);
  document.getElementById("t-week").textContent = fmt(stats.totals.week_seconds || 0);
  document.getElementById("t-blocks").textContent = stats.totals.all_time_blocks || 0;

  const last14 = stats.daily.slice(-14);
  const bars = barGeometry(last14.map(d => d.focus_seconds), { width: 22, height: 160, gap: 8 });
  document.getElementById("trends").innerHTML =
    `<svg viewBox="0 0 ${14 * 30} 180" class="bars">` +
    bars.map((b, i) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"><title>${last14[i].date}: ${fmt(last14[i].focus_seconds)}</title></rect>`).join("") +
    `</svg>`;

  const cells = heatmapCells(stats.daily.slice(-119), { weeks: 17, cell: 13, gap: 3 });
  document.getElementById("heatmap").innerHTML =
    `<svg viewBox="0 0 ${17 * 16} ${7 * 16}" class="heat">` +
    cells.map(c => `<rect x="${c.x}" y="${c.y}" width="13" height="13" rx="2" class="lvl-${c.level}"><title>${c.date}: ${fmt(c.focusSeconds)}</title></rect>`).join("") +
    `</svg>`;

  const sess = (await api.getSessions()).data?.sessions || [];
  document.getElementById("log").innerHTML =
    "<tr><th>When</th><th>Mode</th><th>Length</th></tr>" +
    sess.slice(0, 30).map(s =>
      `<tr><td>${new Date(s.started_at).toLocaleString()}</td><td>${s.mode}</td><td>${fmt(s.actual_seconds)}</td></tr>`).join("");
}
render();
```

- [ ] **Step 3: Style** `dashboard.css` — tile grid, card spacing, and heatmap/bar colors driven by `--lvl-0..4` custom properties defined for both light and dark via `@media (prefers-color-scheme)`. Use a single-hue sequential ramp (colorblind-safe) for `.lvl-*` and the accent for `.bars rect`.

- [ ] **Step 4: Manual verify.** Complete a few pomodoros on the timer, open Dashboard → tiles, bars, heatmap, and log all reflect the data; hover shows tooltips; looks correct in both light and dark OS themes.

- [ ] **Step 5: Commit**

```bash
git add web/dashboard.html web/css/dashboard.css web/js/dashboard.js
git commit -m "feat: metrics dashboard with heatmap, trends, and log"
```

## Phase 7 — Cleanup & docs

### Task 19: Remove `run.py`, update `.gitignore` and README

**Files:**
- Delete: `run.py`
- Modify: `.gitignore` (add `pomoflow.db`, `pomoflow.db-wal`, `pomoflow.db-shm`, `.chrome-profile/`)
- Modify: `README.md`

- [ ] **Step 1: Update `.gitignore`**

Append:
```
pomoflow.db
pomoflow.db-wal
pomoflow.db-shm
.chrome-profile/
```

- [ ] **Step 2: Rewrite README** usage section: double-click `Pomoflow.app` (or `./pomoflow`), `./pomoflow stop`, dashboard, persistence, presets. Remove the "auto-close on tab close" line and add "runs until you Quit". Keep `--port` / `--set-port` docs (now on `pomoflow.py`).

- [ ] **Step 3: Delete `run.py`**

```bash
git rm run.py
```

- [ ] **Step 4: Full test sweep**

Run:
```bash
python3 -m pytest -v
node --test tests/*.mjs
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add .gitignore README.md && git commit -m "chore: remove run.py, ignore db + chrome profile, update README"
```

---

## Self-Review

**Spec coverage:**
- Service model (auto-start, survives close, no timeout, Quit) → Tasks 5, 7, 8, 13. ✓
- Front door (Pomoflow.app + landing + in-app nav) → Tasks 9, 13. ✓
- Own Chrome session (`--app` + dedicated profile) → Task 8. ✓
- SQLite session log → Tasks 1–2. ✓
- Live-timer resume (idempotent) → Tasks 11–12. ✓
- Durable server-backed settings + migration → Tasks 4, 7, 14. ✓
- Presets (timing + appearance, save-your-own) → Tasks 4, 7, 15. ✓
- Clock-style on timer screen → Task 16. ✓
- Ultrawide big centered layout → Task 16. ✓
- Sharpened grouped settings → Tasks 15, 16 (Appearance/Timing regrouping). ✓
- Dashboard (tiles, trends, heatmap, log; inline SVG; light/dark; colorblind-safe) → Tasks 17–18. ✓
- Architecture split → Tasks 5, 10, 19. ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code. Large existing CSS/JS is a *move* (Task 10) with the exact source lines cited from `HEAD:index.html` rather than reproduced. ✓

**Type consistency:** `reconcile` signature identical in Tasks 11/12; `api` method names identical in Tasks 10/12/14/15/18; `db` function names identical across Tasks 1–4 and 5–7; session dict keys (`id, mode, started_at, ended_at, planned_seconds, actual_seconds, completed`) consistent in db, API, resume, and timer. ✓
