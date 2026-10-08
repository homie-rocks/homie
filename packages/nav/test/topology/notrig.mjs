// Reproduce seeded continuations with host transcendental functions and clocks forbidden in navigation code.
import assert from 'node:assert/strict';
import { run } from './continuation.mjs';
const source = /navcat\/|packages\/nav\/(dist|src)\//;
for (const name of ['sin', 'cos', 'tan', 'atan2', 'acos', 'asin', 'atan', 'pow', 'exp',
  'log', 'log2', 'log10', 'hypot', 'cbrt', 'sinh', 'cosh', 'tanh', 'expm1', 'log1p', 'random']) {
  const real = Math[name];
  Math[name] = (...args) => {
    const caller = new Error().stack.split('\n')[2] ?? '';
    if (source.test(caller)) throw new Error(`host Math.${name} was called`);
    return real(...args);
  };
}
for (const owner of [Date, performance]) {
  const real = owner.now.bind(owner);
  owner.now = () => {
    const caller = new Error().stack.split('\n')[2] ?? '';
    if (source.test(caller)) throw new Error('host clock was called');
    return real();
  };
}
for (let seed = 1; seed <= 24; seed++) {
  const up = seed % 2 ? 'z' : 'y';
  const a = run(seed, up, null, 140), b = run(seed, up, { at: 1 }, 140);
  for (let tick = 0; tick <= 140; tick++) {
    await new Promise(setImmediate);
    assert.deepEqual(b.next(), a.next(), `seed ${seed}, tick ${tick}`);
  }
  console.log(`seed ${seed}: exact without host functions`);
}
