import { pathToFileURL } from 'node:url';
const root = process.argv[2]
  ? pathToFileURL(process.argv[2].replace(/\/$/, '') + '/')
  : new URL('../../dist/', import.meta.url);
const { bakeTile, heightfieldTriangles } = await import(new URL('Bake.js', root));
const { Mesh } = await import(new URL('Mesh.js', root));
const { Crowd } = await import(new URL('Crowd.js', root));
const config = {
  origin: [0, 0, 0],
  minY: -2,
  maxY: 12,
  cellSize: 0.25,
  cellHeight: 0.1,
  tileCells: 40,
  radius: 0.3,
  height: 1.8,
  stepHeight: 0.3,
  slopeDegrees: 45,
};
const tune = { radius: 0.3, height: 1.8, speed: 3, acceleration: 8, neighbours: 2, separation: 2 };
const tiles = [];
for (let z = 0; z < 3; z++)
  for (let x = 0; x < 3; x++)
    tiles.push({
      x,
      z,
      bytes: bakeTile(
        heightfieldTriangles({ heightAt: () => 0 }, x * 10 - 2, z * 10 - 2, 57, 57, 0.25),
        config,
        x,
        z,
      ),
    });
for (const edited of [null, [2, 1]]) {
  const mesh = new Mesh(config, [2, 2, 2]);
  for (const tile of tiles) mesh.loadTile(tile.bytes);
  const crowd = new Crowd(mesh, 0.05, 0.3),
    ids = [];
  for (let i = 0; i < 20; i++) {
    const p = [1.5 + (i % 2) * 0.8, 0.1, 1.5 + Math.floor(i / 2) * 2.5],
      id = crowd.add(p, tune);
    ids.push(id);
    crowd.target(id, [30 - p[0], 0.1, p[2]]);
  }
  let arrived = null;
  for (let tick = 0; tick < 1600; tick++) {
    if (edited && tick < 800 && tick % 15 === 0)
      mesh.loadTile(tiles.find((t) => t.x === edited[0] && t.z === edited[1]).bytes);
    crowd.step();
    if (ids.every((id) => crowd.arrived(id, 0.3))) {
      arrived = tick;
      break;
    }
  }
  console.log(JSON.stringify({ edited, arrived }));
  if (arrived === null || (!process.argv[2] && arrived > 800))
    throw Error('streaming prevents arrival');
}
