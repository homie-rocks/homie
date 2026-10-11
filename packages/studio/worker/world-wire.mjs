/**
 * The world between the room and a Gate (0.46.2).
 *
 * The room used to send every Gate the whole world as JSON each tick: 150 KB for a thousand players, to sixteen
 * Gates, each of which parsed it. Most of that text was six numbers a body (where it is, how fast, which way), and
 * the rest (its fields, its seat) changes rarely. So the motion goes as one block of numbers, the same block for
 * every Gate, and each Gate is told only the rest of a body when it has changed since that Gate last heard: about
 * 25 KB a tick for a thousand players, and nothing to parse. The numbers are exact: 32-bit when every one of them
 * is (a rules host's are), 64-bit when any is not.
 *
 * `worldSource()` belongs to the room, one for all its Gate links. `worldSink()` belongs to a Gate.
 */
const sameValue = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false; return true; }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
};
/** Everything of a body but its motion: the same unless a field, a revision, a seat or a driver changed. */
const sameTail = (a, b) => {
  if (a.length !== b.length || a[1] !== b[1] || a[2] !== b[2] || a[6] !== b[6]) return false;
  for (let i = 7; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
  return true;
};
const numbers = (v) => Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n));

export function worldSource() {
  const known = new Map();
  let seq = 0, orderSeq = 0, restSeq = 0, ids = null, restText = null, last = null, lastOut = null;
  return {
    /** Once a world, whichever link asks first: the block of motion, and what changed since the world before. */
    encode(snap) {
      if (snap === last) return lastOut;
      const entities = snap.d?.[1];
      // A world this cannot carry exactly (no bodies array, a body without three vectors of one size) goes as it is.
      const dims = entities?.[0]?.[3]?.length ?? 2;
      if (!Array.isArray(entities) || !entities.every((e) => Array.isArray(e) && e.length >= 9 && typeof e[0] === 'string' && numbers(e[3]) && numbers(e[4]) && numbers(e[5]) && e[3].length === dims && e[4].length === dims && e[5].length === dims)) { last = snap; lastOut = null; return null; }
      seq += 1;
      const n = entities.length, width = dims * 3, wide = new Float64Array(n * width), order = new Array(n), changed = [];
      let same = ids !== null && ids.length === n, narrow = true;
      for (let i = 0; i < n; i++) {
        const e = entities[i], id = e[0]; order[i] = id;
        if (same && ids[i] !== id) same = false;
        for (let a = 0; a < dims; a++) { wide[i * width + a] = e[3][a]; wide[i * width + dims + a] = e[4][a]; wide[i * width + 2 * dims + a] = e[5][a]; }
        const held = known.get(id);
        if (!held) { known.set(id, { row: e, changed: seq }); changed.push(i); }
        else { if (held.row !== e && !sameTail(held.row, e)) { held.changed = seq; changed.push(i); } held.row = e; }
      }
      if (!same) {
        orderSeq = seq;
        if (known.size > n) { const live = new Set(order); for (const id of known.keys()) if (!live.has(id)) known.delete(id); }
      }
      ids = order;
      for (let i = 0; i < wide.length; i++) if (Math.fround(wide[i]) !== wide[i]) { narrow = false; break; }
      const text = snap.d.length > 2 ? JSON.stringify(snap.d.slice(2)) : '';
      if (text !== restText) { restText = text; restSeq = seq; }
      last = snap;
      lastOut = { seq, n, dims, narrow, motion: narrow ? Float32Array.from(wide).buffer : wide.buffer, entities, changed, control: new Map((snap.c ?? []).map((row) => [row[0], row])), snap };
      return lastOut;
    },
    /** What one Gate needs beside the block: the bodies whose rest changed since world `synced`, and its own players' control rows. */
    header(world, synced, seats) {
      const { snap, entities } = world, tails = [];
      const tail = (i) => { const e = entities[i].slice(); e[3] = e[4] = e[5] = 0; tails.push([i, e]); };
      if (synced === world.seq - 1) for (const i of world.changed) tail(i);
      else for (let i = 0; i < entities.length; i++) if (known.get(entities[i][0]).changed > synced) tail(i);
      const c = [];
      for (const seat of seats) { const row = world.control.get(seat); if (row) c.push(row); }
      return {
        k: snap.k, st: snap.st, ...(snap.e !== undefined ? { e: snap.e } : {}), round: snap.d[0], c,
        w: { seq: world.seq, n: world.n, dims: world.dims, narrow: world.narrow, ...(orderSeq > synced ? { ids } : {}), tails, ...(restSeq > synced ? { rest: snap.d.slice(2) } : {}) },
      };
    },
  };
}

export function worldSink() {
  let ids = [], tails = [], rest = [];
  return {
    /** The world a header and its block describe, as the room held it. Throws when they do not fit each other. */
    decode(header, block) {
      const w = header.w;
      if (w.ids) {
        const held = new Map(ids.map((id, i) => [id, tails[i]]));
        ids = w.ids; tails = ids.map((id) => held.get(id));
      }
      for (const [i, tail] of w.tails) tails[i] = tail;
      if (w.rest) rest = w.rest;
      const width = w.dims * 3;
      if (ArrayBuffer.isView(block)) block = block.buffer.slice(block.byteOffset, block.byteOffset + block.byteLength);
      if (!(block instanceof ArrayBuffer) || ids.length !== w.n || block.byteLength !== w.n * width * (w.narrow ? 4 : 8)) throw new Error(`world block does not fit its header (${Object.prototype.toString.call(block)}, ${block?.byteLength ?? block?.size} bytes for ${w.n} bodies, ${ids.length} known)`);
      const a = w.narrow ? new Float32Array(block) : new Float64Array(block), entities = new Array(w.n), d = w.dims;
      for (let i = 0; i < w.n; i++) {
        const tail = tails[i];
        if (!tail) throw new Error('world names a body this Gate was never told of');
        const row = tail.slice(), o = i * width;
        row[3] = d === 2 ? [a[o], a[o + 1]] : [a[o], a[o + 1], a[o + 2]];
        row[4] = d === 2 ? [a[o + d], a[o + d + 1]] : [a[o + d], a[o + d + 1], a[o + d + 2]];
        row[5] = d === 2 ? [a[o + 2 * d], a[o + 2 * d + 1]] : [a[o + 2 * d], a[o + 2 * d + 1], a[o + 2 * d + 2]];
        entities[i] = row;
      }
      return { k: header.k, st: header.st, ...(header.e !== undefined ? { e: header.e } : {}), d: [header.round, entities, ...rest], c: header.c };
    },
  };
}
