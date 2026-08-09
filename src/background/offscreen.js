// Audio host. Exists only because service workers have no AudioContext.
//
// Chrome allows exactly one offscreen document per extension and reclaims it,
// so this document must be cheap to recreate and must never assume it has been
// alive since the last sound.

import { playSound, SOUND_DURATION_MS } from '../core/sounds.js';

let ctx = null;
let closeTimer = null;

function audioContext() {
    if (!ctx || ctx.state === 'closed') ctx = new AudioContext();
    return ctx;
}

// Let the sound finish, then let Chrome reclaim the document. Closing early
// would cut the tail off the gong; holding it open forever wastes a process
// and blocks the next createDocument call.
function scheduleClose(afterMs) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
        chrome.offscreen.closeDocument().catch(() => {});
    }, afterMs + 250);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'offscreen' || msg.type !== 'PLAY_SOUND') return false;
    try {
        const ac = audioContext();
        // A context created without a user gesture can start suspended.
        if (ac.state === 'suspended') ac.resume();
        const durationMs = playSound(ac, msg.sound, msg.volume);
        scheduleClose(durationMs || SOUND_DURATION_MS.chime);
        sendResponse({ ok: true });
    } catch (e) {
        console.warn('Pomoflow: offscreen playback failed', e);
        sendResponse({ ok: false, error: String(e) });
    }
    return true;
});
