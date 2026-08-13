// The palette is a design decision with two measurable rules behind it, and
// both are easy to break by eye when adding a theme — so they are asserted
// rather than trusted. Also covers the HSL conversions the popup's colour
// sliders are built on.

import { test } from "node:test";
import assert from "node:assert/strict";

import { THEMES, hexToHsl, hslToHex, isValidColor } from "../src/core/themes.js";

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

  // And off either end it has to keep wrapping. The sector lookup used to
  // normalise the hue while `x` was computed from the raw value, so the two
  // disagreed outside 0..360 and a hue of -60 produced the channel "-ff". No
  // caller feeds it an out-of-range hue today, which is exactly why the bug
  // needs a test rather than a caller to keep it fixed.
  assert.equal(hslToHex({ h: -60, s: 100, l: 50 }), "#ff00ff");
  assert.equal(hslToHex({ h: 420, s: 100, l: 50 }), "#ffff00");
  assert.equal(hslToHex({ h: -420, s: 100, l: 50 }), hslToHex({ h: 300, s: 100, l: 50 }));

  const grey = hexToHsl("#808080");
  assert.equal(grey.s, 0, "a grey has no saturation to drag");
});
