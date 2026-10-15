import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {parse} from '@babel/parser';
import {workerPermission,WORKER_PERMISSIONS,OPTIONAL_STRIPE_RESOURCES} from '../worker/stripe-permissions.mjs';
import {stripeCall} from '../worker/stripe.mjs';
test('every Worker Stripe resource is classified; unknown and optional calls cannot escape the credential ceiling',async()=>{
 const dir=new URL('../worker/',import.meta.url);let checked=0;
 for(const file of readdirSync(dir,{recursive:true}).filter(f=>f.endsWith('.mjs') && f!=='stripe-permissions.mjs')) {
  const ast=parse(readFileSync(new URL(file,dir),'utf8'),{sourceType:'module'});
  const visit=n=>{
   if(!n||typeof n!=='object')return;
   const value=n.type==='StringLiteral'?n.value:n.type==='TemplateLiteral'?n.quasis.map(q=>q.value.cooked).join('OBJECT'):null;
   if(value && /^\/v[12]\//.test(value)) {
    // Event retrieval's resource variable is an explicit finite mapping in stripe.mjs.
    if(value==='/v1/OBJECT/OBJECT')assert.equal(file,'stripe.mjs');
    else assert.ok(['GET','POST','DELETE'].some(m=>workerPermission(m,value))||OPTIONAL_STRIPE_RESOURCES.includes(value),file+': '+value);
    checked++;
   }
   for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);
  };visit(ast);
 }
 assert.ok(checked>40);
 for(const path of [...OPTIONAL_STRIPE_RESOURCES,'/v1/api_keys','/v1/transfers'])await assert.rejects(stripeCall({STRIPE_KEY:'rk_test_fixture'},'GET',path,null,{fetcher:()=>assert.fail('forbidden request reached network')}),e=>e.status===403);
 assert.equal(WORKER_PERMISSIONS.includes('api_key_write'),false);
});

test('RAK App manifest exactly matches Worker permissions',()=>{
 const app=JSON.parse(readFileSync(new URL('../../../apps/stripe-homie/stripe-app.json',import.meta.url),'utf8'));
 assert.equal(app.name,'Homie');assert.equal(app.stripe_api_access_type,'restricted_api_key');assert.equal(app.distribution_type,'public');
 assert.deepEqual(app.permissions.map(p=>p.permission).sort(),[...WORKER_PERMISSIONS].sort());
 assert.ok(app.permissions.every(p=>p.purpose.length>20));
});
