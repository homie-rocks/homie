// heading.js: the one heading convention the package means, the adapter from any other, and
// the development check that says so when a game feeds the follow camera the wrong one. The
// first test is the failure itself: a heading measured on another axis goes straight in,
// nothing throws, and the lens is beside or in front of the subject.
import assert from 'node:assert/strict';
import test from 'node:test';
import { followState, stepFollow } from '@homie-rocks/camera/follow.js';
import {
  HEADING_WATCH_LIMITS, headingFrom, headingOfVector, headingWatch, stepHeadingWatch, vectorOfHeading,
} from '@homie-rocks/camera/heading.js';

const TUNING = {
  dist: 6, distSpeed: 0, speedFull: 12, distTau: 0.4,
  height: 1.6, lookUp: 1.0,
  yawTau: 0.5, yawTauHard: 0.12, hardTurn: 1.2,
  lensRadius: 0.4, headRadius: 1.2, probeStep: 0.2,
  swingStep: Math.PI / 12, swingMax: Math.PI / 3, climbMax: 4,
  guardIn: 0.05, guardOut: 0.6,
};
const OPEN = () => Infinity;
const DT = 1 / 60;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const turnsApart = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// Three games, each with its own idea of a heading. `forward` is the truth: where the
// subject points in world (x, z) for the game's own angle.
const GAMES = {
  // angle = Math.atan2(vz, vx): 0 faces +X, growing toward +Z.
  'zero is +X, growing toward +Z': { forward: (a) => [Math.cos(a), Math.sin(a)], convention: { zero: '+x', toward: '+z' } },
  // 0 faces +X, growing toward -Z: counter-clockwise seen from above.
  'zero is +X, counter-clockwise': { forward: (a) => [Math.cos(a), -Math.sin(a)], convention: { zero: '+x', turn: 'ccw' } },
  // rotation.y of a model built facing -Z, as three.js's own cameras are.
  'a model that faces -Z': { forward: (a) => [-Math.sin(a), -Math.cos(a)], convention: { zero: '-z', turn: 'ccw' } },
};

/**
 * Drive a subject in a straight line along its own forward for `seconds`, handing the rig
 * `yawOf(angle)`. Returns how far the lens ended up BEHIND the subject (metres along its
 * real forward: +6 is right, 0 is beside, -6 is in front) and what was warned.
 */
function drive(game, angle, yawOf, { seconds = 3, speed = 5, options = {}, reversing = false } = {}) {
  const warned = [];
  const s = followState({ warn: (m) => warned.push(m), ...options });
  const [fx, fz] = game.forward(angle);
  const dir = reversing ? -1 : 1;
  let x = 0, z = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    x += dir * fx * speed * DT; z += dir * fz * speed * DT;
    const marked = reversing && !options.unmarked;
    stepFollow(s, TUNING, { x, y: 0, z, yaw: yawOf(angle), speed, reversing: marked || undefined }, OPEN, DT);
  }
  return { behind: (x - s.eyeX) * fx + (z - s.eyeZ) * fz, warned, state: s };
}

test('heading: a game angle fed straight in puts the lens beside or in front of the subject, and nothing throws', () => {
  const raw = (a) => a;
  // 0 = +X growing toward -Z: wrong by a quarter turn in EVERY direction. The lens is beside it.
  for (const a of [0, 1, 2.5, -2]) near(drive(GAMES['zero is +X, counter-clockwise'], a, raw).behind, 0, 1e-6);
  // A model that faces -Z: wrong by half a turn. The lens is in front, looking back at its face.
  for (const a of [0, 1, 2.5, -2]) near(drive(GAMES['a model that faces -Z'], a, raw).behind, -6, 1e-6);
  // 0 = +X growing toward +Z: right on one diagonal, beside heading along an axis, in front on the other diagonal.
  const mirrored = GAMES['zero is +X, growing toward +Z'];
  near(drive(mirrored, Math.PI / 4, raw).behind, 6, 1e-6);
  near(drive(mirrored, 0, raw).behind, 0, 1e-6);
  near(drive(mirrored, -Math.PI / 4, raw).behind, -6, 1e-6);
});

test('heading: the same games through headingFrom have the lens the full arm behind, whichever way they go', () => {
  for (const [name, game] of Object.entries(GAMES)) {
    const toYaw = headingFrom(game.convention);
    for (const a of [0, 1, 2.5, -2, Math.PI / 4, -Math.PI / 4]) {
      const run = drive(game, a, toYaw);
      near(run.behind, 6, 1e-6);
      assert.deepEqual(run.warned, [], `${name} at ${a}: a converted heading is not warned about`);
    }
  }
});

test('heading: the wrong heading is warned about once, after a second of travel, naming the adapter', () => {
  const raw = (a) => a;
  for (const name of ['zero is +X, counter-clockwise', 'a model that faces -Z']) {
    const short = drive(GAMES[name], 1, raw, { seconds: 0.9 });
    assert.deepEqual(short.warned, [], `${name}: under a second says nothing`);
    const long = drive(GAMES[name], 1, raw, { seconds: 20 });
    assert.equal(long.warned.length, 1, `${name}: said once, not every frame`);
    assert.match(long.warned[0], /headingFrom/);
    assert.match(long.warned[0], /headingOfVector/);
    assert.match(long.warned[0], /@homie-rocks\/camera\/heading\.js/);
    assert.match(long.warned[0], /yaw 0 as facing \+Z/);
    assert.match(long.warned[0], /headingCheck: false/);
  }
  // The mirrored convention is caught the moment the subject heads along an axis.
  assert.equal(drive(GAMES['zero is +X, growing toward +Z'], 0, raw).warned.length, 1);
});

test('heading: the check is silent when it should be: standing still, reversing, a brief slide, or switched off', () => {
  const game = GAMES['a model that faces -Z'];
  const raw = (a) => a;
  // Standing still with any yaw at all is not evidence.
  assert.deepEqual(drive(game, 1, raw, { speed: 0 }).warned, []);
  // Reversing for real, marked as such on the target: the legitimate exception.
  const right = headingFrom(game.convention);
  assert.equal(drive(game, 1, right, { reversing: true }).warned.length, 0);
  // The same reverse left unmarked IS reported: the check cannot tell it from a wrong axis.
  assert.equal(drive(game, 1, right, { reversing: true, options: { unmarked: true } }).warned.length, 1);
  // Opted out for good.
  const off = drive(game, 1, raw, { options: { headingCheck: false } });
  assert.deepEqual(off.warned, []);
  assert.equal(off.state.heading, null);
  // Half a second sideways, then straight: a slide, not a convention.
  const warned = [];
  const w = headingWatch((m) => warned.push(m));
  let x = 0, z = 0;
  for (let i = 0; i < 600; i++) {
    const sideways = i % 120 < 30;
    if (sideways) x += 5 * DT; else z += 5 * DT;
    stepHeadingWatch(w, x, z, 0, DT);
  }
  assert.deepEqual(warned, []);
});

test('heading: the check retires after half a minute of agreeing travel and costs nothing after', () => {
  const warned = [];
  const w = headingWatch((m) => warned.push(m));
  let z = 0;
  for (let i = 0; i < 31 * 60; i++) { z += 5 * DT; stepHeadingWatch(w, 0, z, 0, DT); }
  assert.equal(w.done, true);
  assert.ok(w.good >= HEADING_WATCH_LIMITS.retire);
  const before = { ...w };
  for (let i = 0; i < 600; i++) { z -= 5 * DT; assert.equal(stepHeadingWatch(w, 0, z, 0, DT), false); }
  assert.deepEqual({ ...w }, before, 'a retired check does not even record the position');
  assert.deepEqual(warned, []);
});

test('heading: every convention round-trips, and agrees with the forward vector it describes', () => {
  const axes = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };
  const quarter = { '+x': ['+z', '-z'], '-x': ['+z', '-z'], '+z': ['+x', '-x'], '-z': ['+x', '-x'] };
  for (const zero of Object.keys(axes)) {
    for (const toward of quarter[zero]) {
      const toYaw = headingFrom({ zero, toward });
      const [zx, zz] = axes[zero], [tx, tz] = axes[toward];
      for (const a of [0, 0.3, 1.7, -2.9, 3.1]) {
        // The truth, from the definition: cos(a) along `zero` plus sin(a) along `toward`.
        const fx = Math.cos(a) * zx + Math.sin(a) * tx, fz = Math.cos(a) * zz + Math.sin(a) * tz;
        const yaw = toYaw(a);
        const out = vectorOfHeading(yaw, { x: 0, z: 0 });
        near(out.x, fx, 1e-12); near(out.z, fz, 1e-12);
        near(turnsApart(yaw, headingOfVector(fx, fz)), 0, 1e-12);
        near(turnsApart(toYaw.back(yaw), a), 0, 1e-12);
      }
    }
  }
  // The package's own convention is the identity.
  const same = headingFrom({ zero: '+z', toward: '+x' });
  near(same(0.7), 0.7); near(same.back(-1.1), -1.1);
  // 'ccw' is three.js's rotation.y: for a model facing +Z it is the identity too.
  near(headingFrom({ zero: '+z', turn: 'ccw' })(0.7), 0.7);
  near(headingFrom({ zero: '+z', turn: 'cw' })(0.7), -0.7);
  // Degrees in, radians out, degrees back.
  const compass = headingFrom({ zero: '-z', turn: 'cw', degrees: true }); // north is -Z, clockwise
  near(compass(90), Math.PI / 2, 1e-12); // east is +X
  near(compass.back(Math.PI / 2), 90, 1e-9);
});

test('heading: a convention that makes no sense throws when the adapter is made', () => {
  assert.throws(() => headingFrom({ zero: '+x' }), /toward .* or turn/);
  assert.throws(() => headingFrom({ zero: '+x', toward: '-x' }), /quarter turn/);
  assert.throws(() => headingFrom({ zero: '+x', toward: '+x' }), /quarter turn/);
  assert.throws(() => headingFrom({ zero: 'x', toward: '+z' }), /zero must be/);
  assert.throws(() => headingFrom({ zero: '+x', toward: 'north' }), /toward must be/);
  assert.throws(() => headingFrom({ zero: '+x', turn: 'left' }), /turn must be/);
  assert.throws(() => headingFrom({ zero: '+x', toward: '+z', turn: 'ccw' }), /disagrees/);
  assert.doesNotThrow(() => headingFrom({ zero: '+x', toward: '+z', turn: 'cw' }));
});
