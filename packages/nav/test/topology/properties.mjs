import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './continuation.mjs';

export function continuationCases(up, shard) {
  for (let seed = shard + 1; seed <= (process.env.NAV_FULL ? 300 : 1); seed += 4) {
    test(`editable restore, ${up}-up, seed ${seed}`, async () => {
      const runs = [
        run(seed, up, null),
        run(seed, up, { at: 1, order: 'bake' }),
        run(seed, up, { at: 1, order: 'shuffle' }),
      ];
      for (let tick = 0; tick <= 320; tick++) {
        const straight = runs[0].next();
        for (let i = 1; i < runs.length; i++) {
          const fork = runs[i].next();
          assert.deepEqual(fork, straight, `seed ${seed}, ${up}, tick ${tick}, order ${i}`);
        }
      }
    });
  }
}
