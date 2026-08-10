// The quick-settings sheet is sized to fit: it is as tall as its content, and
// popup.js grows the popup to match, because an absolutely positioned sheet adds
// no height of its own. Nothing inside it scrolls. This covers the growing.
//
// The CSS carries the other half — every box in the sheet is sized off font-size
// rather than the face, so what gets measured is the final height — and that half
// is layout, which no shim can check. Eyeball it in Chrome.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/popup-dom.mjs';

const POPUP = new URL('../src/ui/popup.js', import.meta.url);

const NATURAL = 430;   // the popup's height from the timer view underneath
const SHORT = 300;     // a sheet that fits inside it (the theme editor's view)

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

    const sheet = registry.get('quick-settings');
    const qsBody = document.createElement('div');
    qsBody.className = 'qs-body';
    sheet.appendChild(qsBody);
    sheet.hidden = true;
    // The other sheet over the timer. Hidden here so the box being measured is
    // unambiguously this one — popup.html carries the attribute, the shim's
    // auto-created nodes do not. Its own fitting is covered in popup-stats.
    // getElementById, not registry.get: only ids in IDS are pre-created, and the
    // stats sheet is not one this file otherwise touches.
    document.getElementById('stats-sheet').hidden = true;

    // fitSheet clears body.minHeight before it measures, so both of these are
    // the natural, un-grown numbers every time — the same order the browser
    // recomputes them in. The sheet's own height is the measurement now: it is
    // pinned top/left/right with a free bottom, so it is as tall as its content.
    Object.defineProperty(document.body, 'offsetHeight', { get: () => NATURAL });
    sheet.offsetHeight = SHORT;   // shorter than the timer view to begin with

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
    return { document, registry, sheet, font };
}

// A sheet shorter than the timer view already fits inside the popup.
test('a sheet that fits leaves the popup alone', async () => {
    const { document, registry } = await boot();
    registry.get('quick-settings-btn').click();
    await new Promise(r => setTimeout(r, 0));

    assert.equal(registry.get('quick-settings').hidden, false);
    assert.equal(document.body.style.minHeight, '');
});

// The whole job: the popup ends up exactly as tall as the sheet, so the sheet
// never has to scroll any part of itself.
test('a taller sheet grows the popup to its own height', async () => {
    const { document, registry, sheet } = await boot();
    sheet.offsetHeight = 508;
    registry.get('quick-settings-btn').click();
    await new Promise(r => setTimeout(r, 0));

    assert.equal(document.body.style.minHeight, '508px');
});

// The face arrives after the sheet was measured — the sheet's own boxes hold
// still now, but the timer view it is measured against does not.
test('the popup regrows when the webfont lands after the sheet opened', async () => {
    const { document, registry, sheet } = await boot();
    registry.get('quick-settings-btn').click();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(document.body.style.minHeight, '', 'nothing to fit in the fallback face');

    sheet.offsetHeight = NATURAL + 40;
    await document.fonts.land();

    assert.equal(document.body.style.minHeight, `${NATURAL + 40}px`);
});

// And the other route to the same place: picking a face while the sheet is open.
test('picking a taller face refits the sheet', async () => {
    const { document, registry, sheet, font } = await boot();
    registry.get('quick-settings-btn').click();
    await new Promise(r => setTimeout(r, 0));

    font.value = 'orbitron';
    sheet.offsetHeight = NATURAL + 26;
    font.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    assert.equal(document.body.style.minHeight, `${NATURAL + 26}px`);
});

// Chrome hard-caps the popup at 600px. Asking for more than it can give only
// moves the scrollbar onto the document, so stop short and let it clip.
test('growth stops short of Chrome 600px popup cap', async () => {
    const { document, registry, sheet } = await boot();
    registry.get('quick-settings-btn').click();
    await new Promise(r => setTimeout(r, 0));

    sheet.offsetHeight = 830;
    await document.fonts.land();

    assert.equal(document.body.style.minHeight, '590px');
});

// A second fit must not stack on the first.
test('refitting is idempotent', async () => {
    const { document, registry, sheet } = await boot();
    registry.get('quick-settings-btn').click();
    sheet.offsetHeight = NATURAL + 40;
    await document.fonts.land();
    const once = document.body.style.minHeight;
    await document.fonts.land();
    assert.equal(document.body.style.minHeight, once);
});

// Closing hands the height back, so the timer view is not left padded out.
test('closing releases the grown height', async () => {
    const { document, registry, sheet } = await boot();
    registry.get('quick-settings-btn').click();
    sheet.offsetHeight = NATURAL + 40;
    await document.fonts.land();
    assert.notEqual(document.body.style.minHeight, '');

    registry.get('qs-close').click();
    assert.equal(document.body.style.minHeight, '');
});

// Sam asked for no scrollbar in the sheet at all — it took up width it had not
// earned, and the width it took added a row of swatches, which kept it there. So
// this is a rule about the CSS, not about behaviour: nothing inside the sheet may
// become a scroll container again.
test('nothing in the sheet is a scroll container', async () => {
    const css = readFileSync(new URL('../src/css/popup.css', import.meta.url), 'utf8');
    const offenders = [];
    // One match per rule: no leading `}` in the pattern, or it would eat each
    // rule's closing brace and then only see every other rule.
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (!/^[.\w\s,>:="[\]()-]+$/.test(selector)) continue;
        if (!/\.qs-|\.quick-settings/.test(selector)) continue;
        if (/scrollbar/.test(selector)) offenders.push(selector);
        const overflow = m[2].match(/(?:^|;|\s)overflow(?:-y|-x)?:\s*(auto|scroll)/);
        if (overflow) offenders.push(`${selector} { ${overflow[0].trim()} }`);
    }
    assert.deepEqual(offenders, [], 'the sheet grew a scrollbar back');
});
