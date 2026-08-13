import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketDaily, barGeometry, heatmapCells, computeStats,
  denseDays, currentStreak, weekdayInitial, weekBars, ringGeometry, formatDuration,
} from "../src/core/charts.js";

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

// ===== the stats sheet's helpers =====
//
// Shared with the full page's dashboard, which is the point: a day boundary or a
// rounding rule that differed between the two surfaces would be a bug either way.

test("denseDays fills gaps with zero and ends on today", () => {
  const now = Date.parse("2026-08-09T12:00:00Z");
  const daily = [
    { date: "2026-08-05", focus_seconds: 900, blocks: 1 },
    { date: "2026-08-09", focus_seconds: 3000, blocks: 2 },
  ];
  const days = denseDays(daily, 7, { tzOffsetMinutes: 0, nowMs: now });

  assert.deepEqual(days.map(d => d.date), [
    "2026-08-03", "2026-08-04", "2026-08-05",
    "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09",
  ]);
  assert.equal(days.at(-1).focus_seconds, 3000, "today is the last entry");
  assert.equal(days[2].blocks, 1, "the sparse day landed in its own slot");
  assert.equal(days[3].focus_seconds, 0, "a day with no sessions is zero, not absent");
  // heatmapCells reads focusSeconds, everything else focus_seconds.
  assert.equal(days.at(-1).focusSeconds, 3000, "both spellings are emitted");
});

test("denseDays crosses a month boundary without inventing a day", () => {
  const days = denseDays([], 3, {
    tzOffsetMinutes: 0, nowMs: Date.parse("2026-09-01T12:00:00Z"),
  });
  assert.deepEqual(days.map(d => d.date), ["2026-08-30", "2026-08-31", "2026-09-01"]);
});

test("denseDays uses the local day as today, matching the buckets", () => {
  // 01:00Z on the 9th is still the 8th at UTC-5, so that is the last bar.
  const now = Date.parse("2026-08-09T01:00:00Z");
  assert.equal(denseDays([], 2, { tzOffsetMinutes: -300, nowMs: now }).at(-1).date,
               "2026-08-08");
  assert.equal(denseDays([], 2, { tzOffsetMinutes: 0, nowMs: now }).at(-1).date,
               "2026-08-09");
});

test("currentStreak counts consecutive days back from today", () => {
  const daily = [
    { date: "2026-08-06", blocks: 1 },
    { date: "2026-08-07", blocks: 3 },
    { date: "2026-08-08", blocks: 2 },
    { date: "2026-08-09", blocks: 1 },
  ];
  assert.equal(currentStreak(daily, "2026-08-09"), 4);
});

// The rule that makes the number usable: an untouched today is a day still in
// progress, not a broken streak.
test("currentStreak survives an empty today but not an empty yesterday", () => {
  const daily = [
    { date: "2026-08-07", blocks: 2 },
    { date: "2026-08-08", blocks: 1 },
  ];
  assert.equal(currentStreak(daily, "2026-08-09"), 2, "counted back from yesterday");
  assert.equal(currentStreak(daily, "2026-08-10"), 0, "two days idle ends it");
});

test("currentStreak ignores break-only days", () => {
  const daily = [
    { date: "2026-08-08", blocks: 0, focus_seconds: 0 },
    { date: "2026-08-09", blocks: 1 },
  ];
  assert.equal(currentStreak(daily, "2026-08-09"), 1, "the 8th holds no pomodoro");
});

test("currentStreak on an empty history is zero", () => {
  assert.equal(currentStreak([], "2026-08-09"), 0);
});

test("weekdayInitial reads the key as a calendar date, not a UTC instant", () => {
  // 2026-08-09 is a Sunday, 2026-08-10 a Monday.
  assert.equal(weekdayInitial("2026-08-09"), "S");
  assert.equal(weekdayInitial("2026-08-10"), "M");
  assert.equal(weekdayInitial("2026-08-14"), "F");
});

test("weekBars scales to the tallest day and floors the rest above zero", () => {
  const { percents, meanPercent } = weekBars([0, 60, 3000], { minVisible: 4 });
  assert.equal(percents[0], 0, "an empty day stays exactly empty");
  assert.equal(percents[1], 4, "2% of the max would be invisible, so it is floored");
  assert.equal(percents[2], 100, "the tallest day fills the track");
  assert.equal(Math.round(meanPercent), 34, "mean of 1020s against a 3000s max");
});

test("weekBars on an all-zero week draws nothing and does not divide by zero", () => {
  const { percents, mean, meanPercent } = weekBars([0, 0, 0], { minVisible: 4 });
  assert.deepEqual(percents, [0, 0, 0]);
  assert.equal(mean, 0);
  assert.equal(meanPercent, 0, "guarded max, so no NaN reaches the style attribute");
});

test("ringGeometry fills a fraction of the circumference and clamps overshoot", () => {
  const full = 2 * Math.PI * 42;
  assert.equal(ringGeometry(0, 4, 42).filled, 0);
  assert.ok(Math.abs(ringGeometry(2, 4, 42).filled - full / 2) < 1e-9, "half a turn");
  assert.equal(ringGeometry(9, 4, 42).filled, full, "beating the goal does not wrap");
  assert.equal(ringGeometry(3, 0, 42).filled, 0, "a zero goal is empty, not NaN");
});

test("formatDuration rounds to minutes before splitting the hour", () => {
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(2700), "45m");
  assert.equal(formatDuration(4500), "1h 15m");
  // Rounding the remainder separately gives "60m" / "1h 60m" here.
  assert.equal(formatDuration(3599), "1h 0m");
  assert.equal(formatDuration(7199), "2h 0m");
  assert.equal(formatDuration(undefined), "0m", "an absent total is not NaN");
});
