import {BOOKINGS_MIGRATION} from './booking-store.mjs';
import {linkConfig,hasStripeKey} from './shop-links.mjs';
export const BOOKING_HOLDS_MIGRATION_FILE='0029_booking_holds.sql';
export const BOOKING_HOLDS_MIGRATION=`
ALTER TABLE shop_bookings ADD COLUMN paid_at INTEGER;
ALTER TABLE shop_bookings ADD COLUMN actor TEXT;
ALTER TABLE shop_bookings ADD COLUMN token_hash TEXT;
ALTER TABLE shop_bookings ADD COLUMN hold_until INTEGER;
DROP TRIGGER booking_capacity_move;
CREATE TRIGGER booking_capacity_move BEFORE UPDATE OF slot,quantity,state ON shop_bookings
WHEN NEW.state IN ('held','confirmed') BEGIN
 SELECT RAISE(ABORT,'booking capacity unavailable') WHERE NOT EXISTS (
 SELECT 1 FROM app_records s WHERE s.app=NEW.app AND s.collection=NEW.slots AND s.id=NEW.slot
 AND json_type(s.value,'$.capacity')='integer' AND json_extract(s.value,'$.capacity') >= NEW.quantity +
 (SELECT COALESCE(SUM(quantity),0) FROM shop_bookings WHERE app=NEW.app AND slots=NEW.slots AND slot=NEW.slot AND id!=NEW.id AND state IN ('held','confirmed')));
END;
CREATE TRIGGER booking_hold_claim BEFORE UPDATE OF order_id ON shop_bookings BEGIN
 SELECT RAISE(ABORT,'booking hold changed or expired') WHERE NEW.order_id IS NULL OR OLD.order_id!='hold:'||OLD.id OR OLD.state NOT IN ('held','confirmed') OR (OLD.state='held' AND OLD.hold_until<=NEW.updated_at);
END;
DROP TRIGGER booking_order_state;
CREATE TRIGGER booking_order_state AFTER UPDATE OF status,paid_at ON shop_orders
WHEN NEW.status!=OLD.status OR (OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL) BEGIN
 UPDATE shop_bookings SET state=CASE WHEN NEW.status='paid' THEN 'confirmed' ELSE 'released' END,
 paid_at=COALESCE(NEW.paid_at,paid_at),version=version+1,updated_at=NEW.updated_at
 WHERE order_id=NEW.id AND ((state IN ('pending','held','confirmed') AND NEW.status='paid')
 OR (state IN ('pending','held') AND NEW.status IN ('expired','failed'))
 OR (state IN ('pending','held','confirmed') AND NEW.status IN ('refunded','lost')));
END;
${['insert','update'].map(op=>{
 const trigger=BOOKINGS_MIGRATION.match(new RegExp('CREATE TRIGGER booking_record_'+op+'[\\s\\S]*?END;'))[0];
 return 'DROP TRIGGER booking_record_'+op+';\n'+trigger.replace("'state',NEW.state)","'state',NEW.state,'paid',json(CASE WHEN NEW.paid_at IS NULL THEN 'false' ELSE 'true' END))");
}).join('\n')}
UPDATE shop_bookings SET paid_at=(SELECT paid_at FROM shop_orders WHERE id=order_id),version=version+1 WHERE EXISTS(SELECT 1 FROM shop_orders WHERE id=order_id AND paid_at IS NOT NULL);
`;
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(v);
const hash=async token=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
export async function ownedHold(env,caller,{id,token}){
 if(!valid(id))throw new Error('Invalid booking id');
 const row=await env.DB.prepare('SELECT * FROM shop_bookings WHERE id=?1').bind(id).first();
 if(!row||!(caller.owner||row.actor&&row.actor===caller.id||row.token_hash&&typeof token==='string'&&await hash(token)===row.token_hash))throw new Error('Booking owner required');
 if(caller.testScope&&!row.app.endsWith(':check:'+caller.testScope))throw new Error('Booking owner required');
 return row;
}
/** A hold is the very row checkout later confirms. Secrets never enter its public projection. */
export function bookingHolds(env,caller,cat){
 const result=r=>({id:r.id,slot:r.slot,quantity:r.quantity,state:r.state,version:r.version,expiresAt:r.hold_until,paid:r.paid_at!==null});
 const change=async(args,state)=>{
  const row=await ownedHold(env,caller,args);
  if(row.order_id!=='hold:'+row.id)throw new Error('Checkout owns this booking; reconcile payment before release');
  if(!Number.isSafeInteger(args.version)||args.version<1)throw new Error('Booking version required');
  const changed=await env.DB.prepare(`UPDATE shop_bookings SET state=?2,version=version+1,updated_at=?3 WHERE id=?1 AND version=?4 AND state IN ('held','confirmed') AND (?2='released' OR hold_until>?3) RETURNING *`).bind(row.id,state,Date.now(),args.version).first();
  if(!changed)throw new Error('Booking changed or expired; reload');return result(changed);
 };
 return Object.freeze({
  async hold({app,collection,slot,quantity=1,id,token,expiresAt}){
   const meta=cat.games.find(g=>g.id===app&&g.kind==='app'),spec=meta?.records?.collections?.[collection]?.booking;
   if(!spec||!valid(id)||!valid(slot)||!Number.isSafeInteger(quantity)||quantity<1)throw new Error('Choose a declared slot, positive quantity and stable booking id');
   if(!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now())throw new Error('Hold needs a future expiry');
   if(!caller.id&&!(typeof token==='string'&&/^[a-f0-9]{32,128}$/.test(token)))throw new Error('Booking owner or private token required');
   if(!hasStripeKey(env)&&linkConfig(env)?.slots?.some(l=>l.app===app&&l.slots===spec.slots&&l.slot===slot))throw new Error('Keyless Stripe inventory cannot share local holds; configure session checkout first');
   const scope=caller.testScope?`${app}:check:${caller.testScope}`:app;
   id=await hash(JSON.stringify([scope,collection,id]));
   const secret=token?await hash(token):null;
   await env.DB.prepare(`INSERT INTO shop_bookings(id,app,collection,slots,slot,quantity,order_id,state,updated_at,actor,token_hash,hold_until)
    SELECT ?1,?2,?3,?4,?5,?6,'hold:'||?1,'held',?7,?8,?9,?10 WHERE NOT EXISTS(SELECT 1 FROM shop_bookings WHERE id=?1)`).bind(id,scope,collection,spec.slots,slot,quantity,Date.now(),caller.id??null,secret,expiresAt).run();
   const row=await ownedHold(env,caller,{id,token});
   if(row.app!==scope||row.collection!==collection||row.slot!==slot||row.quantity!==quantity||row.hold_until!==expiresAt)throw new Error('Booking id reused with different request');
   return result(row);
  },
  async get(args){return result(await ownedHold(env,caller,args));},
  confirm:args=>change(args,'confirmed'),release:args=>change(args,'released'),
  async releaseExpired({app,collection,now=Date.now()}){
   if(!caller.owner)throw new Error('Owner or scheduled function required');
   if(!Number.isSafeInteger(now))throw new Error('Invalid release time');
   const scope=caller.testScope?`${app}:check:${caller.testScope}`:app;
   const r=await env.DB.prepare("UPDATE shop_bookings SET state='released',version=version+1,updated_at=?3 WHERE app=?1 AND collection=?2 AND order_id='hold:'||id AND state='held' AND hold_until<=?3").bind(scope,collection,now).run();return {released:r.meta.changes};
  }
 });
}
/** Used in the same transaction as the order reservation. A second checkout cannot claim the hold. */
export function claimHoldStatement(env,{hold,app,collection,slots,slot,quantity,order,now=Date.now()}){
 return env.DB.prepare(`UPDATE shop_bookings SET order_id=CASE WHEN app=?4 AND collection=?5 AND slots=?6 AND slot=?7 AND quantity=?8 THEN ?2 ELSE NULL END,version=version+1,updated_at=?3
 WHERE id=?1
 AND EXISTS(SELECT 1 FROM shop_orders WHERE id=?2)`).bind(hold,order,now,app,collection,slots,slot,quantity);
}
