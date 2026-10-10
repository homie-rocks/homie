import test from "node:test";
import assert from "node:assert/strict";
import { ax, run, cpos } from "./scenario-harness.mjs";
for (const up of ["y", "z"])
  for (const count of [2, 6, 50])
    test(`${count} walkers at a wall never crush (${up})`, () => {
      const a = ax(up),
        w = a.world();
      a.floor(w);
      w.createBody({
        type: "static",
        position: a.V(2, 2),
        colliders: [{ shape: a.box(0.2, 2, 10) }],
      });
      for (const sign of [-1, 1])
        w.createBody({
          type: "static",
          position: a.V(-5, 2, sign * 1.8),
          colliders: [{ shape: a.box(10, 2, 0.2) }],
        });
      const chars = Array.from({ length: count }, (_, i) =>
        a.chr(w, 1 - Math.floor(i / 5) * 0.65, 1, ((i % 5) - 2) * 0.65),
      );
      run(
        w,
        20,
        4,
        () => chars.forEach((c) => w.controlCharacter(c, a.inp(4))),
        () =>
          chars.forEach((c) =>
            assert.equal(w.characterState(c).crushed, false),
          ),
      );
      let deepest = 0;
      for (let i = 0; i < chars.length; i++)
        for (let j = i + 1; j < chars.length; j++) {
          const p = cpos(w, chars[i]),
            q = cpos(w, chars[j]);
          deepest = Math.max(
            deepest,
            0.6 - Math.hypot(p.x - q.x, a.s(p) - a.s(q)),
          );
        }
      assert.ok(deepest < 0.005, `pair overlap ${deepest} metres`);
      w.dispose();
    });
for (const up of ["y", "z"])
  test(`moving wall pushes across open ground without crushing (${up})`, () => {
    const a = ax(up),
      w = a.world();
    a.floor(w);
    const c = a.chr(w, 0, 1);
    const wall = w.createBody({
      type: "kinematic",
      position: a.V(-1, 2),
      colliders: [{ shape: a.box(0.5, 2, 8) }],
    });
    run(w, 60, 0.5);
    run(
      w,
      30,
      3,
      (_, t) => w.moveKinematic(wall, a.V(-1 + t * 3, 2)),
      () => assert.equal(w.characterState(c).crushed, false),
    );
    w.dispose();
  });
