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
// The built-in themes. Every theme is just three accents; app.css is entirely
// CSS-variable driven (--pomodoro-accent / --short-break-accent /
// --long-break-accent), so themes and mode-accent switching work here exactly
// as they did in v1.
//
// An accent is both text on #0d0d0d (the clock, the mode label) and a fill with
// #0d0d0d text on it (the primary button), so anything below ~4.5:1 against the
// background is unreadable in both directions at once. Every value here is
// DERIVED rather than picked: each theme is specified as hue/saturation/
// lightness intent and its lightness raised until it clears the ratio, then
// checked for mode separation. tests/themes.test.mjs asserts both rules.
//
//   * every accent clears 4.5:1 on #0d0d0d (most clear 6:1),
//   * the three accents in a theme sit at least 15 ΔE apart, so focus, short
//     break and long break are three visibly different states.
//
// Beyond those two, the set is chosen for spread: the 23 focus accents walk the
// hue wheel with no gap wider than 34°, no two themes sit closer than ~20 ΔE,
// and the internal harmony is varied on purpose — analogous, complementary,
// triadic and separated-by-lightness all appear, because 23 variations on
// "three tints of one hue" is what made the old set read as one theme.
//
// Every id from v1 is kept, because settings.theme, recentThemes and saved
// presets all store ids: a dropped id would silently reset someone to mono.
//
// Order is the grid order in both surfaces: six per row, four rows, walking the
// spectrum. The 24th cell is the custom-theme button, which is why there are
// 23 built-ins and not 24.
export const THEMES = {
    // Neutral — colour that stays out of the way.
    mono:       { pomodoro: '#efeff1', shortBreak: '#b7bbc2', longBreak: '#848b9a' },   // neutral
    slate:      { pomodoro: '#a7bbd2', shortBreak: '#98c3ba', longBreak: '#caadcd' },   // quiet, tinted
    dusk:       { pomodoro: '#f06938', shortBreak: '#61a8e5', longBreak: '#efb261' },   // complementary — ember vs sky
    warm:       { pomodoro: '#fb7941', shortBreak: '#faae57', longBreak: '#f9db76' },
    honey:      { pomodoro: '#f6b828', shortBreak: '#fae76b', longBreak: '#de965e' },
    terracotta: { pomodoro: '#dd634b', shortBreak: '#de9a73', longBreak: '#d4b991' },

    coffee:     { pomodoro: '#cc8b66', shortBreak: '#ebdecc', longBreak: '#cdbf98' },
    citrus:     { pomodoro: '#b9e935', shortBreak: '#f9e743', longBreak: '#f79f3b' },   // chartreuse
    cherry:     { pomodoro: '#f74569', shortBreak: '#f5adc8', longBreak: '#d98a81' },
    blossom:    { pomodoro: '#f372aa', shortBreak: '#f1b1ba', longBreak: '#d69ad6' },
    berry:      { pomodoro: '#f4528e', shortBreak: '#d47bea', longBreak: '#9a8be4' },   // warm to cool
    orchid:     { pomodoro: '#ea66e1', shortBreak: '#d295e4', longBreak: '#e891ba' },   // magenta

    nebula:     { pomodoro: '#b25cf5', shortBreak: '#ee63c4', longBreak: '#a3b9eb' },   // triadic
    violet:     { pomodoro: '#db8cf8', shortBreak: '#9373de', longBreak: '#afbde9' },
    indigo:     { pomodoro: '#8a83ec', shortBreak: '#bd9de7', longBreak: '#80ace5' },   // deep blue-violet
    ocean:      { pomodoro: '#25c4e4', shortBreak: '#51a3ec', longBreak: '#8499eb' },
    glacier:    { pomodoro: '#4daeef', shortBreak: '#7bdbea', longBreak: '#b8ccea' },
    aurora:     { pomodoro: '#47e17f', shortBreak: '#5fe7e7', longBreak: '#c08eeb' },   // green to cyan to violet

    mint:       { pomodoro: '#3ae2ee', shortBreak: '#93f0e4', longBreak: '#6cb8e5' },
    jade:       { pomodoro: '#24bc9e', shortBreak: '#97d8be', longBreak: '#b8dce0' },
    fern:       { pomodoro: '#4bd241', shortBreak: '#79d792', longBreak: '#a5d65c' },   // leaf green
    forest:     { pomodoro: '#3dc280', shortBreak: '#89d19a', longBreak: '#d4b55e' },   // split-complementary — green vs gold
    cyberpunk:  { pomodoro: '#40ff1a', shortBreak: '#00e5ff', longBreak: '#ff3df9' },   // deliberately loud, and the only theme that stays that way
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
    // Wrapped ONCE, up front, and used for both terms below. The sector lookup
    // used to normalise on its own while `x` was computed from the raw hue. Every
    // caller today feeds this a hue already inside 0..360 (the popup's sliders),
    // where the two agree — but the disagreement is a real bug for any hue off
    // either end of the circle: -60 gave x = -c and a channel that formatted as
    // the string "-ff".
    const hue = (((h % 360) + 360) % 360);
    const sat = s / 100;
    const light = l / 100;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = light - c / 2;
    const [r, g, b] = [
        [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
    ][Math.floor(hue / 60)];
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
    for (const filler of ['nebula', 'ocean', 'glacier', 'mono']) {
        if (next.length >= 4) break;
        if (!next.includes(filler)) next.push(filler);
    }
    return next.slice(0, 4);
}
