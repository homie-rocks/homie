/** Per-connection state delivery. Pure data, shared by the relay and the view.
 * Deltas name a keyframe, never an unacknowledged previous delta. Losing a delta
 * therefore loses no baseline. A new keyframe bounds recovery to one second.
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
    if (e[9] !== undefined && e[10] === 0) own.set(e[9], e);
    const p = e[3], key = `${Math.floor(p[0]/size)},${Math.floor(p[1]/size)},${Math.floor((p[2]??0)/size)}`;
    const list = cells.get(key) ?? []; list.push(e); cells.set(key, list);
  }
  const index = { own, cells, size, order }; byRadius.set(radius,index); return index;
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
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)
        for(const e of index.cells.get(`${x+dx},${y+dy},${z+dz}`)??[]) {
          const p=e[3];
          if(e===own||(p[0]-q[0])**2+(p[1]-q[1])**2+((p[2]??0)-(q[2]??0))**2<=radiusM**2)visible.push(e);
        }
      // Snapshot order is part of the view contract, even though cells are not.
      visible.sort((a,b)=>index.order.get(a)-index.order.get(b));
    }
  }
  let control = snap.c && controls.get(snap.c);
  if (!control) { control = new Map((snap.c ?? []).map(row => [row[0], row])); if (snap.c) controls.set(snap.c, control); }
  return { ...snap, d: [round, visible, ...snap.d.slice(2)], c: control.has(seat) ? [control.get(seat)] : [] };
}
const encodedRows = new WeakMap();
const rowText = row => {
  let text=encodedRows.get(row);
  if(!text){text=row.map(v=>JSON.stringify(v));encodedRows.set(row,text);}
  return text;
};

export function snapshotEncoder(keyframeTicks, chained = false) {
  let base = null;
  let rows = new Map(), keyTick = -Infinity;
  return {
    reset() { base = null; rows.clear(); keyTick = -Infinity; },
    encode(snap) {
      if (!base || snap.e !== base.e || snap.k <= base.k || snap.k - keyTick >= keyframeTicks) {
        base = snap; keyTick = snap.k;
        rows = new Map(snap.d[1].map(e => [e[0], rowText(e)]));
        return snap;
      }
      const present = new Set(), changed = [];
      for (const entity of snap.d[1]) {
        const id = entity[0]; present.add(id);
        const before = rows.get(id);
        if (!before) { changed.push(entity); continue; }
        let mask = 0; const values = [];
        for (let i = 1; i < entity.length; i++) if (rowText(entity)[i] !== before[i]) { mask |= 1 << i; values.push(entity[i]); }
        if (mask) changed.push([id, mask, values]);
      }
      const out = { ...snap, d: { base: base.k, round: snap.d[0], changed, removed: [...rows.keys()].filter(id => !present.has(id)), ...(chained ? { chain: true } : {}) } };
      if (chained) { base = snap; rows = new Map(snap.d[1].map(e => [e[0], rowText(e)])); }
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
    const own = selected.d[1].find(e => e[9] === seat && e[10] === 0);
    const next = new Map();
    const entities = selected.d[1].map(entity => {
      let row = entity;
      if (entity !== own) {
        const distance = own ? Math.hypot(...entity[3].map((n, i) => n - (own[3][i] ?? 0))) : 0;
        const old = previous.get(entity[0]);
        const interval = farHz && nearM !== null && distance > nearM ? Math.max(1, Math.round(tickHz / farHz)) : 1;
        if (old && snap.k % interval !== 0) row = old;
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
