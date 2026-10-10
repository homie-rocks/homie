import { definitiveRefusal, blockingJobsSQL } from './payment-policy.mjs';
import { orderFact, offerVersion, orderState } from './purchase-core.mjs';
import { problem } from './purchase-problem.mjs';
import { saveRecording, recordProviderResult, recordingFailure, reconcileRecordings } from './payment-recovery.mjs';
import { machineCapabilities, notePaymentRefusal } from './payment-capabilities.mjs';
import { purchaseResponse } from './purchase-response.mjs';
/** One durable purchase, regardless of transport. No seller browser page is involved. */
import { Receipt } from 'mppx';
import { signingKey } from './purchase-keys.mjs';
import {
  byClaim,
  expireUnpaidMachineOrders,
  byId,
  createPurchase,
  currentPurchaseOrder,
  deliveryAllowed,
  grantPurchase,
  listedRelease,
  limitedText,
  resourceAvailable,
} from "./purchases.mjs";
import { paymentProtocol, stripeClient } from './machine-payments.mjs';
import { digest, manifestHash } from './purchase-crypto.mjs';
import { resourceKind, hasResourceKind } from './resource-kinds.mjs';
import { modeOf } from './stripe.mjs';
import { newOrderId } from './shop-store.mjs';

export async function machineResource(
  request,
  env,
  url,
  cat,
  dependencies = {},
) {
  const hostedFallback = (detail) => problem(409, detail, { checkout: { url: `${url.origin}/api/purchases/intent`, method: 'POST', description: 'Hosted Checkout fallback. Submit the published offerVersion, buyer and private claimHash.' } });
  const mcp = Boolean(dependencies.mcpInput);
  if (dependencies.dryRun && (mcp || request.headers.has('authorization') || request.headers.has('payment-signature'))) throw new Error('Dry exchanges cannot carry payment credentials');
  if (request.method !== "POST")
    return problem(405, "POST the resource, buyer, claim and approved quote");
  const b = await machineInput(request, dependencies.mcpInput);
  if (b instanceof Response) return b;
  if (
    !b ||
    !/^[a-f0-9]{64}$/.test(b.claim ?? "") ||
    !/^[a-f0-9]{64}$/.test(b.buyer ?? "")
  )
    return problem(400, "Supply a private random claim and buyer identity");
  if (!hasResourceKind(b.kind)) return problem(400,"Name a supported resource kind");
  const adapter = resourceKind(b.kind);
  const quoteHash = adapter.quote;
  const claimHash = await digest(b.claim);
  const resourcePath = `/api/purchases/resource/${encodeURIComponent(b.kind)}/${encodeURIComponent(b.resource)}/${encodeURIComponent(b.version)}/${claimHash}`;
  if (!mcp && url.pathname !== '/api/purchases/resource' && url.pathname !== resourcePath.slice(0, resourcePath.lastIndexOf('/')) && url.pathname !== resourcePath)
    return problem(409, "Resource URL differs from this purchase");
  if (!mcp) request = new Request(new URL(resourcePath, url.origin), request);
  const approved = async (resource, quantity, game, offer) => b.quote === await quoteHash(resource, quantity, game, offer) || b.offerVersion === (await offerVersion({ kind: b.kind, id: resource.id, release: resource.version, manifest: await manifestHash(resource) }, offer)).version;
  await expireUnpaidMachineOrders(env);
  let o = await byClaim(env, claimHash);
  if (!o) {
    if ((cat.shop?.purchasesTill ?? cat.shop?.till) === 'stripe-managed') return hostedFallback('This seller uses Stripe Managed Payments.');
    const listed = await listedRelease(env, url.origin, b.kind, b.resource, b.version);
    if (!listed) return problem(404, "Offer unavailable");
    const { resource, offer } = listed;
    const quantity = b.quantity ?? 1;
    const game = b.game ?? null;
    if (offer.billing !== "one-time")
      return hostedFallback("Recurring purchases use Stripe Checkout");
    if (offer.amount === 0) return hostedFallback("A zero-price offer uses hosted Checkout.");
    if (offer.currency !== "usd") return hostedFallback("This currency requires hosted Checkout; machine payments currently support USD.");
    if (
      offer.automaticTax ||
      offer.taxBehavior === "exclusive"
    )
      return hostedFallback("This offer needs Checkout to calculate its final total");
    const validation = adapter.validate({ ...resource, sale: offer }, { quantity, game });
    if (validation.length) return problem(400, validation.join('; '));
    if (!(await approved(resource, quantity, game, offer)))
      return problem(409, "Price or terms changed; approve the fresh quote");
    // Check readiness and bytes before an agent can spend anything.
    if (!env.PURCHASE_SIGNING_KEYS || !(await machineCapabilities(env)).ready)
      return hostedFallback("Seller machine payments are not configured. Use Hosted Checkout.");
    await signingKey(env);
    if (!(await resourceAvailable(env, b.kind, resource)))
      return problem(503, "Paid files unavailable; no payment requested");
    const pending = {
      id: newOrderId(),
      resource_kind: b.kind,
      item: `${b.kind}:${resource.id}`,
      game,
      amount: quantity * offer.amount,
      currency: offer.currency,
      till: "stripe",
      mode: modeOf(env.STRIPE_KEY),
      claim_hash: claimHash,
      buyer: b.buyer,
      buyer_label: "Buyer",
      quantity,
      transport: "machine",
      manifest: JSON.stringify(resource),
      manifest_hash: await manifestHash(resource),
      offer: JSON.stringify(offer),
    };
    await createPurchase(env, pending);
    o = await byId(env, pending.id);
  }
  const hasCredential = request.headers.has('authorization') || request.headers.has('payment-signature') || Boolean(dependencies.extra?._meta);
  await reconcileRecordings(env, o.id, { ...(dependencies.chainRpc ? { rpc: dependencies.chainRpc } : {}), facilitator: dependencies.facilitator });
  o = await byId(env, o.id);
  const pending = await env.DB.prepare(`SELECT 1 FROM purchase_jobs WHERE order_id = ?1 AND ${blockingJobsSQL} UNION ALL SELECT 1 FROM purchase_settlements WHERE order_id = ?1 AND state NOT IN ('complete','unpaid') LIMIT 1`).bind(o.id).first();
  if (pending && !['paid','fulfilled','disputed'].includes(o.status)) return problem(503, 'Payment outcome is being reconciled. Retry this purchase; do not pay again.');
  if (o.status === "started") {
    const listed = await listedRelease(env, url.origin, b.kind, b.resource, b.version);
    if (Date.now() >= o.created_at + 300000 || !listed ||
        await quoteHash(listed.resource, o.quantity, o.game, listed.offer) !== await quoteHash(JSON.parse(o.manifest), o.quantity, o.game, JSON.parse(o.offer))) {
      await orderFact(env, o.id, 'expired', {}).run();
      return problem(409, "This five-minute purchase has expired or its offer changed. Start a new purchase with the current offer.");
    }
  }
  const core = await orderState(env, o.id);
  if (o.status === "started" && core?.transport !== "machine")
    return problem(
      409,
      "This order uses Checkout; do not pay it through a wallet as well",
    );
  if (o.payment && hasCredential) o = await currentPurchaseOrder(env, o.id);
  const resource = JSON.parse(o.manifest);
  if (
    o.resource_kind !== b.kind ||
    o.buyer !== b.buyer ||
    o.mode !== modeOf(env.STRIPE_KEY) ||
    resource.id !== b.resource ||
    resource.version !== b.version ||
    !(await approved(resource, o.quantity, o.game, JSON.parse(o.offer)))
  )
    return problem(409, "Request differs from this purchase");
  const response = async () => {
    if (!(await deliveryAllowed(env, o)))
      throw new Error(
        "Test downloads need owner approval and never work in live mode",
      );
    const grant = await grantPurchase(env, url.origin, o, {
      version: b.version,
    });
    if (!grant.ok) return grant;
    const result = await grant.json();
    return { ...result, order: o.id };
  };
  if (!dependencies.dryRun && o.mode === 'test' && !(await deliveryAllowed(env, o)))
    return problem(403, `Test downloads need owner approval for order ${o.id}. No payment requested.`, { order: o.id });
  const client = recordingClient(env, o, dependencies.client ?? stripeClient(env));
  const receiptKey = o.id;
  const stored = await env.DB.prepare("SELECT value FROM purchase_receipts WHERE order_id = ?1")
    .bind(receiptKey)
    .first();
  o = await byId(env, o.id);
  if (["paid", "fulfilled", "disputed"].includes(o.status)) {
    if(mcp && core?.transport==='checkout') {const result=await response();return result instanceof Response?result:machineMcpDelivery(result,dependencies);}
    const recorded = stored ? null : await env.DB.prepare("SELECT payload FROM purchase_jobs WHERE order_id = ?1 ORDER BY updated_at DESC LIMIT 1").bind(o.id).first();
    const recording = recorded && JSON.parse(recorded.payload);
    const challengeId = recording?.params?.metadata?.mpp_challenge_id;
    if (!stored && !challengeId) return problem(409, "This purchase has no machine-payment challenge receipt. Retrieve the paid files using the purchase grant endpoint.");
    const receipt = stored ? JSON.parse(stored.value) : {
      method: recording?.params?.metadata?.mpp_method ?? "stripe", status: "success", reference: recording?.chain?.transaction_hash ?? o.payment,
      timestamp: new Date(o.paid_at).toISOString(), challengeId,
    };
    const result = await response();
    if (result instanceof Response) return result;
    if (mcp) return machineMcpDelivery(result, dependencies, receipt);
    const delivered = purchaseResponse(result, env);
    if (!mcp) {
      delivered.headers.set("Payment-Receipt", Receipt.serialize(receipt));
      const headers = await env.DB.prepare(
        "SELECT headers AS value FROM purchase_receipts WHERE order_id = ?1 AND headers IS NOT NULL",
      )
        .bind(o.id)
        .first();
      if (!headers && recording?.chain?.network === 'base') delivered.headers.set('payment-response', btoa(JSON.stringify({ success: true, transaction: recording.chain.transaction_hash, network: o.mode === 'live' ? 'eip155:8453' : 'eip155:84532' })));
      if (headers)
        for (const [key, value] of Object.entries(JSON.parse(headers.value)))
          delivered.headers.set(key, value);
    }
    return mcp ? (await delivered.json()).result : delivered;
  }
  if (o.status !== "started")
    return problem(402, `Purchase is ${o.status}; do not pay this order again`);
  const readiness = await machineCapabilities(env);
  if (!readiness.ready) return problem(503, Object.values(readiness.reasons).join(' '));
  const protocol = await paymentProtocol(env, o, {
    ...dependencies,
    client,
    mcp,
    realm: url.hostname,
    capabilities: readiness,
  });
  protocol.onPaymentSuccess(async ({ receipt, challenge }) => {
    receipt = { ...receipt, challengeId: challenge.id };
    await env.DB.prepare(
      "INSERT INTO purchase_receipts (order_id,value) VALUES (?1,?2) ON CONFLICT(order_id) DO UPDATE SET value = excluded.value",
    )
      .bind(receiptKey, JSON.stringify(receipt))
      .run();
  });
  const paid = await protocol.charge({
    expires: new Date(o.created_at + 300000).toISOString(),
    amount: (o.amount / 100).toFixed(2),
    description: `${resource.name} ${resource.version}`,
    scope: o.id,
    meta: { order: o.id, quote: await quoteHash(resource, o.quantity, o.game, JSON.parse(o.offer)) },
    paymentIntentOptions: { metadata: { homie: "purchase-v1", order: o.id } },
  })(mcp ? dependencies.extra : request);
  if (paid.status === 402) {
    const uncertain = await env.DB.prepare(`SELECT 1 FROM purchase_jobs WHERE order_id = ?1 AND ${blockingJobsSQL} UNION ALL SELECT 1 FROM purchase_settlements WHERE order_id = ?1 AND state NOT IN ('complete','unpaid') LIMIT 1`).bind(o.id).first();
    if (uncertain) return problem(503, 'The payment outcome is being reconciled. Retry this purchase; do not pay again.');
    if (mcp) throw paid.challenge;
    return paid.challenge;
  }
  if (!mcp) {
    const receiptResponse = paid.withReceipt(new Response());
    const headers = Object.fromEntries(
      ["payment-receipt", "payment-response"]
        .filter((key) => receiptResponse.headers.has(key))
        .map((key) => [key, receiptResponse.headers.get(key)]),
    );
    await env.DB.prepare(
      "INSERT INTO purchase_receipts (order_id,headers) VALUES (?1,?2) ON CONFLICT(order_id) DO UPDATE SET headers = excluded.headers",
    )
      .bind(o.id, JSON.stringify(headers))
      .run();
  }
  o = await byId(env, o.id);
  if (!["paid","fulfilled"].includes(o.status))
    return problem(
      503,
      "Settlement is being recorded. Retry this order; do not pay again",
    );
  const result = await response();
  if (result instanceof Response) return result;
  if (mcp) return paid.withReceipt(machineMcpDelivery(result, dependencies));
  return paid.withReceipt(purchaseResponse(result, env));
}

function machineMcpDelivery(result, dependencies, receipt) {
  dependencies.setDelivery?.(result);
  return { content: [{ type: 'text', text: JSON.stringify(result) }], ...(receipt ? { _meta: { 'org.paymentauth/receipt': receipt } } : {}) };
}

async function machineInput(request, mcpInput) {
  let text;
  try { text = await limitedText(request.clone()); } catch { return problem(413, 'Purchase request too large'); }
  if (new TextEncoder().encode(text).length > 16384) return problem(413, 'Purchase request too large');
  let input;
  try { input = JSON.parse(text); } catch { return problem(400, 'Invalid JSON request'); }
  if (!input || typeof input !== 'object') return problem(400, 'Expected a purchase request');
  return mcpInput ?? input;
}
function recordingClient(env, o, providerClient) {

  const create = providerClient.paymentIntents.create.bind(
    providerClient.paymentIntents,
  );
  const client = Object.create(providerClient);
  client.paymentIntents = Object.create(providerClient.paymentIntents);
  client.paymentIntents.create = async (params, options) => {
    params = { ...params, metadata: { ...params.metadata, homie: "purchase-v1", order: o.id } };
    const id = await saveRecording(env, o, params, options);
    try {
      const saved = await env.DB.prepare('SELECT state,payload FROM purchase_jobs WHERE id = ?1').bind(id).first();
      if (saved.state === 'manual_review') throw new Error('Stripe recording was refused; the seller must handle any refund manually.');
      const original = JSON.parse(saved.payload);
      let pi = await create(original.params, original.options);
      if (pi.status === 'processing') pi = await providerClient.paymentIntents.retrieve(pi.id);
      if (pi.status === 'requires_action') pi = await providerClient.paymentIntents.cancel(pi.id);
      await recordProviderResult(env, o, id, pi);
      return pi;
    } catch (error) { await recordingFailure(env, id, error);
      if (((error.statusCode ?? error.status) === 403 || /not available|not enabled|permission|country|eligib/i.test(error.message))) await notePaymentRefusal(env, params.payment_method_options?.crypto ? 'base' : 'card', error);
      throw error; }
  };
  return client;
}
