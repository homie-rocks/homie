import { scene, modes, runArrival, compareArrival } from './arrival-matrix.mjs';
for (const up of ['y', 'z']) {
  const s = scene(up);
  for (const count of [1, 60, 300, 1000]) {
    const baseline = runArrival(s, count, 'none');
    console.log(up, count, 'none', baseline.length, Math.max(...baseline));
    for (const mode of modes.slice(1)) {
      const result = runArrival(s, count, mode);
      if (['link', 'obstacle', 'same'].includes(mode)) compareArrival(result, baseline);
      console.log(up, count, mode, result.length, Math.max(...result));
    }
  }
}
