// Character on kinematic platforms, always under input. 20/30/60 Hz, both up axes.
import { each, row, flag, run, cpos, summary } from "./scenario-harness.mjs";
const PLAT = (a, w, x = 0, s = 0, h = 0, hx = 6, hs = 6) =>
  w.createBody({
    type: "kinematic",
    position: a.V(x, h - 0.25, s),
    colliders: [{ shape: a.box(hx, 0.25, hs) }],
  });
const rel = (a, w, c, p) => {
  const cp = cpos(w, c),
    pp = w.bodyState(p).position;
  return [cp.x - pp.x, a.h(cp) - (a.h(pp) + 0.25), a.s(cp) - a.s(pp)];
};

// A. parked platform (never moved)
each((a, hz) => {
  const w = a.world();
  const p = PLAT(a, w);
  const c = a.chr(w);
  run(w, hz, 0.5);
  const s0 = cpos(w, c);
  w.controlCharacter(c, a.inp(2, 0));
  run(w, hz, 1, () => w.controlCharacter(c, a.inp(2, 0)));
  row(
    "parked platform: walk +x 2 m/s 1 s",
    a.up,
    hz,
    cpos(w, c).x - s0.x,
    2,
    0.08,
    `grounded=${w.characterState(c).grounded}`,
  );
  // walk off the edge (edge x=6), 3 more s: expect x = 2+6 = 8 and fallen to floor none -> falls
  const fl = a.floor(w, 40, -3);
  run(w, hz, 3, () => w.controlCharacter(c, a.inp(2, 0)));
  row(
    "parked platform: walk off edge, 4 s total, x",
    a.up,
    hz,
    cpos(w, c).x - s0.x,
    8,
    0.2,
    `h=${a.h(cpos(w, c)).toFixed(3)} (floor at -3 => 0.91-3)`,
  );
  row(
    "height after walking off (landed on floor -3)",
    a.up,
    hz,
    a.h(cpos(w, c)),
    -3 + 0.91,
    0.03,
  );
  w.dispose();
});
// Parked after having moved
each((a, hz) => {
  const w = a.world();
  const p = PLAT(a, w);
  const c = a.chr(w);
  run(w, hz, 0.5);
  run(w, hz, 1, (i, t) => w.moveKinematic(p, a.V(0, -0.25, 2 * t)));
  run(w, hz, 0.25);
  const r0 = rel(a, w, c, p);
  run(w, hz, 1, () => w.controlCharacter(c, a.inp(2, 0)));
  const r1 = rel(a, w, c, p);
  row(
    "platform parked after moving: walk +x 1 s",
    a.up,
    hz,
    [r1[0] - r0[0], r1[2] - r0[2]],
    [2, 0],
    0.08,
  );
  w.dispose();
});
// B. sideways platform 2 and 6 m/s; standing, walking across, with, against
for (const speed of [2, 6])
  for (const [name, ix, is] of [
    ["stand", 0, 0],
    ["walk across +x", 2, 0],
    ["walk with +s", 0, 2],
    ["walk against -s", 0, -2],
    ["walk diagonal", 1.5, -1.5],
  ])
    each((a, hz) => {
      const w = a.world();
      const p = PLAT(a, w, 0, 0, 0, 6, 30);
      const c = a.chr(w);
      run(w, hz, 0.5);
      let t0 = 0;
      const pos = (t) => a.V(0, -0.25, speed * t);
      run(w, hz, 1, (i, t) => w.moveKinematic(p, pos(t))); // ride first, zero input
      const r0 = rel(a, w, c, p);
      let minH = 9,
        maxH = -9,
        ung = 0;
      run(
        w,
        hz,
        1.5,
        (i, t) => {
          w.moveKinematic(p, pos(1 + t));
          w.controlCharacter(c, a.inp(ix, is));
        },
        () => {
          const r = rel(a, w, c, p);
          minH = Math.min(minH, r[1]);
          maxH = Math.max(maxH, r[1]);
          if (!w.characterState(c).grounded) ung++;
        },
      );
      const r1 = rel(a, w, c, p);
      row(
        `B platform ${speed} m/s sideways: ${name} 1.5 s (rel dx, ds)`,
        a.up,
        hz,
        [r1[0] - r0[0], r1[2] - r0[2]],
        [ix * 1.5, is * 1.5],
        0.1,
        `h ${minH.toFixed(3)}..${maxH.toFixed(3)} ungrounded ticks ${ung}`,
      );
      w.dispose();
    });
// C. accelerating platform (4 m/s^2) while walking across
each((a, hz) => {
  const w = a.world();
  const p = PLAT(a, w, 0, 0, 0, 6, 60);
  const c = a.chr(w);
  run(w, hz, 0.5);
  const r0 = rel(a, w, c, p);
  let ung = 0;
  run(
    w,
    hz,
    2,
    (i, t) => {
      w.moveKinematic(p, a.V(0, -0.25, 0.5 * 4 * t * t));
      w.controlCharacter(c, a.inp(2, 0));
    },
    () => {
      if (!w.characterState(c).grounded) ung++;
    },
  );
  const r1 = rel(a, w, c, p);
  row(
    "C accelerating platform 4 m/s2: walk across 2 s (rel dx, ds)",
    a.up,
    hz,
    [r1[0] - r0[0], r1[2] - r0[2]],
    [4, 0],
    0.12,
    `ungrounded ticks ${ung}`,
  );
  w.dispose();
});
// D. rotating platform 1 rad/s: stand at r=2; walk from centre outward
each((a, hz) => {
  const w = a.world();
  const p = PLAT(a, w);
  const c = a.chr(w, 2, 1, 0);
  run(w, hz, 0.5);
  run(w, hz, 3, (i, t) => w.moveKinematic(p, a.V(0, -0.25, 0), a.yaw(1 * t)));
  const cp = cpos(w, c);
  const r = Math.hypot(cp.x, a.s(cp));
  const ang = Math.abs(Math.atan2(a.s(cp), cp.x));
  row(
    "rotating platform 1 rad/s: stand at r=2 for 3 s (r, |angle|)",
    a.up,
    hz,
    [r, ang],
    [2, 3],
    0.06,
  );
  w.dispose();
});
each((a, hz) => {
  const w = a.world();
  const p = PLAT(a, w);
  const c = a.chr(w, 0, 1, 0);
  run(w, hz, 0.5);
  let ung = 0;
  run(
    w,
    hz,
    1.5,
    (i, t) => {
      w.moveKinematic(p, a.V(0, -0.25, 0), a.yaw(1 * t));
      w.controlCharacter(c, a.inp(2, 0));
    },
    () => {
      if (!w.characterState(c).grounded) ung++;
    },
  );
  const cp = cpos(w, c);
  // world-frame input +x at 2 m/s from the centre; carry is tangential: r'' small. Exact: r(t) solves dr/dt = 2 cos(phi - theta)...; integrate numerically for the expectation.
  let x = 0,
    s = 0;
  const dt = 1e-4;
  for (let t = 0; t < 1.5; t += dt) {
    const vx = 2 - 1 * s,
      vs = 1 * x;
    x += vx * dt;
    s += vs * dt;
  }
  row(
    "rotating platform: walk world +x 2 m/s from centre 1.5 s (radius)",
    a.up,
    hz,
    Math.hypot(cp.x, a.s(cp)),
    Math.hypot(x, s),
    0.15,
    `ungrounded ticks ${ung}`,
  );
  w.dispose();
});
// E. elevator up / down at 1 and 3 m/s while walking
for (const vs of [1, 3, -1, -3])
  each((a, hz) => {
    const w = a.world();
    const p = PLAT(a, w);
    const c = a.chr(w);
    run(w, hz, 0.5);
    const r0 = rel(a, w, c, p);
    let ung = 0,
      minH = 9,
      maxH = -9;
    run(
      w,
      hz,
      2,
      (i, t) => {
        w.moveKinematic(p, a.V(0, -0.25 + vs * t, 0));
        w.controlCharacter(c, a.inp(2, 0));
      },
      () => {
        const r = rel(a, w, c, p);
        minH = Math.min(minH, r[1]);
        maxH = Math.max(maxH, r[1]);
        if (!w.characterState(c).grounded) ung++;
      },
    );
    const r1 = rel(a, w, c, p);
    row(
      `E elevator ${vs > 0 ? "up" : "down"} ${Math.abs(vs)} m/s: walk 2 m/s 2 s (rel dx, rel h)`,
      a.up,
      hz,
      [r1[0] - r0[0], r1[1]],
      [4, 0.91],
      0.1,
      `h ${minH.toFixed(3)}..${maxH.toFixed(3)} ungrounded ${ung}`,
    );
    // then stop the lift and stand 0.5 s: must still be on it
    run(w, hz, 0.5, () => w.controlCharacter(c, a.inp(0, 0)));
    row(
      `E elevator ${vs > 0 ? "up" : "down"} ${Math.abs(vs)} m/s: after it stops (rel h)`,
      a.up,
      hz,
      rel(a, w, c, p)[1],
      0.91,
      0.03,
      `grounded=${w.characterState(c).grounded}`,
    );
    w.dispose();
  });
// F. step between two platforms moving in opposite directions
each((a, hz) => {
  const w = a.world();
  const p1 = PLAT(a, w, -3, 0, 0, 3, 40),
    p2 = PLAT(a, w, 3, 0, 0, 3, 40); // seam at x=0
  const c = a.chr(w, -2, 1, 0);
  run(w, hz, 0.5);
  let ung = 0,
    stalled = 0,
    lastX = cpos(w, c).x,
    sAtSeam = null,
    tSeam = null;
  const x0 = lastX;
  run(
    w,
    hz,
    2,
    (i, t) => {
      w.moveKinematic(p1, a.V(-3, -0.25, 2 * t));
      w.moveKinematic(p2, a.V(3, -0.25, -2 * t));
      w.controlCharacter(c, a.inp(2, 0));
    },
    (i, t) => {
      const cp = cpos(w, c);
      if (!w.characterState(c).grounded) ung++;
      if (cp.x - lastX < (2 / hz) * 0.5) stalled++;
      if (sAtSeam === null && cp.x >= 0) {
        sAtSeam = a.s(cp);
        tSeam = t;
      }
      lastX = cp.x;
    },
  );
  const cp = cpos(w, c);
  // expected: x = -2 + 4 = 2; s = +2*1.0 (on p1 for 1 s) - 2*1.0 (on p2 for 1 s) = 0
  row(
    "F two opposite platforms +-2 m/s: walk across seam 2 s (dx, s)",
    a.up,
    hz,
    [cp.x - x0, a.s(cp)],
    [4, 0],
    0.25,
    `stalled ticks ${stalled} ungrounded ${ung} platform=${w.characterState(c).platform === p2 ? "p2" : w.characterState(c).platform === p1 ? "p1" : w.characterState(c).platform}`,
  );
  w.dispose();
});
// G. jumping: while riding (6 m/s), on from floor, off
each((a, hz) => {
  const w = a.world();
  const p = PLAT(a, w, 0, 0, 0, 6, 60);
  const c = a.chr(w);
  run(w, hz, 0.5);
  const pos = (t) => a.V(0, -0.25, 6 * t);
  run(w, hz, 0.5, (i, t) => w.moveKinematic(p, pos(t)));
  const r0 = rel(a, w, c, p);
  let apex = 0,
    air = 0,
    jumped = false;
  run(
    w,
    hz,
    1.5,
    (i, t) => {
      w.moveKinematic(p, pos(0.5 + t));
      w.controlCharacter(c, a.inp(0, 0, i === 0));
    },
    () => {
      const r = rel(a, w, c, p);
      apex = Math.max(apex, r[1] - 0.91);
      if (!w.characterState(c).grounded) air++;
      jumped ||= w.characterState(c).jumped;
    },
  );
  const r1 = rel(a, w, c, p);
  row(
    "jump straight up riding 6 m/s: landing offset (dx, ds)",
    a.up,
    hz,
    [r1[0] - r0[0], r1[2] - r0[2]],
    [0, 0],
    0.12,
    `apex ${apex.toFixed(3)} (ideal 0.625) air ticks ${air} jumped=${jumped}`,
  );
  row("jump apex riding", a.up, hz, apex, 0.625, 0.06);
  w.dispose();
});
each((a, hz) => {
  // jump while walking across a moving platform: relative travel while airborne should be ~2 m/s
  const w = a.world();
  const p = PLAT(a, w, 0, 0, 0, 6, 60);
  const c = a.chr(w);
  run(w, hz, 0.5);
  const pos = (t) => a.V(0, -0.25, 3 * t);
  run(w, hz, 0.5, (i, t) => {
    w.moveKinematic(p, pos(t));
    w.controlCharacter(c, a.inp(2, 0));
  });
  const r0 = rel(a, w, c, p);
  run(w, hz, 1.5, (i, t) => {
    w.moveKinematic(p, pos(0.5 + t));
    w.controlCharacter(c, a.inp(2, 0, i === 0));
  });
  const r1 = rel(a, w, c, p);
  row(
    "jump while walking 2 m/s across 3 m/s platform, 1.5 s (rel dx, ds)",
    a.up,
    hz,
    [r1[0] - r0[0], r1[2] - r0[2]],
    [3, 0],
    0.15,
    `grounded=${w.characterState(c).grounded}`,
  );
  w.dispose();
});
each((a, hz) => {
  // jump ON: from static floor at h=0 onto a platform top at h=0.4 moving 2 m/s in s, then keep walking
  const w = a.world();
  a.floor(w, 40, 0);
  const p = PLAT(a, w, 4, 0, 0.4, 2, 60); // spans x 2..6, top 0.4 (above stepHeight .35)
  const c = a.chr(w, 0, 1, 0);
  run(w, hz, 0.5);
  let on = null;
  run(
    w,
    hz,
    2.5,
    (i, t) => {
      w.moveKinematic(p, a.V(4, 0.15, 2 * t));
      const cp = cpos(w, c);
      w.controlCharacter(c, a.inp(2, 0, cp.x > 1.0 && cp.x < 1.4));
    },
    (i, t) => {
      if (on === null && w.characterState(c).platform === p) on = t;
    },
  );
  const cp = cpos(w, c),
    st = w.characterState(c);
  // expected: x = 0 + 2*2.5 = 5 (on the platform), h = 0.4+0.91
  row(
    "jump onto moving platform (top 0.4) and keep walking: x, h",
    a.up,
    hz,
    [cp.x, a.h(cp)],
    [5, 1.31],
    0.2,
    `boarded at t=${on} platform=${st.platform === p}`,
  );
  // expected s: carried 2 m/s from boarding
  if (on !== null)
    row(
      "carried after boarding (s)",
      a.up,
      hz,
      a.s(cp),
      2 * (2.5 - on),
      0.25,
    );
  // jump OFF the far edge (x=6) and land on floor
  run(w, hz, 1.5, (i, t) => {
    w.moveKinematic(p, a.V(4, 0.15, 2 * (2.5 + t)));
    const cp = cpos(w, c);
    w.controlCharacter(c, a.inp(2, 0, cp.x > 5.5 && cp.x < 5.9));
  });
  const cq = cpos(w, c);
  row(
    "jump off moving platform to floor: x, h",
    a.up,
    hz,
    [cq.x, a.h(cq)],
    [8, 0.91],
    0.25,
    `grounded=${w.characterState(c).grounded} platform=${w.characterState(c).platform}`,
  );
  w.dispose();
});
summary();
