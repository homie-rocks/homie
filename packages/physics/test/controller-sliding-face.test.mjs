import test from "node:test";
import { ax, run } from "./scenario-harness.mjs";

// The original trapping scene, including the approach before the wall moves.
for (const up of ["y", "z"])
  for (const hz of [20, 30, 60])
    test(`sliding wall face remains usable ${up} ${hz}Hz`, () => {
      const a = ax(up);
      for (const [side, rise] of [
        [3, 0],
        [0, 2],
        [0, -2],
        [12, 0],
      ])
        for (const [x, lateral] of [
          [0, 0],
          [2, 0],
          [2, 1.5],
          [0.5, -2],
        ]) {
          const w = a.world();
          try {
            a.floor(w, 100);
            const h = rise < 0 ? 10 : rise > 0 ? -10 : 6;
            const wall = w.createBody({
              type: "kinematic",
              position: a.V(0.81, h),
              colliders: [{ shape: a.box(0.5, rise ? 30 : 8, 40) }],
            });
            const c = a.chr(w, -0.02, 0.91);
            run(w, hz, 0.5);
            run(w, hz, 0.5, () => w.controlCharacter(c, a.inp(x ? 2 : 0)));
            run(w, hz, 2, (i) => {
              const t = (i + 1) / hz;
              w.moveKinematic(wall, a.V(0.81, h + rise * t, side * t));
              w.controlCharacter(c, a.inp(x, lateral));
            });
            w.bodyState(wall);
          } finally {
            w.dispose();
          }
        }
    });
