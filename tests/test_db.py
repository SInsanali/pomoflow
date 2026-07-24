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
