// The seam: a real surface talking to the real service worker over one fake
// chrome, instead of each half being checked against a mock of the other.
//
// This exists because the first cut of the acknowledgment shipped with the
// worker test sending ACKNOWLEDGE by hand and the surface test answering itself
// from a stub — so the wire between them, which is where "clicking the icon did
// nothing" lives, was never actually run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/popup-dom.mjs';

const storage = {};
const listeners = {};
const calls = { icon: [], badge: [], titles: [], notifications: [], dismissed: [] };

class FakeOffscreenCanvas {
    constructor(size) { this.width = size; this.drawn = null; }
    getContext() {
        const canvas = this;
        return {
            font: '', fillStyle: null,
            clearRect() {}, save() {}, restore() {}, translate() {}, scale() {},
            measureText(text) {
                const px = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10);
                return { width: text.length * px * 0.6, actualBoundingBoxAscent: px * 0.72 };
            },
            fillText(text) { canvas.drawn = { text, color: this.fillStyle }; },
            getImageData() { return { ...canvas.drawn }; },
        };
    }
}
globalThis.OffscreenCanvas = FakeOffscreenCanvas;

// Routes chrome.runtime.sendMessage into the worker's own onMessage listener,
// the way Chrome does — including the promise it hands back to the caller.
function sendMessage(msg) {
    return new Promise((resolve) => {
        if (msg.target === 'offscreen') return resolve();      // the audio document
        const kept = listeners.message(msg, {}, resolve);
        if (!kept) resolve(undefined);
    });
}

globalThis.chrome = {
    storage: {
        local: {
            async get(key) {
                return storage[key] === undefined ? {} : { [key]: structuredClone(storage[key]) };
            },
            async set(obj) {
                for (const [k, v] of Object.entries(obj)) storage[k] = structuredClone(v);
                for (const fn of listeners.changed || []) {
                    fn(Object.fromEntries(Object.keys(obj).map(k => [k, {}])), 'local');
                }
            },
        },
        onChanged: {
            addListener: (fn) => { (listeners.changed ||= []).push(fn); },
        },
    },
    alarms: {
        create: () => {},
        clear: async () => {},
        onAlarm: { addListener: (fn) => { listeners.alarm = fn; } },
    },
    action: {
        setBadgeText: async ({ text }) => { calls.badge.push(text); },
        setBadgeBackgroundColor: async () => {},
        setIcon: async ({ imageData, path }) => {
            calls.icon.push(imageData ? imageData[16] : { text: null, path });
        },
        setTitle: async ({ title }) => { calls.titles.push(title); },
    },
    notifications: {
        create: async (id, opts) => { calls.notifications.push({ id, ...opts }); },
        clear: async (id) => { calls.dismissed.push(id); },
        onClicked: { addListener: (fn) => { listeners.notificationClick = fn; } },
    },
    runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener: (fn) => { listeners.message = fn; } },
        getURL: (p) => `chrome-extension://fake/${p}`,
        getContexts: async () => [],
        sendMessage,
    },
    commands: { onCommand: { addListener() {} } },
    offscreen: { hasDocument: async () => false, createDocument: async () => {} },
    tabs: { create: async () => {}, update: async () => {} },
    windows: { create: async () => {}, update: async () => {} },
};

await import('../src/background/service-worker.js');
const { createSurface } = await import('../src/ui/surface.js');

const settle = () => new Promise(r => setTimeout(r, 0));

// A DOM for the surface to paint into. The shim is installed after the worker so
// the worker never sees a document — it does not have one in Chrome either.
function mountSurface({ visibility = 'visible', alwaysSeen = false } = {}) {
    const { document } = installDom({ ids: [] });
    document.visibilityState = visibility;

    const stage = document.createElement('div');
    const display = document.createElement('div');
    display.setAttribute('id', 'timer-display');
    stage.appendChild(display);
    document.body.appendChild(stage);

    return { document, surface: createSurface({ stage, alwaysSeen }) };
}

// Run a pomodoro and the break it auto-starts, so the next pomodoro is left
// waiting with the "!" up. Uses the worker's own alarm path.
async function runToTheAttentionMark() {
    await sendMessage({ type: 'START' });
    for (let i = 0; i < 2; i++) {
        const deadline = storage.timer.endsAt;
        Date.now = () => deadline + 1_000;
        await listeners.alarm({ name: 'block-end' });
    }
}

test('opening a surface clears the "!" the worker just painted', async () => {
    const realNow = Date.now;
    try {
        await runToTheAttentionMark();
        assert.equal(calls.icon.at(-1).text, '!', 'the worker is showing the mark');
        assert.equal(storage.timer.attention, true);

        // What clicking the toolbar icon does: the popup mounts and starts. Its
        // document is deliberately claiming 'hidden' here — that is what a real
        // popup did, and the whole feature failed on it.
        const { surface } = mountSurface({ visibility: 'hidden', alwaysSeen: true });
        surface.start();
        await settle();
        await settle();

        assert.equal(storage.timer.attention, false, 'the worker was told');
        assert.equal(calls.icon.at(-1).text, null, 'and the Pomoflow mark is back');
        assert.equal(storage.timer.awaitingStart, true, 'the block still waits');
        assert.match(calls.titles.at(-1), /ready to start/);
    } finally {
        Date.now = realNow;
    }
});
