import assert from 'node:assert/strict';
import { test } from 'node:test';
import { predictionShaper } from './prediction-shaper.mjs';

test('prediction shaping repeats each packet stream regardless of other links or directions', () => {
  const options = { delay: 300, loss: .1, seed: 417 };
  const a = predictionShaper(options), b = predictionShaper(options);
  const packets = Array.from({ length: 1000 }, () => a({ t: 'in' }, '0:up'));
  const interleaved = packets.map(() => {
    b({ t: 'snap' }, '0:up'); b({ t: 'in' }, '0:down'); b({ t: 'in' }, '1:up');
    return b({ t: 'in' }, '0:up');
  });
  assert.deepEqual(interleaved, packets);
  assert.ok(packets.includes(null), 'loss is exercised');
  assert.ok(packets.some(x => x !== null && x < 150) && packets.some(x => x > 150), 'both sides of jitter are exercised');
  assert.ok(packets.every(x => x === null || x >= 112.5 && x < 187.5));
  const c = predictionShaper({ ...options, seed: 418 });
  assert.notDeepEqual(packets, packets.map(() => c({ t: 'in' }, '0:up')));
});
