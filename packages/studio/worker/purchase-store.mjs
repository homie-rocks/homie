import { hasStripeKey, shopMode } from './shop-links.mjs';
import { problem } from './purchase-problem.mjs';
/** Resource purchases share the studio's Stripe webhook and refund office. */
import { offerVersion } from "./purchase-core.mjs";

import { canonicalJson } from "./referrals.mjs";

import { modeOf } from "./stripe.mjs";

import { digest, manifestHash } from "./purchase-crypto.mjs";
import { resourceKind } from "./resource-kinds.mjs";

export { PURCHASE_MIGRATION, PURCHASE_MIGRATION_FILE, PURCHASE_STATE, PURCHASE_STATE_FILE } from './purchase-schema.mjs';
export const json = (body, status = 200) =>
  status >= 400 ? problem(status, body.message ?? body.detail ?? "Purchase refused", body) : Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  });
export const fail = problem;
const orderQuery = "SELECT o.*, COALESCE(r.manifest,o.manifest) AS manifest FROM purchase_orders o LEFT JOIN resource_snapshots r ON r.hash = o.manifest_hash";
export const byId = (env, id) => env.DB.prepare(`${orderQuery} WHERE o.id = ?1`).bind(id).first();
export const byClaim = (env, hash) => env.DB.prepare(`${orderQuery} WHERE o.claim_hash = ?1`).bind(hash).first();
export const idOf = (v) => (typeof v === "string" ? v : v?.id);
export const safeId = (v) => /^[a-z0-9][a-z0-9-]{0,47}$/.test(v ?? "");
export const versionOf = (v) =>
  /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[A-Za-z0-9.-]{1,40})?$/.test(v ?? "");
export const validBuyer = (v) => /^[a-f0-9]{64}$/.test(v ?? "");
export const bearer = (r) =>
  /^Bearer ([A-Za-z0-9_.-]+)$/.exec(r.headers.get("authorization") ?? "")?.[1];
export const termsOf = (o) =>
  o.offer ? JSON.parse(o.offer) : JSON.parse(o.manifest).sale;
export const purchasedResource = (o) => ({
  ...JSON.parse(o.manifest),
  sale: termsOf(o),
});
export const active = (o) =>
  ["paid", "fulfilled", "disputed"].includes(o.status) &&
  (!o.subscription || Number(o.paid_until) > Date.now());

export async function bodyOf(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("Send JSON");
  return JSON.parse(await limitedText(request));
}
export async function limitedText(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Send JSON");
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new Error("Request too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(bytes);
}
export async function privateRelease(env, kind, id, version) {
  if (!safeId(id) || !versionOf(version)) return null;
  return resourceKind(kind).get(env,id,version);
}
export async function listedRelease(env, origin, kind, id, version) {
  if (await env.DB.prepare("SELECT 1 FROM resource_retirements WHERE resource = ?1").bind(`${shopMode(env)}:${kind}:${id}`).first()) return null;
  const adapter = resourceKind(kind);
  if (adapter.listed) return adapter.listed(env,id,version,origin);
  const listed = (await adapter.list(env,origin)).find((r)=>r.id===id && r.version===version);
  if (!listed) return null;
  const resource = await privateRelease(env,kind,id,version);
  return resource && {resource,offer:listed.offer};
}
export async function coveredPurchase(env, origin, order, wanted) {
  const bought = purchasedResource(order);
  if (bought.id !== wanted.id) return false;
  const granted = await env.DB.prepare("SELECT manifest_hash FROM purchase_grants WHERE order_id = ?1 AND version = ?2").bind(order.id,wanted.version).first();
  if (granted) return granted.manifest_hash === await manifestHash(wanted);
  return resourceKind(order.resource_kind).covers(env,origin,bought,wanted);
}

export async function recurringReady(env) {
  try {
    const c = JSON.parse(env.PURCHASE_PAYMENT_CAPABILITIES ?? "{}");
    return (
      c.recurring === true &&
      c.mode === shopMode(env) &&
      c.key === (await digest(env.STRIPE_KEY))
    );
  } catch {
    return false;
  }
}

export async function deliveryAllowed(env, o) {
  if (o.mode !== shopMode(env)) return false;
  return (
    o.mode === "live" ||
    (
      await env.DB.prepare("SELECT value FROM purchase_test_approvals WHERE order_id = ?1")
        .bind(o.id)
        .first()
    )?.value === o.claim_hash
  );
}

/** Immutable order creation is shared by machine payments and the human fallback. */
export async function createPurchase(env, o) {
  const resource = JSON.parse(o.manifest);
  const kind = o.resource_kind;
  const adapter = resourceKind(kind);
  const offer = await offerVersion({ kind, id: resource.id, release: resource.version, manifest: o.manifest_hash }, JSON.parse(o.offer));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO resource_snapshots (hash,manifest) VALUES (?1,?2)").bind(o.manifest_hash,o.manifest),
    env.DB.prepare("INSERT INTO purchase_orders (id,resource_kind,resource_id,item,game,amount,currency,till,mode,status,created_at,updated_at,claim_hash,buyer,buyer_label,quantity,manifest,manifest_hash,offer_version,transport,accepted_at,terms_hash,quote_hash,offer,checkout_buyer) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'started',?10,?10,?11,?12,?13,?14,'',?15,?16,?17,?10,?18,?19,?20,?12)").bind(o.id,kind,resource.id,o.item,o.game,o.amount,o.currency,o.till,o.mode,now,o.claim_hash,o.buyer,o.buyer_label,o.quantity,o.manifest_hash,offer.version,o.transport ?? 'checkout',await digest(canonicalJson(adapter.terms({...resource,sale:offer.terms}))),await adapter.quote(resource,o.quantity,o.game,offer.terms),o.offer),
    env.DB.prepare("INSERT OR IGNORE INTO purchase_offers (version,value) VALUES (?1,?2)").bind(offer.version,JSON.stringify(offer)),
  ]);
}

/** Verify deliverability before either payment adapter can create a charge. */
export async function resourceAvailable(env, kind, resource) {
  const adapter = resourceKind(kind);
  for (const file of resource.files ?? []) {
    const object = await adapter.readFile(env,file,{head:true});
    if (!object || object.size !== file.bytes) return false;
  }
  return true;
}

/** Unpaid attempts have no durable entitlement; release their claims after expiry. */
export async function expireUnpaidMachineOrders(env) {
  const rows = (await env.DB.prepare(`SELECT id FROM purchase_orders WHERE transport = 'machine' AND status IN ('started','expired') AND created_at <= ?1 AND payment IS NULL AND NOT EXISTS (SELECT 1 FROM purchase_jobs j WHERE j.order_id = purchase_orders.id ) AND NOT EXISTS (SELECT 1 FROM purchase_settlements s WHERE s.order_id = purchase_orders.id) LIMIT 100`).bind(Date.now()-300000).all()).results ?? [];
  for (const row of rows) await env.DB.batch([
    env.DB.prepare("DELETE FROM purchase_jobs WHERE order_id = ?1 AND state = 'failed'").bind(row.id),
    env.DB.prepare("DELETE FROM purchase_orders WHERE id = ?1 AND payment IS NULL AND status IN ('started','expired')").bind(row.id),
  ]);
  return rows.length;
}
