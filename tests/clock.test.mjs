// core/clock.js is the module the whole rewrite rests on: every surface derives
// its display from these functions, so these tests stand in for a lot of
// manual clicking. Replaces the old tests/resume.test.mjs — reconcile() moved
// here when it was promoted from crash-recovery to the primary mechanism.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  remaining, remainingSeconds, formatTime, badgeText,
  reconcile, idleTimer, startTimer, pauseTimer, resetTimer, awaitingTimer,
  advanceCycle, shouldAutoStart, blockInProgress, elapsedSeconds, sessionLabel,
  dayStamp, rolloverCycle, resetCycle,
} from "../src/core/clock.js";
import { DEFAULT_SETTINGS, DEFAULT_CYCLE } from "../src/core/defaults.js";

const settings = { ...DEFAULT_SETTINGS };
const T0 = 1_760_000_000_000; // fixed epoch so nothing depends on the real clock

test("a running block counts down from its stored deadline", () => {
  const t = startTimer(idleTimer("pomodoro", settings), T0, "id-1");
  assert.equal(remainingSeconds(t, T0), 1500);
  assert.equal(remainingSeconds(t, T0 + 600_000), 900);
  assert.equal(formatTime(remainingSeconds(t, T0 + 600_000)), "15:00");
});

test("remaining never goes negative once the deadline has passed", () => {
  const t = startTimer(idleTimer("pomodoro", settings), T0, "id-1");
  assert.equal(remaining(t, T0 + 9_999_999), 0);
});

test("a paused block does not bleed wall-clock time", () => {
  // The single most important guarantee: v1's restoreFromSnapshot deliberately
  // restored a paused block exactly as left, and dropping `endsAt` on pause is
  // what makes that true by construction here.
  const running = startTimer(idleTimer("pomodoro", settings), T0, "id-1");
  const paused = pauseTimer(running, T0 + 300_000); // 5 min in

  assert.equal(paused.endsAt, null);
  assert.equal(remainingSeconds(paused, T0 + 300_000), 1200);
  assert.equal(remainingSeconds(paused, T0 + 300_000 + 120_000), 1200, "2 min later: unchanged");
});

test("resuming after a pause preserves the remaining time", () => {
  const running = startTimer(idleTimer("pomodoro", settings), T0, "id-1");
  const paused = pauseTimer(running, T0 + 300_000);
  const resumed = startTimer(paused, T0 + 900_000, "id-2"); // resumed 10 min later

  assert.equal(remainingSeconds(resumed, T0 + 900_000), 1200);
  assert.equal(resumed.blockId, "id-1", "keeps the original block id");
});

test("startTimer anchors startedAt so a resumed block reports honest elapsed time", () => {
  const running = startTimer(idleTimer("pomodoro", settings), T0, "id-1");
  const paused = pauseTimer(running, T0 + 300_000);
  const resumed = startTimer(paused, T0 + 900_000, "id-2");
  // 5 minutes of the block have actually been worked, so the effective anchor
  // sits 5 minutes before the resume instant — not at the original start.
  assert.equal(resumed.startedAt, T0 + 900_000 - 300_000);
});

test("reconcile resumes, completes, or idles", () => {
  const running = startTimer(idleTimer("pomodoro", settings), T0, "id-1");

  assert.equal(reconcile(running, T0 + 600_000).action, "running");
  assert.equal(reconcile(running, T0 + 600_000).remainingMs, 900_000);

  const done = reconcile(running, T0 + 1_500_000);
  assert.equal(done.action, "complete");

  assert.equal(reconcile(pauseTimer(running, T0), T0).action, "idle");
  assert.equal(reconcile(idleTimer("pomodoro", settings), T0).action, "idle");
});

test("reconcile across a block boundary logs the block at its real end, not now", () => {
  // The laptop-slept-for-an-hour case. The session must record the deadline as
  // its end time, otherwise a block that finished while Chrome was closed gets
  // logged as absurdly long.
  const running = startTimer(idleTimer("pomodoro", settings), T0, "id-1");
  const { completedBlock } = reconcile(running, T0 + 3_600_000); // an hour later

  assert.equal(completedBlock.id, "id-1");
  assert.equal(completedBlock.mode, "pomodoro");
  assert.equal(completedBlock.completed, 1);
  assert.equal(completedBlock.actual_seconds, 1500);
  assert.equal(completedBlock.ended_at, new Date(T0 + 1_500_000).toISOString());
});

test("advanceCycle runs a full four-pomodoro set into a long break", () => {
  let cycle = { ...DEFAULT_CYCLE };
  const modes = [];

  for (let i = 0; i < 4; i++) {
    const afterPomodoro = advanceCycle("pomodoro", cycle);
    modes.push(afterPomodoro.nextMode);
    cycle = afterPomodoro.cycle;

    const afterBreak = advanceCycle(afterPomodoro.nextMode, cycle);
    modes.push(afterBreak.nextMode);
    cycle = afterBreak.cycle;
  }

  assert.deepEqual(modes, [
    "shortBreak", "pomodoro",
    "shortBreak", "pomodoro",
    "shortBreak", "pomodoro",
    "longBreak", "pomodoro",
  ]);
  assert.equal(cycle.totalPomodoros, 4);
  assert.equal(cycle.pomodorosInCycle, 0, "in-cycle count resets after the long break");
});

test("only pomodoros advance the cycle counters", () => {
  const cycle = { ...DEFAULT_CYCLE, pomodorosInCycle: 2, totalPomodoros: 7 };
  const { nextMode, cycle: next } = advanceCycle("shortBreak", cycle);
  assert.equal(nextMode, "pomodoro");
  assert.equal(next.pomodorosInCycle, 2);
  assert.equal(next.totalPomodoros, 7);
});

// ===== THE DAY BOUNDARY =====

test("the day stamp is the local calendar day, not UTC's", () => {
  // 00:30 local on whatever day T0 lands on: the stamp must agree with the
  // Date object the user's clock shows, which toISOString() would not west of
  // Greenwich.
  const local = new Date(T0);
  local.setHours(0, 30, 0, 0);
  const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}` +
    `-${String(local.getDate()).padStart(2, "0")}`;
  assert.equal(dayStamp(local.getTime()), expected);
});

test("a cycle from an earlier day is zeroed on the next read", () => {
  const stale = { ...DEFAULT_CYCLE, pomodorosInCycle: 2, totalPomodoros: 20, sessionGoal: 8,
    dayStamp: dayStamp(T0 - 3 * 86_400_000) };
  const rolled = rolloverCycle(stale, T0);
  assert.equal(rolled.totalPomodoros, 0);
  assert.equal(rolled.pomodorosInCycle, 0);
  assert.equal(rolled.sessionGoal, 8, "the goal is a target, not a tally");
  assert.equal(rolled.dayStamp, dayStamp(T0));
});

test("a cycle already stamped today is returned untouched", () => {
  const today = { ...DEFAULT_CYCLE, totalPomodoros: 3, dayStamp: dayStamp(T0) };
  // Identity, not equality: the caller skips the storage write on this path.
  assert.equal(rolloverCycle(today, T0 + 3_600_000), today);
});

test("a cycle with no stamp counts as stale", () => {
  // Written before the daily reset existed: its count accrued over an unknown
  // number of days, which is exactly the state this fixes.
  const legacy = { ...DEFAULT_CYCLE, totalPomodoros: 20 };
  assert.equal(rolloverCycle(legacy, T0).totalPomodoros, 0);
});

test("with the daily reset off the count survives, but the stamp still moves", () => {
  const stale = { ...DEFAULT_CYCLE, totalPomodoros: 20, dayStamp: dayStamp(T0 - 86_400_000) };
  const rolled = rolloverCycle(stale, T0, false);
  assert.equal(rolled.totalPomodoros, 20);
  // Re-stamping is what stops switching the setting back on from wiping a day
  // that is already underway.
  assert.equal(rolled.dayStamp, dayStamp(T0));
});

test("the manual reset zeroes the count and stamps today", () => {
  const cycle = { ...DEFAULT_CYCLE, pomodorosInCycle: 3, totalPomodoros: 9, sessionGoal: 6 };
  const reset = resetCycle(cycle, T0);
  assert.equal(reset.totalPomodoros, 0);
  assert.equal(reset.pomodorosInCycle, 0);
  assert.equal(reset.sessionGoal, 6);
  // Stamped, so the automatic rollover does not immediately fire again.
  assert.equal(rolloverCycle(reset, T0), reset);
});

test("breaks auto-start, focus blocks wait for you", () => {
  assert.equal(shouldAutoStart("shortBreak", settings), true);
  assert.equal(shouldAutoStart("longBreak", settings), true);
  assert.equal(shouldAutoStart("pomodoro", settings), false);
});

test("the toolbar counts whole minutes down, rounding up", () => {
  const t = startTimer(idleTimer("pomodoro", settings), T0, "id-1");
  assert.equal(badgeText(t, T0), "25");
  // Rounding UP is what keeps the first minute reading 25 and the last one
  // reading 1, so no "<1" is ever needed.
  assert.equal(badgeText(t, T0 + 1_000), "25", "one second in, still 25");
  assert.equal(badgeText(t, T0 + 60_000), "24");
  assert.equal(badgeText(t, T0 + 1_470_000), "1", "30s left reads 1, not <1");
  assert.equal(badgeText(t, T0 + 1_499_000), "1", "the final second still reads 1");
  assert.equal(badgeText(t, T0 + 1_500_000), "", "finished");
  assert.equal(badgeText(pauseTimer(t, T0), T0), "", "paused shows the static mark");
});

test("a block waiting on the user shows an attention mark", () => {
  const idle = idleTimer("pomodoro", settings);
  assert.equal(badgeText(idle, T0), "", "merely idle is not waiting");

  const waiting = awaitingTimer(idle);
  assert.equal(badgeText(waiting, T0), "!");

  // Acting on it is what clears the mark — otherwise the "!" would survive
  // into the block it was asking the user to start.
  assert.equal(badgeText(startTimer(waiting, T0, "id-2"), T0), "25");
});

test("a waiting block remembers which block ended to put it there", () => {
  // The toolbar colours the "!" by this, and it is not derivable from the
  // waiting timer: a waiting pomodoro can follow either kind of break.
  const idle = idleTimer("pomodoro", settings);
  assert.equal(idle.endedMode, null, "nothing has ended yet");
  assert.equal(awaitingTimer(idle, "longBreak").endedMode, "longBreak");
  assert.equal(awaitingTimer(idle, "shortBreak").endedMode, "shortBreak");
  // Called without one — no caller does today — it must not carry a stale mode.
  assert.equal(awaitingTimer(idle).endedMode, null);
  // The waiting block's own mode is untouched by any of it.
  assert.equal(awaitingTimer(idle, "longBreak").mode, "pomodoro");
});

test("blockInProgress ignores a fresh timer but catches a partial one", () => {
  const fresh = idleTimer("pomodoro", settings);
  assert.equal(blockInProgress(fresh, T0), false);

  const running = startTimer(fresh, T0, "id-1");
  assert.equal(blockInProgress(running, T0 + 1000), true);

  const paused = pauseTimer(running, T0 + 300_000);
  assert.equal(blockInProgress(paused, T0 + 300_000), true);
  assert.equal(elapsedSeconds(paused, T0 + 300_000), 300);
});

test("reset returns a full, unstarted block in the same mode", () => {
  const running = startTimer(idleTimer("shortBreak", settings), T0, "id-1");
  const reset = resetTimer(running, settings);
  assert.equal(reset.mode, "shortBreak");
  assert.equal(reset.isRunning, false);
  assert.equal(reset.blockId, null);
  assert.equal(remainingSeconds(reset, T0 + 999_999), 300);
});

test("durations follow the settings, not the defaults", () => {
  const custom = { ...DEFAULT_SETTINGS, pomodoroDuration: 50, longBreakDuration: 20 };
  assert.equal(remainingSeconds(idleTimer("pomodoro", custom), T0), 3000);
  assert.equal(remainingSeconds(idleTimer("longBreak", custom), T0), 1200);
});

test("session labels match v1", () => {
  assert.equal(sessionLabel("pomodoro", { pomodorosInCycle: 0 }), "Study 1");
  assert.equal(sessionLabel("shortBreak", { pomodorosInCycle: 2 }), "Break 2");
  assert.equal(sessionLabel("longBreak", { pomodorosInCycle: 0 }), "Long Break");
});
