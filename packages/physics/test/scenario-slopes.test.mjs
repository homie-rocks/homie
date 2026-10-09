import { each, row, flag, run, cpos, HF } from "./scenario-harness.mjs";
// Speeds are horizontal metres/second. Tolerance: 1% travel, 3 cm height,
// zero ungrounded ticks on walkable slopes, and <=1 mm idle drift.
for (const kind of ["box", "heightfield"])
  for (const degrees of [10, 20, 30, 39])
    each((a, hz) => {
      const w = a.world(),
        angle = (degrees * Math.PI) / 180;
      if (kind === "box") {
        const signed = angle * (a.up === "y" ? 1 : -1);
        const rotation =
          a.up === "y"
            ? { x: 0, y: 0, z: Math.sin(signed / 2), w: Math.cos(signed / 2) }
            : { x: 0, y: Math.sin(signed / 2), z: 0, w: Math.cos(signed / 2) };
        w.createBody({
          type: "static",
          position: a.V(0, -0.5 / Math.cos(angle), 0),
          rotation,
          colliders: [{ shape: a.box(40, 0.5, 10) }],
        });
      } else {
        const n = 65,
          heights = new Float32Array(n * n);
        for (let z = 0; z < n; z++)
          for (let x = 0; x < n; x++)
            heights[z * n + x] = (x - 32) * Math.tan(angle);
        w.createBody({
          type: "static",
          colliders: [
            HF.heightfieldGrid(
              { nx: n, nz: n, cell: 1, x0: -32, z0: -32, heights },
              "x-fast",
              a.up,
            ),
          ],
        });
      }
      const c = a.chr(w, 0, 2, 0.2);
      run(w, hz, 1, () => w.controlCharacter(c, a.inp()));
      for (const [mode, vx, vs] of [
        ["up", 2, 0],
        ["down", -2, 0],
        ["across", 0, 2],
        ["idle", 0, 0],
      ]) {
        const start = cpos(w, c);
        let travel = 0,
          last = start,
          grounded = true;
        run(
          w,
          hz,
          2,
          () => w.controlCharacter(c, a.inp(vx, vs)),
          () => {
            const p = cpos(w, c);
            travel += Math.hypot(p.x - last.x, a.s(p) - a.s(last));
            last = p;
            grounded &&= w.characterState(c).grounded;
          },
        );
        const p = cpos(w, c),
          label = `${kind} slope ${degrees} ${mode}`;
        row(
          `${label}: travel`,
          a.up,
          hz,
          travel,
          Math.hypot(vx, vs) * 2,
          mode === "idle" ? 0.001 : 0.04,
        );
        row(
          `${label}: position`,
          a.up,
          hz,
          [p.x, a.h(p), a.s(p)],
          [
            start.x + vx * 2,
            a.h(start) + vx * 2 * Math.tan(angle),
            a.s(start) + vs * 2,
          ],
          0.03,
        );
        flag(
          `${label}: flags`,
          a.up,
          hz,
          grounded && !w.characterState(c).crushed,
        );
      }
      w.dispose();
    });
// Over-limit faces cannot supply grounded/jump state. The descending and
// transverse cases use the analytic projection of gravity onto the ramp;
// 5 cm tolerance covers the discrete first-contact time, without rounding state.
for (const mode of ["up", "down", "across"])
  each((a, hz) => {
    const w = a.world(),
      angle = (41 * Math.PI) / 180,
      co = Math.cos(angle),
      si = Math.sin(angle),
      duration = 0.6;
    const signed = angle * (a.up === "y" ? 1 : -1);
    const rotation =
      a.up === "y"
        ? { x: 0, y: 0, z: Math.sin(signed / 2), w: Math.cos(signed / 2) }
        : { x: 0, y: Math.sin(signed / 2), z: 0, w: Math.cos(signed / 2) };
    w.createBody({
      type: "static",
      position: a.V(0, -0.5 / co, 0),
      rotation,
      colliders: [{ shape: a.box(40, 0.5, 10) }],
    });
    const start = a.V(8, 8 * Math.tan(angle) + 0.6 + 0.31 / co, 0),
      c = a.chr(w, start.x, a.h(start), 0, { airAcceleration: 1000 });
    let travel = 0,
      last = start;
    const vx = mode === "up" ? 2 : mode === "down" ? -2 : 0,
      vs = mode === "across" ? 2 : 0;
    run(
      w,
      hz,
      duration,
      () => w.controlCharacter(c, a.inp(vx, vs)),
      () => {
        const p = cpos(w, c);
        travel += Math.hypot(p.x - last.x, a.s(p) - a.s(last));
        last = p;
      },
    );
    const p = cpos(w, c),
      state = w.characterState(c),
      acceleration = 20 * si * co;
    let dx = -0.5 * acceleration * duration ** 2,
      ds = vs * duration,
      expectedTravel = -dx;
    if (mode === "across") {
      dx = -0.5 * acceleration * duration ** 2;
      expectedTravel =
        0.5 * duration * Math.sqrt((acceleration * duration) ** 2 + 4) +
        (2 / acceleration) * Math.asinh((acceleration * duration) / 2);
    } else if (mode === "down") {
      const contact = (4 * Math.tan(angle)) / 20;
      dx =
        -2 * contact -
        2 * co * co * (duration - contact) -
        0.5 * acceleration * (duration ** 2 - contact ** 2);
      expectedTravel = -dx;
    }
    row(
      `over-limit slope ${mode}: distance`,
      a.up,
      hz,
      travel,
      expectedTravel,
      0.05,
    );
    row(
      `over-limit slope ${mode}: position`,
      a.up,
      hz,
      [p.x, a.h(p), a.s(p)],
      [start.x + dx, a.h(start) + dx * Math.tan(angle), ds],
      0.05,
    );
    flag(
      `over-limit slope ${mode}: flags`,
      a.up,
      hz,
      !state.grounded && !state.crushed && state.stance === "sliding",
    );
    w.dispose();
  });
