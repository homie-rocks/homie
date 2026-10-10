/**
 * The generated play of a rules game, in a worker thread of its own (rules-check.mjs starts it).
 *
 * The module that is checked is the module that is deployed, linked with the real runtime (rules/host.ts and what it
 * imports), and nothing here judges a game: this file only plays the people of a room and listens to the runtime.
 * A build is refused for five things, each of which the runtime itself says:
 *
 *   a handler threw            the runtime caught it (core.ts `observe`); the line is the guard's own (`G.file`, `G.line`)
 *   a value did not fit        the runtime stored something else than a handler wrote, or dropped it (core.ts `noted`):
 *                              NaN stored as 0, a list cut to its size. A room does that and carries on; the build
 *                              names the write. (A whole number held to its range is only counted, and said.)
 *   a tick ran out of budget   the runtime's count (`stats.ticksCut`)
 *   a held-back body           the runtime cut an owner-moved body's own `move` short of where it claimed (`stats.held`)
 *   a save that does not hold  the room is rebuilt from its own save (`host.save()` into `createHost({ restore })`, the
 *                              one path a restart takes), saved again, and played one tick beside the room that kept
 *                              running: the three saves must be the same bytes
 *
 * Everything else it sees is an information line. All of it is bounded in the runtime's own units (ticks played, budget
 * units used by the room and by the browsers' `move`, bytes of save rebuilt), never by a clock, so the same source gives
 * the same verdict and the same lines on every computer.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { compileFunction } from 'node:vm';
import { checkDecide } from '../worker/brain.mjs';
import { stateHash } from './rules-check.mjs';

const { bundle, data, declarationsOnly, allowance } = workerData;
const sites = data.sites ?? {};
const here = () => sites.default ?? `games/${data.id}/src/rules.ts`;

/** A runtime error in the words of the chat: what was absent or read-only, and the usual fix. */
function diagnostic(message) {
  message = message.replace('Maximum call stack size exceeded', 'Calls went too deep (a function that calls itself without end)');
  let m = /Cannot read properties of (?:undefined|null) \(reading '([^']+)'\)/.exec(message);
  if (m) return `The value before .${m[1]} is absent. Check that the map spot, list entry or query result exists before reading .${m[1]}.`;
  if (/cannot call (\w+) on (undefined|null)/.test(message)) return message.replace(/cannot call (\w+) on (undefined|null)/, 'Cannot call $1 because the value it is called on is absent. Check the index or query result first');
  if (/Cannot convert undefined or null to object/.test(message)) return 'A value that is absent was used as a list or an object. Check that it exists first.';
  m = /Cannot add property ([^,]+), object is not extensible/.exec(message);
  if (m) return `Field "${m[1]}" is not declared. Declare it in fields, motion or shared before assigning it.`;
  m = /Cannot assign to read only property '([^']+)'|Cannot set property (\w+) of/.exec(message);
  if (m) return `"${m[1] ?? m[2]}" is read only here. A handler writes its own entity's fields and motion (room handlers write shared); constants, query results and event data are read only. Send an event to change another entity.`;
  return message;
}
const fix = (message) => (/[.!?]$/.test(message) ? message : `${message}.`) + (/too deep/.test(message) ? ' Use a bounded loop or an explicit list instead.' : /ran too long/.test(message) ? ' Bound this loop or split the work across ticks.' : /is not declared in shapes/.test(message) ? ' Declare the name and its payload in shapes before sending it.' : '');

/** The linked module and the runtime it was linked with: { def, R, H, C, W, P, M } (rules-build.mjs `loadRules`). */
let L;

/** The declarations, compiled as a room compiles them. What is wrong with them is said with the line they are on. */
function compile() {
  const { settings, problems } = L.R.roomSettings(data.room);
  for (const [name, ask] of Object.entries(L.def.asks ?? {})) {
    const checked = checkDecide({}, ask.questions);
    if (!checked.ok) throw new Error(`asks.${name}.questions: ${checked.why}. Each question needs a type and instructions, for example { type: 'noul', instructions: 'Should the party advance?' }`);
  }
  return { c: L.R.compileRules(L.def, { tune: data.tune, map: L.R.compileMap(data.map, data.map.name), settings, seats: data.seats }), problems };
}

/** How the runtime names a handler, as the chat reads it and as the source declares it. */
const shown = (kind, handler) => (kind === 'room' || handler.startsWith('asks.') ? `room.${handler}` : `${kind}.${handler}`);
const siteOf = (kind, handler) => sites[handler.startsWith('asks.') ? handler : handler === 'move' ? `move.${kind}` : kind === 'room' ? `room.${handler}` : `entities.${kind}.${handler}`] ?? here();
function declared(c) {
  const list = [];
  if (c.start) list.push(['room', 'start']);
  if (c.join) list.push(['room', 'join']);
  for (const ev of Object.keys(c.roomOn)) list.push(['room', `on.${ev}`]);
  for (const name of Object.keys(c.asks)) list.push(['room', `asks.${name}.floor`]);
  for (const k of c.kinds) {
    for (const key of ['tick', 'think', 'move']) if (k[key]) list.push([k.name, key]);
    if (k.guide?.view) list.push([k.name, 'guide.view']);
    if (k.guide?.floor) list.push([k.name, 'guide.floor']);
    for (const group of ['on', 'commands', 'onRoom']) for (const ev of Object.keys(k[group])) list.push([k.name, `${group}.${ev}`]);
  }
  return list;
}

/** What was written, as the runtime says it (pack.ts `said`): a text in quotes, a kind of thing as it is. */
const plain = (written) => (/^(null|a (Map|Set|list|value of type \w+))$/.test(written) ? written : JSON.stringify(written));
/**
 * A written value the runtime changed or dropped, in the words of the chat. `what` is pack.ts `Adjusted`, or `effect`,
 * `think`, `decision`; `at` is the field; `written` is what the rules wrote, as the runtime says it.
 */
function unfit(what, at, written, inPlace) {
  const room = 'A live room does not stop for this:';
  // Changed in place (a push, a key set on it), a field is held to its type when the handler ends, not at a write.
  const got = inPlace ? 'was changed in place in this handler (not assigned), and when the handler ended it held' : 'was written';
  const name = at || 'a value';
  switch (what) {
    case 'nan': return written === 'NaN'
      ? `${name} ${got} NaN, which is not a number. ${room} it stores 0 there, and the game plays on with a wrong value. Check the divisor before dividing, and that every value read exists.`
      : `${name} ${got} ${plain(written)}, which is not a number. ${room} it stores 0 there. Write a number there.`;
    case 'infinite': return /Infinity/.test(written)
      ? `${name} ${got} ${written}, which a fraction or a vector cannot hold. ${room} it stores 0 there. Check the divisor before dividing; for "never" or "no limit", use a whole-number field (it holds Infinity as the end of its range).`
      : `${name} ${got} ${written}, which is too large for the 32-bit numbers of a vector. ${room} it stores 0 there. Keep positions and velocities far below 3e38.`;
    case 'text': return `${name} ${got} a text of ${written}. ${room} it cuts the text to its size. Shorten the text, or declare the size the game needs.`;
    case 'list': return `${name} ${got} a list of ${written}. ${room} it keeps the first entries and drops the rest. Remove old entries before adding, or declare the size the game needs.`;
    case 'map': return `${name} ${got} a map of ${written}. ${room} it drops the keys past its size. Remove old keys before adding, or declare the size the game needs.`;
    case 'key': return `${name} ${got} the key ${JSON.stringify(written.slice(0, 24))}${written.length > 24 ? ' (and more)' : ''}, which cannot be a key of a map: a key is at most 32 characters and not a name every object has (constructor, prototype, __proto__). ${room} it drops that entry. Use another key.`;
    case 'kind': return `${name} ${got} ${plain(written)} where a list or a plain object belongs. ${room} it stores it empty. Copy the entries of a Map or a Set into a list or a plain object first.`;
    case 'effect': return `more than 256 effects were emitted in one tick (this one: ${written}). ${room} it drops the rest, and nobody sees them. Combine effects, or spread them across ticks.`;
    case 'think': return at ? `think returned "${at}", which is not an input this kind declares. ${room} it ignores it. Return only the kind's input fields.` : `think returned ${written}, not an object of its declared inputs. ${room} the body gets neutral input. Return an object such as { ax: 0 }.`;
    default: return `guide.floor returned ${at}: ${written}. ${room} it discards the whole decision. Use the names in agents.json and the values the view offered.`;
  }
}

const rng = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const same = (a, b) => a.length === b.length && Buffer.compare(a, b) === 0;

/** Where two saves first differ, in the game's own names. Only for the message: the verdict is the bytes. */
function firstDifference(c, a, b) {
  const named = (s) => {
    const core = s.core; const fields = (list, values) => L.P.unpackFields(list, values, c.dims);
    const ent = (e) => { const k = c.kinds[e[2]]; return [e[0], { kind: k.name, pos: e[7], vel: e[8], heading: e[9], fields: fields(k.fields, e[17]), motion: fields(k.motion, e[18]), input: fields(k.input, e[19]), commands: e[20], runtime: [...e.slice(1, 7), ...e.slice(10, 17)] }]; };
    return { ...s, core: { ...core, shared: fields(c.shared, core.shared), ents: Object.fromEntries(core.ents.map(ent)), spawns: Object.fromEntries(core.spawns.map(ent)) } };
  };
  const walk = (x, y, path) => {
    if (Object.is(x, y)) return null;
    if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return `${path || 'the save'} (${JSON.stringify(x)?.slice(0, 60)} against ${JSON.stringify(y)?.slice(0, 60)})`;
    const kx = Object.keys(x); const ky = Object.keys(y);
    for (let i = 0; i < Math.max(kx.length, ky.length); i += 1) if (kx[i] !== ky[i]) return `${path ? `${path}.` : ''}${kx[i] ?? ky[i]} (a key is absent, or the keys are in another order)`;
    for (const k of kx) { const found = walk(x[k], y[k], path ? `${path}.${k}` : k); if (found) return found; }
    return null;
  };
  try { return (walk(named(L.P.fromBytes(a)), named(L.P.fromBytes(b)), '') ?? 'the save').replace(/^core\./, ''); } catch { return 'the save'; }
}

/**
 * One room, played from its first tick until its allowance is used or something is proven.
 * Returns what the play covered; `fault` is the first thing proven, in full, or null.
 */
function play(c, companions, allow) {
  const { G } = L.W;
  const tickHz = c.settings.tickHz; const budget = c.settings.budget.tick;
  const secs = (s) => Math.max(1, Math.round(s * tickHz));
  const dice = rng(193);
  const ran = new Map();
  let fault = null; let step = 0; let roundNow = 0; let rounds = 0; let units = 0;
  let did = []; let sentCommands = new Map();
  const when = () => ` This was tick ${step} of the generated play (${(step / tickHz).toFixed(1)} seconds in${roundNow ? `, round ${roundNow}` : ''}).`;
  /** Whole numbers held to their range, by field: the runtime's own count, said in one line each. */
  const ranges = new Map();
  const noted = (kind, handler, what, at, written) => {
    const inPlace = what.endsWith(' in place');
    if (inPlace) what = what.slice(0, -9);
    // Changed in place, the field is held to its type when the handler ends: the line then is not the write's, so the handler is named instead.
    const where = inPlace ? siteOf(kind, handler) : `${G.file || siteOf(kind, handler).split(':')[0]}:${G.line || 1}`;
    if (what === 'range') {
      const field = at.replace(/\[\d+\]/g, '[]');
      const row = ranges.get(field);
      if (row) row.count += 1; else ranges.set(field, { count: 1, written, where, handler: shown(kind, handler) });
      return;
    }
    fault ??= `${where} ${shown(kind, handler)}: ${unfit(what, at, written, inPlace)}${when()}`;
  };
  const observe = (kind, handler, error) => {
    let set = ran.get(kind); if (!set) ran.set(kind, set = new Set());
    set.add(handler);
    if (!error || fault) return;
    const sent = handler.startsWith('commands.') ? sentCommands.get(handler.slice(9)) : undefined;
    const seats = (handler === 'join' || handler.startsWith('on.seat')) && did.length ? ` Before this tick ${did.join(', ')}; game.json permits ${data.seats} seats.` : '';
    fault = `${G.file || siteOf(kind, handler).split(':')[0]}:${G.line || 1} ${shown(kind, handler)}: ${fix(diagnostic(error))}${when()}${seats}${sent !== undefined ? ` The check sent the command ${handler.slice(9)} with ${JSON.stringify(sent)}, which shapes.commands allows.` : ''}`;
  };

  /* ---- the relay's part: who is in which seat, and what a restored room is told again */
  let now = 0; let snap = null; const offers = new Map();
  const send = (m) => {
    if (m.t === 'snap') snap = m;
    else if (m.t === 'round') { roundNow = m.round.n; if (m.round.phase === 'over') rounds += 1; }
    else if (m.t === 'ev' && m.k === 'agent:offer') offers.set(m.d.slot, m.d.view);
  };
  const open = (o = {}) => L.H.createHost({ game: data.id, compiled: c, check: true, random: rng(7), clock: { now: () => now, setTimer: () => 0, clearTimer() {} }, send() {}, ...o });
  const vocab = data.vocab ?? { v: 1, goals: {}, lines: {}, asks: {} };
  let policy = companions ? { kind: 'beginner', aiSeats: data.seats > 1 ? 1 : 0, guides: 1, bots: 'off', brain: 'script' } : null;
  /** What the relay says to a room again after a restore: the vocabulary and the policy. Neither is in the save. */
  const told = () => [...(companions ? [{ t: 'vocabulary', vocab }] : []), ...(policy ? [{ t: 'policy', policy }] : [])];
  const people = data.seats - (companions ? Math.min(policy.aiSeats + policy.guides, data.seats - 1) : 0);
  const seated = new Map();   // seat -> the relay's number for this stay in it; negative while the holder is away
  let stays = 0;
  let frames = [];
  const joined = (seat, occ) => ({ t: 'join', peer: { id: `check${occ}`, seat, name: 'Check', occ } });
  const join = (seat) => { const back = seated.get(seat); const occ = back ? Math.abs(back) : (stays += 1); seated.set(seat, occ); did.push(`seat ${seat} ${back ? 'returned' : 'joined'}`); frames.push(joined(seat, occ)); };
  const away = (seat) => { if (!(seated.get(seat) > 0)) return; seated.set(seat, -seated.get(seat)); did.push(`seat ${seat} went away`); frames.push({ t: 'leave', seat }); };
  const free = (seat) => { if (!seated.has(seat)) return; seated.delete(seat); did.push(`seat ${seat} left`); frames.push({ t: 'free', seat }); };
  const bots = (mode) => { policy = { ...(policy ?? {}), bots: mode }; frames.push({ t: 'policy', policy }); };

  const movesToCheck = [];
  const moved = (...args) => movesToCheck.push(args);
  let A = open({ observe, noted, moved, send });
  for (const m of told()) A.frame(m);
  /** The room stops and starts again as a deploy restarts it: a new epoch, everybody away until they are back. */
  const restart = () => {
    const bytes = A.save(); const epoch = A.epoch + 1; A.stop();
    A = open({ observe, noted, moved, send, restore: bytes, restoreEpoch: epoch });
    for (const m of told()) A.frame(m);
    // Everybody is back at once, but for the highest seat, which is a second late.
    const top = Math.max(...seated.keys());
    for (const [seat, occ] of [...seated]) if (occ > 0) { if (seat === top && top > 0) seated.set(seat, -occ); else join(seat); }
  };

  /*
   * ---- what happens to the seats, by the tick. The first seconds hold one of everything. After them the room is full
   * for one round and small for the next (two people and no bots, so that something is left when a round ends), and
   * all the while somebody goes away and comes back, gives up a seat and takes it again, and the room restarts once
   * every 40 seconds as a deploy restarts it.
   */
  const opening = Math.max(secs(5), 80);
  let chapter = -1;
  function seats(t) {
    if (!c.join) return;
    if (t === 1) join(0);
    if (people > 1) {
      if (t === 3) join(1); if (t === 5) away(1); if (t === 6) join(1); if (t === 8) free(1); if (t === 10) join(1);
      if (t === 12) for (let s = 2; s < people; s += 1) join(s);
      if (t === 20 && people > 2) free(people - 1); if (t === 26 && people > 2) join(people - 1);
    }
    if (!companions) { if (t === 22) bots('off'); if (t === 24) bots('fill'); }
    if (t === 70) for (const s of [...seated.keys()]) free(s);
    if (t === 72) { join(0); if (people > 1) join(1); }
    if (t < opening) return;
    // A chapter is a round, or a minute of a game without rounds: full, then small, in turn.
    const next = c.rounds ? rounds : Math.floor(t / secs(60));
    if (next !== chapter) {
      chapter = next;
      const small = next % 2 === 1;
      if (!companions) bots(small ? 'off' : 'fill');
      for (let s = 0; s < people; s += 1) { if (small && s > 1) free(s); else if (!(seated.get(s) > 0)) join(s); }
    }
    const top = Math.max(...seated.keys());
    const at = (s) => (t - opening) % secs(40) === secs(s);
    if (top > 0) { if (at(6)) away(top); if (at(18)) join(top); if (at(22)) free(top); if (at(24)) join(top); }
    if (at(34)) restart();
    if (at(35)) for (const [seat, occ] of [...seated]) if (occ < 0) join(seat);
  }

  /* ---- what the people press. Each plays one of three ways, changing every 20 s; seat 1 never sends anything. */
  const ends = (fd) => (fd.t === 'bit' || fd.t === 'press' ? [false, true] : fd.t === 'fix' ? [-1, 1] : [L.P.coerce(fd, -Infinity, c.dims), L.P.coerce(fd, Infinity, c.dims)]);
  const steering = new Map();
  let moveTick = 0;
  let moveGeometry = c.map;
  const moveCtx = new Map(c.kinds.filter((k) => k.move && k.body).map((k) => [k.name, L.M.moveContext({ tick: () => moveTick, tickHz, tune: c.publicTune, map: c.map, geometry: () => moveGeometry, name: c.map.name, spots: c.map.spots, radius: () => k.body.radius, shape: () => k.body, dims: c.dims })]));
  /**
   * An owner-moved body's own browser, for one tick: the game's `move` from where the last snapshot has the body, by
   * the step a browser takes (pack.ts `stepMove`), and the claim of where that leaves it. Its units are the play's.
   * (A real browser keeps its own position between snapshots; starting from the server's each tick asks one thing
   * only, whether a step of this move is one the server lets a body take.)
   */
  function claim(k, b, values, t) {
    const w = snap?.d[1].find((e) => e[0] === b.id);
    const e = w && L.P.unpackEntity(c.kinds, w, c.dims);
    if (!e) return null;
    G.note = (what, at, written) => noted(k.name, 'move', what, at, written);
    moveTick = t;
    const body = L.P.stepMove(k.move, { pos: e.pos, vel: e.vel, heading: e.heading, grounded: e.grounded, motion: L.P.thawFields(k.motion, e.motion) }, Object.freeze(values), moveCtx.get(k.name), Math.max(1, Math.floor(budget / 4)), k.motion, c.dims,
      (error) => { fault ??= `${G.file}:${G.line} ${k.name}.move: ${fix(diagnostic(String(error?.message ?? error)))} A player's own browser runs this move for its body.${when()}`; });
    G.note = null;
    units += body.used;
    return L.H.claimOf(body.pos, body.vel, body.heading);
  }
  function sample(fd, n, refs) {
    if (fd.t === 'ref') return n % 2 ? refs[(n >> 1) % refs.length] ?? '' : '';
    if (fd.t === 'text') return n % 2 ? 'x'.repeat(fd.max) : '';
    if (fd.t === 'vec3' || fd.t === 'dir') return { x: n % 2, y: 0, z: 0 };
    if (fd.t === 'list') return n % 2 ? Array.from({ length: fd.max }, () => sample(fd.of, 0, refs)) : [];
    if (fd.t === 'map') return n % 2 ? { key: sample(fd.of, n, refs) } : {};
    if (fd.t === 'struct') return Object.fromEntries(Object.entries(fd.fields).map(([name, sub]) => [name, sample(sub, n, refs)]));
    const [lo, hi] = ends(fd);
    const values = [lo, hi, ...[0, 1, 2, 3, -1].filter((v) => v > lo && v < hi)];
    return values[n % values.length];
  }
  function presses(t) {
    const bodies = A.core.bodies();
    const refs = bodies.map((b) => b.id);
    sentCommands = new Map();
    for (const b of bodies) {
      if (b.driver !== 'person' || !(seated.get(b.seat) > 0)) continue;
      const way = b.seat === 1 ? 'idle' : ['steer', 'hold', 'steer', 'idle'][(b.seat + Math.floor(t / secs(20))) % 4];
      if (way === 'idle') continue;
      const k = c.kindOf[b.kind];
      let values;
      if (way === 'hold') values = Object.fromEntries(k.input.map(([name, fd]) => [name, ends(fd)[Math.floor(t / secs(2)) % 2]]));
      else {
        let s = steering.get(b.seat);
        if (!s || t >= s.until) steering.set(b.seat, s = { until: t + 1 + Math.floor(dice() * secs(3)), values: Object.fromEntries(k.input.map(([name, fd]) => { const r = dice(); return [name, r < 0.4 ? ends(fd)[0] : r < 0.8 ? ends(fd)[1] : L.P.initOf(fd, c.dims)]; })) });
        values = s.values;
      }
      const row = k.input.map(([name]) => (typeof values[name] === 'boolean' ? Number(values[name]) : values[name]));
      if (k.body?.owner && k.move) { const claimed = claim(k, b, values, t); if (claimed) row.push(...claimed); }
      frames.push({ t: 'in', from: b.seat, e: A.epoch, k: t, r: b.r, s: [[0, ...row]] });
      if (t % 5 === 0) for (const [name, fields] of Object.entries(c.commands)) {
        const d = Object.fromEntries(fields.map(([field, fd]) => [field, sample(fd, Math.floor(t / 5) + b.seat, refs)]));
        sentCommands.set(name, d);
        frames.push({ t: 'ev', from: b.seat, k: 'cmd', d: [name, d] });
      }
    }
    // A person asks each companion for something the vocabulary offers, every two seconds.
    const asks = companions ? Object.entries(vocab.asks ?? {}) : [];
    const person = bodies.find((b) => b.driver === 'person' && seated.get(b.seat) > 0);
    if (asks.length && person && t % secs(2) === 0) {
      const [name, ask] = asks[Math.floor(t / secs(2)) % asks.length];
      for (const b of bodies) {
        if (b.driver !== 'ai') continue;
        const view = offers.get(b.seat) ?? {};
        const args = Object.fromEntries(Object.entries(ask.args ?? {}).map(([key, type]) => {
          const offered = typeof type === 'string' && type.startsWith('view.') ? view[type.slice(5)] : null;
          const value = type === 'player' ? person.seat : Array.isArray(type) ? type[0] : Array.isArray(offered) ? offered[0] : offered;
          return [key, value && typeof value === 'object' ? value.id : value];
        }));
        if (!Object.values(args).some((v) => v === undefined || v === null)) frames.push({ t: 'ev', from: person.seat, k: `ask:${name}`, d: { slot: b.seat, args } });
      }
    }
  }

  /* ---- the play */
  let rebuilt = 0; let restores = 0; let largest = 0; let saved = null; let stopped = 'ticks';
  let peak = 0; let most = 0; let worst = '';   // a restart begins the runtime's own counts again, so the busiest tick and handler are kept here
  const heldBack = () => {
    const k = c.kinds.filter((x) => x.player && x.body?.owner && x.move);
    return `${siteOf(k[0]?.name, 'move')} ${k.map((x) => x.name).join(' or ')}.move: the server held this body back: one step of this move, from where the server has the body, goes further than the server lets a body go in a tick (body.maxSpeed is ${k.map((x) => x.body.maxSpeed).join(', ')} m/s). A player would see their character pulled back. Clamp the speed (a diagonal is longer than either stick axis), or declare the body's real top speed.${when()}`;
  };
  while (!fault) {
    if (step >= allow.ticks) break;
    if (units >= allow.units) { stopped = 'units'; break; }
    step += 1; did = []; frames = [];
    const t = A.tick + 1; const room = A;   // `seats` may restart the room; that tick is not also compared
    // Before this tick the room is rebuilt from its save and compared, if this is a tick for it. Who is here is noted
    // before this tick's comings and goings: a rebuilt room has nobody connected until they are back.
    const compare = rebuilt < allow.restoreBytes && (step <= allow.everyTick || step % allow.every === 0);
    const present = compare ? [...seated].filter(([, occ]) => occ > 0).map(([seat, occ]) => joined(seat, occ)) : [];
    seats(step);
    presses(t);
    if (fault) break;
    let B = null; let before = null;
    if (compare && A === room) {
      before = saved ?? A.save();
      try { B = open({ restore: before }); } catch (error) { fault = `${here()}: the runtime could not rebuild this room from its own save: ${error.message}.${when()} This is a fault in Homie's save, not in the game's rules: report the game with this message.`; break; }
      if (!same(before, B.save())) { fault = `${here()}: a room rebuilt from its save does not save the same again; first difference at ${firstDifference(c, before, B.save())}.${when()} This is a fault in Homie's save, not in the game's rules: report the game with this message.`; break; }
      // The relay tells the rebuilt room its vocabulary and policy again, and everybody who is here reconnects: to both
      // rooms, so that both hold the same connections (a reconnect is an ordinary thing for a room to be sent).
      for (const m of told()) B.frame(m);
      for (const m of present) { A.frame(m); B.frame(m); }
      rebuilt += before.length; restores += 1; if (before.length > largest) largest = before.length;
    }
    for (const m of frames) { A.frame(m); B?.frame(m); }
    now = step * 1000 / tickHz;
    const stats = A.core.stats; const cut = stats.ticksCut; const held = stats.held;
    A.tickNow();
    units += A.core.stats.tickUnits;
    for (const [name, tick, input, before, after, geometry] of movesToCheck.splice(0)) {
      const kind = c.kinds.find(k => k.name === name);
      moveTick = tick; moveGeometry = geometry ?? c.map;
      const result = L.P.stepMove(kind.move, before, input, moveCtx.get(name), Math.max(1, Math.floor(budget / 4)), kind.motion, c.dims,
        error => { fault ??= `${siteOf(name, 'move')} ${name}.move: prediction failed: ${error.message}.${when()}`; });
      units += result.used;
      const r = kind.body.radius, height = kind.body.height || 2 * r, bounds = c.map.bounds;
      result.pos = L.P.vec3({ x: Math.max(bounds.min.x + r, Math.min(bounds.max.x - r, result.pos.x)), y: Math.max(bounds.min.y + r, Math.min(bounds.max.y - r, result.pos.y)), z: c.dims === 3 ? Math.max(bounds.min.z, Math.min(bounds.max.z - height, result.pos.z)) : 0 }, c.dims);
      delete result.used;
      if (JSON.stringify(result) !== JSON.stringify(after)) fault ??= `${siteOf(name, 'move')} ${name}.move: prediction and the server produced different bodies from the same input.${when()}`;
    }
    if (A.core.stats.tickUnits > peak) peak = A.core.stats.tickUnits;
    if (A.core.stats.maxUnits > most) { most = A.core.stats.maxUnits; worst = A.core.stats.worst; }
    const facts = A.facts();
    if (!fault && facts.faults) fault = `${here()}: the runtime itself failed: ${facts.lastFault}.${when()}`;
    if (!fault && A.core.stats.ticksCut > cut) {
      // No handler was stopped: the handlers of this tick together used all of it. The one that used the most is named.
      const [kind, handler] = (A.core.stats.worst || 'room.start').split(/\.(.*)/s);
      fault = `${siteOf(kind, handler)} ${shown(kind, handler)}: this tick used its whole budget of ${budget} units, so handlers were left unrun; this handler used the most (${A.core.stats.maxUnits} units in one call). Bound the work of each tick, or keep fewer entities and less state.${when()}`;
    }
    if (!fault && A.core.stats.held > held) fault = heldBack();
    saved = null;
    if (B && !fault) {
      B.tickNow();
      units += B.core.stats.tickUnits;
      saved = A.save(); const other = B.save();
      if (!same(saved, other)) fault = `${here()}: a room rebuilt from its save and given the same input does not play the same as the room that kept running; first difference at ${firstDifference(c, saved, other)}.${when()} Keep everything that changes in fields, motion or shared (a value kept anywhere else is not saved). If the game keeps none, the fault is in Homie's save: report the game with this message.`;
    }
    B?.stop();
  }
  const end = A.core.save();
  const size = A.save().length;
  A.stop();
  return { fault, ran, ranges, allowed: allow, companions, ticks: step, seconds: step / tickHz, rounds, restores, units, stopped, entities: end.ents.length, waiting: end.queue.length, saveBytes: size, largestSaveBytes: Math.max(largest, size), maxUnits: most, maxTickUnits: peak, worst };
}

const linked = { exports: {} };
try {
  try { L = compileFunction(`"use strict";\n${bundle}\nreturn module.exports;`, ['module', 'exports'])(linked, linked.exports); } catch (error) {
    // Thrown while the module loaded (a constant read from something absent). The guard had the line, if it got that far.
    let at = null; try { const g = linked.exports.W.G; if (g.line) at = `${g.file}:${g.line}`; } catch { /* the guard itself did not load */ }
    throw new Error(`${at ?? here()}: ${diagnostic(String(error?.message ?? error))}`);
  }
  const { c, problems } = compile();
  const result = { vocab: data.vocab, schema: L.R.schemaOf(c), publicTune: c.publicTune, settings: c.settings, problems, rounds: c.rounds, stateHash: stateHash(c),
    declarations: { events: c.events, asks: Object.fromEntries(Object.entries(c.asks).map(([n, a]) => [n, { state: a.stateFields, questions: a.questions }])), view: L.def.shapes?.view ?? {} } };
  if (declarationsOnly) parentPort.postMessage({ result });
  else {
    // The room without companions is played long, to the allowance: a full round at least, and for a typical game a
    // quarter of an hour of the room's clock. A game with companions is then played a second, short time with them
    // seated, on an eighth as much again: it is there for what companions do, not to play the match twice.
    const tickHz = c.settings.tickHz;
    const round = c.rounds?.seconds > 0 ? Math.round(c.rounds.seconds * tickHz) : 0;
    const whole = Math.min(2 * allowance.ticks, round + Math.round((c.rounds?.breakSeconds ?? 0) * tickHz) + 10 * tickHz);
    const plays = [play(c, false, { ...allowance, ticks: Math.max(allowance.ticks, whole) })];
    if (!plays[0].fault && (data.vocab || c.kinds.some((k) => k.guide && k.think))) plays.push(play(c, true, { ...allowance, ticks: allowance.companionTicks, units: Math.floor(allowance.units / 8), restoreBytes: Math.floor(allowance.restoreBytes / 8) }));
    const fault = plays.at(-1).fault;
    if (fault) throw new Error(fault);
    const sum = (key) => plays.reduce((n, p) => n + p[key], 0);
    const said = (p) => `${p.ticks} ticks (${Math.round(p.seconds)} seconds of the room's clock)${p.companions ? ' with AI companions' : ''}, ${p.rounds} ${p.rounds === 1 ? 'round' : 'rounds'} finished${!p.rounds && round > p.ticks ? ` (a round lasts ${round} ticks, longer than this play)` : ''}, the room rebuilt from its save and compared ${p.restores} times, stopped at its allowance of ${p.stopped === 'units' ? `${p.allowed.units} budget units` : `${p.allowed.ticks} ticks`}; it ended holding ${p.entities} entities and ${p.waiting} waiting events in a save of ${p.saveBytes} bytes`;
    const information = [`${here()}: the generated play covered ${plays.map(said).join('; and ')}.${allowance.full ? '' : ' `homie-studio build --long-check` plays eight times as much.'} Play it did not reach is not checked.`];
    for (const p of plays) for (const [field, row] of p.ranges) if (!information.some((line) => line.includes(` ${field} was written a whole number outside its range`))) information.push(`${row.where}: ${row.handler}: ${field} was written a whole number outside its range ${row.count} ${row.count === 1 ? 'time' : 'times'} in this play (the first: ${row.written}), and holds the nearest end of the range, as a live room does. This is information: nothing to change if the clamp is meant.`);
    for (const [kind, handler] of declared(c)) if (!plays.some((p) => p.ran.get(kind)?.has(handler))) information.push(`${siteOf(kind, handler)}: ${shown(kind, handler)} never ran in the generated play. This is information, not proof that play cannot reach it.`);
    parentPort.postMessage({ result: { ...result, information, plays: plays.map(({ ran, ranges, allowed, fault: none, ...p }) => p), ticks: sum('ticks'), roundsPlayed: sum('rounds'), restores: sum('restores'), units: sum('units'),
      maxUnits: Math.max(...plays.map((p) => p.maxUnits)), maxTickUnits: Math.max(...plays.map((p) => p.maxTickUnits)), largestSaveBytes: Math.max(...plays.map((p) => p.largestSaveBytes)) } });
  }
} catch (e) {
  // A declaration that is wrong is named by its path (`asks.bonus.floor`, `entities.runner.fields.score`): the line is where the source declares it.
  const message = String(e?.message ?? e);
  const declaration = Object.keys(sites).sort((a, b) => b.length - a.length).find((key) => message.startsWith(`${key}:`) || message.startsWith(`${key}.`) || message.startsWith(`${key} `));
  parentPort.postMessage({ error: /\.(?:ts|json)[: ]/.test(message.split('\n')[0]) ? message : `${declaration ? sites[declaration] : here()}: ${diagnostic(message)}` });
}
