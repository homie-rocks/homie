import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateItems} from '../parts/owner-action-checklist/src/index.mjs';
import {createChecklistHandler} from '../parts/owner-action-checklist/src/handler.mjs';
import {validateMap,heightSampler} from '../parts/terrain-route-map/src/data.mjs';
import {packPart,sharedPartsOf,shareProblems,readPart,verifyFiles} from '../lib/parts.mjs';
import {requireSameOrigin} from '../worker/route-auth.mjs';
const source=new URL('../parts/',import.meta.url).pathname;
test('parts pack through canonical pipeline, with complete licensed integrity manifests',()=>{
 const root=mkdtempSync(join(tmpdir(),'homie-shared-parts-'));
 try { for(const id of ['owner-action-checklist','terrain-route-map']) {
  const dir=join(source,id),part=readPart(dir);
  assert.deepEqual(shareProblems(part,{dir}),[]);assert.equal(verifyFiles(dir,part).ok,true);
  cpSync(dir,join(root,'parts',id),{recursive:true});assert.equal(packPart(root,id).ok,true);
 } assert.equal(sharedPartsOf(root).length,2);
 const catalogue=JSON.parse(readFileSync(join(source,'catalogue.json')));
 assert.deepEqual(catalogue.parts.map(p=>p.id),sharedPartsOf(root).map(p=>p.id));
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('checklist rejects duplicate and unclear proposals',()=>{
 const item={id:'a',revision:'1',title:'Approve',consequence:'Reserve room A',confirmLabel:'Approve'};
 assert.equal(validateItems([item]).length,1);assert.throws(()=>validateItems([item,item]));assert.throws(()=>validateItems([{...item,consequence:''}]));
});
test('worker boundary uses origin and role checks before any tool call',async()=>{
 let calls=0,seen; const auth={isOwner:async()=>false,hasRole:async(_r,_e,app,role)=>app==='desk'&&role==='staff',requireSameOrigin};
 const handler=createChecklistHandler({app:'desk',auth,list:async()=>[],act:async(ctx,input)=>{calls++;seen={ctx,input};return {ok:true};}});
 const request=(origin,body={id:'a',revision:'1',operation:'confirm',key:'one'})=>new Request('https://studio.example/actions',{method:'POST',headers:{Origin:origin},body:JSON.stringify(body)});
 assert.equal((await handler(request('https://other.example'),{})).status,403);assert.equal(calls,0);
 assert.equal((await handler(request('https://studio.example',{id:'a'}),{})).status,400);assert.equal(calls,0);
 const res=await handler(request('https://studio.example'),{});assert.equal(res.status,200);assert.equal(res.headers.get('Cache-Control'),'no-store');assert.equal(seen.ctx.staff,true);assert.equal(seen.input.id,'a');
 auth.hasRole=async()=>false;assert.equal((await handler(request('https://studio.example'),{})).status,403);assert.equal(calls,1);
 auth.isOwner=async()=>true;assert.equal((await handler(request('https://studio.example'),{})).status,200);
});
test('heightmap axes, interpolation, clamping and route limits are deterministic',()=>{
 const data=new Uint8Array(16);data[4]=255;data[8]=128;data[12]=255;
 const sample=heightSampler({width:2,height:2,data},[0,0,10,10],20);
 assert.equal(sample(10,0),20);assert.equal(sample(0,0),0);assert.equal(sample(-10,0),0);assert.ok(Math.abs(sample(5,5)-12.5098)<.001);
 const map=JSON.parse(readFileSync(join(source,'terrain-route-map/preview/route.json')));assert.equal(validateMap(map).markers.length,3);
 assert.throws(()=>validateMap({...map,bounds:[0,0,0,1]}));assert.throws(()=>validateMap({...map,route:{type:'LineString',coordinates:[[0,0],[0,0]]}}));assert.throws(()=>validateMap({...map,markers:[{coordinates:[999,0],label:'bad'}]}));
});
