/** Offline reproducible traffic measurement, not a live Stripe benchmark. */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {stripeFixture} from './selling-stripe-fixture.mjs';
import {shopMcpPlan} from '../lib/shop-mcp.mjs';
const revision='b44eb52e'; // released 0.51.5, before these fixes
function oldModule(file,replacements={}) {
 let source=execFileSync('git',['show',`${revision}:packages/studio/lib/${file}`],{encoding:'utf8'});
 source=source.replace(/from ['"]([^'"]+)['"]/g,(match,path)=>`from ${JSON.stringify(replacements[path]??(path.startsWith('.')?new URL('../lib/'+path,import.meta.url).href:path))}`);
 return 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
}
const legacy=(await import(oldModule('shop-mcp.mjs',{'./shop-links.mjs':oldModule('shop-links.mjs')}))).shopMcpPlan;
async function measure(plan,batched) {
 const root=mkdtempSync(join(tmpdir(),'selling-cost-'));
 try {
  writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Proof',slug:'proof',cloudflare:{domain:'proof.example'}}));
  writeFileSync(join(root,'shop.json'),JSON.stringify({till:'stripe',currency:'usd',automaticTax:false,items:Array.from({length:8},(_,i)=>({id:'item'+i,name:'Item '+i,price:300+i}))}));
  const fixture=stripeFixture();let observations=[],stripeCalls=0,stripeBytes=0,plannerCalls=0,plannerBytes=0,writes=0;
  for(let i=0;i<500;i++) {
   const input={observations},output=await plan(root,input);plannerCalls++;plannerBytes+=Buffer.byteLength(JSON.stringify(input))+Buffer.byteLength(JSON.stringify(output));
   if(output.verified)return {stripeCalls,stripeBytes,plannerCalls,plannerBytes,totalCalls:stripeCalls+plannerCalls,totalBytes:stripeBytes+plannerBytes,writes};
   for(const operation of batched?output.operations:[output.next]) {
    const body=fixture.call(operation);stripeCalls++;stripeBytes+=Buffer.byteLength(JSON.stringify(operation))+Buffer.byteLength(JSON.stringify(body));
    if(operation.method!=='GET')writes++;
    if(batched)observations.push({...operation,body});
    else if(operation.method==='GET')observations.push({path:operation.path,params:operation.params,body});
    else observations=[];
   }
  }
  throw Error('Planner did not converge');
 }finally{rmSync(root,{recursive:true,force:true});}
}
const before=await measure(legacy,false),after=await measure(shopMcpPlan,true);
assert.equal(before.writes,33);assert.equal(after.writes,17);assert.equal(after.stripeCalls,19);assert.ok(after.totalBytes<before.totalBytes/2);
console.log(JSON.stringify({fixture:'8 fixed-price items plus menu, empty account, identical public Stripe fixture; UTF-8 JSON arguments + results, no protocol envelopes, no live calls',baseline:revision,before,after},null,2));
