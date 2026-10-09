/** Explicit sandbox readiness uses the same read-only facts as scheduled readiness. */
import { modeOf } from './stripe.mjs';
import { probeMachinePayments } from './payment-capabilities.mjs';
import { digest } from './purchase-crypto.mjs';
export async function testPaymentExchange(env) {
  if (modeOf(env.STRIPE_KEY) !== 'test') throw new Error('The sandbox readiness check requires a sandbox key');
  const key = await digest(env.STRIPE_KEY);
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'purchase-test-exchange'").first();
  const prior = row ? JSON.parse(row.value) : null;
  if (prior?.key === key && prior.nextCheckAt > Date.now()) return prior;
  const observed = await probeMachinePayments(env);
  const verified = Object.values(observed.machine).some(Boolean);
  const report = { key, checkedAt: Date.now(), verified,
    nextCheckAt: Date.now() + (verified ? 6 * 3600000 : 300000),
    reason: verified ? null : Object.values(observed.reasons).join('; '),
    scope: 'Read-only sandbox configuration check. No sale, PaymentIntent, entitlement or refund was created. Write permissions and real settlement remain unverified.' };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('purchase-test-exchange',?1)").bind(JSON.stringify(report)).run();
  return report;
}
