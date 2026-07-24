# pomoflow

Minimalist Pomodoro timer backed by a small local Python service that logs every
focus block, resumes your live timer after a refresh or reconnect, and shows a
metrics dashboard.

No dependencies. No accounts. No tracking. Works offline. Just focus.

## Launch

**macOS:** double-click `Pomoflow.app`.

**Any platform:**

```bash
./pomoflow          # start the server if needed, open the timer
./pomoflow stop     # stop the server
```

`./pomoflow` starts the local server (if it isn't already running) and opens the
timer in its own Chrome app window (a dedicated profile, so it stays separate
from your normal browsing). Without Chrome it falls back to your default browser.

The server keeps running until you deliberately stop it — click **Quit** in the
header, or run `./pomoflow stop`. Closing or refreshing the tab does **not** stop
it, so your timer survives a reload.

## Features

- **Timer modes**: Pomodoro (25 min), Short Break (5 min), Long Break (15 min)
- **Clock styles**: Minimal, Circular progress, Flip clock — switched right on the
  timer screen, with a large layout that scales up on wide/ultrawide displays
- **Timer fonts**: 7 built-in fonts (Inter, Poppins, Montserrat, Raleway,
  JetBrains Mono, Space Mono, Orbitron)
- **17 color themes** plus custom themes you create with per-mode color pickers
- **Presets**: save the current timing + appearance as a named preset and apply
  it in one click
- **Durable settings**: preferences are stored server-side (SQLite) and survive
  restarts; existing browser settings migrate automatically on first run
- **Live-timer resume**: if you refresh or reconnect mid-block, the timer picks up
  where it left off; a block that finished while you were away is logged once
- **Dashboard**: today / this-week focus time, all-time block count, a 14-day
  focus-time bar chart, a 17-week activity heatmap, and a recent-sessions log
- **Session logging**: every completed block is recorded to a local SQLite
  database, idempotently (no duplicates on resume)
- **Cross-platform**: Windows, macOS, Linux, and WSL
- **Keyboard shortcuts**: Space (start/pause), R (reset), N (next)

## Requirements

- Python 3.7+ (standard library only — `http.server`, `sqlite3`)
- No external dependencies; no network access required

## Configuration

- **Port**: defaults to `8888`. To change it, create/edit `.pomodoro_config.json`
  in the repo root:

  ```json
  { "port": 8890 }
  ```

- **Data**: sessions, settings, and presets live in `pomoflow.db` (SQLite) in the
  repo root. It is created on first run and is git-ignored.

## How it works

1. `pomoflow.py` runs a local HTTP server that serves the pages in `web/` and a
   small JSON REST API backed by SQLite (`db.py`).
2. The `pomoflow` launcher ensures that server is up and opens an app-mode Chrome
   window pointed at it.
3. The timer persists a live snapshot to `localStorage`; on load it reconciles
   that snapshot against the wall clock to resume, complete, or start fresh.
4. Completed blocks POST to the API keyed by a client-generated UUID, so
   re-posting the same block never creates a duplicate.
5. The server has no inactivity timeout — it stops only via the Quit button or
   `./pomoflow stop`.

## Development

Run the test suites:

```bash
python3 -m pytest -v        # server + database tests
node --test tests/*.mjs     # client-logic tests (resume, chart geometry)
```

## License

MIT
