/*
 * core.ts — one room's world, stepped a tick at a time from a compiled rules module.
 * =============================================================================
 *
 * The core is the part of the host runtime that knows the rules contract and nothing else: no socket, no clock, no
 * storage. `createCore(compiled)` makes a room; `step(inputs)` runs one tick; `snapshot()` is the room's public
 * state, packed; `save()` is everything a room is, so `createCore(compiled, { restore })` carries on from it. The host
 * runtime (host.ts) drives it on the room's clock and plays the host's part on the wire. The same core runs inside the
 * `Table`, in Node for the build check, and (from the release that adds browser-hosted rules) in a browser.
 *
 * ONE TICK (rooms-milestone-1-design.md, section 3.5), in four phases:
 *   0  rounds turn, seat changes take effect and room scope hears of them, bots fill, every new entity runs `arrive`
 *   1  one input step and `move` for every body (`think` supplies the step for a body no person is driving)
 *   2  for every entity, its commands and then its `tick`; it starts from a different entity each tick
 *   3  the events and timers that are due, then spawns
 *
 * WHO MAY WRITE WHAT. A handler is handed `self`, an object whose own fields, `motion`, `vel` and `heading` are
 * writable (each write is held to its declared type as it is made) and whose other built-ins are read-only. Query
 * results and event data are frozen copies. `world.shared` is writable in room scope and a frozen copy elsewhere.
 * `world` and everything reachable from it is plain frozen data and functions made here: nothing of the `Table`, its
 * storage, its `env` or the relay is reachable through it.
 *
 * THE BUDGET (section 10, guard.ts). Before each handler the core sets the guard's counter to a quarter of
 * `budget.tick`, or what is left of the tick when that is less. A handler that uses it all is abandoned, as one that
 * throws is. When a tick has used all of `budget.tick`, handlers not yet run are skipped and events not yet run stay
 * queued, in order, for the next tick. `move` always runs for every body.
 * =============================================================================
 */
import { BudgetError, G, brand, charge, deepFreeze } from './guard.ts';
import { SKIN, castMap, exact, math, rayCircle, sweepMap } from './math.ts';
import type { Hit } from './math.ts';
import { AHEAD, ZERO, coerce, coerceFields, dir, initFields, mutable, packEntity, packFields, packVec, unpackFields, unpackVec, vec3 } from './pack.ts';
import { ENTITY_MAX, REACH_M } from './rules.ts';
import type { Compiled, FieldList, KindTable, Vec3 } from './rules.ts';

export type Driver = 'person' | 'bot' | 'ai';
export interface SeatInfo { seat: number; driver: Driver; owner: string }
/** One seat's step for a tick: its input values (already held to their types) and, for an owner-moved body, its claim. */
export interface StepInput { values: Record<string, unknown>; claim?: { pos: Vec3; vel: Vec3; heading: Vec3; r: number } | null }
export interface ResultRow { seat: number; id: string; driver: Driver; score: number; place: number }
export type CoreOut =
  | { t: 'round'; n: number; phase: 'live' | 'over'; endsAt: number; startedAt: number; results?: ResultRow[] }
  | { t: 'fx'; tick: number; list: [number, unknown, unknown][] }
  | { t: 'seats' }
  | { t: 'shared' }
  | { t: 'epoch'; epoch: number }
  | { t: 'fail'; why: 'budget'; kind: string; handler: string };
export interface CorePolicy { bots: 'fill' | 'off'; level: number; levelMax: number }
export interface Body { seat: number; id: string; kind: string; driver: Driver; owner: string; away: boolean; score: number; r: number }

interface Ent {
  id: string; n: number; kind: KindTable; pos: Vec3; vel: Vec3; heading: Vec3; grounded: boolean;
  /** The placement counter: raised whenever the runtime or a handler puts the body somewhere at once. */
  r: number; born: number; arrived: boolean; why: 'join' | 'spawn'; dead: boolean;
  f: Record<string, unknown>; m: Record<string, unknown>;
  seat: number; owner: string; driver: Driver; away: boolean; goal: unknown;
  input: Readonly<Record<string, unknown>>;
  /** Owner movement: the distance this body's claims may still cover (it grows by a tick of `maxSpeed` every tick). */
  allow: number;
  cmds: { name: string; data: unknown }[];
  self: Record<string, unknown>; mself: Record<string, unknown>;
}
interface Item { due: number; from: number; fromId: string; seq: number; to: string; kind: 'ev' | 'room' | 'all'; ev: string; data: unknown; at: number; builtIn?: boolean }
interface Seat { seat: number; driver: Driver; owner: string; id: string | null; away: boolean }
interface Ctx { scope: 'none' | 'ent' | 'room' | 'join' | 'move'; ent: Ent | null }


/* ------------------------------------------------------------------ the saved room */

/** Everything a room is, as plain JSON (pack.ts `toBytes` makes it bytes). The shape is this runtime's own and may change between releases. */
export interface SavedCore {
  v: 1; tick: number; epoch: number; rng: number; nextId: number; seq: number;
  round: [number, number, number, number]; overAt: number; match: [number, number]; trips: number;
  shared: unknown[]; policy: CorePolicy;
  ents: unknown[][]; spawns: unknown[][]; seats: [number, string, string, string | null, number][]; queue: unknown[][]; areas: unknown[][]; ops: unknown[];
}

export interface Core {
  readonly tick: number;
  readonly epoch: number;
  step(inputs?: ReadonlyMap<number, StepInput>): void;
  seatJoin(info: SeatInfo): void;
  seatAway(seat: number, away: boolean): void;
  seatLeave(seat: number): void;
  setPolicy(p: Partial<CorePolicy>): void;
  command(seat: number, name: string, data: unknown): boolean;
  /** The room's public state, packed: `[[n, phase, endsAt], entities]`. */
  snapshot(): unknown[];
  shared(): unknown[];
  bodies(): Body[];
  /** The body in a seat, as the host runtime needs it for the input protocol. */
  bodyOf(seat: number): { id: string; kind: KindTable; r: number; away: boolean; driver: Driver } | null;
  /** What happened since the last call: rounds, effects, a changed roster, changed shared state, a new epoch, a failure. */
  drain(): CoreOut[];
  save(): SavedCore;
  /** The `world` object rules are handed (a test walks it to prove nothing else is reachable). */
  readonly world: object;
  stats: { handlers: number; errors: number; budgetStops: number; skipped: number; ticksCut: number; maxUnits: number; worst: string; lastError: string };
}

export function createCore(c: Compiled, opts: { seed?: number; epoch?: number; restore?: SavedCore | null; stage?: string } = {}): Core {
  if (c.dims !== 2) throw new Error('this release runs rules with space.dims: 2; bodies with height (dims: 3) arrive in a later one');
  const dims = c.dims;
  const tickHz = c.settings.tickHz;
  const dt = 1 / tickHz;
  const quarter = Math.max(1, Math.floor(c.settings.budget.tick / 4));
  const stage = String(opts.stage ?? '');

  let tick = 0;
  let epoch = (opts.epoch ?? 1) >>> 0;
  let rng = (opts.seed ?? 1) >>> 0;
  let nextId = 1;
  let seq = 1;
  const ents = new Map<string, Ent>();
  let spawns: Ent[] = [];
  const seats = new Map<number, Seat>();
  let queue: Item[] = [];
  let areas: { from: number; fromId: string; seq: number; shape: any; ev: string; data: unknown }[] = [];
  let ops: ({ op: 'join'; info: SeatInfo } | { op: 'away'; seat: number; away: boolean } | { op: 'leave'; seat: number })[] = [];
  let round = { n: 0, phase: 'over' as 'live' | 'over', endsAt: 0, startedAt: 0 };
  /** The tick a round's time was up (its results follow two ticks later), or 0. */
  let overAt = 0;
  /** 1: a match is running. 0: between matches (after `world.finish()`), until the tick in `restartAt`. */
  let playing = 1;
  let restartAt = 0;
  let finishing = false;
  let endAsked = false;
  let policy: CorePolicy = { bots: 'fill', level: 3, levelMax: 5 };
  let shared: Record<string, unknown> = initFields(c.shared, dims);
  let sharedRO: Readonly<Record<string, unknown>> = Object.freeze({});
  let sharedDirty = true;
  let out: CoreOut[] = [];
  let fx: [number, unknown, unknown][] = [];
  let left = 0;
  let trips = 0;
  let cut = false;
  let cx: Ctx = { scope: 'none', ent: null };
  const stats = { handlers: 0, errors: 0, budgetStops: 0, skipped: 0, ticksCut: 0, maxUnits: 0, worst: '', lastError: '' };
  const mutF = new Map<KindTable, { f: FieldList; m: FieldList }>();
  for (const k of c.kinds) mutF.set(k, { f: k.fields.filter(([, fd]) => mutable(fd)), m: k.motion.filter(([, fd]) => mutable(fd)) });
  const sharedMut = c.shared.filter(([, fd]) => mutable(fd));

  const ticks = (seconds: number): number => { const n = Math.round(Number(seconds) * tickHz); return Number(seconds) > 0 ? Math.max(1, n) : 0; };
  const V = (v: unknown): Vec3 => vec3(v, dims);

  /* ---------------------------------------------------------------- self: what a handler may write */

  function makeSelf(e: Ent): void {
    const ro = (get: () => unknown): PropertyDescriptor => ({ get, enumerable: true });
    const typed = (bag: Record<string, unknown>, list: FieldList, target: object): void => {
      for (const [name, fd] of list) Object.defineProperty(target, name, { get: () => bag[name], set: (v) => { bag[name] = coerce(fd, v, dims); }, enumerable: true });
    };
    const mself = {};
    typed(e.m, e.kind.motion, mself);
    Object.preventExtensions(mself);
    const self = {};
    Object.defineProperties(self, {
      id: ro(() => e.id), kind: ro(() => e.kind.name), pos: ro(() => e.pos), grounded: ro(() => e.grounded), motion: ro(() => mself), input: ro(() => e.input),
      vel: { get: () => e.vel, set: (v) => { e.vel = V(v); }, enumerable: true },
      heading: { get: () => e.heading, set: (v) => { e.heading = dir(v, dims); }, enumerable: true },
    });
    if (e.kind.player) Object.defineProperties(self, { seat: ro(() => e.seat), owner: ro(() => e.owner), driver: ro(() => e.driver), away: ro(() => e.away), goal: ro(() => e.goal) });
    typed(e.f, e.kind.fields, self);
    Object.preventExtensions(self);
    e.self = self; e.mself = mself;
  }
  /** After a handler: lists, maps and structs it changed in place are held to their declarations again. */
  function settle(e: Ent): void {
    const mm = mutF.get(e.kind) as { f: FieldList; m: FieldList };
    for (const [name, fd] of mm.f) e.f[name] = coerce(fd, e.f[name], dims);
    for (const [name, fd] of mm.m) e.m[name] = coerce(fd, e.m[name], dims);
  }
  /** A frozen copy of an entity, for a query result. */
  function viewOf(e: Ent): Readonly<Record<string, unknown>> {
    const o: Record<string, unknown> = { id: e.id, kind: e.kind.name, pos: e.pos, vel: e.vel, heading: e.heading, grounded: e.grounded };
    if (e.kind.player) { o.seat = e.seat; o.owner = e.owner; o.driver = e.driver; o.away = e.away; }
    for (const [name, fd] of e.kind.fields) o[name] = mutable(fd) ? deepFreeze(coerce(fd, e.f[name], dims)) : e.f[name];
    const m: Record<string, unknown> = {};
    for (const [name, fd] of e.kind.motion) m[name] = mutable(fd) ? deepFreeze(coerce(fd, e.m[name], dims)) : e.m[name];
    o.motion = Object.freeze(m);
    return Object.freeze(o);
  }

  function makeEnt(kind: KindTable, at: unknown, why: 'join' | 'spawn', init: { fields?: unknown; motion?: unknown; heading?: unknown } = {}, player: SeatInfo | null = null): Ent {
    if (ents.size + spawns.length >= ENTITY_MAX) throw new Error(`a room holds at most ${ENTITY_MAX} entities`);
    const n = nextId; nextId += 1;
    const e: Ent = {
      id: `e${n.toString(36)}`, n, kind, pos: clampIn(V(at), kind.body?.radius ?? 0), vel: ZERO, heading: init.heading === undefined ? AHEAD : dir(init.heading, dims), grounded: true,
      r: 0, born: tick, arrived: false, why, dead: false,
      f: coerceFields(kind.fields, init.fields, dims), m: coerceFields(kind.motion, init.motion, dims),
      seat: player ? player.seat : -1, owner: player ? player.owner : '', driver: player ? player.driver : 'bot', away: false, goal: null,
      input: Object.freeze(initFields(kind.input, dims)), allow: 0, cmds: [], self: {}, mself: {},
    };
    makeSelf(e);
    return e;
  }
  function clampIn(p: Vec3, r: number): Vec3 {
    const b = c.map.bounds;
    const x = Math.max(b.min.x + r, Math.min(b.max.x - r, p.x)); const y = Math.max(b.min.y + r, Math.min(b.max.y - r, p.y));
    return x === p.x && y === p.y ? p : V({ x, y, z: p.z });
  }

  /* ---------------------------------------------------------------- running a handler under the budget */

  function run(kind: string, handler: string, ent: Ent | null, scope: Ctx['scope'], fn: () => void, always = false): boolean {
    if (!always && left <= 0) { stats.skipped += 1; cut = true; return false; }
    const quota = always ? quarter : Math.min(quarter, left);
    const before = cx;
    cx = { scope, ent };
    G.left = quota;
    try { fn(); } catch (error) {
      stats.errors += 1;
      stats.lastError = `${kind}.${handler}: ${String((error as Error)?.message ?? error).slice(0, 200)}`;
      if (error instanceof BudgetError) { stats.budgetStops += 1; cut = true; failing = { kind, handler }; }
    }
    const used = quota - Math.max(G.left, 0);
    G.left = Infinity;
    cx = before;
    left -= used;
    stats.handlers += 1;
    if (used > stats.maxUnits) { stats.maxUnits = used; stats.worst = `${kind}.${handler}`; }
    if (ent && !ent.dead) settle(ent);
    if (scope === 'room') { for (const [name, fd] of sharedMut) shared[name] = coerce(fd, shared[name], dims); if (sharedDirty) sharedRO = Object.freeze({}); }
    return true;
  }
  let failing: { kind: string; handler: string } = { kind: '', handler: '' };

  /* ---------------------------------------------------------------- world: all that rules are handed */

  const need = (scope: Ctx['scope'], what: string): void => { if (cx.scope !== scope) throw new Error(`${what} is for ${scope === 'room' ? 'room scope (room.start and room.on handlers)' : 'an entity\'s own handlers'}`); };
  const own = (self: unknown, what: string): Ent => {
    if (cx.scope !== 'ent' || !cx.ent || self !== cx.ent.self) throw new Error(`${what} takes the entity the handler runs for (self): a handler changes only its own entity`);
    return cx.ent;
  };
  const shapeData = (table: Record<string, FieldList>, name: unknown, what: string, data: unknown): unknown => {
    const shape = typeof name === 'string' && Object.hasOwn(table, name) ? table[name] : null;
    if (!shape) throw new Error(`${what} "${String(name).slice(0, 40)}" is not declared in shapes`);
    return deepFreeze(coerceFields(shape, data, dims));
  };
  const sender = (): { from: number; fromId: string } => (cx.ent ? { from: cx.ent.n, fromId: cx.ent.id } : { from: 0, fromId: '' });
  const push = (item: Omit<Item, 'seq' | 'from' | 'fromId'> & { from?: number; fromId?: string }): void => {
    const s = item.from === undefined ? sender() : { from: item.from, fromId: item.fromId ?? '' };
    queue.push({ ...item, ...s, seq } as Item); seq += 1;
  };
  const reach = (r: unknown, what: string): number => {
    const n = Number(r);
    if (!(n >= 0) || n > REACH_M) throw new Error(`${what} reaches ${REACH_M} m at most`);
    return n;
  };
  const kindFilter = (kind: unknown): KindTable | null => {
    if (kind === undefined || kind === null) return null;
    const k = typeof kind === 'string' && Object.hasOwn(c.kindOf, kind) ? c.kindOf[kind] : null;
    if (!k) throw new Error(`no kind "${String(kind).slice(0, 40)}" is declared in entities`);
    return k;
  };
  const mapApi = brand(Object.freeze({
    name: c.map.name,
    spot: (name: string): Vec3 | undefined => (Object.hasOwn(c.map.spots, name) ? c.map.spots[name][0] : undefined),
    spots: (name: string): readonly Vec3[] => (Object.hasOwn(c.map.spots, name) ? c.map.spots[name] : Object.freeze([])),
  }));
  let roundApi: Readonly<Record<string, unknown>> = Object.freeze({});
  const refreshRound = (): void => {
    roundApi = brand(Object.freeze({ n: round.n, phase: round.phase, endsAt: round.endsAt, end: (): void => { need('room', 'world.round.end()'); endAsked = true; } }));
  };
  refreshRound();
  const sharedRW = {};
  for (const [name, fd] of c.shared) Object.defineProperty(sharedRW, name, { get: () => shared[name], set: (v) => { shared[name] = coerce(fd, v, dims); sharedDirty = true; }, enumerable: true });
  Object.preventExtensions(sharedRW);
  const sharedView = (): Readonly<Record<string, unknown>> => {
    if (cx.scope === 'room') { if (sharedMut.length) sharedDirty = true; return sharedRW; }
    if (!Object.isFrozen(sharedRO) || Object.keys(sharedRO).length !== c.shared.length) sharedRO = deepFreeze(coerceFields(c.shared, shared, dims)) as Readonly<Record<string, unknown>>;
    return sharedRO;
  };

  const world = brand({} as Record<string, unknown>);
  const getters: Record<string, () => unknown> = {
    tick: () => tick, dt: () => dt, round: () => roundApi, shared: sharedView, level: () => policy.level, levelMax: () => policy.levelMax,
    stage: () => stage, tune: () => c.tune, math: () => math, map: () => mapApi,
  };
  for (const [name, get] of Object.entries(getters)) Object.defineProperty(world, name, { get, enumerable: true });
  Object.assign(world, {
    ticks: (seconds: number): number => { charge(1); return ticks(seconds); },
    random: (): number => {
      charge(1);
      // mulberry32: the whole of the dice is one 32-bit number, which is room state.
      rng = (rng + 0x6d2b79f5) >>> 0;
      let x = rng;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    },
    send: (target: unknown, ev: string, data?: unknown): void => {
      charge(10);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.send is for handlers');
      push({ due: tick + 1, to: typeof target === 'string' ? target : '', kind: 'ev', ev, data: shapeData(c.events, ev, 'the event', data), at: tick });
    },
    sendRoom: (ev: string, data?: unknown): void => {
      charge(10);
      push({ due: tick + 1, to: '', kind: 'room', ev, data: shapeData(c.events, ev, 'the event', data), at: tick });
    },
    announce: (ev: string, data?: unknown): void => {
      charge(10);
      need('room', 'world.announce');
      push({ due: tick + 1, to: '', kind: 'all', ev, data: shapeData(c.events, ev, 'the event', data), at: tick });
    },
    sendArea: (shape: unknown, ev: string, data?: unknown): void => {
      charge(20 + 2 * ents.size);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.sendArea is for handlers');
      const s = shape as Record<string, any> | null;
      let area: unknown = null;
      if (s?.sphere) area = { k: 's', at: V(s.sphere.at), r: reach(s.sphere.r, 'an area') };
      else if (s?.box) area = { k: 'b', min: V(s.box.min), max: V(s.box.max) };
      else if (s?.cone) area = { k: 'c', at: V(s.cone.at), dir: dir(s.cone.dir, dims), r: reach(s.cone.r, 'an area'), half: Math.max(0, Math.min(math.PI, Number(s.cone.angle) / 2 || 0)) };
      if (!area) throw new Error('world.sendArea takes { sphere: { at, r } }, { box: { min, max } } or { cone: { at, dir, r, angle } }');
      areas.push({ ...sender(), seq, shape: area, ev, data: shapeData(c.events, ev, 'the event', data) }); seq += 1;
    },
    after: (n: unknown, ev: string, data?: unknown): void => {
      charge(10);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.after is for handlers');
      const wait = Math.max(1, Math.round(Number(n)) || 1);
      push({ due: tick + wait, to: cx.ent ? cx.ent.id : '', kind: cx.ent ? 'ev' : 'room', ev, data: shapeData(c.events, ev, 'the event', data), at: tick });
    },
    emit: (effect: string, at: unknown, data?: unknown): void => {
      charge(10);
      const i = c.effectNames.indexOf(effect);
      if (i < 0) throw new Error(`the effect "${String(effect).slice(0, 40)}" is not declared in shapes.effects`);
      if (fx.length >= 256) return;
      fx.push([i, typeof at === 'string' ? at : packVec(V(at), dims), packFields(c.effects[effect], coerceFields(c.effects[effect], data, dims), dims)]);
    },
    spawn: (kind: string, at: unknown, fields?: unknown): string => {
      charge(10);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.spawn is for handlers');
      const k = kindFilter(kind) as KindTable;
      if (k.player) throw new Error(`a "${k.name}" is a player's body: it comes from room.join when a seat is taken, never from world.spawn`);
      const e = makeEnt(k, at, 'spawn', { fields });
      spawns.push(e);
      return e.id;
    },
    despawn: (self: unknown): void => {
      const e = own(self, 'world.despawn');
      if (e.kind.player) throw new Error('a player\'s body leaves when its seat is given up, never by world.despawn');
      e.dead = true;
      ents.delete(e.id);
    },
    place: (self: unknown, at: unknown, o?: { vel?: unknown; heading?: unknown }): void => {
      charge(10);
      const e = own(self, 'world.place');
      e.pos = clampIn(V(at), e.kind.body?.radius ?? 0);
      e.vel = o && o.vel !== undefined ? V(o.vel) : ZERO;
      if (o && o.heading !== undefined) e.heading = dir(o.heading, dims);
      e.r = (e.r + 1) & 0xffff;
      e.allow = 0;
    },
    near: (pos: unknown, r: unknown, kind?: unknown): readonly unknown[] => {
      charge(20 + 2 * ents.size);
      const p = V(pos); const R = reach(r, 'world.near'); const k = kindFilter(kind);
      const found: { d: number; e: Ent }[] = [];
      for (const e of ents.values()) {
        if (k && e.kind !== k) continue;
        const dx = e.pos.x - p.x; const dy = e.pos.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= R * R) found.push({ d: d2, e });
      }
      found.sort((a, b) => a.d - b.d || a.e.n - b.e.n);
      return Object.freeze(found.map((x) => viewOf(x.e)));
    },
    inBox: (box: unknown, kind?: unknown): readonly unknown[] => {
      charge(20 + 2 * ents.size);
      const b = box as { min?: unknown; max?: unknown } | null;
      const min = V(b?.min); const max = V(b?.max); const k = kindFilter(kind);
      if (max.x - min.x > 2 * REACH_M || max.y - min.y > 2 * REACH_M) throw new Error(`world.inBox reaches ${REACH_M} m from its centre at most`);
      const found: Ent[] = [];
      for (const e of ents.values()) if ((!k || e.kind === k) && e.pos.x >= min.x && e.pos.x <= max.x && e.pos.y >= min.y && e.pos.y <= max.y) found.push(e);
      return Object.freeze(found.map(viewOf));
    },
    ray: (from: unknown, direction: unknown, max: unknown): unknown => {
      const p = V(from); const d = dir(direction, dims); const far = reach(max, 'world.ray');
      const cast = castMap(c.map, p.x, p.y, d.x * far, d.y * far, 0);
      let best: Hit | null = cast.hit;
      let tested = cast.tested;
      for (const e of ents.values()) {
        if (!e.kind.body || e === cx.ent) continue;
        tested += 1;
        const h = rayCircle(p.x, p.y, d.x * far, d.y * far, e.pos.x, e.pos.y, e.kind.body.radius);
        if (h && (!best || h.t < best.t)) best = { ...h, id: e.id };
      }
      charge(20 + 4 * tested);
      if (!best) return undefined;
      return Object.freeze({ ...(best.id ? { entity: best.id } : {}), at: V({ x: p.x + d.x * far * best.t, y: p.y + d.y * far * best.t, z: 0 }), normal: V({ x: best.nx, y: best.ny, z: 0 }), dist: far * best.t });
    },
    sweep: (self: unknown, delta: unknown, o?: { ignore?: unknown }): unknown => {
      const e = own(self, 'world.sweep');
      const d = V(delta);
      const radius = e.kind.body?.radius ?? 0;
      const cast = castMap(c.map, e.pos.x, e.pos.y, d.x, d.y, radius);
      let best: Hit | null = cast.hit;
      let tested = cast.tested;
      const ignore = Array.isArray(o?.ignore) ? o.ignore as unknown[] : [];
      for (const other of ents.values()) {
        if (other === e || !other.kind.body || ignore.includes(other.id)) continue;
        tested += 1;
        const h = rayCircle(e.pos.x, e.pos.y, d.x, d.y, other.pos.x, other.pos.y, other.kind.body.radius + radius);
        if (h && (!best || h.t < best.t)) best = { ...h, id: other.id };
      }
      charge(20 + 4 * tested);
      const l = Math.sqrt(d.x * d.x + d.y * d.y);
      const t = best ? (l > 0 ? Math.max(0, best.t - SKIN / l) : 0) : 1;
      e.pos = V({ x: e.pos.x + d.x * t, y: e.pos.y + d.y * t, z: 0 });
      e.grounded = true;
      return best ? Object.freeze({ ...(best.id ? { entity: best.id } : {}), at: e.pos, normal: V({ x: best.nx, y: best.ny, z: 0 }) }) : undefined;
    },
    ask: (name: string, state?: unknown): boolean => {
      charge(10);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.ask is for handlers');
      const a = typeof name === 'string' && Object.hasOwn(c.asks, name) ? c.asks[name] : null;
      if (!a) throw new Error(`no ask "${String(name).slice(0, 40)}" is declared in asks`);
      const who = cx.ent ? cx.ent.id : '';
      if (queue.some((q) => q.ev === 'answer' && q.to === who && (q.data as { ask?: string })?.ask === name)) return false;
      // The game's own floor answers on the next tick. The studio's decision model answers from the release that puts AI decisions on the server.
      const picks = a.floor(deepFreeze(coerceFields(a.stateFields, state, dims)));
      push({ due: tick + 1, to: who, kind: cx.ent ? 'ev' : 'room', ev: 'answer', data: deepFreeze({ ask: name, by: 'floor', picks: JSON.parse(JSON.stringify(picks ?? {})), why: 'off' }), at: tick, builtIn: true });
      return true;
    },
    goalDone: (_ok?: boolean): void => { if (cx.ent) cx.ent.goal = null; },
    finish: (): void => { need('room', 'world.finish()'); finishing = true; },
  });
  Object.freeze(world);

  const moveMap = brand(Object.freeze({ name: c.map.name, spot: mapApi.spot, spots: mapApi.spots, sweep: (body: any, delta: unknown): unknown => sweepMap(c.map, body, delta, moveRadius, dims) }));
  let moveRadius = 0;
  const moveCtx = brand({} as Record<string, unknown>);
  for (const [name, get] of Object.entries({ tick: () => tick, dt: () => dt, tune: () => c.publicTune, math: () => math, map: () => moveMap })) Object.defineProperty(moveCtx, name, { get, enumerable: true });
  Object.assign(moveCtx, { ticks: (seconds: number): number => { charge(1); return ticks(seconds); } });
  Object.freeze(moveCtx);
  const joinCtx = brand({} as Record<string, unknown>);
  for (const [name, get] of Object.entries({ map: () => mapApi, shared: sharedView, tune: () => c.tune, math: () => math, round: () => roundApi })) Object.defineProperty(joinCtx, name, { get, enumerable: true });
  Object.freeze(joinCtx);

  /* ---------------------------------------------------------------- events */

  const roomEvent = (ev: string, data: unknown): void => {
    const fn = c.roomOn[ev];
    if (fn) run('room', `on.${ev}`, null, 'room', () => fn(world, data));
  };
  function deliver(item: Item): boolean {
    if (item.kind === 'room') {
      const fn = c.roomOn[item.ev];
      return fn ? run('room', `on.${item.ev}`, null, 'room', () => fn(world, item.data)) : true;
    }
    if (item.kind === 'all') {
      if (item.builtIn) { const fn = c.roomOn[item.ev]; if (fn && !run('room', `on.${item.ev}`, null, 'room', () => fn(world, item.data))) return false; }
      for (const e of [...ents.values()]) {
        const fn = e.kind.onRoom[item.ev];
        // An announcement made before an entity existed never reaches it.
        if (!fn || e.dead || e.born > item.at) continue;
        run(e.kind.name, `onRoom.${item.ev}`, e, 'ent', () => fn(world, e.self, item.data));
      }
      return true;
    }
    const e = ents.get(item.to);
    if (!e || e.dead) {
      // Undeliverable: the sender hears of it, if it declares a handler. Otherwise the event is dropped.
      const back = deepFreeze({ event: item.ev, data: item.data, to: item.to });
      const from = item.fromId ? ents.get(item.fromId) : null;
      if (from && from.kind.on.undeliverable) run(from.kind.name, 'on.undeliverable', from, 'ent', () => from.kind.on.undeliverable(world, from.self, back));
      else if (!item.fromId && c.roomOn.undeliverable) run('room', 'on.undeliverable', null, 'room', () => c.roomOn.undeliverable(world, back));
      return true;
    }
    const fn = e.kind.on[item.ev];
    return fn ? run(e.kind.name, `on.${item.ev}`, e, 'ent', () => fn(world, e.self, item.data)) : true;
  }
  const announce = (ev: string, data: unknown, due: number): void => push({ due, to: '', kind: 'all', ev, data, at: tick, builtIn: true, from: 0, fromId: '' });

  /* ---------------------------------------------------------------- seats, bots and rounds */

  const playerBodies = (): Ent[] => [...ents.values()].filter((e) => e.kind.player);
  function results(): ResultRow[] {
    const rows = playerBodies().map((e) => ({ seat: e.seat, id: e.id, driver: e.driver, score: e.kind.score ? Number(e.f[e.kind.score]) || 0 : 0, place: 0 }));
    rows.sort((a, b) => b.score - a.score || a.seat - b.seat);
    // Ties share a place (NETPLAY.md section 26): 1, 1, 3.
    rows.forEach((r, i) => { r.place = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].place : i + 1; });
    return rows;
  }
  function joinBody(info: SeatInfo): Ent | null {
    const player = Object.freeze({ seat: info.seat, driver: info.driver, owner: info.owner });
    let made: Ent | null = null;
    run('room', 'join', null, 'join', () => {
      const j = (c.join as NonNullable<Compiled['join']>)(joinCtx, player);
      const k = j && typeof j.kind === 'string' && Object.hasOwn(c.kindOf, j.kind) ? c.kindOf[j.kind] : null;
      if (!k || !k.player) throw new Error('room.join returns { kind, at } with the kind of a player\'s body');
      made = makeEnt(k, j.at, 'join', { fields: j.fields, motion: j.motion, heading: j.heading }, info);
    }, true);
    const e = made as Ent | null;
    if (!e) return null;
    ents.set(e.id, e);
    seats.set(info.seat, { seat: info.seat, driver: info.driver, owner: info.owner, id: e.id, away: false });
    return e;
  }
  function leaveBody(s: Seat): void {
    const e = s.id ? ents.get(s.id) : null;
    if (e && e.kind.player?.leave === 'bot') {
      e.driver = 'bot'; e.owner = ''; e.away = false;
      s.driver = 'bot'; s.owner = ''; s.away = false;
    } else {
      if (e) {
        if (e.kind.on.leave) run(e.kind.name, 'on.leave', e, 'ent', () => e.kind.on.leave(world, e.self, Object.freeze({})));
        e.dead = true; ents.delete(e.id);
      }
      seats.delete(s.seat);
    }
    out.push({ t: 'seats' });
    roomEvent('seatLeft', Object.freeze({ seat: s.seat, id: e ? e.id : '' }));
  }
  function applyOps(): void {
    const list = ops; ops = [];
    for (const op of list) {
      if (op.op === 'away') {
        const s = seats.get(op.seat);
        const e = s?.id ? ents.get(s.id) : null;
        if (!s || !e || s.driver === 'bot' || s.away === op.away) continue;
        s.away = op.away; e.away = op.away;
        // Back at the wheel: the browser starts from where the server has the body.
        if (!op.away) { e.r = (e.r + 1) & 0xffff; e.allow = 0; }
        out.push({ t: 'seats' });
        roomEvent('seatAway', Object.freeze({ seat: s.seat, id: e.id, away: op.away }));
      } else if (op.op === 'leave') {
        const s = seats.get(op.seat);
        if (s && s.driver !== 'bot') leaveBody(s);
      } else {
        const info = op.info;
        let s = seats.get(info.seat);
        if (s && s.driver !== 'bot' && s.owner === info.owner && s.id && ents.has(s.id)) {
          // The same holder again (a reconnect the relay did not report as a return).
          if (s.away) { ops.unshift({ op: 'away', seat: info.seat, away: false }); applyOps(); }
          continue;
        }
        // The seat changed hands without a goodbye: its old holder has left.
        if (s && s.driver !== 'bot') { leaveBody(s); s = seats.get(info.seat); }
        let bot: Ent | null = s && s.id ? ents.get(s.id) ?? null : null;
        if (!bot && playerBodies().length >= c.bots) {
          // A person who joins a full room takes over a bot's body: the bot in the highest seat.
          for (const e of playerBodies()) if (e.driver === 'bot' && (!bot || e.seat > bot.seat)) bot = e;
        }
        if (bot) {
          const e = bot;
          seats.delete(e.seat);
          e.seat = info.seat; e.driver = info.driver; e.owner = info.owner; e.away = false; e.r = (e.r + 1) & 0xffff; e.allow = 0;
          seats.set(info.seat, { seat: info.seat, driver: info.driver, owner: info.owner, id: e.id, away: false });
          out.push({ t: 'seats' });
          roomEvent('seatJoined', Object.freeze({ seat: info.seat, id: e.id, driver: info.driver, owner: info.owner, took: true }));
          if (e.kind.on.takeover) run(e.kind.name, 'on.takeover', e, 'ent', () => e.kind.on.takeover(world, e.self, Object.freeze({})));
        } else {
          const e = joinBody(info);
          out.push({ t: 'seats' });
          if (e) roomEvent('seatJoined', Object.freeze({ seat: info.seat, id: e.id, driver: info.driver, owner: info.owner, took: false }));
        }
      }
    }
  }
  function fillBots(): void {
    if (policy.bots !== 'fill' || !c.join) return;
    let n = playerBodies().length;
    for (let seat = c.seats - 1; seat >= 0 && n < c.bots; seat -= 1) {
      if (seats.has(seat)) continue;
      const e = joinBody({ seat, driver: 'bot', owner: '' });
      if (!e) return;
      n += 1;
      out.push({ t: 'seats' });
      roomEvent('seatJoined', Object.freeze({ seat, id: e.id, driver: 'bot', owner: '', took: false }));
    }
  }
  function startRound(): void {
    round = { n: round.n + 1, phase: 'live', endsAt: c.rounds && c.rounds.seconds > 0 ? tick + ticks(c.rounds.seconds) : 0, startedAt: tick };
    overAt = 0;
    refreshRound();
    announce('roundStart', Object.freeze({ n: round.n }), Math.max(tick, 1));
    out.push({ t: 'round', n: round.n, phase: 'live', endsAt: round.endsAt, startedAt: tick });
  }
  function endRound(): void {
    round = { ...round, phase: 'over', endsAt: tick + Math.max(3, ticks(c.rounds ? c.rounds.breakSeconds : 0)) };
    overAt = tick;
    refreshRound();
  }
  function startMatch(): void {
    playing = 1;
    round = { n: 0, phase: 'over', endsAt: 0, startedAt: tick };
    if (c.start) run('room', 'start', null, 'room', () => (c.start as NonNullable<Compiled['start']>)(world), true);
    startRound();
  }
  function turnRounds(): void {
    if (!playing) {
      if (tick < restartAt) return;
      startMatch();
      // Seats stay through a finished match: every holder's body is made again, as if it had just joined.
      for (const s of [...seats.values()]) { seats.delete(s.seat); if (s.driver !== 'bot') ops.push({ op: 'join', info: { seat: s.seat, driver: s.driver, owner: s.owner } }, ...(s.away ? [{ op: 'away' as const, seat: s.seat, away: true }] : [])); }
      return;
    }
    if (round.phase === 'live' && (endAsked || (round.endsAt > 0 && tick >= round.endsAt))) endRound();
    endAsked = false;
    if (overAt && tick >= overAt + 2) {
      // Two ticks after the time was up, so a score already on its way (two event hops) is counted.
      const rows = results();
      announce('roundOver', deepFreeze({ n: round.n, results: rows.map((r) => ({ ...r })) }), tick);
      out.push({ t: 'round', n: round.n, phase: 'over', endsAt: round.endsAt, startedAt: round.startedAt, results: rows });
      overAt = 0;
    } else if (round.phase === 'over' && !overAt && tick >= round.endsAt) startRound();
  }
  function finishMatch(): void {
    finishing = false;
    out.push({ t: 'round', n: round.n, phase: 'over', endsAt: tick + Math.max(3, ticks(c.rounds ? c.rounds.breakSeconds : 0)), startedAt: round.startedAt, results: results() });
    for (const e of ents.values()) e.dead = true;
    ents.clear(); spawns = []; queue = []; areas = []; fx = [];
    for (const s of seats.values()) s.id = null;
    shared = initFields(c.shared, dims); sharedDirty = true; sharedRO = Object.freeze({});
    epoch = (epoch + 1) >>> 0;
    playing = 0;
    restartAt = tick + Math.max(3, ticks(c.rounds ? c.rounds.breakSeconds : 0));
    round = { ...round, phase: 'over', endsAt: restartAt };
    overAt = 0;
    refreshRound();
    out.push({ t: 'epoch', epoch }, { t: 'seats' });
  }

  /* ---------------------------------------------------------------- one tick */

  function inArea(a: any, p: Vec3): boolean {
    if (a.k === 'b') return p.x >= a.min.x && p.x <= a.max.x && p.y >= a.min.y && p.y <= a.max.y;
    const dx = p.x - a.at.x; const dy = p.y - a.at.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > a.r * a.r) return false;
    if (a.k === 's' || d2 === 0) return true;
    const l = Math.sqrt(d2);
    // Inside the cone: the angle to its axis is at most half its opening, compared by cosine.
    return (dx * a.dir.x + dy * a.dir.y) / l >= exact.cos(a.half);
  }
  function step(inputs: ReadonlyMap<number, StepInput> = new Map()): void {
    tick = (tick + 1) >>> 0;
    left = c.settings.budget.tick;
    cut = false;
    // Phase 0: rounds, seats, bots, arrivals.
    turnRounds();
    if (playing) {
      applyOps();
      fillBots();
      for (const e of [...ents.values()]) {
        if (e.arrived || e.dead) continue;
        e.arrived = true;
        const fn = e.kind.on.arrive;
        if (fn) run(e.kind.name, 'on.arrive', e, 'ent', () => fn(world, e.self, Object.freeze({ why: e.why })));
      }
      // Phase 1: one input step and `move` for every body.
      for (const e of [...ents.values()]) {
        if (e.dead || !e.kind.body) continue;
        const k = e.kind;
        const body = k.body as NonNullable<KindTable['body']>;
        let claim: StepInput['claim'] = null;
        if (k.player) {
          const driven = e.driver === 'person' && !e.away;
          if (driven) {
            const s = inputs.get(e.seat);
            e.input = Object.freeze(s ? { ...s.values } : initFields(k.input, dims));
            claim = s?.claim ?? null;
          } else if (k.think && (e.driver !== 'person' || k.player.away === 'think')) {
            let stepIn: unknown = null;
            run(k.name, 'think', e, 'ent', () => { stepIn = (k.think as NonNullable<KindTable['think']>)(world, e.self); }, true);
            e.input = Object.freeze(coerceFields(k.input, stepIn, dims));
          } else e.input = Object.freeze(initFields(k.input, dims));
          if (driven && body.owner) {
            // Owner movement: the browser says where its body is, and the server holds the claim to maxSpeed.
            e.allow = Math.min(e.allow + body.maxSpeed * dt * 1.02, body.maxSpeed * 0.25 + 0.05);
            if (claim && claim.r === e.r) {
              const dx = claim.pos.x - e.pos.x; const dy = claim.pos.y - e.pos.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const go = Math.min(dist, e.allow);
              e.allow -= go;
              if (dist > 0) e.pos = clampIn(V({ x: e.pos.x + (dx / dist) * go, y: e.pos.y + (dy / dist) * go, z: 0 }), body.radius);
              const sp = Math.sqrt(claim.vel.x * claim.vel.x + claim.vel.y * claim.vel.y);
              e.vel = sp > body.maxSpeed && sp > 0 ? V({ x: (claim.vel.x / sp) * body.maxSpeed, y: (claim.vel.y / sp) * body.maxSpeed, z: 0 }) : V(claim.vel);
              e.heading = dir(claim.heading, dims);
            }
            continue;
          }
        }
        if (!k.move) continue;
        const b = { pos: e.pos, vel: e.vel, heading: e.heading, grounded: e.grounded, motion: e.mself };
        moveRadius = body.radius;
        run(k.name, 'move', e, 'move', () => (k.move as NonNullable<KindTable['move']>)(b, e.input, moveCtx), true);
        // The runtime rounds to 32-bit floats, here and in the browser, so both step from exactly the same numbers.
        e.pos = clampIn(V(b.pos), body.radius); e.vel = V(b.vel); e.heading = dir(b.heading, dims); e.grounded = b.grounded === true;
      }
      // Phase 2: for every entity, its commands and then its tick, starting from a different entity each tick.
      const list = [...ents.values()];
      for (let i = 0; i < list.length; i += 1) {
        const e = list[(i + tick) % list.length];
        if (e.dead) continue;
        if (e.cmds.length) {
          const cmds = e.cmds; e.cmds = [];
          for (const cmd of cmds) { const fn = e.kind.commands[cmd.name]; if (fn && !e.dead) run(e.kind.name, `commands.${cmd.name}`, e, 'ent', () => fn(world, e.self, cmd.data)); }
        }
        if (e.kind.tick && !e.dead) run(e.kind.name, 'tick', e, 'ent', () => (e.kind.tick as NonNullable<KindTable['tick']>)(world, e.self));
      }
      // Phase 3: the events and timers that are due, in a fixed order (sender, then sequence), then spawns.
      const due = queue.filter((q) => q.due <= tick).sort((a, b) => a.due - b.due || a.from - b.from || a.seq - b.seq);
      if (due.length) {
        const later = queue.filter((q) => q.due > tick);
        queue = [];
        let stopped = -1;
        for (let i = 0; i < due.length; i += 1) { if (!deliver(due[i])) { stopped = i; break; } }
        // What the budget left unrun stays queued, in order, ahead of what handlers sent meanwhile.
        queue = [...(stopped >= 0 ? due.slice(stopped) : []), ...later, ...queue];
      }
      for (const e of spawns) { e.born = tick; ents.set(e.id, e); }
      spawns = [];
      // Who is inside an area is decided at the end of the tick it was sent in; delivery is on the next.
      for (const a of areas) for (const e of ents.values()) if (inArea(a.shape, e.pos)) queue.push({ due: tick + 1, from: a.from, fromId: a.fromId, seq: a.seq, to: e.id, kind: 'ev', ev: a.ev, data: a.data, at: tick });
      areas = [];
      if (finishing) finishMatch();
    }
    if (fx.length) { out.push({ t: 'fx', tick, list: fx }); fx = []; }
    if (sharedDirty) { sharedDirty = false; sharedRO = Object.freeze({}); out.push({ t: 'shared' }); }
    if (cut) {
      stats.ticksCut += 1;
      trips += 1;
      // The budget tripping on every tick for two seconds: the room ends, and the log names the handler.
      if (trips === 2 * tickHz) out.push({ t: 'fail', why: 'budget', kind: failing.kind, handler: failing.handler });
    } else trips = 0;
  }

  /* ---------------------------------------------------------------- the save */

  const saveEnt = (e: Ent): unknown[] => [e.id, e.n, e.kind.index, e.r, e.born, e.arrived ? 1 : 0, e.why, packVec(e.pos, 3), packVec(e.vel, 3), packVec(e.heading, 3), e.grounded ? 1 : 0, e.seat, e.driver, e.owner, e.away ? 1 : 0, e.goal ?? null, e.allow,
    packFields(e.kind.fields, e.f, dims), packFields(e.kind.motion, e.m, dims), packFields(e.kind.input, e.input as Record<string, unknown>, dims), e.cmds];
  function loadEnt(w: any[]): Ent {
    const kind = c.kinds[w[2]];
    const e: Ent = {
      id: w[0], n: w[1], kind, r: w[3], born: w[4], arrived: w[5] === 1, why: w[6], dead: false, pos: unpackVec(w[7], 3), vel: unpackVec(w[8], 3), heading: unpackVec(w[9], 3), grounded: w[10] === 1,
      seat: w[11], driver: w[12], owner: w[13], away: w[14] === 1, goal: w[15], allow: w[16],
      f: unpackFields(kind.fields, w[17], dims), m: unpackFields(kind.motion, w[18], dims), input: Object.freeze(unpackFields(kind.input, w[19], dims)), cmds: (w[20] as { name: string; data: unknown }[]).map((x) => ({ name: x.name, data: deepFreeze(x.data) })), self: {}, mself: {},
    };
    makeSelf(e);
    return e;
  }
  function save(): SavedCore {
    return {
      v: 1, tick, epoch, rng, nextId, seq, round: [round.n, round.phase === 'live' ? 1 : 0, round.endsAt, round.startedAt], overAt, match: [playing, restartAt], trips,
      shared: packFields(c.shared, shared, dims), policy: { ...policy },
      ents: [...ents.values()].map(saveEnt), spawns: spawns.map(saveEnt),
      seats: [...seats.values()].map((s) => [s.seat, s.driver, s.owner, s.id, s.away ? 1 : 0]),
      queue: queue.map((q) => [q.due, q.from, q.fromId, q.seq, q.to, q.kind, q.ev, q.data, q.at, q.builtIn ? 1 : 0]),
      areas: areas.map((a) => [a.from, a.fromId, a.seq, a.shape, a.ev, a.data]),
      ops: JSON.parse(JSON.stringify(ops)),
    };
  }
  const r = opts.restore;
  if (r) {
    if (r.v !== 1) throw new Error('this save was written by another version of the runtime');
    tick = r.tick; epoch = r.epoch; rng = r.rng; nextId = r.nextId; seq = r.seq; overAt = r.overAt; playing = r.match[0]; restartAt = r.match[1]; trips = r.trips;
    round = { n: r.round[0], phase: r.round[1] === 1 ? 'live' : 'over', endsAt: r.round[2], startedAt: r.round[3] };
    refreshRound();
    shared = unpackFields(c.shared, r.shared, dims);
    policy = { ...r.policy };
    for (const w of r.ents) { const e = loadEnt(w as any[]); ents.set(e.id, e); }
    spawns = r.spawns.map((w) => loadEnt(w as any[]));
    for (const [seat, driver, owner, id, away] of r.seats) seats.set(seat, { seat, driver: driver as Driver, owner, id, away: away === 1 });
    queue = r.queue.map((q: any[]) => ({ due: q[0], from: q[1], fromId: q[2], seq: q[3], to: q[4], kind: q[5], ev: q[6], data: deepFreeze(q[7]), at: q[8], ...(q[9] === 1 ? { builtIn: true } : {}) }));
    areas = r.areas.map((a: any[]) => ({ from: a[0], fromId: a[1], seq: a[2], shape: a[3], ev: a[4], data: deepFreeze(a[5]) }));
    ops = r.ops as typeof ops;
  } else startMatch();

  return {
    get tick() { return tick; },
    get epoch() { return epoch; },
    step,
    seatJoin: (info) => { ops.push({ op: 'join', info: { seat: info.seat, driver: info.driver, owner: String(info.owner ?? '') } }); },
    seatAway: (seat, away) => { ops.push({ op: 'away', seat, away }); },
    seatLeave: (seat) => { ops.push({ op: 'leave', seat }); },
    setPolicy: (p) => {
      const levelMax = Math.max(1, Math.min(5, Math.floor(Number(p.levelMax ?? policy.levelMax)) || 5));
      policy = { bots: p.bots === 'off' ? 'off' : p.bots === 'fill' ? 'fill' : policy.bots, levelMax, level: Math.max(1, Math.min(levelMax, Math.floor(Number(p.level ?? policy.level)) || 3)) };
    },
    command: (seat, name, data) => {
      const s = seats.get(seat);
      const e = s?.id ? ents.get(s.id) : null;
      if (!e || typeof name !== 'string' || !Object.hasOwn(c.commands, name) || !e.kind.commands[name] || e.cmds.length >= 16) return false;
      e.cmds.push({ name, data: deepFreeze(coerceFields(c.commands[name], data, dims)) });
      return true;
    },
    snapshot: () => [[round.n, round.phase === 'live' ? 1 : 0, round.endsAt], [...ents.values()].map((e) => packEntity(e.kind, e, dims))],
    shared: () => packFields(c.shared, shared, dims),
    bodies: () => playerBodies().map((e) => ({ seat: e.seat, id: e.id, kind: e.kind.name, driver: e.driver, owner: e.owner, away: e.away, score: e.kind.score ? Number(e.f[e.kind.score]) || 0 : 0, r: e.r })),
    bodyOf: (seat) => { const s = seats.get(seat); const e = s?.id ? ents.get(s.id) : null; return e ? { id: e.id, kind: e.kind, r: e.r, away: e.away, driver: e.driver } : null; },
    drain: () => { const o = out; out = []; return o; },
    save,
    world,
    stats,
  };
}
