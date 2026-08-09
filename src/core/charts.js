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
