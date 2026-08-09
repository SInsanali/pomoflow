// The 17 built-in themes, lifted verbatim from v1 (web/js/timer.js). Every
// theme is just three accents; app.css is entirely CSS-variable driven
// (--pomodoro-accent / --short-break-accent / --long-break-accent), so themes
// and mode-accent switching work here exactly as they did in v1.

export const THEMES = {
    mono:       { pomodoro: '#e0e0e0', shortBreak: '#9e9e9e', longBreak: '#757575' },
    warm:       { pomodoro: '#ff7043', shortBreak: '#ffb74d', longBreak: '#fff176' },
    violet:     { pomodoro: '#ba68c8', shortBreak: '#9575cd', longBreak: '#7986cb' },
    forest:     { pomodoro: '#66bb6a', shortBreak: '#a5d6a7', longBreak: '#8d6e63' },
    ocean:      { pomodoro: '#26c6da', shortBreak: '#29b6f6', longBreak: '#5c6bc0' },
    cyberpunk:  { pomodoro: '#39ff14', shortBreak: '#00ffff', longBreak: '#ff00ff' },
    berry:      { pomodoro: '#ff4d6d', shortBreak: '#6c63ff', longBreak: '#2d1b69' },
    coffee:     { pomodoro: '#d7ccc8', shortBreak: '#a1887f', longBreak: '#6d4c41' },
    cherry:     { pomodoro: '#ff1744', shortBreak: '#ff8a80', longBreak: '#e91e63' },
    mint:       { pomodoro: '#1de9b6', shortBreak: '#64ffda', longBreak: '#00bfa5' },
    dusk:       { pomodoro: '#e86a2c', shortBreak: '#4a90d9', longBreak: '#f5a167' },
    terracotta: { pomodoro: '#c62828', shortBreak: '#ff7043', longBreak: '#ffccbc' },
    glacier:    { pomodoro: '#1565c0', shortBreak: '#00acc1', longBreak: '#4fc3f7' },
    nebula:     { pomodoro: '#8e24aa', shortBreak: '#e91e63', longBreak: '#b0bec5' },
    jade:       { pomodoro: '#00897b', shortBreak: '#4db6ac', longBreak: '#b2dfdb' },
    honey:      { pomodoro: '#f9a825', shortBreak: '#ffca28', longBreak: '#d4a017' },
    blossom:    { pomodoro: '#d81b60', shortBreak: '#f48fb1', longBreak: '#c2185b' },
};

export const FALLBACK_THEME = 'mono';

export function isValidColor(color) {
    return typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color);
}

export function isValidTheme(theme) {
    return Boolean(theme) &&
        isValidColor(theme.pomodoro) &&
        isValidColor(theme.shortBreak) &&
        isValidColor(theme.longBreak);
}

// Resolve a theme id against custom themes first, then built-ins, falling back
// to mono for anything missing or malformed — a corrupt custom theme must never
// leave the UI without accents.
export function resolveTheme(themeId, customThemes = {}) {
    const theme = customThemes[themeId] || THEMES[themeId];
    return isValidTheme(theme) ? theme : THEMES[FALLBACK_THEME];
}

// The accent variable that a given mode reads from.
export function accentVarForMode(mode) {
    switch (mode) {
        case 'shortBreak': return '--short-break-accent';
        case 'longBreak': return '--long-break-accent';
        default: return '--pomodoro-accent';
    }
}

// Keep the recent-themes strip at 4 entries, most-recent first (v1's
// updateRecentThemes + validateSettings, merged).
export function withRecentTheme(recentThemes, themeId) {
    const next = (recentThemes || []).filter(id => id !== themeId);
    next.unshift(themeId);
    return next.slice(0, 4);
}

export function padRecentThemes(recentThemes, customThemes = {}) {
    const next = (recentThemes || []).filter(
        id => isValidTheme(customThemes[id] || THEMES[id])
    );
    for (const filler of ['mono', 'dusk', 'ocean', 'glacier']) {
        if (next.length >= 4) break;
        if (!next.includes(filler)) next.push(filler);
    }
    return next.slice(0, 4);
}
