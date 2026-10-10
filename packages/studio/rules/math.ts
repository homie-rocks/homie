import { nearbyMap } from './map-index.ts';
import { collisionQueries } from './live.ts';
/*
 * math.ts — `world.math` and `ctx.math`: the maths rules may not take from `Math`, in plain arithmetic.
 * =============================================================================
 *
 * `Math.sin`, `cos`, `atan2`, `pow`, `exp`, `log` and `hypot` may differ in their last bits between JavaScript engines,
 * so rules that used them would step differently on the server, in a browser and in the build check. Everything here is
 * made of `+ - * /`, `Math.sqrt`, `Math.floor`, `Math.abs` and comparisons, each of which has one correct result
 * (rooms-milestone-1-design.md, section 3.3). They are accurate to about 1e-12, which is far below what a game sees;
 * what matters is that every engine gets the same bits.
 *
 * Vectors are `{ x, y, z }` in metres, `z` up. A helper returns a new frozen vector and never changes its arguments.
 * Every call is charged 4 units to the running handler's budget (guard.ts), beside what any guarded call costs.
 * =============================================================================
 */
import { castMap3, restsOnMap, type BodyShape } from './collision.ts';
import { brand, charge, own, put } from './guard.ts';
import { num } from './pack.ts';

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number }

const PI = 3.141592653589793;
const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;
const LN2 = 0.6931471805599453;

const v = (x: number, y: number, z: number): Vec3 => Object.freeze({ x, y, z });
const zOf = (a: { z?: number }): number => a.z ?? 0;

/** sin on [-pi/4, pi/4] and cos on the same range, by their Taylor series (terms to x^15 and x^16). */
function sinK(x: number): number {
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))));
}
function cosK(x: number): number {
  const x2 = x * x;
  return 1 + x2 * (-1 / 2 + x2 * (1 / 24 + x2 * (-1 / 720 + x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600 + x2 * (-1 / 87178291200 + x2 * (1 / 20922789888000))))))));
}
/** x as k quarter turns plus a remainder in [-pi/4, pi/4]. */
function reduce(x: number): [number, number] {
  const q = Math.floor(x / HALF_PI + 0.5);
  return [((q % 4) + 4) % 4, x - q * HALF_PI];
}
function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const [q, r] = reduce(x);
  return q === 0 ? sinK(r) : q === 1 ? cosK(r) : q === 2 ? -sinK(r) : -cosK(r);
}
function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const [q, r] = reduce(x);
  return q === 0 ? cosK(r) : q === 1 ? -sinK(r) : q === 2 ? -cosK(r) : sinK(r);
}
/** atan by halving the argument until it is small (atan x = 2 atan(x / (1 + sqrt(1 + x^2)))), then its series. */
function atan(x: number): number {
  if (x !== x) return NaN;
  if (x === Infinity) return HALF_PI;
  if (x === -Infinity) return -HALF_PI;
  let a = x;
  let scale = 1;
  for (let i = 0; i < 4; i += 1) { a = a / (1 + Math.sqrt(1 + a * a)); scale *= 2; }
  // The series is a - a^3/3 + a^5/5 - ...: built from the last term in, so each step multiplies by a^2.
  const a2 = a * a;
  let s = 0;
  for (let n = 12; n >= 0; n -= 1) s = (n % 2 === 0 ? 1 : -1) / (2 * n + 1) + a2 * s;
  return scale * a * s;
}
function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
}
/** exp by taking out whole powers of two (x = k ln 2 + r), then the series of e^r. */
function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.78) return Infinity;
  if (x < -745.2) return 0;
  const kq = Math.floor(x / LN2 + 0.5);
  const r = x - kq * LN2;
  let sum = 1;
  for (let n = 18; n >= 1; n -= 1) sum = 1 + (r / n) * sum;
  let out = sum;
  let p = kq;
  while (p > 0) { out *= 2; p -= 1; }
  while (p < 0) { out /= 2; p += 1; }
  return out;
}
/** log by bringing x into [sqrt(1/2), sqrt 2) with powers of two, then 2 atanh((m - 1) / (m + 1)). */
function log(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let m = x;
  let e = 0;
  while (m >= 1.4142135623730951) { m /= 2; e += 1; }
  while (m < 0.7071067811865476) { m *= 2; e -= 1; }
  const y = (m - 1) / (m + 1);
  const y2 = y * y;
  let sum = 0;
  for (let n = 14; n >= 0; n -= 1) sum = 1 / (2 * n + 1) + y2 * sum;
  return 2 * y * sum + e * LN2;
}
/** x to the y. A whole y is repeated multiplication (exact for small powers); otherwise exp(y log x). */
function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  if (Math.floor(y) === y && Math.abs(y) <= 1024) {
    let base = x;
    let n = Math.abs(y);
    let out = 1;
    while (n > 0) { if (n % 2 === 1) out *= base; base *= base; n = Math.floor(n / 2); }
    return y < 0 ? 1 / out : out;
  }
  if (x < 0) return NaN;
  if (x === 0) return y > 0 ? 0 : Infinity;
  return exp(y * log(x));
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const len = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + zOf(a) * zOf(a));

/**
 * One function of the table, charged 4 units a call. `sig` names what each argument is: `n` a number, `o` a number
 * that may be left out, `v` a vector. Anything else is refused before the function runs: arithmetic on a text would
 * join texts (and grow one without limit), and arithmetic on a list or an object would have JavaScript turn it into a
 * text first, at a cost the budget never sees.
 */
function paid<A extends unknown[], R>(name: string, sig: string, fn: (...a: A) => R): (...a: A) => R {
  const wrong = (): never => { throw new TypeError(`math.${name} takes ${sig.split('').map((s) => (s === 'v' ? 'a vector' : 'a number')).join(', ')}: a vector is { x, y, z } of numbers`); };
  return (...a: A): R => {
    charge(4);
    for (let i = 0; i < sig.length; i += 1) {
      const arg = a[i] as any;
      if (sig[i] !== 'v') { if (typeof arg !== 'number' && !(sig[i] === 'o' && arg === undefined)) wrong(); continue; }
      if (arg === null || typeof arg !== 'object') wrong();
      // Each part is read once and checked, and the function is handed a vector of those very numbers: nothing it reads can be anything else.
      const x = arg.x; const y = arg.y; const z = arg.z;
      if (typeof x !== 'number' || typeof y !== 'number' || (z !== undefined && typeof z !== 'number')) wrong();
      a[i] = { x, y, z: z ?? 0 };
    }
    return fn(...a);
  };
}

/** `world.math` and `ctx.math`. Frozen; the same object for every room. */
export const math = brand(Object.freeze({
  PI, TAU,
  sin: paid('sin', 'n', sin), cos: paid('cos', 'n', cos), tan: paid('tan', 'n', (x: number) => sin(x) / cos(x)),
  atan: paid('atan', 'n', atan), atan2: paid('atan2', 'nn', atan2),
  asin: paid('asin', 'n', (x: number) => (x < -1 || x > 1 ? NaN : atan2(x, Math.sqrt(1 - x * x)))),
  acos: paid('acos', 'n', (x: number) => (x < -1 || x > 1 ? NaN : atan2(Math.sqrt(1 - x * x), x))),
  exp: paid('exp', 'n', exp), log: paid('log', 'n', log), pow: paid('pow', 'nn', pow),
  hypot: paid('hypot', 'nno', (x: number, y: number, z: number = 0) => Math.sqrt(x * x + y * y + z * z)),
  /** Degrees to radians, and back. */
  rad: paid('rad', 'n', (deg: number) => (deg * PI) / 180),
  deg: paid('deg', 'n', (rad: number) => (rad * 180) / PI),
  clamp: paid('clamp', 'nnn', clamp),
  lerp: paid('lerp', 'nnn', (a: number, b: number, t: number) => a + (b - a) * t),
  vec: paid('vec', 'ooo', (x: number = 0, y: number = 0, z: number = 0) => v(x, y, z)),
  add: paid('add', 'vv', (a: Vec3, b: Vec3) => v(a.x + b.x, a.y + b.y, zOf(a) + zOf(b))),
  sub: paid('sub', 'vv', (a: Vec3, b: Vec3) => v(a.x - b.x, a.y - b.y, zOf(a) - zOf(b))),
  scale: paid('scale', 'vn', (a: Vec3, k: number) => v(a.x * k, a.y * k, zOf(a) * k)),
  dot: paid('dot', 'vv', (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + zOf(a) * zOf(b)),
  cross: paid('cross', 'vv', (a: Vec3, b: Vec3) => v(a.y * zOf(b) - zOf(a) * b.y, zOf(a) * b.x - a.x * zOf(b), a.x * b.y - a.y * b.x)),
  len: paid('len', 'v', len),
  dist: paid('dist', 'vv', (a: Vec3, b: Vec3) => len(v(a.x - b.x, a.y - b.y, zOf(a) - zOf(b)))),
  /** A unit vector the same way; a zero vector stays zero. */
  norm: paid('norm', 'v', (a: Vec3) => { const l = len(a); return l > 0 ? v(a.x / l, a.y / l, zOf(a) / l) : v(0, 0, 0); }),
  /** The same direction, no longer than `max`. */
  clampLen: paid('clampLen', 'vn', (a: Vec3, max: number) => { const l = len(a); return l > max && l > 0 ? v((a.x / l) * max, (a.y / l) * max, (zOf(a) / l) * max) : v(a.x, a.y, zOf(a)); }),
  lerpVec: paid('lerpVec', 'vvn', (a: Vec3, b: Vec3, t: number) => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, zOf(a) + (zOf(b) - zOf(a)) * t)),
  /** A unit vector on the ground plane at this angle (radians, from +x towards +y). */
  dir: paid('dir', 'n', (angle: number) => v(cos(angle), sin(angle), 0)),
  /** The angle of a vector on the ground plane. */
  angle: paid('angle', 'v', (a: Vec3) => atan2(a.y, a.x)),
}));
export type RulesMath = typeof math;

/** The unpaid functions, for the host runtime's own use (and the tests that hold them to `Math`'s). */
export const exact = Object.freeze({ sin, cos, atan, atan2, exp, log, pow });

/* ------------------------------------------------------------------ the ground plane: a point or a circle against the map */

/** The shapes of a map the sweep reads (rules.ts `GameMap` has them). */
export interface MapShapes { staticMap?: MapShapes; bounds: { min: Vec3; max: Vec3 }; boxes: readonly { min: Vec3; max: Vec3 }[]; circles: readonly { at: Vec3; r: number }[]; spheres?: readonly { at: Vec3; r: number }[]; capsules?: readonly { at: Vec3; r: number; height: number }[]; heightTiles?: readonly import('./rules.ts').MapHeightTile[] }
/** How close a swept body stops to what it hit, in metres. */
export const SKIN = 0.001;

export interface Hit { t: number; nx: number; ny: number; id?: string }
/** A point moving from p along d (t in 0..1) against a circle of radius R: the first touch, or null. Starting inside is no touch. */
export function rayCircle(px: number, py: number, dx: number, dy: number, cx: number, cy: number, R: number): Hit | null {
  const ox = px - cx; const oy = py - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-18) return null;
  const b = ox * dx + oy * dy;
  const cc = ox * ox + oy * oy - R * R;
  if (cc <= 0 || b >= 0) return null;
  const disc = b * b - a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0 || t > 1) return null;
  const hx = ox + dx * t; const hy = oy + dy * t;
  const l = Math.sqrt(hx * hx + hy * hy) || 1;
  return { t, nx: hx / l, ny: hy / l };
}
/** The same point against a box grown by r with round corners (a circle of radius r against the box). */
export function rayBox(px: number, py: number, dx: number, dy: number, min: Vec3, max: Vec3, r: number): Hit | null {
  let t0 = 0; let t1 = 1; let nx = 0; let ny = 0;
  const lo = [min.x - r, min.y - r]; const hi = [max.x + r, max.y + r];
  const p = [px, py]; const d = [dx, dy];
  for (let i = 0; i < 2; i += 1) {
    if (Math.abs(d[i]) < 1e-12) { if (p[i] <= lo[i] || p[i] >= hi[i]) return null; continue; }
    let ta = (lo[i] - p[i]) / d[i]; let tb = (hi[i] - p[i]) / d[i];
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) { t0 = ta; nx = i === 0 ? (d[i] > 0 ? -1 : 1) : 0; ny = i === 1 ? (d[i] > 0 ? -1 : 1) : 0; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  // No entering face: the point started inside the grown box. A body already overlapping is let out, never held.
  if (nx === 0 && ny === 0) return null;
  const hx = px + dx * t0; const hy = py + dy * t0;
  const cornerX = hx < min.x ? min.x : hx > max.x ? max.x : null;
  const cornerY = hy < min.y ? min.y : hy > max.y ? max.y : null;
  if (r > 0 && cornerX !== null && cornerY !== null) return rayCircle(px, py, dx, dy, cornerX, cornerY, r);
  return { t: t0, nx, ny };
}
/** The world's edges, as walls facing in. */
function rayBounds(px: number, py: number, dx: number, dy: number, b: { min: Vec3; max: Vec3 }, r: number): Hit | null {
  let best: Hit | null = null;
  const tryWall = (t: number, nx: number, ny: number): void => { if (t >= 0 && t <= 1 && (!best || t < best.t)) best = { t, nx, ny }; };
  if (dx > 0) tryWall((b.max.x - r - px) / dx, -1, 0);
  if (dx < 0) tryWall((b.min.x + r - px) / dx, 1, 0);
  if (dy > 0) tryWall((b.max.y - r - py) / dy, 0, -1);
  if (dy < 0) tryWall((b.min.y + r - py) / dy, 0, 1);
  return best;
}
/** A circle (or a point, r 0) moved along d against the static map: the first thing in the way, and how many shapes were tested. */
export function castMap(map: MapShapes, px: number, py: number, dx: number, dy: number, r: number, hits?: Hit[]): { hit: Hit | null; tested: number } {
  map = nearbyMap(map, {x:px,y:py,z:0}, {x:dx,y:dy,z:0}, r, 0, 2);
  charge(16 + 4 * (map.boxes.length + map.circles.length));
  let best: Hit | null = rayBounds(Math.max(map.bounds.min.x + r, Math.min(map.bounds.max.x - r, px)), Math.max(map.bounds.min.y + r, Math.min(map.bounds.max.y - r, py)), dx, dy, map.bounds, r);
  if (hits && best) hits.push(best);
  for (const b of map.boxes) { const h = rayBox(px, py, dx, dy, b.min, b.max, r); if (h && hits) hits.push(h); if (h && (!best || h.t < best.t)) best = { ...h, id: (b as any).id }; }
  for (const c of map.circles) { const h = rayCircle(px, py, dx, dy, c.at.x, c.at.y, c.r + r); if (h && hits) hits.push(h); if (h && (!best || h.t < best.t)) best = { ...h, id: (c as any).id }; }
  return { hit: best, tested: 4 + map.boxes.length + map.circles.length };
}

/**
 * `ctx.map.sweep(body, delta)`: move `body.pos` along `delta` and stop at the first static shape in the way. The server
 * and a browser both move a body with this, so they agree to the last bit. Returns nothing, or `{ at, normal }`.
 * The 2D path charges 20 units and 4 per shape; 3D also charges each convex cast and terrain tile. With `dims` 2 a body always rests on the ground.
 */
export function sweepMap(map: MapShapes, body: unknown, delta: unknown, radius: number, dims: number, shape: BodyShape = { shape: 'sphere', radius, height: 2 * radius }): unknown {
  // Charged before the cast, for every shape of the map it may test.
  charge(20);
  const fr = Math.fround;
  // Both are whatever `move` handed over: each is read as a plain number or as nothing, and nothing is called to convert it.
  const num = (a: unknown): number => { const x = typeof a === 'number' ? fr(a) : 0; return Number.isFinite(x) ? x : 0; };
  if (body === null || typeof body !== 'object') throw new TypeError('ctx.map.sweep(body, delta) takes the body move was handed');
  const pos = own(body, 'pos');
  const dx = num(own(delta, 'x')); const dy = num(own(delta, 'y'));
  const px = num(own(pos, 'x')); const py = num(own(pos, 'y'));
  if (dims === 3) {
    const p = v(px, py, num(own(pos, 'z'))), d = v(dx, dy, num(own(delta, 'z')));
    const h = castMap3(map, p, d, shape);
    const length = Math.sqrt(dx * dx + dy * dy + d.z * d.z);
    const t = h ? Math.max(0, h.t - (length > 0 ? SKIN / length : 0)) : 1;
    const at = v(fr(px + dx * t), fr(py + dy * t), fr(p.z + d.z * t));
    put(body, 'pos', at); put(body, 'grounded', restsOnMap(map, at, shape));
    return h ? Object.freeze({ at, normal: v(h.nx, h.ny, h.nz), ...(h.id ? { entity: h.id } : {}) }) : undefined;
  }
  const { hit: h } = castMap(map, px, py, dx, dy, radius);
  put(body, 'grounded', true);
  if (!h) { put(body, 'pos', v(fr(px + dx), fr(py + dy), 0)); return undefined; }
  const l = Math.sqrt(dx * dx + dy * dy);
  const t = l > 0 ? Math.max(0, h.t - SKIN / l) : 0;
  const at = v(fr(px + dx * t), fr(py + dy * t), 0);
  put(body, 'pos', at);
  return Object.freeze({ at, normal: v(h.nx, h.ny, 0), ...(h.id ? { entity: h.id } : {}) });
}

/**
 * What a browser hands the game's `move` as `ctx`: the tick, the step, the public tunables, this maths and the static
 * map. One function, so that the browser (view.ts) and the person the build check plays hold the same one. The
 * server's own (core.ts `moveCtx`) is made beside the rest of its world, and charges as that does.
 */
export function moveContext(o: { tick: () => number; tickHz: number; tune: unknown; map: MapShapes; name: string; spots: Readonly<Record<string, readonly unknown[]>>; radius: () => number; shape?: () => BodyShape; dims: number; geometry?: () => MapShapes }): unknown {
  const none = Object.freeze([]);
  const queries = collisionQueries(() => o.geometry?.() ?? o.map, () => o.shape?.() ?? {shape: 'sphere', radius: o.radius(), height: 2 * o.radius()}, o.dims);
  return brand(Object.freeze({
    get tick() { return o.tick(); }, dt: 1 / o.tickHz, tune: o.tune, math,
    // As the server's `ctx.ticks` reads it: a plain number, or nothing.
    ticks: (seconds: unknown): number => { const s = num(seconds); const n = Math.round(s * o.tickHz); return s > 0 && Number.isFinite(n) ? Math.max(1, n) : 0; },
    world: brand(Object.freeze(queries)),
    map: brand(Object.freeze({ name: o.name, spot: (name: string) => (own(o.spots, name) as readonly unknown[] | undefined)?.[0], spots: (name: string) => own(o.spots, name) ?? none, ...queries })),
  }));
}
