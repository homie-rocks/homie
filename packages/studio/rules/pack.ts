/*
 * pack.ts — declared state in and out: holding a value to its declared type, and packing it for the wire and the save.
 * =============================================================================
 *
 * All of a rules game's state is in declared fields (rules.ts `f`). Three things follow from the declarations alone,
 * and all three are here, so neither rules nor a view ever packs or unpacks anything:
 *
 *   coerce   a value held to its type as it is written: a whole number to its range, a vector to 32-bit floats, a
 *            text to its largest length, a list to its largest size. Server, browser and build check all write
 *            through it, so they hold the same numbers.
 *   pack     a value as the frames carry it: positional, with no field names (the two ends share one build, so
 *            they share the declarations). The frames are today's JSON text frames (NETPLAY.md section 5), so the
 *            packed form is JSON arrays and numbers; a vector is `[x, y]` when `dims` is 2.
 *   unpack   the reverse.
 *
 * The whole room packed into bytes (the save of a later slice, and the rebuilt-every-tick run of the build check) is
 * `core.save()` through `toBytes` below: the same packing, with the runtime's own bookkeeping beside it.
 * =============================================================================
 */
import { cellsOf } from './rules.ts';
import type { Field, FieldList, Vec3 } from './rules.ts';
import { charge, keyCount, own, refusedName } from './guard.ts';

const RANGE: Record<string, [number, number]> = { u8: [0, 255], u16: [0, 65535], u32: [0, 4294967295], i8: [-128, 127], i16: [-32768, 32767], i32: [-2147483648, 2147483647], tick: [0, 4294967295], ticks: [0, 4294967295] };
/** `f.fix`: steps of 1/4096, to plus or minus 2^31 (a tick count with a fraction fits for the life of any room). */
export const FIX_STEP = 4096;
const FIX_MAX = 2147483648;
const fr = Math.fround;

/*
 * THE BOUNDARY. Every value that leaves rules code (what a handler returns, what it passes to a `world` call, what it
 * writes to a field, a list, `motion`, an event or an effect) comes through the functions below and nowhere else. They
 * hold three promises, and the runtime leans on all three:
 *
 *   no code of the rules runs.   A value is read by `typeof`, `Array.isArray` and its own data properties (`own`). A
 *                                number is never made with `Number(x)` nor a text with `String(x)` from an object, so
 *                                no `valueOf`, `toString`, `toJSON` or `Symbol.toPrimitive` is called; a property that
 *                                is a getter reads as absent; nothing is iterated, so no iterator runs. (A `Proxy`
 *                                would still run its traps here. Rules cannot make one: the build refuses the name.)
 *   nothing throws.              What is not a plain number, text, true or false, list or object of the declared shape
 *                                becomes the zero of that shape. The one exception is the budget's own stop, while a
 *                                handler is running (`charge`, below, for a map's keys).
 *   the work is bounded.         A list is read to its declared size and no further; a struct by its declared keys. So
 *                                the cost of holding a value to its shape is bounded by the declaration (`cellsOf`),
 *                                whatever was handed in, and `est` says in a few steps how much that will be, so the
 *                                caller charges the running handler before the work is done.
 *
 * What comes out is plain data, frozen: a list, a map and a struct are new frozen objects, a vector is a frozen
 * `{ x, y, z }`. Stored state is therefore read-only everywhere, and a query result or an event can hand it out as it
 * is, with no copy. A handler that changes a list in place is handed a copy to change (`thaw`), which is held to its
 * shape again when the handler ends.
 */

export { own };
/** A number from a plain number, true or false, or a short text. Anything else, an object above all, is NaN: nothing is called to convert it. */
export function num(v: unknown): number {
  return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'string' && v.length <= 40 ? Number(v) : NaN;
}
/** A value for a message, with nothing called to make it: a text as it is, anything else by its kind. */
export function said(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, 40) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : v === null ? 'null' : Array.isArray(v) ? 'a list' : `a value of type ${typeof v}`;
}

/** Vectors and directions this file made: frozen and already 32-bit floats, so they pass through again untouched. */
const VECS = new WeakSet<object>();
const DIRS = new WeakSet<object>();
/** Lists, maps and structs this file made, each with the declaration it was held to: the same value under the same declaration is not read twice. */
const MADE = new WeakMap<object, Field>();
const INIT = new WeakMap<Field, { v: unknown }>();
const mk = (x: number, y: number, z: number): Vec3 => { const p = Object.freeze({ x, y, z }); VECS.add(p); return p; };
const f32 = (a: unknown): number => { const x = fr(num(a)); return Number.isFinite(x) ? x : 0; };

export const ZERO: Vec3 = mk(0, 0, 0);
export const AHEAD: Vec3 = mk(1, 0, 0);
DIRS.add(AHEAD);

/** A position or a velocity, as 32-bit floats; `z` is 0 when `dims` is 2. Anything that is not a number is 0. */
export function vec3(v: unknown, dims: number): Vec3 {
  if (v === null || typeof v !== 'object') return ZERO;
  if (VECS.has(v)) { const p = v as Vec3; return dims === 2 && p.z !== 0 ? mk(p.x, p.y, 0) : p; }
  return mk(f32(own(v, 'x')), f32(own(v, 'y')), dims === 2 ? 0 : f32(own(v, 'z')));
}
/** A unit vector on the ground plane, as 32-bit floats. Too short to have a direction: +x. One that is already a unit vector is kept as it is, so a direction packs and unpacks to itself. */
export function dir(v: unknown, dims: number): Vec3 {
  if (v !== null && typeof v === 'object' && DIRS.has(v) && (dims !== 2 || (v as Vec3).z === 0)) return v as Vec3;
  const p = vec3(v, dims);
  const l2 = p.x * p.x + p.y * p.y + p.z * p.z;
  if (!(l2 > 1e-12)) return AHEAD;
  if (Math.abs(l2 - 1) <= 1e-6) { DIRS.add(p); return p; }
  const l = Math.sqrt(l2);
  const d = mk(fr(p.x / l), fr(p.y / l), fr(p.z / l));
  DIRS.add(d);
  return d;
}

const made = <T extends object>(fd: Field, o: T): T => { Object.freeze(o); MADE.set(o, fd); return o; };

/** A value held to its declared type: plain frozen data, made without running any code of the rules. What does not fit becomes the nearest value that does. */
export function coerce(fd: Field, v: unknown, dims: number): unknown {
  switch (fd.t) {
    case 'bit': case 'press': return v === true || v === 1;
    case 'fix': { const n = Math.round(num(v) * FIX_STEP) / FIX_STEP; return Number.isFinite(n) ? Math.max(-FIX_MAX, Math.min(FIX_MAX, n)) : 0; }
    case 'vec3': return vec3(v, dims);
    case 'dir': return dir(v, dims);
    case 'ref': return typeof v === 'string' ? v.slice(0, 24) : '';
    case 'text': return (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '').slice(0, fd.max);
    case 'list': {
      if (!Array.isArray(v)) return made(fd, []);
      if (MADE.get(v) === fd) return v;
      // An array's length is its own data property. No more than the declared size is read, however long the list is.
      const n = Math.min(v.length, fd.max as number);
      const out = new Array(n);
      for (let i = 0; i < n; i += 1) out[i] = coerce(fd.of as Field, own(v, i), dims);
      return made(fd, out);
    }
    case 'map': {
      const out: Record<string, unknown> = Object.create(null);
      if (v === null || typeof v !== 'object') return made(fd, out);
      if (MADE.get(v) === fd) return v;
      // The one cost here that the declaration does not bound: how many keys the value handed in has. The running handler
      // pays for each: before they are listed when the count is known (a module's constant), after when the handler made
      // the value itself (and so has already paid a unit and more for every key).
      const known = Array.isArray(v) ? undefined : keyCount(v);
      if (known !== undefined) charge(16 * known);
      const keys = Object.keys(v);
      if (known === undefined) charge(16 * keys.length);
      let n = 0;
      for (const key of keys) {
        if (n >= (fd.max as number)) break;
        if (key.length > 32 || refusedName(key)) continue;
        out[key] = coerce(fd.of as Field, own(v, key), dims); n += 1;
      }
      return made(fd, out);
    }
    case 'struct': {
      if (v !== null && typeof v === 'object' && MADE.get(v) === fd) return v;
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(fd.fields ?? {})) out[key] = coerce(sub, own(v, key), dims);
      return made(fd, out);
    }
    default: {
      const [lo, hi] = RANGE[fd.t];
      const x = num(v);
      const n = Math.round(x);
      return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : x === Infinity ? hi : x === -Infinity ? lo : 0;
    }
  }
}
/**
 * How many values holding `v` to its declaration will read, at most, found in a few steps and with no code of the
 * rules run: a list by its length (never past its declared size) times its entries' declared size, a struct field by
 * field, a map by its declaration. Never less than the work `coerce` then does, so a caller charges it first.
 */
export function est(fd: Field, v: unknown): number {
  switch (fd.t) {
    case 'list': return Array.isArray(v) ? (MADE.get(v) === fd ? 1 : 1 + Math.min(v.length, fd.max as number) * cellsOf(fd.of as Field)) : 1;
    case 'struct': {
      if (v === null || typeof v !== 'object' || MADE.get(v) === fd) return 1;
      let n = 1;
      for (const [key, sub] of Object.entries(fd.fields ?? {})) n += est(sub, own(v, key));
      return n;
    }
    case 'map': return v !== null && typeof v === 'object' && MADE.get(v) !== fd ? cellsOf(fd) : 1;
    default: return 1;
  }
}
/** `est` for a record of declared fields. */
export function estFields(list: FieldList, values: unknown): number {
  if (values === null || typeof values !== 'object') return list.length;
  let n = 0;
  for (const [name, fd] of list) n += est(fd, own(values, name));
  return n;
}
/** A copy a handler may change in place, of a value `coerce` made: lists, maps and structs are new and open, all the way down; everything else is shared. */
export function thaw(fd: Field, v: unknown): unknown {
  switch (fd.t) {
    case 'list': { const a = v as unknown[]; const out = new Array(a.length); for (let i = 0; i < a.length; i += 1) out[i] = thaw(fd.of as Field, a[i]); return out; }
    case 'map': { const out: Record<string, unknown> = Object.create(null); for (const key of Object.keys(v as object)) out[key] = thaw(fd.of as Field, (v as Record<string, unknown>)[key]); return out; }
    case 'struct': { const out: Record<string, unknown> = {}; for (const [key, sub] of Object.entries(fd.fields ?? {})) out[key] = thaw(sub, (v as Record<string, unknown>)[key]); return out; }
    default: return v;
  }
}
/** A record of declared fields as `coerce` made them, with every list, map and struct a copy that may be changed in place (a browser's own `motion`). */
export function thawFields(list: FieldList, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, fd] of list) out[name] = thaw(fd, values[name]);
  return out;
}
/** The value a field starts with: its `init`, else the zero of its type. Made once for each declaration, and shared: it is frozen. */
export function initOf(fd: Field, dims: number): unknown {
  let hit = INIT.get(fd);
  if (!hit) { hit = { v: coerce(fd, fd.init, dims) }; INIT.set(fd, hit); }
  return hit.v;
}
/** Whether a field's value is changed in place (a list, a map, a struct), so a handler is handed a copy of it and the runtime holds the copy to its type again when the handler ends. */
export const mutable = (fd: Field): boolean => fd.t === 'list' || fd.t === 'map' || fd.t === 'struct';

/** How many values `pack` has packed since this was last set to 0: the core reads it to charge a tick for the state it sends. */
export const packed = { n: 0 };

export function pack(fd: Field, v: unknown, dims: number): unknown {
  packed.n += 1;
  switch (fd.t) {
    case 'bit': case 'press': return v ? 1 : 0;
    case 'vec3': case 'dir': { const p = v as Vec3; return dims === 2 ? [p.x, p.y] : [p.x, p.y, p.z]; }
    case 'list': return (v as unknown[]).map((x) => pack(fd.of as Field, x, dims));
    case 'map': return Object.keys(v as object).sort().map((key) => [key, pack(fd.of as Field, (v as Record<string, unknown>)[key], dims)]);
    case 'struct': return Object.entries(fd.fields ?? {}).map(([key, sub]) => pack(sub, (v as Record<string, unknown>)[key], dims));
    default: return v;
  }
}
export function unpack(fd: Field, w: unknown, dims: number): unknown {
  switch (fd.t) {
    case 'vec3': case 'dir': { const a = Array.isArray(w) ? w : []; return coerce(fd, { x: a[0], y: a[1], z: a[2] ?? 0 }, dims); }
    case 'list': return coerce(fd, Array.isArray(w) ? w.map((x) => unpack(fd.of as Field, x, dims)) : [], dims);
    case 'map': { const o: Record<string, unknown> = {}; for (const e of Array.isArray(w) ? w : []) if (Array.isArray(e) && typeof e[0] === 'string') o[e[0]] = unpack(fd.of as Field, e[1], dims); return coerce(fd, o, dims); }
    case 'struct': { const a = Array.isArray(w) ? w : []; const o: Record<string, unknown> = {}; Object.entries(fd.fields ?? {}).forEach(([key, sub], i) => { o[key] = unpack(sub, a[i], dims); }); return coerce(fd, o, dims); }
    default: return coerce(fd, w, dims);
  }
}

/** A record of declared fields, packed in declaration order. */
export function packFields(list: FieldList, values: Record<string, unknown>, dims: number): unknown[] {
  const out = new Array(list.length);
  for (let i = 0; i < list.length; i += 1) out[i] = pack(list[i][1], values[list[i][0]], dims);
  return out;
}
export function unpackFields(list: FieldList, w: unknown, dims: number): Record<string, unknown> {
  const a = Array.isArray(w) ? w : [];
  const out: Record<string, unknown> = {};
  for (let i = 0; i < list.length; i += 1) out[list[i][0]] = unpack(list[i][1], a[i], dims);
  return out;
}
/** A record of declared fields with every value at its `init`. */
export function initFields(list: FieldList, dims: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, fd] of list) out[name] = initOf(fd, dims);
  return out;
}
/** A record held to its declarations: every declared field coerced, anything undeclared dropped. The record handed in is read by its own data properties only. */
export function coerceFields(list: FieldList, values: unknown, dims: number): Record<string, unknown> {
  const v = values !== null && typeof values === 'object' ? values : null;
  const out: Record<string, unknown> = {};
  for (const [name, fd] of list) { const x = v ? own(v, name) : undefined; out[name] = x === undefined ? initOf(fd, dims) : coerce(fd, x, dims); }
  return out;
}

export const packVec = (p: Vec3, dims: number): number[] => (dims === 2 ? [p.x, p.y] : [p.x, p.y, p.z]);
export const unpackVec = (a: unknown, dims: number): Vec3 => { const w = Array.isArray(a) ? a : []; return vec3({ x: w[0], y: w[1], z: w[2] ?? 0 }, dims); };

/** A saved room as bytes, and back. The save is JSON text: every number in it is one a JSON number holds exactly. */
export function toBytes(state: unknown): Uint8Array { return new TextEncoder().encode(JSON.stringify(state)); }
export function fromBytes(bytes: Uint8Array): unknown { return JSON.parse(new TextDecoder().decode(bytes)); }

/** A digest of a packed state (FNV-1a over its JSON text), for comparing two runs tick by tick. */
export function digest(state: unknown): string {
  const text = typeof state === 'string' ? state : JSON.stringify(state);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ one entity on the wire */

/** What packing an entity needs of its kind: the core's table and the view's schema both have it. */
export interface KindShape { name: string; player: unknown; fields: FieldList; motion: FieldList }
export const DRIVERS = Object.freeze(['person', 'bot', 'ai']);
/** An entity as every side holds it once unpacked. A player's body also has `seat`, `owner`, `driver` and `away`. */
export interface Unpacked {
  id: string; kind: string; r: number; pos: Vec3; vel: Vec3; heading: Vec3; grounded: boolean;
  seat?: number; owner?: string; driver?: string; away?: boolean;
  fields: Record<string, unknown>; motion: Record<string, unknown>;
}

/** One entity as a snapshot carries it: `[id, kind, r, pos, vel, heading, grounded, fields, motion]`, and for a player's body `seat, driver, away, owner` after. */
export function packEntity(kind: KindShape & { index: number }, e: { id: string; r: number; pos: Vec3; vel: Vec3; heading: Vec3; grounded: boolean; seat: number; driver: string; away: boolean; owner: string; f: Record<string, unknown>; m: Record<string, unknown> }, dims: number): unknown[] {
  const out: unknown[] = [e.id, kind.index, e.r, packVec(e.pos, dims), packVec(e.vel, dims), packVec(e.heading, dims), e.grounded ? 1 : 0, packFields(kind.fields, e.f, dims), packFields(kind.motion, e.m, dims)];
  if (kind.player) out.push(e.seat, DRIVERS.indexOf(e.driver), e.away ? 1 : 0, e.owner);
  return out;
}
export function unpackEntity(kinds: readonly KindShape[], w: unknown, dims: number): Unpacked | null {
  if (!Array.isArray(w)) return null;
  const kind = kinds[Number(w[1])];
  if (!kind || typeof w[0] !== 'string') return null;
  const out: Unpacked = {
    id: w[0], kind: kind.name, r: Number(w[2]) || 0, pos: unpackVec(w[3], dims), vel: unpackVec(w[4], dims), heading: unpackVec(w[5], dims), grounded: w[6] === 1,
    fields: unpackFields(kind.fields, w[7], dims), motion: unpackFields(kind.motion, w[8], dims),
  };
  if (kind.player) { out.seat = Number(w[9]); out.driver = DRIVERS[Number(w[10])] ?? 'bot'; out.away = w[11] === 1; out.owner = typeof w[12] === 'string' ? w[12] : ''; }
  return out;
}
