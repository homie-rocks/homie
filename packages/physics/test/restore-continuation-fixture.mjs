import assert from "node:assert/strict";
import { createWorld, seeded } from "./helpers.mjs";
import { heightfieldGrid } from "../dist/Heightfield.js";
import { build, commands } from "./replay-scene.mjs";
const api = { createWorld, seeded, heightfieldGrid };
export async function verifyContinuation(up) {
  const state = build(api, up),
    checkpoints = [],
    digests = [],
    eventDigests = [];
  const record = (tick, commanded) =>
    checkpoints.push({
      tick,
      commanded,
      bytes: state.w.snapshot(),
      dyn: state.dyn.slice(),
      joints: state.joints.slice(),
    });
  try {
    for (let tick = 0; tick < 401; tick++) {
      commands(state, tick);
      if (tick < 300) record(tick, true);
      const events = state.w.step(0.05);
      digests.push(state.w.snapshot());
      eventDigests.push(JSON.stringify(events));
      if (tick < 300) record(tick + 1, false);
    }
  } finally {
    state.w.dispose();
  }
  let completed = 0;
  for (const checkpoint of checkpoints.filter((_, index) => process.env.PHYSICS_FULL || [0, 1, 34, 35, 118, 119, 226, 227, 598, 599].includes(index))) {
    const w = createWorld({ up: up === "y" ? "z" : "y" });
    try {
      w.restore(checkpoint.bytes);
      const resumed = {
        ...state,
        w,
        dyn: checkpoint.dyn.slice(),
        joints: checkpoint.joints.slice(),
      };
      for (let tick = checkpoint.tick; tick < checkpoint.tick + 100; tick++) {
        if (tick !== checkpoint.tick || !checkpoint.commanded)
          commands(resumed, tick);
        const events = w.step(0.05);
        assert.equal(
          Buffer.compare(w.snapshot(), digests[tick]),
          0,
          `snapshot after restore ${checkpoint.tick}, command=${checkpoint.commanded}, tick ${tick}`,
        );
        assert.equal(
          JSON.stringify(events),
          eventDigests[tick],
          `events after restore ${checkpoint.tick}, tick ${tick}`,
        );
      }
    } finally {
      w.dispose();
    }
    if (++completed % 50 === 0) {
      console.log(
        `restore ${up}: ${completed}/${checkpoints.length} checkpoints`,
      );
      await new Promise(setImmediate);
    }
  }
}
