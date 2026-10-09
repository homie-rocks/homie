import { pendingJobsSQL, definitiveRefusal, REPLAY_LIMIT_MS, recoveryAction } from './payment-policy.mjs';
import { orderFact, recordOrderState, releaseClaim } from './purchase-core.mjs';
import { resumeSettlement } from './settlement-journal.mjs';
/** Durable provider recordings outlive responses. A verified chain transfer is payment. */
import { stripeCall, refundPayment, modeOf } from './stripe.mjs';
import { byId, resourceAvailable } from './purchase-store.mjs';
export async function saveRecording(env, order, params, options) {
  const chain = params.payment_method_options?.crypto?.transaction_verification_options;
  const id = chain ? `${order.id}:${chain.network}:${chain.transaction_hash}` : options.idempotencyKey;
  await env.DB.prepare("INSERT OR IGNORE INTO purchase_jobs (id,order_id,mode,state,payload,updated_at) VALUES (?1,?2,?3,?4,?5,?6)")
    .bind(id, order.id, order.mode, chain ? 'paid_recording' : 'submitted', JSON.stringify({ params, options: { ...options, idempotencyKey: chain ? chain.transaction_hash : options.idempotencyKey }, chain, startedAt: Date.now() }), Date.now()).run();
  if (chain) {
    // Only the protocol's verified settlement callback reaches here, never buyer input.
    await orderFact(env, order.id, 'payment', {paid_at: Date.now()}).run();
    await env.DB.prepare("UPDATE purchase_settlements SET state = 'complete', updated_at = ?2 WHERE order_id = ?1 AND reference = ?3").bind(order.id, Date.now(), chain.transaction_hash).run();
  }
  return id;
}
export async function recordProviderResult(env, order, id, pi) {
  if (pi.amount !== order.amount || pi.currency !== order.currency || pi.livemode !== (order.mode === 'live')) throw new Error('Provider receipt does not match order');
  await env.DB.prepare("UPDATE purchase_jobs SET payment = ?2, state = ?3, error = NULL, updated_at = ?4 WHERE id = ?1").bind(id, pi.id, pi.status === 'succeeded' ? 'recorded' : ['canceled','requires_payment_method'].includes(pi.status) ? 'failed' : 'processing', Date.now()).run();
  if (pi.status !== 'succeeded') return;

  await env.DB.batch([
    orderFact(env, order.id, 'payment', {payment: pi.id, paid_at: Date.now()}),
    env.DB.prepare("INSERT OR IGNORE INTO purchase_payments (payment,order_id) VALUES (?1,?2)").bind(pi.id, order.id),
  ]);
  const current = await byId(env, order.id);
  if (current.payment !== pi.id) {
    const refund = await refundPayment(env, pi.id);
    await env.DB.prepare("UPDATE purchase_jobs SET state = ?2 WHERE id = ?1").bind(id, refund.status === 'succeeded' ? 'duplicate_refunded' : 'duplicate_refund').run();
    return;
  }
}
export async function recordingFailure(env, id, error) {
  if (definitiveRefusal(error)) {
    await env.DB.prepare("UPDATE purchase_jobs SET state = 'failed', error = ?2, attempts = attempts + 1, updated_at = ?3 WHERE id = ?1 AND state = 'submitted'").bind(id, String(error.message).slice(0, 500), Date.now()).run();
    return;
  }
  // A failure of our call is not a fact about the original payment.
  await env.DB.prepare("UPDATE purchase_jobs SET error = ?2, attempts = attempts + 1, updated_at = ?3 WHERE id = ?1")
    .bind(id, String(error.message).slice(0, 500), Date.now()).run();
}

/** Read existing objects first. Listing avoids the search index's delayed negative answers. */
export async function readProviderPayment(env, order, job, payment = null) {
  const options = { version: '2026-07-29.preview' };
  if (payment && !/^pi_[A-Za-z0-9]+$/.test(payment)) throw new Error('Supply an existing Stripe PaymentIntent id');
  if (job.payment || payment) {
    const pi = await stripeCall(env, 'GET', `/v1/payment_intents/${encodeURIComponent(job.payment ?? payment)}`, null, options);
    if (pi.metadata?.order !== order.id) throw new Error('The existing PaymentIntent belongs to another order');
    return pi;
  }
  let cursor;
  for (let page = 0; page < 100; page++) {
    const result = await stripeCall(env, 'GET', '/v1/payment_intents', { limit: 100, created: { gte: Math.floor(order.created_at / 1000) - 60 }, ...(cursor ? { starting_after: cursor } : {}) }, options);
    if (!Array.isArray(result.data)) throw new Error('Stripe did not return an existing-payment list');
    const found = result.data.find((pi) => pi.metadata?.order === order.id);
    if (found) return found;
    if (!result.has_more) return null;
    cursor = result.data.at(-1)?.id;
    if (!cursor) throw new Error('Stripe payment list has no continuation');
  }
  throw new Error(`Existing payment scan exceeded 100 pages for order ${order.id}; the owner must reconcile this order.`);
}
async function releaseUnpaid(env, order, job, pi = null) {
  await env.DB.batch([
    env.DB.prepare("UPDATE purchase_jobs SET state = 'failed', error = NULL, updated_at = ?2, payment = COALESCE(payment, ?3) WHERE id = ?1").bind(job.id, Date.now(), pi?.id ?? null),
    orderFact(env, order.id, 'failed', {}),
    releaseClaim(env, order.id),
  ]);
}
export async function reconcileRecordings(env, orderId = null, dependencies = {}) {
  await reconcileSettlements(env, orderId, dependencies);
  const rows = (await env.DB.prepare(`SELECT * FROM purchase_jobs WHERE mode = ?1 AND ${pendingJobsSQL} AND (?2 IS NULL OR order_id = ?2) ORDER BY updated_at LIMIT 100`).bind(modeOf(env.STRIPE_KEY), orderId).all()).results ?? [];
  for (const job of rows) {
    try {
      const order = await byId(env, job.order_id);
      if (!order) continue;
      const { params, options, startedAt } = JSON.parse(job.payload);
      // An interruption always starts with a read, even inside the replay window.
      let pi = await readProviderPayment(env, order, job, orderId ? dependencies.payment : null);
      const deadline = Date.now() - (startedAt ?? order.created_at) >= REPLAY_LIMIT_MS;
      const observation = { state: order.status, fulfilled: order.fulfilled_at, settled: job.state === 'paid_recording' || Boolean(order.paid_at) || Boolean(JSON.parse(job.payload).chain),
        provider: pi ? pi.status === 'succeeded' ? 'paid' : ['canceled','requires_payment_method'].includes(pi.status) ? 'refused' : 'processing' : 'absent', deadline };
      if (observation.settled && pi && pi.status !== 'succeeded') throw new Error(`Settled transfer needs Stripe recording: order ${order.id}; payment ${pi.id}`);
      switch (recoveryAction(observation)) {
        case 'fail':
          if (pi?.status === 'requires_payment_method') {
            pi = await stripeCall(env, 'POST', `/v1/payment_intents/${encodeURIComponent(pi.id)}/cancel`, {}, { idempotencyKey: `cancel-action-${pi.id}`, version: '2026-07-29.preview' });
            if (pi.status !== 'canceled') throw new Error('The unpaid payment could not be canceled; the claim remains reserved');
          }
          await releaseUnpaid(env, order, job, pi); continue;
        case 'replay': pi = await stripeCall(env, 'POST', '/v1/payment_intents', params, { ...options, version: '2026-07-29.preview' }); break;
        default:
          if (!pi) {
            if (deadline) throw new Error(`Paid transfer still needs recording: order ${order.id}; key ${options.idempotencyKey}`);
            pi = await stripeCall(env, 'POST', '/v1/payment_intents', params, { ...options, version: '2026-07-29.preview' });
          }
      }
      if (['requires_action','requires_confirmation','requires_capture','requires_payment_method'].includes(pi.status) || orderId && dependencies.cancel === true && pi.status === 'processing') pi = await stripeCall(env, 'POST', `/v1/payment_intents/${encodeURIComponent(pi.id)}/cancel`, {}, { idempotencyKey: `cancel-action-${pi.id}`, version: '2026-07-29.preview' });
      await recordProviderResult(env, order, job.id, pi);
      if (['canceled','requires_payment_method'].includes(pi.status)) { await releaseUnpaid(env, order, job, pi); continue; }
      if (pi.status !== 'succeeded') {
        if (Date.now() - (startedAt ?? order.created_at) >= REPLAY_LIMIT_MS && !['canceled','requires_payment_method'].includes(pi.status))
          await env.DB.prepare("UPDATE purchase_jobs SET state = 'manual_review', error = 'Provider payment remains unresolved after deadline' WHERE id = ?1").bind(job.id).run();
        continue;
      }
      if ((await byId(env, order.id)).payment !== pi.id) continue;
      const current = await byId(env, order.id);
      const final = recoveryAction({ state: current.status, fulfilled: current.fulfilled_at, provider: 'paid', settled: false, files: 'missing' });
      if (final === 'final' || final === 'preserve') {
        await env.DB.prepare("UPDATE purchase_jobs SET state = 'complete', updated_at = ?2 WHERE id = ?1").bind(job.id, Date.now()).run();
        continue;
      }
      const available = await resourceAvailable(env, order.resource_kind, JSON.parse(order.manifest));
      const action = recoveryAction({ state: current.status, fulfilled: current.fulfilled_at, provider: 'paid', settled: false, files: available ? 'present' : 'missing' });
      if (action === 'storage_retry') throw new Error('Paid files unavailable. Restore storage; payment is retained and delivery will retry.');
      if (action === 'deliver') {
        await recordOrderState(env, current, 'fulfilled');
        await env.DB.prepare("UPDATE purchase_jobs SET state = 'complete', updated_at = ?2 WHERE id = ?1").bind(job.id, Date.now()).run();
      }
    } catch (error) { await recordingFailure(env, job.id, error); }
  }
  return { checked: rows.length };
}

/** Resume even when the original isolate died before the provider callback. */
export async function reconcileSettlements(env, orderId = null, dependencies = {}) {
  const jobs = (await env.DB.prepare("SELECT * FROM purchase_settlements WHERE mode = ?1 AND state NOT IN ('complete','unpaid') AND (?2 IS NULL OR order_id = ?2) ORDER BY updated_at LIMIT 100").bind(modeOf(env.STRIPE_KEY), orderId).all()).results ?? [];
  for (const job of jobs) {
    try {
      const order = await byId(env, job.order_id);
      if (!order) throw new Error('Settlement order is missing');
      const reference = await resumeSettlement(env, job, dependencies);
      if (!reference) {
        await env.DB.prepare('UPDATE purchase_settlements SET updated_at = ?2 WHERE id = ?1').bind(job.id, Date.now()).run();
        continue;
      }
      if (reference.manual) {
        await env.DB.prepare("UPDATE purchase_settlements SET state = 'manual_review', error = ?2, updated_at = ?3 WHERE id = ?1").bind(job.id, reference.reason, Date.now()).run();
        continue;
      }
      if (reference.unpaid) {
        await env.DB.batch([
          env.DB.prepare("UPDATE purchase_settlements SET state = 'unpaid', error = ?2, updated_at = ?3 WHERE id = ?1").bind(job.id, reference.reason, Date.now()),
          orderFact(env, order.id, 'expired', {}),
          releaseClaim(env, order.id),
        ]);
        continue;
      }
      const payload = JSON.parse(job.payload);
      const params = { amount: order.amount, currency: order.currency, confirm: true,
        payment_method_data: { type: 'crypto' }, payment_method_types: ['crypto'],
        payment_method_options: { crypto: { mode: 'transaction_verification', transaction_verification_options: { network: job.network, transaction_hash: reference } } },
        metadata: { homie: 'purchase-v1', order: order.id, mpp_challenge_id: payload.challengeId, mpp_method: job.network === 'base' ? 'evm' : 'tempo' } };
      await saveRecording(env, order, params, { idempotencyKey: reference });
      await env.DB.prepare("UPDATE purchase_settlements SET state = 'complete', reference = ?2, error = NULL, updated_at = ?3 WHERE id = ?1").bind(job.id, reference, Date.now()).run();
    } catch (error) {
      await env.DB.prepare("UPDATE purchase_settlements SET error = ?2, updated_at = ?3, state = CASE WHEN ?4 THEN 'manual_review' ELSE state END WHERE id = ?1").bind(job.id, String(error.message).slice(0,500), Date.now(), Date.now() - job.created_at >= REPLAY_LIMIT_MS ? 1 : 0).run();
    }
  }
}
