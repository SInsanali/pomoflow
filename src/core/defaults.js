// Default settings — carried over verbatim from v1 (web/js/timer.js settings
// literal), so an existing user's exported settings import cleanly.

export const DEFAULT_SETTINGS = {
    pomodoroDuration: 25,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    autoStartBreaks: true,
    autoStartPomodoros: false,
    volume: 0.5,
    sound: 'chime',
    // dusk, not mono: a warm ember for focus against a cool blue for breaks
    // reads as a mode change at a glance, and with colorBackground on it tints
    // the whole surface. mono stays the *fallback* (themes.FALLBACK_THEME) —
    // that one is about surviving a corrupt theme, not about looking good.
    theme: 'dusk',
    recentThemes: ['dusk', 'ocean', 'glacier', 'mono'],
    timerStyle: 'flip',
    timerFont: 'system',
    colorBackground: true,
    hideBgWhenRunning: false,
    notifications: true,
};

export const DEFAULT_CYCLE = {
    pomodorosInCycle: 0,   // 0-3, resets after a long break
    totalPomodoros: 0,
    sessionGoal: 4,
};

// A fresh, idle timer. `endsAt` is authoritative while running; `remainingMs`
// while paused — never both.
export const DEFAULT_TIMER = {
    mode: 'pomodoro',
    blockId: null,
    plannedSeconds: DEFAULT_SETTINGS.pomodoroDuration * 60,
    startedAt: null,
    endsAt: null,
    remainingMs: DEFAULT_SETTINGS.pomodoroDuration * 60 * 1000,
    isRunning: false,
};

// Pomodoros per cycle before a long break. v1 hardcoded 4 in
// advanceToNextMode(); sessionGoal is a separate display-only target and
// deliberately does NOT drive the long break.
export const POMODOROS_PER_CYCLE = 4;

// Which settings a preset captures: timing behaviour plus the full appearance
// snapshot. Sound/volume/notifications stay out — they're global preferences,
// not part of a "work style". Unchanged from v1.
export const PRESET_FIELDS = [
    'pomodoroDuration', 'shortBreakDuration', 'longBreakDuration',
    'autoStartBreaks', 'autoStartPomodoros',
    'theme', 'timerStyle', 'timerFont', 'colorBackground', 'hideBgWhenRunning',
];

export const MODE_LABELS = {
    pomodoro: 'Focus',
    shortBreak: 'Short break',
    longBreak: 'Long break',
};

export const FONT_STACKS = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    inter: '"Inter", sans-serif',
    poppins: '"Poppins", sans-serif',
    montserrat: '"Montserrat", sans-serif',
    raleway: '"Raleway", sans-serif',
    jetbrains: '"JetBrains Mono", monospace',
    space: '"Space Mono", monospace',
    orbitron: '"Orbitron", sans-serif',
};

export function durationSeconds(mode, settings) {
    switch (mode) {
        case 'pomodoro': return settings.pomodoroDuration * 60;
        case 'shortBreak': return settings.shortBreakDuration * 60;
        case 'longBreak': return settings.longBreakDuration * 60;
        default: return DEFAULT_SETTINGS.pomodoroDuration * 60;
    }
}
