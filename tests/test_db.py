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
