import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {COIN_DASH,loadGame,writeGame} from './rules-kit.mjs';
const scratch=realpathSync(mkdtempSync(join(tmpdir(),'homie-maps-')));
test.after(()=>rmSync(scratch,{recursive:true,force:true}));
let loaded;const kit=()=>loaded??=loadGame(scratch,COIN_DASH);
const close=(a,b)=>assert.ok(Math.abs(a-b)<.003,`${a} != ${b}`);
for(const dims of [2,3])test(`wrapped ${dims}D indexed sweeps, rays, overlaps and multi-period movement`,async()=>{
 const L=await kit(),map=L.R.compileMap({bounds:{min:[0,0,0],max:[20,20,20]},wrap:{x:true,y:true,...(dims===3?{z:true}:{})},boxes:[{min:[.5,4,0],max:[1.5,6,4]}]});
 const ctx=L.M.moveContext({tick:()=>1,tickHz:20,tune:{},map,name:'main',spots:{},radius:()=>.2,dims});
 const body={pos:{x:19,y:5,z:1}};
 const hit=ctx.map.sweep(body,{x:4,y:0,z:0});assert.ok(hit);close(body.pos.x,.299);assert.equal(hit.normal.x,-1);
 const free={pos:{x:19,y:10,z:10}};ctx.map.sweep(free,{x:43,y:0,z:0});close(free.pos.x,2);
 const ray=ctx.map.ray({x:19,y:5,z:1},{x:1,y:0,z:0},5);assert.ok(ray);close(ray.dist,1.5);close(ray.at.x,.5);
 const overlaps=ctx.map.overlaps({pos:{x:20.5,y:5,z:1}});assert.ok(overlaps);
 if(dims===3){const up={pos:{x:10,y:10,z:19}};ctx.map.sweep(up,{x:0,y:0,z:3});close(up.pos.z,2);}
});
test('generated map replacement is atomic on failure, saved before and after activation, and settles at next tick',async()=>{
 const dir=writeGame(scratch,'maps',{rules:`import {defineRules,f} from '@homie-rocks/studio/rules';
export default defineRules({contract:2,space:{dims:2},shared:{tile:f.u8()},shapes:{events:{bad:{}}},entities:{dummy:{body:{shape:'circle',radius:.2,maxSpeed:0}}},room:{start(w){w.map.replace({bounds:{min:[0,0],max:[4,4]},tiles:{width:4,height:4,data:[0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0],flows:{exit:[15]}}});w.after(1,'bad');},on:{bad(w){w.shared.tile=w.map.tile(1,1);w.map.replace({bounds:{min:[0,0],max:[5,4]}});}}}});`});
 const L=await loadGame(scratch,dir),compiled=L.R.compileRules(L.def,{map:L.R.compileMap({bounds:{min:[0,0],max:[4,4]}})}),core=L.C.createCore(compiled,{seed:470});
 const pending=core.save();assert.ok(pending.maps.pending);
 const transport=JSON.parse(JSON.stringify(pending));
 const restored=L.C.createCore(compiled,{restore:transport});transport.maps.pending[1].tiles.data[5]=0;
 core.step();restored.step();assert.deepEqual(restored.save(),core.save());assert.equal(core.stats.errors,1);assert.match(core.stats.lastError,/preserves bounds/);
 assert.equal(core.save().shared[0],1);assert.equal(core.save().maps.current[1].tiles.data[5],1);
 assert.throws(()=>L.C.createCore(compiled,{restore:{...core.save(),maps:{}}}),/save/);
});

test('a 3072-cell level bakes and regenerates within its declared room budget for eight players',async t=>{
 const width=64,height=48,data=Array.from({length:width*height},(_,i)=>{const x=i%width,y=Math.floor(i/width);return y===24?0:x===0||x===width-1||y===0||y===height-1||x%4===0&&y%6!==0?1:0;});
 const level={bounds:{min:[0,0],max:[width,height]},wrap:{x:true},tiles:{width,height,data,flows:{home:[24*width+1]}}};
 const dir=writeGame(scratch,'large-tiles',{rules:`import {defineRules} from '@homie-rocks/studio/rules';import {move} from './move';const LEVEL=${JSON.stringify(level)};
export default defineRules({contract:2,space:{dims:2},move,shapes:{events:{regenerate:{}}},entities:{runner:{player:true,body:{shape:'circle',radius:.2,maxSpeed:1}}},room:{bots:{keep:0},start(w){w.map.replace(LEVEL);w.after(5,'regenerate');},on:{regenerate(w){w.map.replace(LEVEL);}},join(c,p){return{kind:'runner',at:{x:1.5+p.seat,y:24.5,z:0}};}}});`,move:`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){c.map.sweep(b,{x:c.dt,y:0,z:0});}});`});
 const L=await loadGame(scratch,dir),settings=L.R.roomSettings({budget:{tick:1000000}}).settings;
 const compiled=L.R.compileRules(L.def,{map:L.R.compileMap({bounds:level.bounds,wrap:level.wrap}),settings,seats:8}),core=L.C.createCore(compiled,{seed:473072});
 for(let seat=0;seat<8;seat++)core.seatJoin({seat,driver:'person',owner:'p'+seat});
 for(let i=0;i<20;i++){core.step();core.snapshot();}
 assert.equal(core.stats.errors,0,core.stats.lastError);assert.equal(core.stats.budgetStops,0);assert.equal(core.stats.ticksCut,0);
 assert.ok(core.save().maps.current[0]>=6);assert.ok(core.stats.maxUnits<settings.budget.tick/4);
 t.diagnostic(JSON.stringify({cells:data.length,seats:8,budget:settings.budget.tick,stats:core.stats}));
});

test('generated map facade types expose tile queries and reserve replacement for room handlers',async()=>{
 const {guardRules}=await import('../lib/rules-guard.mjs');
 const {checkRules}=await import('../lib/rules-check.mjs');
 const {typecheckRules}=await import('../lib/typecheck.mjs');
 const {esbuildOf}=await import('./rules-kit.mjs');
 const {writeFileSync}=await import('node:fs');
 const source=`import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,entities:{runner:{player:true,input:{ax:f.i8()},body:{shape:'circle',radius:.2,maxSpeed:1},tick(w,s){const d:number=w.map.distance('home',0,0);}}},room:{bots:{keep:0},start(w){w.map.replace({bounds:{min:[0,0],max:[4,4]},tiles:{width:4,height:4,data:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],flows:{home:[0]}}});},join(){return{kind:'runner',at:{x:1,y:1,z:0}};}}});`;
 const dir=writeGame(scratch,'map-types',{rules:source,move:`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){const cell:number=c.map.tile(0,0);const direction=c.map.flow('home',0,0);if(direction)c.map.sweep(b,c.math.scale(direction,c.dt));}});`,view:`import {openRoom} from '@homie-rocks/studio/rules/view';const room=openRoom();const data=room.map.tiles?.data;const period=room.map.wrap?.x;`});
 const esbuild=await esbuildOf(),guarded=await guardRules(esbuild,scratch,dir);
 assert.ok(guarded.ok);const checked=await checkRules(esbuild,scratch,'map-types',guarded.code,{map:{bounds:{min:[0,0],max:[4,4]}},tune:{},seats:2},{declarationsOnly:true});
 await typecheckRules(scratch,{id:'map-types',dir},checked,{});
 writeFileSync(join(dir,'src/rules.ts'),source.replace("const d:number=w.map.distance('home',0,0);",'w.map.replace({});'));
 await assert.rejects(typecheckRules(scratch,{id:'map-types',dir},checked,{}),/replace/);
});

test('generated wrapped levels and restored rooms agree in Node, Chrome and workerd for 240 seeded ticks',async()=>{
 const {guardRules}=await import('../lib/rules-guard.mjs');
 const {loadRules}=await import('../lib/rules-build.mjs');
 const {esbuildOf}=await import('./rules-kit.mjs');
 const {writeFileSync}=await import('node:fs');
 const {pathToFileURL}=await import('node:url');
 const {Miniflare,convertV4MiniflareOptions}=await import('miniflare');
 const {findChrome,chromeArgs}=await import('../lib/chrome.mjs');
 const puppeteer=(await import('puppeteer-core')).default;
 const dir=writeGame(scratch,'map-runtime',{rules:`import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
function level(w){const data=[];for(let y=0;y<25;y++)for(let x=0;x<25;x++)data.push(y===12?0:w.random()<.4?1:0);w.map.replace({bounds:{min:[0,0],max:[25,25]},wrap:{x:true},tiles:{width:25,height:25,data,flows:{exit:[301]}}});w.after(23,'level');}
export default defineRules({contract:2,space:{dims:2},move,shapes:{events:{level:{}}},entities:{runner:{player:true,motion:{distance:f.i16()},body:{shape:'circle',radius:.2,maxSpeed:4}}},room:{bots:{keep:0},start(w){level(w);},on:{level(w){level(w);}},join(){return{kind:'runner',at:{x:24,y:12.5,z:0}};}}});`,move:`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.motion.distance=c.map.distance('exit',Math.floor(b.pos.x),12);c.map.sweep(b,{x:4*c.dt,y:0,z:0});}});`});
 const esbuild=await esbuildOf(),guarded=await guardRules(esbuild,scratch,dir);assert.ok(guarded.ok);
 const bundle=await loadRules(esbuild,scratch,'map-runtime',guarded.code,{bundleOnly:true});
 const text=`const module={exports:{}};${bundle}
export function replay(){const L=module.exports;const c=L.R.compileRules(L.def,{map:L.R.compileMap({bounds:{min:[0,0],max:[25,25]},wrap:{x:true}}),seats:8});let core=L.C.createCore(c,{seed:470625});for(let seat=0;seat<8;seat++)core.seatJoin({seat,driver:'person',owner:'p'+seat});const rows=[];for(let i=0;i<240;i++){core.step();rows.push(JSON.stringify([core.save(),core.snapshot()]));if(i%19===0)core=L.C.createCore(c,{restore:core.save()});if(core.stats.errors||core.stats.budgetStops)throw Error(core.stats.lastError||'budget');}return rows;}
export default {fetch(){return Response.json(replay());}};`;
 const file=join(scratch,'map-runtime.mjs');writeFileSync(file,text);const mod=await import(pathToFileURL(file).href),expected=mod.replay();
 const options={modules:true,script:text,compatibilityDate:'2026-10-01'},mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
 try{assert.deepEqual(await (await mf.dispatchFetch('http://room/')).json(),expected);}finally{await mf.dispose();}
 const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
 try{const page=await browser.newPage();const actual=await page.evaluate(async text=>{const mod=await import(URL.createObjectURL(new Blob([text],{type:'text/javascript'})));return mod.replay();},text);assert.deepEqual(actual,expected);}finally{await browser.close();}
});

test('synchronous event delivery records recipient coverage without a second budget',async()=>{
 const dir=writeGame(scratch,'dispatch-coverage',{rules:`import {defineRules,f} from '@homie-rocks/studio/rules';
export default defineRules({contract:2,space:{dims:2},shapes:{events:{call:{id:f.ref()},ping:{}}},entities:{thing:{fields:{n:f.u8()},on:{ping(w,s){s.n++;}}}},room:{start(w){const id=w.spawn('thing',{x:0,y:0,z:0});w.after(2,'call',{id});},on:{call(w,e){w.dispatch(e.id,'ping');}}}});`});
 const L=await loadGame(scratch,dir),seen=[],core=L.C.createCore(L.R.compileRules(L.def),{observe:(kind,handler,error)=>seen.push([kind,handler,error])});
 core.step();core.step();assert.ok(seen.some(([kind,handler,error])=>kind==='thing'&&handler==='on.ping'&&!error));assert.equal(core.stats.errors,0);
});

test('an over-budget map bake cannot publish a partial replacement',async()=>{
 const large={bounds:{min:[0,0],max:[25,25]},tiles:{width:100,height:100,size:.25,data:Array(10000).fill(0),flows:{exit:[0]}}};
 const dir=writeGame(scratch,'map-quota',{rules:`import {defineRules} from '@homie-rocks/studio/rules';const LARGE=${JSON.stringify(large)};
export default defineRules({contract:2,space:{dims:2},shapes:{events:{large:{}}},entities:{thing:{}},room:{start(w){w.map.replace({bounds:{min:[0,0],max:[25,25]},boxes:[{min:[1,1],max:[2,2]}]});w.after(2,'large');},on:{large(w){w.map.replace(LARGE);}}}});`});
 const L=await loadGame(scratch,dir),core=L.C.createCore(L.R.compileRules(L.def,{map:L.R.compileMap({bounds:large.bounds})}),{seed:470});
 core.step();const before=core.save().maps.current;core.step();assert.equal(core.stats.budgetStops,1);assert.deepEqual(core.save().maps.current,before);assert.equal(core.save().maps.pending,null);
});

test('wrapped entity rays, sweeps and proximity agree on the same nearby image',async()=>{
 const dir=writeGame(scratch,'wrapped-entities',{rules:`import {defineRules,f} from '@homie-rocks/studio/rules';
export default defineRules({contract:2,space:{dims:2},entities:{target:{body:{shape:'circle',radius:.3,maxSpeed:0},collider:true},seeker:{body:{shape:'circle',radius:.2,maxSpeed:100},fields:{ray:f.ref(),sweep:f.ref(),near:f.u8(),box:f.u8()},tick(w,s){if(w.tick!==2)return;s.near=w.near(s.pos,3,'target').length;s.box=w.inBox({min:{x:19,y:4,z:0},max:{x:21,y:6,z:0}},'target').length;s.ray=w.ray(s.pos,{x:1,y:0,z:0},4)?.entity??'';s.sweep=w.sweep(s,{x:4,y:0,z:0})?.entity??'';}}},room:{start(w){w.spawn('target',{x:1,y:5,z:0});w.spawn('seeker',{x:19,y:5,z:0});}}});`});
 const L=await loadGame(scratch,dir),compiled=L.R.compileRules(L.def,{map:L.R.compileMap({bounds:{min:[0,0],max:[20,20]},wrap:{x:true}})}),core=L.C.createCore(compiled,{seed:472});
 core.step();core.step();const rows=core.snapshot()[1].map(row=>L.P.unpackEntity(compiled.kinds,row,2)),target=rows.find(e=>e.kind==='target'),seeker=rows.find(e=>e.kind==='seeker');
 assert.equal(core.stats.errors,0,core.stats.lastError);assert.equal(seeker.fields.ray,target.id);assert.equal(seeker.fields.sweep,target.id);assert.equal(seeker.fields.near,1);assert.equal(seeker.fields.box,1);close(seeker.pos.x,.499);
});

test('wrapped vertical support finds a ceiling image beneath the body',async()=>{
 const L=await kit(),map=L.R.compileMap({bounds:{min:[0,0,0],max:[20,20,20]},wrap:{z:true},boxes:[{min:[9,9,19],max:[11,11,20]}]});
 const ctx=L.M.moveContext({tick:()=>1,tickHz:20,tune:{},map,name:'main',spots:{},radius:()=>.2,dims:3});
 const hit=ctx.map.support({pos:{x:10,y:10,z:0}});assert.ok(hit);close(hit.at.z,0);assert.equal(hit.normal.z,1);
});
