import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {shopRoutes,shopOf} from '../worker/shop.mjs';
import {linkSettings,hasStripeKey,linkConfig} from '../worker/shop-links.mjs';
import {withToolIdentity} from '../worker/tool-identity.mjs';
import {moveBooking} from '../worker/booking-store.mjs';
import {loadSelling} from '../worker/selling/index.mjs';
await loadSelling();
import {subscriptionPortal,subscriptionEvent} from '../worker/shop-subscriptions.mjs';
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const f of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../../../template/site/migrations/'+f,import.meta.url),'utf8'));
 const prepare=(q,args=[])=>{const runSync=()=>({meta:{changes:sql.prepare(q).run(...args).changes}});return{bind:(...a)=>prepare(q,a),first:async()=>sql.prepare(q).get(...args)??null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>runSync(),runSync};};
 const env={STRIPE_WEBHOOK_SECRET:'whsec_'+ 'fixture'.repeat(5),DB:{prepare,batch:async ss=>{sql.exec('BEGIN');try{const r=ss.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}}};
 const cat={studio:{name:'Shop'},games:[{id:'tune',kind:'app',records:{collections:{bookings:{booking:{slots:'slots',item:'tune'}}}}}],shop:{till:'stripe',currency:'cad',items:[{id:'tune',name:'Tune',price:5000},{id:'wax',name:'Wax',price:1000},{id:'monthly',name:'Monthly',price:2000,interval:'month',gives:['member']}]}};
 const items=cat.shop.items.map(i=>({item:i.id,id:'plink_'+i.id,url:'https://buy.stripe.com/test_'+i.id,price:'price_'+i.id,revision:i.id}));
 const config={v:1,mode:'test',settings:linkSettings(shopOf(cat)),items,portal:'https://billing.stripe.com/p/login/test_abc',menus:[{id:'plink_menu',url:'https://buy.stripe.com/test_menu',revision:'menu',items:items.slice(0,2)}],slots:[{...items[0],id:'plink_slot',url:'https://buy.stripe.com/test_slot',revision:'slot',app:'tune',collection:'bookings',slots:'slots',slot:'morning',capacity:1,active:true,count:0}]};env.STRIPE_SHOP_LINKS=JSON.stringify(config);
 for(const id of ['alice','bob'])sql.prepare('INSERT INTO players(id,name,created_at,seen_at) VALUES(?,?,1,1)').run(id,id);
 sql.prepare('INSERT INTO app_records VALUES(?,?,?,?,1,1)').run('tune','slots','morning',JSON.stringify({capacity:1}));
 for(const type of ['order.paid','booking.pending','booking.confirmed','subscription.started','subscription.renewed','subscription.failed','subscription.cancelled'])sql.prepare('INSERT INTO function_subscriptions(name,type,cursor,started) VALUES(?,?,0,0)').run(type,type);
 const route=async(path,body,headers={},id)=>{const url=new URL(path,'https://shop.example');let req=new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});if(id)req=withToolIdentity(req,{id});const r=await shopRoutes(req,env,{},url,{catalogueOf:async()=>cat});return{status:r.status,...await r.json()};};
 const buy=(body,id='alice')=>route('/api/shop/buy',body,{},id);
 let seq=0;const hook=(type,object)=>{const at=Math.floor(Date.now()/1000);const body=JSON.stringify({id:'evt_'+(++seq),type,livemode:false,created:at,data:{object}});const signature=createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(at+'.'+body).digest('hex');return route('/api/shop/hook',body,{'stripe-signature':`t=${at},v1=${signature}`});};
 const session=(order,kind,extra={})=>({id:'cs_test_'+order.order,client_reference_id:order.order,payment_link:'plink_'+kind,metadata:{revision:kind},currency:'cad',amount_subtotal:5000,amount_total:5000,payment_status:'paid',payment_intent:'pi_'+order.order,...extra});
 return{sql,env,cat,config,buy,hook,session};
}
test('dotenv-safe keyless bindings preserve unicode and punctuation',()=>{const config={v:1,mode:'test',items:[],settings:"Maya’s #1 tune's \"shop\""};assert.deepEqual(linkConfig({STRIPE_SHOP_LINKS:'base64:'+Buffer.from(JSON.stringify(config)).toString('base64')}),config);});
test('key alone does not select sessions',()=>{assert.equal(hasStripeKey({STRIPE_KEY:'rk_test_fixture'}),false);assert.equal(hasStripeKey({STRIPE_KEY:'rk_test_fixture',STRIPE_CHECKOUT_MODE:'sessions'}),true);});
test('menu waits for signed paid invoice, records actual quantities and reference once, tolerates reversed delivery',async t=>{
 const f=fixture(t);const cart=await f.buy({lines:[{item:'tune',quantity:1},{item:'wax',quantity:1}],reference:'table-7'});assert.equal(cart.ok,true);assert.match(cart.url,/test_menu/);
 const s=f.session(cart,'menu',{invoice:'in_menu',amount_subtotal:11000,amount_total:11000});
 const invoice={id:'in_menu',status:'paid',livemode:false,currency:'cad',total:11000,metadata:{homie:'shop-links-v1'},lines:{has_more:false,data:[{price:{id:'price_tune'},quantity:2,amount:10000},{price:{id:'price_wax'},quantity:1,amount:1000}]}};
 assert.equal((await f.hook('checkout.session.completed',s)).status,503);assert.equal(f.sql.prepare('SELECT paid_at FROM shop_orders WHERE id=?').get(cart.order).paid_at,null);
 assert.equal((await f.hook('invoice.paid',invoice)).status,200);await f.hook('checkout.session.completed',s);await f.hook('invoice.paid',invoice);
 const ev=JSON.parse(f.sql.prepare("SELECT data FROM studio_events WHERE type='order.paid'").get().data);assert.equal(ev.reference,'table-7');assert.deepEqual(ev.lines.map(l=>[l.item,l.quantity]),[['tune',2],['wax',1]]);assert.equal(f.sql.prepare("SELECT count(*) n FROM studio_events WHERE type='order.paid'").get().n,1);
 const b=await f.buy({lines:[{item:'tune'},{item:'wax'}],reference:'table-8'});await f.hook('invoice.paid',{...invoice,id:'in_reverse'});await f.hook('checkout.session.completed',f.session(b,'menu',{invoice:'in_reverse',amount_subtotal:11000,amount_total:11000}));assert.equal(f.sql.prepare('SELECT status FROM shop_orders WHERE id=?').get(b.order).status,'paid');
});
test('keyless pending does not consume last seat; paid confirms, full rejects and refund releases',async t=>{
 const f=fixture(t);const req={item:'tune',game:'tune',booking:{collection:'bookings',slot:'morning'}};
 const a=await f.buy(req),b=await f.buy(req,'bob');assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(f.sql.prepare("SELECT count(*) n FROM shop_bookings WHERE state='pending'").get().n,2);
 await f.hook('checkout.session.completed',f.session(a,'slot'));assert.equal(f.sql.prepare('SELECT state FROM shop_bookings WHERE id=?').get(a.order).state,'confirmed');assert.equal((await f.buy(req,'bob')).status,409);
 await f.hook('checkout.session.expired',f.session(b,'slot',{payment_status:'unpaid'}));assert.equal(f.sql.prepare('SELECT state FROM shop_bookings WHERE id=?').get(b.order).state,'released');
 await f.hook('refund.created',{id:'re_test',payment_intent:'pi_'+a.order,status:'succeeded',amount:5000,currency:'cad'});assert.equal(f.sql.prepare('SELECT state FROM shop_bookings WHERE id=?').get(a.order).state,'released');
 await f.hook('payment_link.updated',{id:'plink_slot',active:false,restrictions:{completed_sessions:{count:1,limit:1}}});assert.equal((await f.buy(req)).status,409);
 await f.hook('payment_link.updated',{id:'plink_slot',active:true,restrictions:{completed_sessions:{count:0,limit:1}}});assert.equal((await f.buy(req)).status,409,'stale active event cannot reopen full slot');
});
test('keyless membership paid periods renew, failure does not extend, cancellation defeats delayed invoice; portal ownership',async t=>{
 const f=fixture(t);const a=await f.buy({item:'monthly',reference:'gift-20'});await f.hook('checkout.session.completed',f.session(a,'monthly',{amount_subtotal:2000,amount_total:2000,subscription:'sub_member',customer:'cus_member',invoice:'in_first'}));
 const invoice=(id,end)=>({id,status:'paid',livemode:false,currency:'cad',amount_paid:2000,total:2000,billing_reason:'subscription_cycle',parent:{subscription_details:{subscription:'sub_member',metadata:{homie:'shop-links-v1'}}},lines:{has_more:false,data:[{price:{id:'price_monthly'},quantity:1,amount:2000,period:{end}}]}});
 const end=Math.floor(Date.now()/1000)+1000;await f.hook('invoice.paid',invoice('in_first',end));const ends=()=>f.sql.prepare('SELECT ends_at FROM shop_entitlement_lines WHERE order_id=?').get(a.order).ends_at;assert.equal(ends(),end*1000);
 await f.hook('invoice.paid',invoice('in_next',end+1000));assert.equal(ends(),(end+1000)*1000);await f.hook('invoice.payment_failed',{...invoice('in_failed',end+2000),status:'open'});assert.equal(ends(),(end+1000)*1000);
 assert.equal(await subscriptionPortal(f.env,'alice','sub_member','https://shop.example'),f.config.portal);assert.equal(await subscriptionPortal(f.env,'bob','sub_member','https://shop.example'),null);
 await f.hook('customer.subscription.deleted',{id:'sub_member'});const cancelled=ends();await f.hook('invoice.paid',invoice('in_delayed',end+3000));assert.equal(ends(),cancelled);assert.ok(cancelled<=Date.now());
});

test('staff cannot move into a live keyless checkout budget; an AI-paused target accepts a versioned move',async t=>{
 const f=fixture(t);const req={item:'tune',game:'tune',booking:{collection:'bookings',slot:'morning'}};const a=await f.buy(req);await f.hook('checkout.session.completed',f.session(a,'slot'));
 f.sql.prepare('INSERT INTO app_records VALUES(?,?,?,?,1,1)').run('tune','slots','afternoon',JSON.stringify({capacity:1}));
 f.config.slots.push({...f.config.slots[0],slot:'afternoon',id:'plink_afternoon'});f.env.STRIPE_SHOP_LINKS=JSON.stringify(f.config);
 const move=()=>moveBooking(f.env,{app:'tune',collection:'bookings',id:a.order,slot:'afternoon',version:2});
 await assert.rejects(move(),/pause/);f.config.slots[1].paused=true;f.config.slots[1].active=false;f.env.STRIPE_SHOP_LINKS=JSON.stringify(f.config);assert.equal(await move(),true);assert.equal(await move(),false);
 // Reusing the old URL buys its original slot, not the moved booking's new slot.
 await f.hook('checkout.session.completed',f.session(a,'slot',{id:'cs_test_reopened',payment_intent:'pi_reopened'}));
 const cloned=f.sql.prepare("SELECT * FROM shop_bookings WHERE id!=? AND state='confirmed'").get(a.order);assert.equal(cloned.slot,'morning');
 assert.equal(f.sql.prepare('SELECT value FROM meta WHERE key=?').get('shop-reference:'+cloned.id).value,cloned.id);
});

for (const owner of ['shop-links-v1','shop-v1']) for (const location of ['parent','subscription_details','metadata']) test(`${owner} ${location}: each paid monthly gift becomes one order and app event with the original reference`,async t=>{
 const f=fixture(t);const a=await f.buy({item:'monthly',game:'tune',reference:'meal-table'});
 await f.hook('checkout.session.completed',f.session(a,'monthly',{amount_subtotal:2000,amount_total:2000,subscription:'sub_gifts',customer:'cus_gifts',invoice:'in_initial'}));
 const invoice={id:'in_initial',status:'paid',livemode:false,currency:'cad',amount_paid:2000,total:2000,subtotal:2000,billing_reason:'subscription_create',parent:{subscription_details:{subscription:'sub_gifts',metadata:{homie:'shop-links-v1'}}},lines:{has_more:false,data:[{price:{id:'price_monthly'},quantity:1,amount:2000,period:{end:2000000000}}]}};
 await f.hook('invoice.paid',invoice);
 if(location==='parent')invoice.parent.subscription_details.metadata.homie=owner;
 else { delete invoice.parent.subscription_details.metadata; if(location==='metadata')invoice.metadata={homie:owner};else invoice.subscription_details={metadata:{homie:owner}}; }
 await f.hook('invoice.paid',invoice);
 for(const id of ['in_second','in_second','in_third'])assert.equal((await f.hook('invoice.paid',{...invoice,id,billing_reason:'subscription_cycle'})).status,200);
 const orders=f.sql.prepare("SELECT * FROM shop_orders WHERE status='paid'").all();assert.equal(orders.length,3);assert.equal(orders.reduce((n,o)=>n+o.amount,0),6000);
 const events=f.sql.prepare("SELECT data FROM studio_events WHERE type='order.paid'").all().map(r=>JSON.parse(r.data));assert.equal(events.length,3);
 for(const e of events){assert.equal(e.reference,'meal-table');assert.equal(e.app,'tune');assert.equal(e.amount,2000);}
 assert.equal(f.sql.prepare("SELECT count(*) n FROM meta WHERE key LIKE 'purchase-invoice:%'").get().n,0);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM purchase_orders').get().n,0);
});

test('keyed giving renewals resolve the verified invoice product back to the original line',async t=>{
 const f=fixture(t),a=await f.buy({item:'monthly',game:'tune',reference:'meal-table'});
 await f.hook('checkout.session.completed',f.session(a,'monthly',{amount_subtotal:2000,amount_total:2000,subscription:'sub_keyed',customer:'cus_keyed',invoice:'in_initial'}));
 const line=f.sql.prepare('SELECT * FROM shop_order_lines WHERE order_id=?').get(a.order),snapshot=JSON.parse(line.snapshot);delete snapshot.stripePrice;f.sql.prepare('UPDATE shop_order_lines SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),line.id);
 f.env.STRIPE_KEY='rk_test_fixture';f.env.STRIPE_CHECKOUT_MODE='sessions';
 const invoice={id:'in_keyed',status:'paid',currency:'cad',amount_paid:2000,total:2000,billing_reason:'subscription_cycle',subscription:'sub_keyed',customer:'cus_keyed',livemode:false,lines:{has_more:false,data:[{price:{id:'price_dynamic',product:{metadata:{line:line.id}}},quantity:1,amount:2000}]}};
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async url=>Response.json(String(url).includes('/subscriptions/')?{id:'sub_keyed',customer:'cus_keyed',livemode:false,status:'active',items:{data:[]}}:invoice);
 assert.equal((await f.hook('invoice.paid',invoice)).status,200);
 const paid=f.sql.prepare("SELECT data FROM studio_events WHERE type='order.paid'").all().map(r=>JSON.parse(r.data));assert.equal(paid.length,2);assert.equal(paid[1].reference,'meal-table');
});

for (const owner of ['purchase-links-v1','purchase-v1']) for (const location of ['parent','subscription_details','metadata']) test(`${owner} ${location} invoice belongs only to parts even when a shop subscription matches`,async t=>{
 const f=fixture(t);
 f.sql.exec("INSERT INTO shop_orders(id,player,item,amount,currency,till,mode,status,created_at,updated_at) VALUES('shop-original','alice','monthly',2000,'cad','stripe','test','paid',1,1); INSERT INTO shop_subscriptions(id,order_id,customer) VALUES('sub_parts','shop-original','cus_parts')");
 const invoice={id:'in_parts',status:'paid',livemode:false,currency:'cad',total:2000,amount_paid:2000,billing_reason:'subscription_cycle',parent:{subscription_details:{subscription:'sub_parts',metadata:{homie:owner}}},lines:{has_more:false,data:[{period:{end:2000000000}}]}};
 if(location!=='parent') { delete invoice.parent.subscription_details.metadata; if(location==='metadata')invoice.metadata={homie:owner};else invoice.subscription_details={metadata:{homie:owner}}; }
 assert.equal(await subscriptionEvent(f.env,{type:'invoice.paid',livemode:false,data:{object:invoice}}),null);
 assert.equal((await f.hook('invoice.paid',invoice)).did,'purchase-invoice-waiting');
 assert.equal(f.sql.prepare("SELECT count(*) n FROM shop_subscription_events").get().n,0);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM studio_events").get().n,0);
 assert.ok(f.sql.prepare("SELECT value FROM meta WHERE key='purchase-invoice:sub_parts'").get());
});

test('free volunteer booking confirms locally without a Stripe connection',async t=>{
 const f=fixture(t);delete f.env.STRIPE_SHOP_LINKS;delete f.env.STRIPE_WEBHOOK_SECRET;
 shopOf(f.cat).items[0].price=0;
 const r=await f.buy({item:'tune',game:'tune',booking:{collection:'bookings',slot:'morning'}});
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(f.sql.prepare('SELECT state FROM shop_bookings WHERE id=?').get(r.booking).state,'confirmed');
 assert.equal((await f.buy({item:'tune',game:'tune',booking:{collection:'bookings',slot:'morning'}},'bob')).status,409);
});

for (const amount of [13000,14000,12000]) test(`saved basket preserves exact lines at payment ${amount}`,async t=>{
 const f=fixture(t);f.config.menus[0].basket=true;f.config.menus[0].price='price_round';f.env.STRIPE_SHOP_LINKS=JSON.stringify(f.config);
 const cart=await f.buy({lines:[{item:'tune',quantity:2},{item:'wax',quantity:3}],reference:'table-7'});
 assert.equal(cart.ok,true);assert.equal(new URL(cart.url).searchParams.get('prefilled_amount'),'13000');assert.deepEqual(f.sql.prepare('SELECT item,quantity FROM shop_order_lines WHERE order_id=? ORDER BY position').all(cart.order).map(r=>[r.item,r.quantity]),[['tune',2],['wax',3]]);
 const s=f.session(cart,'menu',{amount_subtotal:amount,amount_total:amount});
 for(const forged of [{currency:'usd'},{payment_link:'plink_wrong'},{metadata:{revision:'wrong'}},{client_reference_id:'ord_missing'}]){await f.hook('checkout.session.completed',{...s,...forged});assert.equal(f.sql.prepare('SELECT paid_at FROM shop_orders WHERE id=?').get(cart.order).paid_at,null);}
 assert.equal((await f.hook('checkout.session.completed',s)).status,200);
 await f.hook('checkout.session.completed',s);
 const events=f.sql.prepare("SELECT data FROM studio_events WHERE type='order.paid'").all().map(r=>JSON.parse(r.data));assert.equal(events.length,1);
 const e=events[0];assert.equal(e.reference,'table-7');assert.equal(e.basketTotal,13000);assert.equal(e.amount,amount);assert.equal(e.settlement,amount<13000?'short':'paid');assert.deepEqual(e.lines.map(l=>[l.item,l.quantity,l.amount]),[['tune',2,10000],['wax',3,3000]]);
 await f.hook('checkout.session.completed',{...s,id:s.id+'again',payment_intent:s.payment_intent+'again'});
 assert.equal(f.sql.prepare("SELECT count(*) n FROM studio_events WHERE type='order.paid'").get().n,2);
});

test('basket sync creates one custom-amount line with studio wording and no Worker key',async()=>{
 const {syncPaymentLinks}=await import('../lib/shop-links.mjs');
 const {checkShop}=await import('../worker/shop-rules.mjs');
 const calls=[];let seq=0;
 const shop=checkShop({till:'stripe',currency:'cad',basket:{name:'Round for your table',description:'Your pub basket'},items:[{id:'pale',name:'Pale',price:800,game:'pub'},{id:'chips',name:'Chips',price:900,game:'pub'}]}).shop;
 const api=async(method,path,params)=>{calls.push({method,path,params});if(method==='GET')return {data:[],has_more:false};const id=path==='/v1/products'?params.id:path==='/v1/prices'?'price_'+(++seq):'plink_'+(++seq);return {id,active:true,url:'https://buy.stripe.com/test_'+seq,...params};};
 const result=await syncPaymentLinks({api,shop,slug:'pub',site:'http://localhost:8787',mode:'test',local:true});
 assert.equal(result.ok,true);const menu=result.config.menus[0];assert.equal(menu.basket,true);
 const price=calls.find(c=>c.path==='/v1/prices'&&c.params.custom_unit_amount);assert.deepEqual(price.params.custom_unit_amount,{enabled:true});
 const link=calls.find(c=>c.path==='/v1/payment_links'&&c.method==='POST'&&c.params.line_items[0].price===menu.price);assert.deepEqual(link.params.line_items,[{price:menu.price,quantity:1}]);assert.equal(link.params.invoice_creation,undefined);
 assert.ok(calls.some(c=>c.path==='/v1/products'&&c.params.name==='Round for your table'&&c.params.description==='Your pub basket'));
});

test('saved single-item basket keeps quantity; unpaid events do not fulfil; full refund uses actual payment',async t=>{
 const f=fixture(t);f.config.menus[0].basket=true;f.config.menus[0].price='price_round';f.env.STRIPE_SHOP_LINKS=JSON.stringify(f.config);
 const a=await f.buy({lines:[{item:'wax',quantity:3}],reference:'table-2'});assert.match(a.url,/test_menu/);
 const s=f.session(a,'menu',{amount_subtotal:2000,amount_total:2000});
 await f.hook('checkout.session.completed',{...s,payment_status:'unpaid'});assert.equal(f.sql.prepare('SELECT paid_at FROM shop_orders WHERE id=?').get(a.order).paid_at,null);
 await f.hook('checkout.session.completed',s);assert.equal(f.sql.prepare('SELECT quantity FROM shop_order_lines WHERE order_id=?').get(a.order).quantity,3);
 await f.hook('refund.created',{id:'re_basket',payment_intent:s.payment_intent,currency:'cad',amount:2000,status:'succeeded'});
 assert.equal(f.sql.prepare('SELECT status FROM shop_orders WHERE id=?').get(a.order).status,'refunded');
 await f.hook('checkout.session.completed',s);assert.equal(f.sql.prepare('SELECT status FROM shop_orders WHERE id=?').get(a.order).status,'refunded');
});

test('paid deposit amount mismatch is retained for staff and the customer, idempotently',async t=>{
 const f=fixture(t),a=await f.buy({item:'tune'});
 const line=f.sql.prepare('SELECT snapshot FROM shop_order_lines WHERE order_id=?').get(a.order);const snapshot=JSON.parse(line.snapshot);snapshot.kind='deposit';f.sql.prepare('UPDATE shop_order_lines SET snapshot=? WHERE order_id=?').run(JSON.stringify(snapshot),a.order);
 const payment=f.session(a,'tune',{amount_subtotal:7000,amount_total:7000});
 await f.hook('checkout.session.completed',payment);await f.hook('checkout.session.completed',payment);
 const order=f.sql.prepare('SELECT * FROM shop_orders WHERE session=?').get(payment.id);
 assert.ok(order);assert.equal(order.status,'review');assert.equal(order.total,7000);assert.equal(order.payment,payment.payment_intent);assert.equal(order.attention,1);assert.match(order.note,/payment.*received/i);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM studio_events WHERE type='payment.review'").get().n,1);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM studio_events WHERE type='order.paid'").get().n,0,'review cannot trigger automatic fulfillment');
 assert.equal(f.sql.prepare('SELECT count(*) n FROM entitlements').get().n,0);
 await f.hook('refund.created',{id:'re_review',payment_intent:payment.payment_intent,currency:'cad',amount:7000,status:'succeeded'});
 const refunded=f.sql.prepare('SELECT * FROM shop_orders WHERE id=?').get(order.id);assert.equal(refunded.refunded_amount,7000);assert.equal(refunded.status,'review');assert.match(refunded.note,/refund/i);
 await f.hook('checkout.session.completed',payment);assert.equal(f.sql.prepare("SELECT count(*) n FROM studio_events WHERE type='order.paid'").get().n,0);
});

test('a slot payment books the paid group quantity and retains an over-capacity payment for review',async t=>{
 const f=fixture(t);f.sql.prepare("UPDATE app_records SET value=? WHERE app='tune' AND collection='slots'").run(JSON.stringify({capacity:3}));f.config.slots[0].capacity=3;f.env.STRIPE_SHOP_LINKS=JSON.stringify(f.config);
 const a=await f.buy({item:'tune',game:'tune',booking:{collection:'bookings',slot:'morning'}});
 await f.hook('checkout.session.completed',f.session(a,'slot',{amount_subtotal:15000,amount_total:15000}));
 assert.equal(f.sql.prepare('SELECT quantity FROM shop_bookings WHERE order_id=?').get(a.order).quantity,3);
 const replay=f.session(a,'slot',{id:'cs_group_reopened',payment_intent:'pi_group_reopened',amount_subtotal:10000,amount_total:10000});
 await f.hook('checkout.session.completed',replay);
 assert.equal(f.sql.prepare('SELECT status FROM shop_orders WHERE session=?').get(replay.id).status,'review');
 assert.equal(f.sql.prepare("SELECT SUM(quantity) n FROM shop_bookings WHERE state='confirmed'").get().n,3);
});
