function isValid(s) {
  return s && typeof s.startTime === "number" && typeof s.plannedSeconds === "number"
    && typeof s.mode === "string" && typeof s.id === "string";
}

export function reconcile(snapshot, nowMs, getDurationSeconds) {
  if (!isValid(snapshot)) return { action: "fresh" };
  const elapsed = Math.floor((nowMs - snapshot.startTime) / 1000);
  if (elapsed >= snapshot.plannedSeconds) {
    const endMs = snapshot.startTime + snapshot.plannedSeconds * 1000;
    return {
      action: "complete",
      completedBlock: {
        id: snapshot.id,
        mode: snapshot.mode,
        started_at: new Date(snapshot.startTime).toISOString(),
        ended_at: new Date(endMs).toISOString(),
        planned_seconds: snapshot.plannedSeconds,
        actual_seconds: snapshot.plannedSeconds,
        completed: 1,
      },
    };
  }
  return { action: "resume", remainingSeconds: snapshot.plannedSeconds - elapsed };
}
