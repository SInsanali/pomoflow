// The compact surface. Zero authoritative state: it renders a snapshot and
// sends commands. Closing it stops nothing — the service worker owns the block.

import { createSurface, renderCycleDots, modeLabel, sessionLabel, send } from './surface.js';
import { store } from '../store/storage.js';
import { DEFAULT_SETTINGS, DEFAULT_CYCLE } from '../core/defaults.js';
import {
    THEMES, FALLBACK_THEME, accentVarForMode, hexToHsl, hslToHex, isValidColor,
    resolveTheme, withRecentTheme,
} from '../core/themes.js';
import { showFontFaces, syncFontFace } from './font-picker.js';

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
        // applyAppearance() has just written the *saved* theme onto :root, so
        // an unsaved draft has to repaint itself after every refresh or the
        // preview blinks away the moment the service worker writes anything.
        if (themeEditorOpen()) previewEditorColors();
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

// Every theme, as three-stripe chips: the built-ins plus whatever custom ones
// exist, and a "+" to make another. Picking *or building* a theme should never
// cost a trip out of the popup.
//
// Fixed order (customs first, then THEMES as declared), NOT most-recent-first:
// chips that reshuffle under the cursor make the grid unlearnable. recentThemes
// is still maintained on click, because the full page's strip reads it.
const MODE_KEYS = ['pomodoro', 'shortBreak', 'longBreak'];

function themeIds() {
    const { customThemes } = surface.state;
    return [...Object.keys(customThemes), ...Object.keys(THEMES)];
}

function themeName(themeId) {
    const custom = surface.state.customThemes[themeId];
    return (custom && custom.name) || themeId;
}

function renderThemeRow() {
    const { settings, customThemes } = surface.state;
    const row = el('qs-themes');
    row.innerHTML = '';

    for (const themeId of themeIds()) {
        const theme = resolveTheme(themeId, customThemes);
        const custom = Boolean(customThemes[themeId]);

        // The chip carries the pencil, so it needs a positioning parent — and
        // the pencil has to be a sibling, because a <button> may not contain
        // another one.
        const cell = document.createElement('div');
        cell.className = 'qs-theme-cell';

        const chip = document.createElement('button');
        chip.className = 'qs-theme' + (settings.theme === themeId ? ' active' : '') +
            (custom ? ' custom' : '');
        chip.type = 'button';
        // Custom theme names are user input: textContent/title, never innerHTML.
        chip.title = themeName(themeId);

        for (const key of MODE_KEYS) {
            const stripe = document.createElement('span');
            stripe.style.background = theme[key];
            chip.appendChild(stripe);
        }

        chip.addEventListener('click', () => patchSettings({
            theme: themeId,
            recentThemes: withRecentTheme(settings.recentThemes, themeId),
        }));
        cell.appendChild(chip);

        if (custom) {
            const edit = document.createElement('button');
            edit.className = 'qs-theme-edit';
            edit.type = 'button';
            edit.textContent = '✎';
            edit.title = `Edit ${themeName(themeId)}`;
            edit.setAttribute('aria-label', `Edit ${themeName(themeId)}`);
            edit.addEventListener('click', () => openThemeEditor(themeId));
            cell.appendChild(edit);
        }

        row.appendChild(cell);
    }

    // Last, not first: choosing a theme is the common act, making one is not.
    const add = document.createElement('button');
    add.className = 'qs-theme qs-theme-new';
    add.type = 'button';
    add.textContent = '+';
    add.title = 'New custom theme';
    add.setAttribute('aria-label', 'New custom theme');
    add.addEventListener('click', () => openThemeEditor());
    row.appendChild(add);
}

// ===== CUSTOM THEME EDITOR =====
//
// null while closed, '' while creating, a theme id while editing one.
let editingThemeId = null;
let themeDeleteArmed = false;

// The draft is held as HSL, not hex: dragging a slider through hex on every
// frame would round-trip the other two channels and walk the colour sideways.
// Hex is derived for display, and typing one re-seeds the draft.
const draft = { pomodoro: null, shortBreak: null, longBreak: null };
let draftMode = 'pomodoro';

function themeEditorOpen() {
    return editingThemeId !== null;
}

function editorColor(key) {
    return hslToHex(draft[key]);
}

// Paint the draft straight onto :root. The sheet covers the clock, but it is
// tinted with --accent, its title is drawn in it, and Save is filled with it —
// so the preview lands on what the user is already looking at.
function previewEditorColors() {
    const root = document.documentElement;
    for (const key of MODE_KEYS) {
        root.style.setProperty(accentVarForMode(key), editorColor(key));
    }
}

const HUE_TRACK = 'linear-gradient(to right, ' +
    [0, 60, 120, 180, 240, 300, 360]
        .map(deg => hslToHex({ h: deg, s: 90, l: 60 })).join(', ') + ')';

// Each track is painted with the axis it moves along — a rainbow for hue, grey
// to full colour for saturation, black to white through the hue for lightness —
// which is why the sliders carry no labels.
function paintSliders() {
    const { h, s, l } = draft[draftMode];

    el('qs-hue').value = Math.round(h);
    el('qs-sat').value = Math.round(s);
    el('qs-light').value = Math.round(l);

    el('qs-hue').style.background = HUE_TRACK;
    el('qs-sat').style.background = 'linear-gradient(to right, ' +
        `${hslToHex({ h, s: 0, l })}, ${hslToHex({ h, s: 100, l })})`;
    // Through the draft's own saturation, so a grey stays a grey ramp.
    el('qs-light').style.background =
        `linear-gradient(to right, #000, ${hslToHex({ h, s, l: 50 })}, #fff)`;
}

function paintSwatches() {
    for (const swatch of el('qs-mode-swatches').querySelectorAll('.qs-mode-swatch')) {
        const mode = swatch.dataset.mode;
        swatch.classList.toggle('active', mode === draftMode);
        swatch.setAttribute('aria-pressed', String(mode === draftMode));
        swatch.querySelector('i').style.background = editorColor(mode);
    }
}

// One redraw for every way the draft can change.
function renderDraft() {
    el('qs-hex').value = editorColor(draftMode);
    paintSliders();
    paintSwatches();
    previewEditorColors();
}

function armThemeDelete(armed) {
    themeDeleteArmed = armed;
    el('qs-theme-delete').textContent = armed ? 'Tap again to delete' : 'Delete theme';
    el('qs-theme-delete').classList.toggle('armed', armed);
}

// No id: start from the theme in use rather than from an arbitrary colour —
// "this, but the focus red is too loud" is how most custom themes begin.
function openThemeEditor(themeId = '') {
    const { settings, customThemes } = surface.state;
    editingThemeId = customThemes[themeId] ? themeId : '';

    const source = editingThemeId
        ? customThemes[editingThemeId]
        : resolveTheme(settings.theme, customThemes);
    el('qs-theme-name').value = editingThemeId ? (source.name || '') : '';
    for (const key of MODE_KEYS) draft[key] = hexToHsl(source[key]);
    draftMode = 'pomodoro';

    el('qs-title').textContent = editingThemeId ? 'Edit theme' : 'New theme';
    el('qs-close').title = 'Back to quick settings';
    el('qs-close').setAttribute('aria-label', 'Back to quick settings');
    el('qs-theme-delete').hidden = !editingThemeId;
    armThemeDelete(false);
    armReset(false);

    el('qs-theme-editor').hidden = false;
    el('quick-settings').classList.add('editing');
    renderDraft();
    fitSheet();
    el('qs-theme-name').focus();
}

function closeThemeEditor() {
    editingThemeId = null;
    el('qs-theme-editor').hidden = true;
    el('quick-settings').classList.remove('editing');
    el('qs-title').textContent = 'Quick settings';
    el('qs-close').title = 'Back to the timer';
    el('qs-close').setAttribute('aria-label', 'Back to the timer');
    armThemeDelete(false);
    // Drops the draft accents: applyAppearance() rewrites all three from what
    // is actually stored.
    surface.refresh();
    fitSheet();
}

async function saveTheme() {
    const { settings, customThemes } = surface.state;
    const existing = editingThemeId ? customThemes[editingThemeId] : null;
    const themeId = editingThemeId || `custom-${Date.now()}`;
    const name = el('qs-theme-name').value.trim() ||
        `Custom ${Object.keys(customThemes).length + 1}`;

    await db.setCustomThemes({
        ...customThemes,
        [themeId]: {
            name,
            pomodoro: editorColor('pomodoro'),
            shortBreak: editorColor('shortBreak'),
            longBreak: editorColor('longBreak'),
            createdAt: existing ? existing.createdAt : Date.now(),
        },
    });
    // Saving selects it — building a theme you then have to go and click is
    // busywork, and it is how the full page has always behaved.
    await patchSettings({
        theme: themeId,
        recentThemes: withRecentTheme(settings.recentThemes, themeId),
    });
    closeThemeEditor();
}

async function deleteTheme() {
    const { settings, customThemes } = surface.state;
    if (!editingThemeId || !customThemes[editingThemeId]) return closeThemeEditor();

    const next = { ...customThemes };
    delete next[editingThemeId];
    await db.setCustomThemes(next);

    const patch = {
        recentThemes: (settings.recentThemes || []).filter(id => id !== editingThemeId),
    };
    // Never leave a surface pointing at a theme that no longer exists.
    if (settings.theme === editingThemeId) patch.theme = FALLBACK_THEME;
    await patchSettings(patch);
    closeThemeEditor();
}

el('qs-mode-swatches').addEventListener('click', (e) => {
    const swatch = e.target.closest('.qs-mode-swatch');
    if (!swatch) return;
    draftMode = swatch.dataset.mode;
    renderDraft();
});

for (const [id, channel] of [['qs-hue', 'h'], ['qs-sat', 's'], ['qs-light', 'l']]) {
    el(id).addEventListener('input', (e) => {
        draft[draftMode][channel] = Number(e.target.value);
        renderDraft();
    });
}

// Typing re-seeds the draft, but only once the field holds a whole colour —
// otherwise "#1a" mid-type would snap the sliders to black. Deliberately not a
// full renderDraft(): rewriting the field under the cursor moves it.
el('qs-hex').addEventListener('input', (e) => {
    if (!isValidColor(e.target.value.trim())) return;
    draft[draftMode] = hexToHsl(e.target.value.trim());
    paintSliders();
    paintSwatches();
    previewEditorColors();
});

el('qs-theme-save').addEventListener('click', saveTheme);
el('qs-theme-cancel').addEventListener('click', closeThemeEditor);
el('qs-theme-delete').addEventListener('click', () => {
    if (themeDeleteArmed) return deleteTheme();
    armThemeDelete(true);
});

// Enter commits from any field — the popup is a place for short interactions.
el('qs-theme-editor').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    saveTheme();
});

// Anything else in the editor disarms a primed delete, same rule as the reset.
el('qs-theme-editor').addEventListener('click', (e) => {
    if (themeDeleteArmed && e.target.closest('#qs-theme-delete') === null) armThemeDelete(false);
});

function loadQuickForm() {
    const { settings } = surface.state;
    el('qs-pomodoro').value = settings.pomodoroDuration;
    el('qs-short-break').value = settings.shortBreakDuration;
    el('qs-long-break').value = settings.longBreakDuration;
    el('qs-auto-breaks').checked = settings.autoStartBreaks;
    el('qs-auto-pomodoros').checked = settings.autoStartPomodoros;
    el('qs-notifications').checked = settings.notifications;
    el('qs-font').value = settings.timerFont || DEFAULT_SETTINGS.timerFont;
    syncFontFace(el('qs-font'));
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
    if (themeEditorOpen()) closeThemeEditor();   // never leave a draft armed behind a hidden sheet
    el('quick-settings').hidden = true;
    el('quick-settings-btn').setAttribute('aria-expanded', 'false');
    document.body.style.minHeight = '';   // let the popup shrink back to the timer
    armReset(false);
}

el('quick-settings-btn').addEventListener('click', () => {
    if (quickSettingsOpen()) closeQuickSettings(); else openQuickSettings();
});

// One level at a time: out of the editor first, out of the sheet second.
el('qs-close').addEventListener('click', () => {
    if (themeEditorOpen()) closeThemeEditor(); else closeQuickSettings();
});

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

showFontFaces(el('qs-font'));

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
        if (themeEditorOpen()) closeThemeEditor(); else closeQuickSettings();
        return;
    }
    if (e.target.tagName === 'INPUT' || quickSettingsOpen()) return;
    const action = { Space: 'TOGGLE', KeyR: 'RESET', KeyN: 'SKIP' }[e.code];
    if (!action) return;
    e.preventDefault();
    surface.command(action);
});

surface.start();
