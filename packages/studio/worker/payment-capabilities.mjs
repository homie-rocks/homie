/** Stripe-backed, non-settling permission checks. Never uses a card or a wallet. */
import { stripeCall, modeOf } from './stripe.mjs';
import { digest } from "./purchase-crypto.mjs";

export const MACHINE_API_VERSION = '2026-07-29.preview';
export async function probeMachinePayments(env, { fetcher = fetch } = {}) {
  const mode = modeOf(env.STRIPE_KEY);
  const result = { mode, key: await digest(env.STRIPE_KEY), checkedAt: Date.now(), machine: { card: false, tempo: false, base: false }, reasons: {}, configuration: {} };
  const call = (method, path, params) => stripeCall(env, method, path, params, { fetcher, version: MACHINE_API_VERSION });
  try {
    const profile = await call('GET', '/v2/network/business_profiles/me');
    if (!/^profile_/.test(profile?.id ?? '')) throw new Error('Create a Stripe business profile in the Dashboard');
    result.configuration.profile = profile.id;
    result.machine.card = true;
  } catch (e) {
    result.reasons.card = `${e.message}. Enable PaymentIntents Write and access to Business Profiles on this restricted key, create the account profile, then reconnect shop. SPT eligibility is controlled by Stripe.`;
  }
  try {
    const configs = await call('GET', '/v1/payment_method_configurations', { limit: 100 });
    if (!configs.data?.some((c) => c.active && c.crypto?.available && c.crypto?.display_preference?.value === 'on')) throw new Error('Stablecoins and Crypto is not active for this Stripe account. Request it in Stripe payment method settings; Stripe reviews eligibility and country support');
    for (const network of ['base']) {
      try {
        const listed = await call('GET', '/v1/crypto/deposit_addresses', { network });
        const address = listed.data?.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a.address));
        if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address.address)) throw new Error('Provision a Base deposit address in Stripe, then reconnect; this read-only check creates nothing');
        result.configuration[network] = address.address;
        result.machine[network] = true;
      } catch (e) { result.reasons[network] = `${e.message}. Enable Crypto Deposit Addresses access on this key and reconnect.`; }
    }
  } catch (e) { result.reasons.tempo = result.reasons.base = `${e.message}. Reconnect after Stripe enables this payment method.`; }
  result.reasons.tempo = 'Tempo is disabled until an official client completes route tests in both modes.';
  return result;
}
export async function machineCapabilities(env) {
  try {
    const cached = env.DB && await env.DB.prepare("SELECT value FROM meta WHERE key = 'purchase-capabilities'").first();
    const configured = JSON.parse(env.PURCHASE_PAYMENT_CAPABILITIES ?? '{}');
    const saved = cached ? JSON.parse(cached.value) : null;
    const record = saved?.key === configured.key && saved.checkedAt >= configured.checkedAt ? saved : configured;
    const configuration = JSON.parse(env.PURCHASE_MACHINE_PAYMENTS ?? '{}')[modeOf(env.STRIPE_KEY)];
    if (record.mode !== modeOf(env.STRIPE_KEY) || record.key !== await digest(env.STRIPE_KEY) || !configuration?.profile)
      return { ready: false, machine: {}, reasons: { setup: 'Reconnect shop to verify machine payment permissions and obtain the Stripe profile and deposit addresses.' } };
    const machine = { ...record.machine, tempo: false };
    if (configuration.manualRefunds !== true || !configuration.base || (record.mode === 'live' && (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET))) machine.base = false;
    return { ...record, machine, ready: Object.values(machine).some(Boolean) };
  } catch { return { ready: false, machine: {}, reasons: { setup: 'Reconnect shop to repair its payment configuration.' } }; }
}

/** Scheduled checks share connect's probe. Office and public discovery never probe Stripe. */
export async function refreshMachineCapabilities(env) {
  const prior = await machineCapabilities(env);
  if (prior.nextCheckAt > Date.now()) return prior;
  const record = await probeMachinePayments(env);
  const success = Object.values(record.machine).some(Boolean);
  record.failures = success ? 0 : (prior.failures ?? 0) + 1;
  record.nextCheckAt = Date.now() + (success ? 6 * 3600000 : Math.min(6 * 3600000, 300000 * 2 ** Math.min(record.failures - 1, 6)));
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES (?1,?2)")
    .bind('purchase-capabilities', JSON.stringify(record)).run();
  return record;
}
export async function notePaymentRefusal(env, method, error) {
  if ((error.statusCode ?? error.status) === 402 || error.type === 'card_error' || error.raw?.type === 'card_error') return;
  const record = await machineCapabilities(env);
  record.machine[method] = false;
  record.reasons = { ...record.reasons, [method]: String(error.message).slice(0,500) };
  record.checkedAt = Date.now();
  record.nextCheckAt = 0;
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES (?1,?2)")
    .bind('purchase-capabilities', JSON.stringify(record)).run();
}
