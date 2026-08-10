// Makes a timer-font <select> show the fonts.
//
// Eight names rendered in one typeface tell you nothing — you cannot pick
// Raleway over Montserrat by reading the words. Both surfaces have the same
// list, so the behaviour lives here rather than twice.

import { FONT_STACKS } from '../core/defaults.js';

let requested = false;

// The @font-face rules only fetch when something renders in them, so the first
// open would otherwise paint the list in the fallback face and reflow once the
// files land. Ask for all eight up front — they are local, and the weight has
// to match the declarations (500) or the request resolves against nothing.
function preloadFaces() {
    if (requested || !document.fonts) return;
    requested = true;
    for (const stack of Object.values(FONT_STACKS)) {
        document.fonts.load(`500 14px ${stack}`).catch(() => {});
    }
}

// Keeps the *closed* select in the chosen face. Separate from showFontFaces
// because loading a form sets .value programmatically, which fires no event.
export function syncFontFace(select) {
    select.style.fontFamily = FONT_STACKS[select.value] || FONT_STACKS.system;
}

export function showFontFaces(select) {
    preloadFaces();
    for (const option of select.options) {
        option.style.fontFamily = FONT_STACKS[option.value] || FONT_STACKS.system;
    }
    syncFontFace(select);
    select.addEventListener('change', () => syncFontFace(select));
}
