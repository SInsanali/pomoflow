// The end-of-block "!" is an alert, and surface.js is where it gets spent: a
// surface the user can actually see acknowledges on their behalf, and the
// toolbar goes back to the Pomoflow mark.
//
// The gate is `document.visibilityState`, and it is the part worth pinning down.
// The pop-out exists to be parked on a second monitor, so "a surface is open"
// and "the user has seen it" are genuinely different facts — get that wrong and
// a window sitting behind a browser swallows the one signal that a block ended.
//
// Driven through the DOM shim: headless Chrome does not complete here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/popup-dom.mjs';
import { DEFAULT_SETTINGS, DEFAULT_CYCLE } from '../src/core/defaults.js';

const SURFACE = new URL('../src/ui/surface.js', import.meta.url);

// A finished block whose next one is queued, unstarted, and not yet seen.
function awaitingState() {
    return {
        timer: {
            mode: 'pomodoro',
            blockId: null,
            plannedSeconds: 1500,
            startedAt: null,
            endsAt: null,
            remainingMs: 1_500_000,
            isRunning: false,
            awaitingStart: true,
            attention: true,
        },
        cycle: { ...DEFAULT_CYCLE },
        settings: { ...DEFAULT_SETTINGS, timerStyle: 'minimal' },
        customThemes: {},
        now: Date.now(),
    };
}

let bootCount = 0;

async function boot({ visibility = 'visible', alwaysSeen = false } = {}) {
    const { document } = installDom({ ids: [] });
    document.visibilityState = visibility;

    const stage = document.createElement('div');
    const display = document.createElement('div');
    display.setAttribute('id', 'timer-display');
    stage.appendChild(display);
    document.body.appendChild(stage);

    const sent = [];
    let state = awaitingState();

    globalThis.chrome = {
        storage: { onChanged: { addListener() {} } },
        runtime: {
            sendMessage: async (msg) => {
                sent.push(msg.type);
                // The worker answers every command with the fresh full state,
                // and ACKNOWLEDGE is the one that spends the alert.
                if (msg.type === 'ACKNOWLEDGE') {
                    state = { ...state, timer: { ...state.timer, attention: false } };
                }
                return state;
            },
        },
    };

    // Cache-busted: each boot needs its own module instance, since createSurface
    // registers document- and window-level listeners.
    const { createSurface } = await import(`${SURFACE}?ack=${bootCount++}`);
    const surface = createSurface({ stage, alwaysSeen });

    return { document, surface, sent, get state() { return state; } };
}

// Let the acknowledgment's fire-and-forget promise settle.
const settle = () => new Promise(r => setTimeout(r, 0));

test('a visible surface acknowledges the block it is showing', async () => {
    const { surface, sent } = await boot({ visibility: 'visible' });

    surface.start();
    await settle();

    assert.deepEqual(sent, ['GET_STATE', 'ACKNOWLEDGE']);
    assert.equal(surface.state.timer.attention, false, 'the "!" is spent');
    assert.equal(surface.state.timer.awaitingStart, true, 'the block is still queued');
});

test('the popup acknowledges whatever its document claims about visibility', async () => {
    // THE REGRESSION. The popup only exists because the toolbar icon was
    // clicked, but its document does not reliably report 'visible' by the time
    // the first state lands — so gating it on visibilityState meant clicking the
    // icon did not dismiss the "!", which is the entire feature.
    for (const visibility of ['hidden', 'prerender', undefined]) {
        const { surface, sent } = await boot({ visibility, alwaysSeen: true });
        surface.start();
        await settle();
        assert.ok(sent.includes('ACKNOWLEDGE'), `dismissed with visibilityState=${visibility}`);
        assert.equal(surface.state.timer.attention, false);
    }
});

test('an unexpected visibilityState errs towards dismissing, not nagging', async () => {
    // A gated surface too: only a document that says it is *hidden* is treated
    // as unseen. Anything else means the alert has done its job.
    const { surface, sent } = await boot({ visibility: undefined });
    surface.start();
    await settle();
    assert.ok(sent.includes('ACKNOWLEDGE'));
});

test('a hidden surface leaves the "!" alone', async () => {
    // The pop-out on the other monitor, behind three other windows.
    const { document, surface, sent } = await boot({ visibility: 'hidden' });

    surface.start();
    await settle();

    assert.deepEqual(sent, ['GET_STATE'], 'nothing was acknowledged');
    assert.equal(surface.state.timer.attention, true);

    // Raised an hour later: THAT is when the user sees it.
    document.visibilityState = 'visible';
    document.dispatchEvent({ type: 'visibilitychange' });
    await settle();

    assert.deepEqual(sent, ['GET_STATE', 'ACKNOWLEDGE']);
    assert.equal(surface.state.timer.attention, false);
});

test('regaining focus acknowledges too', async () => {
    const { surface, sent } = await boot({ visibility: 'hidden' });
    surface.start();
    await settle();
    assert.deepEqual(sent, ['GET_STATE']);

    globalThis.document.visibilityState = 'visible';
    globalThis.window.dispatchEvent({ type: 'focus' });
    await settle();

    assert.ok(sent.includes('ACKNOWLEDGE'));
});

test('an acknowledged surface does not keep asking', async () => {
    // apply() acknowledges, and the answer to ACKNOWLEDGE is itself applied —
    // so the guard against re-entering is what stops this from looping.
    const { document, surface, sent } = await boot({ visibility: 'visible' });

    surface.start();
    await settle();
    const after = sent.length;

    document.dispatchEvent({ type: 'visibilitychange' });
    globalThis.window.dispatchEvent({ type: 'focus' });
    await surface.refresh();
    await settle();

    assert.equal(sent.filter(t => t === 'ACKNOWLEDGE').length, 1, 'asked exactly once');
    assert.equal(sent.length, after + 1, 'and only the refresh was added');
});

test('a running block is never acknowledged', async () => {
    const { surface, sent } = await boot({ visibility: 'visible' });
    // Feed it a running block directly: `attention` is false, so there is
    // nothing to spend and the surface must not send a pointless write.
    const running = awaitingState();
    running.timer = {
        ...running.timer,
        isRunning: true,
        endsAt: Date.now() + 1_500_000,
        awaitingStart: false,
        attention: false,
    };
    surface.apply(running);
    await settle();

    assert.deepEqual(sent, []);
});
