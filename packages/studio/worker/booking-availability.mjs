import {allocateResources} from './booking-resources.mjs';
import {settingsOf,launchOf} from './office.mjs';
import {allowed} from './mcp-tools.mjs';
const fail=message=>Object.assign(new Error(message),{name:'StudioOperationError'});
/** A snapshot, never a reservation. Atomic holds recheck capacity at write time. */
export async function bookingAvailability(env,cat,caller,{app,collection,after='',quantity=1,option,resource,addons}={}) {
 const meta=cat.games.find(g=>g.id===app&&g.kind==='app'),spec=meta?.records?.collections?.[collection]?.booking;
 if(!spec||typeof after!=='string'||after.length>64||!Number.isSafeInteger(quantity)||quantity<1)throw fail('Booking availability unavailable');
 if(!caller.owner){
  if(launchOf(meta,await settingsOf(env,{fresh:true}),env)!=='public')throw fail('Booking availability unavailable');
  let readable=false;
  for(const [role,rule] of Object.entries(meta.roles??{}))if(rule.can?.includes('read:'+spec.slots)&&(!rule.signIn||await allowed({app,role},caller,env)))readable=true;
  if(!readable)throw fail('Booking availability unavailable');
 }
 const scope=caller.testScope?`${app}:check:${caller.testScope}`:app;
 const rows=(await env.DB.prepare(`SELECT s.id,s.value,COALESCE((SELECT SUM(b.quantity) FROM shop_bookings b WHERE b.app=s.app AND b.slots=s.collection AND b.slot=s.id AND b.state IN ('held','confirmed')),0) used FROM app_records s WHERE s.app=?1 AND s.collection=?2 AND s.id>?3 ORDER BY s.id LIMIT 51`).bind(scope,spec.slots,after).all()).results;
 const items=[];
 for(const row of rows.slice(0,50)){
  const slot=JSON.parse(row.value),remaining=slot.capacity-row.used;
  if(!Number.isSafeInteger(remaining)||remaining<quantity)continue;
  const choices=option!==undefined?[option]:[...(!slot.requireOption?[undefined]:[]),...(slot.options??[]).map(o=>o.id)];
  if(choices.length>64)throw fail('Availability supports at most 64 options per slot');
  for(const choice of choices){
   const booking={app,collection,slot:row.id,quantity,...(choice===undefined?{}:{option:choice}),...(resource?{resource}:{}),...(addons?{addons}:{})};
   try{await allocateResources(env,scope,spec,row.id,booking);}catch(error){
    if(/Slot unavailable|Choose a declared option|Choose an option|Unknown add-on|no declared resources|Preferred resource|Resource capacity unavailable|No resource matches/.test(error.message))continue;
    throw error;
   }
   const selected=slot.options?.find(o=>o.id===choice);
   items.push({'@type':'Offer',identifier:JSON.stringify([row.id,choice??null]),...(selected?.name?{name:selected.name}:{}),availability:'https://schema.org/InStock',...(slot.start?{availabilityStarts:slot.start}:{}),...(slot.end?{availabilityEnds:slot.end}:{}),remaining,booking});
  }
 }
 return {convention:'studio.booking-availability/1',bookingTool:'studio_book',items,next:rows.length>50?rows[49].id:null};
}
