// Drives the real service worker against a fake `chrome`, so the wiring that
// matters most — alarm fires, block completes, session is logged exactly once,
// cycle advances, badge updates — is covered without a browser.
//
// The worker is thin by design (it delegates arithmetic to core/clock.js), but
// "thin" is not "trivial": the ordering around completion and the guard against
// double-completion are exactly the parts that would silently corrupt history.

import { test } from "node:test";
import assert from "node:assert/strict";
// Read the accents rather than repeating them: what these tests care about is
// that the icon follows the theme, not what shade of violet nebula is this year.
import { THEMES } from "../src/core/themes.js";
import { dayStamp } from "../src/core/clock.js";
import { POMODOROS_PER_CYCLE } from "../src/core/defaults.js";

const T0 = 1_760_000_000_000;

// A fake chrome surface covering only what the worker touches.
//
// There is exactly one of these for the whole file, and the worker is imported
// once against it. That is deliberate: store/storage.js binds chrome.storage
// lazily but then caches the binding at module scope, and ESM hands every
// importer the same module instance — so a second "fresh" worker would still
// write into the first fake's storage. Tests reset the shared fake instead,
// which is also closer to reality: one worker, many wake-ups.
const storage = {};
const listeners = {};
const calls = { badge: [], icon: [], titles: [], notifications: [], alarms: [], cleared: [], offscreen: [] };

// The worker draws the minutes remaining straight onto the toolbar icon, so the
// fake has to be able to rasterise. This one records what was drawn instead of
// producing pixels: enough to assert the number and the theme colour reaching
// chrome.action.setIcon, which is the part that can actually regress.
class FakeOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.drawn = null;
  }

  getContext() {
    const canvas = this;
    return {
      font: "",
      fillStyle: null,
      strokeStyle: null,
      lineWidth: 0,
      lineJoin: "",
      clearRect() {},
      save() {},
      restore() {},
      translate() {},
      scale() {},
      measureText(text) {
        const px = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10);
        return { width: text.length * px * 0.6, actualBoundingBoxAscent: px * 0.72 };
      },
      // The outline is drawn first and the fill over it, so recording on fill
      // captures the colour that ends up on top — the one that has to track
      // the theme.
      strokeText() {},
      fillText(text) { canvas.drawn = { text, color: this.fillStyle }; },
      getImageData() { return { ...canvas.drawn, size: canvas.width }; },
    };
  }
}

globalThis.OffscreenCanvas = FakeOffscreenCanvas;

function installFakeChrome() {
  const chrome = {
    storage: {
      local: {
        async get(key) {
          return storage[key] === undefined ? {} : { [key]: structuredClone(storage[key]) };
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) storage[k] = JSON.parse(JSON.stringify(v));
        },
      },
      onChanged: { addListener() {} },
    },
    alarms: {
      create: (name, opts) => calls.alarms.push({ name, ...opts }),
      clear: async (name) => { calls.cleared.push(name); },
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
      create: async (id, opts) => { calls.notifications.push(opts); },
      clear: async () => {},
      onClicked: { addListener() {} },
    },
    runtime: {
      onInstalled: { addListener: (fn) => { listeners.installed = fn; } },
      onStartup: { addListener: (fn) => { listeners.startup = fn; } },
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
      getURL: (p) => `chrome-extension://fake/${p}`,
      getContexts: async () => [],
      sendMessage: async () => { calls.offscreen.push("sent"); },
    },
    commands: { onCommand: { addListener: (fn) => { listeners.command = fn; } } },
    offscreen: {
      hasDocument: async () => false,
      createDocument: async () => { calls.offscreen.push("created"); },
    },
    tabs: { create: async () => {}, update: async () => {} },
    windows: { create: async () => {}, update: async () => {} },
  };

  globalThis.chrome = chrome;
}

installFakeChrome();
await import("../src/background/service-worker.js");

// Wipe every trace of the previous test: stored state, recorded calls, and any
// chrome method a test replaced.
function reset() {
  for (const key of Object.keys(storage)) delete storage[key];
  for (const list of Object.values(calls)) list.length = 0;
  chrome.offscreen.hasDocument = async () => false;
  chrome.offscreen.createDocument = async () => { calls.offscreen.push("created"); };
}

// Send a command the way the popup does and wait for the worker's response.
function sendMessage(listeners, msg) {
  return new Promise((resolve) => {
    const kept = listeners.message(msg, {}, resolve);
    assert.equal(kept, true, "worker must keep the message channel open");
  });
}

// Every test starts from a clean slate against the single shared worker.
async function freshWorker() {
  reset();
  return { storage, listeners, calls };
}

test("starting a block schedules an exact-deadline alarm and draws the minutes", async () => {
  const { listeners, calls, storage } = await freshWorker();

  const state = await sendMessage(listeners, { type: "START" });
  assert.equal(state.timer.isRunning, true);
  assert.equal(storage.timer.endsAt - storage.timer.startedAt, 1_500_000);

  const blockEnd = calls.alarms.find(a => a.name === "block-end");
  assert.ok(blockEnd, "a one-shot alarm is set at the deadline");
  assert.equal(blockEnd.when, storage.timer.endsAt);

  const badgeAlarm = calls.alarms.find(a => a.name === "badge-refresh");
  assert.equal(badgeAlarm.periodInMinutes, 0.5, "30s is the repeating alarm floor");
  assert.equal(calls.icon.at(-1).text, "25", "the minutes are the icon");
  assert.equal(calls.icon.at(-1).color, THEMES.nebula.pomodoro, "drawn in the default theme's pomodoro accent");
  assert.equal(calls.badge.at(-1), "", "no badge pill behind the number");
});

test("the drawn number follows the theme and the mode accent", async () => {
  const { listeners, calls, storage } = await freshWorker();
  storage.settings = { theme: "ocean" };

  await sendMessage(listeners, { type: "START" });
  assert.equal(calls.icon.at(-1).color, THEMES.ocean.pomodoro, "ocean pomodoro");

  await sendMessage(listeners, { type: "SWITCH_MODE", mode: "shortBreak" });
  await sendMessage(listeners, { type: "START" });
  assert.equal(calls.icon.at(-1).color, THEMES.ocean.shortBreak, "ocean short break");
  assert.equal(calls.icon.at(-1).text, "5");
});

test("a block that ends with nothing open is logged once and advances the cycle", async () => {
  // The single most important behaviour in the rewrite: no document is open,
  // the alarm is the only thing that fires.
  const { listeners, calls, storage } = await freshWorker();
  await sendMessage(listeners, { type: "START" });

  // Wind the clock past the deadline, then fire the alarm as Chrome would.
  // The deadline is captured first: the worker rewrites storage.timer during
  // completion, so reading it from inside the Date.now stub would be circular.
  const deadline = storage.timer.endsAt;
  const realNow = Date.now;
  Date.now = () => deadline + 5_000;
  try {
    await listeners.alarm({ name: "block-end" });

    assert.equal(storage.sessions.length, 1, "exactly one session logged");
    const [logged] = storage.sessions;
    assert.equal(logged.mode, "pomodoro");
    assert.equal(logged.completed, 1);
    assert.equal(logged.actual_seconds, 1500);

    assert.equal(storage.cycle.totalPomodoros, 1);
    assert.equal(storage.cycle.pomodorosInCycle, 1);
    assert.equal(storage.timer.mode, "shortBreak");
    assert.equal(storage.timer.isRunning, true, "breaks auto-start");

    assert.equal(calls.notifications.at(-1).title, "Pomodoro Complete!");
    assert.ok(calls.offscreen.length, "the offscreen audio document was used");
  } finally {
    Date.now = realNow;
  }
});

test("a finished break marks the toolbar, because the next block waits on you", async () => {
  // Breaks auto-start, pomodoros do not — so the end of a break is exactly the
  // moment nothing happens next until the user acts.
  const { listeners, calls, storage } = await freshWorker();
  await sendMessage(listeners, { type: "START" });

  const realNow = Date.now;
  try {
    let deadline = storage.timer.endsAt;
    Date.now = () => deadline + 1_000;
    await listeners.alarm({ name: "block-end" });
    assert.equal(storage.timer.mode, "shortBreak");
    assert.equal(storage.timer.isRunning, true, "the break started itself");
    assert.notEqual(calls.icon.at(-1).text, "!", "nothing is waiting yet");

    deadline = storage.timer.endsAt;
    Date.now = () => deadline + 1_000;
    await listeners.alarm({ name: "block-end" });

    assert.equal(storage.timer.mode, "pomodoro");
    assert.equal(storage.timer.isRunning, false);
    assert.equal(storage.timer.awaitingStart, true);
    assert.equal(calls.icon.at(-1).text, "!", "the toolbar asks for a decision");
    assert.match(calls.titles.at(-1), /ready to start/);

    // Starting it is what clears the mark.
    await sendMessage(listeners, { type: "START" });
    assert.equal(storage.timer.awaitingStart, false);
    assert.equal(calls.icon.at(-1).text, "25");
  } finally {
    Date.now = realNow;
  }
});

test("the waiting mark is coloured by the block that just ended", async () => {
  // The "!" names the block you just closed out, NOT the one queued behind it:
  // finish a break and it wears the break's accent even though a pomodoro is
  // what waits. It used to paint the waiting block instead, which made every
  // "!" the focus accent — a finished short break and a finished long break
  // were indistinguishable, and so was a fresh cycle from a spent one.
  const { listeners, calls, storage } = await freshWorker();
  const theme = THEMES.nebula;

  const realNow = Date.now;
  try {
    const seen = [];
    for (let round = 0; round < POMODOROS_PER_CYCLE; round++) {
      // A pomodoro, then the break that starts itself; the "!" lands when the
      // break ends and the next pomodoro is left waiting.
      for (const _ of [0, 1]) {
        await sendMessage(listeners, { type: "START" });
        const deadline = storage.timer.endsAt;
        Date.now = () => deadline + 1_000;
        await listeners.alarm({ name: "block-end" });
      }
      assert.equal(calls.icon.at(-1).text, "!", `round ${round + 1} should be waiting`);
      assert.equal(storage.timer.mode, "pomodoro", "a pomodoro is what waits");
      seen.push(calls.icon.at(-1).color);
    }

    // The first three rounds follow a short break; the fourth pomodoro of a
    // cycle ends in the long break, so the last mark is the long break's.
    assert.deepEqual(
      seen,
      [theme.shortBreak, theme.shortBreak, theme.shortBreak, theme.longBreak],
      "each mark wears the accent of the break that ended",
    );
    assert.equal(storage.timer.endedMode, "longBreak", "recorded on the timer, not recomputed");

    // A wake-up repaints from storage and nothing else, so the colour has to
    // survive being written down — this is the path a restarted worker takes.
    await listeners.alarm({ name: "badge-refresh" });
    assert.equal(calls.icon.at(-1).text, "!");
    assert.equal(calls.icon.at(-1).color, theme.longBreak, "repainted from the stored timer");
  } finally {
    Date.now = realNow;
  }
});

test("a finished pomodoro marks in the focus accent when breaks are manual", async () => {
  // The other half of the rule, and the only way to see it: with autoStartBreaks
  // on, a break never waits, so this "!" is unreachable on default settings.
  const { listeners, calls, storage } = await freshWorker();
  storage.settings = { autoStartBreaks: false };
  const theme = THEMES.nebula;

  const realNow = Date.now;
  try {
    await sendMessage(listeners, { type: "START" });
    const deadline = storage.timer.endsAt;
    Date.now = () => deadline + 1_000;
    await listeners.alarm({ name: "block-end" });

    assert.equal(calls.icon.at(-1).text, "!");
    assert.equal(storage.timer.mode, "shortBreak", "the break is what waits");
    assert.equal(storage.timer.endedMode, "pomodoro");
    assert.equal(
      calls.icon.at(-1).color, theme.pomodoro,
      "the pomodoro that ended, not the break that waits",
    );
  } finally {
    Date.now = realNow;
  }
});

test("a timer stored without endedMode still paints", async () => {
  // Whatever is in chrome.storage when this version first wakes was written by
  // the previous one, which had no endedMode: the "!" must fall back to the
  // timer's own mode rather than painting undefined.
  const { listeners, calls, storage } = await freshWorker();
  storage.timer = {
    mode: "shortBreak", blockId: null, plannedSeconds: 300, startedAt: null,
    endsAt: null, remainingMs: 300_000, isRunning: false, awaitingStart: true,
  };

  await listeners.alarm({ name: "badge-refresh" });
  assert.equal(calls.icon.at(-1).text, "!");
  assert.equal(calls.icon.at(-1).color, THEMES.nebula.shortBreak, "falls back to its own mode");
});

test("two alarms racing on the same expired block do not double-log it", async () => {
  // The block-end alarm and the badge-refresh alarm can both notice the same
  // expired deadline. Without the lock and the dedupe, this is where history
  // would silently gain phantom blocks and the cycle would skip ahead.
  const { listeners, storage } = await freshWorker();
  await sendMessage(listeners, { type: "START" });

  const deadline = storage.timer.endsAt;
  const realNow = Date.now;
  Date.now = () => deadline + 1_000;
  try {
    await Promise.all([
      listeners.alarm({ name: "block-end" }),
      listeners.alarm({ name: "badge-refresh" }),
      listeners.alarm({ name: "block-end" }),
    ]);
    assert.equal(storage.sessions.length, 1, "still exactly one session");
    assert.equal(storage.cycle.totalPomodoros, 1, "cycle advanced exactly once");
  } finally {
    Date.now = realNow;
  }
});

test("pausing clears the deadline so time cannot bleed away", async () => {
  const { listeners, storage, calls } = await freshWorker();
  await sendMessage(listeners, { type: "START" });
  const state = await sendMessage(listeners, { type: "PAUSE" });

  assert.equal(storage.timer.endsAt, null);
  assert.equal(storage.timer.isRunning, false);
  assert.ok(storage.timer.remainingMs > 0);
  assert.equal(calls.badge.at(-1), "", "no badge while paused");
  assert.equal(calls.icon.at(-1).text, null, "and the static mark comes back");
  assert.match(calls.titles.at(-1), /paused/);
  assert.equal(state.timer.isRunning, false);
});

test("skipping a partially-run block logs it as incomplete", async () => {
  const { listeners, storage } = await freshWorker();
  await sendMessage(listeners, { type: "START" });

  const realNow = Date.now;
  Date.now = () => realNow() + 300_000; // 5 minutes in
  try {
    await sendMessage(listeners, { type: "SKIP" });
    assert.equal(storage.sessions.length, 1);
    assert.equal(storage.sessions[0].completed, 0, "partial block");
    assert.ok(storage.sessions[0].actual_seconds >= 299);
    assert.equal(storage.timer.mode, "shortBreak");
  } finally {
    Date.now = realNow;
  }
});

test("skipping a never-started block logs nothing but still advances", async () => {
  const { listeners, storage } = await freshWorker();
  await sendMessage(listeners, { type: "SKIP" });
  assert.equal(storage.sessions, undefined, "nothing worth logging");
  assert.equal(storage.timer.mode, "shortBreak");
});

test("resetting discards the block without logging it", async () => {
  const { listeners, storage } = await freshWorker();
  await sendMessage(listeners, { type: "START" });
  await sendMessage(listeners, { type: "RESET" });

  assert.equal(storage.sessions, undefined);
  assert.equal(storage.timer.isRunning, false);
  assert.equal(storage.timer.blockId, null);
  assert.equal(storage.timer.remainingMs, 1_500_000);
});

test("switching mode mid-block discards it, matching v1", async () => {
  const { listeners, storage } = await freshWorker();
  await sendMessage(listeners, { type: "START" });
  await sendMessage(listeners, { type: "SWITCH_MODE", mode: "longBreak" });

  assert.equal(storage.sessions, undefined, "a manual switch is not a logged block");
  assert.equal(storage.timer.mode, "longBreak");
  assert.equal(storage.timer.remainingMs, 900_000);
});

test("changing durations does not yank a running block", async () => {
  const { listeners, storage } = await freshWorker();
  await sendMessage(listeners, { type: "START" });
  const endsAt = storage.timer.endsAt;

  await chrome.storage.local.set({ settings: { pomodoroDuration: 50 } });
  await sendMessage(listeners, { type: "SETTINGS_CHANGED" });

  assert.equal(storage.timer.endsAt, endsAt, "the running block keeps its deadline");
});

test("changing durations while idle resizes the current block", async () => {
  const { listeners, storage } = await freshWorker();
  await chrome.storage.local.set({ settings: { pomodoroDuration: 50 } });
  await sendMessage(listeners, { type: "SETTINGS_CHANGED" });

  assert.equal(storage.timer.remainingMs, 3_000_000);
  assert.equal(storage.timer.isRunning, false);
});

// Storing the new duration is only half the job: the toolbar is a separate
// surface that Chrome keeps painted until something repaints it. A block that
// ran leaves its minutes drawn as the icon, and going idle has to take them
// back down — otherwise the toolbar sits there advertising the OLD duration
// while the popup shows the new one, with no event left to correct it.
test("a duration change while idle takes the old minutes off the toolbar", async () => {
  const { listeners, storage, calls } = await freshWorker();

  await sendMessage(listeners, { type: "START" });
  assert.equal(calls.icon.at(-1).text, "25", "the running block draws its minutes");

  await sendMessage(listeners, { type: "RESET" });
  await chrome.storage.local.set({ settings: { pomodoroDuration: 30 } });
  await sendMessage(listeners, { type: "SETTINGS_CHANGED" });

  assert.equal(storage.timer.remainingMs, 1_800_000, "the block is resized");
  assert.equal(calls.icon.at(-1).text, null, "and the static mark is back");
  assert.ok(calls.icon.at(-1).path, "painted from the packaged icon, not a bitmap");
  assert.equal(calls.badge.at(-1), "", "with no stale number in the badge either");
});

test("GET_STATE settles a block that expired while everything was closed", async () => {
  // Quitting Chrome mid-block and reopening: the popup asks for state, and the
  // expired block must be resolved on that read rather than resurrected.
  const { listeners, storage } = await freshWorker();
  await sendMessage(listeners, { type: "START" });

  const deadline = storage.timer.endsAt;
  const realNow = Date.now;
  Date.now = () => deadline + 3_600_000; // an hour later
  try {
    const state = await sendMessage(listeners, { type: "GET_STATE" });
    assert.equal(storage.sessions.length, 1);
    assert.equal(state.timer.mode, "shortBreak");
    // Logged at its real deadline, not an hour late.
    assert.equal(storage.sessions[0].actual_seconds, 1500);
  } finally {
    Date.now = realNow;
  }
});

test("the goal is clamped to a sane range", async () => {
  const { listeners, storage } = await freshWorker();
  for (let i = 0; i < 30; i++) await sendMessage(listeners, { type: "ADJUST_GOAL", delta: 1 });
  assert.equal(storage.cycle.sessionGoal, 20);

  for (let i = 0; i < 40; i++) await sendMessage(listeners, { type: "ADJUST_GOAL", delta: -1 });
  assert.equal(storage.cycle.sessionGoal, 1);
});

// ===== THE DAY BOUNDARY =====
//
// The counters are a today figure. Nothing wakes the browser at midnight, so
// the rollover has to happen on the next read — which is what these cover.

test("a count left over from yesterday is zeroed the next time state is read", async () => {
  const { listeners, storage } = await freshWorker();
  storage.cycle = {
    pomodorosInCycle: 2, totalPomodoros: 20, sessionGoal: 4,
    dayStamp: dayStamp(Date.now() - 2 * 86_400_000),
  };

  const state = await sendMessage(listeners, { type: "GET_STATE" });
  assert.equal(state.cycle.totalPomodoros, 0);
  assert.equal(state.cycle.pomodorosInCycle, 0);
  assert.equal(state.cycle.sessionGoal, 4, "the goal is not a tally");
  assert.equal(storage.cycle.dayStamp, dayStamp(Date.now()), "persisted, not just rendered");
});

test("a block completing after midnight counts toward the new day, not the old one", async () => {
  const { listeners, storage } = await freshWorker();
  storage.cycle = {
    pomodorosInCycle: 3, totalPomodoros: 20, sessionGoal: 4,
    dayStamp: dayStamp(Date.now() - 86_400_000),
  };

  await sendMessage(listeners, { type: "START" });
  const realNow = Date.now;
  Date.now = () => storage.timer.endsAt;
  try {
    await listeners.alarm({ name: "block-end" });
  } finally {
    Date.now = realNow;
  }

  assert.equal(storage.cycle.totalPomodoros, 1, "yesterday's 20 did not carry over");
  // Had the stale pomodorosInCycle: 3 survived, this block would have been the
  // fourth and dropped straight into a long break.
  assert.equal(storage.timer.mode, "shortBreak");
});

test("the daily reset can be turned off, and then the count accumulates", async () => {
  const { listeners, storage } = await freshWorker();
  storage.settings = { resetDaily: false };
  storage.cycle = {
    pomodorosInCycle: 1, totalPomodoros: 20, sessionGoal: 4,
    dayStamp: dayStamp(Date.now() - 86_400_000),
  };

  const state = await sendMessage(listeners, { type: "GET_STATE" });
  assert.equal(state.cycle.totalPomodoros, 20);
  assert.equal(storage.cycle.dayStamp, dayStamp(Date.now()), "still re-stamped");
});

test("RESET_COUNT zeroes the count and leaves history alone", async () => {
  const { listeners, storage } = await freshWorker();
  storage.sessions = [{ id: "s1", mode: "pomodoro", completed: 1 }];
  storage.cycle = {
    pomodorosInCycle: 2, totalPomodoros: 6, sessionGoal: 8, dayStamp: dayStamp(Date.now()),
  };

  const state = await sendMessage(listeners, { type: "RESET_COUNT" });
  assert.equal(state.cycle.totalPomodoros, 0);
  assert.equal(state.cycle.pomodorosInCycle, 0);
  assert.equal(state.cycle.sessionGoal, 8);
  assert.equal(storage.sessions.length, 1, "the dashboard's record is not a counter");
});

test("a full cycle of four pomodoros lands on a long break", async () => {
  const { listeners, storage } = await freshWorker();
  const realNow = Date.now;
  let clock = T0;
  Date.now = () => clock;

  try {
    for (let i = 0; i < 4; i++) {
      await sendMessage(listeners, { type: "SWITCH_MODE", mode: "pomodoro" });
      await sendMessage(listeners, { type: "START" });
      clock = storage.timer.endsAt;
      await listeners.alarm({ name: "block-end" });
    }
    assert.equal(storage.timer.mode, "longBreak");
    assert.equal(storage.cycle.totalPomodoros, 4);
    assert.equal(storage.cycle.pomodorosInCycle, 0);
    assert.equal(storage.sessions.length, 4, "one row per pomodoro");
  } finally {
    Date.now = realNow;
  }
});

test("sound failure never blocks block completion", async () => {
  const { listeners, storage } = await freshWorker();
  // Offscreen documents are the most failure-prone piece; a broken one must
  // degrade to notifications, not strand the timer mid-block.
  chrome.offscreen.createDocument = async () => { throw new Error("offscreen unavailable"); };

  await sendMessage(listeners, { type: "START" });
  const deadline = storage.timer.endsAt;
  const realNow = Date.now;
  Date.now = () => deadline + 1000;
  try {
    await listeners.alarm({ name: "block-end" });
    assert.equal(storage.sessions.length, 1, "block still completed");
    assert.equal(storage.timer.mode, "shortBreak", "cycle still advanced");
  } finally {
    Date.now = realNow;
  }
});
