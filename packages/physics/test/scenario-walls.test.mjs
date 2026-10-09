// Character against kinematic walls and in squeezes. Always under input.
import { each, row, flag, run, cpos, summary } from "./scenario-harness.mjs";
const WALL = (a, w, x, type = "kinematic", hh = 2, hx = 0.25) =>
  w.createBody({
    type,
    position: a.V(x, hh, 0),
    colliders: [{ shape: a.box(hx, hh, 4) }],
  });
// contact x of capsule surface against wall face at xf: centre = xf - 0.3 - offset(0.01)
// still kinematic wall: push into it 1 s, then along it 1 s, then away 1 s
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  const wall = WALL(a, w, 2.25);
  const c = a.chr(w, 0, 1, 0);
  run(w, hz, 0.5);
  let maxH = 0;
  run(
    w,
    hz,
    2,
    () => w.controlCharacter(c, a.inp(2, 0)),
    () => {
      maxH = Math.max(maxH, a.h(cpos(w, c)));
    },
  );
  const p1 = cpos(w, c);
  row(
    "still kinematic wall: push in 2 s (x at wall, max h)",
    a.up,
    hz,
    [p1.x, maxH],
    [1.69, 0.91],
    0.03,
    `grounded=${w.characterState(c).grounded}`,
  );
  run(w, hz, 1, () => w.controlCharacter(c, a.inp(2, 2)));
  const p2 = cpos(w, c);
  row(
    "slide along wall with diagonal input 1 s (x, ds)",
    a.up,
    hz,
    [p2.x, a.s(p2) - a.s(p1)],
    [1.69, 2],
    0.08,
  );
  run(w, hz, 1, () => w.controlCharacter(c, a.inp(-2, 0)));
  const p3 = cpos(w, c);
  row("walk away from wall 1 s (dx)", a.up, hz, p3.x - p2.x, -2, 0.06);
  // jump against the wall while pushing: must not gain height beyond a jump, must not stick
  run(w, hz, 1.2, () => w.controlCharacter(c, a.inp(2, 0)));
  let apex = 0;
  run(
    w,
    hz,
    1.5,
    (i) => w.controlCharacter(c, a.inp(2, 0, i === 0)),
    () => {
      apex = Math.max(apex, a.h(cpos(w, c)) - 0.91);
    },
  );
  row(
    "jump while pushing into wall: apex, final h",
    a.up,
    hz,
    [apex, a.h(cpos(w, c))],
    [0.625, 0.91],
    0.06,
  );
  // spam jump 3 s while pushing in: no climbing
  let top = 0;
  run(
    w,
    hz,
    3,
    () => w.controlCharacter(c, a.inp(2, 0, true)),
    () => {
      top = Math.max(top, a.h(cpos(w, c)) - 0.91);
    },
  );
  row(
    "jump-spam into kinematic wall 3 s: max height gained",
    a.up,
    hz,
    top,
    0.625,
    0.07,
  );
  w.dispose();
});
// approaching wall (1 m/s toward -x) while the character pushes into it at 2 m/s: char is pushed back at 1 m/s
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  const wall = WALL(a, w, 2.25);
  const c = a.chr(w, 0, 1, 0);
  run(w, hz, 0.5);
  run(w, hz, 1.5, () => w.controlCharacter(c, a.inp(2, 0)));
  let maxH = 0,
    maxGap = 0,
    minGap = 9,
    crushed = 0;
  run(
    w,
    hz,
    2,
    (i, t) => {
      w.moveKinematic(wall, a.V(2.25 - 1 * t, 2, 0));
      w.controlCharacter(c, a.inp(2, 0));
    },
    () => {
      const g = w.bodyState(wall).position.x - 0.25 - (cpos(w, c).x + 0.3);
      maxGap = Math.max(maxGap, g);
      minGap = Math.min(minGap, g);
      maxH = Math.max(maxH, a.h(cpos(w, c)));
      if (w.characterState(c).crushed) crushed++;
    },
  );
  row(
    "wall approaching 1 m/s, char pushing in 2 m/s, 2 s: x",
    a.up,
    hz,
    cpos(w, c).x,
    1.69 - 2,
    0.05,
    `gap ${minGap.toFixed(3)}..${maxGap.toFixed(3)} maxH ${maxH.toFixed(3)} crushed ticks ${crushed}`,
  );
  flag(
    "no penetration / no climb / not crushed",
    a.up,
    hz,
    minGap > -0.02 && maxH < 0.93 && crushed === 0,
    `gap ${minGap.toFixed(3)}..${maxGap.toFixed(3)} maxH ${maxH.toFixed(3)} crushed ${crushed}`,
  );
  // wall approaching while char stands still with zero input, then char walks away faster than wall
  run(w, hz, 1, (i, t) => {
    w.moveKinematic(wall, a.V(0.25 - 1 * t, 2, 0));
    w.controlCharacter(c, a.inp(0, 0));
  });
  row(
    "wall approaching 1 m/s, char idle 1 s: x",
    a.up,
    hz,
    cpos(w, c).x,
    1.69 - 3,
    0.05,
  );
  const x0 = cpos(w, c).x;
  run(w, hz, 1, (i, t) => {
    w.moveKinematic(wall, a.V(-0.75 - 1 * t, 2, 0));
    w.controlCharacter(c, a.inp(-3, 0));
  });
  row(
    "wall approaching 1 m/s, char walks away 3 m/s 1 s: dx",
    a.up,
    hz,
    cpos(w, c).x - x0,
    -3,
    0.08,
  );
  w.dispose();
});
// retreating wall (1 m/s away) while char pushes at 2 m/s: char follows at 1 m/s without overlap; faster wall (3 m/s): char walks free at 2
for (const vw of [1, 3])
  each((a, hz) => {
    const w = a.world();
    a.floor(w);
    const wall = WALL(a, w, 2.25);
    const c = a.chr(w, 0, 1, 0);
    run(w, hz, 0.5);
    run(w, hz, 1.5, () => w.controlCharacter(c, a.inp(2, 0)));
    const x0 = cpos(w, c).x;
    let minGap = 9,
      maxH = 0;
    run(
      w,
      hz,
      2,
      (i, t) => {
        w.moveKinematic(wall, a.V(2.25 + vw * t, 2, 0));
        w.controlCharacter(c, a.inp(2, 0));
      },
      () => {
        const g = w.bodyState(wall).position.x - 0.25 - (cpos(w, c).x + 0.3);
        minGap = Math.min(minGap, g);
        maxH = Math.max(maxH, a.h(cpos(w, c)));
      },
    );
    row(
      `wall retreating ${vw} m/s, char pushing 2 m/s, 2 s: dx`,
      a.up,
      hz,
      cpos(w, c).x - x0,
      Math.min(vw, 2) * 2,
      0.1,
      `min gap ${minGap.toFixed(3)} maxH ${maxH.toFixed(3)}`,
    );
    flag(
      `retreating ${vw}: no penetration, no climb`,
      a.up,
      hz,
      minGap > -0.02 && maxH < 0.93,
      `min gap ${minGap.toFixed(3)} maxH ${maxH.toFixed(3)}`,
    );
    w.dispose();
  });
// wall sliding sideways (along its own face, 3 m/s) while char pushes into it: char must not be dragged
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  const wall = w.createBody({
    type: "kinematic",
    position: a.V(2.25, 2, 0),
    colliders: [{ shape: a.box(0.25, 2, 30), friction: 1 }],
  });
  const c = a.chr(w, 0, 1, 0);
  run(w, hz, 0.5);
  run(w, hz, 1.5, () => w.controlCharacter(c, a.inp(2, 0)));
  const p0 = cpos(w, c);
  run(w, hz, 2, (i, t) => {
    w.moveKinematic(wall, a.V(2.25, 2, 3 * t));
    w.controlCharacter(c, a.inp(2, 0));
  });
  const p1 = cpos(w, c);
  row(
    "wall sliding along its face 3 m/s, char pushing in: (dx, ds, h)",
    a.up,
    hz,
    [p1.x - p0.x, a.s(p1) - a.s(p0), a.h(p1)],
    [0, 0, 0.91],
    0.05,
  );
  w.dispose();
});
// horizontal squeeze: kinematic wall pushes char into static wall; char also pushes back. Then wall retreats: char must be free and in bounds.
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  const stat = WALL(a, w, -2.25, "static");
  const wall = WALL(a, w, 2.25);
  const c = a.chr(w, 0, 1, 0);
  run(w, hz, 0.5);
  let crushed = 0,
    minX = 9,
    firstCrush = null;
  run(
    w,
    hz,
    4,
    (i, t) => {
      w.moveKinematic(wall, a.V(2.25 - 1 * t, 2, 0));
      w.controlCharacter(c, a.inp(1, 0));
    },
    (i, t) => {
      const s = w.characterState(c);
      if (s.crushed) {
        crushed++;
        firstCrush ??= t;
      }
      minX = Math.min(minX, cpos(w, c).x);
    },
  );
  // static face at x=-2.0, so char centre can't go below -1.69. Wall face reaches -1.38 (touch both) at t = (2.0 - -1.38)/1 = 3.38-ish
  flag(
    "horizontal squeeze: crushed reported, never through static wall",
    a.up,
    hz,
    crushed > 0 && minX > -1.72,
    `first crushed t=${firstCrush} crushed ticks ${crushed} min x ${minX.toFixed(3)} (limit -1.69) final ${cpos(w, c).x.toFixed(3)} h ${a.h(cpos(w, c)).toFixed(3)}`,
  );
  run(w, hz, 2, (i, t) => {
    w.moveKinematic(wall, a.V(-1.75 + 2 * t, 2, 0));
    w.controlCharacter(c, a.inp(0, 0));
  });
  const x0 = cpos(w, c).x;
  run(w, hz, 1, () => w.controlCharacter(c, a.inp(2, 0)));
  row(
    "after wall retreats: walk +x 1 s (dx), h",
    a.up,
    hz,
    [cpos(w, c).x - x0, a.h(cpos(w, c))],
    [2, 0.91],
    0.08,
    `crushed=${w.characterState(c).crushed} x0=${x0.toFixed(3)}`,
  );
  w.dispose();
});
// vertical: press descending 1.2 m/s onto a character walking under it on a static floor
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  const press = w.createBody({
    type: "kinematic",
    position: a.V(0, 4, 0),
    colliders: [{ shape: a.box(3, 0.5, 3) }],
  });
  const c = a.chr(w, -1, 1, 0);
  run(w, hz, 0.5);
  let crushed = 0,
    first = null,
    minH = 9;
  run(
    w,
    hz,
    3,
    (i, t) => {
      w.moveKinematic(press, a.V(0, Math.max(0.7, 4 - 1.2 * t), 0));
      w.controlCharacter(c, a.inp(0.5, 0));
    },
    (i, t) => {
      if (w.characterState(c).crushed) {
        crushed++;
        first ??= t;
      }
      minH = Math.min(minH, a.h(cpos(w, c)));
    },
  );
  // press bottom reaches head (1.81+0.01) at 4-0.5-1.2t = 1.82 -> t=1.4
  flag(
    "press onto walking character: crushed set, never below floor",
    a.up,
    hz,
    crushed > 0 && minH > 0.88,
    `first crushed t=${first} (contact ~1.40) ticks ${crushed} min h ${minH.toFixed(3)} (rest 0.91) final ${JSON.stringify(Object.values(cpos(w, c)).map((n) => +n.toFixed(3)))}`,
  );
  // press lifts again: character must walk normally
  run(w, hz, 1.5, (i, t) => {
    w.moveKinematic(press, a.V(0, 0.7 + 2 * t, 0));
    w.controlCharacter(c, a.inp(0, 0));
  });
  const x0 = cpos(w, c).x;
  run(w, hz, 1, () => w.controlCharacter(c, a.inp(0, 2)));
  const p = cpos(w, c);
  row(
    "after press lifts: walk +s 1 s (ds), h",
    a.up,
    hz,
    [a.s(p), a.h(p)],
    [2, 0.91],
    0.08,
    `crushed=${w.characterState(c).crushed}`,
  );
  w.dispose();
});
// lift carries walking rider into a static ceiling
each((a, hz) => {
  const w = a.world();
  const lift = w.createBody({
    type: "kinematic",
    position: a.V(0, -0.25, 0),
    colliders: [{ shape: a.box(3, 0.25, 3) }],
  });
  w.createBody({
    type: "static",
    position: a.V(0, 4.5, 0),
    colliders: [{ shape: a.box(5, 0.5, 5) }],
  }); // ceiling bottom at 4.0
  const c = a.chr(w, 0, 1, 0);
  run(w, hz, 0.5);
  let crushed = 0,
    first = null,
    maxH = 0;
  run(
    w,
    hz,
    4,
    (i, t) => {
      w.moveKinematic(lift, a.V(0, -0.25 + Math.min(3, 1 * t), 0));
      w.controlCharacter(c, a.inp(0.3, 0));
    },
    (i, t) => {
      if (w.characterState(c).crushed) {
        crushed++;
        first ??= t;
      }
      maxH = Math.max(maxH, a.h(cpos(w, c)));
    },
  );
  // head hits ceiling when lift top = 4 - 1.82 = 2.18 -> t = 2.18
  flag(
    "lift into ceiling: crushed set, head never above ceiling",
    a.up,
    hz,
    crushed > 0 && maxH < 4 - 0.9 + 0.02,
    `first crushed t=${first} (contact ~2.18) ticks ${crushed} max centre h ${maxH.toFixed(3)} (limit 3.09) lift top ${(a.h(w.bodyState(lift).position) + 0.25).toFixed(3)}`,
  );
  w.dispose();
});
// platform lowers a walking rider onto a static floor and continues below it: rider must end standing on the floor
each((a, hz) => {
  const w = a.world();
  a.floor(w, 40, 0);
  const lift = w.createBody({
    type: "kinematic",
    position: a.V(0, 2 - 0.25, 0),
    colliders: [{ shape: a.box(3, 0.25, 3) }],
  });
  const c = a.chr(w, 0, 3, 0);
  run(w, hz, 0.7);
  let minH = 9;
  run(
    w,
    hz,
    4,
    (i, t) => {
      w.moveKinematic(lift, a.V(0, 1.75 - 1 * t, 0));
      w.controlCharacter(c, a.inp(0.3, 0));
    },
    () => {
      minH = Math.min(minH, a.h(cpos(w, c)));
    },
  );
  const p = cpos(w, c);
  row(
    "lift lowers walking rider through a static floor: final h, x",
    a.up,
    hz,
    [a.h(p), p.x],
    [0.91, 1.2],
    0.08,
    `min h ${minH.toFixed(3)} grounded=${w.characterState(c).grounded} platform=${w.characterState(c).platform}`,
  );
  w.dispose();
});
// squeezed between TWO kinematic walls closing from both sides
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  const l = WALL(a, w, -3),
    r = WALL(a, w, 3);
  const c = a.chr(w, 0.5, 1, 0);
  run(w, hz, 0.5);
  let crushed = 0,
    maxH = 0;
  run(
    w,
    hz,
    3.5,
    (i, t) => {
      const d = Math.max(0.5, 3 - 1 * t);
      w.moveKinematic(l, a.V(-d, 2, 0));
      w.moveKinematic(r, a.V(d, 2, 0));
      w.controlCharacter(c, a.inp(1, 0));
    },
    () => {
      if (w.characterState(c).crushed) crushed++;
      maxH = Math.max(maxH, a.h(cpos(w, c)));
    },
  );
  const p = cpos(w, c);
  flag(
    "two kinematic walls closing to a 0.5 m gap: crushed, not launched",
    a.up,
    hz,
    crushed > 0 && maxH < 1.0 && Math.abs(p.x) < 0.3 && Math.abs(a.s(p)) < 0.5,
    `crushed ticks ${crushed} final (${p.x.toFixed(3)}, h ${a.h(p).toFixed(3)}, s ${a.s(p).toFixed(3)}) maxH ${maxH.toFixed(3)}`,
  );
  w.dispose();
});
// Rotating kinematic bar (door) sweeping a stationary character
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  const bar = w.createBody({
    type: "kinematic",
    position: a.V(0, 1, 0),
    colliders: [{ shape: a.box(3, 1, 0.15) }],
  });
  const c = a.chr(w, 2, 1, a.up === "y" ? 0.8 : 0.8);
  run(w, hz, 0.5);
  let maxH = 0,
    minD = 9,
    crushed = 0;
  run(
    w,
    hz,
    4,
    (i, t) => {
      w.moveKinematic(bar, a.V(0, 1, 0), a.yaw(1.5 * t));
      w.controlCharacter(c, a.inp(0, 0));
    },
    () => {
      maxH = Math.max(maxH, a.h(cpos(w, c)));
      if (w.characterState(c).crushed) crushed++;
    },
  );
  const p = cpos(w, c);
  flag(
    "rotating bar 1.5 rad/s sweeps idle character: stays on floor, finite, moved",
    a.up,
    hz,
    maxH < 0.95 && Number.isFinite(p.x) && Math.hypot(p.x, a.s(p)) < 12,
    `final (${p.x.toFixed(3)}, h ${a.h(p).toFixed(3)}, s ${a.s(p).toFixed(3)}) maxH ${maxH.toFixed(3)} crushed ${crushed}`,
  );
  w.dispose();
});
summary();
