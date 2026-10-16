import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from './s2s-fixture.mjs';
import {bookingAvailability} from '../worker/booking-availability.mjs';
import {bookingHolds} from '../worker/booking-holds.mjs';
export const bookingApp={id:'venue',kind:'app',launch:'public',roles:{guest:{can:['read:slots']}},records:{collections:{bookings:{booking:{slots:'slots'}},slots:{}}}};
test('availability lists valid booking arguments and changes after an authoritative hold',async t=>{
 const env={DB:database(t)},cat={games:[bookingApp]},caller={id:'studio:alex',owner:false};
 await env.DB.prepare('INSERT INTO app_records(app,collection,id,value,version,updated_at) VALUES(?1,?2,?3,?4,1,1)').bind('venue','slots','morning',JSON.stringify({capacity:1,start:'2030-10-15T10:00:00Z',end:'2030-10-15T11:00:00Z',requireOption:true,options:[{id:'drive',name:'Scenic drive'}]})).run();
 const before=await bookingAvailability(env,cat,caller,{app:'venue',collection:'bookings'});
 assert.equal(before.items.length,1);assert.equal(before.items[0]['@type'],'Offer');assert.deepEqual(before.items[0].booking,{app:'venue',collection:'bookings',slot:'morning',option:'drive',quantity:1});
 await bookingHolds(env,caller,cat).hold({...before.items[0].booking,id:'alex-drive',expiresAt:Date.now()+60000});
 assert.equal((await bookingAvailability(env,cat,caller,{app:'venue',collection:'bookings'})).items.length,0);
 await assert.rejects(()=>bookingAvailability(env,{games:[{...bookingApp,launch:'private'}]},caller,{app:'venue',collection:'bookings'}),/unavailable/);
});
test('availability query count stays constant across slots and options',async t=>{
 const DB=database(t),app=structuredClone(bookingApp);app.records.collections.bookings.booking.resources='resources';
 for(let i=0;i<50;i++)await DB.prepare('INSERT INTO app_records(app,collection,id,value,version,updated_at) VALUES(?1,?2,?3,?4,1,1)').bind('venue','slots',String(i).padStart(2,'0'),JSON.stringify({capacity:10,start:'2030-10-15T10:00:00Z',end:'2030-10-15T11:00:00Z',requireOption:true,options:Array.from({length:64},(_,n)=>({id:'o'+n,components:[{resources:['room']}]}))})).run();
 await DB.prepare('INSERT INTO app_records(app,collection,id,value,version,updated_at) VALUES(?1,?2,?3,?4,1,1)').bind('venue','resources','room',JSON.stringify({capacity:10})).run();
 let queries=0;const counted={prepare:q=>{queries++;return DB.prepare(q);}};
 const page=await bookingAvailability({DB:counted},{games:[app]},{owner:true},{app:'venue',collection:'bookings'});
 assert.equal(page.items.length,3200);assert.ok(queries<=3,`page used ${queries} queries`);
});
