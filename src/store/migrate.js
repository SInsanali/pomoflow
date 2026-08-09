// Normalizes anything a user might feed the importer into one canonical shape.
//
// Three formats exist in the wild:
//   * v2 backups          — { version: "2.0", settings, customThemes, presets, sessions, goal }
//   * v1 server dumps     — { pomoflow_export_version: 1, sessions, presets, settings }
//   * v1 settings exports — { version: "1.1", settings, customThemes, goal }
//
// The v1 server dump is the one that carries real history: it is a straight
// sqlite3 dump of the old pomoflow.db, and its session rows already use the
// same column names, so migrating is normalization rather than translation.

import { isValidTheme } from '../core/themes.js';

// A session row must have the fields the dashboard and charts read, or it will
// quietly poison the rollups. Reject rather than coerce.
function isValidSession(s) {
    return Boolean(s) &&
        typeof s.id === 'string' &&
        typeof s.mode === 'string' &&
        typeof s.started_at === 'string' &&
        !Number.isNaN(Date.parse(s.started_at)) &&
        Number.isFinite(s.actual_seconds);
}

function isValidPreset(p) {
    return Boolean(p) && typeof p.id === 'string' && typeof p.name === 'string' &&
        p.config && typeof p.config === 'object';
}

export function detectFormat(data) {
    if (!data || typeof data !== 'object') return 'unknown';
    if (data.pomoflow_export_version === 1) return 'v1-server';
    if (typeof data.version === 'string' && data.version.startsWith('2')) return 'v2';
    if (typeof data.version === 'string' && data.version.startsWith('1')) return 'v1-settings';
    // Some hand-made dumps carry no version at all; treat anything with a
    // recognisable payload as importable rather than refusing outright.
    if (Array.isArray(data.sessions) || data.settings) return 'v2';
    return 'unknown';
}

export function normalizeImport(data) {
    const format = detectFormat(data);
    if (format === 'unknown') {
        return { ok: false, error: 'Unrecognised file — expected a Pomoflow export.' };
    }

    const sessions = Array.isArray(data.sessions)
        ? data.sessions.filter(isValidSession).map(s => ({
            id: s.id,
            mode: s.mode,
            started_at: s.started_at,
            ended_at: s.ended_at || s.started_at,
            planned_seconds: Number(s.planned_seconds) || Number(s.actual_seconds) || 0,
            actual_seconds: Number(s.actual_seconds) || 0,
            // SQLite stored this as 0/1; keep it numeric so `completed` compares
            // the same way it did in v1.
            completed: s.completed ? 1 : 0,
        }))
        : [];

    const presets = Array.isArray(data.presets) ? data.presets.filter(isValidPreset) : [];

    const customThemes = {};
    for (const [id, theme] of Object.entries(data.customThemes || {})) {
        if (isValidTheme(theme)) customThemes[id] = theme;
    }

    return {
        ok: true,
        format,
        data: {
            settings: data.settings && typeof data.settings === 'object' ? data.settings : null,
            customThemes,
            presets,
            sessions,
            goal: typeof data.goal === 'number' ? data.goal : null,
        },
    };
}
