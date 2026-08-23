// The shared renderer behind both the popup and the full page.
//
// It holds no authoritative state. It reads a snapshot from the service worker,
// derives the display from `endsAt` on every frame, and sends commands back.
// That is why the popup closing, or two surfaces being open at once, changes
// nothing: they are all reading the same deadline.

import { remaining, formatTime, sessionLabel } from '../core/clock.js';
import { FONT_STACKS, MODE_LABELS } from '../core/defaults.js';
import { resolveTheme } from '../core/themes.js';
import { createMinimal } from './render/minimal.js';
import { createCircular } from './render/circular.js';
import { createFlip } from './render/flip.js';

export function send(type, extra = {}) {
    return chrome.runtime.sendMessage({ type, ...extra });
}

export function createSurface({ stage, onState, updateTitle = false, alwaysSeen = false }) {
    // The popup is capped around 800x600 and deliberately omits the flip clock,
    // so a surface builds only the renderers whose markup it actually has and
    // falls back to minimal for any style it cannot show.
    const nodes = {
        minimal: stage.querySelector('#timer-display'),
        circular: stage.querySelector('#timer-circular'),
        flip: stage.querySelector('#timer-flip'),
    };
    const renderers = {};
    if (nodes.minimal) renderers.minimal = createMinimal(nodes.minimal);
    if (nodes.circular) renderers.circular = createCircular(nodes.circular);
    if (nodes.flip) renderers.flip = createFlip(nodes.flip);

    const styleFor = (style) => (renderers[style] ? style : 'minimal');

    let state = null;
    let frame = null;
    let lastStyle = null;
    let lastMode = null;

    // ===== appearance =====

    function applyAppearance() {
        const { settings, customThemes, timer } = state;
        const root = document.documentElement;
        const theme = resolveTheme(settings.theme, customThemes);

        // Only the three mode accents are set here. `--accent` is left to CSS,
        // which already derives it (:root falls back to --pomodoro-accent, and
        // body.short-break / body.long-break redirect it). Setting --accent to
        // a literal colour instead would freeze it: hovering a theme swatch
        // updates the three accent variables, and a literal --accent would not
        // follow, killing the live preview in pomodoro mode.
        root.style.setProperty('--pomodoro-accent', theme.pomodoro);
        root.style.setProperty('--short-break-accent', theme.shortBreak);
        root.style.setProperty('--long-break-accent', theme.longBreak);
        root.style.setProperty('--timer-font', FONT_STACKS[settings.timerFont] || FONT_STACKS.system);

        document.body.classList.remove('short-break', 'long-break');
        if (timer.mode === 'shortBreak') document.body.classList.add('short-break');
        if (timer.mode === 'longBreak') document.body.classList.add('long-break');

        const showBg = settings.colorBackground &&
            !(settings.hideBgWhenRunning && timer.isRunning);
        document.body.classList.toggle('color-bg', showBg);
    }

    // Show exactly one clock style. Switching styles (or modes) resets the flip
    // clock's digit tracking so it paints its new value outright instead of
    // animating from a stale one.
    function applyStyle() {
        const style = styleFor(state.settings.timerStyle);
        if (nodes.minimal) nodes.minimal.classList.toggle('hidden', style !== 'minimal');
        if (nodes.circular) nodes.circular.classList.toggle('active', style === 'circular');
        if (nodes.flip) nodes.flip.classList.toggle('active', style === 'flip');

        document.querySelectorAll('.style-switch button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.style === state.settings.timerStyle);
        });

        if (style !== lastStyle) {
            Object.values(renderers).forEach(r => r.reset());
            lastStyle = style;
        }
    }

    // ===== per-frame paint =====

    function paint() {
        if (!state) return;
        const { timer, settings } = state;
        const ms = remaining(timer, Date.now());
        const plannedMs = timer.plannedSeconds * 1000;

        renderers[styleFor(settings.timerStyle)].render(ms, plannedMs);

        if (updateTitle) {
            document.title = `${formatTime(Math.ceil(ms / 1000))} — Pomoflow`;
        }
    }

    function loop() {
        paint();
        frame = requestAnimationFrame(loop);
    }

    // ===== state =====

    function apply(next) {
        if (!next || next.error) return;
        state = next;

        if (state.timer.mode !== lastMode) {
            Object.values(renderers).forEach(r => r.reset());
            lastMode = state.timer.mode;
        }

        applyAppearance();
        applyStyle();
        paint();
        if (onState) onState(state);
        acknowledge();
    }

    // ===== acknowledging the end-of-block "!" =====
    //
    // A surface the user can see means they know a block finished, so the
    // toolbar's "!" has done its job and the Pomoflow mark can come back. Only
    // the alert is spent here; the block stays unstarted.
    //
    // WHICH surfaces can be open without being seen is the whole subtlety here,
    // and the first version got it backwards.
    //
    // The popup passes alwaysSeen, because it exists only as a direct result of
    // clicking the toolbar icon and Chrome destroys it the moment focus moves.
    // It cannot be open-but-unseen, so there is nothing to gate — and gating it
    // anyway is what made the first version fail to dismiss on the very click
    // that opened it, since a popup document does not reliably report
    // visibilityState 'visible' by the time the first state lands.
    //
    // The full page and the pop-out are the ones that genuinely can be buried —
    // the pop-out is *built* to be parked on a second monitor — so they stay
    // gated, and re-check on visibilitychange and focus so the window raised an
    // hour later acknowledges then rather than when it was opened. Written as
    // "not hidden" so an absent or unexpected value errs towards dismissing
    // rather than towards nagging.
    //
    // No loop, despite acknowledge() -> apply() -> acknowledge(): the worker
    // answers with `attention` already false, and `acking` guards the window in
    // between.
    let acking = false;

    function seen() {
        return alwaysSeen || document.visibilityState !== 'hidden';
    }

    async function acknowledge() {
        if (acking || !state || !state.timer.attention) return;
        if (!seen()) return;
        acking = true;
        try {
            apply(await send('ACKNOWLEDGE'));
        } catch (e) {
            // An unreachable worker (mid-update, say) must not surface as a page
            // error on something this incidental — the next focus tries again.
            console.warn('Pomoflow: could not acknowledge the finished block', e);
        } finally {
            acking = false;
        }
    }

    document.addEventListener('visibilitychange', acknowledge);
    window.addEventListener('focus', acknowledge);

    async function refresh() {
        apply(await send('GET_STATE'));
    }

    // A command's response is the fresh full state, so the UI never has to
    // guess what the service worker did with it.
    async function command(type, extra) {
        apply(await send(type, extra));
    }

    // Keeps every open surface in sync — popup, full page, and pop-out window
    // all re-read when the service worker writes.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.timer || changes.settings ||
            changes.cycle || changes.customThemes)) {
            refresh();
        }
    });

    function start() {
        refresh();
        if (frame === null) loop();
    }

    function stop() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
    }

    return {
        start, stop, refresh, command, apply, paint,
        get state() { return state; },
    };
}

// Shared bits of chrome that both surfaces render the same way.
export function renderCycleDots(container, cycle, mode) {
    container.innerHTML = '';
    for (let i = 0; i < 4; i++) {
        const dot = document.createElement('span');
        dot.className = 'cycle-dot';
        if (i < cycle.pomodorosInCycle) dot.classList.add('filled');
        if (i === cycle.pomodorosInCycle && mode === 'pomodoro') dot.classList.add('current');
        container.appendChild(dot);
    }
}

export function modeLabel(mode) {
    return MODE_LABELS[mode] || mode;
}

export { sessionLabel };
