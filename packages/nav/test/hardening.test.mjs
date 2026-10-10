import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { bakeTile, bakeLevel, bakeHeightfield } from '@homie-rocks/nav/Bake.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { pack, unpack, hash } from '../dist/internal/Binary.js';
import { meshData } from '../dist/internal/MeshData.js';
import { deterministicSin, deterministicCos } from '../dist/internal/Math.js';
import { config, field, flat, tune } from './fixtures.mjs';

test('loaded editable tiles retain packed buffers and configurable limits', () => {
  const bytes = bakeTile(field(), config, 0, 0);
  const mesh = new Mesh(config, [1, 1, 1], {
    maxRetainedCells: 1_000_000,
    maxRetainedSpans: 1_000_000,
  });
  mesh.loadTile(bytes);
  assert.ok(meshData(mesh).tiles['0,0'].compact.cells instanceof Uint32Array);
  const small = new Mesh(config, [1, 1, 1], { maxRetainedCells: 1 });
  assert.throws(() => small.loadTile(bytes), /nav:.*budget/);
});

test('heightfield sampling starts per tile even beyond four million total samples', () => {
  assert.throws(
    () =>
      bakeHeightfield(
        {
          heightAt() {
            throw Error('sample started');
          },
        },
        config,
        { min: [0, 0], max: [1000, 1000] },
      ),
    /sample started/,
  );
});

test('downward geometry reports a winding diagnostic', () => {
  const input = {
    positions: [0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 0, 10, 0, 10, 0, 0, 10],
  };
  assert.throws(() => bakeLevel(input, config), /no walkable triangles; check winding/);
});

test('deterministic trig has exact axes and near-ulp accuracy at sampling angles', () => {
  assert.equal(deterministicCos(0), 1);
  assert.equal(deterministicSin(Math.PI / 2), 1);
  const view = new DataView(new ArrayBuffer(8));
  const ulp = (x) => {
    view.setFloat64(0, Math.abs(x));
    view.setBigUint64(0, view.getBigUint64(0) + 1n);
    return view.getFloat64(0) - Math.abs(x);
  };
  for (let i = -4096; i <= 4096; i++) {
    const x = (i * Math.PI) / 1024;
    assert.ok(Math.abs(deterministicSin(x) - Math.sin(x)) <= ulp(Math.sin(x)), `sin ${x}`);
    assert.ok(Math.abs(deterministicCos(x) - Math.cos(x)) <= ulp(Math.cos(x)), `cos ${x}`);
  }
});

test('checksum-valid but structurally invalid saves fail at the boundary', () => {
  const mesh = flat();
  const c = new Crowd(mesh, 0.05, 0.3);
  const id = c.add([1, 0.1, 1], tune);
  const saved = unpack('crowd', c.save());
  saved.state.data.agents[id] = { position: 'x' };
  assert.throws(() => Crowd.restore(pack('crowd', saved), mesh), /^Error: nav:/);
  const tile = unpack('tile', bakeTile(field(), config, 0, 0));
  tile.baked.polys = [1, 2, 3];
  assert.throws(() => mesh.loadTile(pack('tile', tile)), /^Error: nav:/);
});

test('runtime guards both upstream files and state pins the backend version', async () => {
  const script = await readFile(new URL('../scripts/runtime.mjs', import.meta.url), 'utf8');
  assert.match(script, /index\.js/);
  const state = await readFile(new URL('../src/internal/Binary.ts', import.meta.url), 'utf8');
  assert.match(state, /0\.4\.1/);
});

test('typed sections explicitly encode little endian values', async () => {
  const state = await readFile(new URL('../src/internal/Binary.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(state, /bytes\.set\(new Uint8Array\(v\.buffer/);
  const value = new Uint32Array([0x10203040]);
  const bytes = pack('array', value);
  assert.deepEqual(unpack('array', bytes), value);
  assert.ok(Buffer.from(bytes).includes(Buffer.from([0x40, 0x30, 0x20, 0x10])));
});

test('backend version is rejected even with a valid checksum', () => {
  const bytes = pack('version-test', {});
  const at = Buffer.from(bytes).indexOf('navcat@0.4.1');
  assert.ok(at >= 16);
  bytes[at + 'navcat@0.4.'.length] = '2'.charCodeAt(0);
  new DataView(bytes.buffer).setUint32(12, hash(bytes.subarray(16)), true);
  assert.throws(() => unpack('version-test', bytes), /nav: invalid or incompatible/);
});

test('argument reduction retains relative precision near quadrant boundaries', () => {
  for (const x of [Math.PI, 2 * Math.PI, -Math.PI, 1e6]) {
    const expected = Math.sin(x);
    assert.ok(
      Math.abs(deterministicSin(x) - expected) <= Math.abs(expected) * Number.EPSILON,
      `relative sine accuracy at ${x}`,
    );
  }
});
