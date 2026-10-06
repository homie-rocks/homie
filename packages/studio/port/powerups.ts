/*
 * @homie-rocks/studio/powerups: pickups the host owns, and three of them that work.
 * =============================================================================
 *
 * Power-ups are where a multiplayer game's bookkeeping goes wrong first. Who holds what, and for how much longer,
 * is state every browser must agree on; it has timers in it; and the browser that owns it can leave. The usual
 * first version keeps `shieldUntil = Date.now() + 8000` in the host's memory, and the first host migration either
 * forgets every power-up in the room or hands the new host deadlines measured on somebody else's clock.
 *
 * So everything here is ONE PLAIN OBJECT (`PowerState`) and PURE FUNCTIONS over it: each takes a state and returns
 * a new one, with the events that happened. Nothing reads a clock, a random number or the network.
 *
 *   THE CONTRACT (`PowerupContract` below spells it as types)
 *   inputs    none of its own. It reads bodies' positions; a game with a "use" button holds the item in its own
 *             state and calls `grant` when it is pressed.
 *   state     `PowerState`: pickups lying on spawn spots, who holds what, and how long each has LEFT in
 *             milliseconds. Remaining time, never a deadline: a new host carries on from "3.2 s left" without
 *             knowing what time the old host thought it was. The spawn sequence's seed is in the state too, so the
 *             next pickup is the same one whoever is hosting.
 *   netplay   host-authoritative. The host calls `stepPowerups`, `collectPowerups` and `resolveHit` in its tick
 *             and puts `packPowerups(state)` in its snapshot AND its checkpoint; replicas `unpackPowerups` and draw.
 *             It is the game's own snapshot data: the wire protocol is untouched. `powerFlags` is a bitmask per
 *             body for a game that would rather carry one small number on each body.
 *
 *   THE THREE
 *   magnet    a wider bite (`biteRadius`), and things inside its reach drift toward the mouth (`magnetPull`):
 *             the drift is what makes the wider bite read as fair on screen
 *   phase     no collisions: `collides(state, a, b)` is false while either body holds it
 *   shield    blocks ONE hit and bounces the attacker back along its own approach (`resolveHit`); the charge is
 *             spent, the timer still runs out on its own
 *
 * A game adds its own kind by adding a row to `rules.kinds` and reading `holds(state, slot, 'its-kind')`.
 *
 * DRAWING IS A THIN LAYER AT THE BOTTOM, and optional: `powerDraws` fills instance matrices (gems on spots, a ring
 * round each magnet holder, a bubble round each shield holder) for three instanced meshes the game owns, and
 * `hudPills` says what the HUD's pill shows. Neither imports a renderer, and both read only the state, so they
 * work the same on the host and on a replica.
 * =============================================================================
 */
import type { V2 } from './bots';

/** One kind of power-up. */
export interface PowerDef {
  /** How long it lasts once picked up, milliseconds. */
  ms: number;
  /** How often it spawns compared with the others (default 1). */
  weight?: number;
  /** Hits it absorbs before it is used up (a shield: 1). Absent: it only runs out on time. */
  charges?: number;
  /** What the HUD calls it. */
  label?: string;
}

export interface PowerRules {
  /** The kinds, by name. THEIR ORDER IS PART OF THE WIRE FORMAT (a kind travels as its index): add new ones last. */
  kinds: Record<string, PowerDef>;
  /** Milliseconds a spot stays empty after its pickup is taken. */
  respawnMs: number;
  /** Milliseconds before the first pickups appear (default: `respawnMs`). */
  firstMs?: number;
  /** Most pickups lying about at once. */
  maxOnField: number;
  /** How close a body's edge must be to a spot to take its pickup, in the game's units. */
  pickupRadius: number;
  magnet: { /** Bite radius is multiplied by this. */ bite: number; /** Things within `reach` bite radii drift in. */ reach: number; /** Units a second. */ pull: number };
  shield: { /** The speed the attacker is thrown back at, units a second. */ bounce: number };
}

/** Tuned on a game where bodies are about one unit across and cross the arena in ten seconds. Change freely. */
export const POWER_RULES: PowerRules = Object.freeze({
  kinds: Object.freeze({
    magnet: Object.freeze({ ms: 9000, weight: 1, label: 'Magnet' }),
    phase: Object.freeze({ ms: 6000, weight: 1, label: 'Phase' }),
    shield: Object.freeze({ ms: 12000, weight: 1, charges: 1, label: 'Shield' }),
  }),
  respawnMs: 12000,
  firstMs: 4000,
  maxOnField: 3,
  pickupRadius: 0.6,
  magnet: Object.freeze({ bite: 1.8, reach: 3, pull: 6 }),
  shield: Object.freeze({ bounce: 9 }),
}) as PowerRules;

/** A pickup lying on a spawn spot. */
export interface Pickup { id: number; spot: number; kind: string }
/** A power-up somebody holds: `left` is milliseconds remaining. */
export interface Held { slot: number; kind: string; left: number; charges: number }

export interface PowerState {
  /** Milliseconds this state has been stepped. Only for effects that want a phase; nothing compares it to a clock. */
  t: number;
  /** The spawn sequence's generator. In the state so a new host draws the same next pickup. */
  seed: number;
  nextId: number;
  pickups: Pickup[];
  /** For each spawn spot: milliseconds until it may spawn again. */
  cool: number[];
  held: Held[];
}

export type PowerEvent =
  | { type: 'spawn'; id: number; spot: number; kind: string }
  | { type: 'pickup'; id: number; spot: number; kind: string; slot: number }
  | { type: 'expire'; slot: number; kind: string }
  | { type: 'block'; slot: number; by: number }
  | { type: 'spent'; slot: number; kind: string };

/** The state as it travels in a snapshot or a checkpoint: small arrays, kinds as their index in `rules.kinds`. */
export interface PowerWire { t: number; s: number; n: number; p: [id: number, spot: number, kind: number][]; c: number[]; h: [slot: number, kind: number, left: number, charges: number][] }

/** The mechanic's contract, as types: what it reads, what it owns, what it sends, and who decides. */
export interface PowerupContract {
  /** It has no input of its own: it reads where the bodies are. */
  inputs: { bodies: readonly PowerBody[] };
  state: PowerState;
  /** In the host's snapshot and its checkpoint. Additive: a game without power-ups ignores the field. */
  wire: PowerWire;
  netplay: 'host-authoritative';
}

/** A body as the rules see it: its slot, where it is, and its radius. */
export interface PowerBody extends V2 { slot: number; r?: number }

export interface Stepped { state: PowerState; events: PowerEvent[] }

/** One draw from the state's generator: a number in [0, 1) and the next seed. */
function draw(seed: number): [number, number] {
  const a = (seed + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** A fresh state for an arena with `spots` spawn spots. */
export function createPowerups(spots: number, seed: number, rules: PowerRules = POWER_RULES): PowerState {
  const first = rules.firstMs ?? rules.respawnMs;
  // Staggered, so the spots do not all fill on one frame and then all again one respawn later.
  return { t: 0, seed: seed >>> 0, nextId: 1, pickups: [], cool: Array.from({ length: Math.max(0, spots) }, (_, i) => first + (i * rules.respawnMs) / Math.max(1, spots)), held: [] };
}

/** Time passes: timers run down, what has run out expires, and empty spots that are due get a pickup. */
export function stepPowerups(s: PowerState, dtMs: number, rules: PowerRules = POWER_RULES): Stepped {
  const dt = Math.max(0, dtMs);
  const events: PowerEvent[] = [];
  const held: Held[] = [];
  for (const h of s.held) {
    const left = h.left - dt;
    if (left > 0) held.push({ ...h, left }); else events.push({ type: 'expire', slot: h.slot, kind: h.kind });
  }
  const taken = new Set(s.pickups.map((p) => p.spot));
  const cool = s.cool.map((c, i) => (taken.has(i) ? c : Math.max(0, c - dt)));
  const pickups = s.pickups.slice();
  let seed = s.seed; let nextId = s.nextId;
  const names = Object.keys(rules.kinds);
  const total = names.reduce((n, k) => n + Math.max(0, (rules.kinds[k] as PowerDef).weight ?? 1), 0);
  for (let i = 0; i < cool.length && pickups.length < rules.maxOnField && total > 0; i += 1) {
    if (taken.has(i) || (cool[i] as number) > 0) continue;
    const [u, next] = draw(seed);
    seed = next;
    let pick = names[names.length - 1] as string; let acc = 0;
    for (const k of names) { acc += Math.max(0, (rules.kinds[k] as PowerDef).weight ?? 1); if (u * total < acc) { pick = k; break; } }
    pickups.push({ id: nextId, spot: i, kind: pick });
    events.push({ type: 'spawn', id: nextId, spot: i, kind: pick });
    nextId += 1; taken.add(i);
  }
  return { state: { t: s.t + dt, seed, nextId, pickups, cool, held }, events };
}

/** Give a slot a power-up (a pickup does; a game's own shop or a "use" button may). Holding it already refreshes it. */
export function grant(s: PowerState, slot: number, kind: string, rules: PowerRules = POWER_RULES): PowerState {
  const def = rules.kinds[kind];
  if (!def) return s;
  return { ...s, held: [...s.held.filter((h) => !(h.slot === slot && h.kind === kind)), { slot, kind, left: def.ms, charges: def.charges ?? 0 }] };
}

/**
 * Bodies take the pickups they touch. `spots` are the spawn spots' positions, in the order the state counts them.
 * When two bodies reach one pickup on the same tick the lower slot has it: a rule, so every host agrees.
 */
export function collectPowerups(s: PowerState, bodies: readonly PowerBody[], spots: readonly V2[], rules: PowerRules = POWER_RULES): Stepped {
  if (!s.pickups.length) return { state: s, events: [] };
  const order = [...bodies].sort((a, b) => a.slot - b.slot);
  const events: PowerEvent[] = [];
  let state = s;
  const left: Pickup[] = [];
  const cool = s.cool.slice();
  for (const p of s.pickups) {
    const at = spots[p.spot];
    const who = at ? order.find((b) => Math.hypot(b.x - at.x, b.y - at.y) <= rules.pickupRadius + (b.r ?? 0)) : undefined;
    if (!who) { left.push(p); continue; }
    cool[p.spot] = rules.respawnMs;
    state = grant(state, who.slot, p.kind, rules);
    events.push({ type: 'pickup', id: p.id, spot: p.spot, kind: p.kind, slot: who.slot });
  }
  return events.length ? { state: { ...state, pickups: left, cool }, events } : { state: s, events };
}

/** Whether a slot holds a kind now. */
export const holds = (s: PowerState, slot: number, kind: string): boolean => s.held.some((h) => h.slot === slot && h.kind === kind);
/** Everything a slot holds. */
export const heldBy = (s: PowerState, slot: number): Held[] => s.held.filter((h) => h.slot === slot);
/** A body left the round (or died): what it held goes with it. */
export const dropSlot = (s: PowerState, slot: number): PowerState => (s.held.some((h) => h.slot === slot) ? { ...s, held: s.held.filter((h) => h.slot !== slot) } : s);

/** Magnet: how far a slot's bite reaches, given its ordinary radius. */
export const biteRadius = (s: PowerState, slot: number, base: number, rules: PowerRules = POWER_RULES): number => (holds(s, slot, 'magnet') ? base * rules.magnet.bite : base);

/**
 * Magnet: where a loose thing is after `dtMs` of being drawn toward a holder's mouth. Unchanged when the slot holds
 * no magnet or the thing is out of reach. The host may move the real thing with it; a replica may move only what it
 * draws. Either way it never overshoots the mouth.
 */
export function magnetPull(s: PowerState, slot: number, mouth: V2, item: V2, base: number, dtMs: number, rules: PowerRules = POWER_RULES): V2 {
  if (!holds(s, slot, 'magnet')) return item;
  const dx = mouth.x - item.x; const dy = mouth.y - item.y; const d = Math.hypot(dx, dy);
  if (d < 1e-9 || d > base * rules.magnet.bite * rules.magnet.reach) return item;
  const move = Math.min(d, (rules.magnet.pull * Math.max(0, dtMs)) / 1000);
  return { x: item.x + (dx / d) * move, y: item.y + (dy / d) * move };
}

/** Phase: whether two bodies collide at all. False while either is phased. */
export const collides = (s: PowerState, a: number, b: number): boolean => !holds(s, a, 'phase') && !holds(s, b, 'phase');

export interface HitResult {
  state: PowerState;
  /** `hit`: it lands, the game applies its own damage. `blocked`: a shield took it. `phased`: it passed through. */
  outcome: 'hit' | 'blocked' | 'phased';
  /** For `blocked`: the velocity to give the attacker, back along the way it came. */
  bounce: V2 | null;
  events: PowerEvent[];
}

/**
 * Shield and phase: what happens when `attacker` hits `victim`. `toward` is the direction from the attacker to the
 * victim (any length). A shield spends one charge, and is gone when it has none left; the attacker is thrown back.
 */
export function resolveHit(s: PowerState, attacker: number, victim: number, toward: V2, rules: PowerRules = POWER_RULES): HitResult {
  if (!collides(s, attacker, victim)) return { state: s, outcome: 'phased', bounce: null, events: [] };
  const shield = s.held.find((h) => h.slot === victim && h.kind === 'shield' && h.charges > 0);
  if (!shield) return { state: s, outcome: 'hit', bounce: null, events: [] };
  const charges = shield.charges - 1;
  const events: PowerEvent[] = [{ type: 'block', slot: victim, by: attacker }];
  if (charges <= 0) events.push({ type: 'spent', slot: victim, kind: 'shield' });
  const held = charges > 0 ? s.held.map((h) => (h === shield ? { ...h, charges } : h)) : s.held.filter((h) => h !== shield);
  const d = Math.hypot(toward.x, toward.y);
  const bounce = d < 1e-9 ? { x: 0, y: 0 } : { x: 0 - (toward.x / d) * rules.shield.bounce, y: 0 - (toward.y / d) * rules.shield.bounce };
  return { state: { ...s, held }, outcome: 'blocked', bounce, events };
}

/** A slot's power-ups as one small number: bit `i` is the `i`-th kind of `rules.kinds`. For a field on each body. */
export function powerFlags(s: PowerState, slot: number, rules: PowerRules = POWER_RULES): number {
  const names = Object.keys(rules.kinds);
  let f = 0;
  for (const h of s.held) if (h.slot === slot) { const i = names.indexOf(h.kind); if (i >= 0 && i < 31) f |= 1 << i; }
  return f;
}
/** Whether a `powerFlags` number says a kind is held. */
export const flagHolds = (flags: number, kind: string, rules: PowerRules = POWER_RULES): boolean => { const i = Object.keys(rules.kinds).indexOf(kind); return i >= 0 && (flags & (1 << i)) !== 0; };

/** The state for a snapshot or a checkpoint. Times are whole milliseconds. */
export function packPowerups(s: PowerState, rules: PowerRules = POWER_RULES): PowerWire {
  const names = Object.keys(rules.kinds);
  return {
    t: Math.round(s.t), s: s.seed, n: s.nextId,
    p: s.pickups.map((p) => [p.id, p.spot, names.indexOf(p.kind)]),
    c: s.cool.map((c) => Math.round(c)),
    h: s.held.map((h) => [h.slot, names.indexOf(h.kind), Math.round(h.left), h.charges]),
  };
}

/**
 * The reverse, on a replica every snapshot and on a new host once (from the last snapshot or the checkpoint).
 * Anything malformed, or a kind this build does not know, is dropped: a stale tab reading a newer room keeps
 * running with the power-ups it understands.
 */
export function unpackPowerups(w: PowerWire | null | undefined, rules: PowerRules = POWER_RULES): PowerState {
  const names = Object.keys(rules.kinds);
  const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const o = (w ?? {}) as Partial<PowerWire>;
  const pickups: Pickup[] = [];
  for (const p of Array.isArray(o.p) ? o.p : []) { const kind = names[num(p?.[2], -1)]; if (kind !== undefined && Number.isInteger(p[0]) && Number.isInteger(p[1])) pickups.push({ id: num(p[0]), spot: num(p[1]), kind }); }
  const held: Held[] = [];
  for (const h of Array.isArray(o.h) ? o.h : []) { const kind = names[num(h?.[1], -1)]; if (kind !== undefined && Number.isInteger(h[0]) && num(h[2]) > 0) held.push({ slot: num(h[0]), kind, left: num(h[2]), charges: num(h[3]) }); }
  return { t: num(o.t), seed: num(o.s) >>> 0, nextId: Math.max(1, num(o.n, 1)), pickups, cool: (Array.isArray(o.c) ? o.c : []).map((c) => Math.max(0, num(c))), held };
}

/* ------------------------------------------------------------------ drawing (optional; no renderer imported) */

/** Where a thing is for drawing: the game's flat `x, y`, and how high above the ground (default 0). */
export interface DrawPoint extends V2 { h?: number }

export interface PowerDrawOptions {
  /** `'xz'`: a 3D game, y up, the flat `y` goes to world z (the default). `'xy'`: a flat game, z toward the viewer. */
  plane?: 'xz' | 'xy';
  /** Gem size, and how high it floats over its spot. */
  gem?: number; float?: number;
}

export interface PowerDraws {
  /** 4x4 matrices, column-major, 16 numbers each: what an InstancedMesh's `instanceMatrix.array` holds. */
  gems: Float32Array; rings: Float32Array; bubbles: Float32Array;
  /** How many of each are filled this frame: set each mesh's `count` to it. */
  gemCount: number; ringCount: number; bubbleCount: number;
  /** For each gem, its kind's index in `rules.kinds` (a colour table), and for each ring and bubble, the slot. */
  gemKinds: Uint8Array; ringSlots: Int16Array; bubbleSlots: Int16Array;
}

/** Buffers for up to `gems` pickups and `bodies` holders. Make once; `powerDraws` refills them. */
export function createPowerDraws(gems: number, bodies: number): PowerDraws {
  return { gems: new Float32Array(gems * 16), rings: new Float32Array(bodies * 16), bubbles: new Float32Array(bodies * 16), gemCount: 0, ringCount: 0, bubbleCount: 0, gemKinds: new Uint8Array(gems), ringSlots: new Int16Array(bodies), bubbleSlots: new Int16Array(bodies) };
}

/** A matrix: a turn of `spin` about the up axis, a uniform scale, then a move to `(x, y, h)` on the chosen plane. */
function place(out: Float32Array, at: number, x: number, y: number, h: number, scale: number, spin: number, xz: boolean): void {
  const c = Math.cos(spin) * scale; const s = Math.sin(spin) * scale;
  const o = at * 16;
  out.fill(0, o, o + 16);
  if (xz) { out[o] = c; out[o + 2] = -s; out[o + 5] = scale; out[o + 8] = s; out[o + 10] = c; out[o + 12] = x; out[o + 13] = h; out[o + 14] = y; }
  else { out[o] = c; out[o + 1] = s; out[o + 4] = -s; out[o + 5] = c; out[o + 10] = scale; out[o + 12] = x; out[o + 13] = y; out[o + 14] = h; }
  out[o + 15] = 1;
}

/**
 * Fill the three instance buffers from the state: a gem on every occupied spot (turning, bobbing), a ring at the
 * feet of every magnet holder (as wide as its bite), a bubble round every shield holder (breathing a little).
 * `now` is any millisecond clock the browser draws with: it only animates. Three draws, whatever the room size.
 */
export function powerDraws(s: PowerState, spots: readonly DrawPoint[], bodies: readonly (PowerBody & { h?: number })[], now: number, out: PowerDraws, rules: PowerRules = POWER_RULES, opts: PowerDrawOptions = {}): PowerDraws {
  const xz = (opts.plane ?? 'xz') === 'xz';
  const names = Object.keys(rules.kinds);
  const size = opts.gem ?? 0.45; const float = opts.float ?? 0.9;
  let g = 0;
  for (const p of s.pickups) {
    const at = spots[p.spot];
    if (!at || g >= out.gemKinds.length) continue;
    place(out.gems, g, at.x, at.y, (at.h ?? 0) + float + Math.sin(now / 420 + p.id) * 0.12, size, now / 600 + p.id, xz);
    out.gemKinds[g] = Math.max(0, names.indexOf(p.kind));
    g += 1;
  }
  let r = 0; let b = 0;
  for (const body of bodies) {
    const base = body.r ?? 0.5;
    if (holds(s, body.slot, 'magnet') && r < out.ringSlots.length) { place(out.rings, r, body.x, body.y, (body.h ?? 0) + 0.05, biteRadius(s, body.slot, base, rules), -now / 900, xz); out.ringSlots[r] = body.slot; r += 1; }
    if (holds(s, body.slot, 'shield') && b < out.bubbleSlots.length) { place(out.bubbles, b, body.x, body.y, (body.h ?? 0) + base, base * (1.35 + Math.sin(now / 300 + body.slot) * 0.04), 0, xz); out.bubbleSlots[b] = body.slot; b += 1; }
  }
  out.gemCount = g; out.ringCount = r; out.bubbleCount = b;
  return out;
}

/** One pill of the HUD: what is held, how much of its time is left (1 full, 0 gone), and its charges. */
export interface HudPill { kind: string; label: string; left: number; fraction: number; charges: number }

/** What a slot's HUD shows, soonest to run out first. */
export function hudPills(s: PowerState, slot: number, rules: PowerRules = POWER_RULES): HudPill[] {
  return heldBy(s, slot).map((h) => { const def = rules.kinds[h.kind]; return { kind: h.kind, label: def?.label ?? h.kind, left: h.left, fraction: def ? Math.max(0, Math.min(1, h.left / def.ms)) : 0, charges: h.charges }; }).sort((a, b) => a.left - b.left);
}
