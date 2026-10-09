/** Provider facts drive orders. Offers and entitlements are immutable purchase inputs. */
import { canonicalJson } from "./referrals.mjs";
import { digest } from "./purchase-crypto.mjs";


export const states = Object.freeze(['started','paid','fulfilled','refunded','disputed','lapsed','expired','failed','lost']);
export const transitions = Object.freeze({
 started: ['paid','refunded','expired','failed','lapsed'],
 paid: ['fulfilled','refunded','disputed','lapsed','lost'],
 fulfilled: ['refunded','disputed','lapsed','lost'],
 refunded: [],
 disputed: ['paid','fulfilled','refunded','lapsed','lost'],
 lapsed: ['paid','refunded','disputed'],
 expired: ['paid','refunded'], failed: ['paid','refunded'], lost: ['paid','refunded'],
});
export function transition(from, to, { renewal = false, refundReversal = false } = {}) {
  if ((renewal || refundReversal) && from === "refunded" && to === "paid") return to;
  if (
    !states.includes(from) ||
    !states.includes(to) ||
    (from !== to && !transitions[from].includes(to))
  )
    throw new Error(`Illegal purchase transition: ${from} -> ${to}`);
  return to;
}
export async function offerVersion(resource, terms) {
  const offer = { resource, terms };
  return { ...offer, version: await digest(canonicalJson(offer)) };
}
export function entitlement(order, offer) {
  if (order.offerVersion !== offer.version)
    throw new Error("Order and offer version differ");
  return {
    order: order.id,
    buyer: order.buyer,
    resource: offer.resource,
    terms: structuredClone(offer.terms),
    active: ["paid", "fulfilled", "disputed"].includes(order.state),
  };
}

/** D1 compare-and-swap gives mppx its required shared atomic replay store. */
export function paymentStore(db, mode) {
  const keyOf = (key) => `payment:${mode}:${key}`;
  return {
    async get(key) {
      const row = await db
        .prepare("SELECT value FROM meta WHERE key = ?1")
        .bind(keyOf(key))
        .first();
      return row ? JSON.parse(row.value).value : null;
    },
    async put(key, value) {
      await this.update(key, () => ({ op: "set", value, result: undefined }));
    },
    async delete(key) {
      await this.update(key, () => ({ op: "delete", result: undefined }));
    },
    async update(key, fn) {
      const k = keyOf(key);
      for (let attempt = 0; attempt < 32; attempt++) {
        const row = await db
          .prepare("SELECT value FROM meta WHERE key = ?1")
          .bind(k)
          .first();
        const change = fn(row ? JSON.parse(row.value).value : null);
        if (change.op === "noop") return change.result;
        // Tombstones retain a unique revision, avoiding an ABA race on deletion.
        const value = JSON.stringify({
          revision: crypto.randomUUID(),
          value: change.op === "delete" ? null : change.value,
        });
        const result = row
          ? await db
              .prepare(
                "UPDATE meta SET value = ?2 WHERE key = ?1 AND value = ?3",
              )
              .bind(k, value, row.value)
              .run()
          : await db
              .prepare("INSERT OR IGNORE INTO meta (key,value) VALUES (?1,?2)")
              .bind(k, value)
              .run();
        if (result.meta.changes === 1) return change.result;
      }
      throw new Error("Payment state busy; retry the same request");
    },
  };
}

/** The purchase table is the sole lifecycle record. Provider facts use this writer only. */
export async function orderState(env, id) {
  const order = await env.DB.prepare("SELECT * FROM purchase_orders WHERE id = ?1").bind(id).first();
  return order && {...order, offerVersion:order.offer_version, state:order.status};
}
const mutable = new Set(['customer','subscription','paid_until','quantity','session','checkout_url','claim_hash','buyer','payment','tax','total','paid_at','refunded_at','refund','dispute','fulfilled_at','note']);
export function orderFact(env, id, fact, fields = {}, { renewal = false, refundReversal = false } = {}) {
  const target = fact === 'payment' ? 'paid' : fact;
  if (fact !== 'details' && !states.includes(target)) throw new Error(`Unknown purchase fact: ${fact}`);
  const allowed = fact === 'details' ? [] : states.filter((from) => {
    try { transition(from,target,{renewal,refundReversal}); return true; } catch { return false; }
  });
  // Expiry/failure cannot revoke money already accepted. Re-reading the same
  // payment preserves delivery and disputes; only reconciliation resolves them.
  const sources = factSources(fact, allowed);
  const status = fact === 'details' ? 'status' : `CASE ${target === 'paid' ? "WHEN status = 'fulfilled' THEN status " : ''}${target === 'fulfilled' ? "WHEN status = 'disputed' THEN status " : ''}WHEN status IN (${sources.map((v)=>`'${v}'`).join(',')}) THEN '${target}' ELSE status END`;
  const values = [id, Date.now()];
  const sets = [`status = ${status}`, 'updated_at = ?2'];
  if (target === 'paid' && fields.paid_at === undefined) fields = {...fields,paid_at:Date.now()};
  if (target === 'fulfilled') fields = {...fields,fulfilled_at:Date.now()};
  if (target === 'refunded' && fields.refunded_at === undefined) fields = {...fields,refunded_at:Date.now()};
  for (const [key,value] of Object.entries(fields)) {
    if (!mutable.has(key)) throw new Error(`Immutable purchase field: ${key}`);
    values.push(value ?? null);
    const parameter = `?${values.length}`;
    sets.push(`${key} = ${['paid_at','fulfilled_at'].includes(key) || key === 'payment' && !renewal ? `COALESCE(${key},${parameter})` : parameter}`);
  }
  return env.DB.prepare(`UPDATE purchase_orders SET ${sets.join(', ')} WHERE id = ?1`).bind(...values);
}
export async function recordOrderState(env, order, fact, fields, options) {
  await orderFact(env,order.id,fact,fields,options).run();
  const current = await orderState(env,order.id);
  return current && { ...current, factResult: { fact, applied: fact === 'details' || current.status === (fact === 'payment' ? 'paid' : fact), state: current.status } };
}

export function factSources(fact, allowed) {
  return fact === 'payment' ? ['started','expired','failed'] : ['expired','failed'].includes(fact) ? ['started'] : allowed;
}
export function factState(from, fact, options = {}) {
  if (fact === 'details') return from;
  const target = fact === 'payment' ? 'paid' : fact;
  const allowed = states.filter((state) => { try { transition(state, target, options); return true; } catch { return false; } });
  if (target === 'paid' && from === 'fulfilled' || target === 'fulfilled' && from === 'disputed') return from;
  return factSources(fact, allowed).includes(from) ? target : from;
}

export const releaseClaim = (env, id) => env.DB.prepare("UPDATE purchase_orders SET claim_hash = ?2 WHERE id = ?1 AND payment IS NULL AND paid_at IS NULL").bind(id, `released:${id}`);

/** Atomically reserve the first hosted session before processing its payment. */
export const bindHostedSession = (env,id,session) => env.DB.prepare('UPDATE purchase_orders SET session = ?2 WHERE id = ?1 AND (session IS NULL OR session = ?2)').bind(id,session).run();
