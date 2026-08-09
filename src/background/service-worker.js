// The authority. Owns block completion, the badge, notifications, and the
// cycle. Every UI surface is a pure renderer that reads state and sends
// commands here.
//
// The service worker is killed after ~30s idle, so it holds NO in-memory state
// that matters: everything lives in chrome.storage.local and every wake starts
// by reconciling the stored deadline against the wall clock.

import {
    reconcile, remaining, badgeText, formatTime, remainingSeconds,
    idleTimer, startTimer, pauseTimer, resetTimer,
    advanceCycle, shouldAutoStart, sessionRecord, blockInProgress, elapsedSeconds,
} from '../core/clock.js';
import { durationSeconds, MODE_LABELS } from '../core/defaults.js';
import { resolveTheme } from '../core/themes.js';
import { store } from '../store/storage.js';

const ALARM_BLOCK_END = 'block-end';
const ALARM_BADGE = 'badge-refresh';
const OFFSCREEN_PATH = 'src/background/offscreen.html';

// chrome.alarms' repeating minimum is 30s. The badge alarm is best-effort and
// self-correcting: if Chrome skips a fire, the next one still renders the right
// number, because the badge is computed from `endsAt` and never decremented.
const BADGE_PERIOD_MINUTES = 0.5;

// ===== SERIALIZATION =====
// Completion can be triggered concurrently — the block-end alarm, the badge
// alarm, and a popup opening can all notice the same expired deadline at once.
// logSession's dedupe-by-id stops a double *log*, but nothing else would stop
// the cycle being advanced twice. Chaining every mutation through one promise
// makes read-modify-write sequences atomic within a worker lifetime.
let chain = Promise.resolve();
function withLock(fn) {
    const result = chain.then(fn, fn);
    chain = result.catch(() => {});
    return result;
}

// ===== BADGE =====

async function renderBadge(timer, settings, customThemes) {
    const now = Date.now();
    const text = badgeText(timer, now);
    await chrome.action.setBadgeText({ text });

    if (text) {
        const theme = resolveTheme(settings.theme, customThemes);
        const color = theme[timer.mode] || theme.pomodoro;
        await chrome.action.setBadgeBackgroundColor({ color });
        // Chrome picks a contrasting badge text color itself on recent
        // versions; setting it explicitly keeps older ones legible.
        if (chrome.action.setBadgeTextColor) {
            await chrome.action.setBadgeTextColor({ color: '#ffffff' });
        }
    }

    const label = MODE_LABELS[timer.mode] || 'Pomoflow';
    const title = timer.isRunning
        ? `${label} — ${formatTime(remainingSeconds(timer, now))} remaining`
        : `${label} — paused at ${formatTime(remainingSeconds(timer, now))}`;
    await chrome.action.setTitle({ title: `Pomoflow · ${title}` });
}

// ===== ALARMS =====

async function scheduleAlarms(timer) {
    await chrome.alarms.clear(ALARM_BLOCK_END);
    await chrome.alarms.clear(ALARM_BADGE);
    if (!timer.isRunning || typeof timer.endsAt !== 'number') return;

    // One-shot at the exact deadline: this is the alarm that makes completion
    // correct. The periodic one below only refreshes the badge.
    chrome.alarms.create(ALARM_BLOCK_END, { when: timer.endsAt });
    chrome.alarms.create(ALARM_BADGE, { periodInMinutes: BADGE_PERIOD_MINUTES });
}

// Persist a timer and bring every ambient surface in line with it.
async function commit(timer) {
    const db = store();
    await db.setTimer(timer);
    await scheduleAlarms(timer);
    const [{ data: settings }, customThemes] = await Promise.all([
        db.getSettings(), db.getCustomThemes(),
    ]);
    await renderBadge(timer, settings, customThemes);
    return timer;
}

// ===== AUDIO (offscreen document) =====
//
// Service workers have no AudioContext, so the end-of-block sound plays from an
// offscreen document. Chrome allows only one at a time and reclaims it, so we
// must check for an existing one before creating another — and a creation that
// loses the race throws, which we swallow.
//
// Sound failure must NEVER block block completion; every call site is
// fire-and-forget and errors are logged, not propagated.
let creatingOffscreen = null;

async function ensureOffscreen() {
    if (await chrome.offscreen.hasDocument()) return;
    if (creatingOffscreen) return creatingOffscreen;
    creatingOffscreen = chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play the end-of-block notification sound.',
    }).finally(() => { creatingOffscreen = null; });
    return creatingOffscreen;
}

async function playSound(settings) {
    if (!settings.volume) return;
    try {
        await ensureOffscreen();
        await chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'PLAY_SOUND',
            sound: settings.sound,
            volume: settings.volume,
        });
    } catch (e) {
        console.warn('Pomoflow: end-of-block sound failed', e);
    }
}

// ===== NOTIFICATIONS =====

async function notify(title, message) {
    const db = store();
    const { data: settings } = await db.getSettings();
    if (!settings.notifications) return;
    try {
        await chrome.notifications.create(`pomoflow-${Date.now()}`, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('src/icons/128.png'),
            title,
            message,
            silent: true, // we play our own synthesized sound
        });
    } catch (e) {
        console.warn('Pomoflow: notification failed', e);
    }
}

// ===== BLOCK COMPLETION =====

// Finish the current block and move to the next one.
//
// ORDERING HAZARD (v1 documented the same one around logCurrentBlock ->
// advanceToNextMode): the outgoing block's session row must be built from the
// OLD timer and handed to the store BEFORE the new timer is committed.
// Otherwise the next block's state overwrites the fields the row is derived
// from, and the finished block is logged with the wrong mode/duration or lost.
// So: capture the record first, then advance, then commit.
async function completeBlock(timer, completedRecord) {
    const db = store();
    const [{ data: settings }, cycle] = await Promise.all([db.getSettings(), db.getCycle()]);

    // Captured from the OLD timer, before anything advances.
    await db.logSession(completedRecord);

    const { nextMode, cycle: nextCycle } = advanceCycle(timer.mode, cycle);
    await db.setCycle(nextCycle);

    let next = idleTimer(nextMode, settings);
    if (shouldAutoStart(nextMode, settings)) {
        next = startTimer(next, Date.now(), crypto.randomUUID());
    }
    await commit(next);

    if (timer.mode === 'pomodoro') {
        await notify('Pomodoro Complete!', 'Time for a break');
    } else {
        await notify('Break Over!', 'Ready to focus?');
    }
    playSound(settings);

    return next;
}

// The single reconciliation path: called on every wake, alarm, and state read.
// If the deadline passed while nobody was watching, this is where that is
// discovered and settled.
async function tick() {
    const db = store();
    const timer = await db.getTimer();
    const result = reconcile(timer, Date.now());

    if (result.action === 'complete') {
        return completeBlock(timer, result.completedBlock);
    }
    const [{ data: settings }, customThemes] = await Promise.all([
        db.getSettings(), db.getCustomThemes(),
    ]);
    await renderBadge(timer, settings, customThemes);
    return timer;
}

// ===== COMMANDS =====

async function cmdToggle() {
    const db = store();
    const timer = await db.getTimer();
    if (timer.isRunning) return commit(pauseTimer(timer, Date.now()));
    if (remaining(timer, Date.now()) <= 0) {
        const { data: settings } = await db.getSettings();
        return commit(startTimer(idleTimer(timer.mode, settings), Date.now(), crypto.randomUUID()));
    }
    return commit(startTimer(timer, Date.now(), crypto.randomUUID()));
}

async function cmdStart() {
    const db = store();
    const timer = await db.getTimer();
    if (timer.isRunning) return timer;
    return commit(startTimer(timer, Date.now(), crypto.randomUUID()));
}

async function cmdPause() {
    const db = store();
    const timer = await db.getTimer();
    return commit(pauseTimer(timer, Date.now()));
}

async function cmdReset() {
    const db = store();
    const [timer, { data: settings }] = await Promise.all([db.getTimer(), db.getSettings()]);
    return commit(resetTimer(timer, settings));
}

// Skip logs the outgoing block as a partial (completed = 0) and, for a
// pomodoro, still counts it toward the cycle — v1's skipTimer() behaviour.
async function cmdSkip() {
    const db = store();
    const now = Date.now();
    const [timer, { data: settings }, cycle] = await Promise.all([
        db.getTimer(), db.getSettings(), db.getCycle(),
    ]);

    if (blockInProgress(timer, now)) {
        await db.logSession(sessionRecord(timer, {
            completed: false,
            actualSeconds: elapsedSeconds(timer, now),
            endedAtMs: now,
        }));
    }

    const { nextMode, cycle: nextCycle } = advanceCycle(timer.mode, cycle);
    await db.setCycle(nextCycle);

    let next = idleTimer(nextMode, settings);
    if (shouldAutoStart(nextMode, settings)) {
        next = startTimer(next, Date.now(), crypto.randomUUID());
    }
    return commit(next);
}

// A manual mode switch discards the in-flight block without logging it, the
// same as v1's switchMode().
async function cmdSwitchMode(mode) {
    const db = store();
    const { data: settings } = await db.getSettings();
    return commit(idleTimer(mode, settings));
}

// Durations changed in settings. Don't yank a running block's remaining time;
// new durations take effect on the next block (v1's saveSettingsFromForm).
async function cmdSettingsChanged() {
    const db = store();
    const [timer, { data: settings }] = await Promise.all([db.getTimer(), db.getSettings()]);
    if (timer.isRunning) return commit(timer);
    const planned = durationSeconds(timer.mode, settings);
    if (planned === timer.plannedSeconds) return commit(timer);
    return commit(idleTimer(timer.mode, settings));
}

async function cmdAdjustGoal(delta) {
    const db = store();
    const cycle = await db.getCycle();
    const sessionGoal = Math.max(1, Math.min(20, cycle.sessionGoal + delta));
    return db.setCycle({ ...cycle, sessionGoal });
}

async function openApp() {
    const url = chrome.runtime.getURL('src/ui/app.html');
    // getContexts sees the extension's own pages without the "tabs" permission
    // (which exists to read *other* sites' URLs). Keeping it out is what makes
    // the install prompt trivial.
    const open = await chrome.runtime.getContexts({
        contextTypes: ['TAB'],
        documentUrls: [url],
    });
    if (open.length) {
        await chrome.tabs.update(open[0].tabId, { active: true });
        await chrome.windows.update(open[0].windowId, { focused: true });
        return;
    }
    await chrome.tabs.create({ url });
}

// The chromeless pop-out — closest thing to v1's Chrome --app window, and
// parkable on a second monitor.
async function popOut() {
    await chrome.windows.create({
        url: chrome.runtime.getURL('src/ui/app.html?popout=1'),
        type: 'popup',
        width: 480,
        height: 640,
    });
}

async function fullState() {
    const db = store();
    const [timer, cycle, { data: settings }, customThemes] = await Promise.all([
        db.getTimer(), db.getCycle(), db.getSettings(), db.getCustomThemes(),
    ]);
    return { timer, cycle, settings, customThemes, now: Date.now() };
}

// ===== WIRING =====

chrome.runtime.onInstalled.addListener(() => withLock(async () => {
    const db = store();
    const timer = await db.getTimer();
    await commit(timer);
}));

chrome.runtime.onStartup.addListener(() => withLock(tick));

// Every listener here RETURNS its promise. Chrome keeps the service worker
// alive while an event listener's returned promise is pending, so returning it
// is what stops the worker being torn down halfway through logging a completed
// block. (A dropped completion would eventually be re-reconciled on the next
// wake, but it would land with the wrong timing.)
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_BLOCK_END && alarm.name !== ALARM_BADGE) return;
    return withLock(tick);
});

chrome.commands.onCommand.addListener((command) => withLock(async () => {
    switch (command) {
        case 'toggle-timer': return cmdToggle();
        case 'reset-timer': return cmdReset();
        case 'skip-block': return cmdSkip();
        case 'open-app': return openApp();
    }
}));

chrome.notifications.onClicked.addListener((id) => {
    chrome.notifications.clear(id);
    return openApp();
});

const HANDLERS = {
    GET_STATE: () => tick().then(fullState),
    TOGGLE: cmdToggle,
    START: cmdStart,
    PAUSE: cmdPause,
    RESET: cmdReset,
    SKIP: cmdSkip,
    SWITCH_MODE: (msg) => cmdSwitchMode(msg.mode),
    SETTINGS_CHANGED: cmdSettingsChanged,
    ADJUST_GOAL: (msg) => cmdAdjustGoal(msg.delta),
    OPEN_APP: openApp,
    POP_OUT: popOut,
    TEST_SOUND: async (msg) => {
        await playSound({ sound: msg.sound, volume: msg.volume });
    },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // Messages aimed at the offscreen document also reach the service worker;
    // ignore them so we don't answer on the offscreen document's behalf.
    if (!msg || msg.target === 'offscreen') return false;

    const handler = HANDLERS[msg.type];
    if (!handler) return false;

    withLock(() => handler(msg))
        .then(async () => sendResponse(await fullState()))
        .catch((e) => {
            console.error('Pomoflow: command failed', msg.type, e);
            sendResponse({ error: String(e) });
        });
    return true; // keep the message channel open for the async response
});
