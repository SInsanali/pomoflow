// The compact surface. Zero authoritative state: it renders a snapshot and
// sends commands. Closing it stops nothing — the service worker owns the block.

import { createSurface, renderCycleDots, modeLabel, sessionLabel, send } from './surface.js';

const el = (id) => document.getElementById(id);

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
    },
});

el('start-btn').addEventListener('click', () => surface.command('TOGGLE'));
el('reset-btn').addEventListener('click', () => surface.command('RESET'));
el('skip-btn').addEventListener('click', () => surface.command('SKIP'));

document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => surface.command('SWITCH_MODE', { mode: tab.dataset.mode }));
});

// Both of these close the popup: Chrome tears it down as soon as focus moves to
// the new window or tab, which is exactly the handoff we want.
el('popout-btn').addEventListener('click', async () => {
    await send('POP_OUT');
    window.close();
});
el('open-app-btn').addEventListener('click', async () => {
    await send('OPEN_APP');
    window.close();
});

// Same shortcuts as v1, for the moments the popup has focus. The global
// hotkeys in the manifest cover the case where it does not.
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const action = { Space: 'TOGGLE', KeyR: 'RESET', KeyN: 'SKIP' }[e.code];
    if (!action) return;
    e.preventDefault();
    surface.command(action);
});

surface.start();
