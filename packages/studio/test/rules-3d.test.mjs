import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COIN_DASH, loadGame } from './rules-kit.mjs';
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-rules-3d-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
let loaded;
const kit = () => loaded ??= loadGame(scratch, COIN_DASH);
const capsule = { shape: 'capsule', radius: .4, height: 1.7 };
const data = { bounds: { min: [0, 0, 0], max: [20, 20, 10] }, boxes: [{ min: [4, 4, 0], max: [6, 6, 1] }] };
const close = (a, b, tolerance = .002) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
test('3D sweep stops a fast capsule, passes above geometry, and lands on its top', async () => {
  const L = await kit(), map = L.R.compileMap(data);
  const sweep = (pos, delta) => { const body = { pos }; const hit = L.M.sweepMap(map, body, delta, .4, 3, capsule); return { ...body, hit }; };
  const wall = sweep({ x: 2, y: 5, z: 0 }, { x: 12, y: 0, z: 0 });
  close(wall.pos.x, 3.6); assert.equal(wall.hit.normal.x, -1); assert.equal(wall.grounded, true);
  const air = sweep({ x: 2, y: 5, z: 2 }, { x: 12, y: 0, z: 0 });
  close(air.pos.x, 14); assert.equal(air.hit, undefined); assert.equal(air.grounded, false);
  const land = sweep({ x: 5, y: 5, z: 2 }, { x: 0, y: 0, z: -3 });
  close(land.pos.z, 1); assert.equal(land.hit.normal.z, 1); assert.equal(land.grounded, true);
  const edge = sweep({ x: 5, y: 5, z: land.pos.z }, { x: 4, y: 0, z: 0 });
  assert.equal(edge.grounded, false);
});
test('3D sweep clears grounded on takeoff and blocks the ceiling', async () => {
  const L = await kit(), map = L.R.compileMap(data), b = { pos: { x: 10, y: 10, z: 0 } };
  L.M.sweepMap(map, b, { x: 0, y: 0, z: .32 }, .4, 3, capsule); assert.equal(b.grounded, false);
  const hit = L.M.sweepMap(map, b, { x: 0, y: 0, z: 30 }, .4, 3, capsule);
  close(b.pos.z, 8.3); assert.equal(hit.normal.z, -1); assert.equal(b.grounded, false);
});
test('spheres, capsules and boxes collide with declared round geometry', async () => {
  const L = await kit();
  for (const shape of ['sphere', 'capsule', 'box']) for (const kind of ['spheres', 'capsules']) {
    const map = L.R.compileMap({ bounds: data.bounds, [kind]: [{ at: [5, 5, kind === 'spheres' ? .5 : 0], r: .5, height: 2 }] });
    const b = { pos: { x: 2, y: 5, z: 0 } }, body = { ...capsule, shape };
    const hit = L.M.sweepMap(map, b, { x: 12, y: 0, z: 0 }, .4, 3, body);
    assert.ok(hit, `${shape}/${kind}`); assert.ok(b.pos.x < 4.2); assert.equal(b.grounded, true);
  }
});
test('map geometry rejects nonfinite radii, invalid capsule height and unbounded lists', async () => {
  const L = await kit();
  assert.throws(() => L.R.compileMap({ ...data, spheres: [{ at: [1, 1, 1], r: Infinity }] }), /finite/);
  assert.throws(() => L.R.compileMap({ ...data, capsules: [{ at: [1, 1, 1], r: 1, height: 1 }] }), /height/);
  assert.throws(() => L.R.compileMap({ ...data, spheres: Array(4097).fill({ at: [1, 1, 1], r: 1 }) }), /4096/);
});

test('height tiles land on both triangles, slide up slopes, and leave an open edge', async () => {
  const L = await kit();
  const map = L.R.compileMap({ bounds: data.bounds, heightTiles: [{ at: [2, 2, 1], size: [4, 4], heights: [0, 2, 0, 2] }] });
  for (const y of [3, 5]) {
    const b = { pos: { x: 4, y, z: 5 } };
    const hit = L.M.sweepMap(map, b, { x: 0, y: 0, z: -8 }, .4, 3, capsule);
    close(b.pos.z, 2); assert.ok(hit.normal.x < 0); assert.equal(b.grounded, true);
    const before = b.pos, delta = { x: 1, y: 0, z: 0 };
    const wall = L.M.sweepMap(map, b, delta, .4, 3, capsule);
    assert.ok(wall);
    const remaining = L.M.math.sub(delta, L.M.math.sub(b.pos, before));
    const tangent = L.M.math.sub(remaining, L.M.math.scale(wall.normal, L.M.math.dot(remaining, wall.normal)));
    L.M.sweepMap(map, b, tangent, .4, 3, capsule);
    assert.ok(b.pos.x > 4.7 && b.pos.z > 2.3); assert.equal(b.grounded, true);
    L.M.sweepMap(map, b, { x: 0, y: -6, z: 0 }, .4, 3, capsule);
    assert.equal(b.grounded, false);
  }
  assert.throws(() => L.R.compileMap({ ...data, heightTiles: [{ at: [0, 0], size: [1, 0], heights: [0, 0, 0, 0] }] }), /positive/);
});

test('3D entity collision and spatial queries respect height, and restore with level data', async () => {
  const { writeGame } = await import('./rules-kit.mjs');
  const { stateHash } = await import('../lib/rules-check.mjs');
  const dir = writeGame(scratch, 'spatial-3d', { rules: `import {defineRules,f} from '@homie-rocks/studio/rules';
export default defineRules({contract:2,space:{dims:3},entities:{
  target:{body:{shape:'capsule',radius:.5,height:2,maxSpeed:0}},
  shot:{fields:{near:f.u8(),box:f.u8(),ray:f.ref(),hit:f.ref()},body:{shape:'sphere',radius:.1,maxSpeed:200},tick(w,s){
    if(w.tick>2)return;
    s.near=w.near({x:6,y:5,z:0},1,'target').length;
    s.box=w.inBox({min:{x:5,y:4,z:0},max:{x:7,y:6,z:1}},'target').length;
    const ray=w.ray(s.pos,{x:1,y:0,z:0},10);s.ray=ray?.entity??'';
    const hit=w.sweep(s,{x:10,y:0,z:0});s.hit=hit?.entity??'';
  }}},room:{bots:{keep:0},start(w){w.spawn('target',{x:6,y:5,z:2},{});w.spawn('shot',{x:2,y:5,z:2.5},{});}}});` });
  const L = await loadGame(scratch, dir, 'spatial-3d');
  const map = L.R.compileMap({ bounds: data.bounds, heightTiles: [{at:[10,10,0],size:[2,2],heights:[0,1,0,1]}] });
  const c = L.R.compileRules(L.def, {map,seats:8}), a = L.C.createCore(c,{seed:123});
  a.setPolicy({bots:'off',level:2,guideLevel:5,guideSeats:[7,6,7],kids:true,levelSet:true});
  a.step();a.step();
  const rows=a.snapshot()[1].map(w=>L.P.unpackEntity(c.kinds,w,3));
  const target=rows.find(e=>e.kind==='target'),shot=rows.find(e=>e.kind==='shot');
  assert.ok(target && shot);assert.equal(shot.fields.near,0);assert.equal(shot.fields.box,0);
  assert.equal(shot.fields.ray,target.id);assert.equal(shot.fields.hit,target.id);assert.ok(shot.pos.x<5.5 && shot.pos.z>2);
  const b=L.C.createCore(c,{seed:99,restore:a.save()});
  for(let i=0;i<20;i++){a.step();b.step();assert.deepEqual(b.save(),a.save());}
  assert.deepEqual(b.world.guideSeats,[6,7]);assert.ok(Object.isFrozen(b.world.guideSeats));assert.equal(b.world.guideLevel,5);assert.equal(b.world.level,2);assert.equal(b.world.kids,true);
  b.setPolicy({levelMax:1,guideSeats:[],kids:false,levelSet:false});
  const lowered=L.C.createCore(c,{restore:b.save()});
  assert.deepEqual(lowered.world.guideSeats,[]);assert.equal(lowered.world.guideLevel,1);assert.equal(lowered.world.level,1);assert.equal(lowered.world.kids,false);
  assert.notEqual(stateHash(c),stateHash({...c,map:L.R.compileMap({...data,heightTiles:[{at:[10,10,0],size:[2,2],heights:[0,2,0,2]}]})}));
  assert.equal(a.stats.errors,0);
});

test('3D owner claims pay for their terrain support cast', async () => {
  const { writeGame } = await import('./rules-kit.mjs');
  const dir = writeGame(scratch, 'owner-support', {
    rules: `import {defineRules} from '@homie-rocks/studio/rules'; import {move} from './move';
export default defineRules({contract:2,space:{dims:3},move,entities:{runner:{player:true,body:{shape:'capsule',radius:.4,height:1.7,maxSpeed:6,move:'owner'}}},room:{bots:{keep:0},join(){return {kind:'runner',at:{x:10,y:10,z:0}};}}});`,
    move: `import {defineMove} from '@homie-rocks/studio/rules'; export const move=defineMove({runner(){}});`,
  });
  const L = await loadGame(scratch, dir, 'owner-support');
  const map = L.R.compileMap({ bounds: data.bounds, boxes: Array.from({ length: 100 }, () => ({ min: [1, 1, 0], max: [2, 2, 1] })) });
  const c = L.R.compileRules(L.def, { map }), core = L.C.createCore(c);
  core.seatJoin({ seat: 0, driver: 'person', owner: 'one' }); core.step();
  const body = core.bodyOf(0);
  core.step(new Map([[0, { values: {}, claim: { r: body.r, pos: { x: 10, y: 10, z: 0 }, vel: { x: 0, y: 0, z: 0 }, heading: { x: 1, y: 0, z: 0 } } }]]));
  assert.ok(core.stats.tickUnits >= 5400, `support cast used only ${core.stats.tickUnits} units`);
  assert.equal(core.stats.errors, 0);
});
