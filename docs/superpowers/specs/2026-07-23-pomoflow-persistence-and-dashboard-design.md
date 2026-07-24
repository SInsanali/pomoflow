# Pomoflow: Persistence, Metrics Dashboard & UI Polish — Design

**Date:** 2026-07-23
**Status:** Approved design, pending spec review

## Goal

Turn Pomoflow from an ephemeral, single-file timer into a durable study tool that:

- Persists live timer state so a disconnect/refresh resumes exactly where you left off.
- Logs every completed focus block to a local database.
- Presents those metrics on a polished dashboard (calendar heatmap + focus-time trends).
- Runs as an auto-starting local service that survives the tab closing (no auto-close timeout).
- Opens in its own isolated Chrome session via a double-click app icon plus a friendly landing page.
- Scales up cleanly on ultrawide displays with a big centered timer, and has sharper, more intuitive settings.
- Adds durable, server-backed settings and named presets that snapshot both timing rhythm and appearance.

## Non-Goals

- No accounts, cloud sync, or multi-user support. Single user, localhost only.
- No external runtime dependencies for the core server/timer (zero-dependency promise preserved). The menu-bar variant was declined; the chosen front door needs no new packages.
- No always-on login daemon. The server auto-starts on demand and is stopped deliberately.
- Dashboard scope is limited to: calendar heatmap, focus-time trends, header stat tiles, and a recent-sessions log. Streaks/goals-over-time and time-of-day histograms were explicitly deferred (current daily goal counter stays).

## Current State (baseline)

- `run.py` (~400 lines): Python stdlib HTTP server on `localhost:8888`, serves `index.html` + fonts. Uses a heartbeat/`sendBeacon`/120s-timeout scheme to auto-kill itself when the tab closes.
- `index.html` (2,882 lines): all CSS and JS inline. Timer with 3 styles, 17 themes + custom editor, 7 fonts, 4 sounds, keyboard shortcuts.
- **Persistence gap:** `loadState()` resets counters to 0 on every load; `saveState()` only writes two integers that are then discarded. The running timer is never persisted. No session history, no metrics.

## Architecture

Split the monolith into focused pieces (the single 2,882-line file will not gracefully hold persistence + an API + a dashboard):

```
pomoflow.py          # server: static files + REST API + SQLite; NO heartbeat/timeout
pomoflow             # CLI launcher: ensure-running + open app-mode Chrome; `stop` subcommand
Pomoflow.app         # zero-dependency macOS bundle wrapping the launcher (double-click front door)
db.py                # SQLite schema + queries
web/
  landing.html       # friendly root page routing to Timer or Dashboard
  index.html         # timer (structure only)
  dashboard.html     # metrics page
  css/               # extracted shared styles
  js/                # extracted shared logic
pomoflow.db          # SQLite data (gitignored)
```

### Service model (auto-start on demand, survives tab close)

- The `pomoflow` launcher checks whether the server already answers on the configured port. If yes → just open the app window pointing at it. If no → start `pomoflow.py` **detached**, then open the window. The port check makes double-launch impossible.
- **All heartbeat / `/shutdown` / 120s-timeout code is removed.** The server simply runs.
- Stopping is deliberate: a **Quit button** in the UI (`POST /api/quit`) and a `./pomoflow stop` subcommand. A forgotten process is cheap (stdlib, ~0% idle CPU).

### Front door

- **`Pomoflow.app`**: a minimal macOS `.app` bundle whose executable invokes the `pomoflow` launcher. Drag to Dock/Applications; double-click ensures-running and opens the app-mode Chrome window. No terminal, no new dependencies.
- **Landing page** (`GET /`): if the user hits the server root directly, a friendly page routes clearly to **Timer** or **Dashboard** rather than dumping them somewhere.
- **In-app nav**: once running, Timer and Dashboard are two views with a header toggle; you never "launch" twice.

### Chrome in its own session

- Launched as `chrome --app=http://localhost:PORT --user-data-dir=<pomoflow-profile-dir>`.
- `--app` gives a chrome-less window (feels native); the dedicated `--user-data-dir` is a fully separate profile from normal browsing, with its own window and its own stable localStorage.
- Falls back to a normal browser tab if Chrome isn't found. Chrome binary resolved across macOS/Linux/Windows/WSL (reuse existing cross-platform detection approach).

## Data Model (SQLite)

### `sessions` — one row per completed focus block

| column | type | meaning |
|---|---|---|
| `id` | TEXT PK | client-generated UUID; makes logging idempotent (reconnect can't double-count) |
| `mode` | TEXT | `pomodoro` / `shortBreak` / `longBreak` |
| `started_at` | TEXT (UTC ISO8601) | block start |
| `ended_at` | TEXT (UTC ISO8601) | block end |
| `planned_seconds` | INTEGER | intended duration |
| `actual_seconds` | INTEGER | real elapsed focus time |
| `completed` | INTEGER (0/1) | ran to completion vs. skipped early |

Heatmap and trends are date-bucketed `SUM(actual_seconds)` / `COUNT(*)` queries over this table (bucketed in the user's local timezone).

### `settings` — durable app settings

- Single-row (or key/value) store holding the settings object (durations, auto-start, volume, sound, theme, timer style, font, appearance toggles, notifications, goal).
- Server is the source of truth; localStorage is a fast local cache. Existing export/import JSON remains as a manual backup.

### `presets` — named config snapshots

| column | type | meaning |
|---|---|---|
| `id` | TEXT PK | UUID |
| `name` | TEXT | user-supplied name |
| `config` | TEXT (JSON) | snapshot of **timing** (three durations, `autoStartBreaks`, `autoStartPomodoros`) **and appearance** (theme, timerStyle, timerFont, colorBackground, hideBgWhenRunning) |
| `created_at` | TEXT | timestamp |

Presets are user-saved only (no built-ins). Save current config → name it → switch/apply/delete in one click. Applying a preset overwrites the corresponding live settings fields.

## Live-Timer Resume (the disconnect fix)

The running timer is time-based, so the client persists a small snapshot to localStorage on every state change:

```
{ id, mode, startTime (epoch ms), plannedSeconds, isRunning }
```

On page load, reconcile:

- Compute `elapsed = now − startTime`.
- **Still within the block** → resume with exact remaining time (`plannedSeconds − elapsed`), no drift. Preserve running/paused state.
- **Would have completed while away** → `POST /api/sessions` for that block (idempotent by `id`), then advance to the next mode per the existing cycle logic.

Because Chrome uses the dedicated Pomoflow profile, this localStorage is stable across closes/reopens. Server = source of truth for **history**; localStorage = in-flight **timer**.

## REST API (same server)

| method + path | purpose |
|---|---|
| `POST /api/sessions` | log a completed block (idempotent by `id`) |
| `GET /api/sessions?from=&to=` | raw blocks for a date range (recent-sessions log) |
| `GET /api/stats?from=&to=` | rollups for tiles/trends/heatmap (daily/weekly aggregates) |
| `GET /api/settings` / `PUT /api/settings` | load/save durable settings |
| `GET /api/presets` / `POST /api/presets` / `DELETE /api/presets/:id` | manage presets |
| `POST /api/quit` | Quit button — deliberate shutdown |

All endpoints localhost-only, JSON bodies.

## UI

### Timer screen (big centered layout)

- Timer sizes with the viewport (`clamp()`-based) to fill an ultrawide comfortably, centered in a readable column — replaces the fixed 480px container.
- On-screen (not buried in settings): mode tabs, the **clock-style switcher** (minimal / circular / flip), and a compact "today" line (blocks done + focus time).
- Header: **Timer ⇆ Dashboard** toggle, settings gear, **Quit** button.

### Settings modal (sharpened)

Same content, clearer grouping and tighter, consistent controls, keyboard-dismiss:

- **Timing** — durations, auto-start, and **Presets** (save current / pick / apply / delete).
- **Appearance** — theme, font, background toggles (timer *style* moves out to the timer screen).
- **Sound** — sound choice + volume + test.
- **Notifications** — toggle + permission.
- **Data** — export / import JSON.

### Dashboard page

Driven by the API; charts hand-rolled as lightweight inline SVG (no chart library → preserves zero-dependency/offline promise). Follows dataviz guidance: colorblind-safe, legible in light and dark.

- **Header stat tiles** — today's focus time, this week's focus time, all-time blocks logged.
- **Focus-time trends** — bar chart, daily with a weekly toggle.
- **Calendar heatmap** — GitHub-style grid, cells shaded by daily focus time, hover shows the number.
- **Recent sessions** — simple log table of latest blocks.

## Error Handling

- **Server unreachable from a page** (e.g. server stopped): pages degrade gracefully — timer keeps running from localStorage; API writes queue/retry; a subtle "offline" indicator instead of the old forced-disconnect overlay. No auto-close.
- **DB write failures**: logged server-side; client retries idempotently by `id`.
- **Corrupt/missing localStorage snapshot**: fall back to a fresh timer at the configured duration.
- **Port busy**: existing find-available-port logic retained; launcher's port check targets the resolved port.
- **Chrome missing**: fall back to default browser tab.

## Testing

- **Python**: unit tests for `db.py` (schema, idempotent session insert by `id`, date-range rollups, settings/presets CRUD) and the API handlers (status codes, JSON shapes, idempotency). Launcher port-check/ensure-running logic tested where practical.
- **Client**: unit tests for the resume-reconcile logic (still-running, completed-while-away, corrupt snapshot) with mocked clock, and for date bucketing in local time.
- **Manual smoke**: double-click app → timer → complete a block → dashboard reflects it → close tab mid-block → reopen resumes correctly → Quit stops the server.

## Migration / Compatibility

- Existing localStorage settings are read once and migrated into the server `settings` store on first run.
- `.pomodoro_config.json` (port) behavior preserved.
- `pomoflow.db` added to `.gitignore`.
