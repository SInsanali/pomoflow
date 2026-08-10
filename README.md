# Pomoflow

A minimalist Pomodoro timer as a Chrome extension. The toolbar icon *is* the
countdown, every focus block is logged to a dashboard, and a block survives
closing the popup, closing every tab, or quitting Chrome mid-block.

No accounts. No tracking. No network access. No host permissions — Pomoflow
cannot see any page you visit.

## Install

Not on the Chrome Web Store yet, so load it unpacked:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and choose this repository's root folder
4. Pin Pomoflow to the toolbar so you can see the countdown

## Using it

The **popup** is the everyday surface: mode tabs, the clock, start / reset /
skip, the cycle dots, and a gear for quick settings — themes, timer font,
durations, chime, auto-start, notifications.

The **full page** (open-in-new-tab, or `Alt+Shift+O`) adds the big clock, the
dashboard, every setting, and a chromeless **pop-out** window to park on a
second monitor.

While a block runs, the toolbar icon is the whole minutes remaining, drawn in
the current mode's accent colour; the tooltip shows `MM:SS`. When a block ends
and the next one is *not* set to auto-start, the icon turns into a **`!`** and
stays there until you act — a desktop notification is easy to miss, and the
popup is closed by definition.

Global hotkeys, rebindable at `chrome://extensions/shortcuts`:

| Shortcut | Action |
|---|---|
| `Alt+Shift+P` | Start / pause |
| `Alt+Shift+R` | Reset the block |
| `Alt+Shift+N` | Skip to the next block |
| `Alt+Shift+O` | Open the full page |

With the popup or full page focused, `Space`, `R` and `N` work too.

## Features

- Pomodoro, short break and long break, with a long break after every 4
  pomodoros. Breaks start themselves; the next focus block waits for you
- Three clock styles: minimal, circular progress, and a flip clock
- **25 built-in colour themes**, every accent contrast-checked against the dark
  surface, plus custom themes with per-mode colour pickers
- Eight timer faces, which dress the whole surface rather than only the clock
- Named presets for timing plus appearance
- A desktop notification and a chime at the end of every block, whether or not
  any Pomoflow window is open
- **Dashboard**: today and this week's focus time, all-time block count, a
  14-day bar chart, a 17-week activity heatmap, and a recent-sessions log
- JSON export / import, which also reads v1 exports

## Backups

**Uninstalling the extension deletes your history.** *Settings → Data → Export
Data* is the only backup — one JSON file holding sessions, settings, custom
themes, and presets. Import merges rather than replaces and skips sessions it
already has, so importing the same file twice is harmless.

## How it works

One rule shapes the whole design: **nothing counts down.** `chrome.storage.local`
holds `endsAt`, an absolute timestamp, and every surface derives
`remaining = endsAt - now`. A missed tick, a suspended service worker, a closed
popup, or a laptop that slept for an hour all resolve correctly on the next
read, because there is no counter to drift.

The service worker is the only authority — it owns block completion, the
toolbar, notifications, and the cycle. The popup, full page and pop-out are pure
renderers that read a snapshot, send commands, and re-render on
`chrome.storage.onChanged`, which is why two open surfaces stay in sync without
talking to each other.

[docs/architecture.md](docs/architecture.md) covers the rest: the two alarms,
the `OffscreenCanvas` toolbar icon, why the countdown is in minutes rather than
seconds, and where each module sits.

## Development

```bash
node --test tests/*.mjs      # timer arithmetic, storage, migration, charts,
                             # themes, popup fitting
python3 -m http.server 8731  # then /tools/icon-preview.html to proof the drawn
                             # icon on light and dark toolbars
```

There is no build step and no dependencies — the extension loads the source
directly. Two things to know before editing: the tests cover behaviour but
compute no layout, so CSS still needs eyeballing in Chrome, and `src/icons/*.png`
are artwork rather than build output. Both are explained in
[docs/architecture.md](docs/architecture.md).

## v1 (Python server)

Pomoflow used to be a local Python HTTP server plus a launcher that opened a
dedicated Chrome window. That version is preserved at the **`v1.0-server`** tag:

```bash
git checkout v1.0-server
```

The rewrite dropped the server, the port, the `.app` bundle, and the SQLite
file. In exchange the extension gets a live toolbar countdown and notifications
that fire with nothing open — neither of which a localhost page can do.

## License

MIT
