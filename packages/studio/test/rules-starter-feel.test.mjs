/** Migration receipts: old 60 fps simulations are retained in fixtures/*-before.ts. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,realpathSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {PKG,loadGame} from './rules-kit.mjs';
const scratch=realpathSync(mkdtempSync(join(tmpdir(),'homie-starter-feel-')));
test.after(()=>rmSync(scratch,{recursive:true,force:true}));
for (const id of ['gem-rush-3d', 'hero-rush-3d', 'ember-vale']) test(`${id}: a full 32-seat room stays within its tick budget`, async t => {
  const dir = join(PKG, 'starters', id), L = await loadGame(scratch, dir, id + '-full');
  const read = p => JSON.parse(readFileSync(join(dir, p), 'utf8'));
  const def = L.R.defineRules({ ...L.def, room: { ...L.def.room, bots: { keep: 32 } } });
  const c = L.R.compileRules(def, { map: L.R.compileMap(read('map/main.json')), tune: read('tunables.json'), seats: 32 });
  const core = L.C.createCore(c, { seed: 123 });
  for (let i = 0; i < 2400; i++) { core.step(); core.snapshot(); core.drain(); }
  for (const key of ['errors', 'budgetStops', 'skipped', 'ticksCut']) assert.equal(core.stats[key], 0, key);
  assert.ok(core.stats.maxTickUnits < c.settings.budget.tick);
  t.diagnostic(`${core.stats.maxTickUnits}/${c.settings.budget.tick} units in the busiest of 2,400 ticks, including snapshots`);
});
for (const id of ['gem-rush-3d', 'hero-rush-3d']) test(`${id}: every seat starts clear of the meadow's solid features`, () => {
  const map = JSON.parse(readFileSync(join(PKG, 'starters', id, 'map/main.json'), 'utf8'));
  for (const [seat, point] of map.spots.start.entries()) for (const obstacle of map.circles) {
    assert.ok(Math.hypot(point[0] - obstacle.at[0], point[1] - obstacle.at[1]) >= obstacle.r + .44,
      `seat ${seat} starts inside the obstacle at ${obstacle.at}`);
  }
});
for(const [id,crossing,score] of [['gem-rush-3d',3.75,4310.4],['hero-rush-3d',4.116666666666666,3695.4],['ember-vale',5.1866666666666665,11869.2]])test(`${id}: crossing within 2% and twenty bot rounds within 15% of the old starter`,async()=>{
  const dir=join(PKG,'starters',id),L=await loadGame(scratch,dir,id),read=p=>JSON.parse(readFileSync(join(dir,p),'utf8'));
  const c=L.R.compileRules(L.def,{map:L.R.compileMap(read('map/main.json')),tune:read('tunables.json'),seats:8}),k=c.kinds[0];let tick=0;
  const ctx=L.M.moveContext({tick:()=>tick,tickHz:20,tune:c.publicTune,map:c.map,name:'main',spots:c.map.spots,radius:()=>k.body.radius,shape:()=>k.body,dims:c.dims});
  let body={pos:{x:.44,y:id==='ember-vale'?10:8,z:0},vel:{x:0,y:0,z:0},heading:{x:1,y:0,z:0},grounded:true,motion:L.P.initFields(k.motion,c.dims)};
  while(body.pos.x<c.map.bounds.max.x-.442&&tick<200){tick++;body=L.P.stepMove(k.move,body,{ax:127,ay:0},ctx,125000,k.motion,c.dims,e=>{throw e});}
  assert.ok(Math.abs(tick/20-crossing)/crossing<.02,`${tick/20}s vs ${crossing}s`);
  const core=L.C.createCore(c,{seed:123});let rounds=0,total=0;
  for(let n=0;n<45000&&rounds<20;n++){core.step();core.snapshot();for(const e of core.drain())if(e.t==='round'&&e.phase==='over'){rounds++;total+=e.results.reduce((sum,r)=>sum+r.score,0);}}
  assert.equal(rounds,20);assert.equal(core.stats.errors,0);assert.equal(core.stats.budgetStops,0);
  assert.ok(Math.abs(total-score)/score<.15,`${total} vs old mean ${score}`);
});

for (const id of ['gem-rush-3d', 'hero-rush-3d', 'ember-vale']) test(`${id}: kids bots retain the old level and aggression limits`, async () => {
  const dir = join(PKG, 'starters', id), L = await loadGame(scratch, dir, id + '-kids');
  const read = p => JSON.parse(readFileSync(join(dir, p), 'utf8'));
  const c = L.R.compileRules(L.def, { map: L.R.compileMap(read('map/main.json')), tune: read('tunables.json'), seats: 8 });
  const kind = c.kinds[0], rival = { id: 'e2', driver: 'bot', pos: { x: 8.5, y: 8, z: 0 }, hp: 18, size: 1 };
  function think(kids, level, driver = 'bot', guideLevel = level, guide = driver === 'ai') {
    const self = { ...L.P.initFields(kind.fields, c.dims), id: 'e1', seat: 0, driver, goal: null,
      pos: { x: 8, y: 8, z: 0 }, heading: { x: 1, y: 0, z: 0 }, grounded: true, hp: 72,
      noticed: 100, target: rival.pos, aim: rival.pos, hunting: true,
      motion: { ...L.P.initFields(kind.motion, c.dims), attackTick: 83 } };
    // A rival already in reach, 150 ms after the previous look and one second
    // after Ember's last strike. The old kids preset waits 250 ms to look,
    // strikes at 1.13 s, and waves/swings with 0.3 * 0.8 * dt probability.
    const world = L.W.brand({ math: L.M.math, stage: '', tick: 103, dt: .05, level, guideLevel, guideSeats: guide ? [0] : [],
      levelSet: true, kids, round: { phase: 'live', n: 1 }, tune: c.tune,
      random: () => .016, near: (_at, _radius, name) => name === (id === 'ember-vale' ? 'slime' : 'runner') ? [rival] : [] });
    return { input: L.def.entities[kind.name].think(world, self), self };
  }
  if (id === 'ember-vale') {
    assert.equal(think(false, 1, 'ai', 5, false).self.noticed, 100, 'party companion uses the party dial');
    assert.equal(think(false, 1, 'ai', 5, true).self.noticed, 103, 'guide uses the server dial');
  }
  const action = id === 'ember-vale' ? 'strike' : id === 'hero-rush-3d' ? 'swing' : 'wave';
  assert.equal(think(false, 3).input[action], true, 'ordinary Fair preset takes the action');
  for (const level of [3, 5]) for (const driver of id === 'ember-vale' ? ['bot', 'ai'] : ['bot']) {
    const result = think(true, level, driver);
    assert.equal(result.input[action], false, 'kids preset keeps the original lower aggression');
    assert.equal(result.self.noticed, 100, 'kids preset never reacts faster than level three');
  }
});

for (const id of ['gem-rush-3d', 'hero-rush-3d']) test(`${id}: a blocked knock spends its travel instead of bursting around the obstacle`, async () => {
  const dir = join(PKG, 'starters', id), L = await loadGame(scratch, dir, id + '-blocked-knock');
  const read = p => JSON.parse(readFileSync(join(dir, p), 'utf8'));
  const c = L.R.compileRules(L.def, { map: L.R.compileMap(read('map/main.json')), tune: read('tunables.json'), seats: 8 }), k = c.kinds[0];
  let tick = 244;
  const ctx = L.M.moveContext({ tick: () => tick, tickHz: 20, tune: c.publicTune, map: c.map, name: 'main', spots: c.map.spots, radius: () => k.body.radius, shape: () => k.body, dims: c.dims });
  const start = { x: 18.4553566, y: 11.7305613, z: 0 };
  let body = { pos: start, vel: { x: 0, y: 0, z: 0 }, heading: { x: 1, y: 0, z: 0 }, grounded: true,
    motion: { ...L.P.initFields(k.motion, c.dims), knockAt: 244.4, knockUntil: 252.8, knockFrom: start, knockDir: { x: .9567462, y: .2909238, z: 0 } } };
  const eased = n => 1 - Math.pow(1 - Math.max(0, Math.min(1, (n - 244.4) / 8.4)), c.publicTune.knockEase);
  let total = 0;
  for (tick = 245; tick <= 252; tick++) {
    const before = body.pos;
    body = L.P.stepMove(k.move, body, { ax: 0, ay: 0 }, ctx, 125000, k.motion, c.dims, e => { throw e; });
    const moved = Math.hypot(body.pos.x - before.x, body.pos.y - before.y);
    const available = c.publicTune.knockDistance * ((tick === 252 ? 1 : eased(tick)) - eased(tick - 1));
    assert.ok(moved <= available + .002, `tick ${tick}: moved ${moved} with only ${available} travel left in this step`);
    total += moved;
  }
  assert.ok(total > .1 && total < c.publicTune.knockDistance - .1, 'the obstacle absorbs some of the knock');
});
