import { prepareTile } from './terrain.ts';
import { indexMap } from './map-index.ts';
/*
 * rules.ts — the rules contract, version 2: what a rules module declares, and how the runtime reads it.
 * =============================================================================
 *
 * A game is rules plus view. The rules say what is true in the game; they run in one place (the room's `Table` on the
 * studio's Cloudflare) and nothing of the browser is in them. This file is what a rules module imports:
 *
 *   import { defineRules, defineMove, f } from '@homie-rocks/studio/rules';
 *
 * `f` names the type of every piece of state. `defineMove` wraps the movement code a body runs once a tick (its own
 * file, `move.ts`, because a browser runs it too). `defineRules` wraps the module itself. Neither runs anything: they
 * mark and freeze what they are given, so a rules module has no state of its own.
 *
 * `compileRules` is the runtime's side: it reads a module once, checks every declaration against the contract and
 * returns the tables the core (core.ts), the packer (pack.ts), the host runtime (host.ts) and the view (view.ts) work
 * from. A mistake in a declaration is said here, by name, before a room ever starts.
 *
 * THE MODEL (rooms-milestone-1-design.md, section 3). Every entity owns its own state. A handler may write only the
 * entity it runs for (`self`); everything else it reads is read-only. To affect another entity it sends an event, which
 * arrives on a later tick. All state is in declared fields, each with a type and a largest size.
 *
 * No imports but the guard, erasable TypeScript only: Node, a browser bundle and the Worker all load it as it is.
 * =============================================================================
 */
import { brand, deepFreeze, own, plainData } from './guard.ts';

/** The version of the rules contract this runtime runs. Today's netplay contract is version 1. */
export const RULES_CONTRACT = 2;
/**
 * The revision of a saved room (core.ts `SavedCore`). It is raised whenever a save written before would be read
 * differently now. It is part of every game's state hash (lib/rules-check.mjs `stateHash`), so a room saved by an
 * earlier revision starts a fresh match instead of being restored wrongly. 2: a map keeps its keys in JavaScript's own
 * order (1 sorted them), and a round or a match asked to end on the tick of the save is carried.
 */
export const SAVE_REVISION = 2;
/** How far a query, a ray or an area event reaches, in metres. */
export const REACH_M = 64;
/** Rays visit indexed geometry, rather than a radius-sized entity neighbourhood. */
export const RAY_REACH_M = 10000;
/** The most entities one room holds. A spawn past it throws in the handler that asked. */
export const ENTITY_MAX = 2048;
/** The current bot-fill ceiling; public admission lives in worker/seats.mjs. */
export const SEATS_MAX = 32;
/** The most values one declared field may hold when it is full (`cellsOf`), and the most all the fields of one kind of entity may. */
export const FIELD_CELLS_MAX = 16_384;
export const KIND_CELLS_MAX = 65_536;
/** The most events and timers one room holds waiting. A send past it throws in the handler that asked. */
export const QUEUE_MAX = 16_384;

/* ------------------------------------------------------------------ field types */

export type FieldKind = 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32' | 'bit' | 'fix' | 'vec3' | 'dir' | 'tick' | 'ticks' | 'ref' | 'text' | 'list' | 'map' | 'struct' | 'press';
export interface Field {
  readonly t: FieldKind;
  /** The value a new entity starts with. */
  readonly init?: unknown;
  /** On one integer field of a player's body: this is the score a round's results rank by. */
  readonly score?: true;
  /** `text`: the most characters. `list` and `map`: the most entries. */
  readonly max?: number;
  /** `list` and `map`: what each entry is. */
  readonly of?: Field;
  /** `struct`: its fields, in order. */
  readonly fields?: Readonly<Record<string, Field>>;
}
export interface FieldOptions { init?: unknown; score?: boolean }
export type Fields = Readonly<Record<string, Field>>;

const made = (t: FieldKind, o: FieldOptions | undefined, extra: Partial<Field> = {}): Field =>
  Object.freeze({ t, ...extra, ...(o && o.init !== undefined ? { init: o.init } : {}), ...(o && o.score === true ? { score: true as const } : {}) });
const plain = (t: FieldKind) => (o?: FieldOptions): Field => made(t, o);

/**
 * The types of declared state. Whole numbers (`u8` to `u32`, `i8` to `i32`) are held to their range; `bit` is true or
 * false; `fix` is a fixed-point number in steps of 1/4096; `vec3` is a position or a velocity in metres; `dir` is a
 * unit vector in the declared dimensions; `tick` is a moment and `ticks` a length on the room's clock; `ref` is the id of an
 * entity or a player; `text`, `list` and `map` name their largest size. `press` (in `input` only) is a button that
 * fires once.
 */
export const f = brand(Object.freeze({
  u8: plain('u8'), u16: plain('u16'), u32: plain('u32'), i8: plain('i8'), i16: plain('i16'), i32: plain('i32'),
  bit: plain('bit'), fix: plain('fix'), vec3: plain('vec3'), dir: plain('dir'), tick: plain('tick'), ticks: plain('ticks'), ref: plain('ref'),
  text: (max: number, o?: FieldOptions): Field => made('text', o, { max }),
  list: (of: Field, max: number, o?: FieldOptions): Field => made('list', o, { of, max }),
  map: (of: Field, max: number, o?: FieldOptions): Field => made('map', o, { of, max }),
  struct: (fields: Fields, o?: FieldOptions): Field => made('struct', o, { fields: Object.freeze({ ...fields }) }),
  press: (): Field => made('press', undefined),
}));

/**
 * How many values a field holds when it is full: 1 for a number, a bit or a ref, 4 for a vector, 1 and one more for
 * every 64 characters of a text, and for a list, a map or a struct, itself and everything it may hold. It is what
 * copying, checking or sending the field costs at most, so the runtime charges by it (core.ts) and the contract bounds
 * it (`FIELD_CELLS_MAX`): a list of lists multiplies.
 */
const CELLS = new WeakMap<object, number>();
export function cellsOf(fd: Field): number {
  // Asked of a declaration before it has been checked, so it takes anything: what is not a field counts as one value.
  if (fd === null || typeof fd !== 'object') return 1;
  const hit = CELLS.get(fd);
  if (hit !== undefined) return hit;
  // Set before going down, and remembered after: a declaration used in many places (or one that holds itself) is counted once.
  CELLS.set(fd, 1);
  const max = typeof fd.max === 'number' && fd.max > 0 ? fd.max : 0;
  let n = 1;
  if (fd.t === 'vec3' || fd.t === 'dir') n = 4;
  else if (fd.t === 'text') n = 1 + Math.ceil(max / 64);
  else if (fd.t === 'list') n = 1 + max * cellsOf(fd.of as Field);
  else if (fd.t === 'map') n = 1 + max * (1 + cellsOf(fd.of as Field));
  else if (fd.t === 'struct' && fd.fields !== null && typeof fd.fields === 'object') for (const sub of Object.values(fd.fields)) n += cellsOf(sub);
  CELLS.set(fd, n);
  return n;
}
/** `cellsOf` for a list of declared fields. */
export const cellsOfList = (list: FieldList): number => { let n = 0; for (const [, fd] of list) n += cellsOf(fd); return n; };

/* ------------------------------------------------------------------ what a module declares */

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number }
/** Public faces are specialised by the build from declarations. Internal dispatch accepts compiled tables. */
export type { World, Self, MoveBody, MoveContext, ReadonlyState } from './types.ts';
type RuntimeWorld = Record<string, any>;
type RuntimeSelf = Record<string, any>;
export type Handler = (world: RuntimeWorld, self: RuntimeSelf, e?: any) => void;
export type RoomHandler = (world: RuntimeWorld, e?: any) => void;
export type MoveFn = (body: any, input: any, ctx: any) => void;

export type ColliderDef = true | { size?: string; enabled?: string };
export interface HitRegion { shape: 'sphere' | 'capsule' | 'box'; radius: number; height?: number; offset?: Vec3 }
export interface QueryDef { layer?: string; tags?: readonly string[]; parts?: Record<string, HitRegion>; profiles?: Record<string, Record<string, HitRegion>> }
export interface BodyDef { shape: 'circle' | 'sphere' | 'capsule' | 'box'; radius: number; height?: number; maxSpeed: number; sweep?: boolean; move?: 'owner' }
export interface GuideDef { view: (world: RuntimeWorld, self: RuntimeSelf) => unknown; floor?: (world: RuntimeWorld, self: RuntimeSelf, view: any) => unknown }
export interface EntityDef {
  player?: true | { away?: 'neutral' | 'think'; leave?: 'despawn' | 'bot'; control?: string; takeover?: string };
  fields?: Fields;
  motion?: Fields;
  input?: Fields;
  body?: BodyDef;
  collider?: ColliderDef;
  query?: QueryDef;
  guide?: GuideDef;
  tick?: Handler;
  think?: (world: RuntimeWorld, self: RuntimeSelf) => Record<string, unknown>;
  on?: Record<string, Handler>;
  commands?: Record<string, Handler>;
  onRoom?: Record<string, Handler>;
}
export interface AskDef { state: Fields; questions: Record<string, unknown>; floor: (state: any) => Record<string, unknown> }
export interface RulesDef {
  contract: 2;
  space: { dims: 2 | 3 };
  move?: Record<string, MoveFn>;
  shapes?: { events?: Record<string, Fields>; commands?: Record<string, Fields>; effects?: Record<string, Fields>; view?: Fields };
  entities: Record<string, EntityDef>;
  shared?: Fields;
  room?: {
    rounds?: { seconds: number; breakSeconds: number };
    bots?: { keep: number };
    start?: RoomHandler;
    join?: (ctx: any, player: { seat: number; driver: 'person' | 'bot' | 'ai'; owner: string }) => { kind: string; at: Vec3; heading?: Vec3; fields?: Record<string, unknown>; motion?: Record<string, unknown> };
    on?: Record<string, RoomHandler>;
  };
  asks?: Record<string, AskDef>;
  map?: string;
}

const RULES = '__rules';
const MOVE = '__move';

/** Wrap a rules module. It is frozen all the way down: a rules module has no state of its own. */
export function defineRules<R extends RulesDef>(def: R): R {
  return deepFreeze({ ...def, [RULES]: RULES_CONTRACT }) as R;
}
/** Wrap a game's movement code: one function per kind of body, `(body, input, ctx)`, run once a tick. */
export function defineMove<M extends Record<string, MoveFn>>(def: M): M {
  return deepFreeze({ ...def, [MOVE]: true }) as M;
}

/* ------------------------------------------------------------------ settings (game.json "room") */

export interface RoomSettings {
  host: 'server' | 'browser';
  offline: boolean;
  tickHz: number;
  inputHz: number;
  /** Omit the radius to send the whole room. No implicit visibility or bandwidth cap. */
  view: { radiusM: number | null; precisionM?: number; nearM?: number | null; farHz?: number | null };
  durability: { movementSeconds: number };
  budget: { tick: number };
  predict: { catchM: number | null; catchUp: number; snapM: number | null; blendMs: number; interpMs: number | null };
}
/**
 * The default `budget.tick`: 500,000 units at 20 ticks a second or fewer, and less at a faster rate, so a second of
 * ticks never has more than 10,000,000. The figure is derived from a measurement (rooms-slice-1-notes.md, "The
 * budget, measured"): the dearest charged work costs 12 to 16 ns a unit on the computer it was measured on, and a
 * tick's worst case is a budget and a half (core.ts), so the worst tick takes about 12 ms there. That is a quarter of a
 * 50 ms period, which leaves a server half as fast inside half a period, where the design wants a tick to end.
 */
export const BUDGET_TICK = 500_000;
export const BUDGET_SECOND = 10_000_000;
export const budgetFor = (tickHz: number): number => Math.min(BUDGET_TICK, Math.floor(BUDGET_SECOND / tickHz));
export const ROOM_DEFAULTS: RoomSettings = deepFreeze({
  host: 'server', offline: true, tickHz: 20, inputHz: 20, view: { radiusM: null }, durability: { movementSeconds: 1 }, budget: { tick: BUDGET_TICK },
  predict: { catchM: null, catchUp: 1.25, snapM: null, blendMs: 100, interpMs: null },
});

/** game.json `"room"`, checked: every setting has a default; a value outside its limit is said and the default kept. */
export function roomSettings(raw: unknown): { settings: RoomSettings; problems: string[] } {
  const problems: string[] = [];
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, any> : {};
  if (raw !== undefined && r !== raw) problems.push('"room" is an object of settings ({ "host": "server", "tickHz": 20 })');
  const whole = (name: string, v: unknown, lo: number, hi: number, d: number): number => {
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) { problems.push(`"room.${name}" is a whole number from ${lo} to ${hi}; using ${d}`); return d; }
    return n;
  };
  const num = (name: string, v: unknown, d: number | null): number | null => {
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) { problems.push(`"room.${name}" is a number, zero or more; using its default`); return d; }
    return n;
  };
  const known = new Set(['host', 'offline', 'tickHz', 'inputHz', 'durability', 'budget', 'predict', 'view']);
  for (const key of Object.keys(r)) if (!known.has(key)) problems.push(`"room.${key}" is not a setting (host, offline, tickHz, inputHz, durability, budget, predict, view)`);
  let host: 'server' | 'browser' = 'server';
  if (r.host !== undefined) { if (r.host === 'server' || r.host === 'browser') host = r.host; else problems.push('"room.host" is "server" or "browser"; using "server"'); }
  let offline = true;
  if (r.offline !== undefined) { if (typeof r.offline === 'boolean') offline = r.offline; else problems.push('"room.offline" is true or false; using true'); }
  const tickHz = whole('tickHz', r.tickHz, 1, 60, 20);
  const inputHz = whole('inputHz', r.inputHz, 1, tickHz, tickHz);
  if (host === 'browser' && r.view?.radiusM != null) problems.push('"room.view.radiusM" needs room.host "server"; browser hosting sends the whole room');
  if (r.view !== undefined) {
    if (!r.view || typeof r.view !== 'object' || Array.isArray(r.view)) problems.push('"room.view" is an object with an optional radiusM');
    else for (const key of Object.keys(r.view)) if (!['radiusM', 'precisionM', 'nearM', 'farHz'].includes(key)) problems.push(`"room.view.${key}" is not a setting; use radiusM, precisionM, nearM or farHz`);
  }
  const p = r.predict && typeof r.predict === 'object' ? r.predict : {};
  return {
    settings: {
      host, offline, tickHz, inputHz,
      view: { radiusM: r.view?.radiusM === null ? null : num('view.radiusM', r.view?.radiusM, null), ...(r.view?.precisionM !== undefined ? { precisionM: num('view.precisionM', r.view.precisionM, 0) as number } : {}), ...(r.view?.nearM !== undefined ? { nearM: num('view.nearM', r.view.nearM, null) } : {}), ...(r.view?.farHz !== undefined ? { farHz: whole('view.farHz', r.view.farHz, 1, tickHz, tickHz) } : {}) },
      durability: { movementSeconds: whole('durability.movementSeconds', r.durability?.movementSeconds, 1, 60, 1) },
      budget: { tick: Math.max(1, Math.floor(num('budget.tick', r.budget?.tick, budgetFor(tickHz)) as number)) },
      predict: { catchM: num('predict.catchM', p.catchM, null), catchUp: num('predict.catchUp', p.catchUp, 1.25) as number, snapM: num('predict.snapM', p.snapM, null), blendMs: num('predict.blendMs', p.blendMs, 100) as number, interpMs: num('predict.interpMs', p.interpMs, null) },
    },
    problems,
  };
}

/* ------------------------------------------------------------------ the static map */

export interface MapBox { readonly min: Vec3; readonly max: Vec3 }
export interface MapCircle { readonly at: Vec3; readonly r: number }
export interface MapHeightTile { readonly base?: number; readonly diagonal?: '00-11' | '10-01'; readonly at: Vec3; readonly size: Readonly<{ x: number; y: number }>; readonly heights: readonly [number, number, number, number] }
export interface GameMap { readonly name: string; readonly heightTiles: readonly MapHeightTile[]; readonly bounds: MapBox; readonly boxes: readonly MapBox[]; readonly circles: readonly MapCircle[]; readonly spheres: readonly MapCircle[]; readonly capsules: readonly (MapCircle & { height: number })[]; readonly spots: Readonly<Record<string, readonly Vec3[]>> }

const vecOf = (a: unknown, what: string): Vec3 => {
  const p = Array.isArray(a) ? { x: a[0], y: a[1], z: a[2] ?? 0 } : a as { x?: unknown; y?: unknown; z?: unknown } | null;
  const x = Number(p?.x); const y = Number(p?.y); const z = Number(p?.z ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error(`${what} is a point: [x, y] or [x, y, z], in metres`);
  return Object.freeze({ x, y, z });
};

/**
 * One map file (`games/<id>/map/<name>.json`), checked: `bounds` (the world's edges), `boxes` and `circles` (solid
 * shapes on the ground plane), spheres, upright capsules, height tiles and named `spots`. Positions are metres, `z` up.
 */
export function compileMap(raw: unknown, name = 'main'): GameMap {
  const m = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
  const where = `map/${name}.json`;
  if (!m.bounds) throw new Error(`${where} needs "bounds": { "min": [x, y], "max": [x, y] }, the edges of the world in metres`);
  const box = (b: any, what: string): MapBox => {
    const min = vecOf(b?.min, `${what}.min`); const max = vecOf(b?.max, `${what}.max`);
    if (!(max.x > min.x) || !(max.y > min.y) || max.z < min.z) throw new Error(`${what}: "max" is above and to the right of "min"`);
    return Object.freeze({ min, max });
  };
  const spots: Record<string, readonly Vec3[]> = {};
  for (const [key, list] of Object.entries(m.spots ?? {})) {
    if (!/^[a-z][A-Za-z0-9_-]{0,31}$/.test(key) || !Array.isArray(list)) throw new Error(`${where} spots.${key}: a spot name is a short word and holds a list of points`);
    spots[key] = Object.freeze(list.map((p, i) => vecOf(p, `${where} spots.${key}[${i}]`)));
  }
  const roundShape = (c: any, what: string): MapCircle => {
    const r = Number(c?.r);
    if (!Number.isFinite(r) || !(r > 0)) throw new Error(`${what} needs a finite positive radius`);
    return Object.freeze({ at: vecOf(c?.at, `${what}.at`), r });
  };
  if ([m.boxes, m.circles, m.spheres, m.capsules, m.heightTiles].some(list => list !== undefined && !Array.isArray(list))) throw new Error(`${where}: shapes are lists`);
  if ([m.boxes, m.circles, m.spheres, m.capsules, m.heightTiles].reduce((n, list) => n + (list?.length ?? 0), 0) > 100000) throw new Error(`${where}: at most 100000 static shapes`);
  const result = Object.freeze({
    name,
    heightTiles: Object.freeze((m.heightTiles ?? []).map((t: any, i: number) => {
      const what = `${where} heightTiles[${i}]`;
      const at = vecOf(t?.at, `${what}.at`);
      if (!Array.isArray(t.size) || t.size.length !== 2 || t.size.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) throw new Error(`${what}: size is two positive finite lengths`);
      if (!Array.isArray(t.heights) || t.heights.length !== 4 || t.heights.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v))) throw new Error(`${what}: heights are four finite offsets, in row order`);
      if (t.base !== undefined && (typeof t.base !== 'number' || !Number.isFinite(t.base) || t.heights.some((h:number) => h < t.base))) throw new Error(`${what}: base must be finite and at or below every top sample`);
      if (t.diagonal !== undefined && !['00-11','10-01'].includes(t.diagonal)) throw new Error(`${what}: diagonal is 00-11 or 10-01`);
      const tile = Object.freeze({ ...(t.base !== undefined ? {base:t.base} : {}), ...(t.diagonal ? {diagonal:t.diagonal} : {}), at, size: Object.freeze({ x: t.size[0], y: t.size[1] }), heights: Object.freeze([...t.heights]) as unknown as MapHeightTile['heights'] });
      prepareTile(tile);
      return tile;
    })),
    spheres: Object.freeze((m.spheres ?? []).map((c: any, i: number) => roundShape(c, `${where} spheres[${i}]`))),
    capsules: Object.freeze((m.capsules ?? []).map((c: any, i: number) => {
      const shape = roundShape(c, `${where} capsules[${i}]`);
      if (!Number.isFinite(c.height) || c.height < 2 * shape.r) throw new Error(`${where} capsules[${i}]: height is at least twice the radius`);
      return Object.freeze({ ...shape, height: c.height });
    })),
    bounds: box(m.bounds, `${where} bounds`),
    boxes: Object.freeze((Array.isArray(m.boxes) ? m.boxes : []).map((b: unknown, i: number) => box(b, `${where} boxes[${i}]`))),
    circles: Object.freeze((Array.isArray(m.circles) ? m.circles : []).map((c: any, i: number) => {
      const r = Number(c?.r);
      if (!Number.isFinite(r) || !(r > 0)) throw new Error(`${where} circles[${i}] needs "r", its radius in metres`);
      return Object.freeze({ at: vecOf(c?.at, `${where} circles[${i}].at`), r });
    })),
    spots: Object.freeze(spots),
  });
  indexMap(result);
  return result;
}

/* ------------------------------------------------------------------ compiled tables */

export type FieldList = readonly (readonly [string, Field])[];
export interface KindTable {
  name: string;
  index: number;
  player: null | { away: 'neutral' | 'think'; leave: 'despawn' | 'bot'; control?: string; takeover?: string };
  fields: FieldList;
  motion: FieldList;
  input: FieldList;
  collider?: ColliderDef;
  query?: QueryDef;
  body: null | { shape: string; radius: number; height: number; maxSpeed: number; sweep: boolean; owner: boolean };
  score: string | null;
  tick: Handler | null;
  think: EntityDef['think'] | null;
  on: Record<string, Handler>;
  commands: Record<string, Handler>;
  onRoom: Record<string, Handler>;
  guide: GuideDef | null;
  move: MoveFn | null;
}
export interface Compiled {
  contract: 2;
  /** `SAVE_REVISION`, so that what hashes these declarations hashes it too. */
  save: number;
  dims: 2 | 3;
  kinds: KindTable[];
  kindOf: Record<string, KindTable>;
  events: Record<string, FieldList>;
  commands: Record<string, FieldList>;
  effects: Record<string, FieldList>;
  effectNames: string[];
  shared: FieldList;
  view: FieldList;
  rounds: { seconds: number; breakSeconds: number } | null;
  bots: number;
  start: RoomHandler | null;
  join: NonNullable<RulesDef['room']>['join'] | null;
  roomOn: Record<string, RoomHandler>;
  asks: Record<string, AskDef & { stateFields: FieldList }>;
  tune: Readonly<Record<string, unknown>>;
  publicTune: Readonly<Record<string, unknown>>;
  map: GameMap;
  settings: RoomSettings;
  seats: number;
}

/** Events the runtime itself sends. A kind hears one by declaring a handler; none is declared in `shapes`. */
export const BUILT_IN_EVENTS = Object.freeze(['arrive', 'leave', 'takeover', 'undeliverable', 'answer']);
export const ROOM_EVENTS = Object.freeze(['roundStart', 'roundOver']);
export const SEAT_EVENTS = Object.freeze(['seatJoined', 'seatAway', 'seatLeft']);
/** What every entity has, whatever its kind declares. A declared field may not take one of these names. */
export const BUILT_IN_FIELDS = Object.freeze(['id', 'kind', 'pos', 'vel', 'heading', 'grounded', 'input', 'seat', 'owner', 'driver', 'away', 'goal', 'motion']);

const NAME = /^[a-z][A-Za-z0-9_]{0,31}$/;
const INTS = new Set(['u8', 'u16', 'u32', 'i8', 'i16', 'i32']);
const TYPES = new Set(['u8', 'u16', 'u32', 'i8', 'i16', 'i32', 'bit', 'fix', 'vec3', 'dir', 'tick', 'ticks', 'ref', 'text', 'list', 'map', 'struct', 'press']);

/**
 * One declared field, checked, and made again as the runtime's own: a frozen record of its type, its sizes and its
 * `init`, with nothing of what the rules handed over left in it. Its `init` is copied as plain data of a bounded size
 * (`plainData`), so no later reader of a declaration (the packer, the view's copy of the declarations as JSON) ever
 * meets a value of the rules'. `fieldList` has bounded the whole declaration before this is called (`cellsOf`).
 */
function cleanField(fd: unknown, where: string, inInput: boolean): Field {
  checkField(fd, where, inInput);
  const x = fd as Field;
  const init = own(x, 'init');
  return Object.freeze({
    t: x.t,
    ...(x.t === 'text' || x.t === 'list' || x.t === 'map' ? { max: x.max } : {}),
    ...(x.t === 'list' || x.t === 'map' ? { of: cleanField(x.of, `${where} (its entries)`, false) } : {}),
    ...(x.t === 'struct' ? { fields: Object.freeze(Object.fromEntries(Object.entries(x.fields ?? {}).map(([key, sub]) => [key, cleanField(sub, `${where}.${key}`, false)]))) } : {}),
    ...(init !== undefined ? { init: plainData(init, { n: FIELD_CELLS_MAX }, 8, 4096) } : {}),
    ...(own(x, 'score') === true ? { score: true as const } : {}),
  });
}
function checkField(fd: unknown, where: string, inInput: boolean): void {
  const x = fd as Field;
  if (!x || typeof x !== 'object' || typeof x.t !== 'string' || !TYPES.has(x.t)) throw new Error(`${where} is not a field type: declare it with f (f.u16(), f.vec3(), f.list(f.ref(), 8)…)`);
  if (x.t === 'press' && !inInput) throw new Error(`${where}: f.press() is for input only (a button that fires once)`);
  if (inInput && !(INTS.has(x.t) || x.t === 'bit' || x.t === 'press' || x.t === 'fix')) throw new Error(`${where}: an input field is a whole number, f.fix(), f.bit() or f.press()`);
  if (x.t === 'text' && !(Number.isInteger(x.max) && (x.max as number) >= 1 && (x.max as number) <= 4096)) throw new Error(`${where}: f.text(max) needs its largest length, 1 to 4096 characters`);
  if (x.t === 'list' || x.t === 'map') {
    if (!(Number.isInteger(x.max) && (x.max as number) >= 1 && (x.max as number) <= 1024)) throw new Error(`${where}: a list or a map declares its largest size, 1 to 1024 entries`);
    checkField(x.of, `${where} (its entries)`, false);
  }
  if (x.t === 'struct') for (const [key, sub] of Object.entries(x.fields ?? {})) { if (!NAME.test(key)) throw new Error(`${where}.${key} is not a field name`); checkField(sub, `${where}.${key}`, false); }
}

function fieldList(obj: unknown, where: string, { input = false, builtIns = false } = {}): FieldList {
  if (obj === undefined || obj === null) return [];
  if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${where} is a map of field names to types ({ score: f.u16() })`);
  const out: [string, Field][] = [];
  for (const [key, fd] of Object.entries(obj)) {
    if (!NAME.test(key)) throw new Error(`${where}.${key} is not a field name (a letter, then letters, digits or _)`);
    if (builtIns && BUILT_IN_FIELDS.includes(key)) throw new Error(`${where}.${key}: every entity already has "${key}"; give this field another name`);
    // Its size first, counted once however often a declaration is used inside itself: a field too large is refused before anything walks it.
    const cells = cellsOf(fd as Field);
    if (!(cells <= FIELD_CELLS_MAX)) throw new Error(`${where}.${key} may hold ${cells} values when it is full, and one field holds ${FIELD_CELLS_MAX} at most (a list of lists multiplies: give the lists smaller sizes)`);
    out.push([key, cleanField(fd, `${where}.${key}`, input)]);
  }
  return Object.freeze(out);
}

function handlers<H>(obj: unknown, where: string): Record<string, H> {
  const out: Record<string, H> = {};
  if (obj === undefined || obj === null) return out;
  if (typeof obj !== 'object') throw new Error(`${where} is a map of names to handlers`);
  for (const [key, fn] of Object.entries(obj)) {
    if (typeof fn !== 'function') throw new Error(`${where}.${key} is a function`);
    out[key] = fn as H;
  }
  return out;
}

export interface CompileEnv {
  /** tunables.json as read (each value a number, or `{ value }`), with its `public` part. */
  tune?: Record<string, unknown>;
  /** The game's map (`compileMap`). */
  map?: GameMap;
  /** game.json `"room"`, already checked (`roomSettings`). */
  settings?: RoomSettings;
  /** game.json `players.max`. */
  seats?: number;
}

/** tunables.json as rules read it: `{ speed: 6 }` from `{ "speed": { "value": 6, … } }` or `{ "speed": 6 }`; `public` holds what `move` may read. */
export function tunablesOf(raw: unknown): { tune: Record<string, unknown>; publicTune: Record<string, unknown> } {
  const value = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as object) ? (v as { value: unknown }).value : v);
  const all: Record<string, unknown> = {};
  const pub: Record<string, unknown> = {};
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  for (const [key, v] of Object.entries(r)) {
    if (key === 'public') continue;
    all[key] = value(v);
  }
  const p = r.public && typeof r.public === 'object' ? r.public as Record<string, unknown> : {};
  for (const [key, v] of Object.entries(p)) { pub[key] = value(v); all[key] = value(v); }
  return { tune: deepFreeze(all), publicTune: deepFreeze(pub) };
}

/**
 * Read a rules module once and check it against the contract. Throws, naming the declaration, when something is wrong:
 * the build fails with that line, and a `Table` whose rules do not compile refuses joins and says why.
 */
export function compileRules(def: RulesDef, env: CompileEnv = {}): Compiled {
  const d = def as RulesDef & Record<string, unknown>;
  if (!d || typeof d !== 'object' || d[RULES] !== RULES_CONTRACT) throw new Error('a rules module is `export default defineRules({ … })`');
  if (d.contract !== RULES_CONTRACT) throw new Error(`rules name their contract: contract: ${RULES_CONTRACT}`);
  const dims = d.space?.dims;
  if (dims !== 2 && dims !== 3) throw new Error('rules name their space: space: { dims: 2 } or { dims: 3 }');
  const settings = env.settings ?? ROOM_DEFAULTS;
  const map = env.map ?? compileMap({ bounds: { min: [-32, -32], max: [32, 32] } });
  if (dims === 2 && (map.spheres.length || map.capsules.length || map.heightTiles.length)) throw new Error('spheres, capsules and height tiles need space.dims: 3');
  if (dims === 3 && map.bounds.max.z <= map.bounds.min.z) throw new Error('a 3D map needs bounds with positive height');
  const { tune, publicTune } = tunablesOf(env.tune);

  const events: Record<string, FieldList> = {};
  for (const [key, shape] of Object.entries(d.shapes?.events ?? {})) {
    if ([...BUILT_IN_EVENTS, ...ROOM_EVENTS, ...SEAT_EVENTS].includes(key)) throw new Error(`shapes.events.${key}: "${key}" is an event the runtime sends itself; give yours another name`);
    events[key] = fieldList(shape, `shapes.events.${key}`);
  }
  const commands: Record<string, FieldList> = {};
  for (const [key, shape] of Object.entries(d.shapes?.commands ?? {})) commands[key] = fieldList(shape, `shapes.commands.${key}`);
  const effects: Record<string, FieldList> = {};
  for (const [key, shape] of Object.entries(d.shapes?.effects ?? {})) effects[key] = fieldList(shape, `shapes.effects.${key}`);
  const view = fieldList(d.shapes?.view, 'shapes.view');

  const move = d.move as (Record<string, MoveFn> & Record<string, unknown>) | undefined;
  if (move !== undefined && (typeof move !== 'object' || (move as Record<string, unknown>)[MOVE] !== true)) throw new Error('move is what move.ts exports: `export const move = defineMove({ … })`');

  const kinds: KindTable[] = [];
  const kindOf: Record<string, KindTable> = {};
  if (!d.entities || typeof d.entities !== 'object' || !Object.keys(d.entities).length) throw new Error('rules declare at least one kind of entity under `entities`');
  for (const [name, e] of Object.entries(d.entities)) {
    const at = `entities.${name}`;
    if (!NAME.test(name)) throw new Error(`${at} is not a kind name`);
    const fields = fieldList(e.fields, `${at}.fields`, { builtIns: true });
    const motion = fieldList(e.motion, `${at}.motion`);
    const input = fieldList(e.input, `${at}.input`, { input: true });
    const on = handlers<Handler>(e.on, `${at}.on`);
    for (const key of Object.keys(on)) if (!events[key] && !BUILT_IN_EVENTS.includes(key)) throw new Error(`${at}.on.${key}: no event "${key}" is declared in shapes.events`);
    const cmds = handlers<Handler>(e.commands, `${at}.commands`);
    for (const key of Object.keys(cmds)) if (!commands[key]) throw new Error(`${at}.commands.${key}: no command "${key}" is declared in shapes.commands`);
    const onRoom = handlers<Handler>(e.onRoom, `${at}.onRoom`);
    for (const key of Object.keys(onRoom)) if (!events[key] && !ROOM_EVENTS.includes(key)) throw new Error(`${at}.onRoom.${key}: no event "${key}" is declared in shapes.events`);
    let player: KindTable['player'] = null;
    if (e.player !== undefined && e.player !== false as unknown) {
      const p = e.player === true ? {} : e.player;
      if (!p || typeof p !== 'object') throw new Error(`${at}.player is true, or { away, leave }`);
      if (p.away !== undefined && p.away !== 'neutral' && p.away !== 'think') throw new Error(`${at}.player.away is 'neutral' or 'think'`);
      if (p.leave !== undefined && p.leave !== 'despawn' && p.leave !== 'bot') throw new Error(`${at}.player.leave is 'despawn' or 'bot'`);
      if (p.control !== undefined && !motion.some(([key, field]) => key === p.control && field.t === 'bit')) throw new Error(`${at}.player.control names a bit in motion`);
      if (p.takeover !== undefined && !fields.some(([key, field]) => key === p.takeover && ['fix','i8','i16','i32','u8','u16','u32'].includes(field.t))) throw new Error(`${at}.player.takeover names a numeric field`);
      if (p.control && typeof e.think !== 'function') throw new Error(`${at}.player.control needs think`);
      player = { away: p.away ?? 'neutral', leave: p.leave ?? 'despawn', ...(p.control ? {control:p.control}:{}), ...(p.takeover ? {takeover:p.takeover}:{}) };
      if ((player.away === 'think' || player.leave === 'bot') && typeof e.think !== 'function') throw new Error(`${at}: away: 'think' and leave: 'bot' need a think(world, self) handler to steer the body`);
    }
    let body: KindTable['body'] = null;
    if (e.body !== undefined) {
      const b = e.body;
      const shapes = dims === 2 ? ['circle'] : ['sphere', 'capsule', 'box'];
      if (!b || !shapes.includes(b.shape)) throw new Error(`${at}.body.shape is ${shapes.map((s) => `'${s}'`).join(' or ')} when space.dims is ${dims}`);
      if (typeof b.radius !== 'number' || typeof b.maxSpeed !== 'number' || !Number.isFinite(b.radius) || !Number.isFinite(b.maxSpeed) || !(b.radius > 0) || !(b.maxSpeed >= 0)) throw new Error(`${at}.body needs radius (metres) and maxSpeed (metres a second)`);
      if (b.move !== undefined && b.move !== 'owner') throw new Error(`${at}.body.move is 'owner', or left out`);
      if (dims === 3 && b.height !== undefined && (!Number.isFinite(b.height) || b.height <= 0 || b.shape === 'capsule' && b.height < b.radius * 2)) throw new Error(`${at}.body.height must be finite, positive and at least twice the radius for a capsule`);
      body = { shape: b.shape, radius: b.radius, height: dims === 3 && b.shape === 'sphere' ? 2 * b.radius : typeof b.height === 'number' && b.height > 0 ? b.height : 0, maxSpeed: b.maxSpeed, sweep: b.sweep === true, owner: b.move === 'owner' };
    }
    if (player && !body) throw new Error(`${at}: a player's kind needs a body`);
    const moveFn = move && typeof move[name] === 'function' ? move[name] as MoveFn : null;
    if (body && player && !moveFn) throw new Error(`${at}: a player's body moves with move.${name}(body, input, ctx) in move.ts`);
    const scores = fields.filter(([, fd]) => fd.score);
    if (scores.length > 1) throw new Error(`${at}.fields: one field is the score, not ${scores.length}`);
    if (scores.length && (!player || !INTS.has(scores[0][1].t))) throw new Error(`${at}.fields.${scores[0][0]}: score: true goes on one whole-number field of a player's body`);
    if (e.tick !== undefined && typeof e.tick !== 'function') throw new Error(`${at}.tick is a function`);
    if (e.think !== undefined && typeof e.think !== 'function') throw new Error(`${at}.think is a function`);
    if (e.guide !== undefined && (typeof e.guide !== 'object' || typeof e.guide?.view !== 'function')) throw new Error(`${at}.guide needs view(world, self)`);
    const cells = cellsOfList(fields) + cellsOfList(motion);
    if (cells > KIND_CELLS_MAX) throw new Error(`${at}: its fields and motion may hold ${cells} values when they are full, and one entity holds ${KIND_CELLS_MAX} at most`);
    if (e.collider !== undefined) {
      if (!body || player || body.owner) throw new Error(`${at}.collider needs a non-player body`);
      if (e.collider !== true) {
        if (!e.collider || typeof e.collider !== 'object' || Object.keys(e.collider).some(k => !['size', 'enabled'].includes(k))) throw new Error(`${at}.collider is true or {size, enabled}`);
        for (const [key, type] of [['size', 'vec3'], ['enabled', 'bit']]) {
          const name = (e.collider as Record<string, unknown>)[key];
          if (name !== undefined && (typeof name !== 'string' || !fields.some(([n, f]) => n === name && f.t === type))) throw new Error(`${at}.collider.${key} must name a ${type} field`);
        }
      }
    }
    if (e.query !== undefined) {
      const q = e.query;
      const word = (v: unknown): boolean => typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(v);
      if (!body || !q || typeof q !== 'object' || Object.keys(q).some(k => !['layer','tags','parts','profiles'].includes(k))) throw new Error(`${at}.query needs a body and {layer, tags, parts, profiles}`);
      if (q.layer !== undefined && !word(q.layer)) throw new Error(`${at}.query.layer is a short name`);
      if (q.tags !== undefined && (!Array.isArray(q.tags) || q.tags.length > 16 || !q.tags.every(word))) throw new Error(`${at}.query.tags holds at most 16 short names`);
      const groups: [string, Record<string, HitRegion>][] = [];
      if(q.parts !== undefined) groups.push(['parts',q.parts]);
      if(q.profiles !== undefined) {
        if(!q.profiles || typeof q.profiles!=='object' || Array.isArray(q.profiles) || Object.keys(q.profiles).length>8 || !Object.keys(q.profiles).every(word))throw new Error(`${at}.query.profiles holds at most eight named region sets`);
        for(const [name,parts] of Object.entries(q.profiles))groups.push([`profiles.${name}`,parts]);
      }
      for (const [group,parts] of groups) {
        if (!parts || typeof parts !== 'object' || Array.isArray(parts) || Object.keys(parts).length > 16) throw new Error(`${at}.query.${group} holds at most 16 shapes`);
        for (const [name, part] of Object.entries(parts)) {
          if (!word(name) || !part || !['sphere','capsule','box'].includes(part.shape) || !Number.isFinite(part.radius) || part.radius <= 0 || part.radius > 10000 || part.height !== undefined && (!Number.isFinite(part.height) || part.height <= 0 || part.height > 10000 || part.shape === 'capsule' && part.height < 2*part.radius) || part.offset !== undefined && !['x','y','z'].every(k => Number.isFinite((part.offset as any)[k]) && Math.abs((part.offset as any)[k]) <= 10000)) throw new Error(`${at}.query.${group}.${name} needs a finite shape, radius, height and offset`);
        }
      }
    }
    const k: KindTable = { ...(e.query ? {query: Object.freeze(e.query)} : {}), ...(e.collider ? { collider: e.collider } : {}), name, index: kinds.length, player, fields, motion, input, body, score: scores[0]?.[0] ?? null, tick: e.tick ?? null, think: e.think ?? null, on, commands: cmds, onRoom, guide: e.guide ?? null, move: moveFn };
    kinds.push(k);
    kindOf[name] = k;
  }

  if (kinds.some(k => k.collider) && kinds.some(k => k.player && k.body?.owner)) throw new Error("live colliders need server movement: omit body.move: 'owner' on players");
  const room = d.room ?? {};
  const roomOn = handlers<RoomHandler>(room.on, 'room.on');
  for (const key of Object.keys(roomOn)) if (!events[key] && !ROOM_EVENTS.includes(key) && !SEAT_EVENTS.includes(key) && key !== 'answer' && key !== 'undeliverable') throw new Error(`room.on.${key}: no event "${key}" is declared in shapes.events`);
  let rounds: Compiled['rounds'] = null;
  if (room.rounds !== undefined) {
    // A number is a number: nothing a module declares is ever turned into one.
    const s = room.rounds?.seconds; const b = room.rounds?.breakSeconds;
    if (typeof s !== 'number' || typeof b !== 'number' || !(s >= 0) || !(b >= 0)) throw new Error('room.rounds is { seconds, breakSeconds } (seconds: 0 means a round ends only when room scope ends it)');
    rounds = { seconds: s, breakSeconds: b };
  }
  const keep = room.bots === undefined ? 0 : typeof room.bots?.keep === 'number' ? Math.floor(room.bots.keep) : NaN;
  if (!(keep >= 0 && keep <= SEATS_MAX)) throw new Error(`room.bots is { keep: n }, 0 to ${SEATS_MAX}`);
  if (room.start !== undefined && typeof room.start !== 'function') throw new Error('room.start is a function');
  if (room.join !== undefined && typeof room.join !== 'function') throw new Error('room.join is a function');
  const players = kinds.filter((k) => k.player);
  if (players.length && typeof room.join !== 'function') throw new Error('room.join(ctx, player) says where a player\'s body starts: return { kind, at }');
  const asks: Compiled['asks'] = {};
  for (const [key, a] of Object.entries(d.asks ?? {})) {
    if (!a || typeof a.floor !== 'function') throw new Error(`asks.${key} needs a local floor(state) function that returns every declared question's pick; for example floor(state) { return { advance: true }; }`);
    if (!a.questions || typeof a.questions !== 'object') throw new Error(`asks.${key}.questions is required; for example { advance: { type: 'noul', instructions: 'Should the party advance?' } }`);
    asks[key] = { ...a, stateFields: fieldList(a.state, `asks.${key}.state`) };
  }
  const seats = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(env.seats)) || 8));
  return {
    contract: RULES_CONTRACT, save: SAVE_REVISION, dims, kinds, kindOf, events, commands, effects, effectNames: Object.keys(effects),
    shared: fieldList(d.shared, 'shared'), view, rounds, bots: Math.min(keep, seats), start: room.start ?? null, join: room.join ?? null, roomOn, asks,
    tune, publicTune, map, settings, seats,
  };
}

/* ------------------------------------------------------------------ what a view is handed */

/**
 * The declarations a view needs to read a room's frames, with no code in them: the build puts this in the view's
 * bundle, so none of the rules' handlers reach a browser with it.
 */
export interface Schema {
  contract: 2;
  dims: 2 | 3;
  seats: number;
  kinds: { query?: QueryDef; collider?: ColliderDef; name: string; player: boolean; control?: string; owner: boolean; radius: number; shape?: string; height?: number; maxSpeed: number; score: string | null; fields: FieldList; motion: FieldList; input: FieldList }[];
  effects: Record<string, FieldList>;
  effectNames: string[];
  commands: Record<string, FieldList>;
  shared: FieldList;
  rounds: { seconds: number; breakSeconds: number } | null;
  settings: RoomSettings;
}
export function schemaOf(c: Compiled): Schema {
  return {
    contract: RULES_CONTRACT, dims: c.dims, seats: c.seats,
    kinds: c.kinds.map((k) => ({ ...(k.query?{query:k.query}:{}), ...(k.collider?{collider:k.collider}:{}), name: k.name, player: Boolean(k.player), ...(k.player?.control ? {control:k.player.control}:{}), owner: Boolean(k.body?.owner), radius: k.body?.radius ?? 0, ...(c.dims === 3 && k.body ? { shape: k.body.shape, height: k.body.height || 2 * k.body.radius } : {}), maxSpeed: k.body?.maxSpeed ?? 0, score: k.score, fields: k.fields, motion: k.motion, input: k.input })),
    effects: c.effects, effectNames: c.effectNames, commands: c.commands, shared: c.shared, rounds: c.rounds, settings: c.settings,
  };
}
