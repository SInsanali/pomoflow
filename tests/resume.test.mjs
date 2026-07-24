// tests/resume.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile } from "../web/js/resume.js";

const dur = () => 1500; // 25 min

test("resumes a still-running block with correct remaining", () => {
  const snap = { id: "a", mode: "pomodoro", startTime: 1000, plannedSeconds: 1500, isRunning: true };
  const r = reconcile(snap, 1000 + 600 * 1000, dur); // 600s elapsed
  assert.equal(r.action, "resume");
  assert.equal(r.remainingSeconds, 900);
});

test("completes a block that finished while away", () => {
  const snap = { id: "a", mode: "pomodoro", startTime: 1000, plannedSeconds: 1500, isRunning: true };
  const r = reconcile(snap, 1000 + 2000 * 1000, dur); // 2000s elapsed > 1500
  assert.equal(r.action, "complete");
  assert.equal(r.completedBlock.id, "a");
  assert.equal(r.completedBlock.actual_seconds, 1500);
  assert.equal(r.completedBlock.completed, 1);
});

test("returns fresh on missing/corrupt snapshot", () => {
  assert.equal(reconcile(null, 5, dur).action, "fresh");
  assert.equal(reconcile({ bogus: true }, 5, dur).action, "fresh");
});
