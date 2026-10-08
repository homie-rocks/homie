// Randomised exact-restore test. usage: node fuzz.mjs <firstSeed> <lastSeed> [mode]
// Per seed: run "straight" and run "woken" (same op stream; at random ticks the
// mesh and the crowd are both replaced by Mesh.restore/Crowd.restore, or the crowd
// alone on the live mesh). Per-tick digests must be equal.
import { Bake, Mesh, Crowd, State, rng, floor, box, toWorld, W, I, WB, fnv } from './lib.mjs';

function world(seed, up) {
  const r = rng(seed * 7919 + 13);
  const cellSize = r.pick([0.25, 0.3, 0.4]);
  const tileCells = r.pick([24, 32, 40]);
  const tile = cellSize * tileCells;
  const nx = 2 + r.int(3),
    nz = 1 + r.int(3);
  const ox = r.pick([0, -7.5, 3]),
    oz = r.pick([0, 5, -11]);
  const sx = nx * tile,
    sz = nz * tile;
  const stepHeight = r.pick([0.3, 0.4, 0.5]);
  const slope = r.pick([30, 40, 45]);
  // door region across the middle wall gap (internal frame)
  const doorZ = oz + sz / 2;
  const doorBox = {
    min: [ox + sx / 2 - 0.6, -0.5, doorZ - 1.2],
    max: [ox + sx / 2 + 0.6, 2.5, doorZ + 1.2],
  };
  const wb = WB(doorBox.min, doorBox.max, up);
  const config = {
    origin: W([ox, 0, oz], up),
    up,
    retainSpans: true,
    minY: -2,
    maxY: 8,
    cellSize,
    cellHeight: 0.1,
    tileCells,
    radius: 0.3,
    height: 1.8,
    stepHeight,
    slopeDegrees: slope,
    doorRegions: [wb],
  };
  try {
    Bake.checkConfig(config);
  } catch {
    config.stepHeight = 0.5;
    config.slopeDegrees = 30;
    config.cellSize = 0.25;
  }
  const tri = [];
  floor(tri, ox, oz, ox + sx, oz + sz, 0, 3);
  // random static pillars
  const pillars = 3 + r.int(Math.floor((sx * sz) / 20));
  for (let i = 0; i < pillars; i++) {
    const w = r.range(0.6, 2.5),
      d = r.range(0.6, 2.5);
    const x = r.range(ox + 1, ox + sx - 1 - w),
      z = r.range(oz + 1, oz + sz - 1 - d);
    box(tri, x, -0.2, z, x + w, r.pick([0.2, 0.25, 1.0, 3]), z + d);
  }
  // a wall across x = mid with a doorway (only if the world is deep enough)
  const mid = ox + sx / 2;
  if (sz > 6) {
    box(tri, mid - 0.3, -0.2, oz, mid + 0.3, 3, doorZ - 1);
    box(tri, mid - 0.3, -0.2, doorZ + 1, mid + 0.3, 3, oz + sz);
  }
  // a raised platform reachable only by link
  const px = ox + sx - 5,
    pz = oz + 1;
  box(tri, px, -0.2, pz, px + 3, 1.5, pz + 3);
  const assets = Bake.bakeLevel({ positions: toWorld(tri, up) }, config);
  return {
    config,
    assets,
    ox,
    oz,
    sx,
    sz,
    doorBox: wb,
    platform: [px + 1.5, 1.5, pz + 1.5],
  };
}

export function* run(seed, up, wake, ticks = 320) {
  const w = world(seed, up);
  const r = rng(seed); // op stream: identical for straight and woken runs
  const wr = rng(seed ^ 0x5bd1e995); // wake decisions only
  let mesh = new Mesh(w.config, [1.5, 2, 1.5].map(Math.abs) && W([1.5, 2, 1.5], up).map(Math.abs));
  const log = [];
  const loaded = [];
  for (const a of w.assets) {
    log.push(mesh.loadTile(a.bytes).warnings.length);
    loaded.push(a.x + ',' + a.z);
  }
  const iters = r.pick([undefined, 1, 2, 5, 20, 200]);
  let crowd = new Crowd(
    mesh,
    r.pick([0.05, 1 / 30, 0.1]),
    0.3,
    iters ? { searchIterations: iters } : {},
  );
  const count = Math.max(1, Math.min(500, Math.round(Math.exp(r.range(0, Math.log(500))))));
  const pt = () =>
    W(
      [
        r.range(w.ox + 0.5, w.ox + w.sx - 0.5),
        r.pick([0, 0, 0, 0.2, 1.5]),
        r.range(w.oz + 0.5, w.oz + w.sz - 0.5),
      ],
      up,
    );
  const tune = () => ({
    radius: r.pick([0.2, 0.3]),
    height: r.pick([1.2, 1.8]),
    speed: r.range(1, 5),
    acceleration: r.range(4, 12),
    neighbours: r.range(1, 3),
    separation: r.range(0, 3),
    manualLinks: r() < 0.3,
  });
  const attempt = (f) => {
    try {
      const v = f();
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    } catch (e) {
      if (!e.message.startsWith('nav:')) throw e;
      return 'E:' + e.message;
    }
  };
  for (let i = 0; i < count; i++)
    log.push(attempt(() => crowd.add(mesh.nearest(pt()) ?? pt(), tune())));
  const obstacles = [],
    links = [],
    doors = [];

  let wakes = 0,
    kinds = [];
  for (let tick = 0; tick < ticks; tick++) {
    const ops = r() < 0.5 ? 1 + r.int(3) : 0;
    for (let o = 0; o < ops || (tick === 0 && o < 1); o++) {
      const k = tick === 0 ? 0 : r.int(17);
      const ids = crowd.ids();
      const id = () => (ids.length ? r.pick(ids) : 1);
      if (k === 0) {
        // retarget everyone (or a fraction)
        const frac = r.pick([1, 1, 0.3]);
        let h = 0;
        for (const a of ids)
          if (r() < frac) h = (h * 2 + (crowd.target(a, pt()) ? 1 : 0)) % 1000003;
        log.push(h);
      } else if (k === 1) {
        const p = I(pt(), up),
          sxz = r.range(0.4, 3),
          szz = r.range(0.4, 3);
        const b = WB([p[0], -1, p[2]], [p[0] + sxz, r.pick([0.5, 3]), p[2] + szz], up);
        log.push(attempt(() => (obstacles.push(mesh.addObstacle(b)), obstacles.at(-1))));
      } else if (k === 2) {
        const p = pt();
        log.push(
          attempt(
            () => (
              obstacles.push(
                mesh.addCylinder(W([I(p, up)[0], -1, I(p, up)[2]], up), r.range(0.4, 2), 4),
              ),
              obstacles.at(-1)
            ),
          ),
        );
      } else if (k === 3 || k === 4) {
        if (obstacles.length)
          log.push(
            attempt(() => mesh.removeObstacle(obstacles.splice(r.int(obstacles.length), 1)[0])),
          );
      } else if (k === 5) {
        const t = r.pick(w.assets);
        log.push(attempt(() => mesh.unloadTile(t.x, t.z)));
        if (loaded.includes(t.x + ',' + t.z)) loaded.splice(loaded.indexOf(t.x + ',' + t.z), 1);
      } else if (k === 6 || k === 7) {
        const t = r.pick(w.assets);
        const res = attempt(() => mesh.loadTile(t.bytes).warnings.length);
        log.push(res);
        if (!res.startsWith('E:') && !loaded.includes(t.x + ',' + t.z))
          loaded.push(t.x + ',' + t.z);
      } else if (k === 8) {
        const a = r() < 0.5 ? W(w.platform, up) : pt(),
          b = pt();
        log.push(
          attempt(
            () => (links.push(mesh.addLink(a, b, r.range(0.5, 1.5), r() < 0.6)), links.at(-1)),
          ),
        );
      } else if (k === 9) {
        if (links.length)
          log.push(attempt(() => mesh.removeLink(links.splice(r.int(links.length), 1)[0])));
      } else if (k === 10) {
        if (links.length) log.push(attempt(() => mesh.setLinkEnabled(r.pick(links), r() < 0.5)));
      } else if (k === 11) {
        const n = 1 + r.int(4);
        for (let i = 0; i < n; i++)
          log.push(attempt(() => crowd.add(mesh.nearest(pt()) ?? pt(), tune())));
      } else if (k === 12) {
        const n = 1 + r.int(3);
        for (let i = 0; i < n; i++) log.push(attempt(() => crowd.remove(id())));
      } else if (k === 13) {
        log.push(attempt(() => crowd.place(id(), pt())));
        log.push(attempt(() => crowd.stop(id())));
      } else if (k === 14) {
        log.push(attempt(() => crowd.setSpeed(id(), r.range(0.5, 6))));
        for (const a of ids)
          if (crowd.agent(a)?.status === 'link' && r() < 0.5)
            log.push(attempt(() => crowd.completeLink(a)));
      } else if (k === 15) {
        if (!doors.length)
          log.push(attempt(() => (doors.push(mesh.addDoor(w.doorBox, r() < 0.5)), doors.at(-1))));
        else log.push(attempt(() => mesh.setDoorEnabled(doors[0], r() < 0.5)));
      } else if (k === 16) {
        if (doors.length && r() < 0.3) log.push(attempt(() => mesh.removeDoor(doors.pop())));
        else log.push(attempt(() => mesh.addObstacles([]).length));
      }
    }
    if (tick === 139) {
      const tile = w.assets[0];
      mesh.unloadTile(tile.x, tile.z);
      mesh.loadTile(tile.bytes);
      const key = `${tile.x},${tile.z}`;
      if (loaded.includes(key)) loaded.splice(loaded.indexOf(key), 1);
      loaded.push(key);
    }
    if (wake && (wr() < 0.08 || tick === wake.at || tick === 140)) {
      wakes++;
      const kind =
        tick === wake.at || tick === 140
          ? 'room'
          : (wake.kind ?? wr.pick(['room', 'room', 'crowd']));
      kinds.push(tick + ':' + kind);
      const cb = crowd.save(),
        old = mesh;
      if (kind === 'room') {
        const mb = mesh.save();
        const shuffled = [...w.assets].sort(() => wr() - 0.5);
        const mode = wake.order ?? 'shuffle';
        // 'live': the order the live mesh holds its tiles in (first load of each key; a reload keeps its slot, an unload+load moves it last)
        const order = (
          mode === 'bake'
            ? w.assets
            : mode === 'live'
              ? [
                  ...loaded.map((k) => w.assets.find((a) => a.x + ',' + a.z === k)),
                  ...w.assets.filter((a) => !loaded.includes(a.x + ',' + a.z)),
                ]
              : shuffled
        ).map((a) => a.bytes);
        mesh = Mesh.restore(State.joinChunks(State.chunks(mb, 4096)), order);
      }
      crowd = Crowd.restore(cb, mesh);
    }

    crowd.step();
    yield {
      mesh: mesh.save(),
      crowd: crowd.save(),
      agents: crowd.ids().map((id) => [id, crowd.agent(id)]),
    };
  }
  // closing queries
  const a = pt(),
    b = pt();
  const path = mesh.path(a, b);
  const tail = JSON.stringify([
    path.complete,
    path.points.map((p) => I(p, up)),
    path.links,
    mesh.nearest(a) && I(mesh.nearest(a), up),
  ]);
  return { log, tail, count, tiles: w.assets.length, iters };
}
