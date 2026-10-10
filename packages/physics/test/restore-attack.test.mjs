import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createWorld, seeded, HF } from "./scenario-harness.mjs";
import { runSeed } from "./restore-attack-fixture.mjs";

for (const up of ["y", "z"])
  test(`independent mixed-command restore attack ${up}`, async () => {
    let runs = 0,
      forks = 0,
      rejected = 0,
      commands = 0;
    for (let seed = 1; seed <= (process.env.PHYSICS_FULL ? 220 : 4); seed++) {
      const worlds = [];
      const api = {
        seeded,
        HF,
        createWorld(options) {
          const w = createWorld(options);
          worlds.push(w);
          return w;
        },
      };
      try {
        let result;
        try {
          result = runSeed(api, seed, up);
        } catch (error) {
          assert.match(
            error.message,
            /character spawn overlaps a solid/,
            `seed ${seed}`,
          );
          rejected++;
          continue;
        }
        runs++;
        commands += result.ops;
        for (const fork of result.forks) {
          forks++;
          assert.equal(
            fork.firstDivergence,
            null,
            JSON.stringify({ seed, up, fork }),
          );
        }
      } finally {
        for (const w of worlds) w.dispose();
      }
      if (seed % 25 === 0) {
        console.log(`attack ${up}: ${seed}/220 seeds, zero divergence`);
        await setImmediate();
      }
    }
    assert.ok(runs > 0 && forks === runs * 4);
    console.log(
      `attack ${up}: ${runs} worlds, ${commands} commands, ${forks} exact forks, ${rejected} overlapping initial spawns rejected`,
    );
  });
