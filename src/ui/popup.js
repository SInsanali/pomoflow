// The compact surface. Zero authoritative state: it renders a snapshot and
// sends commands. Closing it stops nothing — the service worker owns the block.

import { createSurface, renderCycleDots, modeLabel, sessionLabel, send } from './surface.js';
import { store } from '../store/storage.js';
import { DEFAULT_SETTINGS, DEFAULT_CYCLE } from '../core/defaults.js';
import { resolveTheme, withRecentTheme } from '../core/themes.js';

const el = (id) => document.getElementById(id);
const db = store();

const surface = createSurface({
    stage: el('timer-stage'),
    onState(state) {
        const { timer, cycle } = state;

        el('start-btn').textContent = timer.isRunning ? 'Pause' : 'Start';
        el('mode-label').textContent = modeLabel(timer.mode);
        el('session-counter').textContent = sessionLabel(timer.mode, cycle);
        el('goal-progress').textContent = `${cycle.totalPomodoros}/${cycle.sessionGoal}`;

        document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.mode === timer.mode);
        });
        renderCycleDots(el('cycle-dots'), cycle, timer.mode);

        if (quickSettingsOpen()) renderThemeRow();
    },
});

el('start-btn').addEventListener('click', () => surface.command('TOGGLE'));
el('reset-btn').addEventListener('click', () => surface.command('RESET'));
el('skip-btn').addEventListener('click', () => surface.command('SKIP'));

document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => surface.command('SWITCH_MODE', { mode: tab.dataset.mode }));
});

// Closes the popup: Chrome tears it down as soon as focus moves to the new
// tab, which is exactly the handoff we want.
el('open-app-btn').addEventListener('click', async () => {
    await send('OPEN_APP');
    window.close();
});

// ===== QUICK SETTINGS =====
//
// Settings live in storage, not here. Patch, persist, then let surface.js's
// storage.onChanged listener pull every open surface back into line — which is
// why changing a theme here repaints the clock behind the sheet for free.
async function patchSettings(patch) {
    // The first GET_STATE lands a few milliseconds after this script runs, so a
    // very early click could otherwise read a null snapshot.
    if (!surface.state) await surface.refresh();
    await db.putSettings({ ...surface.state.settings, ...patch });
    await surface.refresh();
}

function quickSettingsOpen() {
    return !el('quick-settings').hidden;
}

// The four recent themes, as three-stripe chips. The full grid — and the custom
// theme editor — stays in the full page; this row is for flipping back to a
// theme you already use.
function renderThemeRow() {
    const { settings, customThemes } = surface.state;
    const row = el('qs-themes');
    row.innerHTML = '';

    for (const themeId of settings.recentThemes) {
        const theme = resolveTheme(themeId, customThemes);
        const chip = document.createElement('button');
        chip.className = 'qs-theme' + (settings.theme === themeId ? ' active' : '');
        chip.type = 'button';
        // Custom theme names are user input: textContent, never innerHTML.
        chip.title = (customThemes[themeId] && customThemes[themeId].name) || themeId;

        for (const key of ['pomodoro', 'shortBreak', 'longBreak']) {
            const stripe = document.createElement('span');
            stripe.style.background = theme[key];
            chip.appendChild(stripe);
        }

        chip.addEventListener('click', () => patchSettings({
            theme: themeId,
            recentThemes: withRecentTheme(settings.recentThemes, themeId),
        }));
        row.appendChild(chip);
    }
}

function loadQuickForm() {
    const { settings } = surface.state;
    el('qs-pomodoro').value = settings.pomodoroDuration;
    el('qs-short-break').value = settings.shortBreakDuration;
    el('qs-long-break').value = settings.longBreakDuration;
    el('qs-auto-breaks').checked = settings.autoStartBreaks;
    el('qs-auto-pomodoros').checked = settings.autoStartPomodoros;
    el('qs-notifications').checked = settings.notifications;
    el('qs-font').value = settings.timerFont || DEFAULT_SETTINGS.timerFont;
    el('qs-sound').value = settings.sound || DEFAULT_SETTINGS.sound;
    el('qs-muted').hidden = settings.volume > 0;
    renderThemeRow();
}

// The sheet is absolutely positioned over the timer view, so it adds no height
// of its own and Chrome sizes the popup from the view underneath. Once the
// sheet's content is the taller of the two, .qs-body's overflow scrolls a
// control out of sight — which is how the notifications toggle disappeared when
// the font and chime rows landed. Grow the popup to the content instead.
//
// Measured rather than hardcoded: the sheet's height moves with the muted note,
// and with whatever a font stack does to the row heights.
function fitSheet() {
    document.body.style.minHeight = '';
    const body = el('quick-settings').querySelector('.qs-body');
    const overflow = body.scrollHeight - body.clientHeight;
    if (overflow > 0) document.body.style.minHeight = `${document.body.offsetHeight + overflow}px`;
}

async function openQuickSettings() {
    if (!surface.state) await surface.refresh();
    loadQuickForm();
    el('quick-settings').hidden = false;
    el('quick-settings-btn').setAttribute('aria-expanded', 'true');
    fitSheet();
}

function closeQuickSettings() {
    el('quick-settings').hidden = true;
    el('quick-settings-btn').setAttribute('aria-expanded', 'false');
    document.body.style.minHeight = '';   // let the popup shrink back to the timer
    armReset(false);
}

el('quick-settings-btn').addEventListener('click', () => {
    if (quickSettingsOpen()) closeQuickSettings(); else openQuickSettings();
});
el('qs-close').addEventListener('click', closeQuickSettings);

// A duration change must not yank a running block; the service worker applies
// new durations to the next one (SETTINGS_CHANGED), same as the full page.
const DURATIONS = {
    'qs-pomodoro': ['pomodoroDuration', 1, 60],
    'qs-short-break': ['shortBreakDuration', 1, 30],
    'qs-long-break': ['longBreakDuration', 1, 60],
};

for (const [id, [key, min, max]] of Object.entries(DURATIONS)) {
    el(id).addEventListener('change', async (e) => {
        const value = Math.min(max, Math.max(min, parseInt(e.target.value, 10) ||
            DEFAULT_SETTINGS[key]));
        e.target.value = value;              // snap the field back if it was out of range
        await patchSettings({ [key]: value });
        await send('SETTINGS_CHANGED');
        await surface.refresh();
    });
}

// The font applies to the clock behind the sheet the moment it is patched:
// surface.js writes --timer-font on every refresh, so the change previews
// itself without any extra wiring here.
el('qs-font').addEventListener('change', (e) =>
    patchSettings({ timerFont: e.target.value }));

// Picking a chime plays it, the way an OS alert-sound list does. Two clicks to
// hear each option would make the picker useless in a popup — and the play
// button is still there to repeat the current one.
el('qs-sound').addEventListener('change', async (e) => {
    await patchSettings({ sound: e.target.value });
    previewChime();
});
el('qs-play').addEventListener('click', previewChime);

// Audio comes from the service worker's offscreen document, not from here: a
// popup is torn down the instant it loses focus, which would cut the sound off
// partway through.
function previewChime() {
    const { settings } = surface.state;
    if (!settings.volume) return;   // the muted note already explains the silence
    send('TEST_SOUND', { sound: el('qs-sound').value, volume: settings.volume });
}

el('qs-auto-breaks').addEventListener('change', (e) =>
    patchSettings({ autoStartBreaks: e.target.checked }));
el('qs-auto-pomodoros').addEventListener('change', (e) =>
    patchSettings({ autoStartPomodoros: e.target.checked }));
el('qs-notifications').addEventListener('change', (e) =>
    patchSettings({ notifications: e.target.checked }));

// ===== RESET =====
//
// Two clicks, not a confirm(): a modal dialog raised from a toolbar popup can
// close the popup out from under itself. The first click arms and explains,
// the second commits, and anything else disarms.
let resetArmed = false;

function armReset(armed) {
    resetArmed = armed;
    el('qs-reset').textContent = armed ? 'Tap again to confirm' : 'Reset settings';
    el('qs-reset').classList.toggle('armed', armed);
    el('qs-reset-note').hidden = !armed;
    // The note grows the foot, which squeezes .qs-body — the same overflow the
    // font and chime rows caused, arriving from the other end.
    if (quickSettingsOpen()) fitSheet();
}

// Session history is deliberately spared. It is not a "setting", and losing it
// to a mis-click in a popup would be unrecoverable — export is the only backup.
async function resetSettings() {
    await db.setCustomThemes({});
    await db.putSettings({ ...DEFAULT_SETTINGS });
    const cycle = await db.getCycle();
    await db.setCycle({ ...cycle, sessionGoal: DEFAULT_CYCLE.sessionGoal });
    await send('SETTINGS_CHANGED');
    await surface.refresh();
    loadQuickForm();
    armReset(false);
    el('qs-reset').textContent = 'Settings reset';
}

el('qs-reset').addEventListener('click', () => {
    if (resetArmed) return resetSettings();
    armReset(true);
});

// Any other interaction inside the sheet cancels an armed reset.
el('quick-settings').addEventListener('click', (e) => {
    if (resetArmed && e.target.closest('#qs-reset') === null) armReset(false);
});

// ===== KEYBOARD =====
//
// Same shortcuts as v1, for the moments the popup has focus. The global
// hotkeys in the manifest cover the case where it does not.
document.addEventListener('keydown', (e) => {
    // Best-effort: Chrome may still close the whole popup on Escape, which is
    // no worse than the behaviour before the sheet existed.
    if (e.code === 'Escape' && quickSettingsOpen()) {
        e.preventDefault();
        closeQuickSettings();
        return;
    }
    if (e.target.tagName === 'INPUT' || quickSettingsOpen()) return;
    const action = { Space: 'TOGGLE', KeyR: 'RESET', KeyN: 'SKIP' }[e.code];
    if (!action) return;
    e.preventDefault();
    surface.command(action);
});

surface.start();
