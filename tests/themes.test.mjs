// The palette is a design decision with two measurable rules behind it, and
// both are easy to break by eye when adding a theme — so they are asserted
// rather than trusted. Also covers the HSL conversions the popup's colour
// sliders are built on.

import { test } from "node:test";
import assert from "node:assert/strict";

import { THEMES, hexToHsl, hslToHex, isValidColor, mixHex, waitingAccent } from "../src/core/themes.js";
import { POMODOROS_PER_CYCLE } from "../src/core/defaults.js";

const BG = "#0d0d0d";
const MODES = ["pomodoro", "shortBreak", "longBreak"];
const accents = () => Object.entries(THEMES)
  .flatMap(([id, theme]) => MODES.map(mode => [`${id}.${mode}`, theme[mode]]));

// ===== colour maths =====

const channels = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

function linear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// CIELAB, so "far enough apart" means perceptually rather than in raw RGB.
function lab(hex) {
  const [r, g, b] = channels(hex).map(linear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

// ===== the palette =====

test("every accent is legible on the app background", () => {
  // An accent is both text on #0d0d0d (the clock, the mode label) and a fill
  // with #0d0d0d text on it (the primary button), so one ratio covers both.
  for (const [where, color] of accents()) {
    assert.ok(isValidColor(color), `${where} is not a six-digit hex: ${color}`);
    const ratio = contrast(color, BG);
    assert.ok(ratio >= 4.5, `${where} (${color}) is ${ratio.toFixed(2)}:1 on ${BG}`);
  }
});

test("a theme's three modes are visibly different colours", () => {
  // Switching to a break has to look like something happened; three lightnesses
  // of one hue is what the v1 palette got wrong.
  for (const [id, theme] of Object.entries(THEMES)) {
    for (const [a, b] of [["pomodoro", "shortBreak"], ["shortBreak", "longBreak"], ["pomodoro", "longBreak"]]) {
      const apart = deltaE(theme[a], theme[b]);
      assert.ok(apart >= 15, `${id}: ${a} and ${b} are only ${apart.toFixed(1)} ΔE apart`);
    }
  }
});

test("no v1 theme id was dropped", () => {
  // settings.theme, recentThemes and saved presets all store ids: removing one
  // silently resets whoever was using it back to mono.
  const v1 = ["mono", "warm", "violet", "forest", "ocean", "cyberpunk", "berry",
    "coffee", "cherry", "mint", "dusk", "terracotta", "glacier", "nebula",
    "jade", "honey", "blossom"];
  for (const id of v1) assert.ok(THEMES[id], `built-in theme "${id}" disappeared`);
});

// ===== the waiting ramp =====
//
// The "!" a finished block leaves on the toolbar is drawn on a ramp across the
// cycle, so the palette rules above have to hold for the colours BETWEEN the
// accents too — those are shipped colours that no swatch shows.

const ramp = (theme) => Array.from(
  { length: POMODOROS_PER_CYCLE },
  (_, banked) => waitingAccent(theme, "pomodoro", { pomodorosInCycle: banked }),
);

test("every step of the waiting ramp is legible on the app background", () => {
  for (const [id, theme] of Object.entries(THEMES)) {
    ramp(theme).forEach((color, i) => {
      assert.ok(isValidColor(color), `${id} study ${i + 1} is not a hex: ${color}`);
      const ratio = contrast(color, BG);
      assert.ok(ratio >= 4.5, `${id} study ${i + 1} (${color}) is ${ratio.toFixed(2)}:1 on ${BG}`);
    });
  }
});

test("the waiting ramp starts on the focus accent and drifts", () => {
  for (const [id, theme] of Object.entries(THEMES)) {
    const steps = ramp(theme);
    // A fresh cycle looks like the theme: no drift has happened yet.
    assert.equal(steps[0], theme.pomodoro, `${id} does not start on its own accent`);

    // Every step has to move, or the "!" says nothing. 3 ΔE is the floor coffee
    // sets — its three accents are the closest in the set, and a ramp cannot
    // invent separation a palette does not have.
    steps.slice(1).forEach((color, i) => {
      const moved = deltaE(color, steps[i]);
      assert.ok(moved >= 3, `${id}: study ${i + 1} and ${i + 2} are ${moved.toFixed(1)} ΔE apart`);
    });
    const span = deltaE(steps.at(-1), steps[0]);
    assert.ok(span >= 12, `${id}: the whole cycle only spans ${span.toFixed(1)} ΔE`);
  }
});

test("a waiting pomodoro never wears a break's colour", () => {
  // The last pomodoro leans hardest into the long break's accent, and the block
  // after it is the long break — if the ramp reached its endpoint, two
  // consecutive waiting states would be painted the same.
  for (const [id, theme] of Object.entries(THEMES)) {
    for (const color of ramp(theme)) {
      const apart = deltaE(color, theme.longBreak);
      assert.ok(apart >= 5, `${id}: a waiting pomodoro (${color}) reads as the long break`);
    }
  }
});

test("the ramp stays recognisably the focus colour", () => {
  // Unclamped, the mix takes the short way round the wheel however far that is:
  // cyberpunk's green focus and magenta long break are 190° apart, which put
  // "your focus block is waiting" in red. The cap is what stops that.
  for (const [id, theme] of Object.entries(THEMES)) {
    const start = hexToHsl(theme.pomodoro);
    if (!start.s) continue;   // a grey has no hue to rotate away from
    for (const color of ramp(theme)) {
      const turn = Math.abs(((hexToHsl(color).h - start.h + 540) % 360) - 180);
      assert.ok(turn <= 60.5, `${id}: ${color} is ${turn.toFixed(0)}° off the focus accent`);
    }
  }
});

test("only a waiting pomodoro is ramped", () => {
  // Breaks wait too when autoStartBreaks is off, and a break is the thing the
  // ramp points AT — it keeps its own accent whatever the cycle says.
  const theme = THEMES.nebula;
  for (let banked = 0; banked < POMODOROS_PER_CYCLE; banked++) {
    assert.equal(waitingAccent(theme, "shortBreak", { pomodorosInCycle: banked }), theme.shortBreak);
    assert.equal(waitingAccent(theme, "longBreak", { pomodorosInCycle: banked }), theme.longBreak);
  }
});

test("a cycle count outside the ramp still paints something", () => {
  // pomodorosInCycle is written by advanceCycle and stays in 0..3, but it also
  // comes back from storage — a hand-edited or half-migrated profile must not
  // leave the toolbar with an undefined fill.
  const theme = THEMES.nebula;
  const last = waitingAccent(theme, "pomodoro", { pomodorosInCycle: POMODOROS_PER_CYCLE - 1 });
  assert.equal(waitingAccent(theme, "pomodoro", { pomodorosInCycle: 99 }), last, "clamped to the last step");
  assert.equal(waitingAccent(theme, "pomodoro", { pomodorosInCycle: -3 }), theme.pomodoro);
  assert.equal(waitingAccent(theme, "pomodoro", {}), theme.pomodoro);
  assert.equal(waitingAccent(theme, "pomodoro", undefined), theme.pomodoro);
});

test("a mix lands on its endpoints exactly", () => {
  // The ramp's first step IS the accent, not a colour that rounds to it.
  assert.equal(mixHex("#ff0000", "#0000ff", 0), "#ff0000");
  assert.equal(mixHex("#ff0000", "#0000ff", 1), "#0000ff");
  // Halfway round the short way from red to blue is magenta, not the grey an
  // RGB mix would give.
  assert.equal(mixHex("#ff0000", "#0000ff", 0.5), "#ff00ff");
  // A grey borrows the other end's hue instead of dragging the mix through red.
  assert.equal(mixHex("#808080", "#00ff00", 1), "#00ff00");
  assert.equal(hexToHsl(mixHex("#808080", "#0000ff", 0.5)).h, 240);
});

// ===== hsl =====

test("hex survives a round trip through hsl", () => {
  // The popup's sliders hold the draft in HSL. If this drifts, typing a hex
  // into the editor and saving stores a different colour than the one typed.
  const cases = [...accents().map(([, color]) => color),
    "#000000", "#ffffff", "#808080", "#ff0000", "#00ff00", "#0000ff", "#123456"];
  for (const hex of cases) {
    assert.equal(hslToHex(hexToHsl(hex)), hex.toLowerCase(), `${hex} did not survive`);
  }
});

test("hsl lands where the sliders say it should", () => {
  assert.equal(hslToHex({ h: 0, s: 100, l: 50 }), "#ff0000");
  assert.equal(hslToHex({ h: 120, s: 100, l: 50 }), "#00ff00");
  assert.equal(hslToHex({ h: 240, s: 100, l: 50 }), "#0000ff");
  assert.equal(hslToHex({ h: 0, s: 0, l: 100 }), "#ffffff");
  assert.equal(hslToHex({ h: 0, s: 0, l: 0 }), "#000000");
  // Hue is a circle; a slider at either end must not fall off it.
  assert.equal(hslToHex({ h: 360, s: 100, l: 50 }), "#ff0000");

  const grey = hexToHsl("#808080");
  assert.equal(grey.s, 0, "a grey has no saturation to drag");
});
