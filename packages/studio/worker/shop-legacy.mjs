/** Read-only compatibility for persisted 0.53 intents; never creates Payment Links.
 * Sessions and invoices must already have been retrieved with the Worker credential. */
import {orderById,orderBySession,orderLines,grantStatements} from './shop-store.mjs';
import {bookingStatement} from './booking-store.mjs';
import {syncRefunds} from './shop.mjs';
const sha256Hex=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
/** Payment Links can be reopened. Each signed Session becomes its own order; the URL reference
 * selects a frozen local intent, never an entitlement or a buyer-supplied price. */
export async function bindLinkSession(env, session, mode) {
  if (!/^ord_[A-Za-z0-9]{20}$/.test(session.client_reference_id ?? '') || !/^cs_[A-Za-z0-9_]+$/.test(session.id ?? '')) return false;
  const source = await orderById(env, session.client_reference_id);
  if (!source || source.mode !== mode) return false;
  const lines = await orderLines(env, source.id);
  if (!lines.length || !lines[0].snapshot) return false;
  if(JSON.parse(lines[0].snapshot).paymentLink?.basket) return bindBasketSession(env,session,source,lines);
  if(JSON.parse(lines[0].snapshot).paymentLink?.items) {
    const saved=await env.DB.prepare('SELECT value FROM meta WHERE key=?1').bind(`shop-menu:${source.id}`).first();
    const original=saved?JSON.parse(saved.value).map(l=>({item:l.item.id,snapshot:JSON.stringify(l.item),unit_amount:l.amount})):lines;
    return bindMenuSession(env,session,source,original);
  }
  const item = JSON.parse(lines[0].snapshot), link = item.paymentLink;
  if (!link || (session.payment_link?.id ?? session.payment_link) !== link.id || session.metadata?.revision !== link.revision || session.currency !== source.currency) return false;
  const amount = session.amount_subtotal;
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  if(item.kind==='deposit' && amount!==source.amount)return false;
  const quantity = item.price === 'choose' ? 1 : amount / item.price;
  if(['supporter','deposit'].includes(item.kind) && quantity!==1)return false;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999999) return false;
  if (item.price === 'choose' && (amount < item.min || item.max !== null && amount > item.max)) return false;
  // Claim the first session atomically. A repeated URL creates a separate paid order, never loses a payment.
  await env.DB.prepare('UPDATE shop_orders SET session = ?2 WHERE id = ?1 AND session IS NULL').bind(source.id, session.id).run();
  let order = await orderBySession(env, session.id);
  if (!order) {
    const id = `ord_${(await sha256Hex(session.id)).slice(0, 20)}`;
    const booking=link.slot ? await env.DB.prepare('SELECT * FROM shop_bookings WHERE order_id=?1').bind(source.id).first() : null;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO shop_orders (id, player, checkout_player, item, game, amount, currency, till, mode, status, parent, created_at, updated_at, session) SELECT ?2, player, checkout_player, item, game, ?4, currency, till, mode, 'started', parent, ?5, ?5, ?3 FROM shop_orders WHERE id = ?1 ON CONFLICT DO NOTHING").bind(source.id, id, session.id, amount, Date.now()),
      env.DB.prepare("INSERT OR IGNORE INTO meta(key,value) SELECT ?1,CASE WHEN value=?3 THEN ?4 ELSE value END FROM meta WHERE key=?2").bind(`shop-reference:${id}`, `shop-reference:${source.id}`,source.id,id),
      env.DB.prepare('INSERT INTO shop_order_lines (id, order_id, position, item, quantity, unit_amount, amount, snapshot) VALUES (?1, ?2, 0, ?3, ?4, ?5, ?6, ?7) ON CONFLICT DO NOTHING').bind(`${id}_0`, id, item.id, quantity, amount / quantity, amount, lines[0].snapshot),
      ...(booking ? [bookingStatement(env,{...booking,slot:link.slot,slots:link.slots,id,order:id,pending:true})] : []),
    ]);
    order = await orderBySession(env, session.id);

  }
  if (!order) return false;
  if (order.paid_at === null) await env.DB.batch([
    env.DB.prepare('UPDATE shop_orders SET amount = ?2 WHERE id = ?1 AND paid_at IS NULL').bind(order.id, amount),
    env.DB.prepare('UPDATE shop_order_lines SET quantity = ?2, unit_amount = ?3, amount = ?4 WHERE order_id = ?1 AND EXISTS (SELECT 1 FROM shop_orders WHERE id = ?1 AND paid_at IS NULL)').bind(order.id, quantity, amount / quantity, amount),
  ]);
  return true;
}

/** A saved basket is immutable. A reopened link buys that same basket again. */
async function bindBasketSession(env,session,source,lines) {
  const link=JSON.parse(lines[0].snapshot).paymentLink;
  if((session.payment_link?.id??session.payment_link)!==link.id || session.metadata?.revision!==link.revision || session.currency!==source.currency)return false;
  if(session.payment_status!=='paid' || !Number.isSafeInteger(session.amount_total) || session.amount_total<=0 || session.amount_subtotal!==session.amount_total)return false;
  await env.DB.prepare('UPDATE shop_orders SET session=?2 WHERE id=?1 AND session IS NULL').bind(source.id,session.id).run();
  let order=await orderBySession(env,session.id);
  if(!order) {
    const id=`ord_${(await sha256Hex(session.id)).slice(0,20)}`;
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO shop_orders(id,player,checkout_player,item,game,amount,currency,till,mode,status,parent,created_at,updated_at,session) SELECT ?2,player,checkout_player,item,game,amount,currency,till,mode,'started',parent,?4,?4,?3 FROM shop_orders WHERE id=?1").bind(source.id,id,session.id,Date.now()),
      env.DB.prepare('INSERT OR IGNORE INTO meta(key,value) SELECT ?1,value FROM meta WHERE key=?2').bind(`shop-reference:${id}`,`shop-reference:${source.id}`),
      ...lines.map((l,i)=>env.DB.prepare('INSERT OR IGNORE INTO shop_order_lines(id,order_id,position,item,quantity,unit_amount,amount,snapshot) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)').bind(`${id}_${i}`,id,i,l.item,l.quantity,l.unit_amount,l.amount,l.snapshot)),
    ]);
    order=await orderBySession(env,session.id);
  }
  return Boolean(order);
}

// Keep the actual payment in financial totals and the ordered amounts in lines.
// Aggregate refunds are allocated proportionally; they do not change quantities.
export async function paidBasket(env,shop,o,lines,session,paidAt) {
  const total=session.amount_total;
  if(session.payment_status!=='paid' || session.currency!==o.currency || !Number.isSafeInteger(total) || total<=0 || session.amount_subtotal!==total)return 'mismatch';
  if(o.paid_at!==null)return 'already';
  const expected=lines.reduce((n,l)=>n+Number(l.amount),0);
  if(!Number.isSafeInteger(expected)||expected<=0)return 'mismatch';
  const writes=[];let cumulative=0,allocated=0;
  for(const l of lines) {
    cumulative+=Number(l.amount);
    const next=Number(BigInt(total)*BigInt(cumulative)/BigInt(expected));
    const gross=next-allocated;allocated=next;
    if(total>=expected && o.player)writes.push(...grantStatements(env,o,JSON.parse(l.snapshot),paidAt,l));
    writes.push(env.DB.prepare("UPDATE shop_order_lines SET status='paid',total=?2 WHERE id=?1 AND EXISTS(SELECT 1 FROM shop_orders WHERE id=?3 AND paid_at IS NULL)").bind(l.id,gross,o.id));
  }
  const payment=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
  writes.push(env.DB.prepare("UPDATE shop_orders SET status='paid',amount=?2,total=?2,tax=0,payment=?3,paid_at=?4,updated_at=?4,attention=0,note=?5 WHERE id=?1 AND paid_at IS NULL").bind(o.id,total,payment??null,paidAt,total<expected?'Settle the difference at the bar':''));
  // Enrich the trigger's durable event in this same transaction, before dispatch.
  writes.push(env.DB.prepare("UPDATE studio_events SET data=json_set(data,'$.basketTotal',?2,'$.settlement',?3) WHERE id=?1").bind(`shop_orders:${o.id}:paid`,expected,total<expected?'short':'paid'));
  const result=await env.DB.batch(writes);
  if(payment)await syncRefunds(env,payment);
  return result.at(-2)?.meta?.changes?'paid':'already';
}

/** Menu totals are never decoded into quantities. Only signed invoice lines are authoritative. */
async function bindMenuSession(env,session,source,lines) {
  const first=JSON.parse(lines[0].snapshot),link=first.paymentLink;
  if((session.payment_link?.id??session.payment_link)!==link.id || session.metadata?.revision!==link.revision || session.currency!==source.currency)return false;
  if(!['paid','no_payment_required'].includes(session.payment_status))return false;
  const invoiceId=typeof session.invoice==='string'?session.invoice:session.invoice?.id;
  const saved=await env.DB.prepare('SELECT value FROM meta WHERE key=?1').bind(`shop-invoice:${invoiceId}`).first();
  if(!saved)throw new Error('Waiting for signed paid invoice');
  const invoice=JSON.parse(saved.value);
  if(invoice.livemode!==(source.mode==='live') || invoice.currency!==source.currency || invoice.total!==session.amount_total || invoice.lines?.has_more)throw new Error('Incomplete or mismatched signed invoice');
  const paidLines=[];
  for(const l of invoice.lines?.data??[]) {
    const line=lines.find(x=>JSON.parse(x.snapshot).stripePrice===(l.price?.id??l.pricing?.price_details?.price));
    if(!line || !Number.isSafeInteger(l.quantity) || l.quantity<1 || l.amount!==JSON.parse(line.snapshot).price*l.quantity)throw new Error('Unknown invoice line');
    paidLines.push({...line,quantity:l.quantity,amount:l.amount});
  }
  if(!paidLines.length || paidLines.reduce((n,l)=>n+l.amount,0)!==session.amount_subtotal)throw new Error('Invoice subtotal mismatch');
  await env.DB.prepare('UPDATE shop_orders SET session=?2 WHERE id=?1 AND session IS NULL').bind(source.id,session.id).run();
  let order=await orderBySession(env,session.id);
  if(!order) {
    const id=`ord_${(await sha256Hex(session.id)).slice(0,20)}`;
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO shop_orders(id,player,checkout_player,item,game,amount,currency,till,mode,status,parent,created_at,updated_at,session) SELECT ?2,player,checkout_player,item,game,?4,currency,till,mode,'started',parent,?5,?5,?3 FROM shop_orders WHERE id=?1").bind(source.id,id,session.id,session.amount_subtotal,Date.now()),
      env.DB.prepare('INSERT OR IGNORE INTO meta(key,value) SELECT ?1,value FROM meta WHERE key=?2').bind(`shop-reference:${id}`,`shop-reference:${source.id}`),
    ]);order=await orderBySession(env,session.id);
  }
  if(order.paid_at===null)await env.DB.batch([
    env.DB.prepare('DELETE FROM shop_order_lines WHERE order_id=?1 AND EXISTS(SELECT 1 FROM shop_orders WHERE id=?1 AND paid_at IS NULL)').bind(order.id),
    ...paidLines.map((l,i)=>env.DB.prepare('INSERT INTO shop_order_lines(id,order_id,position,item,quantity,unit_amount,amount,snapshot) SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE EXISTS(SELECT 1 FROM shop_orders WHERE id=?2 AND paid_at IS NULL) ON CONFLICT DO NOTHING').bind(`${order.id}_${i}`,order.id,i,l.item,l.quantity,l.unit_amount,l.amount,l.snapshot)),
    env.DB.prepare('UPDATE shop_orders SET amount=?2 WHERE id=?1 AND paid_at IS NULL').bind(order.id,session.amount_subtotal),
  ]);
  return true;
}

