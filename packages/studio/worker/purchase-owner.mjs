import { hasStripeKey, shopMode } from './shop-links.mjs';
import { hostedReadiness } from './purchase-hosted-readiness.mjs';
import { listOffers } from './resource-kinds.mjs';
import { orderFact, recordOrderState } from './purchase-core.mjs';
import { machineCapabilities } from './payment-capabilities.mjs';
/** Studio licences use the shop's Stripe, order book, webhook and refund office. */

import { canonicalJson } from './referrals.mjs';

import {
  cancelSubscription,
  closeCheckoutSession,
  retrieveCheckoutSession,
  stripeCall,
  modeOf,
} from "./stripe.mjs";

import {
  json,
  byId,
  idOf,
  safeId,
  validBuyer,
  termsOf,
  purchasedResource,
  listedRelease,
  recurringReady,
  expireUnpaidMachineOrders,
} from "./purchase-store.mjs";
import {
  reconcilePurchaseSession,
  reconcileSubscription,
  reconcileOrder,
} from "./purchase-reconciliation.mjs";
/** Owner-authenticated office calls this after matching the payer's Stripe receipt. */
export async function reissuePurchaseClaim(env, body) {
  if (
    !validBuyer(body.claimHash) ||
    !/^ord_[A-Za-z0-9]{20}$/.test(body.order ?? "") ||
    body.receiptVerified !== true
  )
    return {
      ok: false,
      message:
        "Verify the Stripe receipt, then supply order, claimHash and receiptVerified: true",
    };
  const o = await byId(env, body.order);
  if (o && o.mode !== shopMode(env))
    return {
      ok: false,
      message: "Reconnect the purchase payment mode before reissue",
    };
  if (!o?.session && !o?.payment)
    return { ok: false, message: "No provider payment to verify" };
  const receipt = o.session
    ? await retrieveCheckoutSession(env, o.session)
    : await stripeCall(
        env,
        "GET",
        `/v1/payment_intents/${encodeURIComponent(o.payment)}`,
      );
  if (
    receipt.metadata?.order !== o.id ||
    receipt.metadata?.homie !== "purchase-v1" ||
    (o.session && (idOf(receipt.customer) ?? null) !== o.customer)
  )
    return {
      ok: false,
      message: "Stripe receipt does not match this purchase",
    };
  if (body.buyer && o.subscription)
    return {
      ok: false,
      message:
        "A subscription cannot move its payer through claim reissue. Cancel billing in Stripe and have the new studio approve its own Checkout.",
    };
  if (body.buyer && (!termsOf(o).transferable || !validBuyer(body.buyer)))
    return {
      ok: false,
      message: "These licence terms do not permit this transfer",
    };
  await orderFact(env, o.id, 'details', {claim_hash: body.claimHash, buyer: body.buyer ?? o.buyer})
    .run();
  return {
    ok: true,
    order: o.id,
    message:
      "Claim reissued. Earlier download credentials and claims are revoked. The buyer retries the purchase.",
  };
}

export async function refundPurchasePayment(env, order) {
  const o = await byId(env, order.id);
  if (!o?.subscription) return false;
  await env.DB.prepare(
    "UPDATE purchase_payment_facts SET state = 'refunded' WHERE payment = ?1 AND order_id = ?2",
  )
    .bind(o.payment, o.id)
    .run();
  await reconcileSubscription(env, o);
  return true;
}

/** Owner-only status probe; player readiness never depends on resource permissions. */
export async function purchaseReadiness(env, origin, catalogue = {}) {
  const missing = [];
  const recurring = (await listOffers(env,origin)).some((r)=>r.offer.billing !== 'one-time');
  if (recurring && !(await recurringReady(env)))
    missing.push(
      "Reconnect the shop to verify subscription permissions and webhook events",
    );
  if (!env.PURCHASE_SIGNING_KEYS)
    missing.push("Create the separate purchase signing key");
  const machine = await machineCapabilities(env);
  if (!machine.ready) missing.push(...Object.values(machine.reasons));
  const { dryPaymentExchange } = await import('./payment-dry-exchange.mjs');
  let exchange = machine.ready ? await dryPaymentExchange(env, origin, catalogue) : { verified: false, reason: 'Configure machine payments before running the dry exchange.' };
  if (shopMode(env) === 'test') {
    const cached = await env.DB.prepare("SELECT value FROM meta WHERE key = 'purchase-test-exchange'").first();
    const sandbox = cached ? JSON.parse(cached.value) : null;
    if (sandbox && sandbox.nextCheckAt > Date.now()) exchange.sandbox = sandbox;
    // Readiness is the current read-only exchange, not a permanent historical probe result.
  }
  if (machine.ready && !exchange.verified) missing.push(exchange.reason);
  const fallback = await hostedReadiness(env, catalogue, recurring);
  return { ready: !missing.length, missing, machine: { ...machine, ready: !missing.length }, fallback, exchange };
}

/** Close new sales immediately, then cancel every recurring contract; retries resume safely. */
export async function retireResource(env, kind, resource) {
  if (!safeId(resource)) return { ok: false, message: "Name the resource to retire" };
  await env.DB.prepare(
    "INSERT OR IGNORE INTO resource_retirements (resource,retired_at) VALUES (?1,?2)",
  )
    .bind(`${shopMode(env)}:${kind}:${resource}`, Date.now())
    .run();
  await expirePurchaseCheckouts(env, kind, resource);
  let after = "";
  let canceled = 0;
  const pending = [];
  for (;;) {
    const rows =
      (
        await env.DB.prepare(
          "SELECT id AS order_id, subscription FROM purchase_orders WHERE item = ?1 AND mode = ?3 AND subscription IS NOT NULL AND id > ?2 ORDER BY id LIMIT 100",
        )
          .bind(`${kind}:${resource}`, after, shopMode(env))
          .all()
      ).results ?? [];
    if (!rows.length) break;
    for (const row of rows) {
      if (hasStripeKey(env)) { await cancelSubscription(env, row.subscription); canceled++; }
      else {
        const saved = await env.DB.prepare('SELECT value FROM meta WHERE key = ?1').bind(`purchase-subscription:${row.subscription}`).first();
        if (saved && JSON.parse(saved.value).status === 'canceled') canceled++;
        else pending.push(row.subscription);
      }
      after = row.order_id;
    }
  }
  if (pending.length) return {ok:false,needs:'stripe-cancellation',newSalesClosed:true,subscriptions:pending,
    message:'Ask the connected AI to cancel these subscriptions in your Stripe account, resend their signed subscription events if needed, then retry retirement. Paid-period downloads remain available.',
    next:pending.map(id=>({method:'DELETE',path:`/v1/subscriptions/${id}`}))};
  return {
    ok: true,
    canceled,
    message:
      "New sales are closed and subscriptions canceled. Keep paid-period downloads available and publish the withdrawal.",
  };
}

/** Owner approval binds a test delivery to the secret claim, not a public order identifier. */
export async function authorizePurchaseTest(env, order) {
  const o = await byId(env, order);
  if (!o || o.mode !== "test" || shopMode(env) !== "test")
    return { ok: false, message: "Only a current test order can be approved" };
  await env.DB.prepare("INSERT OR REPLACE INTO purchase_test_approvals (order_id,value) VALUES (?1,?2)")
    .bind(o.id, o.claim_hash)
    .run();
  return {
    ok: true,
    message:
      "This owner-approved test claim can download while the shop stays in test mode",
  };
}
/** Called on retirement and after deployment, including withdrawal, supersession and price changes. */
export async function expirePurchaseCheckouts(env, kind = null, resource = null) {
  let after = "";
  let expired = 0;
  for (;;) {
    const rows =
      (
        await env.DB.prepare(
          "SELECT id, session FROM purchase_orders WHERE status = 'started' AND mode = ?1 AND id > ?2 ORDER BY id LIMIT 100",
        )
          .bind(shopMode(env), after)
          .all()
      ).results ?? [];
    if (!rows.length) break;
    for (const row of rows) {
      after = row.id;
      const o = await byId(env, row.id);
      const p = purchasedResource(o);
      if (resource && (resource !== p.id || kind !== o.resource_kind)) continue;
      const listed = resource
        ? null
        : await listedRelease(env, "https://studio.invalid", o.resource_kind, p.id, p.version);
      if (
        Date.now() < o.created_at + (o.session ? 86400000 : 300000) &&
        listed &&
        canonicalJson(listed.offer) === canonicalJson(JSON.parse(o.offer))
      )
        continue;
      // A keyless completion can precede its invoice. Wait for signed facts; no provider read.
      if (row.session && !hasStripeKey(env)) continue;
      const session = row.session ? await closeCheckoutSession(env, row.session) : { status: "expired" };
      if (session.status === "complete")
        await reconcilePurchaseSession(env, session);
      else {
        await orderFact(env, o.id, 'expired', {})
          .run();

        expired++;
      }
    }
  }
  const cleaned = await expireUnpaidMachineOrders(env);
  return { ok: true, expired, cleaned };
}

/** Owner actions refresh recurring state just as a buyer grant does. */
export async function currentPurchaseOrder(env, id) {
  const { reconcileRecordings } = await import('./payment-recovery.mjs');
  await reconcileRecordings(env, id);
  let o = await byId(env, id);
  if (o && o.mode === shopMode(env)) {
    await reconcileOrder(env, o);
    o = await byId(env, id);
  }
  return o;
}
