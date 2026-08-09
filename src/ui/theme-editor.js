// The theme picker and the custom-theme editor. Ported from v1, with two
// changes: no inline onclick attributes (MV3 forbids them), and swatch names
// are set with textContent rather than interpolated into innerHTML — a
// user-chosen theme name should never be able to inject markup.

import { THEMES, isValidTheme, resolveTheme, withRecentTheme } from '../core/themes.js';

const el = (id) => document.getElementById(id);
// The editor's DOM ids are kebab-case; they line up 1:1 with the
// --pomodoro-accent / --short-break-accent / --long-break-accent variables.
const MODES = ['pomodoro', 'short-break', 'long-break'];

export function createThemePanel({ getState, patchSettings, setCustomThemes }) {
    let editingId = '';

    // ===== live preview =====

    // Paint a theme's accents straight onto :root so hovering a swatch previews
    // it on the real clock behind the modal.
    function preview(themeId) {
        const { customThemes } = getState();
        const theme = resolveTheme(themeId, customThemes);
        const root = document.documentElement;
        root.style.setProperty('--pomodoro-accent', theme.pomodoro);
        root.style.setProperty('--short-break-accent', theme.shortBreak);
        root.style.setProperty('--long-break-accent', theme.longBreak);
    }

    function previewCurrent() {
        preview(getState().settings.theme);
    }

    // ===== swatches =====

    function buildSwatch(themeId, theme, { custom = false } = {}) {
        const { settings } = getState();
        const swatch = document.createElement('div');
        swatch.className = 'theme-swatch' + (custom ? ' custom' : '') +
            (settings.theme === themeId ? ' active' : '');
        swatch.dataset.theme = themeId;

        const colors = document.createElement('div');
        colors.className = 'swatch-colors';
        for (const key of ['pomodoro', 'shortBreak', 'longBreak']) {
            const chip = document.createElement('div');
            chip.className = 'swatch-color';
            chip.style.background = theme[key];
            colors.appendChild(chip);
        }

        const name = document.createElement('div');
        name.className = 'swatch-name';
        name.textContent = theme.name || themeId;

        swatch.append(colors, name);

        if (custom) {
            const edit = document.createElement('button');
            edit.className = 'swatch-edit';
            edit.textContent = '✎';
            edit.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditor(themeId);
            });
            swatch.appendChild(edit);
        }

        swatch.addEventListener('mouseenter', () => preview(themeId));
        swatch.addEventListener('mouseleave', previewCurrent);
        swatch.addEventListener('click', () => selectTheme(themeId));
        return swatch;
    }

    async function selectTheme(themeId) {
        const { settings } = getState();
        await patchSettings({
            theme: themeId,
            recentThemes: withRecentTheme(settings.recentThemes, themeId),
        });
        render();
        el('theme-grid-container').classList.remove('expanded');
        el('theme-expand-btn').classList.remove('expanded');
    }

    function render() {
        const { settings, customThemes } = getState();

        const recent = el('recent-themes');
        recent.innerHTML = '';
        for (const id of settings.recentThemes || []) {
            const theme = customThemes[id] || THEMES[id];
            if (!isValidTheme(theme)) continue;
            recent.appendChild(buildSwatch(id, theme));
        }

        const grid = el('theme-grid');
        grid.innerHTML = '';
        for (const [id, theme] of Object.entries(THEMES)) {
            grid.appendChild(buildSwatch(id, theme));
        }
        for (const [id, theme] of Object.entries(customThemes)) {
            if (isValidTheme(theme)) grid.appendChild(buildSwatch(id, theme));
        }

        const customGrid = el('custom-theme-grid');
        customGrid.innerHTML = '';
        for (const [id, theme] of Object.entries(customThemes)) {
            if (isValidTheme(theme)) customGrid.appendChild(buildSwatch(id, theme, { custom: true }));
        }
        const createBtn = document.createElement('div');
        createBtn.className = 'theme-swatch create-theme-btn';
        const placeholder = document.createElement('div');
        placeholder.className = 'swatch-colors create-placeholder';
        const plus = document.createElement('span');
        plus.className = 'plus-icon';
        plus.textContent = '+';
        placeholder.appendChild(plus);
        const createLabel = document.createElement('div');
        createLabel.className = 'swatch-name';
        createLabel.textContent = 'Create';
        createBtn.append(placeholder, createLabel);
        createBtn.addEventListener('click', () => openEditor());
        customGrid.appendChild(createBtn);
    }

    // ===== editor =====

    function setColorInputs(mode, color) {
        el(`color-${mode}`).value = color;
        el(`color-${mode}-hex`).value = color;
    }

    function colorFrom(mode) {
        const hex = el(`color-${mode}-hex`).value;
        if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
        return el(`color-${mode}`).value;
    }

    function updatePreview() {
        const root = document.documentElement;
        for (const mode of MODES) {
            const color = colorFrom(mode);
            el(`preview-${mode}`).style.backgroundColor = color;
            root.style.setProperty(`--${mode}-accent`, color);
        }
    }

    function openEditor(themeId = null) {
        const { settings, customThemes } = getState();
        editingId = themeId && customThemes[themeId] ? themeId : '';

        el('theme-editor-title').textContent = editingId ? 'Edit Theme' : 'Create Theme';
        el('delete-theme-btn').style.display = editingId ? 'block' : 'none';

        const source = editingId
            ? customThemes[editingId]
            : resolveTheme(settings.theme, customThemes);
        el('theme-name-input').value = editingId ? (source.name || '') : '';
        setColorInputs('pomodoro', source.pomodoro);
        setColorInputs('short-break', source.shortBreak);
        setColorInputs('long-break', source.longBreak);

        updatePreview();
        el('theme-editor').classList.add('active');
    }

    function closeEditor() {
        el('theme-editor').classList.remove('active');
        editingId = '';
        previewCurrent();
    }

    async function saveTheme() {
        const { settings, customThemes } = getState();
        const existing = editingId ? customThemes[editingId] : null;
        const name = el('theme-name-input').value.trim() ||
            'Custom ' + (Object.keys(customThemes).length + 1);

        const themeId = editingId || ('custom-' + Date.now());
        const next = {
            ...customThemes,
            [themeId]: {
                name,
                pomodoro: colorFrom('pomodoro'),
                shortBreak: colorFrom('short-break'),
                longBreak: colorFrom('long-break'),
                createdAt: existing ? existing.createdAt : Date.now(),
            },
        };

        await setCustomThemes(next);
        await patchSettings({
            theme: themeId,
            recentThemes: withRecentTheme(settings.recentThemes, themeId),
        });
        closeEditor();
        render();
    }

    async function deleteTheme() {
        const { settings, customThemes } = getState();
        if (!editingId || !customThemes[editingId]) return;
        if (!confirm('Delete this custom theme?')) return;

        const next = { ...customThemes };
        delete next[editingId];
        await setCustomThemes(next);

        const patch = {
            recentThemes: (settings.recentThemes || []).filter(id => id !== editingId),
        };
        // Never leave the app pointing at a theme that no longer exists.
        if (settings.theme === editingId) patch.theme = 'mono';
        await patchSettings(patch);

        closeEditor();
        render();
    }

    // ===== wiring =====

    el('theme-expand-btn').addEventListener('click', () => {
        el('theme-grid-container').classList.toggle('expanded');
        el('theme-expand-btn').classList.toggle('expanded');
    });
    el('theme-editor-back').addEventListener('click', closeEditor);
    el('theme-save-btn').addEventListener('click', saveTheme);
    el('delete-theme-btn').addEventListener('click', deleteTheme);

    for (const mode of MODES) {
        const picker = el(`color-${mode}`);
        const hex = el(`color-${mode}-hex`);
        picker.addEventListener('input', () => {
            hex.value = picker.value;
            updatePreview();
        });
        hex.addEventListener('input', () => {
            if (/^#[0-9A-Fa-f]{6}$/.test(hex.value)) picker.value = hex.value;
            updatePreview();
        });
    }

    return { render, closeEditor, previewCurrent };
}
