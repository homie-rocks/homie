import assert from 'node:assert/strict';
import {test} from 'node:test';
import {types} from 'node:util';
import {mkdtempSync,realpathSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findChrome} from '../lib/chrome.mjs';
import {guardRules} from '../lib/rules-guard.mjs';
import {loadRules} from '../lib/rules-build.mjs';
import {writeGame,esbuildOf,COIN_MAP} from './rules-kit.mjs';
const root=realpathSync(mkdtempSync(join(tmpdir(),'homie-map-order-')));
test.after(()=>rmSync(root,{recursive:true,force:true}));
const source=`import {defineRules,f} from '@homie-rocks/studio/rules';export default defineRules({contract:2,space:{dims:2},shared:{sales:f.map(f.u8(),16),first:f.text(16)},shapes:{events:{beat:{}}},entities:{token:{}},room:{start(w){w.shared.sales.zinc=1;w.shared.sales.apple=2;w.shared.sales['10']=3;w.shared.sales['2']=4;w.after(1,'beat');},on:{beat(w){w.shared.first=Object.keys(w.shared.sales)[0]??'';w.after(1,'beat');}}}});`;
let kit;
async function built(){if(!kit){const e=await esbuildOf();const dir=writeGame(root,'ordered',{rules:source});const g=await guardRules(e,root,dir);assert.equal(g.ok,true);const bundle=await loadRules(e,root,'ordered',g.code,{bundleOnly:true});const L=Function('module','exports',bundle+';return module.exports;')({exports:{}},{});kit={bundle,L};}return kit;}
function run(L,map){
 const c=L.R.compileRules(L.def,{map:L.R.compileMap(map),seats:2,settings:L.R.ROOM_DEFAULTS});
 let core=L.C.createCore(c,{seed:7});const rows=[];
 for(let tick=0;tick<128;tick++){
  core.step();core.drain();const save=core.save();const live=L.P.unpackFields(c.shared,save.shared,c.dims);
  const fd=c.shared.find(([key])=>key==='sales')[1];const browser=L.P.unpack(fd,L.P.pack(fd,live.sales,c.dims),c.dims);
  rows.push([live.first,Object.keys(live.sales),Object.keys(browser)]);
  if(tick%7===0)core=L.C.createCore(c,{restore:save});
 }
 return rows;
}
test('first shared map key agrees live, restored and decoded',async()=>{
 const {L}=await built();const rows=run(L,COIN_MAP);
 for(const [first,keys,view] of rows){assert.deepEqual(keys,['2','10','zinc','apple']);assert.deepEqual(view,keys);assert.equal(first,'2');}
});
test('a stored map is a plain frozen object with no prototype: nothing is trapped or sorted when it is read',async()=>{
 const {L}=await built();const plain=Object.create(null);for(let i=0;i<1000;i++)plain['cell'+(999-i)]=i%256;
 const held=L.P.coerce({t:'map',of:{t:'u8'},max:1000},plain,2);
 assert.equal(types.isProxy(held),false);assert.equal(Object.getPrototypeOf(held),null);assert.ok(Object.isFrozen(held));
 assert.deepEqual(Object.keys(held),Object.keys(plain));
});
test('first shared map key agrees in Chrome through repeated restores',async()=>{
 const {L,bundle}=await built();const {default:puppeteer}=await import('puppeteer-core');
 const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage();const result=await page.evaluate(`(()=>{const module={exports:{}};const exports=module.exports;${bundle};return (${run.toString()})(module.exports,${JSON.stringify(COIN_MAP)});})()`);assert.deepEqual(result,run(L,COIN_MAP));}
 finally{await browser.close();}
});
