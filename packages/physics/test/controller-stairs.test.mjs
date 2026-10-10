import test from "node:test";
import assert from "node:assert/strict";
import { ax, cpos, run } from "./scenario-harness.mjs";
for (const up of ["y", "z"])
  for (const hz of [20, 30, 60])
    for (const [rise, tread] of [
      [0.15, 0.3],
      [0.18, 0.28],
      [0.2, 0.3],
      [0.25, 0.4],
    ])
      for (const speed of [2, 4, 6])
        for (const direction of [-1, 1])
          test(`stairs ${rise}/${tread} ${direction * speed}m/s ${up} ${hz}Hz`, () => {
            const a = ax(up),
              w = a.world();
            a.floor(w);
            for (let i = 0; i < 10; i++)
              w.createBody({
                type: "static",
                position: a.V(i * tread + 5, rise * (i + 0.5)),
                colliders: [{ shape: a.box(5, rise / 2, 3) }],
              });
            const start = direction < 0 ? 10 * tread + 0.5 : -0.5;
            const c = a.chr(w, start, direction < 0 ? rise * 10 + 1 : 1, 0, {
              snapDistance: 0.35,
            });
            run(w, hz, 0.5);
            run(
              w,
              hz,
              (10 * tread + 1) / speed,
              () => w.controlCharacter(c, a.inp(direction * speed)),
              () => {
                const s = w.characterState(c);
                assert.ok(
                  s.grounded,
                  `airborne at ${JSON.stringify(cpos(w, c))}`,
                );
                assert.equal(s.landed, false);
              },
            );
            assert.ok(
              Math.abs(
                cpos(w, c).x -
                  (start +
                    (direction *
                      speed *
                      Math.round(((10 * tread + 1) / speed) * hz)) /
                      hz),
              ) < 0.08,
            );
            w.dispose();
          });
