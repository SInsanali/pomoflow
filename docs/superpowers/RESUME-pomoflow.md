# Pomoflow build — resume state (as of Task 12)

**Branch:** `feature/persistence-dashboard`
**Spec:** `docs/superpowers/specs/2026-07-23-pomoflow-persistence-and-dashboard-design.md`
**Plan:** `docs/superpowers/plans/2026-07-23-pomoflow-persistence-and-dashboard.md`
**Execution method:** superpowers:subagent-driven-development (fresh implementer + reviewer subagent per task; review gate between tasks; broad whole-branch review at the end).

## Done & reviewed clean (Tasks 1–12)

| Task | Commit | What |
|---|---|---|
| 1 | 73aadaa | `db.py` SQLite schema + connect |
| 2 | 19b17d1 | idempotent `insert_session` + `get_sessions` |
| 3 | cbd71d1 | `get_stats` local-time rollups |
| 4 | f22b1ad | settings + presets CRUD |
| 5 | 19a3e17 | new `pomoflow.py` serving `web/`, no heartbeat |
| 6 | 354c321 | sessions API (POST idempotent + GET) |
| 7 | 8a0296c | stats/settings/presets/quit API |
| 8 | 6085b74 (+ fix 26a3145) | `launcher.py` + `pomoflow` script (ensure-running, chrome app mode, stop) |
| 9 | d2b2432 | `Pomoflow.app` double-click bundle |
| 10 | 385653e | extracted CSS/JS into `web/`, removed heartbeat, added `api.js`; **fonts moved to `web/fonts/`**, URLs → `/fonts/…`; inline-handler fns exposed via `Object.assign(window, {...})` in timer.js |
| 11 | 8af987d | pure `reconcile()` in `web/js/resume.js` + node:test |
| 12 | a47d8a2 | wired snapshot persist + resume + idempotent block logging into `timer.js` (effective-anchor for pause/resume correctness) |

**Task 12 caveat:** implemented + committed + controller-verified (`node --check`, resume unit tests, API idempotency round-trip), but its **per-task reviewer gate did not run** (session ended). First step on resume: run the Task 12 review (BASE `8af987d` → HEAD `a47d8a2`; review package at `.superpowers/sdd/review-8af987d..a47d8a2.diff` if present, else regenerate), then proceed.

## Pending (Tasks 13–19)

13 landing page + header nav (Timer⇆Dashboard + Quit button) · 14 server-backed settings (load/cache/migrate) · 15 presets UI (timing+appearance snapshot) · 16 clock-style switcher on timer screen + ultrawide `clamp()` scaling · 17 `web/js/charts.js` geometry helpers + node:test · 18 dashboard page (tiles/trends/heatmap/log, inline SVG) · 19 cleanup (remove root `run.py`, gitignore `pomoflow.db*` + `.chrome-profile/`, rewrite README, full test sweep).

## Decisions locked

- **Python floor 3.7+** (relaxed from 3.6; `fromisoformat` allowed). README still says 3.6+ → fix in Task 19.
- **Fonts live in `web/fonts/`**, referenced as `/fonts/…` (server serves from `web/`).
- **timer.js is an ES module** → any function used by an inline HTML `onclick`/`onchange` must be added to the `Object.assign(window, {...})` block (Tasks 13/15/16 that add inline handlers must maintain this).
- Service model: launcher auto-starts server if down, server survives tab close, stops only via Quit button / `./pomoflow stop`. No heartbeat/timeout anywhere.

## Outstanding minor findings (for the final whole-branch review to triage)

- API handlers raise `KeyError`/`ValueError` on malformed input instead of returning 400 JSON (`pomoflow.py` do_POST create_preset, do_GET `tz` parse). Consolidate in a hardening pass.
- `POST /api/quit` has no automated test yet.
- `import threading` is inside `do_POST`; hoist to module top.
- Dead `disconnect-overlay` div + `.disconnect-*` CSS remain in `web/index.html`/`app.css` (heartbeat removal left them inert) — remove in Task 16 or 19.
- `pomoflow.db*` not yet gitignored (Task 19).

## Test commands

- Python: `python3 -m pytest -v`
- Client logic: `node --test tests/*.mjs`
