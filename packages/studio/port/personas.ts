/*
 * @homie-rocks/studio/personas: bots that want different things.
 * =============================================================================
 *
 * A room of bots that all run the same "go to the nearest thing" code reads as one bot drawn several times. What
 * makes them read as characters is not smarter code, it is DIFFERENT WANTS: one crosses the map for the biggest
 * prize, one hunts other players, one keeps its speed up, one tidies up scraps, one stays away from everybody.
 *
 * So a persona here is a row of weights and nothing else, over one scorer:
 *
 *     score = kind weight x value^valuePow / (distance + near)^distPow x facing x sight x company x size
 *
 *   facing    a target behind costs up to `heading` of its score (a racer will not turn round; a glutton will)
 *   sight     a target with a wall in the way costs up to `blind` of it (line of sight over the game's own
 *             `solid(x, y)`: the same function its walls already answer)
 *   company   every rival near the target raises (a bully) or lowers (a sneak) it by `crowd`
 *   size      a rival bigger than the bot costs up to `bigger` of it: nobody picks a fight they lose
 *
 * FIVE ARE BUILT IN (glutton, bully, racer, scavenger, sneak) and a game extends one with `persona('sneak', {...})`
 * or writes its own row. The kinds they weigh ('food', 'scrap', 'rival', 'power', 'gate') are only names: a game
 * tags its candidates with whichever fit, and any other kind scores at the persona's `other`.
 *
 * IT FITS THE PORT KIT'S BotBrain, it does not replace it. BotBrain is the bot's LIMITS (it reacts late, aims a
 * little off, commits for a while: the room's skill dial); a persona is what it WANTS. `brain.chooser(...)` is the
 * `choose` function BotBrain.think takes, so the dial keeps working:
 *
 *     const who = createPersonaBrain(PERSONAS.bully, { rng, arena: { solid } });
 *     const stick = botBrain.think(now, pos, who.chooser(() => self, () => candidates, () => rivals));
 *     const push = who.steer(self, stick);            // the same push, turned off any wall ahead
 *
 * TELEMETRY IS PART OF IT, because "the personas differ" is a claim, and a weight table that produces five bots
 * who all end up eating the nearest pellet is the usual result of tuning by eye. Every brain counts what it picked
 * (`stats()`), `botStats` puts brains side by side, and `personaSpread` is one number for how unlike each other
 * they were. A game's own test runs its arena and asserts on those.
 *
 * DETERMINISTIC: the only randomness is the `rng` you pass (`seededRng(seed)` is one), drawn once a pick and only
 * when the persona is `fickle`. The host owns the bots, so the same seed and the same world give the same game.
 *
 * Positions are the game's own flat units: `x, y` on the ground plane (a 3D game passes x and z).
 * =============================================================================
 */
import type { V2 } from './bots';

/** Something a bot could go for. `value` is the game's own measure (points, mass, seconds saved): more is better. */
export interface Candidate extends V2 {
  kind: string;
  value: number;
  id?: string | number;
  /** For a `rival`: how big it is, in the same measure as the bot's own `size`. */
  size?: number;
}
/** Another body in the arena, for `crowd`: a player or a bot, not the bot itself. */
export interface Rival extends V2 { size?: number }
/** The bot: where it is, which way it faces (radians, `atan2(y, x)`), and how big it is. */
export interface BotSelf extends V2 { heading: number; size?: number }

/** A row of weights. Every field is a number a game may change. */
export interface Persona {
  name: string;
  /** How much each kind of candidate is wanted. A kind not listed scores at `other`. */
  kinds: Record<string, number>;
  other: number;
  /** How much a bigger prize matters: 0 ignores value, 1 is proportional, 2 chases the jackpot. */
  valuePow: number;
  /** How much distance matters: 0 ignores it, 1 is value per metre, 2 hardly leaves the spot. */
  distPow: number;
  /** 0 to 1: the share of a target's score lost when it is directly behind. */
  heading: number;
  /** 0 to 1: the share lost when a wall is between the bot and the target. */
  blind: number;
  /** For each rival near the target: above 0 raises its score by this share, below 0 lowers it. */
  crowd: number;
  /** 0 to 1: the share of a rival's score lost when the rival is bigger than the bot. */
  bigger: number;
  /** How hard it turns away from a wall ahead (0 not at all, 1 fully). */
  wall: number;
  /** 0 to 1: random spread on every score, from the injected rng. 0 draws nothing. */
  fickle: number;
}

export type PersonaName = 'glutton' | 'bully' | 'racer' | 'scavenger' | 'sneak';

/** The five. Frozen: extend one with `persona()`. */
export const PERSONAS: Readonly<Record<PersonaName, Persona>> = Object.freeze({
  /** Crosses the arena for the biggest prize and barely notices anybody. */
  glutton: Object.freeze({ name: 'glutton', kinds: { food: 1, scrap: 0.5, power: 0.6, rival: 0.05, gate: 0.2 }, other: 0.3, valuePow: 2, distPow: 0.5, heading: 0.1, blind: 0.2, crowd: 0, bigger: 0.9, wall: 0.7, fickle: 0 }),
  /** Goes for other bodies, smaller ones first, and for whatever they are near. */
  bully: Object.freeze({ name: 'bully', kinds: { rival: 4, power: 1, food: 0.3, scrap: 0.4, gate: 0.1 }, other: 0.3, valuePow: 1, distPow: 1, heading: 0.3, blind: 0.5, crowd: 0.4, bigger: 0.9, wall: 0.7, fickle: 0 }),
  /** Keeps its line: what is ahead beats what is better, and gates beat everything. */
  racer: Object.freeze({ name: 'racer', kinds: { gate: 4, power: 1.2, food: 0.5, scrap: 0.2, rival: 0.05 }, other: 0.3, valuePow: 0.5, distPow: 1, heading: 0.95, blind: 0.6, crowd: 0, bigger: 0.9, wall: 1, fickle: 0 }),
  /** Takes the nearest small thing, and scraps before anything fresh. */
  scavenger: Object.freeze({ name: 'scavenger', kinds: { scrap: 4, food: 1, power: 0.5, rival: 0.02, gate: 0.1 }, other: 0.5, valuePow: 0.25, distPow: 2, heading: 0.2, blind: 0.7, crowd: -0.15, bigger: 1, wall: 0.7, fickle: 0 }),
  /** Wants whatever nobody is near, and power-ups most of all. */
  sneak: Object.freeze({ name: 'sneak', kinds: { power: 2.5, food: 1, scrap: 1.5, rival: 0.3, gate: 0.2 }, other: 0.5, valuePow: 0.6, distPow: 1, heading: 0.2, blind: 0.1, crowd: -0.9, bigger: 1, wall: 0.8, fickle: 0 }),
});

/** A built-in persona with some weights changed (its `kinds` are merged, not replaced). */
export function persona(base: PersonaName | Persona, change: Partial<Persona> = {}): Persona {
  const b = typeof base === 'string' ? PERSONAS[base] : base;
  return { ...b, ...change, kinds: { ...b.kinds, ...(change.kinds ?? {}) } };
}

/** What a persona's choices are made in. */
export interface Arena {
  /** The game's own collision: true where a body cannot be. Without it nothing is ever blind or avoided. */
  solid?: (x: number, y: number) => boolean;
  /** Units between samples along a line of sight (default 0.5). Smaller than the thinnest wall. */
  sightStep?: number;
  /** Units added to every distance, so a thing underfoot does not score infinitely (default 1). */
  near?: number;
  /** How close to a target a rival counts as company (default 6). */
  crowdRadius?: number;
  /** How far ahead a bot feels for walls (default 3). */
  look?: number;
}

/** Whether a straight line between two points is free of `solid`, sampled every `step`. The ends are not tested. */
export function lineOfSight(a: V2, b: V2, solid: (x: number, y: number) => boolean, step = 0.5): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.ceil(d / Math.max(1e-6, step));
  for (let i = 1; i < n; i += 1) if (solid(a.x + (b.x - a.x) * (i / n), a.y + (b.y - a.y) * (i / n))) return false;
  return true;
}

/** One candidate's score for one persona, with the parts it was made from (they are what the telemetry counts). */
export interface Scored { c: Candidate; score: number; dist: number; facing: number; seen: boolean; company: number }

export function scoreCandidate(self: BotSelf, c: Candidate, p: Persona, arena: Arena = {}, rivals: readonly Rival[] = []): Scored {
  const dx = c.x - self.x; const dy = c.y - self.y; const dist = Math.hypot(dx, dy);
  // 1 dead ahead, -1 directly behind; a thing underfoot is "ahead".
  const facing = dist < 1e-9 ? 1 : (dx * Math.cos(self.heading) + dy * Math.sin(self.heading)) / dist;
  const seen = arena.solid ? lineOfSight(self, c, arena.solid, arena.sightStep ?? 0.5) : true;
  const r = arena.crowdRadius ?? 6;
  let company = 0;
  // A rival that IS the candidate (the same spot) is not its own company.
  for (const o of rivals) if (!(o.x === c.x && o.y === c.y) && Math.hypot(o.x - c.x, o.y - c.y) <= r) company += 1;
  let score = (p.kinds[c.kind] ?? p.other) * Math.pow(Math.max(0, c.value), p.valuePow) / Math.pow(dist + (arena.near ?? 1), p.distPow);
  score *= 1 - p.heading * (1 - facing) / 2;
  if (!seen) score *= 1 - p.blind;
  score *= Math.max(0, 1 + p.crowd * company);
  if (c.kind === 'rival' && c.size !== undefined && self.size !== undefined && c.size > self.size) score *= 1 - p.bigger;
  return { c, score, dist, facing, seen, company };
}

/** The best candidate for a persona, or null when there is none worth anything. Ties go to the one listed first. */
export function pickCandidate(self: BotSelf, candidates: readonly Candidate[], p: Persona, arena: Arena = {}, rivals: readonly Rival[] = [], rng?: () => number, keep?: Candidate | null): Scored | null {
  let best: Scored | null = null;
  for (const c of candidates) {
    const s = scoreCandidate(self, c, p, arena, rivals);
    // A little loyalty to the target it already has, so two near-equal prizes do not make it dither between them.
    if (keep && (c === keep || (c.id !== undefined && c.id === keep.id))) s.score *= 1.25;
    if (p.fickle > 0 && rng) s.score *= 1 + (rng() - 0.5) * 2 * p.fickle;
    if (s.score > 0 && (!best || s.score > best.score)) best = s;
  }
  return best;
}

/**
 * Turn a push away from a wall ahead: three feelers (ahead, and 40 degrees to each side) `look` units long over the
 * game's `solid`. A blocked feeler turns the push toward the open side by `strength`. `steered` says it had to.
 */
export function avoidWalls(pos: V2, push: V2, solid: (x: number, y: number) => boolean, look = 3, strength = 1): V2 & { steered: boolean } {
  const m = Math.hypot(push.x, push.y);
  if (m < 1e-9 || strength <= 0) return { x: push.x, y: push.y, steered: false };
  const a = Math.atan2(push.y, push.x);
  // How far each feeler gets before something solid, as a share of its length.
  const feel = (off: number): number => {
    for (let i = 1; i <= 6; i += 1) { const d = (look * i) / 6; if (solid(pos.x + Math.cos(a + off) * d, pos.y + Math.sin(a + off) * d)) return (i - 1) / 6; }
    return 1;
  };
  const ahead = feel(0); const left = feel(0.7); const right = feel(-0.7);
  if (ahead >= 1 && left >= 1 && right >= 1) return { x: push.x, y: push.y, steered: false };
  // Turn toward whichever side is more open; with nothing to choose between them, left, every time.
  const turn = (left >= right ? 1 : -1) * strength * (1 - Math.min(ahead, left, right)) * 1.2;
  return { x: Math.cos(a + turn) * m, y: Math.sin(a + turn) * m, steered: true };
}

/** What one brain did, counted. The numbers a game's test asserts on to show its personas differ. */
export interface BotStats {
  persona: string;
  /** Times it was asked, and times it changed to a different target. */
  thinks: number; picks: number;
  /** Picks of each kind. */
  byKind: Record<string, number>;
  /** Means over its picks: the prize's value, the distance to it, how far ahead it was (1 ahead, -1 behind), rivals near it. */
  meanValue: number; meanDist: number; meanFacing: number; meanCompany: number;
  /** Picks made with a wall in the way, and pushes that had to be turned off a wall. */
  blindPicks: number; wallSteers: number;
}

export interface PersonaBrain {
  readonly persona: Persona;
  /** The target in force (the last pick), or null. */
  readonly target: Candidate | null;
  /** Pick now. Counted as a pick only when the target changes. */
  choose(self: BotSelf, candidates: readonly Candidate[], rivals?: readonly Rival[]): Candidate | null;
  /** The same, shaped as the `choose` BotBrain.think takes. */
  chooser(self: () => BotSelf, candidates: () => readonly Candidate[], rivals?: () => readonly Rival[]): () => Candidate | null;
  /** A push (a stick vector) turned away from walls, by this persona's `wall` weight. */
  steer(self: V2, push: V2): V2;
  stats(): BotStats;
  /** Forget the target and the counts (a new round). */
  reset(): void;
}

export function createPersonaBrain(p: Persona, opts: { rng?: () => number; arena?: Arena } = {}): PersonaBrain {
  const arena = opts.arena ?? {};
  let target: Candidate | null = null;
  let n = { thinks: 0, picks: 0, value: 0, dist: 0, facing: 0, company: 0, blind: 0, steers: 0, byKind: {} as Record<string, number> };
  const same = (a: Candidate | null, b: Candidate | null): boolean => a === b || (!!a && !!b && a.id !== undefined && a.id === b.id);
  const brain: PersonaBrain = {
    persona: p,
    get target() { return target; },
    choose(self, candidates, rivals = []) {
      n.thinks += 1;
      // A target that is gone (eaten, expired) is not kept: it is no longer among the candidates.
      const keep = target && candidates.some((c) => same(c, target)) ? target : null;
      const best = pickCandidate(self, candidates, p, arena, rivals, opts.rng, keep);
      if (best && !same(best.c, target)) {
        n.picks += 1; n.value += best.c.value; n.dist += best.dist; n.facing += best.facing; n.company += best.company;
        if (!best.seen) n.blind += 1;
        n.byKind[best.c.kind] = (n.byKind[best.c.kind] ?? 0) + 1;
      }
      target = best ? best.c : null;
      return target;
    },
    chooser(self, candidates, rivals) { return () => brain.choose(self(), candidates(), rivals ? rivals() : []); },
    steer(self, push) {
      if (!arena.solid) return push;
      const out = avoidWalls(self, push, arena.solid, arena.look ?? 3, p.wall);
      if (out.steered) n.steers += 1;
      return { x: out.x, y: out.y };
    },
    stats() {
      const k = Math.max(1, n.picks);
      return { persona: p.name, thinks: n.thinks, picks: n.picks, byKind: { ...n.byKind }, meanValue: n.value / k, meanDist: n.dist / k, meanFacing: n.facing / k, meanCompany: n.company / k, blindPicks: n.blind, wallSteers: n.steers };
    },
    reset() { target = null; n = { thinks: 0, picks: 0, value: 0, dist: 0, facing: 0, company: 0, blind: 0, steers: 0, byKind: {} }; },
  };
  return brain;
}

/** Brains side by side: one row each, in the order given. */
export function botStats(brains: readonly PersonaBrain[]): BotStats[] { return brains.map((b) => b.stats()); }

/** The share of a brain's picks that were of one kind (0 with no picks). */
export const kindShare = (s: BotStats, kind: string): number => (s.picks ? (s.byKind[kind] ?? 0) / s.picks : 0);

/**
 * How unlike each other a set of bots behaved: for every pair, the distance between what they picked (the share of
 * each kind), 0 for identical and 1 for nothing in common; the answer is the SMALLEST pair's. A value near 0 means
 * two of them are the same bot under two names, whatever their weights say.
 */
export function personaSpread(rows: readonly BotStats[]): number {
  let least = Infinity;
  for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) {
    const a = rows[i] as BotStats; const b = rows[j] as BotStats;
    let d = 0;
    for (const k of new Set([...Object.keys(a.byKind), ...Object.keys(b.byKind)])) d += Math.abs(kindShare(a, k) - kindShare(b, k));
    least = Math.min(least, d / 2);
  }
  return Number.isFinite(least) ? least : 0;
}

/** A small seeded generator (mulberry32): the same seed, the same numbers, on every browser. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
