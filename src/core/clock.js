// Pure timer arithmetic. No chrome.*, no DOM, no implicit clock access — every
// function takes `now` explicitly, so the whole module is unit-testable.
//
// THE ONE RULE: nothing counts down. Every surface derives its display from a
// stored absolute deadline (`endsAt`), so a missed tick, a suspended service
// worker, a closed popup, or a laptop that slept for an hour all resolve
// correctly on the next read.

import { POMODOROS_PER_CYCLE, durationSeconds } from './defaults.js';

// Milliseconds left on a block, clamped at zero.
//
// `endsAt` is authoritative while running; `remainingMs` while paused. That
// split is what keeps a paused block from bleeding wall-clock time — v1's
// restoreFromSnapshot() deliberately restored a paused block exactly as left,
// and the same promise holds here across service-worker restarts.
export function remaining(timer, nowMs) {
    if (!timer) return 0;
    if (timer.isRunning && typeof timer.endsAt === 'number') {
        return Math.max(0, timer.endsAt - nowMs);
    }
    return Math.max(0, timer.remainingMs || 0);
}

// Whole seconds for display. Rounds up so a block reads its full duration the
// instant it starts and only shows 00:00 once genuinely elapsed.
export function remainingSeconds(timer, nowMs) {
    return Math.ceil(remaining(timer, nowMs) / 1000);
}

export function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// What the toolbar shows when a finished block is waiting on a decision.
export const ATTENTION = '!';

// Toolbar text. Minutes only — a deliberate consequence of the 30s
// chrome.alarms floor, not a shortcut: the service worker cannot be kept alive
// for a per-second countdown. Empty string means "show the static mark".
//
// Minutes are rounded UP, so a block reads its full duration the instant it
// starts and the final minute reads "1". Rounding down would show "24" for
// almost all of a 25-minute block's first minute, and needed a "<1" for the
// last one — a stray sign in an icon that is otherwise pure digits.
export function badgeText(timer, nowMs) {
    if (!timer) return '';
    // A block that ENDED and left the next one needing a decision, and only
    // that: a manual reset or mode switch is idle, not waiting.
    if (!timer.isRunning) return timer.awaitingStart ? ATTENTION : '';
    const seconds = remainingSeconds(timer, nowMs);
    if (seconds <= 0) return '';
    return String(Math.ceil(seconds / 60));
}

// Build the session row for a finished block. Shape matches v1's sessions
// table (db.py) exactly, so exported history stays interchangeable.
export function sessionRecord(timer, { completed, actualSeconds, endedAtMs }) {
    return {
        id: timer.blockId,
        mode: timer.mode,
        started_at: new Date(timer.startedAt).toISOString(),
        ended_at: new Date(endedAtMs).toISOString(),
        planned_seconds: timer.plannedSeconds,
        actual_seconds: Math.max(0, Math.round(actualSeconds)),
        completed: completed ? 1 : 0,
    };
}

// Decide what a stored timer means *right now*. This is v1's resume.reconcile()
// promoted from a crash-recovery path to the primary mechanism — the service
// worker calls it on every wake, and every UI surface calls it on open.
//
//   'idle'     — nothing running; render remainingMs as-is
//   'running'  — still counting; `remainingMs` left
//   'complete' — the deadline passed while nobody was watching; the caller
//                must log `completedBlock` and advance the cycle
export function reconcile(timer, nowMs) {
    if (!timer || !timer.isRunning || typeof timer.endsAt !== 'number') {
        return { action: 'idle', remainingMs: remaining(timer, nowMs) };
    }
    if (nowMs >= timer.endsAt) {
        return {
            action: 'complete',
            completedBlock: sessionRecord(timer, {
                completed: true,
                actualSeconds: timer.plannedSeconds,
                endedAtMs: timer.endsAt,
            }),
        };
    }
    return { action: 'running', remainingMs: timer.endsAt - nowMs };
}

// How much of the current block has actually been worked, in seconds. Used
// when logging a partial (skipped) block.
export function elapsedSeconds(timer, nowMs) {
    return Math.max(0, timer.plannedSeconds - remainingSeconds(timer, nowMs));
}

// A block is worth logging if it is running, or paused partway through. A skip
// from a fresh, never-started timer has nothing to log — same guard as v1's
// skipTimer().
export function blockInProgress(timer, nowMs) {
    return Boolean(timer && timer.blockId) &&
        (timer.isRunning || elapsedSeconds(timer, nowMs) > 0);
}

// ===== TRANSITIONS =====
// Each returns a fresh timer object; none mutate their input.

export function idleTimer(mode, settings) {
    const planned = durationSeconds(mode, settings);
    return {
        mode,
        blockId: null,
        plannedSeconds: planned,
        startedAt: null,
        endsAt: null,
        remainingMs: planned * 1000,
        isRunning: false,
        awaitingStart: false,
    };
}

// Flag an idle block as waiting on the user — the toolbar turns into "!" and
// stays there until they act. Set only by block completion; see badgeText.
export function awaitingTimer(timer) {
    return { ...timer, awaitingStart: true };
}

// Start (or resume) a block.
//
// `startedAt` is an *effective* anchor, recomputed on every start: the instant
// this block would have begun had it run uninterrupted to reach the current
// remaining time. It is deliberately NOT the original wall-clock start.
//
// Two reasons, both inherited from v1 (saveSnapshot/logCurrentBlock recomputed
// the same effectiveStart every time they ran):
//   1. A block paused overnight would otherwise be bucketed on the day it was
//      started rather than the day it was actually worked.
//   2. It keeps the logged row self-consistent — started_at and ended_at stay
//      exactly plannedSeconds apart, instead of spanning the pause.
export function startTimer(timer, nowMs, newBlockId) {
    const remainingMs = remaining(timer, nowMs);
    if (remainingMs <= 0) return timer;
    const elapsedMs = timer.plannedSeconds * 1000 - remainingMs;
    return {
        ...timer,
        blockId: timer.blockId || newBlockId,
        startedAt: nowMs - elapsedMs,
        endsAt: nowMs + remainingMs,
        remainingMs,
        isRunning: true,
        awaitingStart: false,   // acting on it is what clears the "!"
    };
}

// Freeze the block. Dropping `endsAt` is what makes "paused blocks do not
// advance by wall clock" true by construction rather than by convention.
export function pauseTimer(timer, nowMs) {
    if (!timer.isRunning) return timer;
    return {
        ...timer,
        remainingMs: remaining(timer, nowMs),
        endsAt: null,
        isRunning: false,
    };
}

// Back to a full, unstarted block in the same mode. Drops the block id: the
// discarded attempt is not logged, matching v1's resetTimer().
export function resetTimer(timer, settings) {
    return idleTimer(timer.mode, settings);
}

// ===== THE DAY BOUNDARY =====
//
// The cycle counters are a *today* figure, not a lifetime one: "20/4" reading
// 20 because the count has been climbing since Tuesday tells you nothing about
// the day you are actually in. Session history is untouched by any of this —
// the dashboard is where the long view lives.

// Local calendar day, not UTC: the boundary that matters is the user's
// midnight. Deliberately not toISOString().slice(0, 10), which would roll the
// count over mid-evening for anyone west of Greenwich.
export function dayStamp(nowMs) {
    const d = new Date(nowMs);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Zero the counters if the stored stamp is not today's.
//
// Returns the SAME object when nothing changes, so callers can skip the write
// (and the storage.onChanged refresh that a write would fan out to every open
// surface) on the overwhelmingly common no-op path.
//
// A cycle with no stamp at all — one written before this existed — counts as
// stale and is reset. That is the honest reading: its count accrued over an
// unknown number of days, which is exactly the state this fixes.
export function rolloverCycle(cycle, nowMs, enabled = true) {
    const stamp = dayStamp(nowMs);
    if (cycle.dayStamp === stamp) return cycle;
    // With the daily reset off we still re-stamp, so that turning it back on
    // starts counting from that day rather than wiping a day already underway.
    if (!enabled) return { ...cycle, dayStamp: stamp };
    return { ...cycle, pomodorosInCycle: 0, totalPomodoros: 0, dayStamp: stamp };
}

// The manual reset behind the button next to the count. Same zeroing as the
// rollover, and it stamps today so the automatic one does not immediately
// re-fire. `sessionGoal` survives: it is a target, not a tally.
export function resetCycle(cycle, nowMs) {
    return { ...cycle, pomodorosInCycle: 0, totalPomodoros: 0, dayStamp: dayStamp(nowMs) };
}

// Advance the cycle after a pomodoro or break finishes.
//
// Preserves v1 exactly: a completed *pomodoro* bumps both counters, and a long
// break lands after POMODOROS_PER_CYCLE of them (resetting the in-cycle count).
// `sessionGoal` is display-only and deliberately does not affect this.
export function advanceCycle(mode, cycle) {
    if (mode !== 'pomodoro') {
        return { nextMode: 'pomodoro', cycle: { ...cycle } };
    }
    const pomodorosInCycle = cycle.pomodorosInCycle + 1;
    const totalPomodoros = cycle.totalPomodoros + 1;
    if (pomodorosInCycle >= POMODOROS_PER_CYCLE) {
        return {
            nextMode: 'longBreak',
            cycle: { ...cycle, pomodorosInCycle: 0, totalPomodoros },
        };
    }
    return {
        nextMode: 'shortBreak',
        cycle: { ...cycle, pomodorosInCycle, totalPomodoros },
    };
}

// v1's cycle model, unchanged: breaks start themselves, the next focus block
// waits for you (autoStartBreaks: true, autoStartPomodoros: false).
export function shouldAutoStart(nextMode, settings) {
    return nextMode === 'pomodoro'
        ? Boolean(settings.autoStartPomodoros)
        : Boolean(settings.autoStartBreaks);
}

// The "Study 2" / "Break 1" / "Long Break" counter text from v1.
export function sessionLabel(mode, cycle) {
    switch (mode) {
        case 'pomodoro': return `Study ${cycle.pomodorosInCycle + 1}`;
        case 'shortBreak': return `Break ${cycle.pomodorosInCycle}`;
        case 'longBreak': return 'Long Break';
        default: return '';
    }
}
