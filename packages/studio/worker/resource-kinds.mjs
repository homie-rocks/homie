/** Application composition. New resource kinds implement this interface, not payment routes. */
import { partResource } from './parts-resource.mjs';
const kinds = new Map();
export function registerResourceKind(kind, adapter) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(kind) || kinds.has(kind)) throw new Error('Invalid or duplicate resource kind');
  for (const method of ['list','get','quote','terms','validate','termsUrl','readFile','covers']) if (typeof adapter[method] !== 'function') throw new Error(`Resource adapter needs ${method}`);
  kinds.set(kind,Object.freeze({...adapter}));
}
export function resourceKind(kind) {
  const adapter = kinds.get(kind);
  if (!adapter) throw new Error(`Unknown resource kind: ${kind}`);
  return adapter;
}
export const hasResourceKind = (kind) => kinds.has(kind);
export async function listOffers(env,origin) {
  const offers=[];
  for (const [kind,adapter] of kinds) for (const offer of await adapter.list(env,origin)) offers.push({...offer,kind});
  return offers;
}
registerResourceKind('part',partResource);
