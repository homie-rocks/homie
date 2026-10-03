/**
 * A studio's music/ and videos/ manifests (media/MEDIA.md): what the site shows,
 * and where each file's bytes come from (the studio's R2, a file in the repository
 * copied into the site, or an absolute https address).
 *
 * BIG MEDIA LIVES IN R2 (0.18.0). Once a studio has storage (`homie-studio storage add`), every public file of a
 * published song or video that is over `R2_OVER` bytes (studio.json `media.r2Over`), or that git leaves out of the
 * repository, goes to the studio's own bucket: `homie-studio media move` (and every `deploy`) uploads it, reads it
 * back and compares SHA-256, and only then records `r2: { key, sha256, bytes, at }` on the manifest's file. A deploy
 * build then stops carrying that file in the site's static assets, and the Worker serves the very same address
 * (`/<path>`) from R2, with byte ranges and the same cache headers. The local file is never deleted.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { isoDate } from './site.mjs';

export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const KINDS = {
  music: ['song', 'score', 'loop', 'stem', 'sfx'],
  videos: ['trailer', 'music-video', 'cutscene', 'clip'],
};
/** Cloudflare Workers static assets: one file may be at most 25 MiB. */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
/**
 * Over this many bytes a public file of a published entry is kept in the studio's R2 once it has storage (the
 * default for studio.json `media.r2Over`; `false` there keeps every file on the site unless `media move` names it).
 */
export const R2_OVER = 1024 * 1024;
/** Wrangler uploads one object of at most 300 MiB (`wrangler r2 object put`). */
export const MAX_PUT_BYTES = 300 * 1024 * 1024;
/** What R2 costs, said the same way everywhere (Cloudflare's R2 pricing page, read 2026-10-01). */
export const R2_COST = 'R2 is on the studio\'s own Cloudflare account. Serving its files costs nothing in bandwidth (R2 has no egress fees). Storage is free up to 10 GB-month, then US$0.015 per GB-month; uploads (Class A) are free up to 1 million a month and reads (Class B) up to 10 million a month. Cloudflare asks for a payment method on the account before R2 works, even inside the free tier.';
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
/** A file's address on the site: its path in the studio, each part encoded (the same before and after it moves to R2). */
const siteUrlOf = (root, abs) => `/${relative(root, abs).split(sep).map(encodeURIComponent).join('/')}`;
const relOf = (root, abs) => relative(root, abs).split(sep).join('/');
const fileOf = (abs) => { try { const st = statSync(abs); return st.isFile() ? st.size : null; } catch { return null; } };

/** studio.json `media.r2Over`: bytes over which a public file goes to R2, or null (`false`: only `media move <file>`). */
export function r2OverOf(studio) {
  const v = studio?.media?.r2Over;
  if (v === false || v === 'off') return null;
  return Number.isFinite(v) && v >= 0 ? v : R2_OVER;
}

/** Sizes for people: "45.4 MB", "1.20 GB". */
export const sizeOf = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
/** A size line as it was set: "1 MiB" for 1048576, else as sizeOf says it. */
export const lineOf = (n) => (n > 0 && n % 1048576 === 0 ? `${n / 1048576} MiB` : n > 0 && n % 1024 === 0 && n < 1048576 ? `${n / 1024} KiB` : sizeOf(n));

const hashes = new Map();
/** SHA-256 of a file, read in 8 MiB pieces; remembered per path, size and modified time for the life of the command. */
export function sha256File(abs) {
  const st = statSync(abs);
  const memo = `${abs}\0${st.size}\0${st.mtimeMs}`;
  if (hashes.has(memo)) return hashes.get(memo);
  const h = createHash('sha256');
  const fd = openSync(abs, 'r');
  const buf = Buffer.allocUnsafe(8 << 20);
  try {
    for (;;) { const n = readSync(fd, buf, 0, buf.length, null); if (!n) break; h.update(buf.subarray(0, n)); }
  } finally { closeSync(fd); }
  const hex = h.digest('hex');
  hashes.set(memo, hex);
  return hex;
}

/** The R2 record `media move` wrote on a manifest file (its key and the SHA-256 it read back from R2), or null. */
export function heldOf(f) {
  const r = f?.r2;
  return r && typeof r === 'object' && typeof r.key === 'string' && r.key && !r.key.startsWith('players/') && /^[0-9a-f]{64}$/.test(String(r.sha256 ?? '')) ? r : null;
}

/** Whether R2 has exactly this file: the size and the SHA-256 that `media move` read back from it. */
export function sameAsHeld(abs, held) {
  const bytes = fileOf(abs);
  return bytes !== null && held && Number(held.bytes) === bytes && sha256File(abs) === held.sha256;
}

/**
 * Every entry of one manifest with its files resolved, and why anything is left out.
 * `r2`: the studio has its own bucket (so a `key` is served at /media/<key>, and a file `media move` put there at its
 * own address). `deploy`: a build that goes live (`homie-studio deploy`, or Workers Builds): a file whose exact bytes
 * are in R2 is not copied into the site. Without it (a local `build`, `dev`), a file that is also on this computer is
 * still copied when it fits, because `wrangler dev`'s own R2 is empty.
 */
export function resolveMedia(root, kind, { r2 = false, deploy = false } = {}) {
  const manifest = readManifest(root, kind);
  const entries = [];
  const skipped = [];
  const notes = [];
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
      // A key from `media put` (before 0.18.0): served at /media/<key>, as it always was.
      if (typeof f.key === 'string' && f.key && r2) src = { from: 'r2', url: `/media/${f.key.split('/').map(encodeURIComponent).join('/')}` };
      // A file `media move` put in R2: served at its own address, from R2 once the site no longer carries it.
      const held = heldOf(f);
      if (!src && held && r2 && f.path) {
        const abs = inside(root, f.path);
        if (!abs) { skipped.push({ kind, item: item.slug, file: f.path, why: 'the path is outside the studio' }); continue; }
        const url = siteUrlOf(root, abs);
        const local = fileOf(abs);
        const fromR2 = { from: 'r2', url, key: held.key, bytes: Number(held.bytes) || null };
        if (local === null) src = fromR2;
        else if (!deploy) src = local <= MAX_ASSET_BYTES ? { from: 'site', url, abs, rel: relative(root, abs), bytes: local } : fromR2;
        else if (sameAsHeld(abs, held)) src = { ...fromR2, bytes: local };
        else if (local <= MAX_ASSET_BYTES) {
          src = { from: 'site', url, abs, rel: relative(root, abs), bytes: local };
          notes.push({ kind, item: item.slug, file: f.path, why: 'changed since it went to R2: the site carries this copy until `homie-studio media move` uploads it again (deploy does it when the studio has storage)' });
        } else {
          src = fromR2;
          notes.push({ kind, item: item.slug, file: f.path, why: `changed since it went to R2 (${held.at ?? 'earlier'}), and at ${sizeOf(local)} it is too big for the site: the page plays the copy in R2 until \`homie-studio media move ${f.path}\` uploads this one` });
        }
      }
      if (!src && f.path) {
        const abs = inside(root, f.path);
        if (!abs) { skipped.push({ kind, item: item.slug, file: f.path, why: 'the path is outside the studio' }); continue; }
        const bytes = fileOf(abs);
        if (bytes !== null) {
          if (bytes <= MAX_ASSET_BYTES) src = { from: 'site', url: siteUrlOf(root, abs), abs, rel: relative(root, abs), bytes };
          else skipped.push({ kind, item: item.slug, file: f.path, why: `${Math.round(bytes / 1048576)} MiB is over the 25 MiB the site serves itself: give the studio storage (homie-studio storage add; Cloudflare asks for a payment method first, so ask the person) and the next deploy moves it to R2 (or homie-studio media move ${f.path} now), or make it smaller` });
        } else if ((f.key || held) && !r2) skipped.push({ kind, item: item.slug, file: f.path, why: `the file is not on this computer and its copy in R2 ("${f.key ?? held.key}") needs the studio's storage (homie-studio storage add)` });
        else if (!f.key && !held && !f.url) skipped.push({ kind, item: item.slug, file: f.path, why: 'the file is not on this computer and has no R2 copy or url' });
      }
      if (!src && typeof f.url === 'string' && /^https:\/\//.test(f.url)) src = { from: 'url', url: f.url };
      if (!src) continue;
      files.push({
        role: String(f.role ?? 'file'), name: f.name ?? null, type: f.type ?? typeOf(f.path ?? f.key ?? f.url), bytes: f.bytes ?? src.bytes ?? null, bars: f.bars ?? null, url: src.url, from: src.from,
        // The Worker serves this address from R2 (the site does not carry it): the catalogue says which key.
        ...(src.from === 'r2' && src.key ? { r2: src.key } : {}),
        ...(src.abs ? { abs: src.abs, rel: src.rel } : {}),
      });
    }
    const main = kind === 'music' ? 'audio' : 'video';
    if (!files.some((f) => f.role === main)) { skipped.push({ kind, item: item.slug, why: `no playable "${main}" file reachable (see the file lines above)` }); continue; }
    if (kind === 'videos' && !isoDate(item.date) && !isoDate(item.made?.at)) notes.push({ kind, item: item.slug, file: 'date', why: 'no "date" (or made.at): its page names no upload date, so search engines will not show it as a video; add "date": "2026-09-30"' });
    entries.push({
      slug: item.slug, kind: KINDS[kind].includes(item.kind) ? item.kind : KINDS[kind][0], title: String(item.title).slice(0, 120), blurb: String(item.blurb ?? '').slice(0, 600),
      duration: Number.isFinite(item.duration) ? item.duration : null, bpm: Number.isFinite(item.bpm) ? item.bpm : null, key: item.key ?? null,
      lyrics: typeof item.lyrics === 'string' ? item.lyrics.slice(0, 8000) : null, credits: typeof item.credits === 'string' ? item.credits.slice(0, 600) : null,
      rights: item.rights && typeof item.rights === 'object' ? item.rights : null, for: item.for && typeof item.for === 'object' ? item.for : null,
      honesty: typeof item.honesty === 'string' ? item.honesty.slice(0, 600) : null, made: item.made?.at ? { at: item.made.at, provider: item.made.provider ?? null } : null,
      // When it came out (0.27.0): `date` (a day, or a day and a time), else when it was made (`made.at`). A video's
      // VideoObject needs it as its uploadDate; a song's MusicRecording says it as datePublished.
      date: isoDate(item.date) ?? isoDate(item.made?.at) ?? null,
      // A music manifest's `album` (or an entry's own): the songs' MusicAlbum.
      ...(kind === 'music' && typeof (item.album ?? manifest.album) === 'string' && (item.album ?? manifest.album).trim() ? { album: String(item.album ?? manifest.album).trim().slice(0, 120) } : {}),
      files,
    });
  }
  return { entries, skipped, notes };
}

/** Copy the site-served files into site/dist and return the catalogue rows (no local paths in them). */
export function buildMedia(root, dist, { r2 = false, deploy = false, log = () => {} } = {}) {
  const out = {};
  const skipped = [];
  const notes = [];
  let inR2 = 0;
  for (const kind of ['music', 'videos']) {
    const r = resolveMedia(root, kind, { r2, deploy });
    skipped.push(...r.skipped);
    notes.push(...r.notes);
    out[kind] = r.entries.map((e) => ({
      ...e,
      files: e.files.map(({ abs, rel, from, ...f }) => {
        if (from === 'site') { const dest = join(dist, rel); mkdirSync(dirname(dest), { recursive: true }); cpSync(abs, dest); }
        if (from === 'r2' && f.r2) inR2++;
        return f;
      }),
    }));
    if (out[kind].length) log(`${kind}: ${out[kind].map((e) => e.slug).join(', ')}`);
  }
  if (inR2) log(`${inR2} file(s) served from the studio's R2 at their own addresses (not in the site's files)`);
  for (const s of skipped) log(`${s.kind}/${s.item}${s.file ? ` ${s.file}` : ''}: ${s.why}`);
  for (const s of notes) log(`note: ${s.kind}/${s.item} ${s.file}: ${s.why}`);
  return { songs: out.music, videos: out.videos, skipped, notes };
}

/** The files git leaves out of the repository (its .gitignore): a deploy from another computer, or Workers Builds, would not have them. */
export function gitIgnored(root, rels) {
  if (!rels.length) return new Set();
  const r = spawnSync('git', ['check-ignore', '--stdin'], { cwd: root, input: `${rels.join('\n')}\n`, encoding: 'utf8' });
  if (r.status !== 0 && r.status !== 1) return new Set();
  return new Set(String(r.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean));
}

/**
 * What `media move` would do, file by file: every public file of a published song or video (or exactly the files
 * named), with its state:
 *   move       it goes to R2 (over the size, git leaves it out, or it was named; or it changed since it went there)
 *   r2         R2 already has these exact bytes (size and SHA-256 match the record)
 *   site       it stays on the site (small enough, and in the repository)
 *   media      it has a /media/<key> address from `media put` (left as it is)
 *   too-big    over the 300 MiB one Wrangler upload takes
 *   missing    not on this computer
 *   unlisted   named, but in no manifest
 */
export function mediaPlan(root, { over = R2_OVER, paths = null } = {}) {
  const want = paths ? new Set(paths.map((p) => { const abs = inside(root, relative(root, resolve(String(p)))); return abs ? relOf(root, abs) : String(p); })) : null;
  const found = [];
  const seen = new Set();
  for (const kind of ['music', 'videos']) {
    for (const item of readManifest(root, kind).items) {
      if (!item || typeof item !== 'object') continue;
      for (const f of Array.isArray(item.files) ? item.files : []) {
        if (!f || f.public === false || typeof f.path !== 'string') continue;
        const abs = inside(root, f.path);
        if (!abs) continue;
        const rel = relOf(root, abs);
        if (seen.has(rel) || (want ? !want.has(rel) : item.published !== true)) continue;
        seen.add(rel);
        found.push({ kind, slug: item.slug ?? null, role: String(f.role ?? 'file'), path: rel, abs, type: f.type ?? typeOf(rel), f });
      }
    }
  }
  const ignored = gitIgnored(root, found.map((r) => r.path));
  const rows = found.map(({ f, ...row }) => {
    const held = heldOf(f);
    if (typeof f.key === 'string' && f.key) return { ...row, state: 'media', why: `in R2 at /media/${f.key} since \`media put\`; left as it is` };
    if (row.path.startsWith('players/')) return { ...row, state: 'site', why: 'players/ is the players\' own part of the bucket' };
    const bytes = fileOf(row.abs);
    if (bytes === null) return { ...row, state: held ? 'r2' : 'missing', bytes: held ? Number(held.bytes) : null, ...(held ? { held } : { why: 'not on this computer' }) };
    const reason = want ? 'named' : over !== null && bytes > over ? `over ${lineOf(over)}` : ignored.has(row.path) ? 'git leaves it out of the repository' : null;
    if (held && sameAsHeld(row.abs, held)) return { ...row, bytes, state: 'r2', held };
    if (!reason && !held) return { ...row, bytes, state: 'site' };
    if (bytes > MAX_PUT_BYTES) return { ...row, bytes, state: 'too-big', why: `${sizeOf(bytes)} is over the 300 MiB one Wrangler upload takes: make a smaller delivery (the video skill's cuts are far smaller), or upload it with an S3 tool and record it by hand` };
    return { ...row, bytes, state: 'move', reason: held ? 'changed since it went to R2' : reason, ...(held ? { held } : {}) };
  });
  if (want) for (const p of want) if (!seen.has(p)) rows.push({ path: p, state: 'unlisted', why: 'not a public file of any entry in music/manifest.json or videos/manifest.json: add it to an entry first' });
  return rows;
}

/** After R2 has the file and its SHA-256 matched: record it on every manifest file with that path. */
export function recordMove(root, rel, { key, sha256, bytes, at = new Date().toISOString() }) {
  const touched = [];
  for (const kind of ['music', 'videos']) {
    const m = readManifest(root, kind);
    let hit = false;
    for (const item of m.items) {
      for (const f of Array.isArray(item?.files) ? item.files : []) {
        const abs = typeof f?.path === 'string' ? inside(root, f.path) : null;
        if (abs && relOf(root, abs) === rel) { f.bytes = bytes; f.r2 = { key, sha256, bytes, at }; hit = true; }
      }
    }
    if (hit) { writeManifest(root, kind, m); touched.push(relative(root, manifestPath(root, kind))); }
  }
  return touched;
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
