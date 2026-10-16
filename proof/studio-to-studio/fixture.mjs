// Throwaway proof studios only. No credentials are embedded in the generated source.
export const app={id:'venue',kind:'app',launch:'public',roles:{guest:{can:['read:slots']}},records:{collections:{bookings:{booking:{slots:'slots'}},slots:{fields:{capacity:{type:'number'},start:{type:'string'},end:{type:'string'}}}}}};
export const feeds={arrivals:{event:'guest.arriving',audience:'owner',schema:{type:'object',properties:{sender:{type:'object',properties:{origin:{type:'string'},verified:{const:true}},required:['origin','verified'],additionalProperties:false},data:{type:'object',properties:{booking:{type:'string'},minutes:{type:'integer'}},required:['booking','minutes'],additionalProperties:false}},required:['sender','data'],additionalProperties:false}}};
export function fixtureSource(role){return `
import {remoteMcp} from './worker/mcp.mjs';
import {useFunctions,runFunctions} from './worker/functions.mjs';
const app=${JSON.stringify(app)};
const feeds=${JSON.stringify(feeds)};
${role==='b'?`useFunctions(async()=>[{name:'arrival',event:'guest.arriving',handler:(event,ctx)=>ctx.database.put('arrival',event.data)}]);`:''}
export default {async fetch(request,env,ctx){
 if(env.PROOF_SECRET&&request.headers.get('x-proof-key')!==env.PROOF_SECRET)return new Response(null,{status:403});
 const origin=new URL(request.url).origin;
 const denied=await env.DB.prepare("SELECT value FROM meta WHERE key='proof-denied'").first();
 const cat={studio:{name:'Throwaway ${role}',mcp:{studios:${role==='b'?`{inbound:{concierge:{origin:env.PEER,secret:'PEER_SECRET',tools:['studio_availability','venue_book'],enabled:!denied,webhookSecret:'EVENT_SECRET',events:{arrival:'arrivals'}}}}`:`{outbound:{[env.PEER]:{clientId:'concierge',secret:'PEER_SECRET',tools:['drive'],eventSecret:'EVENT_SECRET',eventPath:'/hooks/studios/concierge',events:['arrival']}}}`}}},games:${role==='b'?'[app]':'[]'}};
 const bindings={...env,${role==='b'?`STUDIO_EVENT_FEEDS:JSON.stringify(feeds),`:''}ASSETS:{fetch:async()=>Response.json(cat)}};
 const definitions=${role==='b'?`[{name:'venue_book',description:'Book a venue visit',audience:'public',inputSchema:{type:'object',additionalProperties:true},handler:async(args,context)=>({booking:await context.bookings.hold(args),caller:context.caller})}]`:`[{name:'drive',description:'Plan a drive and book a visit',audience:'public',inputSchema:{type:'object',properties:{},additionalProperties:false},handler:async(args,context)=>{
 const listed=await context.studios.listTools(env.PEER);
 const availability=await context.studios.call(env.PEER,'studio_availability',{app:'venue',collection:'bookings'});
 if(availability.isError||!availability.data.items.length)throw new Error('No availability');
 const booked=await context.studios.call(env.PEER,'venue_book',{...availability.data.items[0].booking,id:'alex-drive',expiresAt:Date.now()+600000},{actingFor:'Alex'});
 if(booked.isError)throw new Error(JSON.stringify(booked));
 const arrival=await context.studios.send(env.PEER,'arrival',{id:'alex-arrival',data:{booking:booked.data.booking.id,minutes:10}});
 return {tools:listed.tools.map(t=>t.name),availability:availability.data,booked:booked.data,arrival};
 }}]`};
 return remoteMcp(request,bindings,ctx,{catalogueOf:async()=>cat,definitions});
}};`;}
