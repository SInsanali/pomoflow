// Pure chart-geometry + bucketing helpers. No DOM, no clock access — every
// input is passed in, so these are unit-testable under node:test.

function localDate(iso, tzOffsetMinutes) {
  const d = new Date(iso);
  const shifted = new Date(d.getTime() + tzOffsetMinutes * 60000);
  return shifted.toISOString().slice(0, 10);
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
