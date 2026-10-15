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
 DB.sql.exec('DELETE FROM studio_events');
 await ctx.events.publish({feed:'bookings',id:'one',data:{slot:'morning'}});
 assert.equal(DB.sql.prepare('SELECT count(*) n FROM studio_events').get().n,0,'deduplication survives feed pruning');
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

test('resource bookings reject overlapping slots, honor skills and preferred resource, and allocate package components atomically',async t=>{
 const {bookingHolds}=await import('../worker/booking-holds.mjs');const DB=database(t),env={DB};
 const put=(c,id,data)=>DB.sql.prepare('INSERT INTO app_records VALUES(?,?,?,?,1,1)').run('place',c,id,JSON.stringify(data));
 put('resources','one',{capacity:1,skills:['guide'],attributes:{language:'en'}});put('resources','two',{capacity:1,skills:['guide'],attributes:{language:'fr'}});
 for(const id of ['morning','overlap'])put('slots',id,{capacity:10,start:'2026-11-01T09:00:00Z',end:'2026-11-01T11:00:00Z',resources:['one','two'],skills:['guide'],attributes:{language:'en'},options:[{id:'package',components:[{resources:['one']},{resources:['two']}]}]});
 const api=bookingHolds(env,{id:'alice'},{games:[{id:'place',kind:'app',records:{collections:{bookings:{booking:{slots:'slots',item:'ticket',resources:'resources'}}}}}]});
 const request={app:'place',collection:'bookings',slot:'morning',id:'a',resource:'one',expiresAt:Date.now()+60000};
 const held=await api.hold(request);assert.equal(held.allocations[0].resource,'one');
 await assert.rejects(()=>api.hold({...request,id:'b',slot:'overlap'}),/resource.*(capacity|unavailable)/i);
 await assert.rejects(()=>api.hold({...request,id:'c',resource:'two'}),/attributes|skills/);
 await api.release({id:held.id,version:1});
 const pack=await api.hold({...request,id:'package',option:'package'});assert.equal(pack.allocations.length,2);
 await assert.rejects(()=>api.hold({...request,id:'d',slot:'overlap'}),/resource/i);
});

test('booking arguments normalize time and add-on aliases and refuse contradictory aliases',async()=>{
 const {normalizeBookingArgs}=await import('../worker/booking-options.mjs');
 assert.deepEqual(normalizeBookingArgs({time:'morning',addons:['bag','bag','map']}),{slot:'morning',addons:{bag:2,map:1}});
 assert.deepEqual(normalizeBookingArgs({slot:'morning',addOns:{bag:2}}),{slot:'morning',addons:{bag:2}});
 assert.throws(()=>normalizeBookingArgs({slot:'morning',time:'evening'}),/conflicting/);
});

test('dated calendars use place-local dates across daylight saving and multi-day slots',async()=>{
 const {calendarSlots}=await import('../worker/booking-calendar.mjs');
 const slots=calendarSlots({startDate:'2026-10-31',endDate:'2026-11-02',timeZone:'America/Los_Angeles',time:'09:00',days:2,capacity:3});
 assert.equal(slots.length,3);assert.equal(slots[0].start,'2026-10-31T16:00:00.000Z');assert.equal(slots[1].start,'2026-11-01T17:00:00.000Z');assert.equal(slots[0].end,'2026-11-02T17:00:00.000Z');
 assert.throws(()=>calendarSlots({startDate:'2026-03-08',endDate:'2026-03-08',timeZone:'America/Los_Angeles',time:'02:30',days:1,capacity:1}),/does not exist|ambiguous/);
});

test('rolling slot record creation atomically emits the declared payment-link work item',async t=>{
 const DB=database(t);await syncFunctions({DB},[{name:'links',event:'booking.slots_need_payment_links'}]);
 const meta={id:'place',kind:'app',roles:{staff:{signIn:true,can:['create:slots','read:slots']}},surfaces:{phone:'staff'},records:{persist:true,collections:{slots:{fields:{capacity:{type:'number'},start:{type:'string'},end:{type:'string'}}},bookings:{fields:{},booking:{slots:'slots',item:'entry'}}}}};
 const ctx=services({DB},{games:[meta],shop:{items:[{id:'entry',price:100}]}},'https://place.test',{id:'owner',owner:true},'test');
 await ctx.records({app:'place',collection:'slots',id:'day-two',operation:'create',data:{capacity:2,start:'2026-11-02T09:00:00Z',end:'2026-11-02T10:00:00Z'}});
 const rows=DB.sql.prepare("SELECT data FROM studio_events WHERE type='booking.slots_need_payment_links'").all();assert.equal(rows.length,1);
 const data=JSON.parse(rows[0].data);assert.equal(data.slots[0].slot,'day-two');assert.equal(data.slots[0].item,'entry');assert.equal(data.slots[0].capacity,2);
});

test('customer booking tool validates and accepts aliases through its public schema',async t=>{
 const {builtins}=await import('../worker/mcp-tools.mjs'),{invokeAppTool}=await import('../worker/app-tools.mjs');const DB=database(t),env={DB};
 DB.sql.exec(`INSERT INTO app_records VALUES('place','slots','morning','{"capacity":2}',1,1)`);
 const cat={games:[{id:'place',kind:'app',roles:{customer:{signIn:false,can:['read:slots']}},surfaces:{phone:'customer'},records:{persist:true,collections:{slots:{fields:{capacity:{type:'number'}}},bookings:{fields:{},booking:{slots:'slots',item:'ticket'}}}}}]};
 const ctx=services(env,cat,'https://place.test',{id:'alice'},'test');
 const tool=builtins(env,cat,'https://place.test').find(t=>t.name==='studio_book');assert.ok(tool);
 const result=await invokeAppTool(tool,{app:'place',collection:'bookings',time:'morning',id:'request',expiresAt:Date.now()+60000,addOns:[]},ctx);
 assert.equal(result.slot,'morning');assert.equal(result.state,'held');
});

test('live-site check sessions isolate record writes and cannot grant global owner or other app access',async t=>{
 const {builtins,allowed}=await import('../worker/mcp-tools.mjs'),{localCaller}=await import('../worker/local-test.mjs');const DB=database(t),env={DB};
 const meta={id:'place',kind:'app',roles:{staff:{signIn:true,can:['create:notes','read:notes']}},surfaces:{phone:'staff'},records:{persist:true,collections:{notes:{fields:{message:{type:'string'}}}}}};
 const cat={games:[meta,{...meta,id:'other'}]},tool=builtins(env,cat,'https://place.test').find(t=>t.name==='studio_check_session');assert.ok(tool);assert.equal(await allowed(tool.audience,{id:null,owner:false},env),false);
 const session=await tool.handler({app:'place',role:'staff',scope:'check-isolated'},services(env,cat,'https://place.test',{id:'owner',owner:true},'owner'));
 const request=new Request('https://place.test/mcp',{headers:{cookie:'homie_check='+session.token}}),caller=await localCaller(request,env);assert.equal(caller.owner,false);assert.equal(caller.testScope,'check-isolated');
 const ctx=services(env,cat,'https://place.test',caller,'check');
 await ctx.records({app:'place',role:'staff',collection:'notes',id:'one',operation:'create',data:{message:'Test'}});
 assert.equal(DB.sql.prepare("SELECT count(*) n FROM app_records WHERE app='place'").get().n,0);
 assert.equal(DB.sql.prepare("SELECT count(*) n FROM app_records WHERE app='place:check:check-isolated'").get().n,1);
 await assert.rejects(()=>ctx.records({app:'other',collection:'notes'}),/test.*app/i);
 assert.equal(await localCaller(new Request('https://place.test/mcp',{headers:{cookie:'homie_check='+session.token+'x'}}),env),null);
});

test('MCP record creation explains the top-level id and public holds have a bounded expiry',async t=>{
 const {builtins}=await import('../worker/mcp-tools.mjs');const DB=database(t),env={DB};
 const meta={id:'place',kind:'app',roles:{customer:{signIn:false,can:['read:slots','create:slots']}},surfaces:{phone:'customer'},records:{persist:true,collections:{slots:{fields:{capacity:{type:'number'}}},bookings:{booking:{slots:'slots',item:'ticket'}}}}};
 const cat={games:[meta]},ctx=services(env,cat,'https://place.test',{id:'alice'},'test');
 await assert.rejects(()=>ctx.records({app:'place',collection:'slots',operation:'create',data:{capacity:1}}),/top.level.*id|id.*top.level/);
 await ctx.records({app:'place',collection:'slots',operation:'create',id:'one',data:{capacity:1}});
 const book=builtins(env,cat,'https://place.test').find(t=>t.name==='studio_book');
 await assert.rejects(()=>book.handler({app:'place',collection:'bookings',slot:'one',id:'a',expiresAt:Date.now()+86400000},ctx),/expiry.*15|15.*minutes/i);
});

test('resource capacity remains atomic across simultaneous requests and quantity edits',async t=>{
 const {bookingHolds}=await import('../worker/booking-holds.mjs');const DB=database(t),env={DB};
 DB.sql.exec(`INSERT INTO app_records VALUES('place','resources','one','{"capacity":1}',1,1);INSERT INTO app_records VALUES('place','slots','a','{"capacity":10,"start":"2026-11-01T09:00:00Z","end":"2026-11-01T10:00:00Z","resources":["one"]}',1,1);`);
 const api=bookingHolds(env,{id:'alice'},{games:[{id:'place',kind:'app',records:{collections:{bookings:{booking:{slots:'slots',resources:'resources',item:'ticket'}}}}}]});
 const results=await Promise.allSettled(['a','b'].map(id=>api.hold({app:'place',collection:'bookings',slot:'a',id,expiresAt:Date.now()+60000})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.throws(()=>DB.sql.exec("UPDATE shop_bookings SET quantity=2 WHERE state='held'"),/resource.*release/);
 assert.equal(DB.sql.prepare("SELECT quantity FROM shop_bookings WHERE state='held'").get().quantity,1);
});
