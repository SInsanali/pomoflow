// The built-in themes. Every theme is just three accents; app.css is entirely
// CSS-variable driven (--pomodoro-accent / --short-break-accent /
// --long-break-accent), so themes and mode-accent switching work here exactly
// as they did in v1.
//
// The v1 set was Material's 2014 palette picked swatch by swatch, and it did
// not survive the move to a #0d0d0d surface: an accent here is both text (the
// clock, the mode label) and a fill with #0d0d0d text on it (the primary
// button), so anything below ~4.5:1 against the background is unreadable in
// both directions at once. Nine of the seventeen failed that — berry's long
// break (#2d1b69) sat at 1.4:1, i.e. invisible — and three more were the same
// hue at three lightnesses, so switching modes read as nothing happening.
//
// Every id from v1 is kept, because settings.theme, recentThemes and saved
// presets all store ids: a dropped id would silently reset someone to mono.
// The colours behind them are retuned to two rules, and the eight new themes
// were built to the same ones:
//
//   * every accent clears 4.5:1 on #0d0d0d (most clear 6:1),
//   * the three accents in a theme sit at least ~18 ΔE apart, so focus, short
//     break and long break are three visibly different states.
//
// Order is the grid order in both surfaces — neutral, warm, pink, purple,
// blue, green, then the neon one — so scanning the swatches walks a spectrum
// instead of a shuffled bag.
export const THEMES = {
    // Neutral — colour that stays out of the way.
    mono:       { pomodoro: '#ececf1', shortBreak: '#b0b6c2', longBreak: '#848b9a' },
    slate:      { pomodoro: '#8fb0d9', shortBreak: '#8ec9b4', longBreak: '#c2a5c6' },

    // Warm — ember work, cooler or lighter rest.
    dusk:       { pomodoro: '#f2723c', shortBreak: '#5b9ee0', longBreak: '#f3a86a' },
    warm:       { pomodoro: '#ff7a4d', shortBreak: '#ffb066', longBreak: '#ffd88a' },
    sunset:     { pomodoro: '#ff5f7e', shortBreak: '#ff9f5a', longBreak: '#ffd28a' },
    terracotta: { pomodoro: '#e8674a', shortBreak: '#ef8f6b', longBreak: '#e5bb92' },
    honey:      { pomodoro: '#f5a524', shortBreak: '#ffd979', longBreak: '#d9a05b' },
    citrus:     { pomodoro: '#b8e62e', shortBreak: '#ffe14d', longBreak: '#ff9f1c' },
    coffee:     { pomodoro: '#d99a63', shortBreak: '#e3c9ac', longBreak: '#b08968' },

    // Pink.
    cherry:     { pomodoro: '#ff3b5f', shortBreak: '#ff9aa8', longBreak: '#c9738c' },
    blossom:    { pomodoro: '#f76c9c', shortBreak: '#ffc2d4', longBreak: '#c98bbf' },
    sakura:     { pomodoro: '#f78fb3', shortBreak: '#f6cbb0', longBreak: '#a8c9a8' },
    berry:      { pomodoro: '#ff5773', shortBreak: '#c77dff', longBreak: '#9d8df1' },

    // Purple.
    violet:     { pomodoro: '#d3a0ff', shortBreak: '#a97cf2', longBreak: '#7b83ee' },
    nebula:     { pomodoro: '#a86bf5', shortBreak: '#f06fb8', longBreak: '#b9c6f2' },
    vapor:      { pomodoro: '#ff7ae0', shortBreak: '#7defff', longBreak: '#b8a6ff' },
    midnight:   { pomodoro: '#7aa2f7', shortBreak: '#7dcfff', longBreak: '#bb9af7' },

    // Blue.
    ocean:      { pomodoro: '#22b8cf', shortBreak: '#4dabf7', longBreak: '#6c8cff' },
    glacier:    { pomodoro: '#3d8bfd', shortBreak: '#56c8e8', longBreak: '#a5dcf5' },
    aurora:     { pomodoro: '#5ce6a0', shortBreak: '#54d1e0', longBreak: '#a68bfa' },

    // Green.
    mint:       { pomodoro: '#2ee0b0', shortBreak: '#8cf0d6', longBreak: '#3ec2d8' },
    jade:       { pomodoro: '#17b394', shortBreak: '#6ed6ae', longBreak: '#b8e6d6' },
    forest:     { pomodoro: '#4fb07a', shortBreak: '#8ecfa0', longBreak: '#c8a45c' },
    moss:       { pomodoro: '#7fb069', shortBreak: '#b4cf87', longBreak: '#d5c39a' },

    // Neon — deliberately loud, and the only theme that stays that way.
    cyberpunk:  { pomodoro: '#39ff14', shortBreak: '#00e5ff', longBreak: '#ff3df5' },
};

export const FALLBACK_THEME = 'mono';

export function isValidColor(color) {
    return typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color);
}

// ===== colour maths =====
//
// The popup builds custom themes on HSL sliders rather than <input
// type="color">: that control opens the OS colour panel, and a Chrome toolbar
// popup closes the moment focus leaves it — the picker would take the half-made
// theme down with it. Sliders are ordinary DOM and cannot.

// Unrounded on purpose. Integer degrees and percents are up to ~2/255 off per
// channel, which is enough that typing #123456 and saving would store #123354;
// the sliders round for display, and only the channel actually dragged is
// snapped to its integer.
export function hexToHsl(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const span = max - min;
    const l = (max + min) / 2;

    let h = 0;
    if (span) {
        if (max === r) h = ((g - b) / span) % 6;
        else if (max === g) h = (b - r) / span + 2;
        else h = (r - g) / span + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const s = span ? span / (1 - Math.abs(2 * l - 1)) : 0;
    return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }) {
    const sat = s / 100;
    const light = l / 100;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = light - c / 2;
    const [r, g, b] = [
        [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
    ][Math.floor((((h % 360) + 360) % 360) / 60)];
    return '#' + [r, g, b]
        .map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0'))
        .join('');
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
    for (const filler of ['dusk', 'ocean', 'glacier', 'mono']) {
        if (next.length >= 4) break;
        if (!next.includes(filler)) next.push(filler);
    }
    return next.slice(0, 4);
}
