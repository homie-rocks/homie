/** Public links, QR and HTTP-safe IDs; the encoder is shared with the wall shell. */
export { qrSvg } from '../worker/qr.mjs';
export function randomId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export function appLink(address, params = {}, base = globalThis.location?.href) {
  const url = new URL(address, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('links use an HTTP(S) address without credentials');
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  return url.href;
}
