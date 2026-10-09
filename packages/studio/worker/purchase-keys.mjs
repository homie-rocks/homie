/** The licence key ring is a Worker secret, independent of referral statements and D1. */

export async function purchaseKeys(env) {
  let keys;
  try { keys = JSON.parse(env.PURCHASE_SIGNING_KEYS); } catch { throw new Error('Configure purchase signing keys before selling'); }
  if (!Array.isArray(keys) || !keys.length || !keys[0].d) throw new Error('Configure purchase signing keys before selling');
  return keys;
}
export async function signingKey(env) {
  const { importJWK } = await import('jose');
  const [jwk] = await purchaseKeys(env);
  return { privateKey: await importJWK(jwk, 'Ed25519'), publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x } };
}
export async function publicKeys(env) {
  const { calculateJwkThumbprint } = await import('jose');
  return Promise.all((await purchaseKeys(env)).map(async ({ kty, crv, x }) => {
    const jwk = { kty, crv, x };
    return { ...jwk, kid: await calculateJwkThumbprint(jwk), alg: 'Ed25519', use: 'sig' };
  }));
}
