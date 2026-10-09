/** Private R2 releases. Upload and verify before a deploy exposes the public offer. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listOwnParts, packedDir, packedVersions, publicPart, readPart, sha256, verifyFiles } from './parts.mjs';
import { objectKey, releaseKey } from "../worker/parts-sale.mjs";

export function paidReleases(root) {
  return listOwnParts(root).flatMap(({ id }) => packedVersions(root, id).map((version) => {
    const dir = packedDir(root, id, version); const part = readPart(dir);
    return part.sale ? { dir, part: publicPart({ ...part, share: true }) } : null;
  }).filter(Boolean));
}

/** The uploader uses the same Wrangler execution and read-back hashing as mediaMove. */
export async function uploadPaidParts(root, { bucket, put, hash, log = () => {} }) {
  const releases = paidReleases(root);
  if (!releases.length) return { releases: 0, files: 0 };
  if (!bucket) throw new Error('Paid parts need private R2 storage. Set up storage with homie-studio storage add before deploying. Never enable a public bucket domain.');
  const temp = mkdtempSync(join(tmpdir(), 'homie-parts-upload-')); const seen = new Set();
  try {
    const upload = async (key, path, expected) => {
      const before = await hash(`${bucket}/${key}`);
      if (before.code === 0 && before.sha256 === expected.sha256 && before.bytes === expected.bytes) return;
      if (before.code === 0 && key.startsWith('paid-parts/releases/')) throw new Error(`${key} already exists with different terms. A release is immutable`);
      const sent = await put(`${bucket}/${key}`, path);
      if (sent.code !== 0) throw new Error(`Paid part upload failed for ${key}. Nothing may be offered until storage is verified`);
      const got = await hash(`${bucket}/${key}`);
      if (got.code !== 0 || got.sha256 !== expected.sha256 || got.bytes !== expected.bytes) throw new Error(`Paid part upload failed integrity verification for ${key}`);
    };
    for (const { dir, part } of releases) {
      if (!verifyFiles(dir, part).ok) throw new Error(`Packed part ${part.id} ${part.version} no longer matches its files`);
      for (const f of part.files) {
        if (seen.has(f.sha256)) continue;
        await upload(objectKey(f.sha256), join(dir, f.path), f); seen.add(f.sha256);
      }
      const bytes = Buffer.from(JSON.stringify(part)); const file = join(temp, 'part.json'); writeFileSync(file, bytes);
      await upload(releaseKey(part.id, part.version), file, { sha256: sha256(bytes), bytes: bytes.length });
      log(`verified private part ${part.id} ${part.version} in R2`);
    }
    return { releases: releases.length, files: seen.size };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
