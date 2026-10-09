import { canonicalJson } from "./referrals.mjs";
export const GRANT_TYPE = 'homie-purchase-grant+jwt';
export const PROOF_TYPE = 'homie-purchase-proof+jwt';
export const PROOF_AUDIENCE = 'homie-purchase-evidence';
export const GRANT_AUDIENCE = 'homie-purchases';
export const digest = async (value) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const manifestHash = (resource) => digest(canonicalJson(resource));
export async function signGrant(key, claims, proof = false) {
  const { calculateJwkThumbprint, SignJWT } = await import('jose');
  return new SignJWT(claims).setProtectedHeader({ alg: 'Ed25519', typ: proof ? PROOF_TYPE : GRANT_TYPE, kid: await calculateJwkThumbprint(key.publicJwk) }).sign(key.privateKey);
}
export async function verifyGrant(token, jwk, { issuer, subject, resource, kind, version, proof = false, audience = proof ? PROOF_AUDIENCE : GRANT_AUDIENCE } = {}) {
  const { calculateJwkThumbprint, importJWK, jwtVerify } = await import('jose');
  const { payload, protectedHeader } = await jwtVerify(token, await importJWK(jwk, 'Ed25519'), { algorithms: ['Ed25519'], typ: proof ? PROOF_TYPE : GRANT_TYPE, issuer, audience, ...(subject ? { subject } : {}), requiredClaims: ['iss', 'aud', 'sub', 'iat', 'jti', 'resource', 'kind', 'version', ...(proof && audience !== PROOF_AUDIENCE ? [] : ['manifest']), 'mode', ...(proof ? [] : ['exp'])] });
  if (protectedHeader.kid !== await calculateJwkThumbprint(jwk) || (resource && payload.resource !== resource) || (kind && payload.kind !== kind) || (version && payload.version !== version)) throw new Error('The purchase proof is for another key or release');
  return payload;
}
