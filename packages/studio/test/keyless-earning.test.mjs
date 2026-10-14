import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {shopRoutes,shopOf} from '../worker/shop.mjs';
import {linkSettings,hasStripeKey} from '../worker/shop-links.mjs';
import {withToolIdentity} from '../worker/tool-identity.mjs';
import {subscriptionPortal} from '../worker/shop-subscriptions.mjs';
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
 return{sql,env,config,buy,hook,session};
}
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
});
test('keyless membership paid periods renew, failure does not extend, cancellation defeats delayed invoice; portal ownership',async t=>{
 const f=fixture(t);const a=await f.buy({item:'monthly',reference:'gift-20'});await f.hook('checkout.session.completed',f.session(a,'monthly',{amount_subtotal:2000,amount_total:2000,subscription:'sub_member',customer:'cus_member',invoice:'in_first'}));
 const invoice=(id,end)=>({id,status:'paid',livemode:false,currency:'cad',amount_paid:2000,total:2000,billing_reason:'subscription_cycle',parent:{subscription_details:{subscription:'sub_member',metadata:{homie:'shop-links-v1'}}},lines:{has_more:false,data:[{price:{id:'price_monthly'},quantity:1,amount:2000,period:{end}}]}});
 const end=Math.floor(Date.now()/1000)+1000;await f.hook('invoice.paid',invoice('in_first',end));const ends=()=>f.sql.prepare('SELECT ends_at FROM shop_entitlement_lines WHERE order_id=?').get(a.order).ends_at;assert.equal(ends(),end*1000);
 await f.hook('invoice.paid',invoice('in_next',end+1000));assert.equal(ends(),(end+1000)*1000);await f.hook('invoice.payment_failed',{...invoice('in_failed',end+2000),status:'open'});assert.equal(ends(),(end+1000)*1000);
 assert.equal(await subscriptionPortal(f.env,'alice','sub_member','https://shop.example'),f.config.portal);assert.equal(await subscriptionPortal(f.env,'bob','sub_member','https://shop.example'),null);
 await f.hook('customer.subscription.deleted',{id:'sub_member'});const cancelled=ends();await f.hook('invoice.paid',invoice('in_delayed',end+3000));assert.equal(ends(),cancelled);assert.ok(cancelled<=Date.now());
});
