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
import { G, charge, keyCount, own, refusedName } from './guard.ts';

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
 * WHAT IT CHANGED IS SAID, TO WHOEVER ASKS. A value that does not fit is stored as something else, here and nowhere
 * else: a number that is not one becomes 0, a list is cut to its size. A room does that in silence, as it always has, and
 * a handler is never stopped for it. The build check wants to know, so while a handler runs for a room that was given a
 * listener (`G.note`, set by core.ts `run`), each such change is told to it with the field's name (`trail`) and what
 * was done (`Adjusted`). With no listener nothing is built, counted or charged: one test of `G.note` and no more.
 * Not told, because nothing is lost that a game would not mean: rounding (a fraction in a whole number, a number to a
 * 32-bit float), an absent value taking the zero of its type, and a property a struct does not declare.
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
/*
 * ONE ZERO. JavaScript has two, and the save and every frame are JSON, which writes both as `0`. A room that kept `-0`
 * would divide by it one way before a restart and the other way after, and a browser would never have seen it at all. So
 * every number that enters state has `+ 0` added, which changes `-0` to `0` and nothing else.
 */
const mk = (x: number, y: number, z: number): Vec3 => { const p = Object.freeze({ x: x + 0, y: y + 0, z: z + 0 }); VECS.add(p); return p; };

/**
 * What was done to a written value that did not fit:
 *   nan      not a number at all (NaN, or a text, a list, nothing a number can be read from): stored as 0
 *   infinite an infinite number where a fraction or a vector belongs: stored as 0
 *   range    a whole number outside its range, an infinite one included: held to the nearest end of the range
 *   text     a text longer than declared: cut
 *   list     a list longer than declared: cut
 *   map      a map with more keys than declared: the keys past its size dropped
 *   key      a map key over 32 characters, or a name every object has: dropped
 *   kind     something that is not a list where a list belongs, or not a plain object where a map or a struct does: stored empty
 */
export type Adjusted = 'nan' | 'infinite' | 'range' | 'text' | 'list' | 'map' | 'key' | 'kind';
/** The field being held to its type, outermost first (`['runner.fields', 'bag', 3]`), kept only while somebody listens. */
const trail: (string | number)[] = [];
/** Name what is about to be held to its type (core.ts, before each `coerce` of something the rules wrote); with no name, forget it. */
export function naming(...parts: (string | number)[]): void { if (G.note !== null) { trail.length = 0; for (const p of parts) trail.push(p); } }
function note(what: Adjusted, written: unknown): void {
  let at = '';
  for (const p of trail) at += typeof p === 'number' ? `[${p}]` : at ? `.${p}` : p;
  (G.note as NonNullable<typeof G.note>)(what, at, said(written));
}
/** What the rules wrote where a list, a map or a struct belongs and is none. Absent (`undefined`, `null`) is the empty one, and is not said. */
const wrongKind = (v: unknown): void => { if (G.note !== null && v !== undefined && v !== null) note('kind', v instanceof Map ? 'a Map' : v instanceof Set ? 'a Set' : v); };
/** A number that is to be 0 because it is not finite: said, when it was written and not merely absent. */
function zeroed(v: unknown, x: number): 0 { if (G.note !== null && v !== undefined) note(x === Infinity || x === -Infinity ? 'infinite' : 'nan', v); return 0; }
const f32 = (a: unknown): number => { const n = num(a); const x = fr(n); return Number.isFinite(x) ? x : zeroed(a, n !== n ? n : x); };

export const ZERO: Vec3 = mk(0, 0, 0);
export const AHEAD: Vec3 = mk(1, 0, 0);
DIRS.add(AHEAD);

/** A position or a velocity, as 32-bit floats; `z` is 0 when `dims` is 2. Anything that is not a number is 0. */
export function vec3(v: unknown, dims: number): Vec3 {
  if (v === null || typeof v !== 'object') return ZERO;
  if (VECS.has(v)) { const p = v as Vec3; return dims === 2 && p.z !== 0 ? mk(p.x, p.y, 0) : p; }
  if (G.note === null) return mk(f32(own(v, 'x')), f32(own(v, 'y')), dims === 2 ? 0 : f32(own(v, 'z')));
  trail.push('x'); const x = f32(own(v, 'x')); trail[trail.length - 1] = 'y'; const y = f32(own(v, 'y')); trail[trail.length - 1] = 'z'; const z = dims === 2 ? 0 : f32(own(v, 'z')); trail.pop();
  return mk(x, y, z);
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
    case 'fix': { const x = num(v); const n = Math.round(x * FIX_STEP) / FIX_STEP; return Number.isFinite(n) ? Math.max(-FIX_MAX, Math.min(FIX_MAX, n)) + 0 : zeroed(v, x); }
    case 'vec3': return vec3(v, dims);
    case 'dir': return dir(v, dims);
    case 'ref': return typeof v === 'string' ? v.slice(0, 24) : '';
    case 'text': {
      const text = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
      if (G.note !== null && text.length > (fd.max as number)) note('text', `${text.length} characters for a size of ${fd.max}`);
      return text.slice(0, fd.max);
    }
    case 'list': {
      if (!Array.isArray(v)) { wrongKind(v); return made(fd, []); }
      if (MADE.get(v) === fd) return v;
      // An array's length is its own data property. No more than the declared size is read, however long the list is.
      const n = Math.min(v.length, fd.max as number);
      const out = new Array(n);
      if (G.note === null) { for (let i = 0; i < n; i += 1) out[i] = coerce(fd.of as Field, own(v, i), dims); return made(fd, out); }
      if (v.length > n) note('list', `${v.length} entries for a size of ${fd.max}`);
      for (let i = 0; i < n; i += 1) { trail.push(i); out[i] = coerce(fd.of as Field, own(v, i), dims); trail.pop(); }
      return made(fd, out);
    }
    case 'map': {
      const out: Record<string, unknown> = Object.create(null);
      if (v === null || typeof v !== 'object') { wrongKind(v); return made(fd, out); }
      if (MADE.get(v) === fd) return v;
      if (G.note !== null && (v instanceof Map || v instanceof Set)) wrongKind(v);
      // The one cost here that the declaration does not bound: how many keys the value handed in has. The running handler
      // pays for each: before they are listed when the count is known (a module's constant), after when the handler made
      // the value itself (and so has already paid a unit and more for every key).
      const known = Array.isArray(v) ? undefined : keyCount(v);
      if (known !== undefined) charge(16 * known);
      const keys = Object.keys(v);
      if (known === undefined) charge(16 * keys.length);
      let n = 0;
      for (const key of keys) {
        if (n >= (fd.max as number)) { if (G.note !== null) note('map', `${keys.length} keys for a size of ${fd.max}`); break; }
        if (key.length > 32 || refusedName(key)) { if (G.note !== null) note('key', key); continue; }
        if (G.note === null) out[key] = coerce(fd.of as Field, own(v, key), dims);
        else { trail.push(key); out[key] = coerce(fd.of as Field, own(v, key), dims); trail.pop(); }
        n += 1;
      }
      return made(fd, out);
    }
    case 'struct': {
      if (v !== null && typeof v === 'object' && MADE.get(v) === fd) return v;
      const out: Record<string, unknown> = {};
      if (G.note === null) { for (const [key, sub] of Object.entries(fd.fields ?? {})) out[key] = coerce(sub, own(v, key), dims); return made(fd, out); }
      if (typeof v !== 'object' || v instanceof Map || v instanceof Set) wrongKind(v);
      for (const [key, sub] of Object.entries(fd.fields ?? {})) { trail.push(key); out[key] = coerce(sub, own(v, key), dims); trail.pop(); }
      return made(fd, out);
    }
    default: {
      const [lo, hi] = RANGE[fd.t];
      const x = num(v);
      const n = Math.round(x);
      if (G.note !== null && v !== undefined) { if (x !== x) note('nan', v); else if (n < lo || n > hi) note('range', v); }
      return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) + 0 : x === Infinity ? hi : x === -Infinity ? lo : 0;
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
  if (!hit) {
    // A declaration is read here, by whichever handler needs it first: it is not that handler's write, so nobody is told.
    const listener = G.note; G.note = null;
    try { hit = { v: coerce(fd, fd.init, dims) }; } finally { G.note = listener; }
    INIT.set(fd, hit);
  }
  return hit.v;
}
/** Whether a field's value is changed in place (a list, a map, a struct), so a handler is handed a copy of it and the runtime holds the copy to its type again when the handler ends. */
export const mutable = (fd: Field): boolean => fd.t === 'list' || fd.t === 'map' || fd.t === 'struct';

/** A body as `move` is handed it. */
export interface MoveBody { pos: Vec3; vel: Vec3; heading: Vec3; grounded: boolean; motion: Record<string, unknown> }
/**
 * One step of a body by the game's own guarded `move`, as a browser takes it for its own body (rules/view.ts) and as the
 * build check takes it when it plays that browser: counted against `quota` as the server counts a handler, and what it
 * left rounded to 32-bit floats and held to the declared shapes as the server does it, so both hold the same numbers.
 * `used` is the units it took. What it throws goes to `failed` (the budget's own stop too) and the body is still read.
 */
export function stepMove(fn: (body: MoveBody, input: unknown, ctx: unknown) => void, body: MoveBody, input: Readonly<Record<string, unknown>>, ctx: unknown, quota: number, motion: FieldList, dims: number, failed: (error: unknown) => void): MoveBody & { used: number } {
  G.left = quota;
  const bag = coerceFields(motion, body.motion, dims);
  const target: Record<string, unknown> = {};
  const work: Record<string, unknown> = {};
  // Match core.typed: scalar writes round immediately; collections copy on first read and settle at the end.
  for (const [name, fd] of motion) {
    const held = (v: unknown): unknown => { naming('body.motion', name); const out = coerce(fd, v, dims); naming(); return out; };
    Object.defineProperty(target, name, { enumerable: true,
      get: () => {
        if (!mutable(fd)) return bag[name];
        if (work[name] === undefined) {
          const size = fd.t === 'list' ? 1 + (bag[name] as unknown[]).length * cellsOf(fd.of as Field)
            : fd.t === 'map' ? 1 + Object.keys(bag[name] as object).length * (1 + cellsOf(fd.of as Field)) : cellsOf(fd);
          charge(6 * size); work[name] = thaw(fd, bag[name]);
        }
        return work[name];
      },
      set: (v: unknown) => {
        charge(mutable(fd) ? 6 * est(fd, v) : cellsOf(fd) === 1 ? 3 : 6 * cellsOf(fd));
        bag[name] = held(v); work[name] = undefined;
      },
    });
  }
  body.motion = Object.preventExtensions(target);
  try { fn(body, input, ctx); } catch (error) { failed(error); }
  try {
    for (const [name, fd] of motion) if (work[name] !== undefined) {
      charge(6 * est(fd, work[name])); naming('body.motion', name); bag[name] = coerce(fd, work[name], dims); naming();
    }
  } catch (error) { failed(error); }
  const used = quota - (G.left > 0 ? G.left : 0);
  G.left = Infinity;
  naming('body', 'pos'); const pos = vec3(body.pos, dims); naming('body', 'vel'); const vel = vec3(body.vel, dims); naming('body', 'heading'); const heading = dir(body.heading, dims); naming();
  return { pos, vel, heading, grounded: body.grounded === true, motion: thawFields(motion, bag), used };
}

/** How many values `pack` has packed since this was last set to 0: the core reads it to charge a tick for the state it sends. */
export const packed = { n: 0 };

export function pack(fd: Field, v: unknown, dims: number): unknown {
  // One for the value, and for a text one more for every 64 characters: the same count `cellsOf` makes of a declaration.
  packed.n += fd.t === 'text' ? 1 + ((v as string).length >> 6) : 1;
  switch (fd.t) {
    case 'bit': case 'press': return v ? 1 : 0;
    case 'vec3': case 'dir': { const p = v as Vec3; return dims === 2 ? [p.x, p.y] : [p.x, p.y, p.z]; }
    case 'list': return (v as unknown[]).map((x) => pack(fd.of as Field, x, dims));
    case 'map': return Object.keys(v as object).map((key) => [key, pack(fd.of as Field, (v as Record<string, unknown>)[key], dims)]);
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
  if (G.note === null) { for (const [name, fd] of list) { const x = v ? own(v, name) : undefined; out[name] = x === undefined ? initOf(fd, dims) : coerce(fd, x, dims); } return out; }
  for (const [name, fd] of list) { const x = v ? own(v, name) : undefined; if (x === undefined) out[name] = initOf(fd, dims); else { trail.push(name); out[name] = coerce(fd, x, dims); trail.pop(); } }
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
  seat?: number; owner?: string; driver?: string; away?: boolean; goal?: unknown;
  fields: Record<string, unknown>; motion: Record<string, unknown>;
}

/** One entity as a snapshot carries it: `[id, kind, r, pos, vel, heading, grounded, fields, motion]`, and for a player's body `seat, driver, away, owner` after. */
export function packEntity(kind: KindShape & { index: number }, e: { id: string; r: number; pos: Vec3; vel: Vec3; heading: Vec3; grounded: boolean; seat: number; driver: string; away: boolean; owner: string; goal?: unknown; f: Record<string, unknown>; m: Record<string, unknown> }, dims: number): unknown[] {
  const out: unknown[] = [e.id, kind.index, e.r, packVec(e.pos, dims), packVec(e.vel, dims), packVec(e.heading, dims), e.grounded ? 1 : 0, packFields(kind.fields, e.f, dims), packFields(kind.motion, e.m, dims)];
  if (kind.player) out.push(e.seat, DRIVERS.indexOf(e.driver), e.away ? 1 : 0, e.owner, e.goal ?? null);
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
  if (kind.player) { out.seat = Number(w[9]); out.driver = DRIVERS[Number(w[10])] ?? 'bot'; out.away = w[11] === 1; out.owner = typeof w[12] === 'string' ? w[12] : ''; out.goal = w[13] ?? null; }
  return out;
}
