import test from "node:test";
import assert from "node:assert/strict";
import { ax, run } from "./scenario-harness.mjs";
import { inspect } from "../dist/internal/Engine.js";
const total = process.env.PHYSICS_FULL ? 1_000_008 : 6_000;
for (const up of ["y", "z"])
  for (const hz of [20, 24, 30, 50, 60, 120])
    test(`moving wall query soak ${up} ${hz}Hz`, () => {
      const a = ax(up),
        w = a.world();
      a.floor(w, 40);
      const c = a.chr(w, 0, 1);
      const wall = w.createBody({
        type: "kinematic",
        position: a.V(-0.81, 1, 0),
        colliders: [{ shape: a.box(0.5, 8, 40) }],
      });
      run(w, hz, 0.5);
      const raw = inspect(w).world,
        cast = raw.castShape.bind(raw);
      let count = 0;
      raw.castShape = (p, q, v, shape, ...args) => {
        count++;
        assert.ok(Object.values(p).every(Number.isFinite));
        assert.ok(Object.values(q).every(Number.isFinite));
        assert.ok(Object.values(v).every(Number.isFinite));
        assert.ok(Math.hypot(v.x, v.y, v.z) >= 0.0001);
        return cast(p, q, v, shape, ...args);
      };
      let tick = 0,
        seed = hz;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      while (tick < 240 || count < Math.ceil(total / 12)) {
        const t = ++tick / hz;
        const travel = (t * 3) % 40,
          side = travel < 20 ? travel : 40 - travel;
        w.moveKinematic(wall, a.V(-0.81, 1, side));
        w.controlCharacter(
          c,
          tick <= 120
            ? a.inp(-2)
            : a.inp(-2 - random() * 4, (random() - 0.5) * 2),
        );
        w.step(1 / hz);
      }
      assert.ok(w.characterState(c).grounded);
      console.log(
        `${up} ${hz}Hz: ${count} engine queries, ${tick} ticks, zero traps`,
      );
      w.dispose();
    });
