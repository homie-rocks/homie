import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
import {KEY_PERMISSIONS,SHOP_KEY_PERMISSIONS} from '../lib/shop.mjs';

// Resource mapping follows https://docs.stripe.com/stripe-apps/reference/permissions
// Expanded objects need their own permissions, even without a direct resource call.
const resources={checkout:'Checkout Sessions',refunds:'Charges',charges:'Charges',payment_intents:'PaymentIntents',disputes:'Disputes',webhook_endpoints:'Webhook Endpoints',subscriptions:'Subscriptions',subscription_items:'Subscriptions',invoices:'Invoices',invoice_payments:'Invoices',billing_portal:'Customer portal',payment_method_configurations:'Payment method configurations',crypto:'Crypto Deposit Addresses',network:'Business Profiles'};
const expansions={product:'Products',price:'Prices',payment_intent:'PaymentIntents',latest_charge:'Charges',latest_invoice:'Invoices',invoice:'Invoices'};
test('every worker Stripe endpoint and expansion is covered by its restricted key',()=>{
 let calls=0;
 for(const file of readdirSync(new URL('../worker/',import.meta.url)).filter(f=>f.endsWith('.mjs'))){
  const source=ts.createSourceFile(file,readFileSync(new URL('../worker/'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const shop=file.startsWith('shop')||file==='stripe.mjs';
  const maps=[new Map(KEY_PERMISSIONS.map(([k,v])=>[k,v])),...(shop?[new Map(SHOP_KEY_PERMISSIONS.map(([k,v])=>[k,v]))]:[])];
  const check=(permission,level)=>{assert.ok(permission,`${file}: unmapped Stripe resource`);for(const permissions of maps)assert.ok(permissions.get(permission)==='Write'||level==='Read'&&permissions.get(permission)==='Read',`${file}: needs ${permission} ${level}`);};
  function visit(node){
   if(ts.isCallExpression(node)&&['stripeCall','allPages','call'].includes(node.expression.getText(source))){
    const name=node.expression.getText(source),offset=name==='call'?0:1;
    const method=name==='allPages'?'GET':node.arguments[offset]?.text;
    const path=node.arguments[name==='allPages'?1:offset+1];
    // Only the two reviewed forwarding wrappers accept dynamic method/path.
    if(!path||ts.isIdentifier(path)){
     assert.ok(file==='stripe.mjs'&&name==='stripeCall'||file==='shop-subscriptions.mjs'&&path?.text==='path'||file==='payment-capabilities.mjs'&&path?.text==='path',`${file}: unreviewed dynamic Stripe call`);
    }else{
     const prefix=ts.isTemplateExpression(path)?path.head.text:path.text;
     assert.match(prefix??'',/^\/v[12]\//,file);calls++;
     const resource=prefix.split('/')[2];
     // Shared cancellation helpers are only used by the purchase/parts flow.
     const onlyParts=file==='stripe.mjs'&&resource==='subscriptions';
     if(onlyParts){assert.equal(maps[0].get('Subscriptions'),'Write');}
     else check(resources[resource],method==='GET'?'Read':'Write');
    }
   }
   if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='expand'){
    assert.ok(ts.isArrayLiteralExpression(node.initializer),`${file}: review dynamic expansion`);
    for(const item of node.initializer.elements)for(const part of item.text.split('.'))if(!['data','items','lines'].includes(part))check(expansions[part],'Read');
   }
   ts.forEachChild(node,visit);
  }
  visit(source);
 }
 assert.ok(calls>40,'inventory includes all worker Stripe calls');
});
