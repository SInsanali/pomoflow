// Replaces v1's web/js/api.js. The method names are deliberately unchanged
// (logSession, getSessions, getSettings, putSettings, listPresets,
// createPreset, deletePreset) and so is the { ok, data } envelope, so
// dashboard.js and the timer UI call sites port over untouched.
//
// Dropped from the v1 surface: `getStats` (charts.computeStats does the rollup
// locally now) and `quit` (there is no server to stop).

import { DEFAULT_SETTINGS, DEFAULT_CYCLE, DEFAULT_TIMER } from '../core/defaults.js';
import { padRecentThemes, isValidTheme, THEMES, FALLBACK_THEME } from '../core/themes.js';
import { normalizeImport } from './migrate.js';

export const KEYS = {
    timer: 'timer',
    cycle: 'cycle',
    settings: 'settings',
    customThemes: 'customThemes',
    presets: 'presets',
    sessions: 'sessions',
};

function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for the node:test shim, which has no crypto.randomUUID on older
    // runtimes. Never hit in the extension.
    return 'id-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

// `area` is any object with chrome.storage's promise-based get/set — the real
// chrome.storage.local in the extension, a plain in-memory fake in tests.
export function createStore(area) {
    async function read(key, fallback) {
        const got = await area.get(key);
        return got && got[key] !== undefined ? got[key] : fallback;
    }

    async function write(key, value) {
        await area.set({ [key]: value });
        return value;
    }

    // ===== timer + cycle (the service worker's authoritative state) =====

    const getTimer = () => read(KEYS.timer, { ...DEFAULT_TIMER });
    const setTimer = (timer) => write(KEYS.timer, timer);
    const getCycle = () => read(KEYS.cycle, { ...DEFAULT_CYCLE });
    const setCycle = (cycle) => write(KEYS.cycle, cycle);

    // ===== settings =====

    async function getSettings() {
        const stored = await read(KEYS.settings, {});
        const customThemes = await read(KEYS.customThemes, {});
        const settings = { ...DEFAULT_SETTINGS, ...stored };
        // Normalize after loading, exactly as v1's validateSettings did: fall
        // back to a valid theme and top recentThemes back up to 4 entries.
        if (!isValidTheme(customThemes[settings.theme] || THEMES[settings.theme])) {
            settings.theme = FALLBACK_THEME;
        }
        settings.recentThemes = padRecentThemes(settings.recentThemes, customThemes);
        return { ok: true, data: settings };
    }

    async function putSettings(settings) {
        await write(KEYS.settings, settings);
        return { ok: true, data: settings };
    }

    // ===== custom themes =====

    const getCustomThemes = () => read(KEYS.customThemes, {});
    const setCustomThemes = (themes) => write(KEYS.customThemes, themes);

    // ===== sessions =====

    // Append-only and deduped by id, preserving the idempotency that
    // db.insert_session's `INSERT OR IGNORE` gave us in v1. Without this, a
    // service-worker restart that re-runs completion would double-log a block.
    async function logSession(session) {
        if (!session || !session.id) return { ok: false, error: 'session needs an id' };
        const sessions = await read(KEYS.sessions, []);
        if (sessions.some(s => s.id === session.id)) {
            return { ok: true, data: { inserted: false } };
        }
        sessions.push(session);
        await write(KEYS.sessions, sessions);
        return { ok: true, data: { inserted: true } };
    }

    // Newest first, matching db.get_sessions' ORDER BY started_at DESC. `from`
    // and `to` are ISO strings; `to` is exclusive, as in v1.
    async function getSessions(from, to) {
        const all = await read(KEYS.sessions, []);
        const filtered = all.filter(s =>
            (!from || s.started_at >= from) && (!to || s.started_at < to)
        );
        filtered.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
        return { ok: true, data: { sessions: filtered } };
    }

    // ===== presets =====

    async function listPresets() {
        const presets = await read(KEYS.presets, []);
        const sorted = [...presets].sort(
            (a, b) => String(b.created_at).localeCompare(String(a.created_at))
        );
        return { ok: true, data: { presets: sorted } };
    }

    async function createPreset(name, config) {
        const presets = await read(KEYS.presets, []);
        const preset = {
            id: uuid(),
            name,
            config,
            created_at: new Date().toISOString(),
        };
        presets.push(preset);
        await write(KEYS.presets, presets);
        return { ok: true, data: preset };
    }

    async function deletePreset(id) {
        const presets = await read(KEYS.presets, []);
        const next = presets.filter(p => p.id !== id);
        await write(KEYS.presets, next);
        return { ok: true, data: { deleted: next.length !== presets.length } };
    }

    // ===== export / import =====
    //
    // Not a nice-to-have: there is no .db file to copy any more, and
    // uninstalling the extension destroys the data outright. This is the only
    // backup route a user has.

    async function exportAll() {
        const [settingsRes, customThemes, presetsRes, sessionsRes, cycle] = await Promise.all([
            getSettings(), getCustomThemes(), listPresets(), getSessions(), getCycle(),
        ]);
        return {
            version: '2.0',
            exportedAt: new Date().toISOString(),
            settings: settingsRes.data,
            customThemes,
            presets: presetsRes.data.presets,
            sessions: sessionsRes.data.sessions,
            goal: cycle.sessionGoal,
        };
    }

    // Merges rather than replaces, and re-uses logSession's dedupe so importing
    // the same file twice is a no-op. migrate.normalizeImport handles the v1
    // formats, so this only ever sees one shape.
    async function importAll(raw) {
        const parsed = normalizeImport(raw);
        if (!parsed.ok) return parsed;
        const data = parsed.data;

        if (data.settings) {
            const current = await read(KEYS.settings, {});
            await write(KEYS.settings, { ...DEFAULT_SETTINGS, ...current, ...data.settings });
        }
        if (Object.keys(data.customThemes).length) {
            await setCustomThemes({ ...(await getCustomThemes()), ...data.customThemes });
        }
        if (data.presets.length) {
            const current = await read(KEYS.presets, []);
            const seen = new Set(current.map(p => p.id));
            await write(KEYS.presets, [...current, ...data.presets.filter(p => !seen.has(p.id))]);
        }

        let imported = 0;
        for (const s of data.sessions) {
            const res = await logSession(s);
            if (res.ok && res.data.inserted) imported++;
        }

        if (data.goal !== null) {
            const cycle = await getCycle();
            await setCycle({ ...cycle, sessionGoal: data.goal });
        }
        return { ok: true, data: { sessionsImported: imported, format: parsed.format } };
    }

    return {
        read, write,
        getTimer, setTimer, getCycle, setCycle,
        getSettings, putSettings,
        getCustomThemes, setCustomThemes,
        logSession, getSessions,
        listPresets, createPreset, deletePreset,
        exportAll, importAll,
    };
}

// Bound lazily: importing this module must not touch `chrome`, so that the
// pure core stays importable under node:test.
let bound = null;
export function store() {
    if (!bound) bound = createStore(chrome.storage.local);
    return bound;
}
