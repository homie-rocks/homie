import test from 'node:test';
import { scene, modes, runArrival, compareArrival } from './arrival-matrix.mjs';
for (const up of ['y', 'z']) test(`arrival under edits and repeated targets, ${up}`, () => {
  const s = scene(up);
  const baseline = runArrival(s, 1, 'none');
  for (const mode of modes.slice(1)) {
    const result = runArrival(s, 1, mode);
    if (['link', 'obstacle', 'same'].includes(mode)) compareArrival(result, baseline);
  }
});
