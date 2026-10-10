import { hasStripeKey, shopMode, rememberMoneyEvent, rememberedMoney } from './shop-links.mjs';
import { paymentRefunds } from './shop-refunds.mjs';
import { orderFact, bindHostedSession } from './purchase-core.mjs';
/** Resource purchases share the studio's Stripe webhook and refund office. */
import { recordOrderState } from "./purchase-core.mjs";

import {
  cancelSubscription,
  refundPayment,
  retrieveCheckoutSession,
  stripeCall,
  modeOf,
} from "./stripe.mjs";

import {
  byId,
  idOf,
  termsOf,
  purchasedResource,
  active,
} from "./purchase-store.mjs";
export async function reconcilePurchaseSession(env, session) {
  if (
    !session.metadata?.order ||
    !(await env.DB.prepare(
      "SELECT 1 FROM purchase_orders WHERE id = ?1",
    )
      .bind(session.metadata.order)
      .first())
  )
    return false;
  const o = session.metadata?.order
    ? await byId(env, session.metadata.order)
    : null;
  if (!o) return false;
  if (o.session && o.session !== session.id)
    throw new Error("Purchase checkout session mismatch");
  if (
    session.metadata?.homie !== "purchase-v1" ||
    session.client_reference_id !== (o.checkout_buyer ?? o.buyer) ||
    session.currency !== o.currency ||
    Number(session.amount_subtotal) !== Number(o.amount) ||
    session.livemode !== (o.mode === "live")
  )
    throw new Error("Purchase checkout terms mismatch");
  if (!["paid", "no_payment_required"].includes(session.payment_status))
    return true;
  const payment = idOf(session.payment_intent);
  const subscription = idOf(session.subscription);
  const recurring = termsOf(o).billing !== "one-time";
  if (
    recurring !== Boolean(subscription) ||
    (!recurring && !payment && Number(session.amount_total) !== 0)
  )
    throw new Error("Purchase payment kind mismatch");
  const writes = [
    orderFact(env, o.id, 'details', {customer: idOf(session.customer) ?? null, subscription: subscription ?? null}),
  ];
  if (!recurring) {
    writes.push(
      orderFact(env, o.id, 'payment', {session: session.id, payment: payment ?? null, tax: session.total_details?.amount_tax ?? 0, total: session.amount_total, paid_at: Date.now()}),
    );
    if (payment)
      writes.push(
        env.DB.prepare(
          "INSERT INTO purchase_payments (payment, order_id) VALUES (?1, ?2) ON CONFLICT(payment) DO NOTHING",
        ).bind(payment, o.id),
      );
  }
  await env.DB.batch(writes);
  if (recurring) {
    await reconcileSubscription(env, { ...o, subscription });
    if (
      await env.DB.prepare("SELECT 1 FROM resource_retirements WHERE resource = ?1")
        .bind(`${o.mode}:${o.resource_kind}:${JSON.parse(o.manifest).id}`)
        .first()
    )
      await cancelSubscription(env, subscription);
  }
  return true;
}

export async function reconcileSubscription(env, o) {
  const sub = await stripeCall(
    env,
    "GET",
    `/v1/subscriptions/${encodeURIComponent(o.subscription)}`,
    { expand: ["latest_invoice"] },
  );
  if (
    sub.metadata?.order !== o.id ||
    Boolean(sub.livemode) !== (o.mode === "live")
  )
    throw new Error("Subscription mismatch");
  let invoice = sub.latest_invoice;
  if (typeof invoice === "string")
    invoice = await stripeCall(
      env,
      "GET",
      `/v1/invoices/${encodeURIComponent(invoice)}`,
    );
  if (!["active", "canceled", "past_due"].includes(sub.status)) {
    await orderFact(env, o.id, 'lapsed', {paid_until: 0})
      .run();

    return;
  }
  // A proration is an adjustment, never a replacement for the base paid period.
  // When renewal is pending, find the previous paid base invoice in Stripe, not a local flag.
  const pending = ["draft", "open"].includes(invoice?.status);
  const grace =
    sub.status === "active" && pending
      ? (termsOf(o).renewalGraceMinutes ?? 0) * 60000
      : 0;
  if (
    invoice?.status !== "paid" ||
    invoice?.billing_reason === "subscription_update" ||
    invoice?.lines?.data?.every(
      (l) =>
        l.parent?.subscription_item_details?.proration === true ||
        l.proration === true,
    )
  ) {
    let cursor;
    for (;;) {
      const page = await stripeCall(env, "GET", "/v1/invoices", {
        subscription: sub.id,
        limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
      });
      const base = page.data?.find(
        (i) =>
          i.status === "paid" &&
          ["subscription_create", "subscription_cycle"].includes(
            i.billing_reason,
          ),
      );
      if (base) {
        invoice = base;
        break;
      }
      if (!page.has_more || !page.data?.length) {
        invoice = null;
        break;
      }
      cursor = page.data.at(-1).id;
    }
  }
  if (!invoice) {
    await orderFact(env, o.id, 'lapsed', {paid_until: 0})
      .run();

    return;
  }
  const p = purchasedResource(o);
  const line =
    invoice.lines?.data?.find(
      (l) =>
        (l.parent?.subscription_item_details?.subscription ||
          l.subscription) === sub.id,
    ) ?? invoice.lines?.data?.[0];
  if (!line?.period?.end || invoice.currency !== o.currency)
    throw new Error("Subscription invoice period or currency mismatch");
  const quantity = sub.items?.data?.[0]?.quantity;
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1
  ) {
    await orderFact(env, o.id, 'lapsed', {paid_until: 0})
      .run();

    return;
  }
  const until = line.period.end * 1000;
  const payments = { data: [] };
  let cursor;
  for (;;) {
    const page = await stripeCall(env, "GET", "/v1/invoice_payments", {
      invoice: invoice.id,
      limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    payments.data.push(...(page.data ?? []));
    if (!page.has_more || !page.data?.length) break;
    cursor = page.data.at(-1).id;
  }
  await orderFact(env, o.id, 'details', {payment: null}, {renewal:true})
    .run();
  let usable =
    invoice.status === "paid" && Number(invoice.amount_remaining ?? 0) === 0;
  let disputed = false;
  let revoked = null;
  for (const pay of payments.data ?? []) {
    const payment = idOf(pay.payment?.payment_intent);
    if (!payment || pay.status !== "paid") continue;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO purchase_payments (payment, order_id, invoice) VALUES (?1, ?2, ?3) ON CONFLICT(payment) DO NOTHING",
      ).bind(payment, o.id, invoice.id),
      env.DB.prepare(
        "INSERT INTO purchase_payment_facts (payment, invoice, order_id, period_end) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(payment, invoice) DO UPDATE SET period_end = excluded.period_end",
      ).bind(payment, invoice.id, o.id, until),
      orderFact(env, o.id, 'details', {payment: payment}, {renewal:true}),
    ]);
    const pi = await stripeCall(
      env,
      "GET",
      `/v1/payment_intents/${encodeURIComponent(payment)}`,
      { expand: ["latest_charge"] },
    );
    const charge = pi.latest_charge;
    if (charge && typeof charge === "object") {
      const refunds = await paymentRefunds(env,payment,o);
      const refunded = [...refunds.values()].filter(r=>r.status === 'succeeded').reduce((n,r)=>n+r.amount,0);
      let current = refunded > 0 && refunded >= Number(charge.amount ?? invoice.total) ? 'refunded' : 'paid';
      let dispute = null;
      if (charge.disputed) {
        const disputes = await stripeCall(env, "GET", "/v1/disputes", {
          payment_intent: payment,
          limit: 1,
        });
        dispute = disputes.data?.[0];
        current =
          dispute?.status === "lost"
            ? "lost"
            : ["won", "warning_closed"].includes(dispute?.status)
              ? current
              : "disputed";
      }
      await env.DB.prepare(
        "UPDATE purchase_payment_facts SET state = ?3, dispute = ?4 WHERE payment = ?1 AND invoice = ?2",
      )
        .bind(payment, invoice.id, current, dispute?.id ?? null)
        .run();
    }
    const state = await env.DB.prepare(
      "SELECT state FROM purchase_payment_facts WHERE payment = ?1 AND invoice = ?2",
    )
      .bind(payment, invoice.id)
      .first();
    if (state?.state === "disputed") disputed = true;
    if (["refunded", "lost"].includes(state?.state)) revoked = state.state;
  }
  usable = usable && !revoked;
  await env.DB.batch([
    orderFact(env, o.id, 'details', {paid_until: usable ? until + grace : 0, quantity: quantity}),
    orderFact(env, o.id, usable && until + grace > Date.now() ? (disputed ? "disputed" : "paid") : (revoked ?? "lapsed"), {total: invoice.total, paid_at: Date.now()}, {renewal:true}),
  ]);

}
/** Re-read the provider so delayed or missing webhooks cannot preserve refunded access. */
export async function reconcileOneTime(env, o) {
  if (!o.payment || o.mode !== shopMode(env)) return;
  if (!hasStripeKey(env)) {
    const refunds = await paymentRefunds(env, o.payment, o);
    const refunded = [...refunds.values()].filter(r=>r.status === 'succeeded').reduce((n,r)=>n+r.amount,0);
    if (!Number.isSafeInteger(refunded) || refunded < 0 || refunded > Number(o.total ?? o.amount)) throw new Error('Invalid Stripe refund total');
    const dispute = (await rememberedMoney(env,o.payment,o.mode)).find(r=>r.id.startsWith('dp_'));
    const state = refunded === Number(o.total ?? o.amount) && refunded > 0 ? 'refunded' : dispute?.status === 'lost' ? 'lost' : dispute && !['won','warning_closed'].includes(dispute.status) ? 'disputed' : 'paid';
    const completed = [...refunds.values()].find(r=>r.status === 'succeeded');
    const reversed = [...refunds.values()].some(r=>['failed','canceled'].includes(r.status));
    await orderFact(env,o.id,state,state === 'refunded' ? {refund:completed?.id} : {},{refundReversal:Boolean(reversed)}).run();
    return;
  }
  const pi = await stripeCall(
    env,
    "GET",
    `/v1/payment_intents/${encodeURIComponent(o.payment)}`,
    { expand: ["latest_charge"] },
  );
  const link = await linkOf(env,o.id);
  if (link ? pi.metadata?.homie !== 'purchase-links-v1' || pi.metadata?.revision !== link.revision : pi.metadata?.order !== o.id || pi.metadata?.homie !== "purchase-v1")
    throw new Error("Payment order mismatch");
  const charge = pi.latest_charge;
  if (!charge || typeof charge !== "object") return;
  const refunds = await paymentRefunds(env, o.payment, o);
  const refunded = [...refunds.values()].filter(r=>r.status === 'succeeded').reduce((n,r)=>n+r.amount,0);
  if (!Number.isSafeInteger(refunded) || refunded < 0 || refunded > Number(o.total ?? o.amount)) throw new Error('Invalid Stripe refund total');
  let state = refunded > 0 && refunded === Number(o.total ?? o.amount) ? 'refunded' : 'paid';
  if (charge.disputed && state !== "refunded") {
    const disputes = await stripeCall(env, "GET", "/v1/disputes", {
      payment_intent: o.payment,
      limit: 1,
    });
    const dispute = disputes.data?.[0];
    state =
      dispute?.status === "lost"
        ? "lost"
        : ["won", "warning_closed"].includes(dispute?.status)
          ? "paid"
          : "disputed";
  }
  const completed = [...refunds.values()].find(r=>r.status === 'succeeded');
  const reversed = [...refunds.values()].some(r=>['failed','canceled'].includes(r.status));
  await orderFact(env, o.id, state, state === 'refunded' ? {refund:completed?.id} : {}, {refundReversal:Boolean(reversed)}).run();

}
export async function reconcileOrder(env, o) {
  if (o.subscription && hasStripeKey(env) && !await linkOf(env,o.id)) await reconcileSubscription(env, o);
  else await reconcileOneTime(env, o);
  if(o.resource_kind==='cart' && o.payment) await (await import('./shop.mjs')).syncRefunds(env,o.payment);
}

/** Called only AFTER the existing shop webhook signature/mode check. Return null for player orders. */
export async function purchasePaymentEvent(env, event) {
  // An existing player shop may receive webhooks before purchase migrations run.
  try { await env.DB.prepare("SELECT 1 FROM purchase_orders LIMIT 0").first(); }
  catch (error) { if (/no such table/.test(error.message)) return null; throw error; }

  const obj = event.data?.object ?? {};
  if (!event.type.startsWith('checkout.session.')) await rememberMoneyEvent(env,event);
  if (obj.payment_link && obj.metadata?.homie === 'purchase-links-v1') return reconcileLinkSession(env,obj);
  if (!hasStripeKey(env) && event.type.startsWith('customer.subscription.')) {
    await env.DB.prepare("INSERT INTO meta (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(meta.value,'$.status') != 'canceled'").bind(`purchase-subscription:${obj.id}`,JSON.stringify({status:obj.status})).run();
    return 'purchase-subscription-status';
  }
  if (!hasStripeKey(env) || event.type === 'invoice_payment.paid' || event.type === 'invoice.paid' && (obj.parent?.subscription_details?.metadata?.homie === 'purchase-links-v1' || await linkSubscription(env,obj))) {
    if (event.type === 'invoice_payment.paid') {
      const payment = idOf(obj.payment?.payment_intent), invoice = idOf(obj.invoice);
      if (!payment || !invoice || obj.status !== 'paid') return null;
      await env.DB.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?1,?2)').bind(`purchase-invoice-payment:${invoice}`,JSON.stringify({payment,currency:obj.currency,livemode:obj.livemode})).run();
      const saved = await env.DB.prepare('SELECT value FROM meta WHERE key = ?1').bind(`purchase-invoice-id:${invoice}`).first();
      return saved ? reconcileLinkInvoice(env,JSON.parse(saved.value)) : 'purchase-invoice-payment-waiting';
    }
    if (event.type === 'invoice.paid') return reconcileLinkInvoice(env,obj);
    const payment = idOf(obj.payment_intent);
    if (!payment) return null;
    const row = await env.DB.prepare('SELECT order_id FROM purchase_payments WHERE payment = ?1').bind(payment).first();
    if (!row) return null;
    const order = await byId(env,row.order_id);
    await reconcileOneTime(env,order);
    return 'purchase-reconciled';
  }
  if (
    event.type === "payment_intent.succeeded" &&
    obj.metadata?.homie === "purchase-v1"
  ) {
    const o = await byId(env, obj.metadata.order);
    if (
      !o ||
      o.session ||
      o.mode !== (obj.livemode ? "live" : "test") ||
      o.amount !== obj.amount ||
      o.currency !== obj.currency
    )
      return null;
    await env.DB.batch([
      orderFact(env, o.id, 'payment', {payment: obj.id, paid_at: Date.now()}),
      env.DB.prepare(
        "INSERT OR IGNORE INTO purchase_payments (payment,order_id) VALUES (?1,?2)",
      ).bind(obj.id, o.id),
    ]);
    const current = await byId(env, o.id);
    if (current.payment !== obj.id) {
      await env.DB.prepare("INSERT OR IGNORE INTO purchase_jobs (id,order_id,mode,state,payload,payment,updated_at) VALUES (?1,?2,?3,'duplicate_refund',?4,?5,?6)").bind(`duplicate:${obj.id}`, o.id, o.mode, JSON.stringify({ params: {}, options: {} }), obj.id, Date.now()).run();
      const refund = await refundPayment(env, obj.id);
      if (refund.status === 'succeeded') await env.DB.prepare("UPDATE purchase_jobs SET state = 'duplicate_refunded' WHERE id = ?1").bind(`duplicate:${obj.id}`).run();
      return 'duplicate-refund';
    }

    return "purchase-payment";
  }
  if (
    event.type.startsWith("checkout.session.") &&
    obj.metadata?.homie === "purchase-v1"
  ) {
    if (
      !/^ord_[A-Za-z0-9]{20}$/.test(obj.metadata.order ?? "") ||
      !(await env.DB.prepare(
        "SELECT 1 FROM purchase_orders WHERE id = ?1",
      )
        .bind(obj.metadata.order)
        .first())
    )
      return null;
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type)
    ) {
      if (!(await reconcilePurchaseSession(env, obj))) return null;
    } else if (
      [
        "checkout.session.expired",
        "checkout.session.async_payment_failed",
      ].includes(event.type)
    ) {
      await orderFact(env, obj.metadata.order, event.type.endsWith("expired") ? "expired" : "failed", {})
        .run();
    }
    return "purchase-checkout";
  }
  if (
    event.type.startsWith("invoice.") ||
    event.type.startsWith("customer.subscription.")
  ) {
    const subscription = event.type.startsWith("customer.subscription.")
      ? obj.id
      : idOf(
          obj.parent?.subscription_details?.subscription ?? obj.subscription,
        );
    if (!subscription) return null;
    let row;
    try {
      row = await env.DB.prepare(
        "SELECT id AS order_id FROM purchase_orders WHERE subscription = ?1",
      )
        .bind(subscription)
        .first();
    } catch (e) {
      if (/no such table/.test(e.message)) return null;
      throw e;
    }
    const order =
      row?.order_id ??
      obj.metadata?.order ??
      obj.parent?.subscription_details?.metadata?.order;
    if (!order) return null;
    if (
      !(await env.DB.prepare(
        "SELECT 1 FROM purchase_orders WHERE id = ?1",
      )
        .bind(order)
        .first())
    )
      return null;
    const o = await byId(env, order);
    if (!o) return null;
    await orderFact(env, o.id, 'details', {subscription: subscription})
      .run();
    await reconcileSubscription(env, { ...o, subscription });
    return "purchase-subscription";
  }
  const payment = idOf(obj.payment_intent);
  if (!payment) return null;
  let row;
  try {
    row = await env.DB.prepare(
      "SELECT order_id FROM purchase_payments WHERE payment = ?1",
    )
      .bind(payment)
      .first();
  } catch (e) {
    if (/no such table/.test(e.message)) return null;
    throw e;
  }
  // A refund may beat Checkout's completion. Resolve its order from Stripe's immutable metadata.
  if (!row && /^(charge\.|refund\.)/.test(event.type)) {
    const playerOrder = await env.DB.prepare(
      "SELECT item FROM shop_orders WHERE payment = ?1",
    )
      .bind(payment)
      .first();
    if (playerOrder)
      return null;
    if (!(await env.DB.prepare("SELECT 1 FROM purchase_orders LIMIT 1").first()))
      return null;
    try {
      const pi = await stripeCall(
        env,
        "GET",
        `/v1/payment_intents/${encodeURIComponent(payment)}`,
      );
      if (pi.metadata?.homie === "purchase-v1")
        row = { order_id: pi.metadata.order };
      else {
        const payments = await stripeCall(env, "GET", "/v1/invoice_payments", {
          "payment[type]": "payment_intent",
          "payment[payment_intent]": payment,
          limit: 100,
        });
        const invoiceId = idOf(payments.data?.[0]?.invoice);
        if (!invoiceId) return null;
        const invoice = await stripeCall(
          env,
          "GET",
          `/v1/invoices/${encodeURIComponent(invoiceId)}`,
        );
        const order =
          invoice.parent?.subscription_details?.metadata?.order ??
          invoice.subscription_details?.metadata?.order;
        if (!order) return null;
        row = { order_id: order };
      }
    } catch {
      return null;
    } // Discovery never owns a foreign Stripe event.
  }
  if (
    !row ||
    !/^ord_[A-Za-z0-9]{20}$/.test(row.order_id ?? "") ||
    !(await env.DB.prepare(
      "SELECT 1 FROM purchase_orders WHERE id = ?1",
    )
      .bind(row.order_id)
      .first())
  )
    return null;
  const o = await byId(env, row.order_id);
  if (!o || o.mode !== (event.livemode ? "live" : "test")) return null;
  if (!o.subscription && termsOf(o).billing !== "one-time" && o.session) {
    const session = await retrieveCheckoutSession(env, o.session);
    o.subscription = idOf(session.subscription);
  }
  if (!o.subscription) {
    if (!o.payment) o.payment = payment;
    await reconcileOneTime(env, o);
  } else {
    await reconcileSubscription(env, o);
    const current = await byId(env, o.id);
    if (current.status === "refunded" && termsOf(o).refundEndsSubscription)
      await cancelSubscription(env, o.subscription);
  }
  return "purchase-reconciled";
}

/** Signed snapshots only; correlation is checked against the frozen link before granting. */
async function reconcileLinkSession(env, session) {
  let o = await byId(env, session.client_reference_id);
  if (!o) return 'purchase-unknown';
  const saved = await env.DB.prepare('SELECT value FROM meta WHERE key = ?1').bind(`purchase-link:${o.id}`).first();
  const link = saved && JSON.parse(saved.value);
  if (!link || session.payment_link !== link.id || session.metadata?.revision !== link.revision || session.currency !== o.currency || session.amount_subtotal !== o.amount || session.livemode !== (o.mode === 'live')) throw new Error('Purchase Payment Link terms mismatch');
  if (!['paid','no_payment_required'].includes(session.payment_status)) return 'purchase-waiting';
  await bindHostedSession(env,o.id,session.id);
  o = await byId(env,o.id);
  if (o.session !== session.id) {
    // Public links are reusable. Every verified payment gets its own immutable order.
    const { createPurchase } = await import('./purchase-store.mjs');
    const { digest } = await import('./purchase-crypto.mjs');
    const existing = await env.DB.prepare('SELECT id FROM purchase_orders WHERE session = ?1').bind(session.id).first();
    const next = {...o,id:`ord_${(await digest(session.id)).slice(0,20)}`,session:null,payment:null,status:'started',claim_hash:await digest(`${o.claim_hash}:${session.id}`),created_at:Date.now()};
    if (!existing) { try { await createPurchase(env,next); } catch(error) { if (!await byId(env,next.id)) throw error; } }
    o = await byId(env,existing?.id ?? next.id);
    await env.DB.prepare('INSERT OR IGNORE INTO meta (key,value) VALUES (?1,?2)').bind(`purchase-link:${o.id}`,JSON.stringify(link)).run();
    await bindHostedSession(env,o.id,session.id);
  }
  const payment = idOf(session.payment_intent), subscription = idOf(session.subscription);
  if ((termsOf(o).billing !== 'one-time') !== Boolean(subscription) || !subscription && !payment && session.amount_total !== 0) throw new Error('Purchase payment kind mismatch');
  await env.DB.batch([
    orderFact(env,o.id,'details',{session:session.id,customer:idOf(session.customer) ?? null,subscription:subscription ?? null}),
    ...(!subscription ? [orderFact(env,o.id,'payment',{payment:payment ?? null,total:session.amount_total,tax:session.total_details?.amount_tax ?? 0,paid_at:Date.now()})] : []),
    ...(payment ? [env.DB.prepare('INSERT OR IGNORE INTO purchase_payments (payment,order_id) VALUES (?1,?2)').bind(payment,o.id)] : [])
  ]);
  if (payment) await reconcileOneTime(env,await byId(env,o.id));
  if (subscription) {
    const invoice = await env.DB.prepare('SELECT value FROM meta WHERE key = ?1').bind(`purchase-invoice:${subscription}`).first();
    if (invoice) await reconcileLinkInvoice(env,JSON.parse(invoice.value));
  }
  return 'purchase-checkout';
}
async function reconcileLinkInvoice(env, invoice) {
  const subscription = idOf(invoice.parent?.subscription_details?.subscription ?? invoice.subscription);
  if (!subscription) return null;
  const line = invoice.lines?.data?.find(l=>!l.proration && !l.parent?.subscription_item_details?.proration);
  if (invoice.status !== 'paid' || !line?.period?.end) return null;
  await env.DB.prepare("INSERT INTO meta (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(excluded.value,'$.period_end') >= json_extract(meta.value,'$.period_end')").bind(`purchase-invoice:${subscription}`,JSON.stringify({id:invoice.id,subscription,status:invoice.status,currency:invoice.currency,livemode:invoice.livemode,amount_remaining:invoice.amount_remaining,total:invoice.total,period_end:line.period.end,lines:{data:[{period:line.period}]}})).run();
  await env.DB.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?1,?2)').bind(`purchase-invoice-id:${invoice.id}`,JSON.stringify({id:invoice.id,subscription,status:invoice.status,currency:invoice.currency,livemode:invoice.livemode,amount_remaining:invoice.amount_remaining,total:invoice.total,lines:{data:[{period:line.period}]}})).run();
  const row = await env.DB.prepare('SELECT id FROM purchase_orders WHERE subscription = ?1').bind(subscription).first();
  if (!row) return 'purchase-invoice-waiting';
  const o = await byId(env,row.id);
  if (invoice.currency !== o.currency || invoice.livemode !== (o.mode === 'live') || Number(invoice.amount_remaining ?? 0) !== 0) throw new Error('Purchase invoice mismatch');
  if (line.period.end * 1000 < Number(o.paid_until ?? 0)) return 'purchase-old-invoice';
  const recorded = await env.DB.prepare('SELECT value FROM meta WHERE key = ?1').bind(`purchase-invoice-payment:${invoice.id}`).first();
  const paymentFact = recorded && JSON.parse(recorded.value);
  if (paymentFact && (paymentFact.currency !== o.currency || paymentFact.livemode !== (o.mode === 'live'))) throw new Error('Invoice payment mismatch');
  const payment = paymentFact?.payment ?? idOf(invoice.payment_intent ?? invoice.payments?.data?.[0]?.payment?.payment_intent);
  await env.DB.batch([orderFact(env,o.id,'paid',{paid_until:line.period.end*1000,total:invoice.total,paid_at:Date.now(),...(payment?{payment}:{})},{renewal:line.period.end*1000 > Number(o.paid_until ?? 0)}),...(payment?[env.DB.prepare('INSERT OR IGNORE INTO purchase_payments (payment,order_id,invoice) VALUES (?1,?2,?3)').bind(payment,o.id,invoice.id)]:[])]);
  if (payment) await reconcileOneTime(env,await byId(env,o.id));
  return 'purchase-subscription';
}

async function linkOf(env,id) {
  const saved = await env.DB.prepare('SELECT value FROM meta WHERE key = ?1').bind(`purchase-link:${id}`).first();
  return saved ? JSON.parse(saved.value) : null;
}
async function linkSubscription(env,invoice) {
  const subscription = idOf(invoice.parent?.subscription_details?.subscription ?? invoice.subscription);
  if (!subscription) return false;
  const row = await env.DB.prepare('SELECT id FROM purchase_orders WHERE subscription = ?1').bind(subscription).first();
  return row ? Boolean(await linkOf(env,row.id)) : false;
}
