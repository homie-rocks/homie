import { bakeLevel } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Grid } from '@homie-rocks/nav/Grid.js';
import { Random } from '@homie-rocks/nav/Random.js';
import { config, tune } from './fixtures.mjs';

export function geometry(size, pillars = true) {
  const positions = [0, 0, 0, 0, 0, size, size, 0, size, 0, 0, 0, size, 0, size, size, 0, 0];
  if (pillars)
    for (let x = 5; x < size; x += 5)
      for (let z = 5; z < size; z += 5) {
        const v = [
          [x - 0.6, 0, z - 0.6],
          [x + 0.6, 0, z - 0.6],
          [x + 0.6, 0, z + 0.6],
          [x - 0.6, 0, z + 0.6],
          [x - 0.6, 3, z - 0.6],
          [x + 0.6, 3, z - 0.6],
          [x + 0.6, 3, z + 0.6],
          [x - 0.6, 3, z + 0.6],
        ];
        for (const face of [
          [4, 7, 6, 5],
          [0, 4, 5, 1],
          [1, 5, 6, 2],
          [2, 6, 7, 3],
          [3, 7, 4, 0],
        ]) {
          for (const i of [face[0], face[1], face[2], face[0], face[2], face[3]])
            positions.push(...v[i]);
        }
      }
  return { positions };
}
export function makeScene(size = 80, count = 400, pillars = true, retained = false) {
  const c = { ...config, tileCells: 80, retainSpans: retained };
  const assets = bakeLevel(geometry(size, pillars), c);
  const mesh = new Mesh(c, [1, 2, 1]);
  for (const tile of assets) mesh.loadTile(tile.bytes);
  const crowd = new Crowd(mesh, 0.05, 0.3);
  const rng = new Random(831);
  const goals = [];
  for (let i = 0; i < count; i++) {
    const at = mesh.nearest([1 + rng.next() * (size - 2), 0.1, 1 + rng.next() * (size - 2)]);
    const id = crowd.add(at, tune);
    const to = mesh.nearest([size - at[0], 0.1, size - at[2]]);
    goals.push({ id, to });
    crowd.target(id, to);
  }
  const retarget = () => {
    for (const { id, to } of goals) crowd.target(id, to);
  };
  const tick = () => {
    retarget();
    crowd.step();
  };
  return { assets, mesh, crowd, retarget, tick, goals };
}
export function gridScene(kind) {
  const n = 2000,
    bits = new Uint8Array(n * n),
    rng = new Random(81);
  if (kind === 'single') bits[1000 * n + 1000] = 1;
  if (kind === 'random') for (let i = 0; i < bits.length; i++) bits[i] = rng.next() < 0.1 ? 1 : 0;
  if (kind === 'walls')
    for (let x = 100; x < n; x += 100) {
      for (let z = 0; z < n; z++) if ((x / 100) % 2 ? z < n - 20 : z >= 20) bits[z * n + x] = 1;
    }
  if (kind === 'unreachable') for (let z = 0; z < n; z++) bits[z * n + 1000] = 1;
  bits[0] = bits[bits.length - 1] = 0;
  return new Grid(n, n, 1, [0, 0, 0], bits);
}
