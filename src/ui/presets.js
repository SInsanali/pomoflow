// Named timing + appearance snapshots. Ported from v1; the only change is that
// the preset list now comes from chrome.storage instead of the server, through
// the same listPresets/createPreset/deletePreset method names.

import { PRESET_FIELDS } from '../core/defaults.js';

const el = (id) => document.getElementById(id);

export function createPresetPanel({ db, getState, applyConfig }) {
    async function render() {
        const list = el('preset-list');
        const { data } = await db.listPresets();
        const presets = data.presets;

        list.innerHTML = '';
        if (!presets.length) {
            const empty = document.createElement('div');
            empty.className = 'preset-empty';
            empty.textContent = 'No saved presets yet.';
            list.appendChild(empty);
            return;
        }

        for (const preset of presets) {
            const row = document.createElement('div');
            row.className = 'preset-row';

            const name = document.createElement('span');
            name.className = 'preset-name';
            name.textContent = preset.name;

            const apply = document.createElement('button');
            apply.className = 'preset-apply';
            apply.textContent = 'Apply';
            apply.addEventListener('click', () => applyConfig(preset.config));

            const del = document.createElement('button');
            del.className = 'preset-delete';
            del.textContent = '×';
            del.title = 'Delete preset';
            del.addEventListener('click', async () => {
                await db.deletePreset(preset.id);
                render();
            });

            row.append(name, apply, del);
            list.appendChild(row);
        }
    }

    el('preset-save-btn').addEventListener('click', async () => {
        const input = el('preset-name-input');
        const name = input.value.trim();
        if (!name) { input.focus(); return; }

        const { settings } = getState();
        const config = Object.fromEntries(PRESET_FIELDS.map(k => [k, settings[k]]));
        await db.createPreset(name, config);
        input.value = '';
        render();
    });

    return { render };
}
