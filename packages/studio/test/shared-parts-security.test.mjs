import test from 'node:test';
import assert from 'node:assert/strict';
import {createChecklistHandler} from '../parts/owner-action-checklist/src/handler.mjs';
import {mountChecklist} from '../parts/owner-action-checklist/src/index.mjs';
import * as terrain from '../parts/terrain-route-map/src/data.mjs';
const proposal={id:'a',revision:'1',title:'Action',consequence:'Effect',confirmLabel:'Confirm'};
const request=input=>new Request('https://studio.test/actions',{method:'POST',body:JSON.stringify({id:'a',revision:'1',key:'key',operation:'confirm',...input})});
function server(p,owner=false){let calls=0;return {handler:createChecklistHandler({app:'desk',auth:{isOwner:async()=>owner,hasRole:async()=>true,requireSameOrigin:()=>null},list:async()=>[],load:async()=>p,act:async()=>{calls++;if(p.undo)p.undo.used=true;return {ok:true};}}),calls:()=>calls};}
for(const action of ['refund','publish'])test(`staff cannot ${action} without explicit proposal permission`,async()=>{const s=server({...proposal,action});assert.equal((await s.handler(request(),{})).status,403);assert.equal(s.calls(),0);});
test('staff permission is explicit; missing proposals fail closed',async()=>{for(const allowStaff of [true,false,'true']){const s=server({...proposal,allowStaff});assert.equal((await s.handler(request(),{})).status,allowStaff===true?200:403);}const s=server(null,true);assert.equal((await s.handler(request(),{})).status,404);});
test('malformed confirm and undo tokens never reach act',async()=>{for(const operation of ['confirm','undo'])for(const token of ['',{},[],5,' ', 'x'.repeat(1001)]){const s=server(proposal,true);assert.equal((await s.handler(request({operation,token}),{})).status,400);assert.equal(s.calls(),0);}});
test('undo expires server-side and cannot be consumed twice',async()=>{const p={...proposal,undo:{token:'undo-token',revision:'undo-1',expiresAt:Date.now()+10000,used:false}};const s=server(p,true);const input={operation:'undo',token:'undo-token',revision:'undo-1'};assert.equal((await s.handler(request({...input,revision:'1'}),{})).status,409);assert.equal((await s.handler(request(input),{})).status,200);assert.equal((await s.handler(request(input),{})).status,409);p.undo.used=false;p.undo.expiresAt=Date.now()-1;assert.equal((await s.handler(request(input),{})).status,409);assert.equal(s.calls(),1);});
class Element {children=[];dataset={};classList={add(){}};disabled=false;hidden=false;setAttribute(){} append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}}
test('UI retries retain keys and undo uses a separate revision and deadline',async(t)=>{const old=globalThis.document;globalThis.document={createElement:()=>new Element()};t.after(()=>globalThis.document=old);const root=new Element(),inputs=[];let fail=true;const ui=mountChecklist(root,{list:async()=>[{...proposal}],execute:async input=>{inputs.push(input);if(fail){fail=false;throw Error('lost response');}return {ok:true,undoToken:'undo-token',undoRevision:'undo-1',undoExpiresAt:Date.now()+30};}});await ui.ready;await root.children[1].children[0].children[2].onclick();await ui.refresh();let button=root.children[1].children[0].children[2];assert.equal(button.disabled,false);await button.onclick();assert.equal(inputs[0].key,inputs[1].key);await button.onclick();assert.equal(inputs[2].revision,'undo-1');assert.notEqual(inputs[2].key,inputs[1].key);ui.dispose();const exp=mountChecklist(root,{list:async()=>[{...proposal}],execute:async()=>({ok:true,undoToken:'token',undoRevision:'u',undoExpiresAt:Date.now()+20})});await exp.ready;button=root.children[1].children[0].children[2];await button.onclick();await new Promise(r=>setTimeout(r,40));assert.equal(button.hidden,true);exp.dispose();});
const map={bounds:[0,0,1,1],route:{type:'LineString',coordinates:[[0,0],[1,1]]},heightmap:'heightmap.png'};
test('heightmap URL restricts origins, protocols and image types',()=>{const options={baseURL:'https://studio.test/maps/'};for(const heightmap of ['https://evil.test/a.png','data:image/png;base64,AA','javascript:alert(1)','a.svg','a.html','https://user:pass@studio.test/a.png'])assert.throws(()=>terrain.validateMap({...map,heightmap},options));assert.equal(terrain.validateMap(map,options).heightmap,'heightmap.png');assert.doesNotThrow(()=>terrain.validateMap({...map,heightmap:'https://cdn.test/a.png'},{...options,allowedOrigins:['https://cdn.test']}));});
test('PNG dimensions are checked before any image decode',()=>{const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);const view=new DataView(png.buffer);view.setUint32(16,100000);view.setUint32(20,100000);assert.throws(()=>terrain.heightmapDimensions(png),/2048/);view.setUint32(16,64);view.setUint32(20,32);assert.deepEqual(terrain.heightmapDimensions(png),{width:64,height:32});});
test('loader refuses oversized headers, wrong MIME and redirects before decoding',async(t)=>{
 const oldFetch=globalThis.fetch, oldDecode=globalThis.createImageBitmap;
 t.after(()=>{globalThis.fetch=oldFetch;globalThis.createImageBitmap=oldDecode;});
 let decodes=0;
 globalThis.createImageBitmap=async()=>{decodes++;return {};};
 const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
 const view=new DataView(png.buffer);view.setUint32(16,100000);view.setUint32(20,100000);
 globalThis.fetch=async(_url,options)=>{assert.equal(options.redirect,'error');return new Response(png,{headers:{'Content-Type':'image/png'}});};
 await assert.rejects(terrain.loadHeightmap('a.png',{baseURL:'https://studio.test/'}),/2048/);
 assert.equal(decodes,0);
 globalThis.fetch=async()=>new Response(png,{headers:{'Content-Type':'text/html'}});
 await assert.rejects(terrain.loadHeightmap('a.png',{baseURL:'https://studio.test/'}),/PNG/);
 assert.equal(decodes,0);
 view.setUint32(16,64);view.setUint32(20,64);
 globalThis.fetch=async()=>new Response(png,{headers:{'Content-Type':'image/png'}});
 await terrain.loadHeightmap('a.png',{baseURL:'https://studio.test/'});
 assert.equal(decodes,1);
});
