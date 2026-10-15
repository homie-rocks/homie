import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {parse} from '@babel/parser';
import {workerPermission,WORKER_PERMISSIONS,OPTIONAL_STRIPE_RESOURCES} from '../worker/stripe-permissions.mjs';
test('every Worker Stripe call is classified; optional capability probes do not expand the App grant',async()=>{
 const dir=new URL('../worker/',import.meta.url);let checked=0;
 for(const file of readdirSync(dir,{recursive:true}).filter(f=>f.endsWith('.mjs') && f!=='stripe-permissions.mjs')) {
  const ast=parse(readFileSync(new URL(file,dir),'utf8'),{sourceType:'module'});
  const visit=n=>{
   if(!n||typeof n!=='object')return;
   if(n.type==='CallExpression' && n.callee?.name==='stripeCall') {
    const method=n.arguments[1]?.value,path=n.arguments[2];
    const route=path?.type==='StringLiteral'?path.value:path?.type==='TemplateLiteral'?path.quasis.map(q=>q.value.cooked).join('OBJECT'):null;
    if(method && route && !OPTIONAL_STRIPE_RESOURCES.includes(route))assert.ok(workerPermission(method,route),file+': '+method+' '+route);
   }

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
 for(const path of [...OPTIONAL_STRIPE_RESOURCES,'/v1/api_keys','/v1/transfers','/v1/events','/v1/webhook_endpoints'])assert.equal(workerPermission('GET',path),null);
 for(const permission of ['api_key_write','webhook_write','event_read'])assert.equal(WORKER_PERMISSIONS.includes(permission),false);
});

test('RAK App manifest exactly matches Worker permissions',()=>{
 const app=JSON.parse(readFileSync(new URL('../../../apps/stripe-homie/stripe-app.json',import.meta.url),'utf8'));
 assert.equal(app.name,'Homie');assert.equal(app.stripe_api_access_type,'restricted_api_key');assert.equal(app.distribution_type,'public');
 assert.deepEqual(app.permissions.map(p=>p.permission).sort(),[...WORKER_PERMISSIONS].sort());
 assert.ok(app.permissions.every(p=>p.purpose.length>20));
});
