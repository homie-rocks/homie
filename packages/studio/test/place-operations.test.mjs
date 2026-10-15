import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from './place-database.mjs';
import {services} from '../worker/mcp-tools.mjs';
import {syncFunctions} from '../worker/functions.mjs';
test('record changes capture previous values atomically, including deletion',async t=>{
 const DB=database(t);await syncFunctions({DB},[{name:'mirror',event:'record.changed'}]);
 DB.sql.exec(`INSERT INTO app_records VALUES('place','spots','one','{"state":"held"}',1,1);UPDATE app_records SET value='{"state":"confirmed"}',version=2 WHERE id='one';DELETE FROM app_records;`);
 const events=DB.sql.prepare('SELECT data FROM studio_events ORDER BY seq').all().map(r=>JSON.parse(r.data));
 assert.deepEqual(events.map(e=>e.previous),[null,{state:'held'},{state:'confirmed'}]);
 assert.equal(events[2].operation,'delete');
});
test('functions publish schema-checked named feed events once per idempotency key',async t=>{
 const DB=database(t),schema={type:'object',properties:{slot:{type:'string'}},required:['slot'],additionalProperties:false};
 const env={DB,STUDIO_EVENT_FEEDS:JSON.stringify({bookings:{event:'place.held',schema}})};
 const ctx=services(env,{games:[]},'https://place.test',{id:'function',owner:true},'function:holds',{publish:['bookings']});
 await ctx.events.publish({feed:'bookings',id:'one',data:{slot:'morning'}});
 await ctx.events.publish({feed:'bookings',id:'one',data:{slot:'morning'}});
 assert.equal(DB.sql.prepare('SELECT count(*) n FROM studio_events').get().n,1);
 await assert.rejects(()=>ctx.events.publish({feed:'bookings',id:'one',data:{slot:'afternoon'}}),/different/);
 await assert.rejects(()=>ctx.events.publish({feed:'bookings',id:'two',data:{secret:'x'}}),/schema/);
 await assert.rejects(()=>ctx.events.publish({feed:'other',id:'two',data:{slot:'morning'}}),/declared/);
});

test('app holds and paid bookings consume one atomic capacity budget and enforce ownership',async t=>{
 const {bookingHolds}=await import('../worker/booking-holds.mjs');
 const DB=database(t),env={DB};
 DB.sql.exec(`INSERT INTO app_records VALUES('place','slots','morning','{"capacity":2}',1,1)`);
 const cat={games:[{id:'place',kind:'app',records:{collections:{bookings:{booking:{slots:'slots',item:'ticket'}}}}}]};
 const a=bookingHolds(env,{id:'alice'},cat),b=bookingHolds(env,{id:'bob'},cat);
 const results=await Promise.allSettled([a.hold({app:'place',collection:'bookings',slot:'morning',quantity:2,id:'a',expiresAt:Date.now()+60000}),b.hold({app:'place',collection:'bookings',slot:'morning',quantity:2,id:'b',expiresAt:Date.now()+60000})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const first=results[0].status==='fulfilled',id=results[first?0:1].value.id,owner=first?a:b,other=first?b:a;
 await assert.rejects(()=>other.release({id,version:1}),/owner/);
 const confirmed=await owner.confirm({id,version:1});assert.equal(confirmed.state,'confirmed');
 assert.equal(DB.sql.prepare("SELECT SUM(quantity) n FROM shop_bookings WHERE state IN ('held','confirmed')").get().n,2);
 await assert.rejects(()=>owner.release({id,version:1}),/changed/);
 await owner.release({id,version:2});
 assert.equal(DB.sql.prepare("SELECT SUM(quantity) n FROM shop_bookings WHERE state IN ('held','confirmed')").get().n,null);
});

test('checkout claims the original hold once; payment and expiry share its state',async t=>{
 const {bookingHolds,claimHoldStatement}=await import('../worker/booking-holds.mjs');
 const DB=database(t),env={DB};DB.sql.exec(`INSERT INTO app_records VALUES('place','slots','morning','{"capacity":1}',1,1)`);
 const cat={games:[{id:'place',kind:'app',records:{collections:{bookings:{booking:{slots:'slots',item:'ticket'}}}}}]};
 const api=bookingHolds(env,{id:'alice'},cat),expiry=Date.now()+60000;
 const request={app:'place',collection:'bookings',slot:'morning',id:'request',expiresAt:expiry};
 const held=await api.hold(request);assert.equal((await api.hold(request)).id,held.id);
 assert.equal((await api.hold({...request,expiresAt:expiry+60000})).expiresAt,expiry,'retries never extend a hold');
 await assert.rejects(()=>api.hold({...request,quantity:2}),/different/);
 const order=id=>DB.prepare("INSERT INTO shop_orders(id,item,amount,currency,till,mode,status,created_at,updated_at) VALUES(?1,'ticket',100,'cad','test','test','started',1,1)").bind(id);
 const claim=id=>claimHoldStatement(env,{hold:held.id,app:'place',collection:'bookings',slots:'slots',slot:'morning',quantity:1,order:id});
 assert.equal(held.paid,false);
 await api.confirm({id:held.id,version:1});
 await DB.batch([order('paid'),claim('paid')]);
 await assert.rejects(()=>DB.batch([order('second'),claim('second')]),/changed/);
 assert.equal(DB.sql.prepare("SELECT count(*) n FROM shop_orders WHERE id='second'").get().n,0);
 const owner=bookingHolds(env,{id:'function',owner:true},cat);
 assert.equal((await owner.releaseExpired({app:'place',collection:'bookings',now:expiry+1})).released,0,'Stripe expiry is a provider fact');
 DB.sql.exec("UPDATE shop_orders SET status='paid',paid_at=100,updated_at=100 WHERE id='paid'");
 assert.equal((await api.get({id:held.id})).state,'confirmed');
 assert.equal((await api.get({id:held.id})).paid,true);
 assert.equal(DB.sql.prepare('SELECT count(*) n FROM shop_bookings').get().n,1);
});

test('guest management secrets stay private and slot availability includes local holds',async t=>{
 const {bookingHolds}=await import('../worker/booking-holds.mjs');const {appRecordsRoute}=await import('../worker/app-records.mjs');
 const DB=database(t),env={DB};DB.sql.exec(`INSERT INTO app_records VALUES('place','slots','morning','{"capacity":2}',1,1)`);
 const meta={id:'place',kind:'app',roles:{customer:{signIn:false,can:['read:slots','read:bookings']}},surfaces:{phone:'customer'},records:{persist:true,collections:{slots:{},bookings:{booking:{slots:'slots',item:'ticket'}}}}};
 const api=bookingHolds(env,{id:null}, {games:[meta]}),token='a'.repeat(32);
 const hold=await api.hold({app:'place',collection:'bookings',slot:'morning',quantity:1,id:'one',token,expiresAt:Date.now()+60000});
 await assert.rejects(()=>api.get({id:hold.id,token:'b'.repeat(32)}),/owner/);
 const url=new URL('https://place.test/place/api/app/records/slots');
 const slots=await (await appRecordsRoute(new Request(url),env,meta,url,'api/app/records/slots')).json();assert.equal(slots.records[0].booking.available,1);
 const publicData=JSON.parse(DB.sql.prepare("SELECT value FROM app_records WHERE collection='bookings'").get().value);
 assert.deepEqual(Object.keys(publicData).sort(),['paid','quantity','slot','state']);assert.equal(publicData.paid,false);
});
