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
  let cached = changesByBase.get(before);
  if (cached?.entity === entity) return cached.row;
  let mask = 0; const values = [];
  for (let i = 1; i < entity.length; i++) if (!sameValue(entity[i], before[i])) { mask |= 1 << i; values.push(entity[i]); }
  const row = mask ? [entity[0], mask, values] : null;
  // A delivery frame visits all players before the next immutable frame.
  // Keep the most recent pair without allocating a WeakMap for every row.
  if (cached) { cached.entity = entity; cached.row = row; }
  else changesByBase.set(before, { entity, row });
  return row;
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

/** Whether a body that left `sent` at tick `sentTick` and kept its velocity is within `tolerance` of `entity` now. */
const POSITION = 1 << 3, VELOCITY = 1 << 4, HEADING = 1 << 5;
function coasts(entity, sent, ticks, hz, tolerance) {
  const p = entity[3], q = sent[3], v = sent[4], t = ticks / hz;
  for (let i = 0; i < p.length; i++) if (Math.abs(p[i] - (q[i] + v[i] * t)) > tolerance) return false;
  // A heading is a unit vector: the same tolerance, as a turn of that many metres at one metre's reach.
  const h = entity[5], g = sent[5];
  if (Array.isArray(h) && Array.isArray(g)) for (let i = 0; i < h.length; i++) if (Math.abs(h[i] - g[i]) > COAST_HEADING) return false;
  return true;
}
/** A heading a coasting body may be off by before it is sent again: a twentieth of a radian, under three degrees. */
const COAST_HEADING = 0.05;

/**
 * `coast` ({ hz, toleranceM }, chained encoders only): a body that is where its last SENT position and velocity
 * put it, within the tolerance, is not sent again; the decoder moves it there itself (`d.coast`). A body in a
 * crowd changes its position every tick and its course rarely, so most of a frame goes unsent. The tolerance is the
 * game's own `view.precisionM`; without one nothing coasts. A player's own body is always sent, exactly.
 */
export function snapshotEncoder(keyframeTicks, chained = false, coast = null) {
  let base = null;
  let rows = new Map(), keyTick = -Infinity, generation = 0;
  const coasting = chained && coast && coast.toleranceM > 0 && coast.hz > 0 ? coast : null;
  return {
    reset() { base = null; rows.clear(); keyTick = -Infinity; generation = 0; },
    encode(snap, seat = null) {
      if (!base || snap.e !== base.e || snap.k <= base.k || snap.k - keyTick >= keyframeTicks) {
        base = snap; keyTick = snap.k;
        rows = new Map(snap.d[1].map(e => [e[0], { entity: e, generation, k: snap.k }]));
        return coasting ? { ...snap, coast: coasting.hz } : snap;
      }
      const changed = [], removed = []; generation++;
      const own = chained && seat !== null ? snap.d[1].filter(e => e[9] === seat && e[10] !== 1) : null;
      for (const entity of snap.d[1]) {
        const id = entity[0], held = rows.get(id), before = held?.entity;
        if (held) held.generation = generation;
        else if (chained) rows.set(id, { entity, generation, k: snap.k });
        if (own?.includes(entity)) { if (held && chained) { held.entity = entity; held.k = snap.k; } continue; }
        if (!before) { changed.push(entity); continue; }
        const change = changedRow(entity, before);
        // Only where it is, how fast and which way it faces: anything else a body changed is always sent.
        if (change && coasting && !(change[1] & ~(POSITION | VELOCITY | HEADING)) && coasts(entity, before, snap.k - held.k, coasting.hz, coasting.toleranceM)) continue;
        if (held && chained) { held.entity = entity; held.k = snap.k; }
        if (change) changed.push(change);
      }
      rows.forEach((held, id) => { if (held.generation !== generation) { removed.push(id); if (chained) rows.delete(id); } });
      const out = { ...snap, ...(coasting ? { coast: coasting.hz } : {}), d: { base: base.k, round: snap.d[0], ...(snap.d.length > 2 && JSON.stringify(snap.d[2]) !== JSON.stringify(base.d[2]) ? { collision: snap.d[2] } : {}), changed, removed, ...(chained ? { chain: true } : {}), ...(own ? { own } : {}) } };
      if (chained) base = snap;
      return out;
    },
  };
}

export function snapshotDecoder() {
  let base = null;
  let rows = new Map();
  // The tick each row was last SENT at: a frame that says `coast` leaves a body out while it keeps its course,
  // and this end moves it along its last velocity. `rows` keeps what was sent; what is returned is where it is now.
  let sentAt = new Map();
  const coasted = (list, snap) => {
    const hz = snap.coast;
    if (!(hz > 0)) return list;
    return list.map(row => {
      const ticks = snap.k - (sentAt.get(row[0]) ?? snap.k), v = row[4];
      if (ticks <= 0 || !Array.isArray(v) || !v.some(n => n !== 0)) return row;
      const moved = row.slice(); moved[3] = row[3].map((n, i) => n + v[i] * ticks / hz);
      return moved;
    });
  };
  return {
    reset() { base = null; rows.clear(); sentAt.clear(); },
    decode(snap) {
      if (!snap || typeof snap !== 'object') return null;
      if (Array.isArray(snap.d)) {
        if (!Array.isArray(snap.d[0]) || !Array.isArray(snap.d[1]) ||
          !snap.d[1].every(e => Array.isArray(e) && e.length >= 9 && typeof e[0] === 'string')) return null;
        // A late duplicate keyframe must not replace the newer baseline.
        if (!base || snap.e !== base.e || snap.k >= base.k) {
          base = snap; rows = new Map(snap.d[1].map(e => [e[0], e]));
          sentAt = new Map(snap.d[1].map(e => [e[0], snap.k]));
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
        return { ...snap, d: [d.round, [...visible.values()], ...(d.collision === undefined ? base.d.slice(2) : [d.collision])] };
      }
      // Validate first, then mutate only the private chained baseline. Returned
      // snapshots keep their own entity array and immutable row values.
      const updates = [];
      for (const change of d.changed) {
        if (!Array.isArray(change) || typeof change[0] !== 'string') return null;
        if (change.length !== 3) {
          if (change.length < 9) return null;
          updates.push(change); continue;
        }
        if (!Number.isInteger(change[1]) || change[1] < 0 || !Array.isArray(change[2])) return null;
        const old = rows.get(change[0]);
        if (!old) return null;
        const entity = old.slice(); let j = 0;
        for (let i = 1; i < entity.length; i++) if (change[1] & (1 << i)) entity[i] = change[2][j++];
        if (j !== change[2].length) return null;
        updates.push(entity);
      }
      const next = d.chain ? rows : new Map(rows);
      for (const id of d.removed) { next.delete(id); if (d.chain) sentAt.delete(id); }
      for (const entity of updates) { next.set(entity[0], entity); if (d.chain) sentAt.set(entity[0], snap.k); }
      for (const e of d.own ?? []) { next.set(e[0], e); if (d.chain) sentAt.set(e[0], snap.k); }
      const decoded = { ...snap, d: [d.round, coasted([...next.values()], snap), ...(d.collision === undefined ? base.d.slice(2) : [d.collision])] };
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
  const previous = new Map(); let epoch = null, generation = 0;
  return (snap, seat) => {
    if (snap.e !== epoch) { previous.clear(); epoch = snap.e; }
    const selected = interestSnapshot(snap, seat, radiusM);
    const own = selected.d[1].find(e => e[9] === seat && e[10] !== 1);
    generation++;
    // Radius selection already owns its array. Overview selection shares the
    // source, so copy only that case before replacing rows with visual values.
    const entities = selected.d[1] === snap.d[1] ? selected.d[1].slice() : selected.d[1];
    for (let index = 0; index < entities.length; index++) {
      const entity = entities[index], held = previous.get(entity[0]);
      let row = entity, sampledTick = snap.k;
      if (entity !== own) {
        const p = entity[3], q = own?.[3];
        const distanceSquared = q ? (p[0]-q[0])**2 + (p[1]-q[1])**2 + ((p[2]??0)-(q[2]??0))**2 : 0;
        const old = held?.row;
        const interval = farHz && nearM !== null && distanceSquared > nearM**2 ? Math.max(1, Math.round(tickHz / farHz)) : 1;
        // Spread far-view refreshes across players instead of sending the
        // whole room's largest deltas on the same tick. Each player retains
        // the declared rate; newly visible bodies still arrive immediately.
        const phase = (seat ?? 0) % interval;
        sampledTick = snap.k - ((snap.k - phase) % interval + interval) % interval;
        // Coalescing may skip the exact phase. Refresh at the first delivered
        // tick after it, instead of waiting indefinitely for that residue.
        if (old && interval > 1 && snap.k - held.sampledTick < interval) {
          row = old; sampledTick = held.sampledTick;
        } else if (precisionM > 0) {
          let versions = quantizedRows.get(entity);
          row = versions?.precision === precisionM ? versions.row : versions?.others?.get(precisionM);
          if (!row) {
            row = entity.slice();
            for (const i of [3, 4]) row[i] = entity[i].map(n => Number((Math.round(n / precisionM) * precisionM).toPrecision(12)));
            // A heading is a unit vector: a thousandth is a twentieth of a degree, and a third of the digits.
            if (Array.isArray(entity[5])) row[5] = entity[5].map(n => Math.round(n * 1000) / 1000);
            if (!versions) quantizedRows.set(entity, { precision: precisionM, row });
            else { versions.others ??= new Map(); versions.others.set(precisionM, row); }
          }
        }
      }
      if (held) { held.row = row; held.generation = generation; held.sampledTick = sampledTick; }
      else previous.set(entity[0], { row, generation, sampledTick });
      entities[index] = row;
    }
    previous.forEach((held, id) => { if (held.generation !== generation) previous.delete(id); });
    selected.d[1] = entities;
    return selected;
  };
}

/* ------------------------------------------------------------------ a Gate's crowd path (0.46.2)
 *
 * One Gate holds a few dozen players of a room of hundreds, and each of them sees a few hundred bodies. Selecting,
 * comparing and serialising every one of those for every player, twenty times a second, is what a Gate ran out of
 * time doing on Cloudflare at a thousand players. This path does per WORLD what does not depend on the player (the
 * visual value of each body, whether anything but its motion changed, the text of its row), and per player only
 * what must be: is this body in range, and is it still where this player was last told it would be.
 *
 * It is the same wire as `scheduledView` + `snapshotEncoder(Infinity, true, coast)` and the same decoder reads it.
 * It differs in one thing a player can see: a far body is not held still between its `farHz` refreshes and then
 * moved; it coasts, and is sent again when it has strayed half the distance it covers between those refreshes.
 */
const sameTail = (a, b) => {
  if (a.length !== b.length || a[1] !== b[1] || a[2] !== b[2] || a[6] !== b[6]) return false;
  for (let i = 7; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
  return true;
};
/** What a Gate works out once for each world, whoever is looking. One per Gate. */
export function crowdWorlds({ radiusM = null, precisionM = 0 } = {}) {
  const known = new Map(); let generation = 0, last = null, lastOut = null;
  // A precision that is one over a whole number (0.01, 0.05, 0.25) rounds with one multiply and one divide, to the
  // same number the longer way gives; any other takes the longer way.
  const steps = precisionM > 0 ? 1 / precisionM : 0, whole = precisionM > 0 && Math.abs(steps - Math.round(steps)) < 1e-9 ? Math.round(steps) : 0;
  const quantize = (v) => {
    const out = new Array(v.length);
    if (whole) for (let a = 0; a < v.length; a++) out[a] = Math.round(v[a] * whole) / whole;
    else for (let a = 0; a < v.length; a++) out[a] = Number((Math.round(v[a] / precisionM) * precisionM).toPrecision(12));
    return out;
  };
  return {
    radiusM, precisionM,
    of(snap) {
      if (snap === last) return lastOut;
      const entities = snap.d[1], n = entities.length; generation++;
      const stamps = new Int32Array(n), visual = new Array(n), texts = new Array(n);
      const own = new Map(), cells = new Map(), size = radiusM > 0 ? radiusM : 1;
      for (let i = 0; i < n; i++) {
        const e = entities[i]; let held = known.get(e[0]);
        // The stamp moves when anything but position, velocity and heading changed: a field, a revision, a seat.
        if (!held) { held = { row: e, stamp: 1, generation }; known.set(e[0], held); }
        else { if (held.row !== e && !sameTail(held.row, e)) held.stamp++; held.row = e; held.generation = generation; }
        stamps[i] = held.stamp;
        if (e[9] !== undefined && e[10] !== 1) own.set(e[9], i);
        if (radiusM !== null) {
          const p = e[3], key = `${Math.floor(p[0] / size)},${Math.floor(p[1] / size)},${Math.floor((p[2] ?? 0) / size)}`;
          const list = cells.get(key); if (list) list.push(i); else cells.set(key, [i]);
        }
      }
      if (known.size > n) for (const [id, held] of known) if (held.generation !== generation) known.delete(id);
      let all = radiusM === null ? Array.from({ length: n }, (_, i) => i) : null; const around = new Map();
      const control = new Map((snap.c ?? []).map(row => [row[0], row]));
      last = snap;
      lastOut = {
        entities, stamps, own, control, size,
        rest: snap.d.slice(2), restText: snap.d.length > 2 ? JSON.stringify(snap.d[2]) : null,
        /** The body as others see it: the game's precision on where and how fast, a thousandth on which way. */
        visual(i) {
          let row = visual[i];
          if (row === undefined) {
            const e = entities[i];
            if (precisionM > 0) {
              row = e.slice();
              row[3] = quantize(e[3]); row[4] = quantize(e[4]);
              if (Array.isArray(e[5])) { const h = e[5], out = new Array(h.length); for (let a = 0; a < h.length; a++) out[a] = Math.round(h[a] * 1000) / 1000; row[5] = out; }
            } else row = e;
            visual[i] = row;
          }
          return row;
        },
        /** `[id, mask, values]` as text, for a change of only where, how fast and which way (mask of bits 3, 4, 5). */
        motion(i, mask) {
          const slot = texts[i] ??= {}; let text = slot[mask];
          if (text === undefined) {
            const row = this.visual(i), values = [];
            for (let f = 3; f <= 5; f++) if (mask & (1 << f)) values.push(row[f]);
            text = slot[mask] = JSON.stringify([row[0], mask, values]);
          }
          return text;
        },
        everything() { return all ??= Array.from({ length: n }, (_, i) => i); },
        /** Indices of every body in the nine (or 27) cells about a point, in the world's order. */
        near(p) {
          if (radiusM === null) return this.everything();
          const x = Math.floor(p[0] / size), y = Math.floor(p[1] / size), z = Math.floor((p[2] ?? 0) / size), key = `${x},${y},${z}`;
          let list = around.get(key);
          if (!list) {
            list = [];
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const cell = cells.get(`${x + dx},${y + dy},${z + dz}`); if (cell) for (const i of cell) list.push(i); }
            list.sort((a, b) => a - b); around.set(key, list);
          }
          return list;
        },
      };
      return lastOut;
    },
  };
}
const sameVec = (a, b) => { if (a === b) return true; if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
/** One player's view of a Gate's worlds: `(snap, seat)` to the text of the frame to send them. */
export function crowdView(worlds, { nearM = null, farHz = null } = {}, tickHz = 20) {
  const rows = new Map(); let epoch, tick = -Infinity, generation = 0, collision = null;
  const { radiusM, precisionM } = worlds, reach = radiusM === null ? Infinity : radiusM * radiusM;
  const nearSq = nearM !== null && farHz ? nearM * nearM : Infinity, farShare = farHz ? 0.5 / farHz : 0;
  return (snap, seat) => {
    const w = worlds.of(snap), { entities, stamps } = w;
    const me = seat === null ? undefined : w.own.get(seat), mine = me === undefined ? null : entities[me], q = mine?.[3];
    const key = tick === -Infinity || snap.e !== epoch || snap.k <= tick, baseTick = tick;
    if (key) rows.clear();
    epoch = snap.e; tick = snap.k; generation++;
    const control = w.control.get(seat);
    const head = JSON.stringify({ t: 'snap', from: null, k: snap.k, st: snap.st, ...(snap.e !== undefined ? { e: snap.e } : {}), c: control ? [control] : [], coast: tickHz }).slice(0, -1);
    // A player with no body of their own (a screen) is shown the whole room; one whose body is gone, nothing.
    const candidates = seat === null ? w.everything() : mine ? w.near(q) : [];
    const parts = [];
    for (let n = 0; n < candidates.length; n++) {
      const i = candidates[n], e = entities[i];
      let far = false;
      if (e !== mine && q) {
        const p = e[3]; let d = 0;
        for (let a = 0; a < p.length; a++) d += (p[a] - q[a]) ** 2;
        if (d > reach) continue;
        far = d > nearSq;
      }
      const row = e === mine ? e : w.visual(i);
      let held = rows.get(e[0]);
      if (!held) { rows.set(e[0], { row, k: snap.k, stamp: stamps[i], generation }); if (e !== mine || key) parts.push(wireRow(row)); continue; }
      held.generation = generation;
      if (e === mine) { held.row = row; held.k = snap.k; held.stamp = stamps[i]; continue; }
      const before = held.row;
      if (held.stamp === stamps[i]) {
        // Only its motion can differ. Where its last sent position and velocity put it now, within the game's
        // precision (near) or half the way it goes between far refreshes: this player is told nothing.
        const p = row[3], b = before[3], v = before[4], t = (snap.k - held.k) / tickHz;
        let tolerance = precisionM;
        if (far) { let speed = 0; for (let a = 0; a < v.length; a++) speed += v[a] * v[a]; tolerance = Math.max(precisionM, Math.sqrt(speed) * farShare); }
        let there = true;
        for (let a = 0; a < p.length; a++) if (Math.abs(p[a] - (b[a] + v[a] * t)) > tolerance) { there = false; break; }
        if (there) {
          const h = row[5], g = before[5];
          if (Array.isArray(h) && Array.isArray(g)) for (let a = 0; a < h.length; a++) if (Math.abs(h[a] - g[a]) > COAST_HEADING) { there = false; break; }
        }
        if (there && tolerance > 0) continue;
        const mask = (sameVec(p, b) ? 0 : POSITION) | (sameVec(row[4], v) ? 0 : VELOCITY) | (sameVec(row[5], before[5]) ? 0 : HEADING);
        if (!mask) continue;
        held.row = row; held.k = snap.k;
        parts.push(w.motion(i, mask));
        continue;
      }
      const change = changedRow(row, before);
      held.row = row; held.k = snap.k; held.stamp = stamps[i];
      if (change) parts.push(wireRow(change));
    }
    if (key) {
      collision = w.restText;
      return head + ',"d":[' + JSON.stringify(snap.d[0]) + ',[' + parts.join(',') + ']' + w.rest.map(v => ',' + JSON.stringify(v)).join('') + ']}';
    }
    let removed = '';
    if (rows.size > 0) for (const [id, held] of rows) if (held.generation !== generation) { removed += (removed ? ',' : '') + JSON.stringify(id); rows.delete(id); }
    const changedCollision = w.restText !== collision; collision = w.restText;
    return head + ',"d":{"base":' + baseTick + ',"round":' + JSON.stringify(snap.d[0]) + (changedCollision && w.restText !== null ? ',"collision":' + w.restText : '') + ',"removed":[' + removed + '],"chain":true,"changed":[' + parts.join(',') + ']' + (mine ? ',"own":[' + wireRow(mine) + ']' : '') + '}}';
  };
}
