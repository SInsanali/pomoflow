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
