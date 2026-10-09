import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRules } from '../lib/rules-build.mjs';
import { esbuildOf, writeGame, COIN_MAP } from './rules-kit.mjs';
import { source, vocab } from './rules-feature-kit.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-contract-')));
test.after(() => rmSync(root, {recursive:true,force:true}));
async function build(id, rules, vocabulary, view='export {};') {
  const dir=writeGame(root,id,{rules});
  writeFileSync(join(dir,'src/view.ts'),view);
  mkdirSync(join(dir,'map'));writeFileSync(join(dir,'map/main.json'),JSON.stringify(COIN_MAP));
  if(vocabulary)writeFileSync(join(dir,'agents.json'),JSON.stringify(vocabulary));
  return prepareRules(await esbuildOf(),root,{id,dir,players:{max:4}});
}
let sharedFixture;
const sharedBuild=()=>sharedFixture??=build('shared-contract',source,vocab);
test('undeliverable discriminates every declared payload in room and entity handlers', async()=>{
  const rules=source.replace('shapes: {', 'shapes: { events: { give: { n: f.u16() }, label: { text: f.text(8) } },')
    .replace('on: {',"on: { undeliverable(world,self,e){if(e.event==='give'){const n:number=e.data.n;}else if(e.event==='label'){const text:string=e.data.text;}},");
  await build('returned-event',rules,vocab);
});
test('the view reads companion goals and goal events without casts',async()=>{
  await build('view-goal',source,vocab,`import {openRoom} from '@homie-rocks/studio/rules/view';
const room=openRoom();room.each('pawn',w=>{if(w.goal?.goal==='visit'){const place:string=w.goal.args.place;}});
let mine=room.me?.goal;room.on('goal',e=>{mine=e.goal;});
room.on('goal',g=>{if(g.goal?.goal==='visit'){const place:string=g.goal.args.place;}});`);
});
const mapGame=`import {defineRules,f} from '@homie-rocks/studio/rules';export default defineRules({contract:2,space:{dims:2},shared:{hits:f.map(f.u8(),8),leader:f.text(32)},shapes:{events:{beat:{}}},entities:{token:{}},room:{start(w){w.shared.hits.z=1;w.shared.hits.a=2;w.after(1,'beat');},on:{beat(w){w.shared.leader=Object.keys(w.shared.hits)[0]??'';w.after(1,'beat');}}}});`;
test('shared map first-key reads replay after every restore',async()=>{await build('map-order',mapGame);});
// These deliberately bypass the static wall, so that the rebuilt room alone has to show them.
// A module counter shares changing state; a WeakMap hides changing state from saves.
for(const [id,top,body,verdict] of [
 ['shared-counter','let count=0;', 'self.n=++count;', /does not play the same as the room that kept running.*fields\.n.*Keep everything that changes/s],
 ['hidden-counter','const counts=new WeakMap();', 'const n=(counts.get(self)??0)+1;counts.set(self,n);self.n=n;', /does not play the same as the room that kept running.*fields\.n.*Keep everything that changes/s],
]) test(`replay diagnoses ${id} with a remedy that repairs it`,async()=>{
 const {checkRules}=await import('../lib/rules-check.mjs');
 const game=(top,body)=>`import {defineRules,f} from '@homie-rocks/studio/rules';${top}export default defineRules({contract:2,space:{dims:2},entities:{dot:{fields:{n:f.u16()},tick(w,self){${body}}}},room:{start(w){w.spawn('dot',{x:3,y:3});}}});`;
 const run=code=>checkRules(esbuild,root,id,code,{map:COIN_MAP,tune:{},seats:4},{allowance:{ticks:60}});
 const esbuild=await esbuildOf();
 await assert.rejects(build(id+'-guarded',game(top,body)),/module.*let|WeakMap|not available|no state of its own/);
 await assert.rejects(run(game(top,body)),verdict);
 await run(game('', 'self.n+=1;'));
});
test('maps keep native insertion order during edits, coercion, packing and restore',async()=>{
 const {loadGame}=await import('./rules-kit.mjs');
 const L=await loadGame(root,writeGame(root,'map-values',{rules:mapGame}));
 const fd={t:'map',of:{t:'u8'},max:8};
 const value=L.P.thaw(fd,L.P.coerce(fd,{},2));
 for(const key of ['z','2','10','a'])value[key]=1;
 const expected=['2','10','z','a'];
 assert.deepEqual(Object.keys(value),expected);
 const held=L.P.coerce(fd,value,2);
 assert.deepEqual(Object.keys(held),expected);
 assert.deepEqual(Object.keys(L.P.unpack(fd,L.P.pack(fd,held,2),2)),expected);
});
test('the entire contextual author surface is usable with natural member reads',async()=>{
 const {readFileSync}=await import('node:fs');
 const rules=source.replace('shapes: {', 'shapes: {events:{give:{n:f.u16()}},effects:{flash:{n:f.u8()}},')
   .replace('entities: {', 'entities: {token:{fields:{count:f.u8()}},');
 await build('published-members',rules,vocab,readFileSync(new URL('./rules-published-surface.ts',import.meta.url),'utf8'));
});
test('every remaining contextual unknown has a boundary or generic fallback reason',async()=>{
 const {auditDeclarations,runtimeSources}=await import('./rules-type-audit.mjs');
 const {readFileSync}=await import('node:fs');
 const r=await sharedBuild();
 const findings=auditDeclarations({...runtimeSources(),...Object.fromEntries(['rules.d.ts','view.d.ts'].map(f=>[f,readFileSync(join(root,'.studio/types/shared-contract',f),'utf8')]))});
 assert.equal(findings.filter(f=>f.reason==='UNEXPLAINED'||f.file.endsWith('.d.ts')&&f.type==='any').length,0,JSON.stringify(findings));
 assert.ok(findings.every(f=>!f.reason.includes('narrow first')));
});
test('a history kept at its declared size builds, with the one line that says what was played',async()=>{
 const rules=`import {defineRules,f} from '@homie-rocks/studio/rules';export default defineRules({contract:2,space:{dims:2},shared:{history:f.list(f.u8(),5)},entities:{dot:{}},room:{rounds:{seconds:1,breakSeconds:1},on:{roundStart(w){const a=[...w.shared.history,1];if(a.length>5)a.shift();w.shared.history=a;}}}});`;
 const r=await build('full-history',rules);assert.equal(r.check.information.length,1,r.check.information.join('\n'));
});
test('module constant mutation and the removed check key have usable repairs',async()=>{
 const rules=`import {defineRules} from '@homie-rocks/studio/rules';const items=[1,2];export default defineRules({contract:2,space:{dims:2},entities:{dot:{}},room:{start(){items.reverse();}}});`;
 await assert.rejects(build('constant-mutation',rules),/"0" is read only here\..*constants, query results and event data are read only/);
 await assert.rejects(build('removed-check',mapGame.replace('contract:2','contract:2,check:{}')),/Repair: Remove the obsolete check key/);
});
test('map payloads cross events, effects and ask state',async()=>{
 const rules=source.replace('shapes: {', 'shapes: {events:{report:{mine:f.map(f.u8(),8)}},effects:{report:{mine:f.map(f.u8(),8)}},')
 .replace('shared: {', 'shared: {mine:f.map(f.u8(),8),')
 .replace('start(world) {', 'start(world) { world.shared.mine.z=1;world.shared.mine.a=2;')
 .replace('state: { danger: f.u8() }', 'state: { danger: f.u8(), mine:f.map(f.u8(),8) }')
 .replaceAll("world.ask('director', { danger: 1 })", "world.ask('director', { danger: 1, mine:world.shared.mine })")
 .replace('world.shared.answers += 1;', "world.sendRoom('report',{mine:world.shared.mine});world.emit('report',{x:0,y:0},{mine:world.shared.mine});world.shared.answers += 1;");
 await build('map-payload',rules,vocab);
});
// Deliberately below the static wall.
test('a difference inside a map is named down to its key',async()=>{
 const {checkRules}=await import('../lib/rules-check.mjs');
 const rules=`import {defineRules,f} from '@homie-rocks/studio/rules';const counts=new WeakMap();export default defineRules({contract:2,space:{dims:2},entities:{dot:{fields:{entries:f.map(f.u16(),8)},tick(w,s){const n=(counts.get(s)??0)+1;counts.set(s,n);s.entries.value=n;}},noise:{tick(w){w.random();}}},room:{start(w){w.spawn('dot',{x:3,y:3});w.spawn('noise',{x:4,y:4});}}});`;
 await assert.rejects(checkRules(await esbuildOf(),root,'nested-writer',rules,{map:COIN_MAP,tune:{},seats:2}),/does not play the same as the room that kept running; first difference at ents\.e1\.fields\.entries\.value/);
});
