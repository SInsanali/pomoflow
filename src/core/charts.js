// Pure chart-geometry + bucketing helpers. No DOM, no clock access — every
// input is passed in, so these are unit-testable under node:test.

export function localDate(iso, tzOffsetMinutes) {
  const d = new Date(iso);
  const shifted = new Date(d.getTime() + tzOffsetMinutes * 60000);
  return shifted.toISOString().slice(0, 10);
}

// Shift a YYYY-MM-DD key by whole days, staying in date-string space so no
// timezone re-interpretation can creep in.
function addDays(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Sum pomodoro focus time and block count per local day, ascending by date.
// Only mode === "pomodoro" contributes focus/blocks (breaks are ignored),
// matching the server-side rollup in db.get_stats.
export function bucketDaily(sessions, tzOffsetMinutes) {
  const map = new Map();
  for (const s of sessions) {
    const date = localDate(s.started_at, tzOffsetMinutes);
    const b = map.get(date) || { date, focusSeconds: 0, blocks: 0 };
    if (s.mode === "pomodoro") {
      b.focusSeconds += s.actual_seconds;
      b.blocks += 1;
    }
    map.set(date, b);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// The daily rollup + headline totals the dashboard renders. This replaces the
// server's db.get_stats — same output shape (snake_case `focus_seconds`, so
// dashboard.js is unchanged), same rule that only mode === "pomodoro" counts
// toward focus time and block counts. Removing the server costs nothing here
// because the rollup was always a pure fold over the session rows.
export function computeStats(sessions, tzOffsetMinutes, nowMs = Date.now()) {
  const daily = bucketDaily(sessions, tzOffsetMinutes).map(b => ({
    date: b.date,
    focus_seconds: b.focusSeconds,
    blocks: b.blocks,
  }));
  const today = localDate(new Date(nowMs).toISOString(), tzOffsetMinutes);
  const weekStart = addDays(today, -6);
  return {
    daily,
    totals: {
      today_seconds: daily.find(d => d.date === today)?.focus_seconds ?? 0,
      week_seconds: daily
        .filter(d => d.date >= weekStart)
        .reduce((sum, d) => sum + d.focus_seconds, 0),
      all_time_blocks: daily.reduce((sum, d) => sum + d.blocks, 0),
    },
  };
}

// stats.daily is sparse — only days that actually have sessions. Densify it into
// a contiguous run of the last `n` calendar days ending today, filling the gaps
// with zero, so a bar strip or a heatmap reads as a real timeline instead of a
// packed list of active days.
//
// The walk back is done in date-string space (addDays), not by subtracting from
// a Date: a DST boundary inside the window would otherwise shift a day, and the
// keys have to line up with bucketDaily's exactly or a day's work goes missing.
// Both spellings of the focus total are emitted because the two chart helpers
// disagree — heatmapCells reads `focusSeconds`, everything else `focus_seconds`.
export function denseDays(daily, n, { tzOffsetMinutes = 0, nowMs = Date.now() } = {}) {
  const byDate = new Map(daily.map(d => [d.date, d]));
  const today = localDate(new Date(nowMs).toISOString(), tzOffsetMinutes);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const rec = byDate.get(date);
    out.push({
      date,
      focus_seconds: rec ? rec.focus_seconds : 0,
      focusSeconds: rec ? rec.focus_seconds : 0,
      blocks: rec ? rec.blocks : 0,
    });
  }
  return out;
}

// Consecutive days with at least one pomodoro, counted back from today.
//
// An empty *today* does not break the streak: at 9am you have not lost anything
// yet, so the count starts from yesterday in that case. Any other gap ends it.
export function currentStreak(daily, todayStr) {
  const active = new Set(daily.filter(d => (d.blocks || 0) > 0).map(d => d.date));
  let cursor = active.has(todayStr) ? todayStr : addDays(todayStr, -1);
  let streak = 0;
  while (active.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// The single letter under a bar. Read as UTC on purpose: the key is already a
// local calendar date, so re-interpreting it in the local zone would shift it a
// day west of UTC and label Monday's bar "S".
export function weekdayInitial(dateStr) {
  return WEEKDAY_INITIALS[new Date(dateStr + 'T00:00:00Z').getUTCDay()];
}

// "1h 15m" / "45m", shared by both stats surfaces so they never disagree about
// what a duration looks like. Rounds to whole minutes *first* and then splits:
// rounding the hour remainder separately turns 59m59s into "60m" and 1h59m59s
// into "1h 60m".
export function formatDuration(seconds) {
  const totalMinutes = Math.round(Math.max(0, seconds || 0) / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// The bar strip in the popup's stats sheet, as percentages rather than pixels:
// the strip is laid out by CSS (flex columns, each bar a % of the track height)
// so it can follow the popup's width without a viewBox, and percentages are the
// only geometry that layout needs from here.
//
// `minVisible` floors every non-zero day, because a five-minute day against a
// three-hour one rounds to a bar too short to see — and "I did nothing" and "I
// did a little" must not look the same. Zero stays exactly zero.
export function weekBars(values, { minVisible = 0 } = {}) {
  const max = Math.max(1, ...values);
  const mean = values.length
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : 0;
  return {
    max,
    mean,
    percents: values.map(v => (v <= 0 ? 0 : Math.max(minVisible, (v / max) * 100))),
    meanPercent: (mean / max) * 100,
  };
}

// A progress ring's stroke dashes. Drawn as `stroke-dasharray="filled gap"` with
// the gap set to the whole circumference, so one dash paints the arc and the
// rest of the circle stays empty with no dashoffset arithmetic.
//
// Clamped to one full turn: overshooting a goal must not wrap the arc back over
// itself, which reads as *less* progress. The caller still shows the true count.
export function ringGeometry(value, goal, radius) {
  const circumference = 2 * Math.PI * radius;
  const fraction = goal > 0 ? Math.min(1, Math.max(0, value / goal)) : 0;
  return { circumference, filled: circumference * fraction, fraction };
}

// Bar rects for a simple column chart. The tallest value maps to full height;
// a guard of max>=1 keeps an all-zero series from dividing by zero.
export function barGeometry(values, { width, height, gap }) {
  const max = Math.max(1, ...values);
  return values.map((v, i) => {
    const h = Math.round((v / max) * height);
    return { x: i * (width + gap), y: height - h, w: width, h };
  });
}

// GitHub-style activity grid. Cells are laid out column-major, 7 rows per
// column (one column per week). `weeks` is part of the documented interface
// (the caller uses it to size the SVG viewBox) even though the layout here is
// driven purely by index. Intensity `level` is 0 for empty days, else 1–4.
export function heatmapCells(daily, { weeks, cell, gap }) {
  const max = Math.max(1, ...daily.map(d => d.focusSeconds));
  const level = (s) => (s <= 0 ? 0 : Math.min(4, 1 + Math.floor((s / max) * 3.999)));
  return daily.map((d, i) => {
    const col = Math.floor(i / 7);
    const row = i % 7;
    return {
      x: col * (cell + gap),
      y: row * (cell + gap),
      date: d.date,
      focusSeconds: d.focusSeconds,
      level: level(d.focusSeconds),
    };
  });
}
