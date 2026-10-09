/** Internal request authority. HTTP headers cannot manufacture this identity. */
const identities = new WeakMap();
export function withToolIdentity(request, identity) { identities.set(request, identity); return request; }
export function toolIdentity(request) { return identities.get(request) ?? null; }
