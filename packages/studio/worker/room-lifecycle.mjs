/** Extracted from the studio runtime; behavior is unchanged. */

const ROOM_ALARM_MS = 10 * 60_000;

const ROOM_PAUSE_MS = 60_000;

function roomEndAt({ people, pausedAt, createdAt, restoredAt = null, savedAt = null, alarmAt = null }) {
  // Only people keep play alive. With no durable alarm, the last save bounds an unrecorded departure.
  const absence = pausedAt ?? (restoredAt !== null && alarmAt === null ? savedAt : null) ?? restoredAt ?? createdAt;
  return people > 0 ? Infinity : absence + ROOM_PAUSE_MS;
}

export {ROOM_ALARM_MS,ROOM_PAUSE_MS,roomEndAt};

