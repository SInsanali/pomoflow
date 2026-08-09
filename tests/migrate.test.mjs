// store/migrate.js — the one-way door. If this drops or mangles rows, a user's
// entire v1 focus history is lost with no way back, so the v1-server shape here
// is copied exactly from a real `sqlite3 -json` dump of pomoflow.db.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeImport, detectFormat } from "../src/store/migrate.js";

const v1ServerDump = {
  pomoflow_export_version: 1,
  source: "v1.0-server (SQLite pomoflow.db)",
  exported_at: "2026-08-09T17:24:04.897452+00:00",
  sessions: [
    {
      id: "26c8a8b3-393a-4d4f-8087-75a1c83be0ec",
      mode: "pomodoro",
      started_at: "2026-07-28T01:40:54.159Z",
      ended_at: "2026-07-28T01:59:28.165Z",
      planned_seconds: 1800,
      actual_seconds: 1114,
      completed: 0,
    },
  ],
  presets: [],
  settings: { pomodoroDuration: 30, theme: "dusk" },
};

test("detects each export format", () => {
  assert.equal(detectFormat(v1ServerDump), "v1-server");
  assert.equal(detectFormat({ version: "2.0", sessions: [] }), "v2");
  assert.equal(detectFormat({ version: "1.1", settings: {}, goal: 4 }), "v1-settings");
  assert.equal(detectFormat({ nothing: true }), "unknown");
  assert.equal(detectFormat(null), "unknown");
});

test("a v1 server dump normalizes without losing anything", () => {
  const res = normalizeImport(v1ServerDump);
  assert.equal(res.ok, true);
  assert.equal(res.format, "v1-server");

  const [s] = res.data.sessions;
  assert.equal(s.id, "26c8a8b3-393a-4d4f-8087-75a1c83be0ec");
  assert.equal(s.actual_seconds, 1114);
  assert.equal(s.planned_seconds, 1800);
  assert.equal(s.completed, 0, "a partial block stays partial");
  assert.equal(res.data.settings.theme, "dusk");
});

test("a v1 settings-only export carries themes and goal, and has no sessions", () => {
  const res = normalizeImport({
    version: "1.1",
    settings: { theme: "custom-1" },
    customThemes: {
      "custom-1": { name: "Mine", pomodoro: "#ff0000", shortBreak: "#00ff00", longBreak: "#0000ff" },
    },
    goal: 6,
  });
  assert.equal(res.ok, true);
  assert.equal(res.data.goal, 6);
  assert.equal(res.data.sessions.length, 0);
  assert.equal(res.data.customThemes["custom-1"].name, "Mine");
});

test("malformed custom themes are dropped, not imported broken", () => {
  const res = normalizeImport({
    version: "2.0",
    customThemes: {
      good: { pomodoro: "#111111", shortBreak: "#222222", longBreak: "#333333" },
      bad: { pomodoro: "red", shortBreak: "#222222", longBreak: "#333333" },
    },
  });
  assert.deepEqual(Object.keys(res.data.customThemes), ["good"]);
});

test("session rows missing required fields are skipped", () => {
  const res = normalizeImport({
    version: "2.0",
    sessions: [
      { id: "ok", mode: "pomodoro", started_at: "2026-08-01T10:00:00Z", actual_seconds: 1500 },
      { mode: "pomodoro", started_at: "2026-08-01T10:00:00Z", actual_seconds: 1500 }, // no id
      { id: "bad-date", mode: "pomodoro", started_at: "not a date", actual_seconds: 10 },
      { id: "no-secs", mode: "pomodoro", started_at: "2026-08-01T10:00:00Z" },
    ],
  });
  assert.deepEqual(res.data.sessions.map(s => s.id), ["ok"]);
});

test("an unrecognised file is refused with a message, not silently accepted", () => {
  const res = normalizeImport({ hello: "world" });
  assert.equal(res.ok, false);
  assert.match(res.error, /Pomoflow export/);
});
