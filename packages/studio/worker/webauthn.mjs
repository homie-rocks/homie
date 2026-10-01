/**
 * PASSKEYS (WebAuthn), verified in the studio's own Worker with WebCrypto and nothing else.
 *
 * What arrives from a browser is a PUBLIC key and signatures: worthless to anyone who copies them. The private key
 * never leaves the player's device (or its own sync: iCloud Keychain, Google Password Manager, a password manager).
 *
 * Checked on every ceremony (each check is a refusal somebody could otherwise walk through):
 *   - clientData.type is the ceremony that was asked for (a registration cannot be replayed as a sign-in);
 *   - clientData.challenge is one this site issued and has not spent (the caller passes it);
 *   - clientData.origin is this site (an https origin, or a loopback one for `homie-studio dev`);
 *   - the authenticator data's rpIdHash is SHA-256 of this site's host name;
 *   - the user-present flag is set (somebody touched or looked at the device);
 *   - on sign-in, the signature over authenticatorData || SHA-256(clientDataJSON) verifies against the stored key,
 *     and the signature counter did not go backwards (a counter that moves back is a cloned authenticator; one
 *     that is always 0 is normal, for synced passkeys).
 * Not checked, on purpose: attestation. Registration asks for `none`: a game studio has no reason to care which
 * brand of authenticator a player holds, and refusing some would lock real people out.
 *
 * Keys: ES256 (COSE -7, P-256) and RS256 (COSE -257), stored as a JWK. A tiny CBOR reader takes what an
 * attestation object and a COSE key contain (integers, byte and text strings, arrays, maps) and refuses the rest.
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

export function b64urlToBytes(text) {
  const s = String(text ?? '');
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32) {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return bytesToB64url(raw);
}

export async function sha256(input) {
  const bytes = typeof input === 'string' ? ENC.encode(input) : input;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export async function sha256Hex(text) {
  return [...await sha256(text)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Equal bytes, in time that does not depend on where they differ. */
export function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ------------------------------------------------------------------ CBOR (just enough) */

export function cborDecode(bytes, at = 0, depth = 0) {
  if (depth > 8) throw new Error('cbor-deep');
  if (at >= bytes.length) throw new Error('cbor-short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const head = bytes[at];
  const major = head >> 5;
  const minor = head & 31;
  let n = minor;
  let p = at + 1;
  if (minor === 24) { n = bytes[p]; p += 1; }
  else if (minor === 25) { n = view.getUint16(p); p += 2; }
  else if (minor === 26) { n = view.getUint32(p); p += 4; }
  else if (minor >= 27) throw new Error('cbor-unsupported-length');
  if (p > bytes.length) throw new Error('cbor-short');
  switch (major) {
    case 0: return [n, p];
    case 1: return [-1 - n, p];
    case 2: if (p + n > bytes.length) throw new Error('cbor-short'); return [bytes.subarray(p, p + n), p + n];
    case 3: if (p + n > bytes.length) throw new Error('cbor-short'); return [DEC.decode(bytes.subarray(p, p + n)), p + n];
    case 4: {
      if (n > 64) throw new Error('cbor-big');
      const list = [];
      for (let i = 0; i < n; i += 1) { const [v, q] = cborDecode(bytes, p, depth + 1); list.push(v); p = q; }
      return [list, p];
    }
    case 5: {
      if (n > 64) throw new Error('cbor-big');
      const map = new Map();
      for (let i = 0; i < n; i += 1) {
        const [k, q] = cborDecode(bytes, p, depth + 1);
        const [v, r] = cborDecode(bytes, q, depth + 1);
        map.set(k, v);
        p = r;
      }
      return [map, p];
    }
    default: throw new Error('cbor-unsupported');
  }
}

/* ------------------------------------------------------------------ authenticator data */

/** rpIdHash (32) | flags (1) | signCount (4) | [aaguid (16) | idLength (2) | credentialId | COSE key]. */
export function parseAuthData(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 37) throw new Error('authdata-short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[32];
  const out = {
    rpIdHash: bytes.subarray(0, 32),
    up: Boolean(flags & 0x01),
    uv: Boolean(flags & 0x04),
    backupEligible: Boolean(flags & 0x08),
    backedUp: Boolean(flags & 0x10),
    at: Boolean(flags & 0x40),
    signCount: view.getUint32(33),
  };
  if (!out.at) return out;
  if (bytes.length < 55) throw new Error('authdata-short');
  const idLen = view.getUint16(53);
  if (55 + idLen > bytes.length) throw new Error('authdata-short');
  out.credentialId = bytes.subarray(55, 55 + idLen);
  const [cose] = cborDecode(bytes, 55 + idLen);
  out.cose = cose;
  return out;
}

/** A COSE public key as { alg, jwk }: ES256 (P-256) or RS256 only. */
export function coseToJwk(cose) {
  if (!(cose instanceof Map)) throw new Error('cose');
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === -7) {
    if (cose.get(-1) !== 1) throw new Error('cose-curve');
    const x = cose.get(-2); const y = cose.get(-3);
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) throw new Error('cose-ec');
    return { alg, jwk: { kty: 'EC', crv: 'P-256', x: bytesToB64url(x), y: bytesToB64url(y) } };
  }
  if (kty === 3 && alg === -257) {
    const nn = cose.get(-1); const e = cose.get(-2);
    if (!(nn instanceof Uint8Array) || !(e instanceof Uint8Array) || nn.length < 256) throw new Error('cose-rsa');
    return { alg, jwk: { kty: 'RSA', n: bytesToB64url(nn), e: bytesToB64url(e) } };
  }
  throw new Error('cose-alg');
}

function algorithms(alg) {
  if (alg === -7) return { importAs: { name: 'ECDSA', namedCurve: 'P-256' }, verifyAs: { name: 'ECDSA', hash: 'SHA-256' } };
  if (alg === -257) return { importAs: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verifyAs: { name: 'RSASSA-PKCS1-v1_5' } };
  throw new Error('alg');
}

/** An ECDSA signature arrives DER-encoded; WebCrypto wants r || s, 32 bytes each. */
export function derToRaw(der) {
  if (der[0] !== 0x30) throw new Error('der');
  let p = 2;
  if (der[1] & 0x80) p = 2 + (der[1] & 0x7f);
  const int = () => {
    if (der[p] !== 0x02) throw new Error('der-int');
    const len = der[p + 1];
    let v = der.subarray(p + 2, p + 2 + len);
    p += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    if (v.length > 32) throw new Error('der-int');
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const raw = new Uint8Array(64);
  raw.set(int(), 0);
  raw.set(int(), 32);
  return raw;
}

/* ------------------------------------------------------------------ ceremonies */

/** Is `origin` this site: the same origin as the request, https (or http on a loopback address for dev). */
export function originOk(origin, site) {
  try {
    const o = new URL(origin);
    const s = new URL(site);
    if (o.origin !== s.origin) return false;
    return o.protocol === 'https:' || (o.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(o.hostname));
  } catch { return false; }
}

/** clientDataJSON: its type, challenge and origin. Returns { ok, client, bytes } or { ok: false, error }. */
function readClient(clientDataJSON, { type, challenge, site }) {
  let bytes; let client;
  try { bytes = b64urlToBytes(clientDataJSON); client = JSON.parse(DEC.decode(bytes)); } catch { return { ok: false, error: 'client-data' }; }
  if (!client || client.type !== type) return { ok: false, error: 'ceremony' };
  if (typeof client.challenge !== 'string' || !sameBytes(ENC.encode(client.challenge), ENC.encode(String(challenge ?? '')))) return { ok: false, error: 'challenge' };
  if (!originOk(client.origin, site)) return { ok: false, error: 'origin' };
  if (client.crossOrigin === true) return { ok: false, error: 'cross-origin' };
  return { ok: true, client, bytes };
}

/**
 * A registration (navigator.credentials.create): verifies it and returns the credential to keep:
 * { ok, id, alg, jwk, signCount, backedUp } or { ok: false, error }.
 */
export async function verifyRegistration(response, { challenge, site, rpId }) {
  if (!response || typeof response !== 'object') return { ok: false, error: 'response' };
  const c = readClient(response.clientDataJSON, { type: 'webauthn.create', challenge, site });
  if (!c.ok) return c;
  let auth;
  try {
    const [att] = cborDecode(b64urlToBytes(response.attestationObject));
    if (!(att instanceof Map) || !(att.get('authData') instanceof Uint8Array)) return { ok: false, error: 'attestation' };
    auth = parseAuthData(att.get('authData'));
  } catch (e) { return { ok: false, error: `attestation:${String(e.message).slice(0, 40)}` }; }
  if (!sameBytes(auth.rpIdHash, await sha256(rpId))) return { ok: false, error: 'rp' };
  if (!auth.up) return { ok: false, error: 'presence' };
  if (!auth.at || !auth.credentialId?.length || auth.credentialId.length > 1023) return { ok: false, error: 'credential' };
  let key;
  try { key = coseToJwk(auth.cose); } catch (e) { return { ok: false, error: String(e.message) }; }
  const id = bytesToB64url(auth.credentialId);
  if (response.id && response.id !== id) return { ok: false, error: 'credential-id' };
  // The key must import: a stored key that cannot verify would lock its player out later.
  try { await crypto.subtle.importKey('jwk', key.jwk, algorithms(key.alg).importAs, false, ['verify']); } catch { return { ok: false, error: 'key' }; }
  return { ok: true, id, alg: key.alg, jwk: key.jwk, signCount: auth.signCount, backedUp: auth.backedUp };
}

/**
 * A sign-in (navigator.credentials.get) against a stored credential { alg, jwk, signCount }:
 * { ok, signCount, uv } or { ok: false, error }.
 */
export async function verifyAssertion(response, stored, { challenge, site, rpId }) {
  if (!response || typeof response !== 'object' || !stored) return { ok: false, error: 'response' };
  const c = readClient(response.clientDataJSON, { type: 'webauthn.get', challenge, site });
  if (!c.ok) return c;
  let authBytes; let auth; let sig;
  try {
    authBytes = b64urlToBytes(response.authenticatorData);
    auth = parseAuthData(authBytes);
    sig = b64urlToBytes(response.signature);
  } catch { return { ok: false, error: 'assertion' }; }
  if (!sameBytes(auth.rpIdHash, await sha256(rpId))) return { ok: false, error: 'rp' };
  if (!auth.up) return { ok: false, error: 'presence' };
  let ok = false;
  try {
    const { importAs, verifyAs } = algorithms(Number(stored.alg));
    const key = await crypto.subtle.importKey('jwk', typeof stored.jwk === 'string' ? JSON.parse(stored.jwk) : stored.jwk, importAs, false, ['verify']);
    const clientHash = await sha256(c.bytes);
    const signed = new Uint8Array(authBytes.length + clientHash.length);
    signed.set(authBytes, 0);
    signed.set(clientHash, authBytes.length);
    ok = await crypto.subtle.verify(verifyAs, key, Number(stored.alg) === -7 ? derToRaw(sig) : sig, signed);
  } catch { ok = false; }
  if (!ok) return { ok: false, error: 'signature' };
  const before = Number(stored.signCount) || 0;
  if ((auth.signCount !== 0 || before !== 0) && auth.signCount <= before) return { ok: false, error: 'counter' };
  return { ok: true, signCount: auth.signCount, uv: auth.uv };
}
