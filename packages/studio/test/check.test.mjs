/**
 * @homie-rocks/studio 0.9.0: which finished round `homie-studio check` counts, when a busy computer drops a
 * browser or a game hands an idle person to its autopilot (a racing game's first two-browser check on a busy
 * computer: both browsers seated in one room, and no round ever had both of them in its results).
 *
 *   - a round counts when both browsers saw it and each has a row with a seat it held, whatever the row's `bot`
 *     says: a person the game drives for them is still that person;
 *   - a round without one of them is a miss, kept with who was missing, and the check waits for the next;
 *   - a round only one browser saw proves nothing yet.
 * The browsers themselves need Chrome (`homie-studio check` against `homie-studio dev`); this is the judgement.
 * Run: node --test packages/studio/test/check.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHECK_STEPS, LAUNCH_TIMEOUT_MS, judgeRounds } from '../lib/check.mjs';

const round = (n, rows) => ({ n, endsAt: 1000 * n, results: rows, ms: 5000 * n });
const seen = (...rounds) => new Map(rounds.map((r) => [`${r.n}:${r.endsAt}`, r]));
const bots = (k) => Array.from({ length: k }, (_, i) => ({ slot: 10 + i, seat: null, name: `Bot ${i}`, bot: true, score: 0 }));

test('a round with both seats counts, even when the game lists an idle person as a bot', () => {
  const r1 = round(1, [{ slot: 0, seat: 0, name: 'Brass Badger', bot: false }, { slot: 5, seat: 1, name: 'Cosmic Pilot', bot: true }, ...bots(6)]);
  const hit = judgeRounds([{ kind: 'computer', seats: new Set([0]), seen: seen(r1) }, { kind: 'phone', seats: new Set([1]), seen: seen(r1) }]);
  assert.equal(hit.n, 1);
  assert.equal(hit.people, 2, 'the phone\'s row keeps its seat: that is the person, driven by the game\'s autopilot');
  assert.deepEqual(hit.overMs, [5000, 5000]);
});

test('a round without one of them is a miss with its reason, and the next round with both counts', () => {
  // Round 1: the phone was let go (its body a bot, no seat on its row). Round 2: it is back, on the same seat.
  const r1 = round(1, [{ slot: 0, seat: 0, bot: false }, { slot: 5, seat: null, name: 'Racer 5', bot: true }, ...bots(6)]);
  const r2 = round(2, [{ slot: 5, seat: 1, bot: false }, { slot: 0, seat: 0, bot: false }, ...bots(6)]);
  const missed = new Map();
  const phone = { kind: 'phone', seats: new Set([1]), seen: seen(r1) };
  const computer = { kind: 'computer', seats: new Set([0]), seen: seen(r1) };
  assert.equal(judgeRounds([computer, phone], missed), null);
  assert.deepEqual([...missed.values()].map((m) => [m.n, m.missing]), [[1, ['phone']]]);
  assert.deepEqual(missed.get('1:1000').rows[1], { seat: null, name: 'Racer 5', bot: true }, 'what the round listed, for the report');
  computer.seen = seen(r1, r2);
  assert.equal(judgeRounds([computer, phone], missed), null, 'a round only the computer has seen yet proves nothing');
  phone.seen = seen(r1, r2);
  const hit = judgeRounds([computer, phone], missed);
  assert.equal(hit.n, 2);
  assert.equal(hit.people, 2);
  assert.equal(missed.size, 1, 'the miss is judged once');
});

test('a browser that came back on another seat is still in the round', () => {
  const r = round(3, [{ slot: 0, seat: 0, bot: false }, { slot: 2, seat: 4, bot: false }, ...bots(2)]);
  const hit = judgeRounds([{ kind: 'computer', seats: new Set([0]), seen: seen(r) }, { kind: 'phone', seats: new Set([1, 4]), seen: seen(r) }]);
  assert.equal(hit?.n, 3);
});

test('load tolerance: Chrome gets 150 s to start; the steps a progress feed shows are unchanged', () => {
  assert.equal(LAUNCH_TIMEOUT_MS, 150_000);
  assert.deepEqual(CHECK_STEPS.map(([id]) => id), ['computer-seated', 'phone-seated', 'same-room', 'round']);
});
