// Diagnostic measurement, not a timing gate. Run alone for comparable numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { createWorld, v, box, options, floor } from "../test/helpers.mjs";
test("step cost for 100, 500 and 2000 awake rigid bodies", (t) => {
  t.diagnostic(
    `${process.version}, ${process.platform} ${process.arch}, ${cpus()[0].model}`,
  );
  for (const count of [100, 500, 2000]) {
    const w = createWorld(options);
    floor(w);
    for (let i = 0; i < count; i++)
      w.createBody({
        type: "dynamic",
        position: v(
          (i % 20) - 9.5,
          0.5 + Math.floor(i / 400) * 1.05,
          (Math.floor(i / 20) % 20) - 9.5,
        ),
        canSleep: false,
        colliders: [{ shape: box(0.45, 0.45, 0.45) }],
      });
    for (let i = 0; i < 120; i++) w.step(w.fixedDt);
    const times = [];
    for (let i = 0; i < 300; i++) {
      const start = performance.now();
      w.step(w.fixedDt);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    assert.equal(w.tick, 420);
    t.diagnostic(
      `${count} bodies: mean ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3)} ms, p50 ${times[150].toFixed(3)} ms, p95 ${times[285].toFixed(3)} ms`,
    );
    w.dispose();
  }
});
