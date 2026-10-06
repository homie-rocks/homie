// follow.js: the third-person follow camera, driven with no renderer. The claims under
// test are the ones a player would see broken: the lens sits where the numbers say in
// the open, catches up faster on a hard turn, pulls back with speed, gives way in the
// stated order (swing, pull in, climb), and is never in solid or in the subject's head.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cutFollow, fieldFromBlocked, followState, stepFollow } from '@homie-rocks/camera/follow.js';

const TUNING = {
  dist: 6, distSpeed: 3, speedFull: 12, distTau: 0.4,
  height: 1.6, lookUp: 1.0,
  yawTau: 0.5, yawTauHard: 0.12, hardTurn: 1.2,
  lensRadius: 0.4, headRadius: 1.2, probeStep: 0.2,
  swingStep: Math.PI / 12, swingMax: Math.PI / 3, climbMax: 4,
  guardIn: 0.05, guardOut: 0.6,
};
const OPEN = () => Infinity;
const at = (x, z, yaw = 0, speed = 0) => ({ x, y: 0, z, yaw, speed });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const headGap = (s, target, t) => Math.hypot(s.eyeX - target.x, s.eyeY - (target.y + t.lookUp), s.eyeZ - target.z);

test('follow: in the open the lens sits the arm behind the subject, at height, looking at its head', () => {
  const s = stepFollow(followState(), TUNING, at(10, 20, Math.PI / 2), OPEN, 1 / 60);
  // Facing +X (yaw 90 degrees), so "behind" is -X.
  near(s.eyeX, 10 - 6); near(s.eyeZ, 20, 1e-9); near(s.eyeY, 1.6);
  near(s.lookX, 10); near(s.lookY, 1.0); near(s.lookZ, 20);
  assert.equal(s.guard, 'clear');
});

test('follow: speed pulls the lens back, eased, and stops at the full pull-back', () => {
  const s = followState();
  stepFollow(s, TUNING, at(0, 0), OPEN, 1 / 60);
  near(s.reach, 6);
  stepFollow(s, TUNING, at(0, 0, 0, 12), OPEN, 1 / 60);
  assert.ok(s.reach > 6 && s.reach < 6.5, `one frame at speed eases, it does not jump: ${s.reach}`);
  for (let i = 0; i < 600; i++) stepFollow(s, TUNING, at(0, 0, 0, 40), OPEN, 1 / 60);
  near(s.reach, 9, 1e-3);
});

test('follow: a hard turn is caught up faster than a gentle one', () => {
  const closed = (turn) => {
    const s = followState();
    stepFollow(s, TUNING, at(0, 0, 0), OPEN, 1 / 60);
    for (let i = 0; i < 12; i++) stepFollow(s, TUNING, at(0, 0, turn), OPEN, 1 / 60);
    return s.yaw / turn;
  };
  const gentle = closed(0.15), hard = closed(2.4);
  assert.ok(gentle > 0.2 && gentle < 0.45, `a gentle turn closes calmly: ${gentle}`);
  assert.ok(hard > 0.7, `a hard turn is mostly closed in the same fifth of a second: ${hard}`);
});

test('follow: the same turn lands on the same yaw at 30, 60 and 144 frames a second', () => {
  const after = (hz) => {
    const s = followState();
    stepFollow(s, TUNING, at(0, 0, 0), OPEN, 1 / hz);
    // A turn small enough to stay on one time constant, so the closed form is exact.
    for (let i = 0; i < hz; i++) stepFollow(s, { ...TUNING, yawTauHard: TUNING.yawTau }, at(0, 0, 0.5), OPEN, 1 / hz);
    return s.yaw;
  };
  near(after(30), after(60), 1e-9);
  near(after(60), after(144), 1e-9);
});

test('follow: a pillar straight behind is swung around at the full arm', () => {
  const pillar = (x, z) => Math.hypot(x, z + 3) - 1;
  const s = stepFollow(followState(), TUNING, at(0, 0), pillar, 1 / 60);
  assert.equal(s.guard, 'swing');
  near(s.reach, 6);
  assert.ok(Math.abs(s.swing) > 0 && Math.abs(s.swing) <= TUNING.swingMax + 1e-9);
  assert.ok(pillar(s.eyeX, s.eyeZ) >= TUNING.lensRadius);
});

test('follow: the swing stays on the side it is already on when both sides are equal', () => {
  const pillar = (x, z) => Math.hypot(x, z + 3) - 1;
  for (const side of [-1, 1]) {
    const s = followState();
    s.swing = side * 0.01;
    stepFollow(s, TUNING, at(0, 0), pillar, 1 / 60);
    assert.equal(Math.sign(s.swing), side);
  }
});

test('follow: a wall behind that no swing clears pulls the lens in, and it stays out of the head', () => {
  const wall = (_x, z) => z + 3; // solid for z < -3
  const s = stepFollow(followState(), TUNING, at(0, 0), wall, 1 / 60);
  assert.equal(s.guard, 'pull');
  assert.ok(s.reach < 6 && s.reach > 2, `pulled in, not collapsed: ${s.reach}`);
  assert.ok(wall(s.eyeX, s.eyeZ) >= TUNING.lensRadius);
  near(s.climb, 0);
});

test('follow: with no room to pull in, the lens climbs until it is clear of the head', () => {
  const pocket = (x, z) => 0.6 - Math.hypot(x, z); // a hole 0.6 m across
  const target = at(0, 0);
  const s = stepFollow(followState(), TUNING, target, pocket, 1 / 60);
  assert.equal(s.guard, 'climb');
  assert.ok(s.reach <= 0.2 + 1e-9, `the reach is what the pocket allows: ${s.reach}`);
  assert.ok(s.climb > 0.4, `it rose: ${s.climb}`);
  near(headGap(s, target, TUNING), TUNING.headRadius, 1e-9);
  assert.ok(pocket(s.eyeX, s.eyeZ) >= TUNING.lensRadius);
});

test('follow: nowhere to stand at all puts the lens directly overhead', () => {
  const sealed = (x, z) => (Math.hypot(x, z) < 1e-6 ? 1 : -1);
  const target = at(3, 4);
  const s = stepFollow(followState(), TUNING, target, sealed.bind(null), 1 / 60);
  // The field is centred on the origin, the subject is not: every sample is solid.
  near(s.reach, 0); near(s.eyeX, 3); near(s.eyeZ, 4);
  assert.ok(headGap(s, target, TUNING) >= TUNING.headRadius - 1e-9);
});

test('follow: through a winding tunnel with pillars the lens is never in solid and never in the head', () => {
  // A tunnel 2.6 m either side of a sine centreline, with a pillar every 9 m.
  const centre = (z) => 4 * Math.sin(z / 6);
  const field = (x, z) => {
    let c = 2.6 - Math.abs(x - centre(z));
    const pz = Math.round(z / 9) * 9;
    c = Math.min(c, Math.hypot(x - (centre(pz) + 1.5), z - pz) - 0.5);
    return c;
  };
  const run = () => {
    const s = followState();
    const seen = new Set();
    let z = 0, worstWall = Infinity, worstHead = Infinity;
    const trace = [];
    for (let i = 0; i < 3000; i++) {
      // A frame time that wobbles between 60 and 30 Hz, and a speed that surges.
      const dt = i % 7 === 0 ? 1 / 30 : 1 / 60;
      const speed = 6 + 5 * Math.sin(i / 40);
      z += speed * dt;
      // Hug the side away from the pillars so the subject itself always has room.
      const x = centre(z) - 1.2;
      const yaw = Math.atan2((4 / 6) * Math.cos(z / 6), 1);
      const target = { x, y: 0, z, yaw, speed };
      assert.ok(field(x, z) >= TUNING.lensRadius, 'the scripted subject has room to stand');
      stepFollow(s, TUNING, target, field, dt);
      worstWall = Math.min(worstWall, field(s.eyeX, s.eyeZ));
      worstHead = Math.min(worstHead, headGap(s, target, TUNING));
      seen.add(s.guard);
      if (i % 100 === 0) trace.push(s.eyeX, s.eyeY, s.eyeZ);
    }
    return { worstWall, worstHead, seen, trace };
  };
  const a = run();
  assert.ok(a.worstWall >= TUNING.lensRadius - 1e-9, `closest the lens came to solid: ${a.worstWall}`);
  assert.ok(a.worstHead >= TUNING.headRadius - 1e-9, `closest the lens came to the head: ${a.worstHead}`);
  // The run has to have exercised the guard, or the two lines above prove nothing.
  assert.ok(a.seen.has('clear') && (a.seen.has('swing') || a.seen.has('pull')), `guard states seen: ${[...a.seen]}`);
  // And it is a function of its inputs: a second run is the same numbers.
  assert.deepEqual(run().trace, a.trace);
});

test('follow: a cut snaps to the new pose instead of easing across the level', () => {
  const s = followState();
  stepFollow(s, TUNING, at(0, 0, 0), OPEN, 1 / 60);
  cutFollow(s);
  stepFollow(s, TUNING, at(500, 500, Math.PI), OPEN, 1 / 60);
  near(s.eyeX, 500, 1e-9); near(s.eyeZ, 506, 1e-9);
});

test('follow: a yes/no query works as the collision function', () => {
  const blocked = (x, z) => z < -3 || Math.abs(x) > 50;
  const field = fieldFromBlocked(blocked, TUNING.lensRadius);
  const s = stepFollow(followState(), TUNING, at(0, 0), field, 1 / 60);
  assert.equal(blocked(s.eyeX, s.eyeZ), false);
  assert.ok(s.reach < 6);
});
