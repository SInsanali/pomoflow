import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketDaily, barGeometry, heatmapCells, computeStats } from "../src/core/charts.js";

test("bucketDaily sums pomodoro focus per local day", () => {
  const sessions = [
    { mode: "pomodoro", started_at: "2026-07-23T02:30:00Z", actual_seconds: 1500 },
    { mode: "pomodoro", started_at: "2026-07-23T03:00:00Z", actual_seconds: 1500 },
    { mode: "shortBreak", started_at: "2026-07-23T03:30:00Z", actual_seconds: 300 },
  ];
  const out = bucketDaily(sessions, 0); // UTC
  const day = Object.fromEntries(out.map(d => [d.date, d]));
  assert.equal(day["2026-07-23"].focusSeconds, 3000);
  assert.equal(day["2026-07-23"].blocks, 2);
});

test("barGeometry scales tallest bar to full height", () => {
  const g = barGeometry([0, 50, 100], { width: 30, height: 100, gap: 0 });
  assert.equal(g[2].h, 100);
  assert.equal(g[0].h, 0);
});

test("heatmapCells assigns level 0 for empty days", () => {
  const cells = heatmapCells([{ date: "2026-07-23", focusSeconds: 0, blocks: 0 }],
                             { weeks: 1, cell: 10, gap: 2 });
  assert.equal(cells[0].level, 0);
});

test("bucketDaily buckets in local time (negative tz shifts to previous day)", () => {
  // 02:30Z at UTC-3 (tz -180) is 2026-07-22 23:30 local.
  const out = bucketDaily(
    [{ mode: "pomodoro", started_at: "2026-07-23T02:30:00Z", actual_seconds: 1500 }],
    -180,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].date, "2026-07-22");
  assert.equal(out[0].focusSeconds, 1500);
});

test("heatmapCells lays out column-major, 7 rows per column, max day = level 4", () => {
  const daily = Array.from({ length: 8 }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, "0")}`,
    focusSeconds: i === 7 ? 3000 : 0,
    blocks: i === 7 ? 2 : 0,
  }));
  const cells = heatmapCells(daily, { weeks: 2, cell: 10, gap: 2 });
  // 8th cell (index 7) starts a new column: col 1, row 0.
  assert.equal(cells[7].x, 1 * (10 + 2));
  assert.equal(cells[7].y, 0);
  assert.equal(cells[7].level, 4); // the only non-zero day is the max
  assert.equal(cells[0].level, 0);
});

// computeStats replaces the server's db.get_stats. These assertions are written
// against that function's documented behaviour so the rollup stays identical
// now that it runs client-side.

test("computeStats matches db.get_stats' shape and totals", () => {
  const now = Date.parse("2026-08-09T12:00:00Z");
  const sessions = [
    { mode: "pomodoro", started_at: "2026-08-09T09:00:00Z", actual_seconds: 1500 },
    { mode: "pomodoro", started_at: "2026-08-09T10:00:00Z", actual_seconds: 1500 },
    { mode: "shortBreak", started_at: "2026-08-09T10:30:00Z", actual_seconds: 300 },
    { mode: "pomodoro", started_at: "2026-08-05T10:00:00Z", actual_seconds: 900 },
    { mode: "pomodoro", started_at: "2026-06-01T10:00:00Z", actual_seconds: 600 },
  ];
  const stats = computeStats(sessions, 0, now); // UTC

  assert.equal(stats.totals.today_seconds, 3000, "two focus blocks today");
  assert.equal(stats.totals.week_seconds, 3900, "today + the 5th, not June");
  assert.equal(stats.totals.all_time_blocks, 4, "breaks excluded");

  assert.deepEqual(
    stats.daily.map(d => d.date),
    ["2026-06-01", "2026-08-05", "2026-08-09"],
    "ascending by date",
  );
  assert.equal(stats.daily.at(-1).focus_seconds, 3000, "snake_case key, as the server used");
});

test("computeStats records break-only days with zero focus", () => {
  const now = Date.parse("2026-08-09T12:00:00Z");
  const stats = computeStats(
    [{ mode: "shortBreak", started_at: "2026-08-09T09:00:00Z", actual_seconds: 300 }],
    0,
    now,
  );
  assert.equal(stats.daily.length, 1);
  assert.equal(stats.daily[0].focus_seconds, 0);
  assert.equal(stats.totals.all_time_blocks, 0);
});

test("computeStats buckets by local day, not UTC day", () => {
  // 01:30 UTC on the 9th is still the evening of the 8th in UTC-5.
  const now = Date.parse("2026-08-09T12:00:00Z");
  const sessions = [
    { mode: "pomodoro", started_at: "2026-08-09T01:30:00Z", actual_seconds: 1500 },
  ];
  assert.equal(computeStats(sessions, 0, now).daily[0].date, "2026-08-09");
  assert.equal(computeStats(sessions, -300, now).daily[0].date, "2026-08-08");
});

test("computeStats on an empty history is all zeros, not NaN", () => {
  const stats = computeStats([], 0, Date.parse("2026-08-09T12:00:00Z"));
  assert.deepEqual(stats.daily, []);
  assert.deepEqual(stats.totals, { today_seconds: 0, week_seconds: 0, all_time_blocks: 0 });
});
