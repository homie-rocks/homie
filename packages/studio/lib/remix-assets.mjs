/**
 * A REMIX ARRIVES WITH ITS MODELS. The remix source (source.json) carries text only: the game's code, its
 * assets/manifest.json and RIGHTS.md. The original site also serves /games/<id>/assets.json (lib/asset-manifest.mjs
 * servedAssets): each asset's licence, what a remix gets, and for redistributable files their address and SHA-256.
 *
 *   include     fetched from the original studio's site, same origin as the source, checked by SHA-256 (and, for a
 *               model, by the safety rules), written where the original had it
 *   reference   not carried: a grey placeholder of the recorded size, and the origin named in RIGHTS.md
 *   none        a grey placeholder of the recorded size and "needs its own licence"
 *
 * At most 50 MB in all. Each entry of the remix's manifest records where it came from (`remixOf`), so RIGHTS.md and the
 * credits carry over; nothing is fetched from anywhere but the original site.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LIMITS, checkGlb } from '../assets/safety.mjs';
import { readManifest, syncCredits, writeManifest, writeRights } from './asset-manifest.mjs';

export const REMIX_ASSET_CAP = 50 * 1024 * 1024;
const SAFE_PATH = /^public\/[A-Za-z0-9._/-]{1,200}$/;

/** `game remix` after the text files are written: the original's assets, or placeholders. */
export async function fetchRemixAssets(root, id, source, { credit = {}, cap = REMIX_ASSET_CAP, log = () => {} } = {}) {
  const base = new URL(String(source));
  const at = new URL(base.pathname.replace(/source\.json$/, 'assets.json'), base);
  let body = null;
  try {
    const res = await fetch(at, { signal: AbortSignal.timeout(20_000) });
    if (res.ok) body = await res.json();
  } catch { body = null; }
  if (body?.kind !== 'homie-game-assets' || !Array.isArray(body.assets)) return { carried: false, why: 'the original serves no assets.json (a game made before 0.22.0, or one with no models)', fetched: [], placeholders: [], bytes: 0 };
  const gdir = join(root, 'games', id);
  const manifest = readManifest(root, id);
  const fetched = []; const placeholders = []; const failed = [];
  let total = 0;
  const { placeholderGlb, sha256 } = await import('./optimise.mjs').catch(() => ({}));
  for (const a of body.assets) {
    const entry = manifest.assets.find((x) => x.id === a.id);
    if (!entry) continue;
    entry.from = { ...(entry.from ?? {}), remixOf: { studio: credit.studio ?? null, game: credit.game ?? null, source: String(base), asset: a.id } };
    // The original studio owns what it made or generated; this remix does not.
    if (entry.license?.owner === 'studio') entry.license = { ...entry.license, owner: credit.studio ?? 'the original studio' };
    const files = (a.files ?? []).filter((f) => SAFE_PATH.test(String(f.path ?? '')) && !String(f.path).split('/').includes('..'));
    if (a.license?.remix === 'include' && files.length && files.every((f) => f.url && f.sha256)) {
      let ok = true;
      for (const f of files) {
        const url = new URL(String(f.url), at);
        if (url.origin !== at.origin) { failed.push({ asset: a.id, why: `${f.url} is on another site` }); ok = false; break; }
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) throw new Error(`answered ${res.status}`);
          const bytes = Buffer.from(await res.arrayBuffer());
          total += bytes.byteLength;
          if (total > cap) throw new Error(`the remix's assets passed ${Math.round(cap / 1024 / 1024)} MB`);
          const sum = createHash('sha256').update(bytes).digest('hex');
          if (sum !== f.sha256) throw new Error('its SHA-256 does not match the original\'s record');
          if (/\.glb$/i.test(f.path)) { const s = checkGlb(bytes, LIMITS.game); if (!s.ok) throw new Error(s.problems[0]); }
          mkdirSync(dirname(join(gdir, f.path)), { recursive: true });
          writeFileSync(join(gdir, f.path), bytes);
        } catch (error) { failed.push({ asset: a.id, file: f.path, why: error.message }); ok = false; break; }
      }
      if (ok) { fetched.push({ asset: a.id, files: files.map((f) => f.path) }); continue; }
    }
    // Not carried: a grey box of the size it had, so the game still runs, and a plain note.
    const model = (entry.files ?? []).find((f) => f.role === 'model' && SAFE_PATH.test(String(f.path ?? '')));
    if (model && placeholderGlb) {
      const size = a.size ?? entry.measured?.box?.size ?? [0.5, entry.measured?.heightM ?? 0.5, 0.5];
      const glb = Buffer.from(await placeholderGlb(size, { name: `${a.id}-placeholder` }));
      mkdirSync(dirname(join(gdir, model.path)), { recursive: true });
      if (!existsSync(join(gdir, model.path))) writeFileSync(join(gdir, model.path), glb);
      model.sha256 = sha256(glb);
      model.bytes = glb.byteLength;
    }
    entry.placeholder = true;
    entry.license = { ...(entry.license ?? {}), remix: 'none', notes: `${a.license?.remix === 'reference' ? `Fetch it from its origin${a.from?.origin ? ` (${a.from.origin})` : ''} under its own licence` : 'Needs its own licence'}: this remix has a grey placeholder of the same size in its place.` };
    placeholders.push({ asset: a.id, why: a.license?.remix === 'include' ? (failed.find((x) => x.asset === a.id)?.why ?? 'not served') : `its licence (${a.license?.kind ?? 'none'}) does not let a remix carry it` });
  }
  writeManifest(root, id, manifest);
  writeRights(root, id, manifest);
  syncCredits(root, id, manifest);
  log(`remix assets: ${fetched.length} carried, ${placeholders.length} placeholder(s)`);
  return { carried: true, fetched, placeholders, failed, bytes: total };
}
