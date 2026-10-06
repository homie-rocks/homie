/**
 * @homie-rocks/studio/powerups: pickups the host owns, as pure rules over one plain state (port/powerups.ts).
 *
 *   - spawning on spots (staggered, capped, the same sequence for the same seed) and collecting (the lower slot on a
 *     tie, the spot cools down, holding a kind again refreshes it);
 *   - Magnet (a wider bite and a pull that never overshoots), Phase (no collisions), Shield (blocks one hit, bounces
 *     the attacker, is spent);
 *   - the snapshot: who holds what and how long is LEFT travels in it, so a host change mid-timer loses nothing and
 *     the new host draws the same next pickup; flags per body; a build that does not know a kind drops it;
 *   - the functions never change the state they are given;
 *   - the drawing layer: instance matrices and the HUD pill, from the state alone.
 * Run: node --test packages/studio/test/powerups.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-powerups-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

let mod = null;
async function load() {
  if (mod) return mod;
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  await esbuild.build({ entryPoints: [join(PKG, 'port', 'powerups.ts')], bundle: true, format: 'esm', platform: 'neutral', outdir: scratch, logLevel: 'silent' });
  mod = await import(join(scratch, 'powerups.js'));
  return mod;
}

const SPOTS = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }];
/** Recursively frozen, so a function that writes into its input throws. */
const frozen = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(frozen); Object.freeze(o); } return o; };
/** Step in 50 ms ticks for `ms`, collecting every event. */
function advance(P, state, ms, rules) {
  const events = [];
  for (let t = 0; t < ms; t += 50) { const r = P.stepPowerups(frozen(state), 50, rules); state = r.state; events.push(...r.events); }
  return { state, events };
}

test('pickups appear on spots: staggered, capped, and the same sequence for the same seed', async () => {
  const P = await load();
  const R = P.POWER_RULES;
  let a = P.createPowerups(4, 99);
  assert.deepEqual(a.cool, [4000, 7000, 10000, 13000], 'first after firstMs, then a quarter of the respawn apart');
  assert.equal(advance(P, a, 3950).state.pickups.length, 0);
  const one = advance(P, a, 4000);
  assert.deepEqual(one.events.map((e) => [e.type, e.spot]), [['spawn', 0]]);
  const all = advance(P, a, 20000);
  assert.equal(all.state.pickups.length, R.maxOnField, 'never more than maxOnField lying about');
  assert.deepEqual(all.state.pickups.map((p) => p.spot), [0, 1, 2]);
  assert.ok(all.state.pickups.every((p) => p.kind in R.kinds));
  // The same seed is the same sequence; another seed is, sooner or later, another.
  assert.deepEqual(advance(P, P.createPowerups(4, 99), 20000).state, all.state);
  const kinds = (seed) => advance(P, P.createPowerups(4, seed), 20000).state.pickups.map((p) => p.kind).join();
  assert.ok(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(kinds)).size > 1);
  // A rule set with one kind only ever spawns it; weights of zero spawn nothing.
  const only = { ...R, kinds: { shield: R.kinds.shield } };
  assert.ok(advance(P, P.createPowerups(4, 1, only), 20000, only).state.pickups.every((p) => p.kind === 'shield'));
  const none = { ...R, kinds: { shield: { ...R.kinds.shield, weight: 0 } } };
  assert.equal(advance(P, P.createPowerups(4, 1, none), 20000, none).state.pickups.length, 0);
});

test('a body takes the pickup it touches: the lower slot on a tie, the spot cools down, a kind held again is refreshed', async () => {
  const P = await load();
  const R = P.POWER_RULES;
  let s = advance(P, P.createPowerups(4, 5), 4000).state;
  const kind = s.pickups[0].kind;
  const far = P.collectPowerups(frozen(s), [{ slot: 0, x: 5, y: 5, r: 0.5 }], SPOTS);
  assert.equal(far.state, s, 'nobody near: the very same state back');
  // Two bodies on the spot in one tick, given in the other order: slot 1 has it, whoever is hosting.
  const got = P.collectPowerups(frozen(s), [{ slot: 3, x: 0.2, y: 0, r: 0.5 }, { slot: 1, x: 0, y: 0.3, r: 0.5 }], SPOTS);
  assert.deepEqual(got.events, [{ type: 'pickup', id: 1, spot: 0, kind, slot: 1 }]);
  assert.equal(got.state.pickups.length, 0);
  assert.equal(got.state.cool[0], R.respawnMs);
  assert.ok(P.holds(got.state, 1, kind) && !P.holds(got.state, 3, kind));
  assert.equal(P.heldBy(got.state, 1)[0].left, R.kinds[kind].ms);
  // The edge of the body counts, not its centre.
  assert.equal(P.collectPowerups(frozen(s), [{ slot: 0, x: 1.05, y: 0, r: 0.5 }], SPOTS).events.length, 1);
  assert.equal(P.collectPowerups(frozen(s), [{ slot: 0, x: 1.2, y: 0, r: 0.5 }], SPOTS).events.length, 0);
  // Half used, then granted again: one entry, full time. Not two.
  let h = advance(P, P.grant(P.createPowerups(0, 1), 2, 'magnet'), 4000).state;
  assert.equal(P.heldBy(h, 2)[0].left, 5000);
  h = P.grant(frozen(h), 2, 'magnet');
  assert.deepEqual(P.heldBy(h, 2), [{ slot: 2, kind: 'magnet', left: 9000, charges: 0 }]);
  assert.equal(P.grant(h, 2, 'no-such-kind'), h);
  // It runs out with an event, and a body that leaves takes what it held with it.
  const out = advance(P, h, 9000);
  assert.deepEqual(out.events, [{ type: 'expire', slot: 2, kind: 'magnet' }]);
  assert.equal(P.holds(out.state, 2, 'magnet'), false);
  assert.deepEqual(P.dropSlot(frozen(h), 2).held, []);
});

test('Magnet widens the bite and draws things in; Phase turns collisions off; Shield blocks one hit and bounces the attacker', async () => {
  const P = await load();
  const R = P.POWER_RULES;
  const empty = P.createPowerups(0, 1);
  const magnet = frozen(P.grant(empty, 0, 'magnet'));
  assert.equal(P.biteRadius(magnet, 0, 1), 1.8);
  assert.equal(P.biteRadius(magnet, 1, 1), 1, 'only the holder\'s');
  const mouth = { x: 0, y: 0 };
  const item = { x: 4, y: 0 };
  assert.deepEqual(P.magnetPull(magnet, 0, mouth, item, 1, 500), { x: 1, y: 0 }, '6 units a second for half a second');
  assert.deepEqual(P.magnetPull(magnet, 0, mouth, { x: 0.5, y: 0 }, 1, 500), { x: 0, y: 0 }, 'it stops at the mouth, never past it');
  assert.equal(P.magnetPull(magnet, 0, mouth, { x: 6, y: 0 }, 1, 500).x, 6, 'out of reach (3 bite radii): untouched');
  assert.equal(P.magnetPull(magnet, 1, mouth, item, 1, 500), item, 'no magnet, no pull');

  const phase = frozen(P.grant(empty, 0, 'phase'));
  assert.equal(P.collides(empty, 0, 1), true);
  assert.equal(P.collides(phase, 0, 1), false);
  assert.equal(P.collides(phase, 1, 0), false, 'either way round');
  assert.equal(P.collides(phase, 1, 2), true);
  assert.equal(P.resolveHit(phase, 1, 0, { x: 1, y: 0 }).outcome, 'phased');

  const shield = frozen(P.grant(empty, 1, 'shield'));
  assert.deepEqual(P.resolveHit(empty, 0, 1, { x: 1, y: 0 }), { state: empty, outcome: 'hit', bounce: null, events: [] });
  const blocked = P.resolveHit(shield, 0, 1, { x: 3, y: 0 });
  assert.equal(blocked.outcome, 'blocked');
  assert.deepEqual(blocked.bounce, { x: -R.shield.bounce, y: 0 }, 'thrown back the way it came, at the rule\'s speed');
  assert.deepEqual(blocked.events, [{ type: 'block', slot: 1, by: 0 }, { type: 'spent', slot: 1, kind: 'shield' }]);
  assert.equal(P.holds(blocked.state, 1, 'shield'), false, 'one hit: the shield is gone');
  assert.equal(P.resolveHit(blocked.state, 0, 1, { x: 3, y: 0 }).outcome, 'hit', 'and the second hit lands');
  // A game's own shield with three charges takes three.
  const tough = { ...R, kinds: { ...R.kinds, shield: { ms: 12000, charges: 3 } } };
  let s = P.grant(empty, 1, 'shield', tough);
  const outcomes = [];
  for (let i = 0; i < 4; i += 1) { const r = P.resolveHit(frozen(s), 0, 1, { x: 0, y: 1 }, tough); outcomes.push(r.outcome); s = r.state; }
  assert.deepEqual(outcomes, ['blocked', 'blocked', 'blocked', 'hit']);
});

test('the timers are in the snapshot: a host change mid-timer loses nothing, and the new host spawns the same next pickup', async () => {
  const P = await load();
  const R = P.POWER_RULES;
  // The first host: a pickup spawns, slot 0 takes it and is granted a shield, 3 s pass.
  let s = advance(P, P.createPowerups(4, 2026), 4000).state;
  s = P.collectPowerups(s, [{ slot: 0, x: 0, y: 0, r: 0.5 }], SPOTS).state;
  s = P.grant(s, 0, 'shield');
  s = advance(P, s, 3000).state;
  const wire = JSON.parse(JSON.stringify(P.packPowerups(s))); // what the relay carried: plain JSON
  // It left. The new host has only the snapshot, and its own clock is nothing like the old one's.
  const taken = P.unpackPowerups(wire);
  assert.deepEqual(taken, s, 'the whole state, exactly');
  assert.equal(P.heldBy(taken, 0).find((h) => h.kind === 'shield').left, R.kinds.shield.ms - 3000, 'remaining time, not a deadline');
  // From here both timelines are the same: the one where the first host stayed, and the one where it did not.
  const stayed = advance(P, s, 15000);
  const moved = advance(P, taken, 15000);
  assert.deepEqual(moved.state, stayed.state);
  assert.deepEqual(moved.events, stayed.events);
  assert.ok(moved.events.some((e) => e.type === 'spawn') && moved.events.some((e) => e.type === 'expire'), 'pickups kept spawning and the shield ran out on time');
  // Flags: one small number a body.
  const both = P.grant(P.grant(P.createPowerups(0, 1), 4, 'magnet'), 4, 'shield');
  const flags = P.powerFlags(both, 4);
  assert.equal(flags, 0b101);
  assert.deepEqual(['magnet', 'phase', 'shield'].map((k) => P.flagHolds(flags, k)), [true, false, true]);
  assert.equal(P.powerFlags(both, 5), 0);
  // A tab on an older build, whose rules lack a kind the room has: it drops that kind and keeps the rest.
  const old = { ...R, kinds: { magnet: R.kinds.magnet, phase: R.kinds.phase } };
  const seen = P.unpackPowerups(P.packPowerups(both), old);
  assert.deepEqual(seen.held.map((h) => h.kind), ['magnet']);
  // And nothing at all, or rubbish, is an empty state rather than a throw.
  assert.deepEqual(P.unpackPowerups(undefined).held, []);
  assert.deepEqual(P.unpackPowerups({ p: [[1]], h: [['x', 0, 5, 0], [1, 0, -5, 0]], c: 'no' }), { t: 0, seed: 0, nextId: 1, pickups: [], cool: [], held: [] });
});

test('the drawing layer: three instance buffers and the HUD pill, from the state alone', async () => {
  const P = await load();
  let s = advance(P, P.createPowerups(4, 3), 8000).state;
  assert.equal(s.pickups.length, 2);
  s = P.grant(P.grant(s, 0, 'magnet'), 1, 'shield');
  const bodies = [{ slot: 0, x: 3, y: 4, r: 0.5 }, { slot: 1, x: -2, y: 6, r: 0.5, h: 2 }];
  const out = P.createPowerDraws(4, 8);
  P.powerDraws(frozen(s), SPOTS, bodies, 1000, out);
  assert.deepEqual([out.gemCount, out.ringCount, out.bubbleCount], [2, 1, 1]);
  assert.deepEqual([out.ringSlots[0], out.bubbleSlots[0]], [0, 1]);
  // Column-major 4x4: the translation is elements 12 to 14. A 3D game: flat y goes to world z.
  assert.deepEqual([out.gems[12 + 16], out.gems[14 + 16]], [10, 0], 'the second gem is over the second spot');
  assert.ok(out.gems[13] > 0.7 && out.gems[13] < 1.1, 'floating above the ground');
  assert.deepEqual([out.rings[12], out.rings[14]], [3, 4]);
  assert.ok(Math.abs(Math.hypot(out.rings[0], out.rings[2]) - 0.9) < 1e-6, 'the ring is as wide as the magnet\'s bite (0.5 x 1.8)');
  assert.deepEqual([out.bubbles[12], out.bubbles[13], out.bubbles[14]], [-2, 2.5, 6], 'the bubble is round the body, at its height');
  assert.equal(out.gems[15], 1);
  // A flat game: the same things on the xy plane.
  P.powerDraws(s, SPOTS, bodies, 1000, out, P.POWER_RULES, { plane: 'xy' });
  assert.deepEqual([out.rings[12], out.rings[13]], [3, 4]);
  // More holders than the buffers were made for: the count stops at the buffer, nothing is written past it.
  const small = P.createPowerDraws(1, 0);
  P.powerDraws(s, SPOTS, bodies, 1000, small);
  assert.deepEqual([small.gemCount, small.ringCount, small.bubbleCount], [1, 0, 0]);
  // The pill: what, how much is left, soonest first.
  const mine = advance(P, P.grant(P.grant(P.createPowerups(0, 1), 0, 'shield'), 0, 'phase'), 3000).state;
  assert.deepEqual(P.hudPills(mine, 0), [
    { kind: 'phase', label: 'Phase', left: 3000, fraction: 0.5, charges: 0 },
    { kind: 'shield', label: 'Shield', left: 9000, fraction: 0.75, charges: 1 },
  ]);
  assert.deepEqual(P.hudPills(mine, 9), []);
});
