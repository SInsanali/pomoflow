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

// The ink box of `text` at the current font, with fallbacks for runtimes whose
// TextMetrics is partial. Requires textAlign 'center': the left/right extents
// are reported relative to the alignment origin.
function ink(ctx, text, px) {
    const m = ctx.measureText(text);
    const ascent = m.actualBoundingBoxAscent || px * 0.72;
    const descent = m.actualBoundingBoxDescent || 0;
    return {
        ascent,
        height: ascent + descent,
        width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) || m.width,
    };
}

function drawOne(text, color, size) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Half the outline sits outside the glyph on every side, so it has to come
    // out of the budget before anything is sized — leaving it out is what
    // clipped the digits flat against the bottom edge.
    const lineWidth = size * OUTLINE;
    const room = size - lineWidth;

    // Scale from the MEASURED ink box rather than an assumed cap-height ratio.
    // The ratio only has to be wrong by a few percent for the glyph to overrun
    // the canvas, and the fallback face differs by platform.
    const REF = 100;
    ctx.font = `${WEIGHT} ${REF}px ${FAMILY}`;
    const px = REF * (room / ink(ctx, text, REF).height);
    ctx.font = `${WEIGHT} ${px}px ${FAMILY}`;

    // The glyph always gets the FULL height. Two digits are then condensed
    // horizontally to fit the width, rather than scaled down uniformly — a
    // uniform fit leaves "16" about 60% of the icon's height, which is what
    // made the first version read as small and thin next to other extensions.
    const box = ink(ctx, text, px);
    const squeeze = box.width > room ? room / box.width : 1;

    ctx.save();
    // Centre the ink box itself. Centring the em box instead would sit the
    // digits high, because an em box carries descender space that digits do
    // not use.
    ctx.translate(size / 2, (size - box.height) / 2 + box.ascent);
    ctx.scale(squeeze, 1);

    ctx.lineJoin = 'round';
    // The transform thins a vertical stroke by `squeeze`, so widen to compensate
    // and keep the outline even on all sides.
    ctx.lineWidth = lineWidth / squeeze;
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
