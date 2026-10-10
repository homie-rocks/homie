import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, seeded, character } from "./helpers.mjs";
const seeds = process.env.PHYSICS_FULL ? 300 : 8;
// Each seed owns a straight timeline and a timeline interrupted at random
// command/tick/sub-tick boundaries. Compare every full body state, without rounding.
for (const up of ["y", "z"])
  test(`random restore interleavings remain exact (${up}, ${seeds} seeds)`, async () => {
    for (let seed = 0; seed < seeds; seed++) {
      if (process.env.PHYSICS_FULL && seed % 50 === 0) {
        console.log(`restore ${up}: seed ${seed}/${seeds}`);
        await new Promise(setImmediate);
      }
      let random = seed + 1;
      const rand = () => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return random / 4294967296;
      };
      const V = (x, h, s) =>
        up === "y" ? { x, y: h, z: s } : { x, y: s, z: h };
      const box = (x, h, s) => ({ kind: "box", halfExtents: V(x, h, s) });
      const initial = Array.from(
        { length: 6 + Math.floor(rand() * 5) },
        () => ({
          size: 0.2 + rand() * 0.2,
          mass: 1 + rand() * 10,
          height: 1 + rand() * 3,
          sphere: rand() < 0.5,
        }),
      );
      const worlds = [
        createWorld({ up, random: seeded(seed) }),
        createWorld({ up, random: seeded(seed) }),
      ];
      const bodies = [],
        chars = [],
        platforms = [];
      for (const w of worlds) {
        w.createBody({
          type: "static",
          position: V(0, -0.5, 0),
          colliders: [{ shape: box(20, 0.5, 20) }],
        });
        const ids = [];
        for (let i = 0; i < initial.length; i++)
          ids.push(
            w.createBody({
              type: "dynamic",
              position: V(i - 4, initial[i].height, 2),
              mass: initial[i].mass,
              colliders: [
                {
                  shape: initial[i].sphere
                    ? { kind: "sphere", radius: initial[i].size }
                    : box(initial[i].size, initial[i].size, initial[i].size),
                },
              ],
            }),
          );
        bodies.push(ids);
        platforms.push(
          w.createBody({
            type: "kinematic",
            position: V(0, 0.5, -4),
            colliders: [{ shape: box(3, 0.25, 3) }],
          }),
        );
        chars.push(w.createCharacter({ ...character, position: V(0, 2, -4) }));
        w.createJoint({
          kind: "ball",
          bodyA: ids[0],
          bodyB: ids[1],
          anchorA: V(0.5, 0, 0),
          anchorB: V(-0.5, 0, 0),
        });
      }
      try {
        for (let tick = 0; tick < 120; tick++) {
          const action = Math.floor(rand() * 6),
            pick = Math.floor(rand() * bodies[0].length),
            x = rand() * 6 - 3,
            vx = rand() * 4 - 2,
            vs = rand() * 4 - 2,
            jump = rand() < 0.05;
          for (let side = 0; side < 2; side++) {
            const w = worlds[side],
              ids = bodies[side],
              id = ids[pick];
            if (action === 0 && ids.length > 3) {
              w.removeBody(id);
              ids.splice(pick, 1);
            }
            if (action === 1)
              ids.push(
                w.createBody({
                  type: "dynamic",
                  position: V(x, 3, 2),
                  colliders: [{ shape: box(0.3, 0.3, 0.3) }],
                }),
              );
            if (action === 2)
              w.updateCollider(w.colliders(id)[0], {
                friction: 0.2 + Math.abs(x) / 5,
              });
            if (action === 3) w.teleport(id, V(x, 2, 2));
            if (action === 4) w.sleep(id);
            if (action === 5) w.impulse(id, V(0, 0.2, 0));
            w.controlCharacter(
              chars[side],
              up === "y" ? { x: vx, z: vs, jump } : { x: vx, y: vs, jump },
            );
            w.moveKinematic(
              platforms[side],
              V(x / 10, 0.5 + (tick % 20) / 100, -4),
            );
          }
          if (rand() < 0.25) worlds[1].restore(worlds[1].snapshot());
          for (const dt of [1 / 120, 1 / 40]) {
            const events = worlds.map((w) => w.step(dt));
            assert.deepEqual(
              events[1],
              events[0],
              `events seed ${seed} tick ${tick}`,
            );
            for (const id of [
              ...bodies[0],
              platforms[0],
              worlds[0].characterState(chars[0]).body,
            ])
              assert.deepEqual(
                worlds[1].bodyState(id),
                worlds[0].bodyState(id),
                `body ${id} seed ${seed} tick ${tick}`,
              );
            assert.deepEqual(
              worlds[1].characterState(chars[1]),
              worlds[0].characterState(chars[0]),
              `character seed ${seed} tick ${tick}`,
            );
            assert.equal(
              Buffer.compare(worlds[1].snapshot(), worlds[0].snapshot()),
              0,
              `bytes seed ${seed} tick ${tick}`,
            );
            if (rand() < 0.15) worlds[1].restore(worlds[1].snapshot());
          }
        }
      } finally {
        for (const w of worlds) w.dispose();
      }
    }
  });
