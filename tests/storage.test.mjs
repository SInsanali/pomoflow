// store/storage.js against a small in-memory fake of chrome.storage.local.
// The properties that matter are dedupe-by-id (which replaces SQLite's
// INSERT OR IGNORE) and settings round-tripping.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store/storage.js";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";

// chrome.storage's promise API, minus the parts we don't use. Values are
// round-tripped through JSON so the fake enforces the same serializability
// constraint the real thing does.
function fakeArea(initial = {}) {
  let data = structuredClone(initial);
  return {
    async get(key) {
      return data[key] === undefined ? {} : { [key]: structuredClone(data[key]) };
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) data[k] = JSON.parse(JSON.stringify(v));
    },
    _dump: () => data,
  };
}

const session = (id, over = {}) => ({
  id,
  mode: "pomodoro",
  started_at: "2026-08-01T10:00:00.000Z",
  ended_at: "2026-08-01T10:25:00.000Z",
  planned_seconds: 1500,
  actual_seconds: 1500,
  completed: 1,
  ...over,
});

test("sessions are deduped by id", async () => {
  const db = createStore(fakeArea());

  assert.equal((await db.logSession(session("a"))).data.inserted, true);
  assert.equal((await db.logSession(session("a"))).data.inserted, false, "same id ignored");
  assert.equal((await db.logSession(session("b"))).data.inserted, true);

  const { data } = await db.getSessions();
  assert.equal(data.sessions.length, 2);
});

test("a session without an id is rejected rather than stored", async () => {
  const db = createStore(fakeArea());
  const res = await db.logSession({ mode: "pomodoro" });
  assert.equal(res.ok, false);
  assert.equal((await db.getSessions()).data.sessions.length, 0);
});

test("getSessions returns newest first and honours the date range", async () => {
  const db = createStore(fakeArea());
  await db.logSession(session("old", { started_at: "2026-07-01T10:00:00.000Z" }));
  await db.logSession(session("mid", { started_at: "2026-08-01T10:00:00.000Z" }));
  await db.logSession(session("new", { started_at: "2026-09-01T10:00:00.000Z" }));

  const all = await db.getSessions();
  assert.deepEqual(all.data.sessions.map(s => s.id), ["new", "mid", "old"]);

  const ranged = await db.getSessions("2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
  assert.deepEqual(ranged.data.sessions.map(s => s.id), ["mid"], "`to` is exclusive");
});

test("settings round-trip and fill in defaults", async () => {
  const db = createStore(fakeArea());

  const before = await db.getSettings();
  assert.equal(before.data.pomodoroDuration, 25, "defaults when nothing is stored");

  await db.putSettings({ ...DEFAULT_SETTINGS, pomodoroDuration: 50, theme: "ocean" });
  const after = await db.getSettings();
  assert.equal(after.data.pomodoroDuration, 50);
  assert.equal(after.data.theme, "ocean");
  assert.equal(after.data.shortBreakDuration, 5, "untouched fields keep their defaults");
});

test("a stored theme that no longer exists falls back to mono", async () => {
  const db = createStore(fakeArea());
  await db.putSettings({ ...DEFAULT_SETTINGS, theme: "custom-deleted" });
  const { data } = await db.getSettings();
  assert.equal(data.theme, "mono");
});

test("recentThemes is topped back up to four valid entries", async () => {
  const db = createStore(fakeArea());
  await db.putSettings({ ...DEFAULT_SETTINGS, recentThemes: ["ocean", "nope"] });
  const { data } = await db.getSettings();
  assert.equal(data.recentThemes.length, 4);
  assert.ok(data.recentThemes.includes("ocean"));
  assert.ok(!data.recentThemes.includes("nope"), "invalid ids are dropped");
});

test("presets create, list newest-first, and delete", async () => {
  const db = createStore(fakeArea());
  await db.createPreset("Deep work", { pomodoroDuration: 50 });
  await new Promise(r => setTimeout(r, 2)); // distinct created_at
  await db.createPreset("Sprint", { pomodoroDuration: 15 });

  const listed = await db.listPresets();
  assert.deepEqual(listed.data.presets.map(p => p.name), ["Sprint", "Deep work"]);

  await db.deletePreset(listed.data.presets[0].id);
  assert.deepEqual((await db.listPresets()).data.presets.map(p => p.name), ["Deep work"]);
});

test("export then import into a fresh store restores the history", async () => {
  // The uninstall/reinstall path. Export is the only backup a user has, so a
  // round-trip losing anything would be silent data loss.
  const source = createStore(fakeArea());
  await source.logSession(session("a"));
  await source.logSession(session("b", { mode: "shortBreak" }));
  await source.putSettings({ ...DEFAULT_SETTINGS, theme: "nebula", pomodoroDuration: 30 });
  await source.createPreset("Deep work", { pomodoroDuration: 50 });

  const payload = JSON.parse(JSON.stringify(await source.exportAll()));

  const target = createStore(fakeArea());
  const res = await target.importAll(payload);
  assert.equal(res.ok, true);
  assert.equal(res.data.sessionsImported, 2);

  assert.equal((await target.getSettings()).data.theme, "nebula");
  assert.equal((await target.getSettings()).data.pomodoroDuration, 30);
  assert.equal((await target.getSessions()).data.sessions.length, 2);
  assert.equal((await target.listPresets()).data.presets.length, 1);
});

test("importing the same backup twice adds nothing the second time", async () => {
  const db = createStore(fakeArea());
  await db.logSession(session("a"));
  const payload = JSON.parse(JSON.stringify(await db.exportAll()));

  const first = await db.importAll(payload);
  const second = await db.importAll(payload);

  assert.equal(first.data.sessionsImported, 0, "already present");
  assert.equal(second.data.sessionsImported, 0);
  assert.equal((await db.getSessions()).data.sessions.length, 1);
  assert.equal((await db.listPresets()).data.presets.length, 0);
});

test("import merges into existing history instead of replacing it", async () => {
  const db = createStore(fakeArea());
  await db.logSession(session("local"));

  const res = await db.importAll({ version: "2.0", sessions: [session("imported")] });
  assert.equal(res.data.sessionsImported, 1);
  assert.deepEqual(
    (await db.getSessions()).data.sessions.map(s => s.id).sort(),
    ["imported", "local"],
  );
});
