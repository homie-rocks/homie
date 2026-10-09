import assert from 'node:assert/strict';
import { bakeLevel, bakeTile } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { config } from './fixtures.mjs';
import { unpack } from '../dist/internal/Binary.js';
import { locate } from '../dist/internal/MeshData.js';
const point = (p, up) => (up === 'z' ? [p[0], -p[2], p[1]] : p);
const quad = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
function box(out, x, z, X, Z) {
  quad(out, [x, 3, z], [x, 3, Z], [X, 3, Z], [X, 3, z]);
  quad(out, [x, -0.2, z], [x, 3, z], [X, 3, z], [X, -0.2, z]);
  quad(out, [X, -0.2, Z], [X, 3, Z], [x, 3, Z], [x, -0.2, Z]);
  quad(out, [x, -0.2, Z], [x, 3, Z], [x, 3, z], [x, -0.2, z]);
  quad(out, [X, -0.2, z], [X, 3, z], [X, 3, Z], [X, -0.2, Z]);
}
export function scene(up) {
  const tri = [];
  quad(tri, [0, 0, 0], [0, 0, 40], [40, 0, 40], [40, 0, 0]);
  for (let x = 8, i = 0; x < 38; x += 8, i++) box(tri, x, i % 2 ? 0 : 4, x + 0.5, i % 2 ? 36 : 40);
  for (let x = 2; x < 40; x += 4)
    for (let z = 6; z < 34; z += 4) box(tri, x - 0.4, z - 0.4, x + 0.4, z + 0.4);
  const convert = (a) => a.flatMap((_, i) => (i % 3 ? [] : point(a.slice(i, i + 3), up)));
  const c = { ...config, up };
  const assets = bakeLevel({ positions: convert(tri) }, c);
  const far = [];
  quad(far, [100, 0, 100], [100, 0, 110], [110, 0, 110], [110, 0, 100]);
  assets.push({
    x: 10,
    z: 10,
    bytes: bakeTile({ positions: convert(far) }, c, 10, 10),
  });
  return { c, assets, up };
}
export const modes = ['none', 'link', 'obstacle', 'route', 'tile', 'same', 'moving', 'combined'];
export function runArrival(s, count, mode, ticks = 2400) {
  const { c, assets, up } = s;
  const mesh = new Mesh(c, [1, 2, 1]);
  for (const a of assets) mesh.loadTile(a.bytes);
  const link = mesh.addLink(point([101, 0, 108], up), point([103, 0, 108], up), 0.8, true);
  const crowd = new Crowd(mesh, 0.05, 0.3);
  const tune = {
    radius: 0.05,
    height: 1.8,
    speed: 6,
    acceleration: 20,
    neighbours: 0.3,
    separation: 1,
  };
  for (let i = 0; i < count; i++) {
    const at = point([1 + (i % 20) * 0.2, 0, 1 + Math.floor(i / 20) * 0.1], up);
    const id = crowd.add(mesh.nearest(at), tune);
    assert.equal(crowd.target(id, point([37, 0, 37.5], up)), true);
  }
  const times = new Array(count).fill(0);
  const moving = mode === 'moving' || mode === 'combined';
  if (moving) assert.notEqual(locate(mesh, [37, 0, 29.8]).nodeRef, locate(mesh, [37, 0, 30.2]).nodeRef);
  const bounds = (a, b) => {
    a = point(a, up);
    b = point(b, up);
    return {
      min: a.map((v, i) => Math.min(v, b[i])),
      max: a.map((v, i) => Math.max(v, b[i])),
    };
  };
  let ob, route;
  for (let tick = 1; tick <= ticks; tick++) {
    if (mode === 'link' || mode === 'combined') mesh.setLinkEnabled(link, tick % 2 === 0);
    if (mode === 'obstacle' || mode === 'combined') {
      if (ob) mesh.removeObstacle(ob);
      ob = mesh.addObstacle(
        bounds([101 + (tick % 2) * 0.05, -1, 106], [101.6 + (tick % 2) * 0.05, 2, 106.6]),
      );
    }
    if (mode === 'route' || mode === 'combined') {
      if (tick === 40) route = mesh.addObstacle(bounds([7, -1, 0], [9, 3, 4]));
      if (tick === 100) mesh.removeObstacle(route);
    }
    if (mode === 'tile' || mode === 'combined') {
      if (tick === 120) mesh.unloadTile(1, 3);
      if (tick === 180) mesh.loadTile(assets.find((a) => a.x === 1 && a.z === 3).bytes);
    }
    const goal = point(
      [37, 0, moving ? 30 + (tick % 2 ? 0.2 : -0.2) : 37.5],
      up,
    );
    if (['same', 'moving', 'combined'].includes(mode))
      for (const id of crowd.ids()) {
        crowd.target(id, goal);
        if (mode === 'combined') crowd.target(id, goal);
      }
    crowd.step();
    if (tick === 1 && count === 1 && (mode === 'none' || moving)) {
      const agent = unpack('crowd', crowd.save()).state.data.agents[1];
      assert.equal(agent.slicedQuery.status & 1, 1, 'maze needs more than one default-budget tick');
    }
    for (const id of crowd.ids()) {
      const p = crowd.agent(id).position;
      if (Math.hypot(...p.map((v, i) => v - goal[i])) < 6) {
        times[id - 1] = tick;
        crowd.remove(id);
      }
    }
  }
  assert.equal(times.filter(Boolean).length, count, `${up}/${count}/${mode}: arrival count`);
  return times;
}
export function compareArrival(actual, baseline, tolerance = 0) {
  assert.equal(actual.length, baseline.length);
  for (let i = 0; i < actual.length; i++)
    assert.ok(
      Math.abs(actual[i] - baseline[i]) <= tolerance,
      `agent ${i}: arrival ${actual[i]}, baseline ${baseline[i]}, tolerance ${tolerance}`,
    );
}
