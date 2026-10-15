export const ROOM_ALARM_MS = 10 * 60_000;

export const ROOM_PAUSE_MS = 60_000;

export function roomEndAt({ people, pausedAt, createdAt, restoredAt = null, savedAt = null, alarmAt = null }) {
  // Only people keep play alive. With no durable alarm, the last save bounds an unrecorded departure.
  const absence = pausedAt ?? (restoredAt !== null && alarmAt === null ? savedAt : null) ?? restoredAt ?? createdAt;
  return people > 0 ? Infinity : absence + ROOM_PAUSE_MS;
}

