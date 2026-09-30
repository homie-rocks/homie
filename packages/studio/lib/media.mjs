/**
 * A studio's music/ and videos/ manifests (media/MEDIA.md): what the site shows,
 * and where each file's bytes come from (R2 key, a file in the repository copied
 * into the site, or an absolute https address).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';

export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const KINDS = {
  music: ['song', 'score', 'loop', 'stem', 'sfx'],
  videos: ['trailer', 'music-video', 'cutscene', 'clip'],
};
/** Cloudflare Workers static assets: one file may be at most 25 MiB. */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const TYPES = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.vtt': 'text/vtt', '.json': 'application/json',
};
export const typeOf = (path) => TYPES[(/\.[a-z0-9]+$/i.exec(String(path)) ?? [''])[0].toLowerCase()] ?? 'application/octet-stream';

export function manifestPath(root, kind) { return join(root, kind, 'manifest.json'); }

export function readManifest(root, kind) {
  const file = manifestPath(root, kind);
  if (!existsSync(file)) return { v: 1, items: [] };
  const m = JSON.parse(readFileSync(file, 'utf8'));
  return { v: 1, ...m, items: Array.isArray(m.items) ? m.items : [] };
}

export function writeManifest(root, kind, manifest) {
  mkdirSync(join(root, kind), { recursive: true });
  writeFileSync(manifestPath(root, kind), `${JSON.stringify({ v: 1, ...manifest }, null, 2)}\n`);
}

/** A path inside the studio, or null (no absolute paths, no `..` out of the repository). */
function inside(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || /^[a-z]+:/i.test(rel)) return null;
  const abs = resolve(root, normalize(rel));
  return abs.startsWith(`${resolve(root)}${sep}`) ? abs : null;
}

/**
 * Every entry of one manifest with its files resolved, and why anything is left out.
 * `r2`: the studio has its own bucket (so a `key` is served at /media/<key>).
 */
export function resolveMedia(root, kind, { r2 = false } = {}) {
  const manifest = readManifest(root, kind);
  const entries = [];
  const skipped = [];
  const seen = new Set();
  // The manifest's own picture (music: `cover`, videos: `poster`): an album cover for every song that has none of
  // its own. A path in the studio (copied into the site) or an https:// address, like any file.
  const artRole = kind === 'music' ? 'cover' : 'poster';
  const shared = manifest[artRole];
  const sharedFile = typeof shared === 'string' ? (/^https:\/\//.test(shared) ? { url: shared } : { path: shared }) : shared && typeof shared === 'object' ? shared : null;
  for (const item of manifest.items) {
    if (!item || typeof item !== 'object') continue;
    const label = item.slug ?? item.key ?? item.file ?? '(unnamed)';
    if (!SLUG.test(String(item.slug ?? '')) || !item.title) { if (item.published !== false) skipped.push({ kind, item: label, why: 'no slug and title: kept in the manifest, no page' }); continue; }
    if (seen.has(item.slug)) { skipped.push({ kind, item: label, why: 'a second entry with the same slug' }); continue; }
    seen.add(item.slug);
    if (item.published !== true) { skipped.push({ kind, item: label, why: 'not published yet ("published": true shows it)' }); continue; }
    const files = [];
    const own = Array.isArray(item.files) ? item.files : [];
    const list = sharedFile && !own.some((f) => f?.role === artRole) ? [...own, { ...sharedFile, role: artRole }] : own;
    for (const f of list) {
      if (!f || f.public === false) continue;
      let src = null;
      if (typeof f.key === 'string' && f.key && r2) src = { from: 'r2', url: `/media/${f.key.split('/').map(encodeURIComponent).join('/')}` };
      if (!src && f.path) {
        const abs = inside(root, f.path);
        if (!abs) { skipped.push({ kind, item: item.slug, file: f.path, why: 'the path is outside the studio' }); continue; }
        if (existsSync(abs) && statSync(abs).isFile()) {
          const bytes = statSync(abs).size;
          if (bytes <= MAX_ASSET_BYTES) src = { from: 'site', url: `/${relative(root, abs).split(sep).map(encodeURIComponent).join('/')}`, abs, rel: relative(root, abs), bytes };
          else skipped.push({ kind, item: item.slug, file: f.path, why: `${Math.round(bytes / 1048576)} MiB is over the 25 MiB the site serves itself: make it smaller, or give the studio storage (homie-studio storage add; Cloudflare asks for a payment method first, so ask the person) and upload it (homie-studio media put ${f.path})` });
        } else if (f.key && !r2) skipped.push({ kind, item: item.slug, file: f.path, why: `the file is not on this computer and its storage key "${f.key}" needs the studio's storage (homie-studio storage add)` });
        else if (!f.key && !f.url) skipped.push({ kind, item: item.slug, file: f.path, why: 'the file is not on this computer and has no R2 key or url' });
      }
      if (!src && typeof f.url === 'string' && /^https:\/\//.test(f.url)) src = { from: 'url', url: f.url };
      if (!src) continue;
      files.push({ role: String(f.role ?? 'file'), name: f.name ?? null, type: f.type ?? typeOf(f.path ?? f.key ?? f.url), bytes: f.bytes ?? src.bytes ?? null, bars: f.bars ?? null, url: src.url, from: src.from, ...(src.abs ? { abs: src.abs, rel: src.rel } : {}) });
    }
    const main = kind === 'music' ? 'audio' : 'video';
    if (!files.some((f) => f.role === main)) { skipped.push({ kind, item: item.slug, why: `no playable "${main}" file reachable (see the file lines above)` }); continue; }
    entries.push({
      slug: item.slug, kind: KINDS[kind].includes(item.kind) ? item.kind : KINDS[kind][0], title: String(item.title).slice(0, 120), blurb: String(item.blurb ?? '').slice(0, 600),
      duration: Number.isFinite(item.duration) ? item.duration : null, bpm: Number.isFinite(item.bpm) ? item.bpm : null, key: item.key ?? null,
      lyrics: typeof item.lyrics === 'string' ? item.lyrics.slice(0, 8000) : null, credits: typeof item.credits === 'string' ? item.credits.slice(0, 600) : null,
      rights: item.rights && typeof item.rights === 'object' ? item.rights : null, for: item.for && typeof item.for === 'object' ? item.for : null,
      honesty: typeof item.honesty === 'string' ? item.honesty.slice(0, 600) : null, made: item.made?.at ? { at: item.made.at, provider: item.made.provider ?? null } : null,
      files,
    });
  }
  return { entries, skipped };
}

/** Copy the site-served files into site/dist and return the catalogue rows (no local paths in them). */
export function buildMedia(root, dist, { r2 = false, log = () => {} } = {}) {
  const out = {};
  const skipped = [];
  for (const kind of ['music', 'videos']) {
    const r = resolveMedia(root, kind, { r2 });
    skipped.push(...r.skipped);
    out[kind] = r.entries.map((e) => ({
      ...e,
      files: e.files.map(({ abs, rel, from, ...f }) => {
        if (from === 'site') { const dest = join(dist, rel); mkdirSync(dirname(dest), { recursive: true }); cpSync(abs, dest); }
        return f;
      }),
    }));
    if (out[kind].length) log(`${kind}: ${out[kind].map((e) => e.slug).join(', ')}`);
  }
  for (const s of skipped) log(`${s.kind}/${s.item}${s.file ? ` ${s.file}` : ''}: ${s.why}`);
  return { songs: out.music, videos: out.videos, skipped };
}

/** `homie-studio media put`: record an uploaded file's R2 key on the entry that names it (or a bare entry). */
export function recordUpload(root, rel, key, bytes) {
  const kind = rel.startsWith('videos/') ? 'videos' : 'music';
  const m = readManifest(root, kind);
  let hit = false;
  for (const item of m.items) {
    for (const f of Array.isArray(item?.files) ? item.files : []) {
      if (f.path === rel) { f.key = key; f.bytes = bytes; hit = true; }
    }
  }
  if (!hit) m.items = [...m.items.filter((i) => i.key !== key), { key, file: rel, bytes, url: `/media/${key.split('/').map(encodeURIComponent).join('/')}`, at: new Date().toISOString() }];
  writeManifest(root, kind, m);
  return { kind, manifest: relative(root, manifestPath(root, kind)), entry: hit };
}
