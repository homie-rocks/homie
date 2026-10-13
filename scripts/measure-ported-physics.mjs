/** Preliminary physics measurement, not the rules/prediction acceptance proof. */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { initPhysics } from '@homie-rocks/physics/Engine.js';
import { createWorld } from '@homie-rocks/physics/World.js';
import { bakePhysicsMesh } from '../packages/studio/lib/physics-mesh.mjs';

if (!process.argv[2]) throw new Error('usage: node scripts/measure-ported-physics.mjs /path/to/octree-arena');
const directory = mkdtempSync(join('/tmp', 'homie-048-physics-'));
cpSync(resolve(process.argv[2]), join(directory,'game'), {recursive:true});
const mesh = await bakePhysicsMesh(join(directory,'game/examples/models/gltf/collision-world.glb'));
writeFileSync(join(directory,'mesh.json'),JSON.stringify(mesh));
await initPhysics();
const options = {up:'z',fixedDt:1/300,maxSubsteps:15,bounds:null};
const world = createWorld(options);
let restored;
try {
  world.createBody({type:'static',colliders:[{shape:{kind:'mesh',vertices:Float32Array.from(mesh.vertices),indices:Uint32Array.from(mesh.indices)}}]});
  const characters=Array.from({length:8},(_,i)=>world.createCharacter({
    position:{x:-8+i*2,y:0,z:8},radius:.35,height:1.35,stepHeight:0,
    stepMinWidth:.2,snapDistance:0,gravity:30,slopeLimit:1.4,offset:.001,jumpSpeed:10,
  }));
  const samples=[], digest=createHash('sha256');
  let restoredTicks=0, midFall=false;
  for(let tick=0;tick<200;tick++) {
    const input={x:tick%100<50?1:-1,y:0};
    const start=process.cpuUsage();
    for(const id of characters) world.controlCharacter(id,input);
    world.step(.05);
    const cpu=process.cpuUsage(start);samples.push((cpu.user+cpu.system)/1000);
    const snapshot=world.snapshot();digest.update(snapshot);
    if(restored) {
      for(const id of characters) restored.controlCharacter(id,input);
      restored.step(.05);
      assert.deepEqual(restored.snapshot(),snapshot,`continuation after tick ${tick}`);
      restoredTicks++;
    }
    if(tick===3) {
      midFall=characters.every(id=>world.characterState(id).verticalVelocity<0 && !world.characterState(id).grounded);
      assert.ok(midFall,'the checkpoint must be mid-fall');
      restored=createWorld(options);restored.restore(snapshot);
      assert.deepEqual(restored.snapshot(),snapshot);
    }
  }
  samples.sort((a,b)=>a-b);
  const receipt={runtime:'Node',node:process.version,triangles:mesh.indices.length/3,players:8,
    roomHz:20,substepHz:300,ticks:200,midFall,restoredTicks,
    snapshotBytes:world.snapshot().byteLength,sha256:digest.digest('hex'),
    cpu:{meanMs:samples.reduce((a,b)=>a+b)/samples.length,p95Ms:samples[190],maxMs:samples.at(-1)},
    limitations:['Not linked to guarded rules budgets','No Chrome or workerd comparison','No two-player prediction proof','Movement uses the physics character controller, not the original Octree depenetration algorithm'],
  };
  writeFileSync(join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({directory,...receipt},null,2));
} finally {restored?.dispose();world.dispose();}
