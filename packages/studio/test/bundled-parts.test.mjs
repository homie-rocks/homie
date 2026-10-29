import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {addPart,findParts,bundledPart,TOOLKIT_HOST} from '../lib/parts-store.mjs';
const offline=async()=>{throw new Error('no network in this test')};
const npm=()=>({status:0,stdout:'{}',stderr:''});
function studio(){
 const root=mkdtempSync(join(tmpdir(),'homie-bundled-'));
 writeFileSync(join(root,'package.json'),JSON.stringify({name:'s',dependencies:{}}));
 writeFileSync(join(root,'homie.json'),JSON.stringify({name:'S'}));
 mkdirSync(join(root,'parts'),{recursive:true});
 return root;
}
test('the toolkit\'s own parts are named by id or homie.rocks/<id>, checked, and need no network',()=>{
 const got=bundledPart('venue-desk');
 assert.equal(got.ref.ref,`${TOOLKIT_HOST}/venue-desk`);assert.ok(got.files.size>3);
 assert.equal(bundledPart(`${TOOLKIT_HOST}/venue-desk`).part.id,'venue-desk');
 assert.equal(bundledPart('owls.example/venue-desk'),null);assert.equal(bundledPart('no-such-part'),null);
 assert.throws(()=>bundledPart('venue-desk@9.9.9'),/not 9\.9\.9/);
});
test('part_add brings in venue-desk from the installed toolkit; parts_find lists it with the hub down',async()=>{
 const root=studio();
 try{
  const found=await findParts(root,'venue',{fetch:offline});
  assert.ok(found.results.some(r=>r.where==='toolkit'&&r.add===`${TOOLKIT_HOST}/venue-desk`));
  const r=await addPart(root,'venue-desk',{fetch:offline,npm,install:false});
  assert.equal(r.ok,true,r.why);
  assert.ok(existsSync(join(root,'parts/_vendor',TOOLKIT_HOST,'venue-desk/part.json')));
  assert.equal(JSON.parse(readFileSync(join(root,'parts/origins.json'))).parts[`${TOOLKIT_HOST}/venue-desk`].version,'1.0.1');
 }finally{rmSync(root,{recursive:true,force:true})}
});
