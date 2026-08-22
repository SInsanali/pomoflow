// The stats sheet, driven end to end: seed a session log into a fake
// chrome.storage.local, boot popup.js against the DOM shim, click the chart
// button, and read what it wrote. That covers the half of the feature the pure
// tests in charts.test.mjs cannot — the element ids, the fold from sessions to
// headline, and which sheet is on screen.
//
// It proves behaviour and never layout: the shim computes no boxes. Whether the
// bars are the right height on screen needs Chrome.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/popup-dom.mjs';

const POPUP = new URL('../src/ui/popup.js', import.meta.url);

const IDS = [
    'timer-stage', 'start-btn', 'reset-btn', 'skip-btn', 'open-app-btn',
    'mode-label', 'session-counter', 'goal-progress', 'cycle-dots',
    'quick-settings', 'quick-settings-btn', 'qs-close', 'qs-themes',
    'qs-pomodoro', 'qs-short-break', 'qs-long-break', 'qs-auto-breaks',
    'qs-auto-pomodoros', 'qs-notifications', 'qs-font', 'qs-sound', 'qs-play',
    'qs-muted', 'qs-reset', 'qs-reset-note',
    'qs-title', 'qs-theme-editor', 'qs-theme-name', 'qs-mode-swatches',
    'qs-hue', 'qs-sat', 'qs-light', 'qs-hex', 'qs-theme-cancel',
    'qs-theme-save', 'qs-theme-delete',
    // The sheet under test.
    'stats-sheet', 'stats-btn', 'stats-close', 's-ring', 's-ring-count',
    's-today', 's-today-sub', 's-avg', 's-plot', 's-days',
    's-week', 's-streak', 's-blocks', 's-empty',
];

// ONE storage area for the whole file, deliberately. storage.js caches the area
// the first store() call binds to, and popup.js is re-imported per boot while
// storage.js is not — so a per-boot area would leave every test after the first
// reading the first one's data. Tests seed and clear this instead.
const area = new Map();

let state = null;

globalThis.chrome = {
    runtime: { sendMessage: async () => JSON.parse(JSON.stringify(state)) },
    storage: {
        local: {
            get: async (keys) => {
                const out = {};
                for (const k of [].concat(keys)) if (area.has(k)) out[k] = area.get(k);
                return out;
            },
            set: async (obj) => {
                for (const [k, v] of Object.entries(obj)) area.set(k, v);
            },
        },
        onChanged: { addListener: () => {} },
    },
};

// Noon on a local calendar day, `n` days back. Noon rather than midnight so the
// instant is unambiguously inside that local day whatever the machine's zone is
// — which is what makes the expected bucket predictable without freezing time.
function localNoonDaysAgo(n) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d.toISOString();
}

const session = (daysAgo, mode, seconds) => ({
    id: `s-${daysAgo}-${mode}-${seconds}`,
    mode,
    started_at: localNoonDaysAgo(daysAgo),
    actual_seconds: seconds,
});

// today 3x25m, yesterday 2x25m, three days back 10m, plus a break that must not
// count and a pomodoro older than the window that counts only toward all-time.
const HISTORY = [
    session(0, 'pomodoro', 1500),
    session(0, 'pomodoro', 1500),
    session(0, 'pomodoro', 1500),
    session(0, 'shortBreak', 300),
    session(1, 'pomodoro', 1500),
    session(1, 'pomodoro', 1500),
    session(3, 'pomodoro', 600),
    session(30, 'pomodoro', 1500),
];

const TODAY_SECONDS = 4500;
const WEEK_SECONDS = 4500 + 3000 + 600;

let bootCount = 0;

async function boot({ sessions = [], sessionGoal = 4 } = {}) {
    area.clear();
    if (sessions.length) area.set('sessions', sessions);

    const { document, registry } = installDom({ ids: IDS });

    const stage = registry.get('timer-stage');
    const display = document.createElement('div');
    display.setAttribute('id', 'timer-display');
    display.id = 'timer-display';
    stage.appendChild(display);

    // Both sheets carry `hidden` in popup.html; the shim's auto-created nodes do
    // not, and "which sheet is open" is read off exactly this flag.
    registry.get('quick-settings').hidden = true;
    registry.get('stats-sheet').hidden = true;

    const font = registry.get('qs-font');
    font.options = [{ value: 'system', textContent: 'System' }];
    font.value = 'system';

    state = {
        settings: {
            pomodoroDuration: 25, shortBreakDuration: 5, longBreakDuration: 15,
            autoStartBreaks: false, autoStartPomodoros: false, notifications: true,
            timerFont: 'system', sound: 'chime', volume: 0.5, theme: 'nebula',
            timerStyle: 'minimal', colorBackground: false, hideBgWhenRunning: false,
            recentThemes: [],
        },
        customThemes: {},
        timer: {
            mode: 'pomodoro', isRunning: false,
            endsAt: Date.now() + 1500000, plannedSeconds: 1500,
        },
        cycle: { totalPomodoros: 6, sessionGoal, pomodorosInCycle: 2 },
    };

    // Query-busted: popup.js binds its listeners at import time, so a cached
    // module would leave every test after the first driving the first one's DOM.
    await import(`${POPUP}?boot=${bootCount++}`);
    await settle();
    return { document, registry };
}

// One macrotask drains the microtask queue behind it, which is all the fake
// storage reads need to resolve.
const settle = () => new Promise(r => setTimeout(r, 0));

async function openStats(registry) {
    registry.get('stats-btn').click();
    await settle();
}

test('the chart button opens the sheet and folds the log into the headline', async () => {
    const { registry } = await boot({ sessions: HISTORY });
    await openStats(registry);

    assert.equal(registry.get('stats-sheet').hidden, false, 'the sheet is up');
    assert.equal(registry.get('stats-btn').getAttribute('aria-expanded'), 'true');

    assert.equal(registry.get('s-today').textContent, '1h 15m',
                 'three pomodoros today, the break excluded');
    assert.equal(registry.get('s-today-sub').textContent, '3 of 4 pomodoros');
    assert.equal(registry.get('s-week').textContent, '2h 15m',
                 'the last seven days, without the 30-day-old block');
    assert.equal(registry.get('s-streak').textContent, '2',
                 'today and yesterday; the day before them is empty');
    assert.equal(registry.get('s-blocks').textContent, '7', 'every pomodoro ever');
    assert.equal(registry.get('s-avg').textContent, 'avg 19m',
                 'week total over seven days, including the empty ones');
});

test('the ring is an arc of the circumference, not a full circle', async () => {
    const { registry } = await boot({ sessions: HISTORY });
    await openStats(registry);

    const circumference = 2 * Math.PI * 42;
    const [filled, gap] = registry.get('s-ring')
        .getAttribute('stroke-dasharray').split(' ').map(Number);

    assert.ok(Math.abs(gap - circumference) < 1e-6, 'the gap is one whole turn');
    assert.ok(Math.abs(filled - circumference * 0.75) < 1e-6, '3 of 4 is three quarters');
    assert.equal(registry.get('s-ring-count').textContent, '3/4');
});

test('beating the goal fills the ring without wrapping past itself', async () => {
    const { registry } = await boot({ sessions: HISTORY, sessionGoal: 2 });
    await openStats(registry);

    const circumference = 2 * Math.PI * 42;
    const filled = Number(registry.get('s-ring')
        .getAttribute('stroke-dasharray').split(' ')[0]);

    assert.ok(Math.abs(filled - circumference) < 1e-6, 'clamped to one turn');
    assert.equal(registry.get('s-ring-count').textContent, '3/2',
                 'the true count still shows');
});

test('the strip is seven tracks plus the average, today last', async () => {
    const { registry } = await boot({ sessions: HISTORY });
    await openStats(registry);

    const plot = registry.get('s-plot');
    const mean = plot.children.filter(c => c.classList.contains('stats-mean'));
    const tracks = plot.children.filter(c => c.classList.contains('stats-track'));

    assert.equal(tracks.length, 7, 'one track per day of the window');
    assert.equal(mean.length, 1, 'and one average line');
    assert.ok(tracks.at(-1).classList.contains('today'), 'today is the last column');
    assert.ok(!tracks[0].classList.contains('today'));

    // Tallest day scales to the full track; the rest are proportional to it.
    const height = (track) => track.children[0].style.height;
    assert.equal(height(tracks.at(-1)), '100%', "today is the week's max");
    assert.equal(height(tracks.at(-2)),
                 `${(3000 / TODAY_SECONDS) * 100}%`, 'yesterday against today');
    assert.equal(height(tracks[4]), '0%', 'an empty day draws no bar at all');

    const meanPercent = (WEEK_SECONDS / 7 / TODAY_SECONDS) * 100;
    assert.equal(mean[0].style.bottom, `${meanPercent}%`);
});

test('the day initials line up one per bar, with today marked', async () => {
    const { registry } = await boot({ sessions: HISTORY });
    await openStats(registry);

    const labels = registry.get('s-days').children;
    assert.equal(labels.length, 7, 'one initial per track');
    for (const label of labels) {
        assert.match(label.textContent, /^[SMTWF]$/, 'a single weekday letter');
    }
    assert.ok(labels.at(-1).classList.contains('today'));
    assert.equal(labels.filter(l => l.classList.contains('today')).length, 1);
});

// An empty sheet plus a line of text would not show what the sheet is for, so
// the tracks and tiles still render — at zero.
test('an empty history renders zeros and says so, without dividing by zero', async () => {
    const { registry } = await boot({ sessions: [] });
    await openStats(registry);

    assert.equal(registry.get('s-today').textContent, '0m');
    assert.equal(registry.get('s-week').textContent, '0m');
    assert.equal(registry.get('s-avg').textContent, 'avg 0m');
    assert.equal(registry.get('s-streak').textContent, '0');
    assert.equal(registry.get('s-blocks').textContent, '0');
    assert.equal(registry.get('s-ring').getAttribute('stroke-dasharray').split(' ')[0], '0');
    assert.equal(registry.get('s-empty').hidden, false, 'the note explains the zeros');

    const plot = registry.get('s-plot');
    assert.equal(plot.children.filter(c => c.classList.contains('stats-track')).length, 7,
                 'the empty tracks still show the shape of the week');
    assert.equal(plot.children.filter(c => c.classList.contains('stats-mean')).length, 0,
                 'an average of zero would just be a second baseline');
});

test('the note is gone once anything has been logged', async () => {
    const { registry } = await boot({ sessions: HISTORY });
    await openStats(registry);
    assert.equal(registry.get('s-empty').hidden, true);
});

// The two sheets share one box and one measured height, so exactly one can be up.
test('opening stats closes quick settings, and the other way round', async () => {
    const { registry } = await boot({ sessions: HISTORY });

    registry.get('quick-settings-btn').click();
    await settle();
    assert.equal(registry.get('quick-settings').hidden, false);

    await openStats(registry);
    assert.equal(registry.get('stats-sheet').hidden, false, 'stats took over');
    assert.equal(registry.get('quick-settings').hidden, true, 'settings stepped aside');
    assert.equal(registry.get('quick-settings-btn').getAttribute('aria-expanded'), 'false');

    registry.get('quick-settings-btn').click();
    await settle();
    assert.equal(registry.get('quick-settings').hidden, false);
    assert.equal(registry.get('stats-sheet').hidden, true, 'and stats stepped aside');
    assert.equal(registry.get('stats-btn').getAttribute('aria-expanded'), 'false');
});

test('the chart button toggles, and the house closes', async () => {
    const { registry } = await boot({ sessions: HISTORY });

    await openStats(registry);
    await openStats(registry);
    assert.equal(registry.get('stats-sheet').hidden, true, 'a second click closes it');

    await openStats(registry);
    registry.get('stats-close').click();
    assert.equal(registry.get('stats-sheet').hidden, true, 'so does the house');
    assert.equal(registry.get('stats-btn').getAttribute('aria-expanded'), 'false');
});

test('closing stats hands the popup height back to the timer', async () => {
    const { document, registry } = await boot({ sessions: HISTORY });
    const sheet = registry.get('stats-sheet');
    Object.defineProperty(document.body, 'offsetHeight', { get: () => 430 });
    sheet.offsetHeight = 500;

    await openStats(registry);
    assert.equal(document.body.style.minHeight, '500px', 'the popup grew to the sheet');

    registry.get('stats-close').click();
    assert.equal(document.body.style.minHeight, '', 'and shrank back');
});

test('escape closes the stats sheet', async () => {
    const { document, registry } = await boot({ sessions: HISTORY });
    await openStats(registry);

    // On body, not on `document`: the shim's document.addEventListener delegates
    // to the body node, so that is where popup.js's handler actually lives.
    document.body.dispatchEvent({ type: 'keydown', code: 'Escape',
                                  target: document.body, preventDefault() {} });
    assert.equal(registry.get('stats-sheet').hidden, true);
});

// Sam asked for no scrollbar in the sheet next door, and the reason generalises:
// a bar inside a fixed-width popup takes width the content then has to fit in.
// This sheet is sized to its content too, so nothing in it may become a scroll
// container either. A rule about the CSS, not about behaviour.
test('nothing in the stats sheet is a scroll container', () => {
    const css = readFileSync(new URL('../src/css/popup.css', import.meta.url), 'utf8');
    const offenders = [];
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (!/^[.\w\s,>:="[\]()-]+$/.test(selector)) continue;
        if (!/\.stats-/.test(selector)) continue;
        if (/scrollbar/.test(selector)) offenders.push(selector);
        const overflow = m[2].match(/(?:^|;|\s)overflow(?:-y|-x)?:\s*(auto|scroll)/);
        if (overflow) offenders.push(`${selector} { ${overflow[0].trim()} }`);
    }
    assert.deepEqual(offenders, [], 'the stats sheet grew a scrollbar');
});

// Every id renderStats writes to has to exist in the markup. The shim's
// getElementById invents whatever it is asked for, so a typo in either file would
// otherwise sail through every test above.
test('every id the sheet writes to is in popup.html', () => {
    const html = readFileSync(new URL('../src/ui/popup.html', import.meta.url), 'utf8');
    const present = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
    const missing = IDS.filter(id => !present.has(id));
    assert.deepEqual(missing, [], 'popup.js reaches for an id the markup lacks');
});
