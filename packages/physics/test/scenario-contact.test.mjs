import { each, row, flag, run, cpos } from "./scenario-harness.mjs";
// All cases use applied input, including explicit zero input. Distances and
// positions have a 1 cm tolerance; support and crush flags are exact.
for (const motion of ["past", "rising"])
  for (const input of ["idle", "push", "along"])
    each((a, hz) => {
      const w = a.world();
      a.floor(w);
      const wall = w.createBody({
        type: "kinematic",
        position: a.V(0.56, 0, 0),
        colliders: [{ shape: a.box(0.25, 20, 30) }],
      });
      const c = a.chr(w, 0, 1, 0);
      run(w, hz, 0.5, () => w.controlCharacter(c, a.inp()));
      const start = cpos(w, c);
      let travel = 0,
        last = start;
      run(
        w,
        hz,
        2,
        (_, t) => {
          w.moveKinematic(
            wall,
            a.V(
              0.56,
              motion === "rising" ? t : 0,
              motion === "past" ? -3 * t : 0,
            ),
          );
          w.controlCharacter(
            c,
            a.inp(input === "push" ? 2 : 0, input === "along" ? 2 : 0),
          );
        },
        () => {
          const p = cpos(w, c);
          travel += Math.hypot(p.x - last.x, a.s(p) - a.s(last));
          last = p;
        },
      );
      const p = cpos(w, c),
        s = w.characterState(c),
        distance = input === "along" ? 4 : 0,
        label = `side ${motion} input ${input}`;
      row(`${label}: distance`, a.up, hz, travel, distance, 0.01);
      row(
        `${label}: position`,
        a.up,
        hz,
        [p.x, a.h(p), a.s(p)],
        [start.x, a.h(start), a.s(start) + distance],
        0.01,
      );
      flag(`${label}: flags`, a.up, hz, s.grounded && !s.crushed);
      w.dispose();
    });
each((a, hz) => {
  const w = a.world();
  a.floor(w);
  const c = a.chr(w, 0, 1, 0);
  const wall = w.createBody({
    type: "static",
    position: a.V(2, 2, 0),
    colliders: [{ shape: a.box(0.25, 2, 10) }],
  });
  run(w, hz, 0.5, () => w.controlCharacter(c, a.inp()));
  w.teleport(wall, a.V(0.5, 2, 0));
  let last = cpos(w, c),
    travel = 0;
  run(
    w,
    hz,
    1,
    () => w.controlCharacter(c, a.inp(0, 2)),
    () => {
      const p = cpos(w, c);
      travel += Math.abs(a.s(p) - a.s(last));
      last = p;
    },
  );
  row("depenetrate edited solid: distance", a.up, hz, travel, 2, 0.01);
  row(
    "depenetrate edited solid: position",
    a.up,
    hz,
    [last.x, a.h(last), a.s(last)],
    [-0.06, 0.91, 2],
    0.01,
  );
  const state = w.characterState(c);
  flag(
    "depenetrate edited solid: flags",
    a.up,
    hz,
    state.grounded && !state.crushed,
  );
  w.dispose();
});
