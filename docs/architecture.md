# Architecture

The detail behind the [README](../README.md)'s "How it works". One rule shapes
everything: **nothing counts down.**

## The timer

`chrome.storage.local` holds `endsAt`, an absolute timestamp. Every surface —
toolbar, popup, full page, pop-out — derives `remaining = endsAt - now`. A
missed tick, a suspended service worker, a closed popup, or a laptop that slept
for an hour all resolve correctly on the next read, because there is no counter
to drift.

A paused block stores `remainingMs` and drops `endsAt` entirely, so it cannot
bleed wall-clock time while you are away.

## Modules

- **`src/background/service-worker.js`** is the only authority. It owns block
  completion, the toolbar action, notifications, and the cycle. It holds no
  in-memory state that matters, because Chrome kills it after ~30 seconds idle.
- **`src/background/icon.js`** rasterises the minutes into the toolbar icon.
- **`src/core/`** is pure: no `chrome.*`, no DOM, every function takes `now`
  explicitly. That is what makes the timer arithmetic unit-testable.
- **`src/ui/`** is the popup and the full page. Both are **pure renderers** —
  they read a snapshot, send commands, and re-render on
  `chrome.storage.onChanged`, which is why two open surfaces stay in sync
  without talking to each other.
- **`src/store/`** holds the storage layer and the v1 → v2 migration.

## Two alarms, deliberately

A **one-shot** alarm at `endsAt` for correctness, and a **repeating 30s** alarm
purely to repaint the icon. The second is best-effort and self-correcting — a
skipped fire still renders the right number, since it is computed from `endsAt`
and never decremented.

## The toolbar icon

While a block runs the icon *is* the number: the whole minutes remaining, drawn
in the current mode's accent colour, with no mark behind it and no badge pill on
top. Minutes are rounded up, so the countdown ends …3, 2, 1.

`chrome.action.setIcon` only takes bitmaps and a service worker has no DOM
canvas, so the minutes are drawn with `OffscreenCanvas` at 16px and 32px. What
keeps 16 pixels legible:

- the glyph always takes the full icon height, sized from its **measured** ink
  box rather than an assumed cap ratio, and
- a two-digit number is **condensed horizontally** rather than scaled down —
  scaling down uniformly leaves `16` at about 60% height, which reads as small
  beside other extensions.

The number is flat accent colour with no outline; the cost is that a pale accent
(mono, coffee) is low contrast on a *light* toolbar.
`tools/icon-preview.html` exists to proof exactly that.

### Why minutes, not seconds

Chrome's background alarms cannot fire more often than every 30 seconds, and an
extension may not keep a background process alive just to tick a clock. So the
toolbar shows minutes and the tooltip carries `MM:SS`. For a live
second-by-second countdown, use the pop-out window.

### End-of-block `!`

When a block ends and the next one is not set to auto-start, the icon becomes a
**`!`**. A desktop notification is easy to miss, and the popup is closed by
definition, so the toolbar carries the news.

It is an **alert, not a status**: it lasts until it has been seen, then the
static Pomoflow mark comes back — the same thing the toolbar shows for any other
block that is not running. Opening the popup, the full page, or a pop-out is what
counts as seeing it, as is clicking the desktop notification.

Which surfaces can be open *without* being seen is the subtlety, and it is not
uniform:

- The **popup** is never gated. It exists only as a direct result of clicking the
  toolbar icon and Chrome destroys it the moment focus moves, so it cannot be
  open-but-unseen. Gating it on `document.visibilityState` anyway is a live trap:
  a popup document does not reliably report `'visible'` by the time the first
  state lands, so the icon click — the most obvious acknowledgment there is —
  silently failed to dismiss anything.
- The **full page** and the **pop-out** are gated, because they genuinely can be
  buried; the pop-out is *built* to be parked on a second monitor. They re-check
  on `visibilitychange` and `focus`, so a window raised an hour later
  acknowledges then. The test is "not `hidden`", so an unexpected value errs
  towards dismissing rather than towards nagging.

That is two facts with two different lifetimes, so the timer stores two flags:

- **`awaitingStart`** — this block was queued by a completion and has not been
  started. Survives acknowledgment, and is what the tooltip reads, so a
  dismissed `!` still leaves *"Study 2 — ready to start"* on hover.
- **`attention`** — the completion has not been seen yet. The **only** thing that
  draws the `!`.

Collapsing them into one flag forces a choice between a `!` that outlives being
seen and a tooltip that calls an unstarted block "paused". Starting, resetting,
skipping or switching mode clears both, as before.

The toolbar's whole vocabulary is therefore three signs, and deliberately no
more: **digits** = running, **`!`** = needs you, **the mark** = at rest. Drawing
the next block's minutes while it waits was the tempting fourth, and it is the
one thing that cannot be added — it is indistinguishable from a *running* block,
which would stop the icon answering the only question it exists to answer.

All block-end notifications share one id (`pomoflow-block-end`), so a completion
replaces the last notice instead of stacking another entry in the notification
centre, and one acknowledgment clears both channels.

## Sound

End-of-block audio plays from an **offscreen document**, since service workers
have no `AudioContext`. Sound failure never blocks block completion.

## Themes

A theme is just three accents; the CSS is entirely variable-driven
(`--pomodoro-accent` / `--short-break-accent` / `--long-break-accent`), so
switching themes and switching modes are the same mechanism.

Two rules govern the built-in set, and custom themes are nudged towards them:

- every accent clears **4.5:1** against the `#0d0d0d` surface (most clear 6:1),
  because an accent is both text and a fill with dark text on it, and
- the three accents in a theme sit at least ~18 ΔE apart, so focus, short break
  and long break read as three visibly different states.

Every theme id from v1 is kept, because `settings.theme`, `recentThemes` and
saved presets all store ids — a dropped id would silently reset someone to
`mono`.

## Sessions

Sessions are deduplicated by a client-generated UUID, so a block is never
recorded twice — which is also what makes re-importing the same export
harmless.

## Working on it

```bash
node --test tests/*.mjs
python3 -m http.server 8731   # then open /tools/icon-preview.html
```

No build step, no dependencies — the extension loads the source directly.

Two caveats:

- The tests cover **behaviour only**. `tests/helpers/popup-dom.mjs` computes no
  layout, so popup and full-page CSS still needs eyeballing in Chrome.
- `src/icons/*.png` are **artwork, not build output**. There is no vector master
  in the tree, so those four files are the source of truth and replacing the
  icon means replacing them. `tools/make-icons.py` still holds the recipe for
  the original generated mark (an orange disc with a quarter cut out) but
  refuses to run without `--force`, so it cannot quietly overwrite the artwork.
