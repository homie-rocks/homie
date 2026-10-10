/** Studio licences use the shop's Stripe, order book, webhook and refund office. */
import {
  orderState,
  recordOrderState,
  entitlement,
} from "./purchase-core.mjs";

import { signingKey, publicKeys } from "./purchase-keys.mjs";

import { GRANT_AUDIENCE, PROOF_AUDIENCE, manifestHash, signGrant, verifyGrant } from "./purchase-crypto.mjs";
import { resourceKind } from "./resource-kinds.mjs";

import {
  json,
  fail,
  byId,
  bearer,
  purchasedResource,
  active,
  privateRelease,
  coveredPurchase,
  deliveryAllowed,
  resourceAvailable,
} from "./purchase-store.mjs";
export async function grantPurchase(env, origin, o, b = {}) {
  const bought = purchasedResource(o);
  const version = b.version ?? bought.version;
  const p =
    version === bought.version
      ? JSON.parse(o.manifest)
      : await privateRelease(env, o.resource_kind, bought.id, version);
  if (!p)
    return fail(503, "Release temporarily unavailable; retry this purchase");
  if (!(await coveredPurchase(env, origin, o, p)))
    return fail(
      403,
      "This version needs a new licence and a fresh price approval",
    );
  if (!(await resourceAvailable(env, o.resource_kind, p)))
    return fail(503, o.payment ? 'Paid file bytes are temporarily unavailable. The seller must restore storage. Do not pay again.' : 'Your chain payment settled but Stripe has not recorded it. Files are temporarily unavailable. Contact the seller for restoration or a manual refund to your original payer address. Do not pay again.');
  if (!active(o)) return fail(402, `Purchase is ${o.status}; delivery is unavailable`);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO purchase_grants (order_id,version,manifest_hash) VALUES (?1,?2,?3)",
  )
    .bind(o.id, p.version, await manifestHash(p))
    .run();
  const coreOrder = await recordOrderState(env, o, "fulfilled");
  const offerRow =
    coreOrder.offerVersion &&
    (await env.DB.prepare("SELECT value FROM purchase_offers WHERE version = ?1")
      .bind(coreOrder.offerVersion)
      .first());
  const rights = offerRow
    ? entitlement(coreOrder, JSON.parse(offerRow.value))
    : null;
  if (!rights || !rights.active)
    return fail(402, `Purchase is ${coreOrder.state}; delivery is unavailable`);
  await resourceKind(o.resource_kind).fulfill?.(env,origin,o);
  const key = await signingKey(env);
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: origin,
    aud: GRANT_AUDIENCE,
    sub: o.buyer,
    studio: o.buyer_label,
    offer: o.offer ? JSON.parse(o.offer) : bought.sale,
    jti: o.id,
    iat: now,
    claimVersion: o.claim_hash,
    resource: p.id,
    kind: o.resource_kind,
    version: p.version,
    manifest: await manifestHash(p),
    terms: resourceKind(o.resource_kind).terms(bought),
    quantity: o.quantity,
    game: o.game,
    mode: o.mode,
    paidUntil: o.paid_until,
    billing: bought.sale.billing,
    onRefund: bought.sale.onRefund,
    onExpiry: bought.sale.onExpiry,
  };
  return json({
    ok: true,
    entitlement: rights,
    token: await signGrant(key, { ...claims, exp: now + 300 }),
    proof: await signGrant(key, { ...claims, aud: PROOF_AUDIENCE }, true),
    hubProof:
      b.audience && /^https:\/\/[^/]+$/.test(b.audience)
        ? await signGrant(
            key,
            {
              iss: claims.iss,
              aud: b.audience,
              sub: claims.sub,
              jti: claims.jti,
              iat: claims.iat,
              resource: claims.resource,
              kind: claims.kind,
              version: claims.version,
              mode: claims.mode,
            },
            true,
          )
        : undefined,
    manifest: p,
    paidUntil: o.paid_until,
  });
}
