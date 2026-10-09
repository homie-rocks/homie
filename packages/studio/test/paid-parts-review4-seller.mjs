import { probeMachinePayments } from '../worker/payment-capabilities.mjs';
/** A local seller: the branch's real Worker entry over the review harness world, plus host accounting. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, worker, LIVE_KEY, TEST_KEY } from './paid-parts-review4-harness.mjs';
export { LIVE_KEY, TEST_KEY };
export async function seller(name, { key = LIVE_KEY, machine = { manualRefunds: true, profile: 'profile_test_61ExampleProfile' }, saleOpts = {}, shop = { till: 'stripe', currency: 'usd', items: [] }, allow = [] } = {}) {
  const w = await world(name, { key, saleOpts, shop });
  const mode = /live/.test(key) ? 'live' : 'test';
  if (machine) {
    w.st.depositAddresses = machine;
    const checked = await probeMachinePayments(w.env);
    w.env.PURCHASE_PAYMENT_CAPABILITIES = JSON.stringify({ ...JSON.parse(w.env.PURCHASE_PAYMENT_CAPABILITIES), ...checked });
  }
  if (machine) w.env.PURCHASE_MACHINE_PAYMENTS = JSON.stringify({ [mode]: { ...machine, manualRefunds: true } });
  const cat = { studio: { name: 'Part Studio' }, games: [], shop: { v: 1, ...shop } };
  const writeCat = () => writeFileSync(join(w.dist, 'games.json'), JSON.stringify(cat));
  writeCat();
  const release = w.release; w.release = async (...a) => { await release(...a); writeCat(); };
  const hosts = new Map(); const blocked = []; const log = [];
  const original = globalThis.fetch;
  const stripeHost = new URL(w.st.base).host;
  const handlers = new Map(); // host -> async (request) => Response
  w.handle = (host, fn) => handlers.set(host, fn);
  w.direct = (request) => worker.fetch(request, w.env, { waitUntil() {}, passThroughOnException() {} });
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
    const url = new URL(request.url);
    hosts.set(url.host, (hosts.get(url.host) ?? 0) + 1);
    log.push(`${request.method} ${url.host}${url.pathname}`);
    if (url.host === stripeHost) return original(input, init);
    if (url.host === 'seller.example') return w.direct(request);
    if (handlers.has(url.host)) return handlers.get(url.host)(request);
    if (allow.includes(url.host)) return original(input, init);
    blocked.push(`${request.method} ${url.host}${url.pathname}`);
    throw new TypeError(`blocked host ${url.host}`);
  };
  const close = w.close; w.close = async () => { globalThis.fetch = original; await close(); };
  return Object.assign(w, { hosts, blocked, log, stripeHost, original });
}
