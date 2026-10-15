import {webhookSecret} from './stripe-bootstrap.mjs';
import { hasStripeKey } from './shop-links.mjs';
import { KEY_SHAPE, WEBHOOK_SECRET_SHAPE } from './stripe.mjs';
import { signingKey } from './purchase-keys.mjs';
import { recurringReady } from './purchase-store.mjs';

/** The hosted route and its office report use the same local configuration checks. */
export async function hostedReadiness(env, catalogue, recurring = false) {
  const missing = [];
  if (!env.DB || env.HOMIE_PREVIEW === '1') missing.push('Studio purchases need the deployed database');
  try { await signingKey(env); } catch { missing.push('Create a valid purchase signing key'); }
  if (!hasStripeKey(env) || !WEBHOOK_SECRET_SHAPE.test(await webhookSecret(env) ?? '') || !['stripe', 'stripe-managed'].includes(catalogue.shop?.purchasesTill ?? catalogue.shop?.till)) missing.push('Connect this studio shop to Stripe first');
  if (recurring && hasStripeKey(env) && !(await recurringReady(env))) missing.push('Reconnect the shop to verify subscription permissions and webhook events before selling recurring resources');
  return { ready: missing.length === 0, missing };
}
