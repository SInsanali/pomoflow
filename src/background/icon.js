// The toolbar icon is drawn, not loaded.
//
// While a block is running the action shows the minutes remaining in the
// theme's accent colour and nothing else — no static mark underneath, no badge
// pill on top. chrome.action.setIcon only takes bitmaps, and a service worker
// has no DOM canvas, so the number is rasterised here with OffscreenCanvas at
// both toolbar densities.

// 16 is the toolbar's logical size, 32 covers 2x displays. Chrome picks.
const SIZES = [16, 32];

const FAMILY = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Digits have no descender, so the glyph gets the full icon height. 0.72 is the
// cap-height fraction of a typical UI sans, and 0.94 leaves a hair of margin so
// the halo below is not clipped flat against the icon's edge.
const CAP_RATIO = 0.72;
const FILL = 0.9;

export function relativeLuminance(hex) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!match) return 0.5;
    const rgb = parseInt(match[1], 16);
    const channel = (byte) => {
        const c = byte / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel((rgb >> 16) & 255)
        + 0.7152 * channel((rgb >> 8) & 255)
        + 0.0722 * channel(rgb & 255);
}

// A Chrome toolbar is near-white under a light theme and near-black under a
// dark one, and one icon has to survive both. A faint halo of the opposite
// polarity keeps a pale accent (mono) legible on white and a dark accent
// legible on charcoal, without tinting the number itself.
export function haloColor(hex) {
    return relativeLuminance(hex) > 0.45
        ? 'rgba(0, 0, 0, 0.7)'
        : 'rgba(255, 255, 255, 0.7)';
}

export function canDrawIcon() {
    return typeof OffscreenCanvas === 'function';
}

function drawOne(text, color, size) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // Start height-constrained, then shrink if two characters ("25", "<1")
    // would overflow the width.
    const box = size * FILL;
    let px = box / CAP_RATIO;
    ctx.font = `600 ${px}px ${FAMILY}`;
    const width = ctx.measureText(text).width;
    if (width > box) {
        px *= box / width;
        ctx.font = `600 ${px}px ${FAMILY}`;
    }

    const metrics = ctx.measureText(text);
    const ascent = metrics.actualBoundingBoxAscent || px * CAP_RATIO;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = haloColor(color);
    ctx.shadowBlur = Math.max(1, size / 12);
    ctx.fillStyle = color;
    ctx.fillText(text, size / 2, (size + ascent) / 2);

    return ctx.getImageData(0, 0, size, size);
}

// An imageData map for chrome.action.setIcon, or null where this runtime cannot
// rasterise (node's test runner has no OffscreenCanvas) — callers fall back to
// the static icon and the badge.
export function timerIcon(text, color) {
    if (!text || !canDrawIcon()) return null;
    const imageData = {};
    for (const size of SIZES) imageData[size] = drawOne(text, color, size);
    return imageData;
}
