# Pomoflow

A minimalist Pomodoro timer as a Chrome extension. It logs every focus block,
survives a browser restart mid-block, and shows a metrics dashboard.

No accounts. No tracking. No network access. No host permissions — Pomoflow
cannot see any page you visit.

## Install

Not on the Chrome Web Store yet, so load it unpacked:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and choose this repository's root folder
4. Pin Pomoflow to the toolbar so you can see the countdown

## Using it

Click the toolbar icon for the popup — mode tabs, the clock, start/reset/skip,
and the four cycle dots. The **open-in-new-tab** button opens the full page with
the big clock, the dashboard, and every setting; the **gear** opens quick
settings in place: every theme, the timer font, the three durations, the chime
(picking one plays it), auto-start, and notifications, with *Reset settings* at
the bottom. Volume and the custom theme editor stay in the full page.

The chromeless **pop-out** window — the one you park on a second monitor — is in
the full page's own header.

The timer does not live in any of those windows. Close the popup, close every
tab, quit Chrome entirely — the block keeps its deadline and resolves correctly
when you come back.

**Ambient time:** while a block runs, the toolbar icon *is* the number — the
whole minutes remaining, drawn in the current mode's accent colour, with no mark
behind it and no badge pill on top. The tooltip shows `MM:SS`. Idle, the static
Pomoflow mark comes back. Minutes rather than seconds is deliberate: Chrome's
background alarms cannot fire more often than every 30 seconds, and an extension
may not keep a background process alive just to tick a clock. For a live
second-by-second countdown, use the pop-out.

**Global hotkeys** (rebindable at `chrome://extensions/shortcuts`):

| Shortcut | Action |
|---|---|
| `Alt+Shift+P` | Start / pause |
| `Alt+Shift+R` | Reset the block |
| `Alt+Shift+N` | Skip to the next block |
| `Alt+Shift+O` | Open the full page |

With the popup or full page focused, the v1 keys still work: `Space`, `R`, `N`.

## Features

- **Timer modes**: Pomodoro (25 min), Short Break (5 min), Long Break (15 min)
- **Clock styles**: Minimal, Circular progress, Flip clock (the flip clock and
  the dashboard are full-page only — the popup is too small for them)
- **Timer fonts**: 7 built-in (Inter, Poppins, Montserrat, Raleway, JetBrains
  Mono, Space Mono, Orbitron)
- **17 colour themes** plus custom themes with per-mode colour pickers
- **Presets**: save the current timing + appearance as a named preset
- **Desktop notifications and a sound** at the end of every block, whether or
  not any Pomoflow window is open
- **Dashboard**: today / this-week focus time, all-time block count, a 14-day
  bar chart, a 17-week activity heatmap, and a recent-sessions log
- **Session logging**, deduplicated by a client-generated UUID, so a block is
  never recorded twice
- **JSON export / import** — see Backups below
- **Cycle model**: breaks start themselves, the next focus block waits for you.
  A long break lands after every 4 pomodoros.

## Backups

**Uninstalling the extension deletes your history.** There is no database file
to copy any more, so **Settings → Data → Export Data** is your only backup. It
writes one JSON file containing sessions, settings, custom themes, and presets.

Import merges rather than replaces and skips sessions it already has, so
importing the same file twice is harmless.

It also reads exports from v1 (both the SQLite dump and the older
settings-only export), which is how you carry your history across.

## How it works

The one rule that shapes the whole design: **nothing counts down.**

`chrome.storage.local` holds `endsAt`, an absolute timestamp. Every surface —
toolbar, popup, full page, pop-out — derives `remaining = endsAt - now`. A
missed tick, a suspended service worker, a closed popup, or a laptop that slept
for an hour all resolve correctly on the next read, because there is no counter
to drift.

- **`src/background/service-worker.js`** is the only authority. It owns block
  completion, the toolbar action, notifications, and the cycle. It holds no
  in-memory state that matters, because Chrome kills it after ~30 seconds idle.
- Two alarms, deliberately: a **one-shot** alarm at `endsAt` for correctness,
  and a **repeating 30s** alarm purely to repaint the icon. The second is
  best-effort and self-correcting — a skipped fire still renders the right
  number, since it is computed from `endsAt`, never decremented.
- **`src/background/icon.js`** rasterises that number. `chrome.action.setIcon`
  only takes bitmaps and a service worker has no DOM canvas, so the minutes are
  drawn with `OffscreenCanvas` at 16px and 32px. What keeps 16 pixels legible:
  the glyph always takes the full icon height, sized from its **measured** ink
  box rather than an assumed cap ratio, and a two-digit number is **condensed
  horizontally** rather than scaled down — scaling down uniformly leaves `16` at
  about 60% height, which reads as small beside other extensions. The number is
  flat accent colour with no outline; the cost is that a pale accent (mono,
  coffee) is low contrast on a *light* toolbar.
- **`src/core/`** is pure: no `chrome.*`, no DOM, every function takes `now`
  explicitly. That is what makes the timer arithmetic unit-testable.
- The popup and full page are **pure renderers**. They read a snapshot, send
  commands, and re-render on `chrome.storage.onChanged` — which is why two open
  surfaces stay in sync without talking to each other.
- End-of-block audio plays from an **offscreen document**, since service workers
  have no `AudioContext`. Sound failure never blocks block completion.

A paused block stores `remainingMs` and drops `endsAt` entirely, so it cannot
bleed wall-clock time while you are away.

## Development

```bash
node --test tests/*.mjs     # timer arithmetic, storage, migration, charts
python3 tools/make-icons.py # regenerate src/icons/*.png
python3 -m http.server 8731 # then open /tools/icon-preview.html to proof the
                            # drawn minutes icon on light and dark toolbars
```

There is no build step and no dependencies — the extension loads the source
directly.

## v1 (Python server)

Pomoflow used to be a local Python HTTP server plus a launcher that opened a
dedicated Chrome window. That version is preserved at the **`v1.0-server`** tag:

```bash
git checkout v1.0-server
```

The rewrite dropped the server, the port, the `.app` bundle, and the SQLite
file. In exchange the extension gets a live toolbar countdown, notifications
that fire with nothing open, and (next) site blocking during focus blocks —
none of which a localhost page can do.

## License

MIT
