import { selling } from './extensions.mjs';
const json = (v,status=200) => Response.json(v,{status});
export async function officeRoutes(request, env, path, body) {
  if (path === '/_studio/api/shop/readiness' && request.method === 'POST') return json(await selling.testPaymentExchange(env));
  if (['/_studio/api/shop/retire', '/_studio/api/shop/reissue', '/_studio/api/shop/test-access', '/_studio/api/shop/sync-offers', '/_studio/api/shop/reconcile-payments'].includes(path) && request.method === 'POST') {
    try { if (path.endsWith('/reconcile-payments')) { return json({ ok: true, ...await selling.reconcileRecordings(env, body.order ?? null, { payment: body.payment ?? null, cancel: body.cancel === true }) }); }
      if (path.endsWith('/test-access')) return json(await selling.authorizePurchaseTest(env, body.order));
      if (path.endsWith('/sync-offers')) return json(await selling.expirePurchaseCheckouts(env));
      return json(path.endsWith('/retire') ? await selling.retireResource(env, body.kind, body.resource) : await selling.reissuePurchaseClaim(env, body)); }
    catch (error) {
      if (error.status === 403 || error.status === 401) return json({ ok: false, message: 'Reconnect the shop with Checkout Sessions and Subscriptions Write permissions, then retry. New sales remain closed if retirement began.' }, 503);
      if (/no such table/.test(error.message)) return json({ ok: false, message: 'Deploy the purchase migrations first' }, 503);
      throw error;
    }
  }
  return null;
}
