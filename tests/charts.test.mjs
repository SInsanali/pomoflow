import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketDaily, barGeometry, heatmapCells } from "../web/js/charts.js";

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
