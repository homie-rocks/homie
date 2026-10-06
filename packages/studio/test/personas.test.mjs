/**
 * @homie-rocks/studio/personas: bots that want different things (port/personas.ts).
 *
 *   - the scorer: value against distance, a target behind, a target behind a wall, company near it, a bigger rival;
 *   - line of sight and wall avoidance over the game's own solid(x, y);
 *   - the five personas on ONE fixture arena, each alone with the same seed: their telemetry (botStats) differs the
 *     way their names say, the difference is measured (personaSpread), and a run is the same run again;
 *   - a persona is the `choose` the port kit's BotBrain takes, so the room's skill dial still applies.
 * Run: node --test packages/studio/test/personas.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-personas-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

let mod = null;
async function load() {
  if (mod) return mod;
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  await esbuild.build({ entryPoints: [join(PKG, 'port', 'personas.ts'), join(PKG, 'port', 'bots.ts')], bundle: true, format: 'esm', platform: 'neutral', outdir: scratch, logLevel: 'silent' });
  mod = { ...(await import(join(scratch, 'bots.js'))), ...(await import(join(scratch, 'personas.js'))) };
  return mod;
}

/**
 * The fixture arena: 60 by 60 with a solid border and two walls, things of every kind on it, and three rivals of
 * different sizes walking fixed circles. Nothing in it is random except through the seed.
 */
const SIZE = 60;
const WALLS = [[20, 8, 22, 40], [36, 30, 52, 32]]; // x0, y0, x1, y1
const solid = (x, y) => x < 1 || y < 1 || x > SIZE - 1 || y > SIZE - 1 || WALLS.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d);

/** One bot alone in the arena for `ticks` steps of 50 ms. Returns its telemetry and where it ended. */
async function run(personaRow, seed, ticks = 4000) {
  const { createPersonaBrain, seededRng, seek } = await load();
  const world = seededRng(seed);
  const spot = () => { for (;;) { const x = 2 + world() * (SIZE - 4); const y = 2 + world() * (SIZE - 4); if (!solid(x, y)) return { x, y }; } };
  let nextId = 1;
  const make = (kind, value) => ({ id: nextId++, kind, value, ...spot() });
  const things = [
    ...Array.from({ length: 28 }, () => make('food', 1 + Math.floor(world() * 3))),
    ...Array.from({ length: 4 }, () => make('food', 12)), // the jackpots
    ...Array.from({ length: 10 }, () => make('scrap', 0.5)),
    ...Array.from({ length: 3 }, () => make('power', 4)),
  ];
  // Gates round a square circuit; a racer takes them in order and each reappears once passed.
  const gates = [[10, 10], [50, 10], [50, 50], [10, 50]].map(([x, y], i) => ({ id: `gate${i}`, kind: 'gate', value: 3, x, y }));
  const rivals = [{ cx: 12, cy: 48, r: 6, size: 0.6, w: 0.0002 }, { cx: 45, cy: 14, r: 8, size: 1.6, w: -0.00015 }, { cx: 30, cy: 50, r: 5, size: 0.9, w: 0.00025 }];
  const brain = createPersonaBrain(personaRow, { rng: seededRng(seed ^ 0x5eed), arena: { solid } });
  const self = { x: 30, y: 20, heading: 0, size: 1 };
  let gate = 0; let eaten = 0; let rams = 0; let metres = 0; let mark = { x: 30, y: 20 };
  // What the port kit's BotBrain does with its stuck detector, without its Math.random: a target the bot has made no
  // headway toward for two seconds is left alone for a while.
  const givenUp = new Map();
  for (let t = 0; t < ticks; t += 1) {
    const now = t * 50;
    const others = rivals.map((r, i) => ({ id: `rival${i}`, kind: 'rival', value: 5, size: r.size, x: r.cx + Math.cos(now * r.w) * r.r, y: r.cy + Math.sin(now * r.w) * r.r }));
    const candidates = [...things, gates[gate], ...others].filter((c) => (givenUp.get(c.id) ?? -1) < t);
    const target = brain.choose(self, candidates, others);
    if (!target) continue;
    const push = brain.steer(self, seek(self, target));
    const nx = self.x + push.x * 0.3; const ny = self.y + push.y * 0.3;
    // Slide along a wall rather than stop at it.
    const to = !solid(nx, ny) ? [nx, ny] : !solid(nx, self.y) ? [nx, self.y] : !solid(self.x, ny) ? [self.x, ny] : [self.x, self.y];
    const moved = Math.hypot(to[0] - self.x, to[1] - self.y);
    metres += moved; self.x = to[0]; self.y = to[1];
    if (t % 40 === 39) { // every two seconds: under two units from where it was, it is getting nowhere
      if (Math.hypot(self.x - mark.x, self.y - mark.y) < 2) givenUp.set(target.id, t + 400);
      mark = { x: self.x, y: self.y };
    }
    if (push.x || push.y) self.heading = Math.atan2(push.y, push.x);
    if (Math.hypot(target.x - self.x, target.y - self.y) < 0.8) {
      if (target.kind === 'gate') gate = (gate + 1) % gates.length;
      else if (target.kind === 'rival') { rams += 1; givenUp.set(target.id, t + 100); } // a ram: that one is left alone for five seconds
      else { eaten += 1; Object.assign(target, spot(), { id: nextId++ }); }
    }
  }
  return { stats: brain.stats(), eaten, rams, metres: Math.round(metres), at: { x: self.x, y: self.y } };
}

test('the scorer: value against distance, a target behind, a wall in the way, company, a bigger rival', async () => {
  const { PERSONAS, persona, scoreCandidate, pickCandidate, lineOfSight } = await load();
  const self = { x: 10, y: 10, heading: 0, size: 1 };
  const near = { kind: 'food', value: 1, x: 12, y: 10 };
  const jackpot = { kind: 'food', value: 12, x: 40, y: 10 };
  assert.equal(pickCandidate(self, [near, jackpot], PERSONAS.glutton).c, jackpot, 'a glutton crosses the arena for the big one');
  assert.equal(pickCandidate(self, [near, jackpot], PERSONAS.scavenger).c, near, 'a scavenger takes what is beside it');
  // The same prize ahead and behind: a racer all but ignores the one behind.
  const ahead = scoreCandidate(self, { kind: 'food', value: 2, x: 15, y: 10 }, PERSONAS.racer);
  const behind = scoreCandidate(self, { kind: 'food', value: 2, x: 5, y: 10 }, PERSONAS.racer);
  assert.deepEqual([ahead.facing, behind.facing], [1, -1]);
  assert.ok(Math.abs(behind.score / ahead.score - 0.05) < 1e-9, 'heading 0.95: a twentieth of its score');
  // A wall between: seen is false, and `blind` of the score is lost.
  const wall = (x) => x > 12 && x < 13;
  assert.equal(lineOfSight(self, { x: 15, y: 10 }, wall), false);
  assert.equal(lineOfSight(self, { x: 11, y: 10 }, wall), true);
  const hidden = scoreCandidate(self, { kind: 'food', value: 2, x: 15, y: 10 }, PERSONAS.scavenger, { solid: wall });
  const open = scoreCandidate(self, { kind: 'food', value: 2, x: 15, y: 10 }, PERSONAS.scavenger);
  assert.equal(hidden.seen, false);
  assert.ok(Math.abs(hidden.score / open.score - 0.3) < 1e-9);
  // Company: a sneak leaves a crowded prize, a bully prefers it.
  const prize = { kind: 'power', value: 4, x: 20, y: 10 };
  const crowd = [{ x: 21, y: 10 }, { x: 20, y: 12 }];
  assert.equal(scoreCandidate(self, prize, PERSONAS.sneak, {}, crowd).company, 2);
  assert.equal(scoreCandidate(self, prize, PERSONAS.sneak, {}, crowd).score, 0, 'two rivals near it: not worth it to a sneak');
  assert.ok(scoreCandidate(self, prize, PERSONAS.bully, {}, crowd).score > scoreCandidate(self, prize, PERSONAS.bully).score);
  // A bully picks on the smaller of two rivals, even when the bigger is nearer.
  const small = { kind: 'rival', value: 5, size: 0.5, x: 25, y: 10 };
  const big = { kind: 'rival', value: 5, size: 2, x: 14, y: 10 };
  assert.equal(pickCandidate(self, [big, small], PERSONAS.bully).c, small);
  // A game's own row: a built-in with some weights changed; its kinds are merged, and the built-in is untouched.
  const mine = persona('sneak', { name: 'ghost', kinds: { beacon: 6 } });
  assert.deepEqual([mine.name, mine.kinds.beacon, mine.kinds.power, mine.crowd], ['ghost', 6, 2.5, -0.9]);
  assert.equal(PERSONAS.sneak.kinds.beacon, undefined);
  assert.throws(() => { PERSONAS.sneak.crowd = 0; }, TypeError);
  assert.equal(pickCandidate(self, [], PERSONAS.glutton), null);
});

test('wall avoidance: a push into a wall is turned toward the open side, and an open push is left alone', async () => {
  const { avoidWalls } = await load();
  const free = avoidWalls({ x: 30, y: 45 }, { x: 1, y: 0 }, solid);
  assert.deepEqual(free, { x: 1, y: 0, steered: false });
  // Heading east at the long wall's west face, a metre from its end: the open side is past its end.
  const turned = avoidWalls({ x: 18.5, y: 9 }, { x: 1, y: 0 }, solid);
  assert.equal(turned.steered, true);
  assert.ok(turned.y < -0.3, `turned toward the wall's end (${turned.y.toFixed(2)})`);
  assert.ok(Math.abs(Math.hypot(turned.x, turned.y) - 1) < 1e-9, 'the push keeps its strength');
  assert.equal(avoidWalls({ x: 18.5, y: 9 }, { x: 1, y: 0 }, solid, 3, 0).steered, false, 'a persona with no wall weight does not steer');
});

test('the five personas on one arena: their telemetry differs the way their names say, and a seed is a replay', async () => {
  const { PERSONAS, kindShare, personaSpread } = await load();
  const names = ['glutton', 'bully', 'racer', 'scavenger', 'sneak'];
  const runs = {};
  for (const n of names) runs[n] = await run(PERSONAS[n], 20261006);
  const s = Object.fromEntries(names.map((n) => [n, runs[n].stats]));
  const table = names.map((n) => `${n}: picks ${s[n].picks}, value ${s[n].meanValue.toFixed(2)}, dist ${s[n].meanDist.toFixed(1)}, facing ${s[n].meanFacing.toFixed(2)}, company ${s[n].meanCompany.toFixed(2)}, rival ${kindShare(s[n], 'rival').toFixed(2)}, gate ${kindShare(s[n], 'gate').toFixed(2)}, scrap ${kindShare(s[n], 'scrap').toFixed(2)}, power ${kindShare(s[n], 'power').toFixed(2)}, eaten ${runs[n].eaten}, rams ${runs[n].rams}`).join('\n');
  const most = (f) => names.reduce((a, b) => (f(b) > f(a) ? b : a));
  const least = (f) => names.reduce((a, b) => (f(b) < f(a) ? b : a));
  for (const n of names) assert.ok(s[n].picks >= 20, `${n} made choices (${s[n].picks})\n${table}`);
  assert.equal(most((n) => s[n].meanValue), 'glutton', `the glutton's prizes are the biggest\n${table}`);
  assert.ok(s.glutton.meanDist > 2 * s.scavenger.meanDist, `and it goes more than twice as far for them as a scavenger does\n${table}`);
  assert.equal(most((n) => kindShare(s[n], 'rival')), 'bully', `the bully goes for other bodies most\n${table}`);
  assert.equal(most((n) => runs[n].rams), 'bully', `and reaches them most\n${table}`);
  assert.equal(most((n) => kindShare(s[n], 'gate')), 'racer', `the racer takes the gates\n${table}`);
  assert.equal(most((n) => s[n].meanFacing), 'racer', `and what it picks is ahead of it\n${table}`);
  assert.equal(most((n) => kindShare(s[n], 'scrap')), 'scavenger', `the scavenger takes scraps\n${table}`);
  assert.equal(least((n) => s[n].meanDist), 'scavenger', `from closest by\n${table}`);
  assert.equal(most((n) => kindShare(s[n], 'power')), 'sneak', `the sneak wants the power-ups\n${table}`);
  assert.ok(runs.sneak.rams * 20 <= runs.bully.rams, `and all but never goes at anybody (${runs.sneak.rams} rams to the bully's ${runs.bully.rams})\n${table}`);
  assert.ok(s.sneak.meanCompany < 0.05, `what it picks has nobody near it (${s.sneak.meanCompany})\n${table}`);
  // One number for "they differ", by the KINDS picked alone: the two most alike (here the glutton and the sneak,
  // who both mostly eat, and differ in which food and who is near it) still differ in a fifth of their choices.
  const spread = personaSpread(names.map((n) => s[n]));
  assert.ok(spread > 0.2, `the least different pair differ by ${spread.toFixed(2)} of their picks\n${table}`);
  assert.equal(personaSpread([s.bully, s.bully]), 0, 'the same bot twice is no spread at all');
  // Deterministic: the same seed is the same run, to the last position; another seed is another run, same character.
  const again = await run(PERSONAS.bully, 20261006);
  assert.deepEqual(again, runs.bully);
  const other = await run(PERSONAS.bully, 7);
  assert.notDeepEqual(other.at, runs.bully.at);
  assert.ok(kindShare(other.stats, 'rival') > 0.3 && other.rams > 10, `a bully on another seed is still a bully (rival share ${kindShare(other.stats, 'rival').toFixed(2)}, ${other.rams} rams)`);
});

test('a fickle persona draws from the injected generator only, and a persona is the choose BotBrain takes', async () => {
  const { BotBrain, PERSONAS, createPersonaBrain, persona, seededRng, botStats } = await load();
  const a = seededRng(42); const b = seededRng(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  let draws = 0;
  const counting = () => { draws += 1; return 0.5; };
  const self = { x: 0, y: 0, heading: 0 };
  const food = [{ id: 1, kind: 'food', value: 1, x: 5, y: 0 }, { id: 2, kind: 'food', value: 1, x: 0, y: 6 }];
  createPersonaBrain(PERSONAS.glutton, { rng: counting }).choose(self, food);
  assert.equal(draws, 0, 'a persona that is not fickle draws nothing');
  createPersonaBrain(persona('glutton', { fickle: 0.3 }), { rng: counting }).choose(self, food);
  assert.equal(draws, 2, 'a fickle one draws once a candidate');
  // The dial is BotBrain's (it reacts late); the want is the persona's.
  const who = createPersonaBrain(PERSONAS.scavenger);
  const limits = new BotBrain({ reactionMs: 100, aimError: 0, stuckMs: 1e9 });
  const choose = who.chooser(() => self, () => food);
  let stick = { x: 0, y: 0 };
  for (let t = 0; t <= 200; t += 10) stick = limits.think(t, self, choose);
  assert.deepEqual([Math.round(stick.x), Math.round(stick.y)], [1, 0], 'toward the nearer pellet, once it has reacted');
  assert.equal(limits.target.id, 1);
  const rows = botStats([who]);
  assert.deepEqual([rows[0].persona, rows[0].picks, rows[0].byKind.food], ['scavenger', 1, 1]);
  assert.ok(rows[0].thinks >= 1);
  who.reset();
  assert.deepEqual([who.target, who.stats().picks], [null, 0]);
});
