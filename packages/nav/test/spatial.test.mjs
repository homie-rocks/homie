import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { bakeTile } from '@homie-rocks/nav/Bake.js';
import { config, field, tune } from './fixtures.mjs';
test('neighbour storage and probes are sparse at kilometre separation', () => {
  const source = readFileSync(new URL('../src/internal/Generated.ts', import.meta.url), 'utf8');
  const query = source.slice(
    source.indexOf('const updateNeighbours ='),
    source.indexOf('const updateLocalBoundaries ='),
  );
  assert.doesNotMatch(query, /new Array\(gridSize\)/);
  assert.match(query, /new Map/);
  for (const gap of [20, 4000]) {
    const mesh = new Mesh(config, [1, 2, 1]);
    for (const offset of [0, gap])
      mesh.loadTile(
        bakeTile(
          field(() => 0, offset - 2, offset - 2),
          config,
          offset / 10,
          offset / 10,
        ),
      );
    const c = new Crowd(mesh, 0.05, 0.3);
    for (const offset of [0, gap])
      for (let i = 0; i < 5; i++)
        c.add([offset + 2 + i, 0, offset + 2], { ...tune, neighbours: 0.75 });
    for (let i = 0; i < 100; i++) c.step();
    assert.equal(c.ids().length, 10);
  }
});

test('neighbour allocation and query work depend on agents, not world extent', () => {
  const source = readFileSync(new URL('../src/internal/Generated.ts', import.meta.url), 'utf8');
  const query = source.slice(
    source.indexOf('const updateNeighbours ='),
    source.indexOf('const updateLocalBoundaries ='),
  );
  for (const gap of [20, 4000]) {
    let probes = 0,
      cells = 0;
    class CountedMap extends Map {
      get(key) {
        probes++;
        return super.get(key);
      }
      set(key, value) {
        cells++;
        return super.set(key, value);
      }
    }
    const update = new Function('Map', 'AgentState', query + '; return updateNeighbours;')(
      CountedMap,
      { WALKING: 1 },
    );
    const agents = {};
    for (const offset of [0, gap])
      for (let i = 0; i < 5; i++)
        agents[Object.keys(agents).length] = {
          state: 1,
          neis: [],
          position: [offset + i, 0, offset],
          collisionQueryRange: 0.75,
        };
    update({ agents });
    assert.equal(cells, 10);
    assert.ok(probes <= 100, `ten inserts and at most nine queries per agent: ${probes}`);
    assert.ok(Object.values(agents).every((a) => a.neis.length === 0));
  }
});
