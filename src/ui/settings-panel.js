// The settings modal: form binding, live-apply, and data export/import.
// Ported from v1's settings functions, with every inline handler rewired.

import { DEFAULT_SETTINGS } from '../core/defaults.js';
import { send } from './surface.js';

const el = (id) => document.getElementById(id);

export function createSettingsPanel({ db, getState, patchSettings, onRefresh, themePanel, presetPanel }) {

    function loadForm() {
        const { settings } = getState();
        el('setting-font').value = settings.timerFont || 'system';
        el('setting-color-bg').checked = settings.colorBackground;
        el('setting-hide-bg-running').checked = settings.hideBgWhenRunning;
        el('setting-pomodoro').value = settings.pomodoroDuration;
        el('setting-short-break').value = settings.shortBreakDuration;
        el('setting-long-break').value = settings.longBreakDuration;
        el('setting-auto-breaks').checked = settings.autoStartBreaks;
        el('setting-auto-pomodoros').checked = settings.autoStartPomodoros;
        el('setting-sound').value = settings.sound;
        el('setting-volume').value = settings.volume * 100;
        el('volume-value').textContent = Math.round(settings.volume * 100) + '%';
        el('setting-notifications').checked = settings.notifications;
    }

    // Durations are read back on close. Changing one mid-block does NOT yank the
    // running timer — the service worker applies new durations to the next
    // block, matching v1's saveSettingsFromForm.
    async function saveForm() {
        await patchSettings({
            colorBackground: el('setting-color-bg').checked,
            hideBgWhenRunning: el('setting-hide-bg-running').checked,
            pomodoroDuration: parseInt(el('setting-pomodoro').value, 10) || 25,
            shortBreakDuration: parseInt(el('setting-short-break').value, 10) || 5,
            longBreakDuration: parseInt(el('setting-long-break').value, 10) || 15,
            autoStartBreaks: el('setting-auto-breaks').checked,
            autoStartPomodoros: el('setting-auto-pomodoros').checked,
            sound: el('setting-sound').value,
            volume: parseInt(el('setting-volume').value, 10) / 100,
            notifications: el('setting-notifications').checked,
        });
        await send('SETTINGS_CHANGED');
        await onRefresh();
    }

    async function open() {
        await onRefresh();
        loadForm();
        themePanel.render();
        presetPanel.render();
        el('theme-grid-container').classList.remove('expanded');
        el('theme-expand-btn').classList.remove('expanded');
        el('settings-modal').classList.add('active');
    }

    async function close() {
        el('settings-modal').classList.remove('active');
        themePanel.closeEditor();
        await saveForm();
    }

    function isOpen() {
        return el('settings-modal').classList.contains('active');
    }

    function status(message) {
        el('data-status').textContent = message;
    }

    // ===== export / import =====
    //
    // Not a nice-to-have. There is no .db file to copy any more and
    // uninstalling the extension destroys the data outright, so this is the
    // only backup route the user has.

    async function exportData() {
        const payload = await db.exportAll();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pomoflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        status(`Exported ${payload.sessions.length} sessions.`);
    }

    function importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const res = await db.importAll(JSON.parse(e.target.result));
                if (!res.ok) throw new Error(res.error);
                await send('SETTINGS_CHANGED');
                await onRefresh();
                loadForm();
                themePanel.render();
                presetPanel.render();
                status(`Imported — ${res.data.sessionsImported} new sessions.`);
            } catch (err) {
                status('Could not read that file. Is it a Pomoflow export?');
            }
        };
        reader.readAsText(file);
        event.target.value = ''; // let the same file be picked again
    }

    // Resets preferences and custom themes, exactly as v1 did. Session history
    // is deliberately left alone — it is not a "setting", and losing it to a
    // mis-click would be unrecoverable.
    async function resetDefaults() {
        if (!confirm('Reset all settings to defaults? This will also delete custom themes.\n\nYour session history is kept.')) return;
        await db.setCustomThemes({});
        await db.putSettings({ ...DEFAULT_SETTINGS });
        const cycle = await db.getCycle();
        await db.setCycle({ ...cycle, sessionGoal: 4 });
        await send('SETTINGS_CHANGED');
        await onRefresh();
        loadForm();
        themePanel.render();
        status('Settings reset to defaults.');
    }

    // ===== wiring =====

    el('settings-btn').addEventListener('click', open);
    el('settings-close').addEventListener('click', close);
    el('settings-modal').addEventListener('click', (e) => {
        if (e.target === el('settings-modal')) close();
    });

    // Live-apply the appearance controls so the clock behind the modal reacts
    // immediately, rather than waiting for the modal to close.
    el('setting-font').addEventListener('change', async (e) => {
        await patchSettings({ timerFont: e.target.value });
        await onRefresh();
    });
    el('setting-color-bg').addEventListener('change', async (e) => {
        await patchSettings({ colorBackground: e.target.checked });
        await onRefresh();
    });
    el('setting-hide-bg-running').addEventListener('change', async (e) => {
        await patchSettings({ hideBgWhenRunning: e.target.checked });
        await onRefresh();
    });
    el('setting-sound').addEventListener('change', async (e) => {
        await patchSettings({ sound: e.target.value });
    });
    el('setting-volume').addEventListener('input', (e) => {
        el('volume-value').textContent = e.target.value + '%';
    });

    el('test-sound-btn').addEventListener('click', () => {
        send('TEST_SOUND', {
            sound: el('setting-sound').value,
            volume: parseInt(el('setting-volume').value, 10) / 100,
        });
    });

    el('export-btn').addEventListener('click', exportData);
    el('import-btn').addEventListener('click', () => el('import-file').click());
    el('import-file').addEventListener('change', importData);
    el('reset-defaults-btn').addEventListener('click', resetDefaults);

    return { open, close, isOpen, loadForm };
}
