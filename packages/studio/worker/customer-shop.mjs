import {amountError} from './shop-rules.mjs';
import {shopOf,shopRoutes,paid} from './shop.mjs';
import {players} from './players.mjs';
import {withToolIdentity} from './tool-identity.mjs';
import {customerOffer,serviceTerms} from './customer-resources.mjs';
import {byId} from './purchase-store.mjs';
import {orderById} from './shop-store.mjs';
/** Reuse web-shop policy evaluation before creating an immutable cart offer. */
export async function quoteCart(env,cat,origin,caller,input,request) {
  const shop=shopOf(cat);if(!shop)throw new Error('Shop unavailable');
  const lines=[];let amount=0;
  for(const line of input.lines??[]) {
    const url=new URL('/api/shop',origin);url.searchParams.set('item',line.item);
    const request=withToolIdentity(new Request(url),caller);
    const response=await shopRoutes(request,env,{},url,{catalogueOf:async()=>cat});
    const view=await response.json(),item=shop.items.find(i=>i.id===line.item),shown=view.items?.find(i=>i.id===line.item);
    if(!item||!shown||shown.way!=='checkout')throw new Error('Item unavailable under the studio shop policy');
    const quantity=line.quantity??1,unit=item.price==='choose'?line.amount:item.price;
    if(!Number.isSafeInteger(quantity)||quantity<1||amountError(unit,shop.currency)||item.price==='choose'&&(unit<item.min||item.max!==null&&unit>item.max))throw new Error('Invalid cart amount or quantity');
    if(!shop.policy.repeatPurchases&&(quantity>1||lines.some(l=>l.item.id===item.id)))throw new Error('Studio disabled repeat purchases');
    amount+=unit*quantity;if(!Number.isSafeInteger(amount))throw new Error('Cart total exceeds safe integer arithmetic');
    lines.push({item,quantity,amount:unit});
  }
  if(!lines.length)throw new Error('Cart is empty');
  // An opted-in monthly cap is reserved by the normal web checkout; machine carts use that path until a reservation is available.
  if(shop.capPerPlayerMonth!==null)throw new Error('This studio uses a spending allowance; use studio_checkout');
  let session;
  if (!caller.id) {
    if (!request) throw new Error('A buyer request is required before payment');
    const guest = await players.shopGuest(request,env,new URL(origin),shop.guestBuyersPerAddressPerHour);
    if (guest.error) throw new Error('Guest account unavailable; no payment was taken');
    session = guest.session;
    caller = {...caller,id:session.player.id};
  }
  const quote = await customerOffer(env,'cart',{name:lines.map(l=>`${l.item.name} × ${l.quantity}`).join(', '),lines,player:caller.id??null,shop, sale:serviceTerms({scope:'cart',amount,currency:shop.currency,automaticTax:shop.automaticTax===true,taxBehavior:shop.taxBehavior,refundWindowDays:shop.refundDays,refund:Number.isFinite(shop.refundDays)?`Studio refund window: ${shop.refundDays} days.`:undefined})});
  return {...quote,...(session?{account:{player:session.player,cookies:session.cookies}}:{})};
}
export async function fulfillCart(env,origin,order) {
  const manifest=JSON.parse(order.manifest),shop=manifest.shop;
  let existing=await orderById(env,order.id);
  if(existing&&['refunded','lost'].includes(existing.status))throw new Error('Cart refunded');
  if(!existing) {
    const player=manifest.player;
    if(!player)throw new Error('Cart has no pre-payment account');
    const session='cs_machine_'+order.id;
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO shop_orders(id,player,item,amount,currency,till,mode,status,session,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'started',?8,?9,?9)`).bind(order.id,player,manifest.lines[0].item.id,order.amount,order.currency,order.till,order.mode,session,order.created_at),
      ...manifest.lines.map((l,i)=>env.DB.prepare(`INSERT OR IGNORE INTO shop_order_lines(id,order_id,position,item,quantity,unit_amount,amount,snapshot) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`).bind(order.id+'_'+i,order.id,i,l.item.id,l.quantity,l.amount,l.quantity*l.amount,JSON.stringify(l.item))),
    ]);
    existing=await orderById(env,order.id);
  }
  const current=await byId(env,order.id);if(!['paid','fulfilled','disputed'].includes(current.status))throw new Error('Cart payment unavailable');
  await paid(env,shop,{id:existing.session,metadata:{order:order.id},currency:order.currency,amount_subtotal:order.amount,amount_total:order.total??order.amount,payment_intent:{id:order.payment}},order.paid_at);
}
