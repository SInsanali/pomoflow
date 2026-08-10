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
// cap-height fraction of a typical UI sans; 0.94 leaves a hair of margin so the
// outline is not clipped flat against the icon's edge.
const CAP_RATIO = 0.72;
const FILL = 0.94;

// Heavy, because 16 device pixels is not much to carry a stroke.
const WEIGHT = 700;

// A crisp outline rather than a blurred glow: at this size a soft shadow just
// smears the edge it is supposed to define. strokeText centres the stroke on
// the glyph path, so half of this eats inwards — keep it thin, or the number
// reads as hollow outlined text instead of a solid number with an edge.
const OUTLINE = 1 / 16;

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
// dark one, and one icon has to survive both. Outlining in the opposite
// polarity keeps a pale accent (mono) legible on white and a dark accent
// legible on charcoal, without tinting the number itself.
export function outlineColor(hex) {
    return relativeLuminance(hex) > 0.45
        ? 'rgba(0, 0, 0, 0.8)'
        : 'rgba(255, 255, 255, 0.8)';
}

export function canDrawIcon() {
    return typeof OffscreenCanvas === 'function';
}

function drawOne(text, color, size) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // The glyph always gets the FULL height. Two digits are then condensed
    // horizontally to fit the width, rather than scaled down uniformly — a
    // uniform fit leaves "16" about 60% of the icon's height, which is what
    // made the first version read as small and thin next to other extensions.
    const box = size * FILL;
    const px = box / CAP_RATIO;
    ctx.font = `${WEIGHT} ${px}px ${FAMILY}`;

    const metrics = ctx.measureText(text);
    const squeeze = metrics.width > box ? box / metrics.width : 1;
    const ascent = metrics.actualBoundingBoxAscent || px * CAP_RATIO;

    ctx.save();
    // Baseline sits so the cap is optically centred, then the horizontal
    // condense happens around that centre.
    ctx.translate(size / 2, (size + ascent) / 2);
    ctx.scale(squeeze, 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    // The transform thins a vertical stroke by `squeeze`, so widen to compensate
    // and keep the outline even on all sides.
    ctx.lineWidth = (size * OUTLINE) / squeeze;
    ctx.strokeStyle = outlineColor(color);
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();

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
