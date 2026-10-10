/** Per-connection state delivery. Pure data, shared by the relay and the view.
 * Deltas may name a periodic keyframe or the previous ordered frame. A missing
 * chained predecessor is ignored until the next keyframe. Periodic encoders
 * repair the chain; ordered transports reset it on connection or epoch change.
 * No history grows with time: one keyframe per connection, no per-frame queue.
 */
const spatial = new WeakMap(), controls = new WeakMap();
function indexFor(snap, radius) {
  let byRadius = spatial.get(snap.d[1]);
  if (!byRadius) { byRadius = new Map(); spatial.set(snap.d[1], byRadius); }
  if (byRadius.has(radius)) return byRadius.get(radius);
  const own = new Map(), cells = new Map(), order = new Map();
  const size = radius > 0 ? radius : 1;
  for (const [i, e] of snap.d[1].entries()) {
    order.set(e, i);
    if (e[9] !== undefined && e[10] !== 1) own.set(e[9], e);
    const p = e[3], key = `${Math.floor(p[0]/size)},${Math.floor(p[1]/size)},${Math.floor((p[2]??0)/size)}`;
    const list = cells.get(key) ?? []; list.push(e); cells.set(key, list);
  }
  const index = { own, cells, size, order, candidates: new Map() }; byRadius.set(radius,index); return index;
}
export function interestSnapshot(snap, seat, radiusM) {
  const [round, entities] = snap.d;
  let visible = entities;
  if (seat !== null) {
    const index = indexFor(snap, radiusM), own = index.own.get(seat);
    visible = [];
    if (own && radiusM === null) visible = entities;
    else if (own) {
      const q=own[3], x=Math.floor(q[0]/index.size), y=Math.floor(q[1]/index.size), z=Math.floor((q[2]??0)/index.size);
      const cell = `${x},${y},${z}`;
      let candidates = index.candidates.get(cell);
      if (!candidates) {
        candidates = [];
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)
          candidates.push(...(index.cells.get(`${x+dx},${y+dy},${z+dz}`)??[]));
        // Every player in this cell shares the ordered candidates. The final
        // radius check remains exact for that player's position.
        candidates.sort((a,b)=>index.order.get(a)-index.order.get(b));
        index.candidates.set(cell, candidates);
      }
      for (const e of candidates) {
        const p=e[3];
        if(e===own||(p[0]-q[0])**2+(p[1]-q[1])**2+((p[2]??0)-(q[2]??0))**2<=radiusM**2)visible.push(e);
      }
    }
  }
  let control = snap.c && controls.get(snap.c);
  if (!control) { control = new Map((snap.c ?? []).map(row => [row[0], row])); if (snap.c) controls.set(snap.c, control); }
  return { ...snap, d: [round, visible, ...snap.d.slice(2)], c: control.has(seat) ? [control.get(seat)] : [] };
}
// Snapshot tuples contain primitives and small numeric arrays. Compare these
// values without allocating a JSON string for every field on every tick.
// Keep JSON equality for uncommon object-valued fields, including key order.
function sameValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
    return true;
  }
  if (a === null || b === null || typeof a !== 'object' && typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// Entity rows are immutable snapshot values. Gates share their comparisons and
// wire fragments across players whose visual baselines contain the same row.
const changesByBase = new WeakMap(), wireRows = new WeakMap();
function changedRow(entity, before) {
  let changes = changesByBase.get(before);
  if (!changes) { changes = new WeakMap(); changesByBase.set(before, changes); }
  if (changes.has(entity)) return changes.get(entity);
  let mask = 0; const values = [];
  for (let i = 1; i < entity.length; i++) if (!sameValue(entity[i], before[i])) { mask |= 1 << i; values.push(entity[i]); }
  const row = mask ? [entity[0], mask, values] : null;
  changes.set(entity, row); return row;
}
function wireRow(row) {
  let text = wireRows.get(row);
  if (text === undefined) { text = JSON.stringify(row); wireRows.set(row, text); }
  return text;
}
/** JSON wire equivalent of a snapshot, sharing immutable entity fragments. */
export function snapshotText(snap) {
  const { d, ...header } = snap;
  let data;
  if (Array.isArray(d)) data = '[' + JSON.stringify(d[0]) + ',[' + d[1].map(wireRow).join(',') + ']' + d.slice(2).map(v => ',' + JSON.stringify(v)).join('') + ']';
  else {
    const { changed, own, ...meta } = d;
    data = JSON.stringify(meta).slice(0, -1) + ',"changed":[' + changed.map(wireRow).join(',') + ']' + (own ? ',"own":[' + own.map(wireRow).join(',') + ']' : '') + '}';
  }
  return JSON.stringify(header).slice(0, -1) + ',"d":' + data + '}';
}

export function snapshotEncoder(keyframeTicks, chained = false) {
  let base = null;
  let rows = new Map(), keyTick = -Infinity;
  return {
    reset() { base = null; rows.clear(); keyTick = -Infinity; },
    encode(snap, seat = null) {
      if (!base || snap.e !== base.e || snap.k <= base.k || snap.k - keyTick >= keyframeTicks) {
        base = snap; keyTick = snap.k;
        rows = new Map(snap.d[1].map(e => [e[0], e]));
        return snap;
      }
      const present = new Set(), changed = [];
      const own = chained && seat !== null ? snap.d[1].filter(e => e[9] === seat && e[10] !== 1) : null;
      for (const entity of snap.d[1]) {
        const id = entity[0]; present.add(id);
        const before = rows.get(id);
        if (chained) rows.set(id, entity);
        if (own?.includes(entity)) continue;
        if (!before) { changed.push(entity); continue; }
        const change = changedRow(entity, before);
        if (change) changed.push(change);
      }
      const out = { ...snap, d: { base: base.k, round: snap.d[0], ...(snap.d.length > 2 ? { collision: snap.d[2] } : {}), changed, removed: [...rows.keys()].filter(id => !present.has(id)), ...(chained ? { chain: true } : {}), ...(own ? { own } : {}) } };
      if (chained) { base = snap; for (const id of out.d.removed) rows.delete(id); }
      return out;
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
      if (!base || !d || snap.e !== base.e || snap.k <= base.k) return null;
      if (d.own !== undefined && (!Array.isArray(d.own) || !d.own.every(e => Array.isArray(e) && e.length >= 9 && typeof e[0] === 'string'))) return null;
      if (!Array.isArray(d.round) || !Array.isArray(d.removed) || !Array.isArray(d.changed)) return null;
      if (d.base !== base.k) {
        // A skipped remote delta must not stall local prediction or collider edits.
        // Keep the remote baseline unchanged until a keyframe repairs the chain.
        if (!d.chain || !d.own?.length || !Array.isArray(d.round)) return null;
        const visible = new Map(rows);
        for (const id of d.removed) visible.delete(id);
        for (const e of d.own) visible.set(e[0], e);
        return { ...snap, d: [d.round, [...visible.values()], ...(d.collision === undefined ? [] : [d.collision])] };
      }
      // Validate first, then mutate only the private chained baseline. Returned
      // snapshots keep their own entity array and immutable row values.
      const updates = [];
      for (const change of d.changed) {
        if (!Array.isArray(change) || typeof change[0] !== 'string') return null;
        if (change.length !== 3) {
          if (change.length < 9) return null;
          updates.push([change[0], change]); continue;
        }
        if (!Number.isInteger(change[1]) || change[1] < 0 || !Array.isArray(change[2])) return null;
        const old = rows.get(change[0]);
        if (!old) return null;
        const entity = old.slice(); let j = 0;
        for (let i = 1; i < entity.length; i++) if (change[1] & (1 << i)) entity[i] = change[2][j++];
        if (j !== change[2].length) return null;
        updates.push([entity[0], entity]);
      }
      const next = d.chain ? rows : new Map(rows);
      for (const id of d.removed) next.delete(id);
      for (const [id, entity] of updates) next.set(id, entity);
      for (const e of d.own ?? []) next.set(e[0], e);
      const decoded = { ...snap, d: [d.round, [...next.values()], ...(d.collision === undefined ? [] : [d.collision])] };
      if (d.chain) { base = decoded; rows = next; }
      return decoded;
    },
  };
}

/** Studio-chosen visual precision and rates. The controlled body stays exact.
 * Exits are immediate even between far updates; new arrivals never wait.
 */
const quantizedRows = new WeakMap();
export function scheduledView({ radiusM = null, precisionM = 0, nearM = null, farHz = null } = {}, tickHz = 20) {
  let previous = new Map(), epoch = null;
  return (snap, seat) => {
    if (snap.e !== epoch) { previous.clear(); epoch = snap.e; }
    const selected = interestSnapshot(snap, seat, radiusM);
    const own = selected.d[1].find(e => e[9] === seat && e[10] !== 1);
    const next = new Map();
    const entities = selected.d[1].map(entity => {
      let row = entity;
      if (entity !== own) {
        const p = entity[3], q = own?.[3];
        const distanceSquared = q ? (p[0]-q[0])**2 + (p[1]-q[1])**2 + ((p[2]??0)-(q[2]??0))**2 : 0;
        const old = previous.get(entity[0]);
        const interval = farHz && nearM !== null && distanceSquared > nearM**2 ? Math.max(1, Math.round(tickHz / farHz)) : 1;
        // Spread far-view refreshes across players instead of sending the
        // whole room's largest deltas on the same tick. Each player retains
        // the declared rate; newly visible bodies still arrive immediately.
        if (old && snap.k % interval !== (seat ?? 0) % interval) row = old;
        else if (precisionM > 0) {
          let versions = quantizedRows.get(entity);
          if (!versions) { versions = new Map(); quantizedRows.set(entity, versions); }
          row = versions.get(precisionM);
          if (!row) {
            row = entity.slice();
            for (const i of [3, 4]) row[i] = entity[i].map(n => Number((Math.round(n / precisionM) * precisionM).toPrecision(12)));
            versions.set(precisionM, row);
          }
        }
      }
      next.set(entity[0], row); return row;
    });
    previous = next;
    return { ...selected, d: [selected.d[0], entities, ...selected.d.slice(2)] };
  };
}
