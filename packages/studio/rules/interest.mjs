/** Per-connection state delivery. Pure data, shared by the relay and the view.
 * Deltas name a keyframe, never an unacknowledged previous delta. Losing a delta
 * therefore loses no baseline. A new keyframe bounds recovery to one second.
 * No history grows with time: one keyframe per connection, no per-frame queue.
 */
export function interestSnapshot(snap, seat, radiusM) {
  const [round, entities] = snap.d;
  const own = seat === null ? null : entities.find(e => e[9] === seat && e[10] === 0);
  const visible = own && radiusM !== null ? entities.filter(e => {
    const p = e[3], q = own[3];
    return e === own || (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + ((p[2] ?? 0) - (q[2] ?? 0)) ** 2 <= radiusM ** 2;
  }) : seat === null ? entities : own ? entities : [];
  // Collision revisions are prediction inputs, independent of visual interest.
  // Deliver all geometry: authored sweeps/dashes need not fit inside the view radius.
  return { ...snap, d: [round, visible, ...snap.d.slice(2)], c: (snap.c ?? []).filter(row => row[0] === seat) };
}

export function snapshotEncoder(keyframeTicks) {
  let base = null;
  let rows = new Map();
  return {
    reset() { base = null; rows.clear(); },
    encode(snap) {
      if (!base || snap.e !== base.e || snap.k <= base.k || snap.k - base.k >= keyframeTicks) {
        base = snap;
        rows = new Map(snap.d[1].map(e => [e[0], e.map(v => JSON.stringify(v))]));
        return snap;
      }
      const present = new Set(), changed = [];
      for (const entity of snap.d[1]) {
        const id = entity[0]; present.add(id);
        const before = rows.get(id);
        if (!before) { changed.push(entity); continue; }
        let mask = 0; const values = [];
        for (let i = 1; i < entity.length; i++) if (JSON.stringify(entity[i]) !== before[i]) { mask |= 1 << i; values.push(entity[i]); }
        if (mask) changed.push([id, mask, values]);
      }
      return { ...snap, d: { base: base.k, round: snap.d[0], ...(snap.d.length > 2 ? { collision: snap.d[2] } : {}), changed, removed: [...rows.keys()].filter(id => !present.has(id)) } };
    },
  };
}

export function snapshotDecoder() {
  let base = null;
  let rows = new Map();
  return {
    reset() { base = null; rows.clear(); },
    decode(snap) {
      if (!snap || typeof snap !== 'object') return null;
      if (Array.isArray(snap.d)) {
        if (!Array.isArray(snap.d[0]) || !Array.isArray(snap.d[1]) ||
          !snap.d[1].every(e => Array.isArray(e) && e.length >= 9 && typeof e[0] === 'string')) return null;
        // A late duplicate keyframe must not replace the newer baseline.
        if (!base || snap.e !== base.e || snap.k >= base.k) {
          base = snap; rows = new Map(snap.d[1].map(e => [e[0], e]));
        }
        return snap;
      }
      const d = snap.d;
      if (!base || !d || d.base !== base.k || snap.e !== base.e || snap.k <= base.k) return null;
      if (!Array.isArray(d.round) || !Array.isArray(d.removed) || !Array.isArray(d.changed)) return null;
      const next = new Map(rows);
      for (const id of d.removed) next.delete(id);
      for (const change of d.changed) {
        if (!Array.isArray(change) || typeof change[0] !== 'string') return null;
        if (change.length !== 3) {
          if (change.length < 9) return null;
          next.set(change[0], change); continue;
        }
        if (!Number.isInteger(change[1]) || change[1] < 0 || !Array.isArray(change[2])) return null;
        const old = rows.get(change[0]);
        if (!old) return null;
        const entity = old.slice(); let j = 0;
        for (let i = 1; i < entity.length; i++) if (change[1] & (1 << i)) entity[i] = change[2][j++];
        if (j !== change[2].length) return null;
        next.set(entity[0], entity);
      }
      return { ...snap, d: [d.round, [...next.values()], ...(d.collision === undefined ? [] : [d.collision])] };
    },
  };
}
