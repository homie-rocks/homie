/**
 * THE HOMIE STARTER LIBRARY, from a studio: free CC0 models, materials and skies (Kenney, KayKit, Poly
 * Haven, ambientCG), each optimised to Homie's phone budgets, with a thumbnail, its measurements, its licence, its
 * origin and its SHA-256. Hosted by homie.rocks (https://homie.rocks/api/library/v0/); built by the repository's
 * scripts/library.mjs.
 *
 *   searchLibrary(index, "fox forest", { kind, family })   ranked items (free, no account)
 *   addFromLibrary(root, game, itemId, { as, height })       the item COPIED into games/<id>/public/models/ (checked by
 *                                                            SHA-256 and the safety rules), with its manifest entry:
 *                                                            route library, licence cc0, origin, pack, measurements
 *
 * A game never loads anything from homie.rocks at runtime: what it uses is copied in, so it works if the library moves.
 * HOMIE_LIBRARY (a folder, or another address) points the studio at another copy of the library, such as a local one.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { LIMITS, checkGlb } from '../assets/safety.mjs';
import { recordAsset } from './asset-manifest.mjs';
import { GAME_ID } from './studio.mjs';

export const LIBRARY_URL = 'https://homie.rocks/api/library/v0';
const CACHE = join(homedir(), '.cache', 'homie-studio', 'library');
const INDEX_MAX = 16 * 1024 * 1024;
const FILE_MAX = 16 * 1024 * 1024;

/** Where the library is: HOMIE_LIBRARY (a folder or an address), else homie.rocks. */
export function libraryBase(from = process.env.HOMIE_LIBRARY) {
  const v = String(from ?? '').trim();
  if (!v) return { kind: 'url', base: LIBRARY_URL };
  if (/^https?:\/\//i.test(v)) return { kind: 'url', base: v.replace(/\/+$/, '') };
  const dir = resolve(v.replace(/^~(?=$|\/)/, homedir()));
  return { kind: 'dir', base: dir };
}

async function getBytes(lib, rel, cap) {
  if (!/^[A-Za-z0-9._/-]+$/.test(rel) || rel.split('/').includes('..')) throw new Error(`not a library path: ${rel}`);
  if (lib.kind === 'dir') {
    const file = join(lib.base, rel);
    if (!existsSync(file)) throw new Error(`the library at ${lib.base} has no ${rel}`);
    if (statSync(file).size > cap) throw new Error(`${rel} is over ${Math.round(cap / 1024 / 1024)} MB`);
    return readFileSync(file);
  }
  const res = await fetch(`${lib.base}/${rel}`, { headers: { 'user-agent': 'homie-studio' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`the library answered ${res.status} for ${rel}${res.status === 404 && rel === 'index.json' ? ' (it is not online at this address yet; HOMIE_LIBRARY can point at a local copy)' : ''}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > cap) throw new Error(`${rel} is over ${Math.round(cap / 1024 / 1024)} MB`);
  return bytes;
}

/** The library's index: from the folder, or fetched (kept a day in the home folder's .cache/homie-studio/library). */
export async function loadIndex({ lib = libraryBase(), fresh = false } = {}) {
  let text = null;
  if (lib.kind === 'url') {
    const cached = join(CACHE, `${createHash('sha256').update(lib.base).digest('hex').slice(0, 12)}-index.json`);
    if (!fresh && existsSync(cached) && Date.now() - statSync(cached).mtimeMs < 24 * 3600_000) text = readFileSync(cached, 'utf8');
    else { text = (await getBytes(lib, 'index.json', INDEX_MAX)).toString('utf8'); mkdirSync(CACHE, { recursive: true }); writeFileSync(cached, text); }
  } else text = (await getBytes(lib, 'index.json', INDEX_MAX)).toString('utf8');
  const index = JSON.parse(text);
  if (index?.kind !== 'homie-starter-library' || !Array.isArray(index.items)) throw new Error('that is not a Homie starter library index');
  return { index, lib };
}

const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
const stem = (w) => w.replace(/(ies)$/, 'y').replace(/(es)$/, '').replace(/s$/, '');

/**
 * Ranked matches for `query`: [{ item, score, why }]. Every word counts: a tag or name hit beats a pack hit; `kind`,
 * `family`, `pack` and `rigged` filter; a smaller file wins a tie (phones).
 */
export function searchLibrary(index, query, { kind = null, family = null, pack = null, rigged = null, limit = 12 } = {}) {
  const q = words(query).map(stem);
  const out = [];
  for (const it of index.items) {
    if (kind && it.kind !== kind) continue;
    if (family && it.family !== family) continue;
    if (pack && it.pack !== pack) continue;
    if (rigged !== null && Boolean(it.rigged) !== Boolean(rigged)) continue;
    const tags = new Set((it.tags ?? []).flatMap(words).map(stem));
    const name = new Set(words(`${it.name} ${it.item}`).map(stem));
    const packWords = new Set(words(`${it.pack} ${it.family}`).map(stem));
    let score = 0;
    const why = [];
    for (const w of q) {
      if (name.has(w)) { score += 3; why.push(w); } else if (tags.has(w)) { score += 2; why.push(w); } else if (packWords.has(w)) score += 0.5;
      else if ([...name, ...tags].some((t) => t.length > 3 && (t.startsWith(w) || w.startsWith(t)))) { score += 1; why.push(`${w}~`); }
    }
    if (!q.length) score = 1;
    if (score > 0) out.push({ item: it, score: score - Math.min(0.4, (it.files?.[0]?.bytes ?? 0) / 4_000_000), why });
  }
  return out.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id)).slice(0, limit);
}

/** One item's file bytes, checked by SHA-256 against the index and by the GLB safety rules. */
export async function fetchItemFile(lib, item, file = item.files?.find((f) => f.role === 'model') ?? item.files?.[0]) {
  if (!file) throw new Error(`${item.id} has no file`);
  const bytes = await getBytes(lib, file.path, FILE_MAX);
  const sum = createHash('sha256').update(bytes).digest('hex');
  if (file.sha256 && sum !== file.sha256) throw new Error(`${file.path}: its SHA-256 does not match the library's index (refused)`);
  if (/\.glb$/i.test(file.path)) { const s = checkGlb(bytes, LIMITS.game); if (!s.ok) throw new Error(`${file.path}: ${s.problems.join('; ')}`); }
  return { bytes, sha256: sum };
}

/** A library item's thumbnail as bytes (for cards), or null. */
export async function itemThumb(lib, item) {
  if (!item.thumb) return null;
  try { return await getBytes(lib, item.thumb, 512 * 1024); } catch { return null; }
}

const KIND_DIR = { texture: 'tex', sky: 'sky' };

/**
 * Copy one library item into a game and record it (assets/manifest.json, RIGHTS.md, credits.json). `as`: the asset's
 * id in the game (default: the item's own name); `height`: metres to scale it to (models; default its suggested size).
 * Returns { ok, asset, files, pinned }.
 */
export async function addFromLibrary(root, game, itemId, { as = null, height = null, card = null, lib = libraryBase(), index = null } = {}) {
  if (!GAME_ID.test(String(game ?? ''))) throw new Error(`"${game}" is not a game id`);
  const gdir = join(root, 'games', game);
  if (!existsSync(gdir)) throw new Error(`no game "${game}"`);
  const idx = index ?? (await loadIndex({ lib })).index;
  const item = idx.items.find((x) => x.id === itemId) ?? idx.items.find((x) => x.item === itemId);
  if (!item) throw new Error(`no library item "${itemId}" (assets find <words> lists them)`);
  if (item.license !== 'cc0') throw new Error(`${item.id} is not CC0; the starter library holds only CC0`);
  const id = String(as ?? item.item).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  const files = [];
  let measured = null;
  if (item.kind === 'texture' || item.kind === 'sky') {
    for (const f of item.files ?? []) {
      const { bytes, sha256 } = await fetchItemFile(lib, item, f);
      const rel = `public/${KIND_DIR[item.kind]}/${id}/${f.path.split('/').pop()}`;
      mkdirSync(dirname(join(gdir, rel)), { recursive: true });
      writeFileSync(join(gdir, rel), bytes);
      files.push({ role: f.role, path: rel, bytes: bytes.byteLength, sha256 });
    }
  } else {
    let { bytes, sha256 } = await fetchItemFile(lib, item);
    const rel = `public/models/${id}.glb`;
    mkdirSync(dirname(join(gdir, rel)), { recursive: true });
    const want = Number(height ?? item.suggestM ?? 0);
    let ops = [];
    if (want > 0 && item.heightM && Math.abs(want / item.heightM - 1) > 0.02) {
      // Scaled to the game's size here (the library's own file is unchanged; its SHA-256 is in from.sha256).
      const { optimiseModel } = await import('./optimise.mjs');
      const r = await optimiseModel(bytes, { height: want, triangles: 0, texture: Math.max(16, item.texturePx || 512), rigged: Boolean(item.rigged), metal: true });
      bytes = Buffer.from(r.glb);
      sha256 = r.sha256;
      ops = r.ops;
      measured = r.after;
    }
    writeFileSync(join(gdir, rel), bytes);
    files.push({ role: 'model', path: rel, bytes: bytes.byteLength, sha256 });
    if (ops.length) files[0].ops = ops;
  }
  const entry = {
    id, kind: item.kind === 'creature' ? 'creature' : item.kind, tier: item.tier ?? 'prop', card, route: 'library',
    from: { library: 'homie-starter', version: idx.version ?? 'v0', pack: item.pack, packLabel: idx.packs?.find((p) => p.id === item.pack)?.label ?? item.pack, packUrl: idx.packs?.find((p) => p.id === item.pack)?.url ?? null, item: item.id, author: item.author ?? null, origin: item.origin ?? null, sha256: item.files?.[0]?.sha256 ?? null, paletteSwap: Boolean(item.paletteSwap) },
    files,
    license: { kind: 'cc0', spdx: 'CC0-1.0', owner: item.author ?? null, attribution: null, notes: `From the Homie starter library (${item.pack}); the pack's own licence text: ${idx.packs?.find((p) => p.id === item.pack)?.licenseFile ?? 'licenses/'}` },
    measured: measured ? { tris: measured.triangles, materials: measured.materials, drawCalls: measured.drawCalls, textures: measured.textures.map((t) => ({ px: t.px, format: t.mimeType, gpuKB: Math.round(t.gpuBytes / 1024) })), bones: measured.bones, clips: measured.clips.length, heightM: measured.heightM, box: measured.box, glbKB: Math.round(files[0].bytes / 1024), flat: Boolean(item.paletteSwap) }
      : { tris: item.tris ?? null, materials: item.materials ?? null, drawCalls: item.drawCalls ?? null, bones: item.bones ?? 0, clips: (item.clips ?? []).length, heightM: item.heightM ?? null, box: item.box ? { size: item.box } : null, glbKB: Math.round((files[0]?.bytes ?? 0) / 1024), flat: Boolean(item.paletteSwap) },
    made: { steps: [{ what: 'library', item: item.id, sha256: item.files?.[0]?.sha256 ?? null }, ...(files[0]?.ops ? [{ what: 'optimise', tool: '@gltf-transform/functions', ops: files[0].ops }] : [])] },
    review: { state: 'auto' },
  };
  const { entry: e, pinned } = recordAsset(root, game, entry);
  return { ok: true, command: 'assets add', game, asset: e.id, item: item.id, files: files.map((f) => f.path), pinned, license: 'CC0 1.0' };
}

