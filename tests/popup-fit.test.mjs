// The quick-settings sheet is sized to fit: popup.js measures it and grows the
// popup to swallow the overflow, because the sheet is absolutely positioned and
// so adds no height of its own. This covers the growing.
//
// The CSS covers the other half — every box in the sheet is now sized off
// font-size rather than the face, so the measurement holds when a webfont lands
// — and that half is layout, which no shim can check. Eyeball it in Chrome.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/popup-dom.mjs';

const POPUP = new URL('../src/ui/popup.js', import.meta.url);

const NATURAL = 430;      // the popup's height from the timer view underneath
const BASE_CLIENT = 350;  // .qs-body's share of it

const IDS = [
    'timer-stage', 'start-btn', 'reset-btn', 'skip-btn', 'open-app-btn',
    'mode-label', 'session-counter', 'goal-progress', 'cycle-dots',
    'quick-settings', 'quick-settings-btn', 'qs-close', 'qs-themes',
    'qs-pomodoro', 'qs-short-break', 'qs-long-break', 'qs-auto-breaks',
    'qs-auto-pomodoros', 'qs-notifications', 'qs-font', 'qs-sound', 'qs-play',
    'qs-muted', 'qs-reset', 'qs-reset-note',
    // The theme editor, which merged in alongside this fix.
    'qs-title', 'qs-theme-editor', 'qs-theme-name', 'qs-mode-swatches',
    'qs-hue', 'qs-sat', 'qs-light', 'qs-hex', 'qs-theme-cancel',
    'qs-theme-save', 'qs-theme-delete',
];

let bootCount = 0;

async function boot() {
    const { document, registry } = installDom({ ids: IDS });

    // The clock the surface paints into.
    const stage = registry.get('timer-stage');
    const display = document.createElement('div');
    display.setAttribute('id', 'timer-display');
    display.id = 'timer-display';
    stage.appendChild(display);

    // The scroll box fitSheet measures, inside the sheet it looks for it in.
    const qsBody = document.createElement('div');
    qsBody.className = 'qs-body';
    registry.get('quick-settings').appendChild(qsBody);
    registry.get('quick-settings').hidden = true;

    // fitSheet clears body.minHeight before it measures, so both of these are
    // the natural, un-grown numbers every time — the same order the browser
    // recomputes them in.
    Object.defineProperty(document.body, 'offsetHeight', { get: () => NATURAL });
    Object.defineProperty(qsBody, 'clientHeight', { get: () => BASE_CLIENT });
    qsBody.scrollHeight = BASE_CLIENT;   // no overflow to begin with

    // The font <select> the picker wraps.
    const font = registry.get('qs-font');
    font.options = [
        { value: 'system', textContent: 'System' },
        { value: 'orbitron', textContent: 'Orbitron' },
    ];
    font.value = 'system';

    const settings = {
        pomodoroDuration: 25, shortBreakDuration: 5, longBreakDuration: 15,
        autoStartBreaks: false, autoStartPomodoros: false, notifications: true,
        timerFont: 'system', sound: 'chime', volume: 0.5, theme: 'dusk',
        timerStyle: 'minimal', colorBackground: false, hideBgWhenRunning: false,
        recentThemes: [],
    };
    const state = {
        settings,
        customThemes: {},
        timer: { mode: 'pomodoro', isRunning: false, endsAt: Date.now() + 1500000, plannedSeconds: 1500 },
        cycle: { totalPomodoros: 0, sessionGoal: 8, pomodorosInCycle: 0 },
    };

    const store = new Map();
    globalThis.chrome = {
        runtime: { sendMessage: async () => JSON.parse(JSON.stringify(state)) },
        storage: {
            local: {
                get: async (keys) => {
                    const out = {};
                    for (const k of [].concat(keys)) if (store.has(k)) out[k] = store.get(k);
                    return out;
                },
                set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
            },
            onChanged: { addListener: () => {} },
        },
    };

    // Query-busted: popup.js binds its listeners at import time, so a cached
    // module would leave every test after the first driving the first one's DOM.
    await import(`${POPUP}?boot=${bootCount++}`);
    // Let the module's first GET_STATE settle.
    await new Promise(r => setTimeout(r, 0));
    return { document, registry, qsBody, font };
}

// Opening the sheet, with everything already fitting: no growth, no scrollbar.
test('a sheet that fits leaves the popup alone', async () => {
    const { document, registry } = await boot();
    registry.get('quick-settings-btn').click();
    await new Promise(r => setTimeout(r, 0));

    assert.equal(registry.get('quick-settings').hidden, false);
    assert.equal(document.body.style.minHeight, '');
});

// The bug in the screenshot: the face arrives after the sheet was measured.
test('the popup regrows when the webfont lands after the sheet opened', async () => {
    const { document, registry, qsBody } = await boot();
    registry.get('quick-settings-btn').click();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(document.body.style.minHeight, '', 'nothing to fit in the fallback face');

    // Orbitron swaps in and every row gets a little taller.
    qsBody.scrollHeight = BASE_CLIENT + 40;
    await document.fonts.land();

    assert.equal(document.body.style.minHeight, `${NATURAL + 40}px`);
});

// And the other route to the same place: picking a face while the sheet is open.
test('picking a taller face refits the sheet', async () => {
    const { document, registry, qsBody, font } = await boot();
    registry.get('quick-settings-btn').click();
    await new Promise(r => setTimeout(r, 0));

    font.value = 'orbitron';
    qsBody.scrollHeight = BASE_CLIENT + 26;
    font.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    assert.equal(document.body.style.minHeight, `${NATURAL + 26}px`);
});

// Chrome hard-caps the popup at 600px: past that the *document* scrolls and the
// sheet's own header goes with it, which is worse than the valve.
test('growth stops short of Chrome 600px popup cap', async () => {
    const { document, registry, qsBody } = await boot();
    registry.get('quick-settings-btn').click();
    await new Promise(r => setTimeout(r, 0));

    qsBody.scrollHeight = BASE_CLIENT + 400;   // wants 830px
    await document.fonts.land();

    assert.equal(document.body.style.minHeight, '590px');
});

// A second fit must not stack on the first.
test('refitting is idempotent', async () => {
    const { document, registry, qsBody } = await boot();
    registry.get('quick-settings-btn').click();
    qsBody.scrollHeight = BASE_CLIENT + 40;
    await document.fonts.land();
    const once = document.body.style.minHeight;
    await document.fonts.land();
    assert.equal(document.body.style.minHeight, once);
});

// Closing hands the height back, so the timer view is not left padded out.
test('closing releases the grown height', async () => {
    const { document, registry, qsBody } = await boot();
    registry.get('quick-settings-btn').click();
    qsBody.scrollHeight = BASE_CLIENT + 40;
    await document.fonts.land();
    assert.notEqual(document.body.style.minHeight, '');

    registry.get('qs-close').click();
    assert.equal(document.body.style.minHeight, '');
});
