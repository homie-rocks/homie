/** Shared by trusted booking tools and phone flows. Aliases never silently win. */
export function normalizeBookingArgs(input) {
 const args={...input};
 for(const [canonical,aliases] of [['slot',['time']],['resource',['preferredResource','preferred_resource']],['addons',['addOns','add-ons']]]) {
  for(const alias of aliases)if(args[alias]!==undefined) {
   if(args[canonical]!==undefined&&JSON.stringify(args[canonical])!==JSON.stringify(args[alias]))throw Object.assign(new Error(`conflicting ${canonical}/${alias}`),{name:'StudioOperationError',status:400});
   args[canonical]=args[alias];delete args[alias];
  }
 }
 if(args.addons!==undefined) {
  const list=Array.isArray(args.addons)?args.addons.map(id=>[id,1]):Object.entries(args.addons??{}),addons={};
  for(const [id,count] of list) {
   if(!/^[a-z][a-z0-9-]{0,39}$/.test(id)||!Number.isSafeInteger(count)||count<1||count>100)throw new Error('Invalid add-on id or quantity');
   addons[id]=(addons[id]??0)+count;
  }
  args.addons=Object.fromEntries(Object.entries(addons).sort(([a],[b])=>a.localeCompare(b)));
 }
 return args;
}

const text={type:'string',maxLength:64};
const addons={oneOf:[{type:'array',maxItems:100,items:text},{type:'object',additionalProperties:{type:'integer',minimum:1,maximum:100}}]};
export const bookingInputSchema={type:'object',properties:{app:text,collection:text,slot:text,time:text,option:text,resource:text,preferredResource:text,preferred_resource:text,addons,addOns:addons,'add-ons':addons,quantity:{type:'integer',minimum:1},id:{type:'string',pattern:'^[A-Za-z0-9_-]{1,64}$',description:'Optional idempotency key (deprecated name): a retry with the same key and token returns the same hold. It is not the hold id; use data.id.'},token:{type:'string',pattern:'^[a-f0-9]{32,128}$'},expiresAt:{type:'integer'}},required:['app','collection','expiresAt'],additionalProperties:false};
