import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {PKG} from './rules-kit.mjs';
const dir=mkdtempSync(join(tmpdir(),'homie-live-'));test.after(()=>rmSync(dir,{recursive:true,force:true}));
async function bundle(source,name){const file=join(dir,name+'.mjs');await build({stdin:{contents:source,loader:'ts',resolveDir:PKG},bundle:true,platform:'node',format:'esm',outfile:file,logLevel:'silent'});return import(pathToFileURL(file).href);}

test('the studio Stormbreak probe: declared live cover matches static cover and prediction',async()=>{
  // Keep the customer's original evidence unchanged; adapt only the new opt-in
  // declaration, package location, and obsolete expected-failure assertion.
  let source=readFileSync(new URL('./fixtures/stormbreak/probe.mjs',import.meta.url),'utf8');
  source=source.replace("resolve('node_modules/@homie-rocks/studio/rules')",JSON.stringify(join(PKG,'rules')))
    .replace("cover:{body:","cover:{collider:true,body:")
    .replace("assert(dynamic.x>1,'Expected map-only movement to pass through the dynamic cover');","assert.equal(dynamic.x,fixed.x,'Declared live cover must stop the same capsule');")
    .replace("toolkit:'0.43.0'","toolkit:'0.43.1'")
    .replace("defineMove/map.sweep misses live entity cover; world.sweep sees it but is unavailable to predicted move.","Declared live cover matches static cover; the view release gate proves prediction.");
  writeFileSync(join(dir,'probe.mjs'),source.replace("from 'esbuild'",`from ${JSON.stringify(pathToFileURL(join(PKG,'../../node_modules/esbuild/lib/main.js')).href)}`));
  await import(pathToFileURL(join(dir,'probe.mjs')).href);
});

test('collision revisions choose the tick world, support and overlap retain opaque refs; queries pay budget',async()=>{
  const L=await bundle(`export * from ${JSON.stringify(join(PKG,'rules/live.ts'))};export {compileMap,compileRules,defineRules,defineMove,f} from ${JSON.stringify(join(PKG,'rules/rules.ts'))};export {G,BudgetError} from ${JSON.stringify(join(PKG,'rules/guard.ts'))};`,'geometry');
  const definition=(owner=false,collider=true)=>L.defineRules({contract:2,space:{dims:2},move:L.defineMove({runner(){}}),entities:{runner:{player:true,body:{shape:'circle',radius:.4,maxSpeed:4,...(owner?{move:'owner'}:{})}},wall:{body:{shape:'circle',radius:1,maxSpeed:0},collider}},room:{join(){return{kind:'runner',at:{x:0,y:0}};}}});
  assert.throws(()=>L.compileRules(definition(true)),/live colliders need server movement/);
  assert.throws(()=>L.compileRules(definition(false,{size:'missing'})),/must name a vec3 field/);
  const first=[1,2,[['opaque-ref','box',0,0,0,3,.3,2.6]]],destroyed=[7,8,[]];
  assert.equal(L.revisionAt([first,destroyed],7),first);assert.equal(L.revisionAt([first,destroyed],8),destroyed);assert.equal(L.revisionAt([first],1),undefined);
  const map=L.compileMap({bounds:{min:[-10,-10,0],max:[10,10,10]}}),geometry=L.collisionMap(map,first[2]);
  const q=L.collisionQueries(()=>geometry,()=>({shape:'capsule',radius:.4,height:1.8}),3);
  const body={pos:{x:0,y:0,z:4}};
  const support=q.support(body,5);assert.equal(support.entity,'opaque-ref');assert.ok(Math.abs(support.dist-1.4)<1e-6);assert.deepEqual(body.pos,{x:0,y:0,z:4});
  assert.equal(q.overlaps({pos:{x:0,y:0,z:0}}),true);assert.equal(q.overlaps({pos:{x:0,y:2,z:0}}),false);
  const before=L.G.left;L.G.left=1;
  try{assert.throws(()=>q.support(body,5),L.BudgetError);}finally{L.G.left=before;}
});
