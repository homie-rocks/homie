/** Absolute assignments, never increments: replay cannot mint value twice.
 * Entity IDs are keys so removing one entity never rewrites the rest of a world.
 * The snapshot format remains the host's validated format at the read boundary.
 */
const collections = [
  [['host','core','ents'], row => row[0]], [['host','core','spawns'], row => row[0]],
  [['host','characters'], row => row.account], [['host','names'], row => row[0]],
  [['host','inputs'], row => row[0]], [['host','queues'], row => row[0]],
  [['host','core','seats'], row => row[0]], [['net','seats'], row => row[0]],
  [['host','core','queue'], row => `${row[3]}:${row[4]}`],
  [['host','core','areas'], row => row[2]], [['host','core','asks'], row => row.n],
];
function collectionsOf(copy, encode) {
  for (const [path, identity] of collections) {
    let parent = copy;
    for (const key of path.slice(0,-1)) parent = parent?.[key];
    const key = path.at(-1), rows = parent?.[key];
    if (rows) parent[key] = encode ? Object.fromEntries(rows.map(row => [`k${identity(row)}`,row])) : Object.values(rows);
  }
  return copy;
}
/** Keyed collections on a copied spine. The rows themselves are shared with `value`: callers that keep the result clone first. */
export function normalizeWorld(value) {
  const host = typeof value.host === 'string' ? JSON.parse(value.host) : value.host;
  const copy = { ...value, host: { ...host, ...(host.core ? { core: { ...host.core } } : {}) }, ...(value.net ? { net: { ...value.net } } : {}) };
  return collectionsOf(copy, true);
}
export function denormalizeWorld(value) {
  return collectionsOf(structuredClone(value), false);
}
const isField = path => path[4] === 17 && path.length >= 6 || path[2] === 'shared' && path.length >= 4;
/**
 * One walk of both values, no serialising of what did not change: a tick's cost follows the durable state, and a
 * record's size follows what changed in it. Arrays are diffed by cell, packed maps and lists included.
 * `path` is where the two values sit; a patch is `[path, value]`, or `[path]` for a key that is gone.
 */
export function changes(before, after, path = [], out = []) {
  walk(before, after, [...path], out);
  return out;
}
/** `at` is one stack for the whole walk, copied only into a patch: nothing is allocated for what is equal. */
function walk(before, after, at, out) {
  if (before === after) return;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) { out.push([[...at], after]); return; }
  const start = out.length;
  if (Array.isArray(after)) {
    // By index, as numbers: a cell past the shorter array's end is new, and the length patch drops what is gone.
    for (let i = 0; i < after.length; i += 1) { at.push(i); walk(before[i], after[i], at, out); at.pop(); }
    if (before.length !== after.length) out.push([[...at, 'length'], after.length]);
  } else {
    for (const key in before) if (!Object.hasOwn(after, key)) out.push([[...at, key]]);
    for (const key in after) { at.push(key); walk(before[key], after[key], at, out); at.pop(); }
  }
  // A packed inventory whose every slot changes is smaller as one assignment.
  // Never coalesce a projected entity or room (that would pull movement in).
  if (out.length > start && isField(at) && JSON.stringify([at, after]).length < JSON.stringify(out.slice(start)).length) out.splice(start, out.length - start, [[...at], after]);
}
export function applyChanges(value, patches) {
  for (const [path, next] of patches) {
    if (!path.length) { value = structuredClone(next); continue; }
    let target = value;
    for (const key of path.slice(0,-1)) target = target[key];
    const key = path.at(-1);
    if (next === undefined) delete target[key];
    else if (Array.isArray(target) && key === 'length') target.length = next;
    else Object.defineProperty(target, key, {value:structuredClone(next),writable:true,enumerable:true,configurable:true});
  }
  return value;
}
/** Durable fields plus the causal machinery that can create/consume value.
 * Movement, inputs, pose history and undeclared fields wait for a checkpoint.
 * Takes a normalised world and leaves it untouched. The view it returns shares its leaves with that world: it is for
 * comparing now, and `ownDurable` makes the copy that is kept.
 */
const POSE = [3, 7, 8, 9, 10, 15, 16, 18, 19];
export function durableWorld(value, fields) {
  const { at, ...v } = value, { inputs, queues, guideViews, agents, ...h } = v.host, { tick, rng, nextId, seq, history, collision, guideViews: views, ...c } = h.core;
  if (v.net) { const { savedAt, ckpt, state, round, roster, ...net } = v.net; v.net = net; }
  for (const key of ['ents', 'spawns']) {
    const rows = {};
    for (const [id, row] of Object.entries(c[key] ?? {})) {
      const list = fields.kinds[row[2]] ?? [];
      // Undeclared non-player entities (for example visual projectiles) belong
      // to checkpoints. Seat-bearing bodies remain part of the ownership protocol.
      if (!list.length && row[11] < 0) continue;
      // Preserve membership and ownership; pose/motion rewind to the checkpoint.
      const kept = row.slice();
      for (const i of POSE) if (i < kept.length) kept[i] = null;
      kept[17] = {};
      for (const i of list) if (row[17][i] !== undefined) kept[17][i] = row[17][i];
      rows[id] = kept;
    }
    c[key] = rows;
  }
  const shared = {};
  for (const i of fields.shared) if (c.shared?.[i] !== undefined) shared[i] = c.shared[i];
  c.shared = shared; h.core = c; v.host = h;
  return v;
}
/** A durable view that shares nothing with the world it was taken from. */
export const ownDurable = (value, fields) => JSON.parse(JSON.stringify(durableWorld(value, fields)));
/** Ignore clocks when deciding if an unchanged room needs a checkpoint. */
export function checkpointWorld(value) {
  const v = structuredClone(value);
  delete v.at; if(v.net) delete v.net.savedAt;
  if(v.host?.core) { delete v.host.core.tick; delete v.host.core.history; delete v.host.core.collision; }
  for(const [,q] of Object.values(v.host?.inputs ?? {})) delete q.lastFrameTick;
  return v;
}
