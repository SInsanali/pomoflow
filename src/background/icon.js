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

// A hairline of margin on every edge. Every other action in the toolbar draws
// its mark inside its own box; running the digits right to the canvas edge is
// what made this one read as oversized beside them.
const INSET = 0.06;

// How far two digits may be condensed before they stop reading as digits.
// Fitting "21" on width alone asks for about 0.64, which is a squash — past
// this floor the remainder comes off the font size instead.
const MIN_SQUEEZE = 0.78;

// No outline. Earlier versions drew one in the opposite polarity so that a pale
// accent would survive a light toolbar — but on a dark toolbar that put a white
// rim around every saturated colour, which is worse than the problem it solved.
// The number is now flat accent colour, and the whole icon height is its budget.
//
// The trade-off left standing: a pale accent (mono, coffee) on a LIGHT toolbar
// is low contrast. Bring the outline back for the light-coloured half only if
// that ever matters.

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

    // The glyph's box, inset from the canvas edge on every side.
    const room = size * (1 - 2 * INSET);

    // Scale from the MEASURED ink box rather than an assumed cap-height ratio.
    // The ratio only has to be wrong by a few percent for the glyph to overrun
    // the canvas, and the fallback face differs by platform.
    const REF = 100;
    ctx.font = `${WEIGHT} ${REF}px ${FAMILY}`;
    let px = REF * (room / ink(ctx, text, REF).height);
    ctx.font = `${WEIGHT} ${px}px ${FAMILY}`;

    // The glyph starts at the full height of that box and is condensed to fit
    // its width, rather than scaled down uniformly — a uniform fit leaves "16"
    // about 60% of the icon's height, which is what made the first version read
    // as small and thin next to other extensions. But condensing alone takes
    // two digits down to ~0.64, which squashes them, so the squeeze stops at
    // MIN_SQUEEZE and the rest of the fit comes off the font size.
    const wide = ink(ctx, text, px).width;
    let squeeze = 1;
    if (wide > room) {
        const fit = room / wide;
        squeeze = Math.max(fit, MIN_SQUEEZE);
        px *= fit / squeeze;
        ctx.font = `${WEIGHT} ${px}px ${FAMILY}`;
    }

    const box = ink(ctx, text, px);

    ctx.save();
    // Centre the ink box itself. Centring the em box instead would sit the
    // digits high, because an em box carries descender space that digits do
    // not use.
    ctx.translate(size / 2, (size - box.height) / 2 + box.ascent);
    ctx.scale(squeeze, 1);

    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();

    return ctx.getImageData(0, 0, size, size);
}

// The packaged mark, rasterised to imageData rather than handed to Chrome as a
// path.
//
// chrome.action.setIcon({path}) makes Chrome fetch the file itself, and in an
// MV3 service worker that fetch fails: "Failed to set icon 'src/icons/16.png':
// Failed to fetch". The rejection is swallowed by the caller's catch, so the
// toolbar silently keeps whatever was drawn last — a finished block's "!" or a
// stale minute count that no later paint can clear, because every attempt takes
// the same failing route.
//
// Fetching the PNG ourselves and handing over pixels sidesteps it entirely, and
// puts the at-rest icon on the same imageData path as the digits, which never
// had the problem.
//
// Cached because the bytes never change; the cache dies with the worker, which
// is the right lifetime for it.
let markCache = null;

export async function markIcon() {
    if (markCache) return markCache;
    if (!canDrawIcon() || typeof createImageBitmap !== 'function' ||
        typeof fetch !== 'function') return null;
    try {
        const imageData = {};
        for (const size of SIZES) {
            const url = chrome.runtime.getURL(`src/icons/${size}.png`);
            const bitmap = await createImageBitmap(await (await fetch(url)).blob());
            const canvas = new OffscreenCanvas(size, size);
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(bitmap, 0, 0, size, size);
            imageData[size] = ctx.getImageData(0, 0, size, size);
        }
        markCache = imageData;
        return imageData;
    } catch (e) {
        // Falls back to the path form, which is no worse than before.
        return null;
    }
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
