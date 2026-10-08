/** Zero-copy views of a save, suitable for SQLite values under the 2 MiB limit.
 * Store the count and all chunks atomically; reassemble before restore.
 */
export function chunks(bytes: Uint8Array, limit = 1_048_576): Uint8Array[] {
  if (!Number.isInteger(limit) || limit < 16 || limit > 2_000_000)
    throw new Error('nav: invalid chunk size');
  const result: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += limit) result.push(bytes.subarray(i, i + limit));
  return result;
}
export function joinChunks(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
