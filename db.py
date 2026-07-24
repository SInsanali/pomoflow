import sqlite3
from datetime import datetime, timedelta, timezone

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
