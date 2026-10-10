import { colliderSolid, castCollider2, colliderRow, collisionMap, collisionQueries, type CollisionRevision } from './live.ts';
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
 * queued, in order, for the next tick. `move`, `think`, `room.join` and `room.start` run all the same; once the
 * tick's budget is gone each of them is given a small share and no more (`floor`, below), and a body's `move` and
 * `think` stop being run when the tick has used half its budget again. So a tick's worst case is a budget and a half,
 * however many bodies there are and whatever they do.
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
import { castMap3, castSolid, restsOnMap, solidAt, type BodyShape, type Hit3 } from './collision.ts';
import { argsWhy, type Vocabulary } from '../agents/agents.ts';
import { BudgetError, G, brand, charge, deepFreeze, plainData } from './guard.ts';
import { SKIN, castMap, exact, math, rayCircle } from './math.ts';
import type { Hit } from './math.ts';
import { AHEAD, ZERO, coerce, coerceFields, dir, est, estFields, initFields, mutable, num, own, packEntity, packFields, packVec, packed, said, thaw, naming, unpackFields, unpackVec, vec3 } from './pack.ts';
import { ENTITY_MAX, QUEUE_MAX, REACH_M, SAVE_REVISION, cellsOf } from './rules.ts';
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
/** One event or timer put on the room's queue (`world.send`, `sendRoom`, `announce`, `after`): it is sorted and delivered on a later tick, and the sender pays for that too. */
export const SEND = 16;
/** A handler that threw: what catching it and writing it down costs the tick. */
export const THROWN = 512;
/** The most effects (`world.emit`) one tick takes. */
export const FX_MAX = 256;
/** The most area events (`world.sendArea`) one tick takes. */
export const AREAS_MAX = 64;
/** What the log names when a room ends because of what it holds, not because of a handler. */
const STATE_TOO_LARGE = 'state (the room holds more than a tick can send)';
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
  | { t: 'ask'; n: string; state: unknown; questions: Record<string, unknown> }
  | { t: 'goalDone'; seat: number; ok: boolean }
  | { t: 'seats' }
  | { t: 'shared' }
  | { t: 'epoch'; epoch: number }
  | { t: 'fail'; why: 'budget'; kind: string; handler: string };
export interface CorePolicy { kids?: boolean; levelSet?: boolean; guideLevel?: number; guideSeats?: readonly number[]; reserved?: number; bots: 'fill' | 'off'; level: number; levelMax: number }
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
interface PendingAsk { n: string; name: string; who: string; at: number; state: unknown; result?: Record<string, unknown> }
interface Seat { seat: number; driver: Driver; owner: string; id: string | null; away: boolean }
interface Ctx { scope: 'none' | 'ent' | 'room' | 'join' | 'move'; ent: Ent | null }
const NO_SPOTS: readonly Vec3[] = Object.freeze([]);
/** A list, map or struct a handler was handed a copy of: where it is stored, and the copy to hold to its shape when the handler ends. */
interface Touched { bag: Record<string, unknown>; name: string; fd: Field; work: Record<string, unknown>; shared: boolean; held: (fd: Field, v: unknown, name: string) => unknown }

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


/* ------------------------------------------------------------------ the saved room */

/** Everything a room is, as plain JSON (pack.ts `toBytes` makes it bytes). The shape is this runtime's own and may change between releases. */
export interface SavedCore {
  v: number; tick: number; epoch: number; rng: number; nextId: number; seq: number;
  round: [number, number, number, number]; overAt: number; match: [number, number]; trips: number;
  shared: unknown[]; policy: CorePolicy; intent?: [number, number];
  asks: PendingAsk[];
  guideViews: [number, Record<string, unknown>][];
  ents: unknown[][]; spawns: unknown[][]; seats: [number, string, string, string | null, number][]; queue: unknown[][]; areas: unknown[][]; ops: unknown[];
}

export interface Core {
  readonly tick: number;
  readonly epoch: number;
  step(inputs?: ReadonlyMap<number, StepInput>, guides?: () => void): void;
  guide(seat: number, floor?: unknown): Record<string, unknown> | null;
  vocabulary(value: Vocabulary | null): void;
  goal(seat: number, value?: unknown): unknown;
  answer(n: string, result: Record<string, unknown>): void;
  seatJoin(info: SeatInfo): void;
  seatAway(seat: number, away: boolean): void;
  seatLeave(seat: number): void;
  setPolicy(p: Partial<CorePolicy>): void;
  command(seat: number, name: string, data: unknown): boolean;
  /** The room's public state, packed: `[[n, phase, endsAt], entities]`. */
  snapshot(): unknown[];
  shared(): unknown[];
  /** The current round, for a host rebasing wall-clock deadlines after a pause or restore. */
  round(): Extract<CoreOut, { t: 'round' }>;
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
   * `held`: owner-moved claims cut short because they came further than `body.maxSpeed` allows.
   * `tickUnits`: what the last tick used, the state it sends included.
   */
  stats: { handlers: number; errors: number; budgetStops: number; skipped: number; ticksCut: number; maxUnits: number; worst: string; lastError: string; failing: string; lost: number; held: number; tickUnits: number; maxTickUnits: number };
}

/**
 * `observe` and `noted` are the build check's; a room passes neither, and then nothing here costs or changes anything.
 * `observe`: told of every handler as it ends, and what it threw if it threw.
 * `noted`: told, as it happens, of a value the rules wrote that the runtime changed to make it fit, or dropped (pack.ts
 * `Adjusted`; also `effect`, `think` and `decision`): the handler, what was done, the field's name and what was written.
 */
export function createCore(c: Compiled, opts: { moved?: (kind: string, tick: number, input: Readonly<Record<string, unknown>>, before: import('./pack.ts').MoveBody, after: import('./pack.ts').MoveBody, geometry: import('./math.ts').MapShapes) => void; observe?: (kind: string, handler: string, error?: string) => void; noted?: (kind: string, handler: string, what: string, at: string, written: string) => void; seed?: number; epoch?: number; restore?: SavedCore | null; restoreEpoch?: number; stage?: string; decisions?: boolean } = {}): Core {
  const dims = c.dims;
  const tickHz = c.settings.tickHz;
  const dt = 1 / tickHz;
  const quarter = Math.max(1, Math.floor(c.settings.budget.tick / 4));
  const half = Math.floor(c.settings.budget.tick / 2);
  /** What `move`, `think`, `join` and `start` are given each once the tick's budget is gone: all of them together, in a full room, use half a budget more. */
  const floor = Math.max(1, Math.floor(c.settings.budget.tick / (4 * ENTITY_MAX)));
  const stage = String(opts.stage ?? '');
  const noted = opts.noted ?? null;

  let tick = 0;
  let pendingAsks: PendingAsk[] = [];
  let epoch = opts.epoch ?? 1;
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
  let vocabulary: Vocabulary | null = null;
  const restoredGoals = new Map<number, unknown>();
  const guideViews = new Map<number, Record<string, unknown>>();
  const EMPTY_GUIDE_SEATS: readonly number[] = Object.freeze([]);
  let policy: CorePolicy = { reserved: 0, bots: 'fill', level: 3, levelMax: 5 };
  function normalizeCorePolicy(p: Partial<CorePolicy>): CorePolicy {
    const levelMax = Math.max(1, Math.min(5, Math.floor(num(own(p, 'levelMax') ?? policy.levelMax)) || 5));
    const guideSeats = Object.freeze([...new Set(p.guideSeats ?? policy.guideSeats ?? [])].filter(seat => Number.isInteger(seat) && seat >= 0 && seat < c.seats).sort((a, b) => a - b));
    // The keys in the order the room starts with them: a save is compared byte for byte with the save of the room rebuilt from it.
    return { reserved: Math.max(0, Math.min(c.seats - 1, Math.floor(num(own(p, 'reserved') ?? policy.reserved)) || 0)), bots: p.bots === 'off' ? 'off' : p.bots === 'fill' ? 'fill' : policy.bots, level: Math.max(1, Math.min(levelMax, Math.floor(num(own(p, 'level') ?? policy.level)) || 3)), levelMax, ...((p.kids ?? policy.kids) ? { kids: true } : {}), ...((p.levelSet ?? policy.levelSet) ? { levelSet: true } : {}), ...((p.guideLevel ?? policy.guideLevel) !== undefined ? { guideLevel: Math.max(1, Math.min(levelMax, Math.floor(num(p.guideLevel ?? policy.guideLevel)) || 3)) } : {}), ...(guideSeats.length ? { guideSeats } : {}) };
  }
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
  const stats = { handlers: 0, errors: 0, budgetStops: 0, skipped: 0, ticksCut: 0, maxUnits: 0, worst: '', lastError: '', failing: '', lost: 0, held: 0, tickUnits: 0, maxTickUnits: 0 };
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
  function typed(bag: Record<string, unknown>, list: FieldList, target: object, where: string, isShared = false): void {
    const work: Record<string, unknown> = {};
    /** The value as the field holds it. For a listener the field is named first (`runner.fields`, `score`); a room has none. */
    const held = (fd: Field, v: unknown, name: string): unknown => { if (G.note === null) return coerce(fd, v, dims); naming(where, name); const out = coerce(fd, v, dims); naming(); return out; };
    for (const [name, fd] of list) {
      if (!mutable(fd)) {
        const cost = cellsOf(fd) === 1 ? SET : COPY * cellsOf(fd);
        Object.defineProperty(target, name, { get: () => bag[name], set: (v) => { charge(cost); bag[name] = held(fd, v, name); if (isShared) sharedChanged(); }, enumerable: true });
        continue;
      }
      Object.defineProperty(target, name, {
        get: () => {
          let w = work[name];
          if (w === undefined) {
            charge(COPY * sizeOf(fd, bag[name]));
            w = work[name] = thaw(fd, bag[name]);
            touched.push({ bag, name, fd, work, shared: isShared, held });
          }
          return w;
        },
        set: (v) => { charge(COPY * est(fd, v)); bag[name] = held(fd, v, name); work[name] = undefined; if (isShared) sharedChanged(); },
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
        // Changed in place, so held to its type only now: a listener is told so, since the line is no longer the write's.
        if (G.note === null) p.bag[p.name] = coerce(p.fd, w, dims);
        else { const told = G.note; G.note = (what, at, written) => told(`${what} in place`, at, written); try { p.bag[p.name] = p.held(p.fd, w, p.name); } finally { G.note = told; } }
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
    typed(e.m, e.kind.motion, mself, `${e.kind.name}.motion`);
    Object.preventExtensions(mself);
    const self = {};
    Object.defineProperties(self, {
      id: ro(() => e.id), kind: ro(() => e.kind.name), pos: ro(() => e.pos), grounded: ro(() => e.grounded), motion: ro(() => mself), input: ro(() => e.input),
      vel: { get: () => e.vel, set: (v) => { charge(4 * COPY); naming(e.kind.name, 'vel'); e.vel = V(v); naming(); }, enumerable: true },
      heading: { get: () => e.heading, set: (v) => { charge(4 * COPY); naming(e.kind.name, 'heading'); e.heading = dir(v, dims); naming(); }, enumerable: true },
    });
    if (e.kind.player) Object.defineProperties(self, { seat: ro(() => e.seat), owner: ro(() => e.owner), driver: ro(() => e.driver), away: ro(() => e.away), goal: ro(() => e.goal) });
    typed(e.f, e.kind.fields, self, `${e.kind.name}.fields`);
    Object.preventExtensions(self);
    e.self = self; e.mself = mself;
  }
  /**
   * An entity as a query hands it out: a frozen record of what it holds. Stored state is frozen already, so this
   * copies no value, only names them: its cost is the number of fields, whatever their size (`viewCost`).
   */
  function viewOf(e: Ent): Readonly<Record<string, unknown>> {
    const o: Record<string, unknown> = { id: e.id, kind: e.kind.name, pos: e.pos, vel: e.vel, heading: e.heading, grounded: e.grounded };
    if (e.kind.player) { o.seat = e.seat; o.owner = e.owner; o.driver = e.driver; o.away = e.away; o.goal = e.goal; }
    for (const [name] of e.kind.fields) o[name] = e.f[name];
    const m: Record<string, unknown> = {};
    for (const [name] of e.kind.motion) m[name] = e.m[name];
    o.motion = Object.freeze(m);
    return Object.freeze(o);
  }

  function makeEnt(kind: KindTable, at: unknown, why: 'join' | 'spawn', init: { fields?: unknown; motion?: unknown; heading?: unknown } = {}, player: SeatInfo | null = null): Ent {
    if (ents.size + spawns.length >= ENTITY_MAX) throw new Error(`a room holds at most ${ENTITY_MAX} entities`);
    const n = nextId; nextId += 1;
    naming(kind.name, 'fields'); const f = coerceFields(kind.fields, init.fields, dims);
    naming(kind.name, 'motion'); const m = coerceFields(kind.motion, init.motion, dims); naming();
    const e: Ent = {
      id: `e${n.toString(36)}`, n, kind, pos: clampIn(V(at), kind.body?.radius ?? 0, kind.body ? kind.body.height || 2 * kind.body.radius : 0), vel: ZERO, heading: init.heading === undefined ? AHEAD : dir(init.heading, dims), grounded: dims === 2 || restsOnMap(c.map, clampIn(V(at), kind.body?.radius ?? 0, kind.body ? kind.body.height || 2 * kind.body.radius : 0), kind.body ?? { shape: 'sphere', radius: 0, height: 0 }),
      r: 0, born: tick, arrived: false, why, dead: false,
      f, m,
      seat: player ? player.seat : -1, owner: player ? player.owner : '', driver: player ? player.driver : 'bot', away: false, goal: null,
      input: Object.freeze(initFields(kind.input, dims)), allow: 0, cmds: [], self: {}, mself: {},
    };
    makeSelf(e);
    return e;
  }
  function clampIn(p: Vec3, r: number, height = 0): Vec3 {
    const b = c.map.bounds;
    const x = Math.max(b.min.x + r, Math.min(b.max.x - r, p.x)); const y = Math.max(b.min.y + r, Math.min(b.max.y - r, p.y));
    const z = dims === 3 ? Math.max(b.min.z, Math.min(b.max.z - height, p.z)) : 0;
    return x === p.x && y === p.y && z === p.z ? p : V({ x, y, z });
  }

  /* ---------------------------------------------------------------- running a handler under the budget */

  /**
   * One handler, under the budget. `fn` is everything that touches what the rules hand back: the call itself and the
   * reading of its result. Whatever is thrown in it, by the rules or by the runtime's own reading, is caught here,
   * counted against this handler and goes no further; the lists it changed in place are settled inside the same
   * budget; and the counter and the scope are put back whatever happens. Nothing of the rules' is touched after this
   * returns.
   */
  function run(kind: string, handler: string, ent: Ent | null, scope: Ctx['scope'], fn: () => void, always: boolean | 'body' = false): boolean {
    if (left <= 0) {
      cut = true;
      // Skipped once the tick's budget is gone. `room.join` and `room.start` never are; a body's `move` and `think`
      // are only when the tick has used half its budget again, which is what a full room's small shares come to.
      if (!always || (always === 'body' && left <= -half)) { stats.skipped += 1; return false; }
    }
    // A handler that runs is given a whole quarter, as the design has it: the tick ends early once the budget is used,
    // so its last handler may take it one quarter over, and no handler is cut short for running late in a busy tick.
    const quota = left > 0 ? quarter : floor;
    const before = cx;
    cx = { scope, ent };
    // Whatever is thrown while the handler runs (by the rules, by the guard, by this file, by JavaScript itself for a key
    // read of nothing) is made with no record of where: recording it costs thousands of loop turns, and only the message
    // is ever kept. So a room whose every handler throws on every tick is no slower than one whose handlers do not.
    const E = Error as unknown as { stackTraceLimit?: number };
    const limit = E.stackTraceLimit;
    E.stackTraceLimit = 0;
    G.left = quota;
    // The build check is told of every written value that had to be changed to fit (pack.ts), with the handler it was in.
    if (noted) G.note = (what, at, written) => noted(kind, handler, what, at, written);
    let bad = false; let thrown: unknown;
    try {
      try { fn(); } catch (error) { bad = true; thrown = error; }
      // Settled whether or not the handler threw: what it changed in place before it stopped is kept, when it can still pay for it.
      try { settle(); } catch (error) { if (!bad) { bad = true; thrown = error; } }
      if (bad) failed(kind, handler, thrown);
    } finally {
      const used = quota - (G.left > 0 ? G.left : 0);
      G.left = Infinity;
      G.note = null;
      E.stackTraceLimit = limit;
      cx = before;
      touched = [];
      left -= used;
      stats.handlers += 1;
      if (used > stats.maxUnits) { stats.maxUnits = used; stats.worst = `${kind}.${handler}`; }
    }
    opts.observe?.(kind, handler, bad ? errorText(thrown) : undefined);
    return true;
  }
  let failing: { kind: string; handler: string } = { kind: '', handler: '' };
  /** In the running tick: whether the budget stopped a handler, and the handler that last threw. A tick cut short with no handler stopped was used up by handlers that threw. */
  let stopped = false;
  let threw: { kind: string; handler: string } | null = null;
  function failed(kind: string, handler: string, error: unknown): void {
    stats.errors += 1;
    stats.lastError = `${kind}.${handler}: ${errorText(error)}`;
    // A throw unwinds the handler and is written down here: that is the tick's own work, and the tick pays for it.
    // (The budget's own stop costs next to nothing, and the handler it stopped has used its share already.)
    if (!(error instanceof BudgetError)) left -= THROWN;
    if (error instanceof BudgetError) { stats.budgetStops += 1; cut = true; stopped = true; failing = { kind, handler }; stats.failing = `${kind}.${handler}`; } else threw = { kind, handler };
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
    naming(name as string); const held = Object.freeze(coerceFields(shape, data, dims)); naming();
    return held;
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
  typed(sharedBag, c.shared, sharedRW, 'shared', true);
  Object.preventExtensions(sharedRW);
  const sharedView = (): Readonly<Record<string, unknown>> => {
    if (cx.scope === 'room') return sharedRW;
    if (sharedROVer !== sharedVer) { sharedRO = Object.freeze({ ...shared }); sharedROVer = sharedVer; }
    return sharedRO;
  };

  function cast3(p: Vec3, d: Vec3, shape: BodyShape, ignored: Set<string>): Hit3 | null {
    let best = castMap3(c.map, p, d, shape);
    const solid = solidAt(p, shape);
    for (const other of ents.values()) {
      if (!other.kind.body || ignored.has(other.id)) continue;
      if (other.kind.collider) charge(48);
      const row = other.kind.collider ? colliderRow(other.id, other.pos, other.kind.body, other.kind.collider, other.f) : null;
      if (other.dead || other.kind.collider && !row) continue;
      const hit = castSolid(solid, d, row ? colliderSolid(row) : solidAt(other.pos, other.kind.body));
      if (hit && (!best || hit.t < best.t)) best = { ...hit, id: other.id };
    }
    return best;
  }
  const world = brand({} as Record<string, unknown>);
  const getters: Record<string, () => unknown> = {
    tick: () => tick, dt: () => dt, round: () => roundApi, shared: sharedView, level: () => policy.level, levelMax: () => policy.levelMax, guideLevel: () => policy.guideLevel ?? policy.level, guideSeats: () => policy.guideSeats ?? EMPTY_GUIDE_SEATS, kids: () => Boolean(policy.kids), levelSet: () => Boolean(policy.levelSet),
    stage: () => stage, tune: () => c.tune, math: () => math, map: () => mapApi,
  };
  for (const [name, get] of Object.entries(getters)) Object.defineProperty(world, name, { get, enumerable: true });
  Object.assign(world, {
    ticks: (seconds: unknown): number => { charge(1); return ticks(seconds); },
    random: (): number => {
      charge(1);
      if (cx.scope === 'none') throw new Error('a pure callback cannot change the room random state');
      // mulberry32: the whole of the dice is one 32-bit number, which is room state.
      rng = (rng + 0x6d2b79f5) >>> 0;
      let x = rng;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    },
    send: (target: unknown, ev: unknown, data?: unknown): void => {
      charge(SEND);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.send is for handlers');
      push({ due: tick + 1, to: typeof target === 'string' ? target.slice(0, 24) : '', kind: 'ev', ev: ev as string, data: shapeData(c.events, ev, 'the event', data), at: tick });
    },
    sendRoom: (ev: unknown, data?: unknown): void => {
      charge(SEND);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.sendRoom is for handlers');
      push({ due: tick + 1, to: '', kind: 'room', ev: ev as string, data: shapeData(c.events, ev, 'the event', data), at: tick });
    },
    announce: (ev: unknown, data?: unknown): void => {
      charge(SEND);
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
      charge(SEND);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.after is for handlers');
      const w = Math.round(num(n));
      const wait = w >= 1 ? Math.min(w, 0x7fffffff) : 1;
      push({ due: tick + wait, to: cx.ent ? cx.ent.id : '', kind: cx.ent ? 'ev' : 'room', ev: ev as string, data: shapeData(c.events, ev, 'the event', data), at: tick });
    },
    emit: (effect: unknown, at: unknown, data?: unknown): void => {
      charge(10);
      if (cx.scope !== 'ent' && cx.scope !== 'room') throw new Error('world.emit is for handlers');
      const i = typeof effect === 'string' ? c.effectNames.indexOf(effect) : -1;
      if (i < 0) throw new Error(`the effect "${said(effect)}" is not declared in shapes.effects`);
      if (fx.length >= FX_MAX) { G.note?.('effect', '', said(effect)); return; }
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
      e.pos = clampIn(V(at), e.kind.body?.radius ?? 0, e.kind.body ? e.kind.body.height || 2 * e.kind.body.radius : 0);
      e.vel = vel !== undefined ? V(vel) : ZERO;
      if (heading !== undefined) e.heading = dir(heading, dims);
      e.grounded = dims === 2 || restsOnMap(c.map, e.pos, e.kind.body ?? { shape: 'sphere', radius: 0, height: 0 });
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
        const dz = dims === 3 ? e.pos.z - p.z : 0;
        const d2 = dx * dx + dy * dy + dz * dz;
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
      if (max.x - min.x > 2 * REACH_M || max.y - min.y > 2 * REACH_M || dims === 3 && max.z - min.z > 2 * REACH_M) throw new Error(`world.inBox reaches ${REACH_M} m from its centre at most`);
      const found: Ent[] = [];
      let cost = 0;
      for (const e of ents.values()) if ((!k || e.kind === k) && e.pos.x >= min.x && e.pos.x <= max.x && e.pos.y >= min.y && e.pos.y <= max.y && (dims === 2 || e.pos.z >= min.z && e.pos.z <= max.z)) { found.push(e); cost += viewCost.get(e.kind) as number; }
      charge(cost);
      return Object.freeze(found.map(viewOf));
    },
    ray: (from: unknown, direction: unknown, max: unknown): unknown => {
      // Charged before the cast, for every shape it may test: the map's, and every entity in the room.
      charge(20 + 4 * (mapShapes + ents.size));
      const p = V(from); const d = dir(direction, dims); const far = reach(max, 'world.ray');
      if (dims === 3) {
        const delta = { x: d.x * far, y: d.y * far, z: d.z * far };
        const hit = cast3(p, delta, { shape: 'sphere', radius: 0, height: 0 }, new Set(cx.ent ? [cx.ent.id] : []));
        return hit ? Object.freeze({ ...(hit.id ? { entity: hit.id } : {}), at: V({ x: p.x + delta.x * hit.t, y: p.y + delta.y * hit.t, z: p.z + delta.z * hit.t }), normal: V({ x: hit.nx, y: hit.ny, z: hit.nz }), dist: far * hit.t }) : undefined;
      }
      const cast = castMap(c.map, p.x, p.y, d.x * far, d.y * far, 0);
      let best: Hit | null = cast.hit;
      for (const e of ents.values()) {
        if (!e.kind.body || e === cx.ent) continue;
        if (e.kind.collider) charge(48);
        const row = e.kind.collider ? colliderRow(e.id, e.pos, e.kind.body, e.kind.collider, e.f) : null;
        if (e.dead || e.kind.collider && !row) continue;
        const h = row ? castCollider2(row, p, {x:d.x*far,y:d.y*far,z:0}, 0) : rayCircle(p.x, p.y, d.x * far, d.y * far, e.pos.x, e.pos.y, e.kind.body.radius);
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
      // The ids to pass through: the first few of a list, read as plain texts. A longer list is not searched once for every entity.
      const list = own(o, 'ignore');
      const ignore = new Set<string>();
      if (Array.isArray(list)) for (let i = 0; i < list.length && i < IGNORE_MAX; i += 1) { const id = own(list, i); if (typeof id === 'string') ignore.add(id); }
      if (dims === 3) {
        ignore.add(e.id);
        const shape = e.kind.body ?? { shape: 'sphere', radius: 0, height: 0 };
        const hit = cast3(e.pos, d, shape, ignore);
        const length = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
        const t = hit ? Math.max(0, hit.t - (length > 0 ? SKIN / length : 0)) : 1;
        e.pos = V({ x: e.pos.x + d.x * t, y: e.pos.y + d.y * t, z: e.pos.z + d.z * t });
        const support = cast3(e.pos, { x: 0, y: 0, z: -2 * SKIN }, shape, ignore);
        e.grounded = Boolean(support && support.nz > 0.5);
        return hit ? Object.freeze({ ...(hit.id ? { entity: hit.id } : {}), at: e.pos, normal: V({ x: hit.nx, y: hit.ny, z: hit.nz }) }) : undefined;
      }
      const cast = castMap(c.map, e.pos.x, e.pos.y, d.x, d.y, radius);
      let best: Hit | null = cast.hit;
      for (const other of ents.values()) {
        if (other === e || !other.kind.body || ignore.has(other.id)) continue;
        if (other.kind.collider) charge(48);
        const row = other.kind.collider ? colliderRow(other.id, other.pos, other.kind.body, other.kind.collider, other.f) : null;
        if (other.dead || other.kind.collider && !row) continue;
        const h = row ? castCollider2(row, e.pos, d, radius) : rayCircle(e.pos.x, e.pos.y, d.x, d.y, other.pos.x, other.pos.y, other.kind.body.radius + radius);
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
      if (pendingAsks.some((q) => q.name === name) || queue.some((q) => q.ev === 'answer' && (q.data as { ask?: string })?.ask === name)) return false;
      charge(COPY * estFields(a.stateFields, state));
      naming('asks', name as string, 'state'); const value = deepFreeze(coerceFields(a.stateFields, state, dims)); naming();
      if (JSON.stringify(value).length > 2048) return false;
      const n = `a${epoch.toString(36)}-${(++seq).toString(36)}`;
      pendingAsks.push({ n, name: name as string, who, at: tick, state: value });
      if (opts.decisions) out.push({ t: 'ask', n, state: value, questions: a.questions });
      return true;
    },
    goalDone: (ok?: boolean): void => { if (cx.ent && cx.scope === 'ent') { cx.ent.goal = null; out.push({ t: 'goalDone', seat: cx.ent.seat, ok: ok !== false }); } },
    finish: (): void => { need('room', 'world.finish()'); finishing = true; },
  });
  Object.freeze(world);

  const hasColliders = c.kinds.some(k => k.collider);
  const collisionState = (): CollisionRevision => [tick, tick + 1, [...ents.values()].flatMap(e => {
    if (e.dead || !e.kind.collider || !e.kind.body) return [];
    const row = colliderRow(e.id, e.pos, e.kind.body, e.kind.collider, e.f);
    return row ? [row] : [];
  })];
  let moveGeometry = c.map as import('./math.ts').MapShapes;
  const queries = collisionQueries(() => moveGeometry, () => moveShape, dims);
  const moveWorld = brand(Object.freeze(queries));
  const moveMap = brand(Object.freeze({ name: c.map.name, spot: mapApi.spot, spots: mapApi.spots, ...queries }));
  let moveShape = { shape: 'sphere', radius: 0, height: 0 };
  const moveCtx = brand({} as Record<string, unknown>);
  for (const [name, get] of Object.entries({ tick: () => tick, dt: () => dt, tune: () => c.publicTune, math: () => math, map: () => moveMap, world: () => moveWorld })) Object.defineProperty(moveCtx, name, { get, enumerable: true });
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
  function validPicks(questions: Record<string, unknown>, value: unknown): boolean {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.entries(questions).every(([id, raw]) => {
      const q = raw as any; const v = own(value, id);
      if (q.type === 'noul' || q.type === 'yes-no') return typeof v === 'boolean';
      if (q.type === 'score') return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < q.criteria.length;
      return typeof v === 'string' && (Array.isArray(q.criteria) ? q.criteria.includes(v) : Object.hasOwn(q.criteria, v));
    }));
  }
  function deliver(item: Item): boolean {
    if (item.kind === 'room') {
      const fn = c.roomOn[item.ev];
      return fn ? run('room', `on.${item.ev}`, null, 'room', () => fn(world, item.data)) : true;
    }
    if (item.kind === 'all') {
      const roomFn = item.builtIn ? c.roomOn[item.ev] : undefined;
      const heard = hears(item.ev);
      if (!roomFn && !heard) return true;
      if (left <= 0) { cut = true; stats.skipped += 1; return false; }
      if (roomFn) run('room', `on.${item.ev}`, null, 'room', () => roomFn(world, item.data));
      if (!heard) return true;
      // Going round every entity is the tick's own work, a unit an entity: thousands of announcements cannot be gone round for nothing.
      left -= ents.size;
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
  /** Whether any kind of entity hears an announcement of this event. */
  const heardBy = new Map<string, boolean>();
  function hears(ev: string): boolean {
    let h = heardBy.get(ev);
    if (h === undefined) { h = c.kinds.some((k) => Boolean(k.onRoom[ev])); heardBy.set(ev, h); }
    return h;
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
    if (e && e.kind.player?.leave === 'bot' && policy.bots !== 'off') {
      e.driver = 'bot'; e.owner = ''; e.away = false; e.goal = null;
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
          e.goal = null; e.seat = info.seat; e.driver = info.driver; e.owner = info.owner; e.away = false; e.r = (e.r + 1) & 0xffff; e.allow = 0;
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
    // Reserved companions exist independently of practice bots and cannot be taken over by people.
    const first = c.seats - (policy.reserved ?? 0);
    for (const e of playerBodies()) if (e.owner === 'reserved' && e.seat < first) {
      const s = seats.get(e.seat); if (s) leaveBody(s);
    }
    for (let seat = first; seat < c.seats; seat += 1) {
      const s = seats.get(seat);
      if (s && s.driver !== 'bot') continue;
      if (s?.id) { const e = ents.get(s.id); if (e) { e.driver = 'ai'; e.owner = 'reserved'; s.driver = 'ai'; s.owner = 'reserved'; } }
      else joinBody({ seat, driver: 'ai', owner: 'reserved' });
      out.push({ t: 'seats' });
    }
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
    if (policy.bots === 'off') for (const e of playerBodies()) if (e.driver === 'bot') {
      const seat = seats.get(e.seat);
      if (seat) leaveBody(seat);
    }
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
    ents.clear(); spawns = []; queue = []; pendingAsks = []; areas = []; fx = [];
    for (const s of seats.values()) s.id = null;
    shared = initFields(c.shared, dims); sharedChanged();
    epoch += 1;
    playing = 0;
    restartAt = tick + Math.max(3, ticks(c.rounds ? c.rounds.breakSeconds : 0));
    round = { ...round, phase: 'over', endsAt: restartAt };
    overAt = 0;
    refreshRound();
    out.push({ t: 'epoch', epoch }, { t: 'seats' });
  }

  /* ---------------------------------------------------------------- one tick */

  function inArea(a: any, p: Vec3): boolean {
    if (a.k === 'b') return p.x >= a.min.x && p.x <= a.max.x && p.y >= a.min.y && p.y <= a.max.y && (dims === 2 || p.z >= a.min.z && p.z <= a.max.z);
    const dx = p.x - a.at.x; const dy = p.y - a.at.y;
    const dz = dims === 3 ? p.z - a.at.z : 0;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > a.r * a.r) return false;
    if (a.k === 's' || d2 === 0) return true;
    const l = Math.sqrt(d2);
    // Inside the cone: the angle to its axis is at most half its opening, compared by cosine.
    return (dx * a.dir.x + dy * a.dir.y + dz * a.dir.z) / l >= exact.cos(a.half);
  }
  function step(inputs: ReadonlyMap<number, StepInput> = new Map(), guides?: () => void): void {
    tick = (tick + 1) >>> 0;
    // The tick pays first for the state it sends: what the last snapshot packed. A room that holds more than a tick can send has nothing left for its handlers, and ends as any room does whose budget trips on every tick.
    left = c.settings.budget.tick - SNAP * snapCells;
    cut = false; stopped = false; threw = null;
    // When sending the state takes more than half of a tick's budget, that is what a cut tick is put down to.
    stateHeavy = 2 * SNAP * snapCells > c.settings.budget.tick;
    // A room that holds more than a whole tick's budget can send has no handler left to run that could make it
    // smaller, and every tick it lives it sends all of it again: it ends now, not after two seconds of growing.
    if (left <= 0) { cut = true; out.push({ t: 'fail', why: 'budget', kind: 'room', handler: STATE_TOO_LARGE }); }
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
      // External answers enter only on a tick; every floor runs under the caller's usual budget.
      for (const ask of [...pendingAsks]) {
        if (ask.at >= tick || (opts.decisions && !ask.result && tick - ask.at < 5 * tickHz)) continue;
        const e = ask.who ? ents.get(ask.who) : null;
        if (ask.who && !e) { pendingAsks = pendingAsks.filter((x) => x !== ask); continue; }
        const a = c.asks[ask.name];
        pendingAsks = pendingAsks.filter((x) => x !== ask);
        let answered = false;
        run(e?.kind.name ?? 'room', `asks.${ask.name}.floor`, e ?? null, 'none', () => {
          charge(2 * ANSWER_MAX);
          const r = ask.result;
          const valid = (p: unknown): boolean => validPicks(a.questions, p);
          const ai = r?.ok === true && valid(r.picks);
          const picks = plainData(ai ? r.picks : a.floor(ask.state), { n: ANSWER_MAX });
          if (!valid(picks)) {
            const details = Object.entries(a.questions).map(([id, raw]) => {
              const q = raw as any; const value = (picks as any)?.[id];
              const allowed = q.type === 'score' ? `an integer from 0 through ${q.criteria.length - 1}`
                : q.type === 'noul' || q.type === 'yes-no' ? 'true or false'
                : `one of ${JSON.stringify(Array.isArray(q.criteria) ? q.criteria : Object.keys(q.criteria))}`;
              return `${id} received ${JSON.stringify(value) ?? 'missing'}; expected ${allowed}`;
            }).join('; ');
            throw new Error(`asks.${ask.name}.floor must answer every declared question: ${details}`);
          }
          push({ due: tick, to: ask.who, kind: e ? 'ev' : 'room', ev: 'answer', data: deepFreeze({ ask: ask.name, by: ai ? (r.by === 'local' ? 'local' : 'ai') : 'floor', picks, ...(!ai ? { why: r?.ok === true ? 'bad' : typeof r?.why === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(r.why) ? r.why : (opts.decisions ? 'slow' : 'off') } : {}) }), at: tick, builtIn: true }, true);
          answered = true;
        });
        if (!answered) {
          // A faulty floor still settles once with valid, conservative declared picks.
          const picks = Object.fromEntries(Object.entries(a.questions).map(([id, raw]) => {
            const q = raw as any;
            return [id, q.type === 'noul' || q.type === 'yes-no' ? false : q.type === 'score' ? 0 : Array.isArray(q.criteria) ? q.criteria[0] : Object.keys(q.criteria)[0]];
          }));
          push({ due: tick, to: ask.who, kind: e ? 'ev' : 'room', ev: 'answer', data: deepFreeze({ ask: ask.name, by: 'floor', picks, why: 'floor-error' }), at: tick, builtIn: true }, true);
        }
      }
      guides?.();
      // All movers see the same world, independent of entity iteration order.
      if (hasColliders) { left -= 64 * ents.size + 4 * mapShapes; moveGeometry = collisionMap(c.map, collisionState()[2]); }
      // Phase 1: one input step and `move` for every body.
      for (const e of [...ents.values()]) {
        if (e.dead || !e.kind.body) continue;
        const k = e.kind;
        const body = k.body as NonNullable<KindTable['body']>;
        let claim: StepInput['claim'] = null;
        if (k.player) {
          const driven = (e.driver === 'person' || (e.driver === 'ai' && inputs.has(e.seat))) && !e.away;
          if (driven) {
            const s = inputs.get(e.seat);
            e.input = Object.freeze(s ? coerceFields(k.input, s.values, dims) : initFields(k.input, dims));
            claim = s?.claim ?? null;
          } else if (k.think && (e.driver !== 'person' || k.player.away === 'think')) {
            // `think` returns the step. It is held to the declared input inside the handler's own try and budget; a `think` that throws leaves the input neutral.
            let stepIn: Record<string, unknown> | null = null;
            run(k.name, 'think', e, 'ent', () => {
              const back: unknown = (k.think as NonNullable<KindTable['think']>)(world, e.self);
              // What is not an input of this kind is not read, and the input is neutral: a room says nothing of it, a listener is told.
              if (G.note !== null) {
                if (!back || typeof back !== 'object' || Array.isArray(back)) G.note('think', '', said(back));
                else for (const key of Object.keys(back)) if (!k.input.some(([name]) => name === key)) G.note('think', key, said((back as Record<string, unknown>)[key]));
              }
              charge(COPY * k.input.length);
              naming('input'); stepIn = coerceFields(k.input, back, dims); naming();
            }, 'body');
            e.input = Object.freeze(stepIn ?? initFields(k.input, dims));
          } else e.input = Object.freeze(initFields(k.input, dims));
          if (driven && body.owner) {
            // Owner movement: the browser says where its body is, and the server holds the claim to maxSpeed.
            e.allow = Math.min(e.allow + body.maxSpeed * dt * 1.02, body.maxSpeed * 0.25 + 0.05);
            if (claim && claim.r === e.r) {
              const dx = claim.pos.x - e.pos.x; const dy = claim.pos.y - e.pos.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const go = Math.min(dist, e.allow);
              // The browser ran the game's own `move` and came further than `maxSpeed` allows: the body is held back.
              if (go < dist) stats.held += 1;
              e.allow -= go;
              e.pos = clampIn(V({ x: e.pos.x + (dist > 0 ? (dx / dist) * go : 0), y: e.pos.y + (dist > 0 ? (dy / dist) * go : 0), z: dims === 3 ? claim.pos.z : 0 }), body.radius, body.height || 2 * body.radius);
              const sp = Math.sqrt(claim.vel.x * claim.vel.x + claim.vel.y * claim.vel.y);
              e.vel = sp > body.maxSpeed && sp > 0 ? V({ x: (claim.vel.x / sp) * body.maxSpeed, y: (claim.vel.y / sp) * body.maxSpeed, z: claim.vel.z }) : V(claim.vel);
              e.heading = dir(claim.heading, dims);
              e.grounded = dims === 2;
              // The support cast is map work even when a browser supplies the pose.
              // Keep it under the same movement quota as a server-driven body's sweep.
              if (dims === 3) run(k.name, 'move', e, 'move', () => { e.grounded = restsOnMap(c.map, e.pos, body); }, 'body');
            }
            continue;
          }
        }
        if (!k.move) continue;
        const b = { pos: e.pos, vel: e.vel, heading: e.heading, grounded: e.grounded, motion: e.mself };
        const beforeMove = opts.moved ? { pos: e.pos, vel: e.vel, heading: e.heading, grounded: e.grounded, motion: { ...e.m } } : null;
        moveShape = body;
        run(k.name, 'move', e, 'move', () => (k.move as NonNullable<KindTable['move']>)(b, e.input, moveCtx), 'body');
        // The runtime rounds to 32-bit floats, here and in the browser, so both step from exactly the same numbers.
        // `b` is the runtime's own object: what `move` left in it is read by its own data properties and cannot throw.
        // (A listener hears of a position that was not a number here too, as `move`'s.)
        if (noted) G.note = (what, at, written) => noted(k.name, 'move', what, at, written);
        naming('body', 'pos'); e.pos = clampIn(V(own(b, 'pos')), body.radius, body.height || 2 * body.radius); naming('body', 'vel'); e.vel = V(own(b, 'vel')); naming('body', 'heading'); e.heading = dir(own(b, 'heading'), dims); naming();
        G.note = null;
        e.grounded = own(b, 'grounded') === true;
        if (beforeMove) opts.moved!(k.name, tick, e.input, beforeMove, { pos: e.pos, vel: e.vel, heading: e.heading, grounded: e.grounded, motion: { ...e.m } }, moveGeometry);
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
      if (stateHeavy) failing = { kind: 'room', handler: STATE_TOO_LARGE };
      else if (!stopped && threw) failing = { kind: threw.kind, handler: `${threw.handler} (so many handlers threw that the tick had no budget left)` };
      stats.failing = `${failing.kind}.${failing.handler}`;
      stats.ticksCut += 1;
      trips += 1;
      // The budget tripping on every tick for two seconds: the room ends, and the log names the handler.
      if (trips === 2 * tickHz) out.push({ t: 'fail', why: 'budget', kind: failing.kind, handler: failing.handler });
    } else trips = 0;
  }

  /* ---------------------------------------------------------------- the save */

  const saveEnt = (e: Ent): unknown[] => [e.id, e.n, e.kind.index, e.r, e.born, e.arrived ? 1 : 0, e.why, packVec(e.pos, 3), packVec(e.vel, 3), packVec(e.heading, 3), e.grounded ? 1 : 0, e.seat, e.driver, e.owner, e.away ? 1 : 0, e.goal ?? (e.driver === 'ai' ? restoredGoals.get(e.seat) : null) ?? null, e.allow,
    packFields(e.kind.fields, e.f, dims), packFields(e.kind.motion, e.m, dims), packFields(e.kind.input, e.input as Record<string, unknown>, dims), e.cmds];
  function loadEnt(w: any[]): Ent {
    const kind = c.kinds[w[2]];
    const e: Ent = {
      id: w[0], n: w[1], kind, r: w[3], born: w[4], arrived: w[5] === 1, why: w[6], dead: false, pos: unpackVec(w[7], 3), vel: unpackVec(w[8], 3), heading: unpackVec(w[9], 3), grounded: w[10] === 1,
      seat: w[11], driver: w[12], owner: w[13], away: w[14] === 1, goal: null, allow: w[16],
      f: unpackFields(kind.fields, w[17], dims), m: unpackFields(kind.motion, w[18], dims), input: Object.freeze(unpackFields(kind.input, w[19], dims)), cmds: (w[20] as { name: string; data: unknown }[]).map((x) => ({ name: x.name, data: deepFreeze(coerceFields(c.commands[x.name] ?? [], x.data, dims)) })), self: {}, mself: {},
    };
    if (kind.player) restoredGoals.set(e.seat, w[15]);
    makeSelf(e);
    return e;
  }
  function save(): SavedCore {
    return {
      v: SAVE_REVISION, tick, epoch, rng, nextId, seq, round: [round.n, round.phase === 'live' ? 1 : 0, round.endsAt, round.startedAt], overAt, match: [playing, restartAt], trips,
      shared: packFields(c.shared, shared, dims), policy: { ...policy }, intent: [endAsked ? 1 : 0, finishing ? 1 : 0], asks: pendingAsks, guideViews: [...guideViews],
      ents: [...ents.values()].map(saveEnt), spawns: spawns.map(saveEnt),
      seats: [...seats.values()].map((s) => [s.seat, s.driver, s.owner, s.id, s.away ? 1 : 0]),
      queue: queue.map((q) => [q.due, q.from, q.fromId, q.seq, q.to, q.kind, q.ev, q.data, q.at, q.builtIn ? 1 : 0]),
      areas: areas.map((a) => [a.from, a.fromId, a.seq, a.shape, a.ev, a.data]),
      ops: JSON.parse(JSON.stringify(ops)),
    };
  }
  // A persisted value is untrusted too. Reject structural damage instead of silently making a different match.
  function validateSave(r: SavedCore): void {
    const check = (ok: unknown): void => { if (!ok) throw new Error('saved rules state is invalid'); };
    const uint = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) < 2 ** 40;
    const bit = (v: unknown): boolean => v === 0 || v === 1;
    const fields = (list: FieldList, value: unknown): void => {
      check(Array.isArray(value) && JSON.stringify(value) === JSON.stringify(packFields(list, unpackFields(list, value, dims), dims)));
    };
    check(r.v === SAVE_REVISION);
    check(Object.keys(r).every(k => ['v', 'tick', 'epoch', 'rng', 'nextId', 'seq', 'round', 'overAt', 'match', 'trips', 'shared', 'policy', 'intent', 'asks', 'guideViews', 'ents', 'spawns', 'seats', 'queue', 'areas', 'ops'].includes(k)));
    const askNames = new Set();
    check(Array.isArray(r.asks));
    for (const a of r.asks) {
      check(a && typeof a.name === 'string' && Object.hasOwn(c.asks, a.name) && !askNames.has(a.name)); askNames.add(a.name);
      check(Object.keys(a).every(k => ['n', 'name', 'who', 'at', 'state', 'result'].includes(k)));
      check(typeof a.n === 'string' && a.n.length <= 128 && typeof a.who === 'string' && a.who.length <= 128 && uint(a.at) && a.at <= r.tick);
      check(JSON.stringify(a.state) === JSON.stringify(coerceFields(c.asks[a.name].stateFields, a.state, dims)));
      if (a.result !== undefined) check(JSON.stringify(a.result) === JSON.stringify(decisionResult(a.result)));
    }
    check(Array.isArray(r.guideViews) && r.guideViews.length <= c.seats);
    const views = new Set();
    for (const row of r.guideViews) {
      check(Array.isArray(row) && row.length === 2 && uint(row[0]) && row[0] < c.seats && !views.has(row[0])); views.add(row[0]);
      check(JSON.stringify(row[1]) === JSON.stringify(coerceFields(c.view, row[1], dims)));
    }
    check(r.intent === undefined || Array.isArray(r.intent) && r.intent.length === 2 && r.intent.every(bit));
    for (const v of [r.tick, r.epoch, r.rng, r.nextId, r.seq, r.overAt, r.trips]) check(uint(v));
    check(r.tick < 0xffffffff);
    check(r.rng <= 4294967295 && r.epoch > 0 && r.nextId > 0 && r.seq > 0);
    check(Array.isArray(r.round) && r.round.length === 4 && r.round.every(uint) && bit(r.round[1]));
    check(Array.isArray(r.match) && r.match.length === 2 && r.match.every(uint) && bit(r.match[0]));
    const duration = r.round[1] === 1 ? ticks(c.rounds?.seconds ?? 0) : Math.max(3, ticks(c.rounds?.breakSeconds ?? 0));
    check(r.round[3] <= r.tick && r.round[2] <= r.tick + duration && !(r.round[1] === 1 && !duration && r.round[2] !== 0));
    check(r.policy && ['fill', 'off'].includes(r.policy.bots) && Number.isInteger(r.policy.level) && Number.isInteger(r.policy.levelMax) && r.policy.level >= 1 && r.policy.level <= r.policy.levelMax && r.policy.levelMax <= 5);
    check(r.policy.guideLevel === undefined || Number.isInteger(r.policy.guideLevel) && r.policy.guideLevel >= 1 && r.policy.guideLevel <= r.policy.levelMax);
    check(r.policy.guideSeats === undefined || Array.isArray(r.policy.guideSeats) && r.policy.guideSeats.length > 0 && r.policy.guideSeats.length <= c.seats && r.policy.guideSeats.every((seat, i, seats) => uint(seat) && seat < c.seats && (i === 0 || seat > seats[i - 1])));
    check((r.policy.kids === undefined || r.policy.kids === true) && (r.policy.levelSet === undefined || r.policy.levelSet === true));
    check(Object.keys(r.policy).every((key) => ['bots', 'level', 'levelMax', 'reserved', 'kids', 'levelSet', 'guideLevel', 'guideSeats'].includes(key)));
    check(r.policy.reserved === undefined || uint(r.policy.reserved) && r.policy.reserved < c.seats);
    fields(c.shared, r.shared);
    check(Array.isArray(r.ents) && Array.isArray(r.spawns) && r.ents.length + r.spawns.length <= ENTITY_MAX);
    const ids = new Set();
    const bodySeats = new Set();
    for (const w of [...r.ents, ...r.spawns]) {
      check(Array.isArray(w) && w.length === 21);
      const k = c.kinds[w[2] as number];
      check(k && uint(w[2]) && typeof w[0] === 'string' && !ids.has(w[0])); ids.add(w[0]);
      for (const i of [1, 3, 4]) check(uint(w[i]));
      check((w[1] as number) > 0 && (w[1] as number) < r.nextId && w[0] === `e${(w[1] as number).toString(36)}` && (w[3] as number) <= 65535 && (w[4] as number) <= r.tick);
      check(typeof w[16] === 'number' && Number.isFinite(w[16]) && w[16] >= 0);
      for (const i of [5, 10, 14]) check(bit(w[i]));
      for (const i of [7, 8, 9]) check(Array.isArray(w[i]) && (w[i] as unknown[]).length === 3 && (w[i] as unknown[]).every((n) => typeof n === 'number' && Number.isFinite(n)));
      for (const i of [7, 8, 9]) check(JSON.stringify(w[i]) === JSON.stringify(packVec(unpackVec(w[i], 3), 3)));
      const goal = w[15] as any;
      if (goal !== null) check(goal && typeof goal === 'object' && !Array.isArray(goal) && Object.keys(goal).every(k => ['goal', 'args', 'from', 'at', 'asked', 'state'].includes(k)) && typeof goal.goal === 'string' && goal.args && typeof goal.args === 'object' && !Array.isArray(goal.args) && ['brain', 'floor'].includes(goal.from) && uint(goal.at) && goal.at <= r.tick && typeof goal.asked === 'boolean' && goal.state === 'active');
      const pos = unpackVec(w[7] as number[], 3), bounds = c.map.bounds;
      check(pos.x >= bounds.min.x && pos.x <= bounds.max.x && pos.y >= bounds.min.y && pos.y <= bounds.max.y && (dims === 3 ? pos.z >= bounds.min.z && pos.z <= bounds.max.z : pos.z === 0));
      check(Number.isInteger(w[11]) && (w[11] as number) >= -1 && (w[11] as number) < c.seats && ['person', 'bot', 'ai'].includes(w[12] as string) && typeof w[13] === 'string' && w[13].length <= 128);
      if (k.player) { check(!bodySeats.has(w[11])); bodySeats.add(w[11]); }
      fields(k.fields, w[17]); fields(k.motion, w[18]); fields(k.input, w[19]);
      check(w[6] === 'join' || w[6] === 'spawn');
      check(JSON.stringify(w[15]) === JSON.stringify(plainData(w[15], { n: ANSWER_MAX })));
      check(Array.isArray(w[20]) && w[20].length <= 16);
      for (const cmd of w[20] as { name: string; data: unknown }[]) {
        check(cmd && typeof cmd.name === 'string' && Object.hasOwn(c.commands, cmd.name) && Object.hasOwn(k.commands, cmd.name)); const shape = c.commands[cmd.name];
        check(JSON.stringify(cmd.data) === JSON.stringify(coerceFields(shape, cmd.data, dims)));
      }
    }
    check(Array.isArray(r.seats) && r.seats.length <= c.seats);
    const seatIds = new Set();
    const heldIds = new Set();
    check(r.seats.every((row) => Array.isArray(row) && row.length === 5));
    for (const [seat, driver, owner, id, away] of r.seats) {
      check(uint(seat) && seat < c.seats && !seatIds.has(seat)); seatIds.add(seat);
      check(['person', 'bot', 'ai'].includes(driver) && typeof owner === 'string' && owner.length <= 128 && (id === null || ids.has(id)) && bit(away));
      if (id !== null) {
        const body = r.ents.find((e) => e[0] === id);
        check(!heldIds.has(id) && body && c.kinds[body[2] as number].player && body[11] === seat && body[12] === driver && body[13] === owner && body[14] === away);
        heldIds.add(id);
      }
    }
    for (const body of r.ents) if (c.kinds[body[2] as number].player) check(heldIds.has(body[0]));
    check(Array.isArray(r.queue) && r.queue.length <= QUEUE_MAX && Array.isArray(r.areas) && r.areas.length <= AREAS_MAX && Array.isArray(r.ops));
    for (const q of r.queue) {
      check(q.length === 10 && uint(q[0]) && uint(q[1]) && typeof q[2] === 'string' && q[2].length <= 128 && uint(q[3]) && typeof q[4] === 'string' && q[4].length <= 128 && ['ev', 'room', 'all'].includes(q[5] as string) && typeof q[6] === 'string' && uint(q[8]) && bit(q[9]));
      check((q[3] as number) < r.seq);
      if (!q[9]) { check(Object.hasOwn(c.events, q[6] as string)); const shape = c.events[q[6] as string]; check(JSON.stringify(q[7]) === JSON.stringify(coerceFields(shape, q[7], dims))); }
      else {
        check(['answer', 'roundStart', 'roundOver'].includes(q[6] as string));
        const d = q[7] as Record<string, unknown>; check(d && typeof d === 'object');
        if (q[6] === 'answer') {
          check(typeof d.ask === 'string' && Object.hasOwn(c.asks, d.ask) && ['ai', 'local', 'floor'].includes(d.by as string) && (d.why === undefined || typeof d.why === 'string' && d.why.length <= 256));
          check(JSON.stringify(d.picks) === JSON.stringify(plainData(d.picks, { n: ANSWER_MAX })));
          if (!validPicks(c.asks[d.ask as string].questions, d.picks)) throw new Error('saved rules state is invalid: invalid saved answer');
        } else {
          check(uint(d.n));
          if (q[6] === 'roundOver') {
            check(Array.isArray(d.results) && d.results.length <= c.seats);
            for (const row of d.results as ResultRow[]) check(uint(row.seat) && row.seat < c.seats && typeof row.id === 'string' && ['person', 'bot', 'ai'].includes(row.driver) && Number.isFinite(row.score) && uint(row.place));
          }
        }
      }
    }
    for (const a of r.areas) {
      check(a.length === 6 && uint(a[0]) && typeof a[1] === 'string' && uint(a[2]));
      check((a[2] as number) < r.seq);
      const shape = a[3] as Record<string, unknown>; check(shape && ['s', 'b', 'c'].includes(shape.k as string));
      for (const key of shape.k === 'b' ? ['min', 'max'] : shape.k === 'c' ? ['at', 'dir'] : ['at']) {
        const v = shape[key] as Vec3; check(v && [v.x, v.y, v.z].every((n) => typeof n === 'number' && Number.isFinite(n)));
      }
      if (shape.k !== 'b') check(typeof shape.r === 'number' && shape.r >= 0 && shape.r <= REACH_M);
      if (shape.k === 'c') check(typeof shape.half === 'number' && shape.half >= 0 && shape.half <= Math.PI);
      check(typeof a[4] === 'string' && Object.hasOwn(c.events, a[4] as string));
      const fields = c.events[a[4] as string]; check(fields && JSON.stringify(a[5]) === JSON.stringify(coerceFields(fields, a[5], dims)));
    }
    const occupants = new Map(r.seats.map(([seat, driver, owner]) => [seat, { driver, owner }]));
    for (const op of r.ops as { op: string; seat: number; away: boolean; info: SeatInfo }[]) {
      check(['join', 'away', 'leave'].includes(op.op));
      const seat = op.op === 'join' ? op.info?.seat : op.seat;
      check(uint(seat) && seat < c.seats);
      if (op.op === 'join') {
        check(['person', 'bot', 'ai'].includes(op.info.driver) && typeof op.info.owner === 'string' && op.info.owner.length <= 128);
        const held = occupants.get(seat);
        check(!held || held.driver === 'bot' || held.owner === 'reserved' || held.owner === op.info.owner && held.driver === op.info.driver);
        occupants.set(seat, op.info);
      }
      if (op.op === 'leave') occupants.delete(seat);
      if (op.op === 'away') check(typeof op.away === 'boolean');
    }
  }
  const r = opts.restore;
  if (r) {
    if (r.v !== SAVE_REVISION) throw new Error('this save was written by another version of the runtime');
    validateSave(r);
    pendingAsks = r.asks.map(a => ({ ...a, state: deepFreeze(a.state) }));
    if ([opts.restoreEpoch].some((e) => e !== undefined && (!Number.isSafeInteger(e) || e <= 0))) throw new Error('restored epoch is invalid');
    tick = r.tick; epoch = opts.restoreEpoch ?? r.epoch; rng = r.rng; nextId = r.nextId; seq = r.seq; overAt = r.overAt; playing = r.match[0]; restartAt = r.match[1]; trips = r.trips;
    endAsked = r.intent?.[0] === 1; finishing = r.intent?.[1] === 1;
    round = { n: r.round[0], phase: r.round[1] === 1 ? 'live' : 'over', endsAt: r.round[2], startedAt: r.round[3] };
    refreshRound();
    shared = unpackFields(c.shared, r.shared, dims); sharedChanged();
    policy = normalizeCorePolicy(r.policy ?? {});
    for (const [seat, value] of r.guideViews) guideViews.set(seat, deepFreeze(value));
    for (const w of r.ents) { const e = loadEnt(w as any[]); ents.set(e.id, e); }
    spawns = r.spawns.map((w) => loadEnt(w as any[]));
    for (const [seat, driver, owner, id, away] of r.seats) seats.set(seat, { seat, driver: driver as Driver, owner, id, away: away === 1 });
    // Checked above. Each payload is held to its shape again, so a restored one is the frozen value a live one is. A saved
    // flag cannot take a declared event past its payload's shape or make it a room announcement.
    queue = r.queue.map((q: any[]) => {
      const builtIn = q[9] === 1 && !Object.hasOwn(c.events, q[6]);
      return { due: q[0], from: q[1], fromId: q[2], seq: q[3], to: q[4], kind: q[5], ev: q[6], data: deepFreeze(builtIn ? plainData(q[7], { n: ANSWER_MAX }) : coerceFields(c.events[q[6]] ?? [], q[7], dims)), at: q[8], ...(builtIn ? { builtIn: true } : {}) };
    });
    areas = r.areas.map((a: any[]) => ({ from: a[0], fromId: a[1], seq: a[2], shape: a[3], ev: a[4], data: deepFreeze(coerceFields(c.events[a[4]] ?? [], a[5], dims)) }));
    ops = r.ops as typeof ops;
  } else startMatch();

  function decisionResult(value: unknown): Record<string, unknown> {
    const v = plainData(value, { n: ANSWER_MAX });
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : { ok: false, why: 'bad' };
  }
  function validGoal(seat: number, value: unknown): Record<string, unknown> | null {
    const v = plainData(value, { n: ANSWER_MAX }) as any;
    const def = v && typeof v.goal === 'string' && vocabulary && Object.hasOwn(vocabulary.goals, v.goal) ? vocabulary.goals[v.goal] : null;
    const players = playerBodies().filter((p) => p.driver === 'person' && !p.away).map((p) => p.seat);
    return def && !argsWhy(def.args, v.args, guideViews.get(seat) ?? null, players)
      ? deepFreeze({ goal: v.goal, args: v.args ?? {}, from: v.from === 'brain' ? 'brain' : 'floor', at: Math.max(0, Math.min(tick, Math.floor(num(v.at)) || 0)), asked: v.asked === true, state: 'active' }) : null;
  }
  return {
    round: () => ({ t: 'round', ...round, ...(round.phase === 'over' && !overAt ? { results: results() } : {}) }),
    get tick() { return tick; },
    get epoch() { return epoch; },
    step,
    answer: (n, result) => { const a = pendingAsks.find((x) => x.n === n); if (a && !a.result) a.result = decisionResult(result); },
    vocabulary: (value) => { vocabulary = value; for (const e of playerBodies()) { const savedGoal = restoredGoals.get(e.seat); const goal = e.driver === 'ai' ? validGoal(e.seat, savedGoal ?? e.goal) : null; if (savedGoal != null && vocabulary && !Object.hasOwn(vocabulary.goals, String(own(savedGoal, 'goal')))) throw new Error('saved goal is invalid'); e.goal = goal; } restoredGoals.clear(); },
    goal: (seat, value) => {
      const e = playerBodies().find((x) => x.seat === seat);
      if (!e) return null;
      if (value !== undefined) {
        e.goal = e.driver === 'ai' ? validGoal(seat, value) : null;
      }
      return e.goal;
    },
    guide: (seat, floorView) => {
      const e = playerBodies().find((x) => x.seat === seat);
      if (!e?.kind.guide || !e.kind.think || e.driver !== 'ai') return null;
      let value: Record<string, unknown> | null = null;
      const floorCall = floorView !== undefined;
      run(e.kind.name, floorCall ? 'guide.floor' : 'guide.view', e, floorCall ? 'ent' : 'none', () => {
        const g = e.kind.guide!;
        let safeView = floorView;
        if (floorCall) {
          const fv = (plainData(floorView, { n: ANSWER_MAX }) ?? {}) as Record<string, any>;
          const offered = guideViews.get(seat) ?? {};
          const players = playerBodies().filter((p) => p.driver === 'person' && !p.away).map((p) => p.seat);
          const asks = (Array.isArray(fv.asks) ? fv.asks : []).slice(0, 4).filter((a: any) => {
            const def = a && typeof a.k === 'string' && vocabulary?.asks && Object.hasOwn(vocabulary.asks, a.k) ? vocabulary.asks[a.k] : null;
            return def && players.includes(a.from) && !argsWhy(def.args, a.args, offered, players);
          }).map((a: any) => ({ k: a.k, args: plainData(a.args, { n: ANSWER_MAX }), from: a.from, at: Number.isFinite(a.at) ? a.at : 0 }));
          const goal = validGoal(seat, fv.goal);
          safeView = { ...coerceFields(c.view, floorView, dims), goal: goal ? { ...goal, state: ['active', 'done', 'failed'].includes((fv.goal as any)?.state) ? (fv.goal as any).state : 'active' } : null, asks };
        }
        const raw = floorCall ? g.floor?.(world, e.self, deepFreeze(safeView)) : g.view(world, viewOf(e));
        charge(COPY * (floorCall ? ANSWER_MAX : estFields(c.view, raw)));
        const v = floorCall ? plainData(raw, { n: ANSWER_MAX }) : coerceFields(c.view, raw, dims);
        if (floorCall && vocabulary && v && typeof v === 'object') {
          const decision = v as Record<string, unknown>;
          const players = playerBodies().filter(b => b.driver === 'person').map(b => b.seat);
          for (const [key, argKey, table] of [['goal', 'args', vocabulary.goals ?? {}], ['say', 'sayArgs', vocabulary.lines ?? {}]] as const) {
            const name = decision[key];
            if (name === undefined || name === null) continue;
            const def = typeof name === 'string' && Object.hasOwn(table, name) ? table[name] : null;
            const why = !def ? `unknown ${key} ${String(name)}; allowed names: ${Object.keys(table).join(', ') || 'none'}`
              : argsWhy(def.args, decision[argKey], guideViews.get(seat) ?? null, players);
            // Discarded whole, here and on every host: no part of a decision outside the vocabulary reaches the rules.
            if (why) { G.note?.('decision', `${key} ${said(name)}`, `${why}${def ? `; its arguments: ${Object.keys(def.args ?? {}).join(', ') || 'none'}` : ''}`); return; }
          }
        }
        if (v && typeof v === 'object' && !Array.isArray(v) && JSON.stringify(v).length <= 1900) value = v as Record<string, unknown>;
      });
      if (!floorCall && value) guideViews.set(seat, value);
      return value;
    },
    seatJoin: (info) => { ops.push({ op: 'join', info: { seat: info.seat, driver: info.driver, owner: String(info.owner ?? '').slice(0, 128) } }); },
    seatAway: (seat, away) => { ops.push({ op: 'away', seat, away }); },
    seatLeave: (seat) => { ops.push({ op: 'leave', seat }); },
    setPolicy: (p) => { policy = normalizeCorePolicy(p); },
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
      // Include all three components of position, velocity and heading in a 3D snapshot.
      snapCells = packed.n + (dims === 3 ? 13 : 10) * list.length;
      const collision = hasColliders ? collisionState() : null;
      if (collision) snapCells += 3 + collision[2].length * 8;
      return [[round.n, round.phase === 'live' ? 1 : 0, round.endsAt], list, ...(collision ? [collision] : [])];
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

/** Decisions from the wire, saved events and rule floors meet the same questions. */
function validPicks(questions: Record<string, unknown>, picks: unknown): boolean {
  if (!picks || typeof picks !== 'object' || Array.isArray(picks)) return false;
  return Object.entries(questions).every(([id, raw]) => {
    const q = raw as any; const v = (picks as Record<string, unknown>)[id];
    if (q.type === 'noul' || q.type === 'yes-no') return typeof v === 'boolean';
    if (q.type === 'score') return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < q.criteria.length;
    return typeof v === 'string' && (Array.isArray(q.criteria) ? q.criteria.includes(v) : Object.hasOwn(q.criteria, v));
  });
}
