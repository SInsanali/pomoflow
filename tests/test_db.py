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
