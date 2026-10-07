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
import type { Field, FieldList, Vec3 } from './rules.ts';
import { refusedName } from './guard.ts';

const RANGE: Record<string, [number, number]> = { u8: [0, 255], u16: [0, 65535], u32: [0, 4294967295], i8: [-128, 127], i16: [-32768, 32767], i32: [-2147483648, 2147483647], tick: [0, 4294967295], ticks: [0, 4294967295] };
/** `f.fix`: steps of 1/4096, to plus or minus 2^31 (a tick count with a fraction fits for the life of any room). */
export const FIX_STEP = 4096;
const FIX_MAX = 2147483648;

export const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const AHEAD: Vec3 = Object.freeze({ x: 1, y: 0, z: 0 });
const fr = Math.fround;

/** A position or a velocity, as 32-bit floats; `z` is 0 when `dims` is 2. Anything that is not a number is 0. */
export function vec3(v: unknown, dims: number): Vec3 {
  const p = v as { x?: unknown; y?: unknown; z?: unknown } | null;
  const n = (a: unknown): number => { const x = fr(Number(a)); return Number.isFinite(x) ? x : 0; };
  return Object.freeze({ x: n(p?.x), y: n(p?.y), z: dims === 2 ? 0 : n(p?.z) });
}
/** A unit vector on the ground plane, as 32-bit floats. Too short to have a direction: +x. */
export function dir(v: unknown, dims: number): Vec3 {
  const p = vec3(v, dims);
  const l = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
  if (!(l > 1e-6)) return AHEAD;
  return Object.freeze({ x: fr(p.x / l), y: fr(p.y / l), z: fr(p.z / l) });
}

/** A value held to its declared type. Never throws: what does not fit becomes the nearest value that does. */
export function coerce(fd: Field, v: unknown, dims: number): unknown {
  switch (fd.t) {
    case 'bit': case 'press': return v === true || v === 1;
    case 'fix': { const n = Math.round(Number(v) * FIX_STEP) / FIX_STEP; return Number.isFinite(n) ? Math.max(-FIX_MAX, Math.min(FIX_MAX, n)) : 0; }
    case 'vec3': return vec3(v, dims);
    case 'dir': return dir(v, dims);
    case 'ref': return typeof v === 'string' ? v.slice(0, 24) : '';
    case 'text': return (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)).slice(0, fd.max);
    case 'list': return Array.isArray(v) ? v.slice(0, fd.max).map((x) => coerce(fd.of as Field, x, dims)) : [];
    case 'map': {
      const out: Record<string, unknown> = Object.create(null);
      if (!v || typeof v !== 'object') return out;
      let n = 0;
      for (const key of Object.keys(v as object)) {
        if (n >= (fd.max as number)) break;
        if (key.length > 32 || refusedName(key)) continue;
        out[key] = coerce(fd.of as Field, (v as Record<string, unknown>)[key], dims); n += 1;
      }
      return out;
    }
    case 'struct': {
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(fd.fields ?? {})) out[key] = coerce(sub, (v as Record<string, unknown> | null)?.[key], dims);
      return out;
    }
    default: {
      const [lo, hi] = RANGE[fd.t];
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : Number(v) === Infinity ? hi : Number(v) === -Infinity ? lo : 0;
    }
  }
}
/** The value a field starts with: its `init`, else the zero of its type. */
export function initOf(fd: Field, dims: number): unknown {
  return coerce(fd, fd.init, dims);
}
/** Whether a field's value is changed in place (a list, a map, a struct), so the runtime holds it to its type again after a handler. */
export const mutable = (fd: Field): boolean => fd.t === 'list' || fd.t === 'map' || fd.t === 'struct';

export function pack(fd: Field, v: unknown, dims: number): unknown {
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
/** A record held to its declarations: every declared field coerced, anything undeclared dropped. */
export function coerceFields(list: FieldList, values: unknown, dims: number): Record<string, unknown> {
  const v = values && typeof values === 'object' ? values as Record<string, unknown> : {};
  const out: Record<string, unknown> = {};
  for (const [name, fd] of list) out[name] = coerce(fd, v[name] === undefined ? fd.init : v[name], dims);
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
