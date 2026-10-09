/** Owner-only dry exchange through the real resource endpoint, without a wallet credential. */
export async function dryPaymentExchange(env, origin, catalogue = {}) {
  const { listOffers } = await import('./resource-kinds.mjs');
  const resource = (await listOffers(env,origin)).find((r)=>r.offer.billing === 'one-time' && r.offer.currency === 'usd' && !r.offer.automaticTax && r.offer.taxBehavior !== 'exclusive');
  const release = resource;
  if (!release) return { verified: false, reason: 'No listed offer is eligible for a machine-payment challenge. Hosted Checkout remains available.' };
  const { machineResource } = await import('./purchase-machine.mjs');
  const { digest } = await import('./purchase-crypto.mjs');
  const { byClaim } = await import('./purchase-store.mjs');
  const claim = await digest(crypto.randomUUID());
  const claimHash = await digest(claim);
  try {
    const url = new URL(`/api/purchases/resource/${resource.kind}/${resource.id}/${release.version}`, origin);
    const request = new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: resource.kind, resource: resource.id, version: release.version, buyer: await digest(crypto.randomUUID()), claim, offerVersion: release.offerVersion, ...(release.offer.scope === 'game' ? { game: 'readiness-check' } : {}) }) });
    const challenge = await machineResource(request, env, url, catalogue, { dryRun: true });
    if (challenge.status !== 402) return { verified: false, reason: (await challenge.json()).detail ?? `Dry exchange answered ${challenge.status}` };
    const { Challenge } = await import('mppx');
    const parsed = Challenge.fromResponse(challenge);
    if (parsed.realm !== url.hostname || !parsed.expires) throw new Error('Challenge failed realm or expiry verification');
    return { verified: true, checkedAt: Date.now(), resource: resource.id, version: release.version, challenge: { method: parsed.method, intent: parsed.intent, realm: parsed.realm, expires: parsed.expires }, scope: 'A real unpaid request passed offer, storage, signing-key and Stripe permission checks and returned a parseable payment challenge. No wallet credential was submitted. Token eligibility, live settlement and refunds are not verified by this dry exchange.' };
  } catch (error) { return { verified: false, reason: error.message }; }
  finally {
    const order = await byClaim(env, claimHash);
    if (order) await env.DB.batch([
      env.DB.prepare("DELETE FROM purchase_orders WHERE id = ?1 AND status = 'started'").bind(order.id),
      env.DB.prepare("DELETE FROM resource_snapshots WHERE hash = ?1 AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE manifest_hash = ?1)").bind(order.manifest_hash),
      env.DB.prepare("DELETE FROM purchase_offers WHERE version = ?1 AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE offer_version = ?1)").bind(order.offer_version),
    ]);
  }
}
