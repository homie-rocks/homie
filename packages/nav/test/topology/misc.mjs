import { Bake, Mesh, Crowd, State, Grid, Q, rng, floor, box, median } from './lib.mjs';
const D = new URL('../../dist/', import.meta.url).href;
const { deterministicSin, deterministicCos } = await import(D + 'internal/Math.js');
const now = () => performance.now();
const T = (name, f) => {
  try {
    const v = f();
    console.log(`[${name}]`, typeof v === 'string' ? v : JSON.stringify(v));
  } catch (e) {
    console.log(`[${name}] THROWS ${e.constructor.name}: ${e.message}`);
  }
};
// (a) trig accuracy
{
  let es = 0,
    ec = 0,
    n2 = 0;
  for (let i = 0; i <= 2_000_000; i++) {
    const x = -4 * Math.PI + (8 * Math.PI * i) / 2_000_000;
    es = Math.max(es, Math.abs(deterministicSin(x) - Math.sin(x)));
    ec = Math.max(ec, Math.abs(deterministicCos(x) - Math.cos(x)));
    const s = deterministicSin(x),
      c = deterministicCos(x);
    n2 = Math.max(n2, Math.abs(s * s + c * c - 1));
  }
  console.log(
    `[trig] max |sin err| ${es.toExponential(2)}, max |cos err| ` +
      `${ec.toExponential(2)} on [-4pi,4pi]; cos(0) = ${deterministicCos(0)}, ` +
      `sin(pi/2) = ${deterministicSin(Math.PI / 2)}; max |s^2+c^2-1| ` +
      `${n2.toExponential(2)}; at 1e6: ${Math.abs(deterministicSin(1e6) - Math.sin(1e6)).toExponential(2)}`,
  );
}
const base = {
  origin: [0, 0, 0],
  minY: -2,
  maxY: 8,
  cellSize: 0.25,
  cellHeight: 0.1,
  tileCells: 80,
  radius: 0.3,
  height: 1.8,
  stepHeight: 0.3,
  slopeDegrees: 45,
};
function pillars(size, retain) {
  const tri = [];
  floor(tri, 0, 0, size, size);
  for (let x = 2.5; x < size; x += 5)
    for (let z = 2.5; z < size; z += 5) box(tri, x - 0.6, -0.2, z - 0.6, x + 0.6, 3, z + 0.6);
  const config = { ...base, retainSpans: retain };
  const assets = Bake.bakeLevel({ positions: tri }, config);
  const mesh = new Mesh(config, [1, 2, 1], {
    maxRetainedCells: 1e7,
    maxRetainedSpans: 1e7,
  });
  for (const a of assets) mesh.loadTile(a.bytes);
  return { config, assets, mesh };
}
// (b) wake cost: static vs editable tiles, with and without live obstacles
for (const size of [80, 160]) {
  for (const retain of [false, true]) {
    const w = pillars(size, retain);
    const run = (label) => {
      const bytes = w.mesh.save(),
        list = w.assets.map((a) => a.bytes);
      const t = [];
      for (let i = 0; i < 7; i++) {
        const t0 = now();
        Mesh.restore(bytes, list);
        t.push(now() - t0);
      }
      console.log(
        `[wake] ${size} m, ${w.assets.length} ${retain ? 'editable (retainSpans)' : 'static'} ` +
          `tiles${label}: assets ${(list.reduce((n, b) => n + b.length, 0) / 1e6).toFixed(2)} ` +
          `MB, mesh.save ${bytes.length} B, Mesh.restore median ${median(t).toFixed(1)} ` +
          `ms`,
      );
    };
    run('');
    if (retain) {
      const r = rng(5);
      for (let i = 0; i < 20; i++) {
        const x = r.range(3, size - 5),
          z = r.range(3, size - 5);
        w.mesh.addObstacle({ min: [x, -1, z], max: [x + 1, 3, z + 1] });
      }
      run(' with 20 live obstacles');
    }
  }
}
// (c) corrupt / truncated / crafted input
{
  const w = pillars(20, true);
  const crowd = new Crowd(w.mesh, 0.05, 0.3);
  const tune = {
    radius: 0.3,
    height: 1.8,
    speed: 3,
    acceleration: 8,
    neighbours: 2,
    separation: 2,
  };
  for (let i = 0; i < 12; i++) crowd.add([1 + i, 0, 1], tune);
  for (const id of crowd.ids()) crowd.target(id, [18, 0, 18]);
  for (let i = 0; i < 5; i++) crowd.step();
  const grid = new Grid(40, 40, 0.5, [0, 0, 0]);
  grid.setBlocked(3, 3, true);
  const blobs = {
    tile: w.assets[0].bytes,
    mesh: w.mesh.save(),
    crowd: crowd.save(),
    grid: grid.save(),
  };
  const open = {
    tile: (b) => new Mesh(w.config, [1, 2, 1]).loadTile(b),
    mesh: (b) =>
      Mesh.restore(
        b,
        w.assets.map((a) => a.bytes),
      ),
    crowd: (b) => Crowd.restore(b, w.mesh),
    grid: (b) => Grid.restore(b),
  };
  const r = rng(77);
  for (const [kind, bytes] of Object.entries(blobs)) {
    let navErr = 0,
      other = 0,
      accepted = 0,
      n = 0;
    const others = new Set();
    const attempt = (b) => {
      n++;
      try {
        open[kind](b);
        accepted++;
      } catch (e) {
        if (String(e.message).startsWith('nav:')) navErr++;
        else {
          other++;
          others.add(`${e.constructor.name}: ${e.message}`.slice(0, 90));
        }
      }
    };
    for (let i = 0; i < 400; i++) {
      const b = bytes.slice();
      const at = r.int(b.length);
      b[at] ^= 1 << r.int(8);
      attempt(b);
    }
    for (const len of [0, 1, 15, 16, 17, 64, bytes.length >> 1, bytes.length - 1])
      attempt(bytes.slice(0, len));
    attempt(new Uint8Array([...bytes, 0]));
    for (const v of [0, 1, 2, 4, 0xffffffff]) {
      const b = bytes.slice();
      new DataView(b.buffer).setUint32(4, v, true);
      attempt(b);
    }
    // subarray view at a non-zero offset of a larger buffer must work
    const big = new Uint8Array(bytes.length + 7);
    big.set(bytes, 7);
    let viewOk;
    try {
      open[kind](big.subarray(7));
      viewOk = true;
    } catch (e) {
      viewOk = e.message;
    }
    console.log(
      `[corrupt ${kind}] ${n} damaged inputs (400 bit flips, 8 truncations, ` +
        `1 trailing byte, 5 version values): ${navErr} rejected with ` +
        `nav: errors, ${other} raw errors, ${accepted} accepted; a ` +
        `view into a larger buffer restores: ${viewOk} ${[...others].join(' | ')}`,
    );
  }
  // version messages
  const v2 = blobs.mesh.slice();
  new DataView(v2.buffer).setUint32(4, 2, true);
  T('version 2 mesh blob', () => Mesh.restore(v2, []));
  // Checksum-valid structural mutations must fail at the restore boundary.
  const c = State.unpack('crowd', blobs.crowd);
  c.state.data.agents[1] = { position: 'x' };
  T('crafted crowd: agent {position:"x"}', () => {
    const k = Crowd.restore(State.pack('crowd', c), w.mesh);
    k.step();
    return 'ACCEPTED and stepped';
  });
  const c2 = State.unpack('crowd', blobs.crowd);
  c2.state.data.agents[1].corridor.path = [123456789];
  T('crafted crowd: corridor of a nonexistent polygon', () => {
    const k = Crowd.restore(State.pack('crowd', c2), w.mesh);
    for (let i = 0; i < 5; i++) k.step();
    return 'accepted; stepped 5 ticks; agent 1 status ' + k.agent(1).status;
  });
  const c3 = State.unpack('crowd', blobs.crowd);
  c3.state.dt = -1;
  T('crafted crowd: dt -1', () => {
    Crowd.restore(State.pack('crowd', c3), w.mesh);
    return 'ACCEPTED';
  });
  const c4 = State.unpack('crowd', blobs.crowd);
  c4.state.data.agents[1].maxSpeed = -5;
  c4.state.data.agents[1].radius = 50;
  T('crafted crowd: speed -5, radius 50', () => {
    const k = Crowd.restore(State.pack('crowd', c4), w.mesh);
    k.step();
    return 'ACCEPTED and stepped';
  });
  const t = State.unpack('tile', blobs.tile);
  t.baked.polys = [1, 2, 3];
  T('crafted tile: polys [1,2,3]', () => {
    const m = new Mesh(w.config, [1, 2, 1]);
    m.loadTile(State.pack('tile', t));
    return 'ACCEPTED, path ' + m.path([1, 0, 1], [5, 0, 5]).complete;
  });
  const t2 = State.unpack('tile', blobs.tile);
  t2.baked.polys[0].neis[0] = 99999;
  t2.x = 0.5;
  T('crafted tile: x 0.5', () => {
    new Mesh(w.config, [1, 2, 1]).loadTile(State.pack('tile', t2));
    return 'ACCEPTED';
  });
  const m = State.unpack('mesh', blobs.mesh);
  m.nav.nodes = 'x';
  T('crafted mesh: nav.nodes "x"', () => {
    const k = Mesh.restore(
      State.pack('mesh', m),
      w.assets.map((a) => a.bytes),
    );
    return 'ACCEPTED, path ' + k.path([1, 0, 1], [5, 0, 5]).complete;
  });
  const m2 = State.unpack('mesh', blobs.mesh);
  m2.nav.links = [];
  T('crafted mesh: nav.links []', () => {
    const k = Mesh.restore(
      State.pack('mesh', m2),
      w.assets.map((a) => a.bytes),
    );
    return 'ACCEPTED, path ' + k.path([1, 0, 1], [15, 0, 15]).complete;
  });
  // crowd onto a rebuilt (not restored) mesh
  T('crowd restore onto a mesh rebuilt from the same tiles', () => {
    const fresh = new Mesh(w.config, [1, 2, 1], {
      maxRetainedCells: 1e7,
      maxRetainedSpans: 1e7,
    });
    for (const a of w.assets) fresh.loadTile(a.bytes);
    Crowd.restore(blobs.crowd, fresh);
    return 'accepted';
  });
}
// (e) impossible configuration at every entry point
{
  const bad = { ...base, slopeDegrees: 60 };
  T('checkConfig impossible', () => Bake.checkConfig(bad));
  T('new Mesh impossible', () => new Mesh(bad, [1, 2, 1]));
  T('bakeTile impossible', () =>
    Bake.bakeTile({ positions: [0, 0, 0, 0, 0, 1, 1, 0, 0] }, bad, 0, 0),
  );
  T('bakeLevel impossible', () => Bake.bakeLevel({ positions: [0, 0, 0, 0, 0, 1, 1, 0, 0] }, bad));
  T('bakeHeightfield impossible', () =>
    Bake.bakeHeightfield({ heightAt: () => 0 }, bad, {
      min: [0, 0],
      max: [5, 5],
    }),
  );
  T('slope 0', () => {
    Bake.checkConfig({ ...base, slopeDegrees: 0 });
    return 'accepted';
  });
  T('stepHeight 0, slope 45', () => {
    Bake.checkConfig({ ...base, stepHeight: 0 });
    return 'accepted';
  });
  T('stepHeight 0, slope 0', () => {
    Bake.checkConfig({ ...base, stepHeight: 0, slopeDegrees: 0 });
    return 'accepted';
  });
  T('stairs: 0.2 m steps under stepHeight 0.3 slope 45', () => {
    const tri = [];
    floor(tri, 0, 0, 6, 6);
    for (let i = 0; i < 10; i++) box(tri, 6 + i * 0.3, -0.2, 0, 6.3 + i * 0.3, 0.2 * (i + 1), 6);
    floor(tri, 9, 0, 15, 6, 2.0);
    const c = { ...base };
    const m = new Mesh(c, [1, 2, 1]);
    for (const a of Bake.bakeLevel({ positions: tri }, c)) m.loadTile(a.bytes);
    return 'path up the stairs complete: ' + m.path([1, 0, 3], [14, 2, 3]).complete;
  });
  // (f) winding
  T('downward-wound floor', () => {
    const tri = [];
    floor(tri, 0, 0, 10, 10);
    const rev = [];
    for (let i = 0; i < tri.length; i += 9)
      rev.push(...tri.slice(i, i + 3), ...tri.slice(i + 6, i + 9), ...tri.slice(i + 3, i + 6));
    return Bake.bakeLevel({ positions: rev }, base).length + ' tiles';
  });
}
// (g) large heightfield bake
{
  const t0 = now();
  const tiles = Bake.bakeHeightfield(
    { heightAt: (x, z) => 2 * Math.sin(x / 9) * Math.sin(z / 11) },
    base,
    { min: [0, 0], max: [300, 300] },
    0.5,
  );
  console.log(
    `[bakeHeightfield 300 x 300 m at 0.5 m samples] ${tiles.length} ` +
      `tiles in ${((now() - t0) / 1000).toFixed(1)} s, ${(tiles.reduce((n, a) => n + a.bytes.length, 0) / 1e6).toFixed(2)} ` +
      `MB, RSS ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`,
  );
  T('1 km x 1 km tile count check only (first tile)', () => {
    const c = { ...base };
    const t1 = now();
    const one = Bake.bakeHeightfield({ heightAt: () => 0 }, c, {
      min: [0, 0],
      max: [20, 20],
    });
    return `20 m tile ${(now() - t1).toFixed(0)} ms -> 2,500 tiles for 1 km2 is about ${(((now() - t1) * 2500) / 1000).toFixed(0)} s`;
  });
}
// (h) target() semantics
{
  const w = pillars(40, true);
  const crowd = new Crowd(w.mesh, 0.05, 0.3);
  const tune = {
    radius: 0.3,
    height: 1.8,
    speed: 3,
    acceleration: 8,
    neighbours: 2,
    separation: 2,
  };
  const a = crowd.add([1, 0, 1], tune);
  T('target unknown id', () => crowd.target(99, [5, 0, 5]));
  T('target off the mesh', () => crowd.target(a, [500, 0, 5]));
  T('target with 2 coords', () => crowd.target(a, [5, 5]));
  T('target NaN', () => crowd.target(a, [NaN, 0, 5]));
  crowd.target(a, [38, 0, 38]);
  for (let i = 0; i < 20; i++) crowd.step();
  w.mesh.unloadTile(0, 0);
  crowd.step();
  T('agent after its tile is unloaded', () => crowd.agent(a).status);
  T('target() while stranded', () => crowd.target(a, [38, 0, 38]));
  T('arrived with tolerance 0', () => crowd.arrived(a, 0));
  T('add with radius above crowd max', () => crowd.add([30, 0, 30], { ...tune, radius: 0.5 }));
  T('Crowd dt 0.2', () => new Crowd(w.mesh, 0.2, 0.3));
  T('remove twice', () => [crowd.remove(a), crowd.remove(a)]);
}
// (d) grid
{
  const N = 2000,
    r = rng(3);
  const mask = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) mask[i] = r() < 0.1 ? 1 : 0;
  mask[0] = mask[N * N - 1] = 0;
  const g = new Grid(N, N, 1, [0, 0, 0], mask);
  let t0 = now();
  const n1 = g.nearest([1000.5, 0, 1000.5], [0.5, 0, 0.5]);
  const label = now() - t0;
  t0 = now();
  const p = g.path([0.5, 0, 0.5], [N - 0.5, 0, N - 0.5]);
  const astar = now() - t0;
  t0 = now();
  const pj = g.path([0.5, 0, 0.5], [N - 0.5, 0, N - 0.5], { search: 'jps' });
  const jps = now() - t0;
  t0 = now();
  const bytes = g.save();
  const sv = now() - t0;
  t0 = now();
  Grid.restore(bytes);
  const rs = now() - t0;
  console.log(
    `[grid 2000x2000, 10% blocked] first nearest(from) ${label.toFixed(0)} ` +
      `ms; A* ${astar.toFixed(0)} ms complete ${p.complete} cost ` +
      `${p.cost?.toFixed(1)}; JPS ${jps.toFixed(0)} ms cost ${pj.cost?.toFixed(1)}; ` +
      `save ${sv.toFixed(0)} ms ${bytes.length} B; restore ${rs.toFixed(0)} ` +
      `ms`,
  );
  const small = new Grid(64, 64, 1, [0, 0, 0]);
  T('grid path out of bounds', () => small.path([-5, 0, -5], [10.5, 0, 10.5]).complete);
  T('grid setBlocked out of range', () => small.setBlocked(64, 0, true));
  T('grid 2001x2001', () => new Grid(2001, 2001, 1, [0, 0, 0]));
}
