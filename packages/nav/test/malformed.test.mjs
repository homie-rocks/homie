import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Grid } from '@homie-rocks/nav/Grid.js';
import { pack, unpack } from '../dist/internal/Binary.js';
const data = JSON.parse(gunzipSync(readFileSync(new URL('./malformed.json.gz', import.meta.url))));
const decode = s => new Uint8Array(Buffer.from(s, 'base64'));
const assets = data.assets.map(decode);
const base = Mesh.restore(decode(data.mesh), assets);
for (const [i, c] of data.cases.entries()) test(`malformed ${c.kind} ${i}: ${c.label}`, () => {
  let bytes = decode(c.bytes);
  if (c.kind === 'crowd') {
    const s = unpack('crowd', bytes);
    s.state.generations = {};
    bytes = pack('crowd', s);
  }
  assert.throws(() => {
    if (c.kind === 'tile') new Mesh(data.config, data.extents).loadTile(bytes);
    else if (c.kind === 'mesh') Mesh.restore(bytes, assets);
    else if (c.kind === 'crowd') Crowd.restore(bytes, base);
    else Grid.restore(bytes);
  }, /^Error: nav:/);
});
