import { hasStripeKey, shopMode } from './shop-links.mjs';
/** Studio licences use the shop's Stripe, order book, webhook and refund office. */
import {
  orderState,
  recordOrderState,
  entitlement,
} from "./purchase-core.mjs";

import { signingKey, publicKeys } from "./purchase-keys.mjs";

import { GRANT_AUDIENCE, PROOF_AUDIENCE, manifestHash, signGrant, verifyGrant } from "./purchase-crypto.mjs";
import { legalTerms, objectKey, publicFiles } from "./parts-sale.mjs";

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
} from "./purchase-store.mjs";
/** Protected content is never in ASSETS; withdrawn releases remain reachable by their buyer. */
export async function paidFile(...args) {
  try {
    return await servePaidFile(...args);
  } catch {
    return fail(
      503,
      "Purchase service temporarily unavailable. Retry with the same download credential.",
    );
  }
}
async function servePaidFile(
  request,
  env,
  url,
  id,
  version,
  path,
  type = "application/octet-stream",
) {
  if (!env.PURCHASE_MEDIA) return null;
  if (!env.PURCHASE_RATE_LIMITER) return fail(503, 'Deploy the purchase rate limiter');
  if (!(await env.PURCHASE_RATE_LIMITER.limit({ key: `files:${request.headers.get('cf-connecting-ip') ?? 'unknown'}` })).success) return fail(429, 'Too many file requests; retry shortly');
  const p = await privateRelease(env, 'part', id, version);
  if (!p?.sale) return null;
  const f = p.files.find((f) => f.path === path);
  if (path !== "part.json" && !f) return fail(404, "No such file");
  if (path === "part.json" || publicFiles(p).has(path)) {
    if (path === "part.json") return json(p);
    const obj = await env.PURCHASE_MEDIA.get(objectKey(f.sha256));
    return obj
      ? new Response(request.method === "HEAD" ? null : obj.body, {
          headers: {
            "content-type": type,
            "access-control-allow-origin": "*",
            "content-security-policy":
              "sandbox allow-scripts allow-pointer-lock",
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
          },
        })
      : fail(503, "File missing from storage");
  }
  let claims;
  try {
    for (const key of await publicKeys(env)) {
      try {
        claims = await verifyGrant(bearer(request), key, {
          issuer: url.origin,
          resource: id,
          kind: 'part',
          version,
        });
        break;
      } catch {
        /* retained verification key */
      }
    }
  } catch {
    return fail(503, "Seller signing keys unavailable");
  }
  if (!claims) return fail(402, "Buy this part before downloading its files");
  const o = await byId(env, claims.jti);
  const core = o && (await orderState(env, o.id));
  if (
    !o || o.resource_kind !== 'part' ||
    !(await deliveryAllowed(env, o)) ||
    !active(o) ||
    (core && !["paid", "fulfilled", "disputed"].includes(core.state)) ||
    o.buyer !== claims.sub ||
    o.claim_hash !== claims.claimVersion ||
    o.mode !== claims.mode ||
    !(await coveredPurchase(env, url.origin, o, p)) ||
    claims.manifest !== (await manifestHash(p))
  )
    return fail(403, "This purchase does not permit this download");
  const obj = await env.PURCHASE_MEDIA.get(objectKey(f.sha256));
  if (!obj) return fail(503, "File missing from storage");
  return new Response(request.method === "HEAD" ? null : obj.body, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    },
  });
}
