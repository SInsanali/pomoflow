// The full page: big clock, dashboard, settings, theme editor. Also serves as
// the pop-out window (app.html?popout=1), which is the closest thing to v1's
// dedicated Chrome --app window — chromeless and parkable on a second monitor.
//
// Like the popup, this page owns no timer state. Both surfaces read the same
// `endsAt`, which is why they stay in sync without talking to each other.

import { createSurface, send, sessionLabel } from './surface.js';
import { store } from '../store/storage.js';
import { createThemePanel } from './theme-editor.js';
import { createPresetPanel } from './presets.js';
import { createSettingsPanel } from './settings-panel.js';
import { renderDashboard } from './dashboard.js';

const el = (id) => document.getElementById(id);
const db = store();
const isPopout = new URLSearchParams(location.search).get('popout') === '1';

// ===== surface =====

const surface = createSurface({
    stage: el('timer-stage'),
    updateTitle: true,
    onState(state) {
        const { timer, cycle } = state;

        el('start-btn').textContent = timer.isRunning ? 'Pause' : 'Start';
        el('session-counter').textContent = sessionLabel(timer.mode, cycle);
        el('streak-count').textContent = cycle.totalPomodoros;
        el('goal-current').textContent = cycle.totalPomodoros;
        el('goal-target').textContent = cycle.sessionGoal;
        document.querySelector('.goal-display')
            .classList.toggle('goal-reached', cycle.totalPomodoros >= cycle.sessionGoal);

        document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.mode === timer.mode);
        });
    },
});

const getState = () => surface.state;

// Settings live in storage, not in this page. Patch, persist, then let the
// storage.onChanged listener in surface.js pull everyone back into line.
async function patchSettings(patch) {
    // The first GET_STATE lands a few milliseconds after the page script runs,
    // so a very early click could otherwise read a null snapshot.
    if (!getState()) await surface.refresh();
    const { settings } = getState();
    await db.putSettings({ ...settings, ...patch });
    await surface.refresh();
}

// ===== panels =====

const themePanel = createThemePanel({
    getState,
    patchSettings,
    setCustomThemes: async (themes) => {
        await db.setCustomThemes(themes);
        await surface.refresh();
    },
});

const presetPanel = createPresetPanel({
    db,
    getState,
    applyConfig: async (config) => {
        await patchSettings(config);
        await send('SETTINGS_CHANGED');
        await surface.refresh();
        settingsPanel.loadForm();
        themePanel.render();
    },
});

const settingsPanel = createSettingsPanel({
    db,
    getState,
    patchSettings,
    onRefresh: () => surface.refresh(),
    themePanel,
    presetPanel,
});

// ===== views =====

function showView(view) {
    const dashboard = view === 'dashboard';
    el('view-timer').hidden = dashboard;
    el('view-dashboard').hidden = !dashboard;
    el('nav-timer').classList.toggle('nav-active', !dashboard);
    el('nav-dashboard').classList.toggle('nav-active', dashboard);
    if (dashboard) renderDashboard(db);
}

el('nav-timer').addEventListener('click', (e) => { e.preventDefault(); showView('timer'); });
el('nav-dashboard').addEventListener('click', (e) => { e.preventDefault(); showView('dashboard'); });

// ===== timer controls =====

el('start-btn').addEventListener('click', () => surface.command('TOGGLE'));
el('reset-btn').addEventListener('click', () => surface.command('RESET'));
el('skip-btn').addEventListener('click', () => surface.command('SKIP'));

document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => surface.command('SWITCH_MODE', { mode: tab.dataset.mode }));
});

document.querySelectorAll('.style-switch button').forEach(btn => {
    btn.addEventListener('click', () => patchSettings({ timerStyle: btn.dataset.style }));
});

// No confirm(): this clears a display counter that clears itself at midnight
// anyway, and every block it counted is still in the dashboard.
el('count-reset-btn').addEventListener('click', () => surface.command('RESET_COUNT'));

el('goal-down').addEventListener('click', () => surface.command('ADJUST_GOAL', { delta: -1 }));
el('goal-up').addEventListener('click', () => surface.command('ADJUST_GOAL', { delta: 1 }));

el('popout-btn').addEventListener('click', () => send('POP_OUT'));

// ===== keyboard =====

document.addEventListener('keydown', (e) => {
    const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT';
    if (typing || settingsPanel.isOpen()) return;

    const action = { Space: 'TOGGLE', KeyR: 'RESET', KeyN: 'SKIP' }[e.code];
    if (!action) return;
    e.preventDefault();
    surface.command(action);
});

// ===== pop-out chrome =====

if (isPopout) {
    // The pop-out is a timer, not a workspace: hide the nav so the window can
    // be small enough to park beside real work. The dashboard markup stays in
    // the document (hidden) rather than being removed — showView() and the
    // listener below both reach for it, and a removed node would throw.
    document.querySelector('.app-nav').hidden = true;
    document.body.classList.add('popout');
}

// The dashboard is only re-read when it is the visible view, so a running
// timer does not repeatedly re-render charts nobody is looking at.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sessions && !el('view-dashboard').hidden) {
        renderDashboard(db);
    }
});

showView('timer');
surface.start();
