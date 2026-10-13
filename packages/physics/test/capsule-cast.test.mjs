import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld} from './helpers.mjs';
test('stateless capsule casts separate from a floor, stop at a wall, and preserve a saved world',()=>{
 const w=createWorld({up:'z',bounds:null});
 try {
  w.createBody({type:'static',position:{x:0,y:0,z:-1},colliders:[{shape:{kind:'box',halfExtents:{x:10,y:10,z:1}}}]});
  w.createBody({type:'static',position:{x:2,y:0,z:1},colliders:[{shape:{kind:'box',halfExtents:{x:.5,y:10,z:2}}}]});
  w.step(1/60);
  const before=w.snapshot(),p={x:0,y:0,z:.676};
  assert.equal(w.castCapsule(p,{x:.1,y:0,z:0},.35,1.35),null,'a tangent does not stick to the supporting floor');
  const wall=w.castCapsule(p,{x:3,y:0,z:0},.35,1.35);assert.ok(wall&&wall.fraction>.37&&wall.fraction<.39);assert.ok(wall.normal.x<-.99);
  const floor=w.castCapsule({...p,z:2},{x:0,y:0,z:-3},.35,1.35);assert.ok(floor&&floor.normal.z>.99);
  assert.throws(()=>w.castCapsule(p,{x:1,y:0,z:0},.35,.5),/height/);
  assert.deepEqual(w.snapshot(),before);
 } finally {w.dispose();}
});
