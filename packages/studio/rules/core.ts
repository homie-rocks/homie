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
 * queued, in order, for the next tick. `move`, `think`, `room.join` and `room.start` always run; once the tick's
 * budget is gone each of them is given a small share and no more (`floor`, below). So a tick's worst case is the
 * budget, the one quarter its last handler may run over it, and half a budget of small shares in a room full of
 * bodies: a budget and three quarters, however many bodies there are.
 *
 * WHAT COMES BACK FROM RULES (pack.ts, "THE BOUNDARY"). Nothing the rules hand over is used as it is. A handler's
 * return value, every argument of a `world` call and everything written to a field, a list, `motion`, an event or an
 * effect is read through pack.ts, which runs no code of the rules, cannot throw and does a bounded amount of work, and
 * that work is charged to the handler before it is done (`COPY`). All of it happens inside `run()`: inside the try
 * that catches what a handler throws, and inside its budget. Nothing of the rules' is touched after `run()` returns.
 * So stored state is always plain frozen data of its declared shape, a query hands it out with no copy, and a
 * handler that wants to change a list in place is handed a copy of its own (paid for when it first reads the field)
 * that is held to its shape, and paid for, before the handler's budget is closed.
 * =============================================================================
 */
import { BudgetError, G, brand, charge, deepFreeze } from './guard.ts';
import { SKIN, castMap, exact, math, rayCircle, sweepMap } from './math.ts';
import type { Hit } from './math.ts';
import { AHEAD, ZERO, coerce, coerceFields, dir, est, estFields, initFields, mutable, num, own, packEntity, packFields, packVec, packed, said, thaw, unpackFields, unpackVec, vec3 } from './pack.ts';
import { ENTITY_MAX, QUEUE_MAX, REACH_M, cellsOf } from './rules.ts';
import type { Compiled, Field, FieldList, KindTable, Vec3 } from './rules.ts';

/*
 * WHAT THE RUNTIME'S OWN WORK COSTS, in budget units, beside the table of section 10. Each was set from a measurement
 * (rooms-slice-1-notes.md, "The budget, measured"): no call does more than about 12 ns of work for a unit it charges,
 * so a tick that uses all of `budget.tick` takes a known time.
 */
/** One value read while a value is held to its declared shape, or copied for a handler to change in place. */
export const COPY = 6;
/** One entity handed out by a query (`world.near`, `world.inBox`), and one more unit for each field it declares. */
export const VIEW = 16;
/** One number, bit, ref or text written to a field. A vector written (a field, `vel`, `heading`) is four values read: `4 * COPY`. */
export const SET = 3;
/** One value packed into the tick's snapshot: the whole public state is sent every tick, and the tick that sends it pays. */
export const SNAP = 4;
/** The most area events (`world.sendArea`) one tick takes. */
export const AREAS_MAX = 64;
/** The most ids `world.sweep`'s `ignore` reads. */
export const IGNORE_MAX = 16;
/** The most values a game's own answer to `world.ask` holds. */
export const ANSWER_MAX = 256;

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
const NO_SPOTS: readonly Vec3[] = Object.freeze([]);
/** A list, map or struct a handler was handed a copy of: where it is stored, and the copy to hold to its shape when the handler ends. */
interface Touched { bag: Record<string, unknown>; name: string; fd: Field; work: Record<string, unknown>; shared: boolean }

/** How many values a stored list, map or struct holds now: what copying it for a handler costs. */
function sizeOf(fd: Field, v: unknown): number {
  if (fd.t === 'list') return 1 + (v as unknown[]).length * cellsOf(fd.of as Field);
  if (fd.t === 'map') return 1 + Object.keys(v as object).length * (1 + cellsOf(fd.of as Field));
  return cellsOf(fd);
}
/** What a handler threw, as a line for the log, with nothing of the thrown value run to make it. */
function errorText(error: unknown): string {
  if (typeof error === 'string') return error.slice(0, 200);
  const m = error instanceof Error ? own(error, 'message') : undefined;
  return typeof m === 'string' ? m.slice(0, 200) : 'a handler threw a value that is not an Error';
}
/** Plain data with no declared shape (a game's own answer to `world.ask`): numbers, short texts, true, false, lists and objects of them, a few levels deep and `left.n` values at most. Nothing of the value is run, and anything else is null. */
function plainData(v: unknown, left: { n: number }, depth = 0): unknown {
  left.n -= 1;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean' || v === null) return v;
  if (typeof v === 'string') return v.slice(0, 256);
  if (typeof v !== 'object' || depth >= 4 || left.n <= 0) return null;
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length && left.n > 0; i += 1) out.push(plainData(own(v, i), left, depth + 1));
    return Object.freeze(out);
  }
  const out: Record<string, unknown> = {};
  let seen = 0;
  for (const key in v) {
    // Keys are counted as they are met, so an object with very many is left after the first few.
    if ((seen += 1) > 64 || left.n <= 0) break;
    if (Object.hasOwn(v, key) && key.length <= 32 && !REFUSED.has(key)) out[key] = plainData(own(v, key), left, depth + 1);
  }
  return Object.freeze(out);
}
const REFUSED: ReadonlySet<string> = new Set(['constructor', 'prototype', '__proto__']);


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
  /**
   * `failing`: the handler the budget last stopped. `lost`: area events dropped because the room's queue was full.
   * `tickUnits`: what the last tick used, the state it sends included.
   */
  stats: { handlers: number; errors: number; budgetStops: number; skipped: number; ticksCut: number; maxUnits: number; worst: string; lastError: string; failing: string; lost: number; tickUnits: number; maxTickUnits: number };
}

export function createCore(c: Compiled, opts: { seed?: number; epoch?: number; restore?: SavedCore | null; stage?: string } = {}): Core {
  if (c.dims !== 2) throw new Error('this release runs rules with space.dims: 2; bodies with height (dims: 3) arrive in a later one');
  const dims = c.dims;
  const tickHz = c.settings.tickHz;
  const dt = 1 / tickHz;
  const quarter = Math.max(1, Math.floor(c.settings.budget.tick / 4));
  /** What `move`, `think`, `join` and `start` are given each once the tick's budget is gone: all of them together, in a full room, use half a budget more. */
  const floor = Math.max(1, Math.floor(c.settings.budget.tick / (4 * ENTITY_MAX)));
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
  /** Raised by every write to `shared`, so the frozen record handed out of room scope is made again only then. */
  let sharedVer = 0;
  let sharedROVer = -1;
  const sharedChanged = (): void => { sharedDirty = true; sharedVer += 1; };
  let out: CoreOut[] = [];
  let fx: [number, unknown, unknown][] = [];
  /** What is left of the running tick's budget. A room's first `room.start` runs before any tick, with a whole one. */
  let left = c.settings.budget.tick;
  let trips = 0;
  let cut = false;
  let cx: Ctx = { scope: 'none', ent: null };
  const stats = { handlers: 0, errors: 0, budgetStops: 0, skipped: 0, ticksCut: 0, maxUnits: 0, worst: '', lastError: '', failing: '', lost: 0, tickUnits: 0, maxTickUnits: 0 };
  /** The lists, maps and structs the running handler was handed copies of. */
  let touched: Touched[] = [];
  /** Events set aside while phase 3 delivers, so the queue's cap counts them. */
  let aside = 0;
  /** What the last snapshot packed, in values: the next tick is charged for it before any handler runs. */
  let snapCells = 0;
  let stateHeavy = false;
  const viewCost = new Map<KindTable, number>();
  for (const k of c.kinds) viewCost.set(k, VIEW + k.fields.length + k.motion.length);
  const mapShapes = 4 + c.map.boxes.length + c.map.circles.length;

  const ticks = (seconds: unknown): number => { const s = num(seconds); const n = Math.round(s * tickHz); return s > 0 && Number.isFinite(n) ? Math.max(1, n) : 0; };
  const V = (v: unknown): Vec3 => vec3(v, dims);

  /* ---------------------------------------------------------------- self: what a handler may write */

  /**
   * The writable face of a record of declared fields (an entity's fields, its `motion`, `shared` in room scope). A
   * number, a text or a vector is held to its type as it is written. A list, a map or a struct is stored frozen: the
   * first read in a handler makes a copy the handler may change in place, charged by what the stored value holds, and
   * `settle` holds that copy to its declaration when the handler ends.
   */
  function typed(bag: Record<string, unknown>, list: FieldList, target: object, isShared = false): void {
    const work: Record<string, unknown> = {};
    for (const [name, fd] of list) {
      if (!mutable(fd)) {
        const cost = cellsOf(fd) === 1 ? SET : COPY * cellsOf(fd);
        Object.defineProperty(target, name, { get: () => bag[name], set: (v) => { charge(cost); bag[name] = coerce(fd, v, dims); if (isShared) sharedChanged(); }, enumerable: true });
        continue;
      }
      Object.defineProperty(target, name, {
        get: () => {
          let w = work[name];
          if (w === undefined) {
            charge(COPY * sizeOf(fd, bag[name]));
            w = work[name] = thaw(fd, bag[name]);
            touched.push({ bag, name, fd, work, shared: isShared });
          }
          return w;
        },
        set: (v) => { charge(COPY * est(fd, v)); bag[name] = coerce(fd, v, dims); work[name] = undefined; if (isShared) sharedChanged(); },
        enumerable: true,
      });
    }
  }
  /**
   * The end of a handler: every list, map and struct it was handed a copy of is held to its declaration and stored,
   * frozen. This is the handler's own work, so it is charged to it first, by the size of the copy as it now is. A
   * copy the handler cannot pay for is dropped with every one after it, and the field keeps what it held before.
   */
  function settle(): void {
    const list = touched;
    if (!list.length) return;
    touched = [];
    let i = 0;
    try {
      for (; i < list.length; i += 1) {
        const p = list[i];
        const w = p.work[p.name];
        if (w === undefined) continue;   // assigned whole after it was read: the assignment stored it
        charge(COPY * est(p.fd, w));
        p.bag[p.name] = coerce(p.fd, w, dims);
        p.work[p.name] = undefined;
        if (p.shared) sharedChanged();
      }
    } finally {
      for (; i < list.length; i += 1) list[i].work[list[i].name] = undefined;
    }
  }
  function makeSelf(e: Ent): void {
    const ro = (get: () => unknown): PropertyDescriptor => ({ get, enumerable: true });
    const mself = {};
    typed(e.m, e.kind.motion, mself);
    Object.preventExtensions(mself);
    const self = {};
    Object.defineProperties(self, {
      id: ro(() => e.id), kind: ro(() => e.kind.name), pos: ro(() => e.pos), grounded: ro(() => e.grounded), motion: ro(() => mself), input: ro(() => e.input),
      vel: { get: () => e.vel, set: (v) => { charge(4 * COPY); e.vel = V(v); }, enumerable: true },
      heading: { get: () => e.heading, set: (v) => { charge(4 * COPY); e.heading = dir(v, dims); }, enumerable: true },
    });
    if (e.kind.player) Object.defineProperties(self, { seat: ro(() => e.seat), owner: ro(() => e.owner), driver: ro(() => e.driver), away: ro(() => e.away), goal: ro(() => e.goal) });
    typed(e.f, e.kind.fields, self);
    Object.preventExtensions(self);
    e.self = self; e.mself = mself;
  }
  /**
   * An entity as a query hands it out: a frozen record of what it holds. Stored state is frozen already, so this
   * copies no value, only names them: its cost is the number of fields, whatever their size (`viewCost`).
   */
  function viewOf(e: Ent): Readonly<Record<string, unknown>> {
    const o: Record<string, unknown> = { id: e.id, kind: e.kind.name, pos: e.pos, vel: e.vel, heading: e.heading, grounded: e.grounded };
    if (e.kind.player) { o.seat = e.seat; o.owner = e.owner; o.driver = e.driver; o.away = e.away; }
    for (const [name] of e.kind.fields) o[name] = e.f[name];
    const m: Record<string, unknown> = {};
    for (const [name] of e.kind.motion) m[name] = e.m[name];
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

  /**
   * One handler, under the budget. `fn` is everything that touches what the rules hand back: the call itself and the
   * reading of its result. Whatever is thrown in it, by the rules or by the runtime's own reading, is caught here,
   * counted against this handler and goes no further; the lists it changed in place are settled inside the same
   * budget; and the counter and the scope are put back whatever happens. Nothing of the rules' is touched after this
   * returns.
   */
  function run(kind: string, handler: string, ent: Ent | null, scope: Ctx['scope'], fn: () => void, always = false): boolean {
    if (left <= 0) {
      cut = true;
      if (!always) { stats.skipped += 1; return false; }
    }
    // A handler that runs is given a whole quarter, as the design has it: the tick ends early once the budget is used,
    // so its last handler may take it one quarter over, and no handler is cut short for running late in a busy tick.
    const quota = left > 0 ? quarter : floor;
    const before = cx;
    cx = { scope, ent };
    G.left = quota;
    try {
      try { fn(); } catch (error) { failed(kind, handler, error); }
      try { settle(); } catch (error) { failed(kind, handler, error); }
    } finally {
      const used = quota - (G.left > 0 ? G.left : 0);
      G.left = Infinity;
      cx = before;
      touched = [];
      left -= used;
      stats.handlers += 1;
      if (used > stats.maxUnits) { stats.maxUnits = used; stats.worst = `${kind}.${handler}`; }
    }
    return true;
  }
  let failing: { kind: string; handler: string } = { kind: '', handler: '' };
  function failed(kind: string, handler: string, error: unknown): void {
    stats.errors += 1;
    stats.lastError = `${kind}.${handler}: ${errorText(error)}`;
    if (error instanceof BudgetError) { stats.budgetStops += 1; cut = true; failing = { kind, handler }; stats.failing = `${kind}.${handler}`; }
  }

  /* ---------------------------------------------------------------- world: all that rules are handed */

  const need = (scope: Ctx['scope'], what: string): void => { if (cx.scope !== scope) throw new Error(`${what} is for ${scope === 'room' ? 'room scope (room.start and room.on handlers)' : 'an entity\'s own handlers'}`); };
  const mine = (self: unknown, what: string): Ent => {
    if (cx.scope !== 'ent' || !cx.ent || self !== cx.ent.self) throw new Error(`${what} takes the entity the handler runs for (self): a handler changes only its own entity`);
    return cx.ent;
  };
  /** The data of an event, a command or an effect, held to its declared shape: charged by what it holds, then read, then frozen. */
  const shapeData = (table: Record<string, FieldList>, name: unknown, what: string, data: unknown): Readonly<Record<string, unknown>> => {
    const shape = typeof name === 'string' && Object.hasOwn(table, name) ? table[name] : null;
    if (!shape) throw new Error(`${what} "${said(name)}" is not declared in shapes`);
    charge(COPY * estFields(shape, data));
    return Object.freeze(coerceFields(shape, data, dims));
  };
  const sender = (): { from: number; fromId: string } => (cx.ent ? { from: cx.ent.n, fromId: cx.ent.id } : { from: 0, fromId: '' });
  /** One event or timer onto the queue. A handler's send past the room's cap throws in that handler; the runtime's own (`own`: a round turning, an answer) is always taken. */
  const push = (item: Omit<Item, 'seq' | 'from' | 'fromId'> & { from?: number; fromId?: string }, runtimes = false): void => {
    if (!runtimes && queue.length + aside >= QUEUE_MAX) throw new Error(`this room already holds ${QUEUE_MAX} events and timers that are waiting: send fewer, or set fewer timers that are far off`);
    const s = item.from === undefined ? sender() : { from: item.from, fromId: item.fromId ?? '' };
    queue.push({ ...item, ...s, seq } as Item); seq += 1;
  };
  const reach = (r: unknown, what: string): number => {
    const n = num(r);
    if (!(n >= 0) || n > REACH_M) throw new Error(`${what} reaches ${REACH_M} m at most`);
    return n;
  };
  const kindFilter = (kind: unknown): KindTable | null => {
    if (kind === undefined || kind === null) return null;
    const k = typeof kind === 'string' && Object.hasOwn(c.kindOf, kind) ? c.kindOf[kind] : null;
    if (!k) throw new Error(`no kind "${said(kind)}" is declared in entities`);
    return k;
  };
  const mapApi = brand(Object.freeze({
    name: c.map.name,
    spot: (name: unknown): Vec3 | undefined => (typeof name === 'string' && Object.hasOwn(c.map.spots, name) ? c.map.spots[name][0] : undefined),
    spots: (name: unknown): readonly Vec3[] => (typeof name === 'string' && Object.hasOwn(c.map.spots, name) ? c.map.spots[name] : NO_SPOTS),
  }));
  let roundApi: Readonly<Record<string, unknown>> = Object.freeze({});
  const refreshRound = (): void => {
    roundApi = brand(Object.freeze({ n: round.n, phase: round.phase, endsAt: round.endsAt, end: (): void => { need('room', 'world.round.end()'); endAsked = true; } }));
  };
  refreshRound();
  /** `world.shared`: in room scope the writable face of the stored record, held to its types as it is written; everywhere else a frozen record of the same stored values. */
  const sharedBag: Record<string, unknown> = {};
  const sharedRW = {};
  for (const [name] of c.shared) Object.defineProperty(sharedBag, name, { get: () => shared[name], set: (v) => { shared[name] = v; }, enumerable: true });
  typed(sharedBag, c.shared, sharedRW, true);
  Object.preventExtensions(sharedRW);
  const sharedView = (): Readonly<Record<string, unknown>> => {
    if (cx.scope === 'room') return sharedRW;
    if (sharedROVer !== sharedVer) { sharedRO = Object.freeze({ ...shared }); sharedROVer = sharedVer; }
    return sharedRO;
  };

  const world = brand({} as Record<string, unknown>);
  const getters: Record<string, () => unknown> = {
    tick: () => tick, dt: () => dt, round: () => roundApi, shared: sharedView, level: () => policy.level, levelMax: () => policy.levelMax,
    stage: () => stage, tune: () => c.tune, math: () => math, map: () => mapApi,
  };
  for (const [name, get] of Object.entries(getters)) Object.defineProperty(world, name, { get, enumerable: true });
  Object.assign(world, {
    ticks: (seconds: unknown): number => { charge(1); return ticks(seconds); },
    random: (): number => {
      charge(1);
      // mulberry32: the whole of the dice is one 32-bit number, which is room state.
      rng = (rng + 0x6d2b79f5) >>> 0;
      let x = rng;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    },
    send: (target: unknown, ev: unknown, data?: unknown): void => {
      charge(10);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.send is for handlers');
      push({ due: tick + 1, to: typeof target === 'string' ? target.slice(0, 24) : '', kind: 'ev', ev: ev as string, data: shapeData(c.events, ev, 'the event', data), at: tick });
    },
    sendRoom: (ev: unknown, data?: unknown): void => {
      charge(10);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.sendRoom is for handlers');
      push({ due: tick + 1, to: '', kind: 'room', ev: ev as string, data: shapeData(c.events, ev, 'the event', data), at: tick });
    },
    announce: (ev: unknown, data?: unknown): void => {
      charge(10);
      need('room', 'world.announce');
      push({ due: tick + 1, to: '', kind: 'all', ev: ev as string, data: shapeData(c.events, ev, 'the event', data), at: tick });
    },
    sendArea: (shape: unknown, ev: unknown, data?: unknown): void => {
      // Charged for every entity the room may hold when the area is settled at the end of this tick: those here, and those spawned and not yet in.
      charge(20 + 2 * (ents.size + spawns.length));
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.sendArea is for handlers');
      if (areas.length >= AREAS_MAX) throw new Error(`a tick takes ${AREAS_MAX} area events at most`);
      const sphere = own(shape, 'sphere'); const box = own(shape, 'box'); const cone = own(shape, 'cone');
      let area: unknown = null;
      if (sphere) area = { k: 's', at: V(own(sphere, 'at')), r: reach(own(sphere, 'r'), 'an area') };
      else if (box) area = { k: 'b', min: V(own(box, 'min')), max: V(own(box, 'max')) };
      else if (cone) area = { k: 'c', at: V(own(cone, 'at')), dir: dir(own(cone, 'dir'), dims), r: reach(own(cone, 'r'), 'an area'), half: Math.max(0, Math.min(math.PI, num(own(cone, 'angle')) / 2 || 0)) };
      if (!area) throw new Error('world.sendArea takes { sphere: { at, r } }, { box: { min, max } } or { cone: { at, dir, r, angle } }');
      areas.push({ ...sender(), seq, shape: area, ev: ev as string, data: shapeData(c.events, ev, 'the event', data) }); seq += 1;
    },
    after: (n: unknown, ev: unknown, data?: unknown): void => {
      charge(10);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.after is for handlers');
      const w = Math.round(num(n));
      const wait = w >= 1 ? Math.min(w, 0x7fffffff) : 1;
      push({ due: tick + wait, to: cx.ent ? cx.ent.id : '', kind: cx.ent ? 'ev' : 'room', ev: ev as string, data: shapeData(c.events, ev, 'the event', data), at: tick });
    },
    emit: (effect: unknown, at: unknown, data?: unknown): void => {
      charge(10);
      const i = typeof effect === 'string' ? c.effectNames.indexOf(effect) : -1;
      if (i < 0) throw new Error(`the effect "${said(effect)}" is not declared in shapes.effects`);
      if (fx.length >= 256) return;
      const shape = c.effects[c.effectNames[i]];
      fx.push([i, typeof at === 'string' ? at.slice(0, 24) : packVec(V(at), dims), packFields(shape, shapeData(c.effects, effect, 'the effect', data), dims)]);
    },
    spawn: (kind: unknown, at: unknown, fields?: unknown): string => {
      charge(10);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.spawn is for handlers');
      const k = kindFilter(kind);
      if (!k) throw new Error('world.spawn(kind, at, fields) names the kind of entity to make');
      if (k.player) throw new Error(`a "${k.name}" is a player's body: it comes from room.join when a seat is taken, never from world.spawn`);
      charge(COPY * (estFields(k.fields, fields) + k.motion.length));
      const e = makeEnt(k, at, 'spawn', { fields });
      spawns.push(e);
      return e.id;
    },
    despawn: (self: unknown): void => {
      const e = mine(self, 'world.despawn');
      if (e.kind.player) throw new Error('a player\'s body leaves when its seat is given up, never by world.despawn');
      e.dead = true;
      ents.delete(e.id);
    },
    place: (self: unknown, at: unknown, o?: unknown): void => {
      charge(10 + 12 * COPY);
      const e = mine(self, 'world.place');
      const vel = own(o, 'vel'); const heading = own(o, 'heading');
      e.pos = clampIn(V(at), e.kind.body?.radius ?? 0);
      e.vel = vel !== undefined ? V(vel) : ZERO;
      if (heading !== undefined) e.heading = dir(heading, dims);
      e.r = (e.r + 1) & 0xffff;
      e.allow = 0;
    },
    near: (pos: unknown, r: unknown, kind?: unknown): readonly unknown[] => {
      charge(20 + 2 * ents.size);
      const p = V(pos); const R = reach(r, 'world.near'); const k = kindFilter(kind);
      const found: { d: number; e: Ent }[] = [];
      let cost = 0;
      for (const e of ents.values()) {
        if (k && e.kind !== k) continue;
        const dx = e.pos.x - p.x; const dy = e.pos.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= R * R) { found.push({ d: d2, e }); cost += viewCost.get(e.kind) as number; }
      }
      // Sorting them and handing each out is charged before either is done.
      charge(cost);
      found.sort((a, b) => a.d - b.d || a.e.n - b.e.n);
      return Object.freeze(found.map((x) => viewOf(x.e)));
    },
    inBox: (box: unknown, kind?: unknown): readonly unknown[] => {
      charge(20 + 2 * ents.size);
      const min = V(own(box, 'min')); const max = V(own(box, 'max')); const k = kindFilter(kind);
      if (max.x - min.x > 2 * REACH_M || max.y - min.y > 2 * REACH_M) throw new Error(`world.inBox reaches ${REACH_M} m from its centre at most`);
      const found: Ent[] = [];
      let cost = 0;
      for (const e of ents.values()) if ((!k || e.kind === k) && e.pos.x >= min.x && e.pos.x <= max.x && e.pos.y >= min.y && e.pos.y <= max.y) { found.push(e); cost += viewCost.get(e.kind) as number; }
      charge(cost);
      return Object.freeze(found.map(viewOf));
    },
    ray: (from: unknown, direction: unknown, max: unknown): unknown => {
      // Charged before the cast, for every shape it may test: the map's, and every entity in the room.
      charge(20 + 4 * (mapShapes + ents.size));
      const p = V(from); const d = dir(direction, dims); const far = reach(max, 'world.ray');
      const cast = castMap(c.map, p.x, p.y, d.x * far, d.y * far, 0);
      let best: Hit | null = cast.hit;
      for (const e of ents.values()) {
        if (!e.kind.body || e === cx.ent) continue;
        const h = rayCircle(p.x, p.y, d.x * far, d.y * far, e.pos.x, e.pos.y, e.kind.body.radius);
        if (h && (!best || h.t < best.t)) best = { ...h, id: e.id };
      }
      if (!best) return undefined;
      return Object.freeze({ ...(best.id ? { entity: best.id } : {}), at: V({ x: p.x + d.x * far * best.t, y: p.y + d.y * far * best.t, z: 0 }), normal: V({ x: best.nx, y: best.ny, z: 0 }), dist: far * best.t });
    },
    sweep: (self: unknown, delta: unknown, o?: unknown): unknown => {
      const e = mine(self, 'world.sweep');
      charge(20 + 4 * (mapShapes + ents.size));
      const d = V(delta);
      const radius = e.kind.body?.radius ?? 0;
      const cast = castMap(c.map, e.pos.x, e.pos.y, d.x, d.y, radius);
      let best: Hit | null = cast.hit;
      // The ids to pass through: the first few of a list, read as plain texts. A longer list is not searched once for every entity.
      const list = own(o, 'ignore');
      const ignore = new Set<string>();
      if (Array.isArray(list)) for (let i = 0; i < list.length && i < IGNORE_MAX; i += 1) { const id = own(list, i); if (typeof id === 'string') ignore.add(id); }
      for (const other of ents.values()) {
        if (other === e || !other.kind.body || ignore.has(other.id)) continue;
        const h = rayCircle(e.pos.x, e.pos.y, d.x, d.y, other.pos.x, other.pos.y, other.kind.body.radius + radius);
        if (h && (!best || h.t < best.t)) best = { ...h, id: other.id };
      }
      const l = Math.sqrt(d.x * d.x + d.y * d.y);
      const t = best ? (l > 0 ? Math.max(0, best.t - SKIN / l) : 0) : 1;
      e.pos = V({ x: e.pos.x + d.x * t, y: e.pos.y + d.y * t, z: 0 });
      e.grounded = true;
      return best ? Object.freeze({ ...(best.id ? { entity: best.id } : {}), at: e.pos, normal: V({ x: best.nx, y: best.ny, z: 0 }) }) : undefined;
    },
    ask: (name: unknown, state?: unknown): boolean => {
      // Charged for the search of the queue below, and for reading the answer: both before they are done.
      charge(10 + (queue.length >> 2) + 2 * ANSWER_MAX);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.ask is for handlers');
      const a = typeof name === 'string' && Object.hasOwn(c.asks, name) ? c.asks[name] : null;
      if (!a) throw new Error(`no ask "${said(name)}" is declared in asks`);
      const who = cx.ent ? cx.ent.id : '';
      if (queue.some((q) => q.ev === 'answer' && q.to === who && (q.data as { ask?: string })?.ask === name)) return false;
      charge(COPY * estFields(a.stateFields, state));
      // The game's own floor answers on the next tick. The studio's decision model answers from the release that puts AI decisions on the server.
      // What it returns has no declared shape, so it is read as plain data of a bounded size, with nothing of it run.
      const picks = plainData(a.floor(deepFreeze(coerceFields(a.stateFields, state, dims))) ?? {}, { n: ANSWER_MAX });
      push({ due: tick + 1, to: who, kind: cx.ent ? 'ev' : 'room', ev: 'answer', data: Object.freeze({ ask: name, by: 'floor', picks, why: 'off' }), at: tick, builtIn: true }, true);
      return true;
    },
    goalDone: (_ok?: boolean): void => { if (cx.ent) cx.ent.goal = null; },
    finish: (): void => { need('room', 'world.finish()'); finishing = true; },
  });
  Object.freeze(world);

  const moveMap = brand(Object.freeze({ name: c.map.name, spot: mapApi.spot, spots: mapApi.spots, sweep: (body: unknown, delta: unknown): unknown => sweepMap(c.map, body, delta, moveRadius, dims) }));
  let moveRadius = 0;
  const moveCtx = brand({} as Record<string, unknown>);
  for (const [name, get] of Object.entries({ tick: () => tick, dt: () => dt, tune: () => c.publicTune, math: () => math, map: () => moveMap })) Object.defineProperty(moveCtx, name, { get, enumerable: true });
  Object.assign(moveCtx, { ticks: (seconds: unknown): number => { charge(1); return ticks(seconds); } });
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
  const announce = (ev: string, data: unknown, due: number): void => push({ due, to: '', kind: 'all', ev, data, at: tick, builtIn: true, from: 0, fromId: '' }, true);

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
      // What room.join returns is read by its own data properties, and its fields are charged before they are held to their shapes.
      const j: unknown = (c.join as NonNullable<Compiled['join']>)(joinCtx, player);
      const name = own(j, 'kind');
      const k = typeof name === 'string' && Object.hasOwn(c.kindOf, name) ? c.kindOf[name] : null;
      if (!k || !k.player) throw new Error('room.join returns { kind, at } with the kind of a player\'s body');
      const fields = own(j, 'fields'); const motion = own(j, 'motion');
      charge(COPY * (estFields(k.fields, fields) + estFields(k.motion, motion)));
      made = makeEnt(k, own(j, 'at'), 'join', { fields, motion, heading: own(j, 'heading') }, info);
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
    shared = initFields(c.shared, dims); sharedChanged();
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
    // The tick pays first for the state it sends: what the last snapshot packed. A room that holds more than a tick can send has nothing left for its handlers, and ends as any room does whose budget trips on every tick.
    left = c.settings.budget.tick - SNAP * snapCells;
    cut = false;
    // When sending the state takes more than half of a tick's budget, that is what a cut tick is put down to.
    stateHeavy = 2 * SNAP * snapCells > c.settings.budget.tick;
    if (left <= 0) cut = true;
    // Phase 0: rounds, seats, bots, arrivals.
    turnRounds();
    if (playing) {
      applyOps();
      fillBots();
      for (const e of [...ents.values()]) {
        if (e.arrived || e.dead) continue;
        const fn = e.kind.on.arrive;
        // With the tick's budget gone it has not arrived: it waits, doing nothing, and arrives on a later tick.
        if (fn && !run(e.kind.name, 'on.arrive', e, 'ent', () => fn(world, e.self, Object.freeze({ why: e.why })))) continue;
        e.arrived = true;
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
            // `think` returns the step. It is held to the declared input inside the handler's own try and budget; a `think` that throws leaves the input neutral.
            let stepIn: Record<string, unknown> | null = null;
            run(k.name, 'think', e, 'ent', () => {
              const back: unknown = (k.think as NonNullable<KindTable['think']>)(world, e.self);
              charge(COPY * k.input.length);
              stepIn = coerceFields(k.input, back, dims);
            }, true);
            e.input = Object.freeze(stepIn ?? initFields(k.input, dims));
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
        // `b` is the runtime's own object: what `move` left in it is read by its own data properties and cannot throw.
        e.pos = clampIn(V(own(b, 'pos')), body.radius); e.vel = V(own(b, 'vel')); e.heading = dir(own(b, 'heading'), dims); e.grounded = own(b, 'grounded') === true;
      }
      // Phase 2: for every entity, its commands and then its tick, starting from a different entity each tick.
      const list = [...ents.values()];
      for (let i = 0; i < list.length; i += 1) {
        const e = list[(i + tick) % list.length];
        // An entity whose `arrive` is still waiting for budget does nothing yet.
        if (e.dead || !e.arrived) continue;
        if (e.cmds.length) {
          const cmds = e.cmds; e.cmds = [];
          for (let j = 0; j < cmds.length; j += 1) {
            const cmd = cmds[j];
            const fn = e.kind.commands[cmd.name];
            if (!fn || e.dead) continue;
            // With the tick's budget gone a command is not lost: it and the ones behind it wait for the next tick.
            if (!run(e.kind.name, `commands.${cmd.name}`, e, 'ent', () => fn(world, e.self, cmd.data))) { e.cmds = cmds.slice(j); break; }
          }
        }
        if (e.kind.tick && !e.dead) run(e.kind.name, 'tick', e, 'ent', () => (e.kind.tick as NonNullable<KindTable['tick']>)(world, e.self));
      }
      // Phase 3: the events and timers that are due, in a fixed order (sender, then sequence), then spawns.
      const due = queue.filter((q) => q.due <= tick).sort((a, b) => a.due - b.due || a.from - b.from || a.seq - b.seq);
      if (due.length) {
        const later = queue.filter((q) => q.due > tick);
        queue = [];
        // Set aside while they are delivered, and still counted against the queue's cap.
        aside = due.length + later.length;
        let stopped = -1;
        try { for (let i = 0; i < due.length; i += 1) { if (!deliver(due[i])) { stopped = i; break; } } } finally {
          // What the budget left unrun stays queued, in order, ahead of what handlers sent meanwhile.
          queue = [...(stopped >= 0 ? due.slice(stopped) : []), ...later, ...queue];
          aside = 0;
        }
      }
      for (const e of spawns) { e.born = tick; ents.set(e.id, e); }
      spawns = [];
      // Who is inside an area is decided at the end of the tick it was sent in; delivery is on the next. A full queue takes no more, and what it could not take is counted.
      for (const a of areas) for (const e of ents.values()) if (inArea(a.shape, e.pos)) { if (queue.length >= QUEUE_MAX) stats.lost += 1; else queue.push({ due: tick + 1, from: a.from, fromId: a.fromId, seq: a.seq, to: e.id, kind: 'ev', ev: a.ev, data: a.data, at: tick }); }
      areas = [];
      if (finishing) finishMatch();
    }
    if (fx.length) { out.push({ t: 'fx', tick, list: fx }); fx = []; }
    if (sharedDirty) { sharedDirty = false; out.push({ t: 'shared' }); }
    stats.tickUnits = c.settings.budget.tick - left;
    if (stats.tickUnits > stats.maxTickUnits) stats.maxTickUnits = stats.tickUnits;
    if (cut) {
      if (stateHeavy) { failing = { kind: 'room', handler: 'state (the room holds more than a tick can send)' }; stats.failing = `${failing.kind}.${failing.handler}`; }
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
    shared = unpackFields(c.shared, r.shared, dims); sharedChanged();
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
    snapshot: () => {
      packed.n = 0;
      const list = [...ents.values()].map((e) => packEntity(e.kind, e, dims));
      // Ten values an entity for what every entity carries (its id, its place, its velocity and heading), and one for each value of its fields.
      snapCells = packed.n + 10 * list.length;
      return [[round.n, round.phase === 'live' ? 1 : 0, round.endsAt], list];
    },
    shared: () => packFields(c.shared, shared, dims),
    bodies: () => playerBodies().map((e) => ({ seat: e.seat, id: e.id, kind: e.kind.name, driver: e.driver, owner: e.owner, away: e.away, score: e.kind.score ? Number(e.f[e.kind.score]) || 0 : 0, r: e.r })),
    bodyOf: (seat) => { const s = seats.get(seat); const e = s?.id ? ents.get(s.id) : null; return e ? { id: e.id, kind: e.kind, r: e.r, away: e.away, driver: e.driver } : null; },
    drain: () => { const o = out; out = []; return o; },
    save,
    world,
    stats,
  };
}
