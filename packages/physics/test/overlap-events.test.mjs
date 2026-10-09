import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, box, v, sphere } from "./helpers.mjs";
for (const up of ["y", "z"])
  test(`open trigger pairs equal current overlaps in ${up}-up`, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const w = createWorld({ up, gravity: v(), random: { state: seed } }),
        open = new Set();
      const zones = [],
        bodies = [];
      try {
        for (let i = 0; i < 4; i++)
          zones.push(
            w.createBody({
              type: "static",
              position: v(i * 3, 0, 0),
              colliders: [{ shape: box(1, 1, 1), sensor: true }],
            }),
          );
        for (let i = 0; i < 8; i++)
          bodies.push(
            w.createBody({
              type: "dynamic",
              position: v(i, 0.3, 0),
              colliders: [{ shape: sphere(0.2) }],
            }),
          );
        for (let tick = 0; tick < 100; tick++) {
          const id = bodies[Math.floor(w.random() * bodies.length)];
          if (tick % 3 === 0)
            w.teleport(
              id,
              v(w.random() * 14 - 2, w.random() - 0.5, w.random() - 0.5),
            );
          else w.setVelocity(id, v(w.random() * 8 - 4, 0, 0));
          if (tick % 7 === 0)
            w.updateCollider(w.colliders(id)[0], {
              layers: { membership: 1, filter: tick % 14 === 0 ? 0 : 65535 },
            });
          const events = w.step(1 / 30);
          for (const e of events)
            if (e.kind === "trigger") {
              const key = `${e.colliderA}:${e.colliderB}`;
              if (e.started) open.add(key);
              else open.delete(key);
            }
          const expected = new Set();
          for (const zone of zones) {
            const cid = w.colliders(zone)[0];
            for (const other of w.overlaps(
              box(1, 1, 1),
              w.bodyState(zone).position,
              undefined,
              { excludeBody: zone, sensors: true },
            )) {
              if (zones.some((z) => w.colliders(z).includes(other))) continue;
              // Query filtering uses both membership/filter masks just as engine pairs do.
              const state = w.overlaps(
                sphere(0.2),
                w.bodyState(bodies.find((b) => w.colliders(b).includes(other)))
                  .position,
                undefined,
                {
                  excludeCollider: other,
                  sensors: true,
                  layers: { membership: 1, filter: 65535 },
                },
              );
              if (state.includes(cid))
                expected.add(`${Math.min(cid, other)}:${Math.max(cid, other)}`);
            }
          }
          assert.deepEqual(
            [...open].sort(),
            [...expected].sort(),
            `seed ${seed} tick ${tick}`,
          );
        }
      } finally {
        w.dispose();
      }
    }
  });
