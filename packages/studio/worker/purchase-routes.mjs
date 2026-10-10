import { purchaseLink } from './purchase-links.mjs';
import { hasStripeKey, shopMode } from './shop-links.mjs';
import { hostedReadiness } from './purchase-hosted-readiness.mjs';
import { orderFact, orderState, recordOrderState, offerVersion } from './purchase-core.mjs';
/** Studio licences use the shop's Stripe, order book, webhook and refund office. */

import { canonicalJson } from './referrals.mjs';
import { signingKey, publicKeys } from './purchase-keys.mjs';
import {
  createCheckoutSession,
  retrieveCheckoutSession,
  stripeCall,
  modeOf,
} from "./stripe.mjs";
import { newOrderId } from './shop-store.mjs';
import { esc } from './site.mjs';
import { digest, manifestHash, verifyGrant } from './purchase-crypto.mjs';
import { priceWords } from './purchase-pricing.mjs';
import { resourceKind, hasResourceKind } from './resource-kinds.mjs';

import {
  json,
  fail,
  byId,
  byClaim,
  safeId,
  versionOf,
  validBuyer,
  bearer,
  termsOf,
  active,
  bodyOf,
  limitedText,
  listedRelease,
  resourceAvailable,
  deliveryAllowed,
} from "./purchase-store.mjs";
import {
  reconcilePurchaseSession,
  reconcileSubscription,
  reconcileOrder,
} from "./purchase-reconciliation.mjs";
import { createPurchase } from './purchase-store.mjs';
import { grantPurchase } from './purchase-delivery.mjs';
export function purchaseSessionParams(o, origin, till) {
  const p = JSON.parse(o.manifest);
  const s = o.offer ? JSON.parse(o.offer) : p.sale;
  const recurring = s.billing !== "one-time";
  const metadata = { homie: "purchase-v1", order: o.id };
  return {
    mode: recurring ? "subscription" : "payment",
    client_reference_id: o.buyer,
    line_items: [
      {
        quantity: o.quantity,
        price_data: {
          currency: s.currency,
          unit_amount: s.amount,
          ...(s.taxBehavior ? { tax_behavior: s.taxBehavior } : {}),
          ...(recurring ? { recurring: { interval: s.billing } } : {}),
          product_data: {
            name: `${p.name} ${p.version}`,
            ...(s.taxCode ? { tax_code: s.taxCode } : {}),
            metadata: { resource: p.id, kind: o.resource_kind, version: p.version },
          },
        },
      },
    ],
    metadata,
    ...(o.expires_at ? { expires_at: o.expires_at } : {}),
    ...(recurring
      ? { subscription_data: { metadata } }
      : {
          payment_intent_data: { metadata },
          ...(s.customerCreation ? { customer_creation: "always" } : {}),
        }),
    ...(till === "stripe-managed"
      ? { managed_payments: { enabled: true } }
      : {
          ...(s.taxIdCollection
            ? { tax_id_collection: { enabled: true } }
            : {}),
          ...(!recurring && s.invoiceCreation
            ? { invoice_creation: { enabled: true } }
            : {}),
          automatic_tax: { enabled: s.automaticTax === true },
          ...(s.adaptivePricing === undefined
            ? {}
            : { adaptive_pricing: { enabled: s.adaptivePricing } }),
        }),
    allow_promotion_codes: s.promotionCodes === true,
    success_url: `${origin}/purchases/${o.id}?complete=1`,
    cancel_url: `${origin}/purchases/${o.id}`,
    custom_text: {
      submit: {
        message:
          `${s.immediateDelivery ? "I request immediate digital delivery and acknowledge that my withdrawal right ends when delivery begins. " : ""}Licence: ${s.scope}${o.game ? ` (${o.game})` : ""}. ${s.refund}`.slice(
            0,
            1200,
          ),
      },
    },
  };
}

/** All paths are within shop routing except JWKS (the publication router delegates it). */
export async function purchaseRoutes(
  request,
  env,
  url,
  cat,
  { verifyHuman = fetch } = {},
) {
  const path = url.pathname;
  if (
    path === "/purchases/keys.json"
  ) {
    if (request.method !== "GET") return fail(405, "GET only");
    if (!env.PURCHASE_SIGNING_KEYS)
      return fail(404, "Purchase signing keys are not initialized");
    try {
      return new Response(JSON.stringify({ keys: await publicKeys(env) }), {
        headers: {
          "content-type": "application/jwk-set+json",
          "access-control-allow-origin": "*",
        },
      });
    } catch {
      return fail(503, "Configure purchase signing keys before selling");
    }
  }
  if (!path.startsWith("/api/purchases/") && !path.startsWith("/purchases/"))
    return null;
  if (!cat.shop && request.method === 'GET' && path.startsWith('/purchases/') && !/^\/purchases\/ord_[A-Za-z0-9]{20}$/.test(path)) return null;
  if (!cat.shop) return fail(503, "The seller has not configured shop.json; no payment is available");
  if (env.HOMIE_PREVIEW === "1" || !env.DB)
    return fail(503, "Studio purchases need the deployed database");
  try {
    if (env.PURCHASE_RATE_LIMITER && !(await env.PURCHASE_RATE_LIMITER.limit({key: `${request.headers.get('cf-connecting-ip') ?? 'unknown'}:${request.method}`})).success) return fail(429, 'Studio purchase rate limit reached');
    if (path === "/api/purchases/mcp") {
      const { purchaseMcp } = await import("./purchase-mcp.mjs");
      return purchaseMcp(request, env, url, cat);
    }
    if (path === "/api/purchases/resource" || path.startsWith("/api/purchases/resource/")) {
      const { machineResource } = await import("./purchase-machine.mjs");
      return await machineResource(request, env, url, cat);
    }
    if (path === "/api/purchases/portal-login" && request.method === "GET") {
      const login = cat.shop?.purchasesPortalLogin;
      return /^https:\/\/billing\.stripe\.com\/p\/login\/[A-Za-z0-9_]+$/.test(
        login ?? "",
      )
        ? json({
            ok: true,
            url: login,
            message:
              "Stripe verifies your email. Obtain your receipt and manage billing there; give the receipt and a new claimHash to the seller to restore downloads.",
          })
        : fail(
            503,
            "Ask the seller to enable the Stripe customer portal login link; receipt-based seller reissue remains available",
          );
    }
    if (path === "/api/purchases/intent" && request.method === "POST") {
      return await createHostedIntent(request, env, url, cat);
    }

    const review = /^\/purchases\/(ord_[A-Za-z0-9]{20})$/.exec(path);
    if (review) {
      return await hostedPurchasePage(request, env, url, cat, review, verifyHuman);
    }
    if (path === "/api/purchases/verify" && request.method === "POST") {
      return await verifyPurchaseEvidence(request, env, url);
    }
    if (
      [
        "/api/purchases/grant",
        "/api/purchases/portal",
        "/api/purchases/recover",
        "/api/purchases/refund",
      ].includes(path) &&
      request.method === "POST"
    ) {
      return await claimedPurchase(request, env, url, path);
    }
    return fail(404, "No such studio purchase route");
  } catch (error) {
    if (/no such table/.test(error.message))
      return fail(503, "Deploy to apply the purchase migration");
    if (/Configure purchase signing/.test(error.message))
      return fail(503, error.message);
    if (error.status === 403 || error.status === 401)
      return fail(
        503,
        "Reconnect the shop with Invoices, Subscriptions and Customer portal permissions",
      );
    if (
      error instanceof SyntaxError ||
      /Send JSON|Request too large/.test(error.message)
    )
      return fail(400, error.message);
    return fail(
      503,
      "Payment or storage temporarily unavailable. Retry this purchase; do not pay again.",
    );
  }
}

async function createHostedIntent(request, env, url, cat) {
  const b = await bodyOf(request);
  if (
    !hasResourceKind(b.kind) || !safeId(b.resource) ||
    !versionOf(b.version) ||
    !validBuyer(b.buyer) ||
    !validBuyer(b.claimHash)
  )
    return fail(
      400,
      "Invalid resource, version, studio identity or purchase claim",
    );
  const listed = await listedRelease(env, url.origin, b.kind, b.resource, b.version);
  const p = listed?.resource;
  const offer = listed?.offer;
  if (
    (cat.shop?.purchasesTill ?? cat.shop?.till) === "stripe-managed" &&
    !offer?.taxCode
  )
    return fail(
      400,
      "Managed Payments requires an eligible product tax code",
    );
  if (!p?.sale || resourceKind(b.kind).validate({ ...p, sale: offer }).length)
    return fail(404, "This paid offer is not available");
  if (
    b.quote !== (await resourceKind(b.kind).quote(p, b.quantity ?? 1, b.game ?? null, offer)) && b.offerVersion !== (await offerVersion({ kind: b.kind, id: p.id, release: p.version, manifest: await manifestHash(p) }, offer)).version
  )
    return fail(
      409,
      "The quote changed. Read the price and terms and ask again",
    );
  const quantity = b.quantity ?? 1;
  const selectionErrors = resourceKind(b.kind).validate({ ...p, sale: offer }, { quantity, game: b.game ?? null });
  if (selectionErrors.length) return fail(400, selectionErrors.join('; '));
  const readiness = await hostedReadiness(env, cat, offer.billing !== 'one-time');
  if (!readiness.ready) return fail(503, readiness.missing.join('; '));
  const id = newOrderId();
  const now = Date.now();
  const intent = {
    id,
    resource_kind: b.kind,
    resource_id: p.id,
    item: `${b.kind}:${p.id}`,
    version: p.version,
    buyer: b.buyer,
    buyer_label: String(b.buyerName ?? "Buyer")
      .replace(/[\x00-\x1f]/g, " ")
      .slice(0, 80),
    claim_hash: b.claimHash,
    game: b.game ?? null,
    quantity,
    manifest_hash: await manifestHash(p),
    amount: offer.amount * quantity,
    currency: offer.currency,
    offerHash: await digest(canonicalJson(offer)),
    till: cat.shop.purchasesTill ?? cat.shop.till,
    mode: shopMode(env),
    status: "started",
    created_at: now,
  };
  const key = await signingKey(env);
  const { SignJWT } = await import("jose");
  const token = await new SignJWT(intent)
    .setProtectedHeader({ alg: "Ed25519", typ: "homie-purchase-intent+jwt" })
    .setIssuer(url.origin)
    .setAudience("homie-purchase-checkout")
    .setExpirationTime(
      Math.floor(now / 1000) + (offer.intentMinutes ?? 30) * 60,
    )
    .sign(key.privateKey);
  return json({
    ok: true,
    order: id,
    url: `${url.origin}/purchases/${id}?intent=${token}`,
  });
}

async function hostedPurchasePage(request, env, url, cat, review, verifyHuman) {
  let o = await byId(env, review[1]);
  if (!o) {
    try {
      const { jwtVerify, importJWK } = await import("jose");
      const { payload } = await jwtVerify(
        url.searchParams.get("intent"),
        await importJWK((await signingKey(env)).publicJwk, "Ed25519"),
        {
          algorithms: ["Ed25519"],
          typ: "homie-purchase-intent+jwt",
          issuer: url.origin,
          audience: "homie-purchase-checkout",
        },
      );
      if (payload.id !== review[1])
        return fail(403, "Intent identifies another purchase");
      const listed = await listedRelease(
        env,
        url.origin,
        payload.resource_kind,
        payload.resource_id,
        payload.version,
      );
      const p = listed?.resource;
      if (
        !p ||
        (await manifestHash(p)) !== payload.manifest_hash ||
        (await digest(canonicalJson(listed.offer))) !== payload.offerHash
      )
        return fail(
          410,
          "This offer changed or was withdrawn. Ask for a new quote",
        );
      o = {
        ...payload,
        offer: JSON.stringify(listed.offer),
        manifest: JSON.stringify(p),
      };
    } catch {
      return fail(410, "Purchase intent expired. Ask for a fresh quote");
    }
  }
  const p = JSON.parse(o.manifest);
  if (request.method === "POST") {
    if (
      (await orderState(env, o.id))
        ?.transport === "machine"
    )
      return fail(
        409,
        "This order uses a wallet payment; retry that exchange instead of Checkout",
      );
    if (request.headers.get("origin") !== url.origin)
      return fail(403, "Open this studio purchase page first");
    if (o.status !== "started")
      return fail(
        409,
        `Purchase is ${o.status}. Return to your assistant to retrieve it`,
      );
    if (o.mode !== shopMode(env))
      return fail(
        409,
        "The shop changed payment mode. Ask for a fresh quote",
      );
    const current = await listedRelease(env, url.origin, o.resource_kind, p.id, p.version);
    if (!current || JSON.stringify(current.offer) !== o.offer)
      return fail(410, "This offer was withdrawn");
    if (
      o.created_at <
      Date.now() - (JSON.parse(o.offer).intentMinutes ?? 30) * 60_000
    )
      return fail(
        410,
        "This purchase intent expired. Ask for a fresh quote",
      );
    const readiness = await hostedReadiness(env, cat, JSON.parse(o.offer).billing !== 'one-time');
    if (!readiness.ready) return fail(503, readiness.missing.join('; '));
    const formText = request.body ? await limitedText(request) : "";
    const form = new URLSearchParams(formText);
    if (env.TURNSTILE_SECRET) {
    const checked = await verifyHuman(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: form.get("cf-turnstile-response") ?? "",
          remoteip: request.headers.get("cf-connecting-ip") ?? "",
        }),
      },
    );
    const challenge = await checked.json();
    if (
      !challenge.success ||
      challenge.hostname !== url.hostname ||
      challenge.action !== "purchase-checkout"
    )
      return fail(403, "Complete the human check");
    }
    if (!(await byId(env, o.id))) await createPurchase(env, o);
    o = await byId(env, o.id);
    if (!hasStripeKey(env)) {
      const link = purchaseLink(env, o);
      if (!link) return fail(503, 'Run shop connect to sync this offer to Stripe Payment Links');
      if (!(await resourceAvailable(env, o.resource_kind, p))) return fail(503, 'Paid files unavailable; no payment requested');
      const checkout = new URL(link.url);
      checkout.searchParams.set('client_reference_id', o.id);
      await env.DB.prepare("INSERT OR IGNORE INTO meta (key,value) VALUES (?1,?2)").bind(`purchase-link:${o.id}`, JSON.stringify(link)).run();
      return Response.redirect(checkout, 303);
    }
    let checkout = o.checkout_url;
    if (!checkout) {
      if (!(await resourceAvailable(env, o.resource_kind, p)))
        return fail(503, "Paid files unavailable; no payment requested");
      const s = await createCheckoutSession(
        env,
        purchaseSessionParams(o, url.origin, o.till),
        { idempotencyKey: `purchase-${o.id}` },
      );
      if (!s?.id || !s?.url?.startsWith("https://"))
        return fail(502, "Stripe returned no checkout page");
      await env.DB.batch([
        orderFact(env, o.id, 'details', {session: s.id}),
        orderFact(env, o.id, 'details', {checkout_url: s.url}),
      ]);
      checkout = s.url;
    }
    return Response.redirect(checkout, 303);
  }
  if (request.method !== "GET") return fail(405, "GET or POST only");
  const s = o.offer ? JSON.parse(o.offer) : p.sale;
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Buy ${esc(p.name)}</title><main><h1>${esc(p.name)} ${esc(p.version)}</h1><p>${esc(cat.studio?.name ?? "Studio")} · ${esc(priceWords(s, o.quantity))} · ${esc(o.mode)} mode</p><p>Licence for studio ${esc(o.buyer_label)}${o.game ? `, game ${esc(o.game)}` : ""}. ${o.quantity} unit(s).</p><p>${esc(p.license)} · source ${s.source ? "included" : "not included"} · updates: ${esc(s.updates)} · commercial use: ${s.commercialUse ? "yes" : "no"} · transferable: ${s.transferable ? "yes" : "no"}</p><p>${esc(s.refund)}</p><p>After a full refund: ${esc(s.onRefund)} existing-use rights. After subscription expiry: ${esc(s.onExpiry)} existing-use rights.</p><p><a href="${esc(resourceKind(o.resource_kind).termsUrl(p))}">Read the full licence</a></p>${o.status === "started" ? `<form method="post">${env.TURNSTILE_SECRET ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITE_KEY ?? "")}" data-action="purchase-checkout"></div>` : ""}<p>By continuing you accept the licence for this studio and the price${s.billing !== "one-time" ? ", including recurring billing until cancelled in Stripe" : ""}. Tax and the final total appear on Stripe before you pay.</p><button>Accept and continue to Stripe · ${esc(priceWords(s, o.quantity))}</button></form>` : `<p>Purchase: ${esc(o.status)}. Return to your assistant to retrieve the files. Manage or cancel a subscription with the purchase's Stripe portal link from your assistant.</p>`}</main></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, private",
        "referrer-policy": "same-origin",
        "content-security-policy":
          "default-src 'none'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; form-action 'self' https://checkout.stripe.com https://buy.stripe.com; frame-ancestors 'none'; base-uri 'none'",
      },
    },
  );
}

async function verifyPurchaseEvidence(request, env, url) {
  const b = await bodyOf(request);
  if (!/^https:\/\/[^/]+$/.test(b.audience ?? ""))
    return fail(400, "Supply the hub HTTPS origin");
  let proof;
  for (const jwk of await publicKeys(env)) {
    try {
      proof = await verifyGrant(b.proof, jwk, {
        issuer: url.origin,
        proof: true,
        audience: b.audience,
      });
      break;
    } catch {
      /* try another retained public key */
    }
  }
  if (!proof) return fail(401, "Invalid purchase evidence");
  let o = await byId(env, proof.jti);
  if (o && o.mode === shopMode(env)) {
    await reconcileOrder(env, o);
    o = await byId(env, o.id);
  }
  return json({
    ok: true,
    current: Boolean(
      o &&
      (await deliveryAllowed(env, o)) &&
      active(o) &&
      o.buyer === proof.sub && o.resource_kind === proof.kind && o.resource_id === proof.resource &&
      proof.mode === o.mode &&
      o.mode === "live" &&
      shopMode(env) === "live",
    ),
    order: proof.jti,
    resource: proof.resource,
    kind: proof.kind,
    buyer: proof.sub,
    checkedAt: new Date().toISOString(),
  });
}

async function claimedPurchase(request, env, url, path) {
  const claim = bearer(request);
  if (!/^[a-f0-9]{64}$/.test(claim ?? ""))
    return fail(401, "Purchase claim required");
  let o = await byClaim(env, await digest(claim));
  if (!o) return fail(401, "Purchase claim unknown");
  const b = await bodyOf(request);
  if (o.mode !== shopMode(env))
    return fail(403, "Purchase belongs to another payment mode");
  if (
    o.status === "started" &&
    !o.session &&
    (await orderState(env, o.id))?.transport !==
      "machine" &&
    o.created_at <
      Date.now() -
        (JSON.parse(o.offer ?? o.manifest).intentMinutes ??
          termsOf(o).intentMinutes ??
          30) *
          60_000
  ) {
    await orderFact(env, o.id, 'expired', {})
      .run();
    o = await byId(env, o.id);
  }
  if (path.endsWith("/refund")) {
    if (o.subscription) {
      await reconcileSubscription(env, o);
      o = await byId(env, o.id);
    }
    const days = termsOf(o).refundWindowDays;
    let paidAt = Number(o.paid_at);
    if (o.subscription && o.payment) {
      const paid = await env.DB.prepare(
        "SELECT invoice FROM purchase_payments WHERE payment = ?1",
      )
        .bind(o.payment)
        .first();
      if (paid?.invoice) {
        const invoice = await stripeCall(
          env,
          "GET",
          `/v1/invoices/${encodeURIComponent(paid.invoice)}`,
        );
        paidAt =
          Number(
            invoice.status_transitions?.paid_at ?? invoice.created ?? 0,
          ) * 1000;
      }
    }
    if (o.paid_at && !o.payment) return fail(409, 'Stripe has not recorded this chain payment. Contact the seller for a direct refund to the original payer.');
    if (!o.paid_at) return fail(409, "This order is not paid; there is no payment to refund");
    if (
      !Number.isFinite(days) ||
      days <= 0 ||
      !paidAt ||
      Date.now() > paidAt + days * 86400000
    )
      return fail(
        403,
        "This purchase is outside the seller self-service refund window; contact the seller with your receipt",
      );
    const { refundOrder } = await import("./shop.mjs");
    return json(await refundOrder(env, o, { by: "buyer" }));
  }
  if (path.endsWith("/recover"))
    return json({
      ok: true,
      buyer: o.buyer,
      quantity: o.quantity,
      game: o.game,
      manifest: JSON.parse(o.manifest),
      order: o.id,
    });
  if (path.endsWith("/portal")) {
    if (!o.customer || o.mode !== shopMode(env))
      return fail(409, "No Stripe customer in the current payment mode");
    if (o.till === "stripe-managed")
      return json({ ok: true, url: "https://link.com" });
    if (!hasStripeKey(env)) return json({ok:false, message:'Use the seller’s Stripe customer portal login link or ask the seller to manage this subscription in Stripe.'});
    const portal = await stripeCall(
      env,
      "POST",
      "/v1/billing_portal/sessions",
      {
        customer: o.customer,
        return_url: `${url.origin}/purchases/${o.id}`,
      },
    );
    return json({ ok: true, url: portal.url });
  }
  if (
    hasStripeKey(env) && o.session &&
    o.status === "started" &&
    o.mode === shopMode(env)
  ) {
    await reconcilePurchaseSession(
      env,
      await retrieveCheckoutSession(env, o.session),
    );
    o = await byId(env, o.id);
  }
  if (o.mode === shopMode(env)) {
    await reconcileOrder(env, o);
    o = await byId(env, o.id);
  }
  if (!(await deliveryAllowed(env, o)))
    return fail(
      403,
      "Test files require owner approval for this test order; test orders never work in live mode",
    );
  if (!active(o))
    return json(
      {
        ok: false,
        status: o.status,
        paidUntil: o.paid_until,
        message: `Purchase is ${o.status}; downloads are not active`,
        onRefund: termsOf(o).onRefund,
        onExpiry: termsOf(o).onExpiry,
      },
      402,
    );
  return grantPurchase(env, url.origin, o, b);
}
