#!/usr/bin/env node
/**
 * THE HOMIE STARTER LIBRARY, BUILT FROM ITS SOURCES (packages/studio/lib/library.mjs reads it; homie.rocks serves the
 * same tree at /api/library/v0/). Free CC0 models, materials and skies from Kenney, KayKit, Poly Haven and ambientCG,
 * each optimised to the phone budgets, measured, tagged, with a thumbnail, its licence, its origin and its SHA-256.
 * The packs are listed in scripts/library/sources.json.
 *
 *   node scripts/library.mjs fetch [--raw <dir>] [--only <pack id>]
 *       Downloads every pack into the raw folder (default ./library-raw): a Kenney pack's zip (its page names it), a
 *       KayKit repository's zip from its GitHub account, Poly Haven files through its public API (mirrored here, the
 *       API is never proxied), an ambientCG 1K-JPG zip through its API, and the licence pages of the two sites. One
 *       request at a time, with this tool's own User-Agent and a pause after each one. A file already there is kept
 *       when its SHA-256 matches the record (or Poly Haven's own MD5), so a second run asks for nothing. A zip that
 *       was put there by hand is adopted: its address is read off the pack's page and the zip is not downloaded
 *       again. Writes <raw>/fetched.json: every pack's address, SHA-256, bytes and date, and every file's.
 *
 *   node scripts/library.mjs build --raw <dir> --out <dir> [--only <pack id>] [--no-thumbs]
 *       Builds the library. Each pack's licence text is read FIRST: a pack whose text does not say CC0, Creative
 *       Commons Zero or public domain, or that names another licence, is refused whole and the reason printed. The
 *       text is copied to licenses/<pack>.txt as shipped. Then every selected model is optimised
 *       (packages/studio/lib/optimise.mjs: triangles by tier, pictures 512 px or 1,024 px for a character, skins and
 *       clips kept), measured, its colours read, tagged from its file name, folder and pack, and drawn as a 256 px
 *       thumbnail in one headless Chrome for many models (packages/studio/lib/render3d.mjs). A material becomes
 *       basecolor, normal (OpenGL style) and arm (AO, roughness, metalness) WebP pictures at 1,024 px; a sky its 1k
 *       .hdr and a small preview. A model that fails the GLB safety rules or the glTF validator, or stays over its
 *       tier's triangle budget, is left out and listed under `skipped` with the reason. Writes index.json.
 *       --only rebuilds one pack inside an existing library. --no-thumbs draws no model thumbnails, so no Chrome is
 *       needed (materials and skies still get theirs: they are pictures already).
 *
 *   node scripts/library.mjs check --out <dir>
 *       Reads every file index.json names again: its SHA-256 and size, the GLB safety rules on every model, each
 *       tier's budget, every thumbnail, every pack's licence file (it must still say CC0), and the counts. Prints the
 *       totals by family and kind; exits 1 on any problem.
 *
 *   node scripts/library.mjs search <words> --out <dir> [--kind prop] [--family kenney] [--limit 12]
 *       The best matches, ranked exactly as the studio ranks them (searchLibrary).
 *
 *   --sources <file> reads another list of packs (the tests use their own).
 *
 * The index is the contract between this tool, the studio and homie.rocks: every field of every item is written,
 * every SHA-256 is of the exact bytes at its path, and every item is CC0.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { LIMITS, checkGlb } from '../packages/studio/assets/safety.mjs';
import { dominant } from '../packages/studio/lib/colour.mjs';
import { searchLibrary } from '../packages/studio/lib/library.mjs';
import { albedoOf, inspectModel, modelTools, optimiseModel, selfContained, sha256 } from '../packages/studio/lib/optimise.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCES = join(HERE, 'library', 'sources.json');
export const TOOL = 'scripts/library.mjs';
export const UA = 'homie-starter-library/0.1 (+https://homie.rocks/studio/)';

/** Triangle budgets by tier (the studio's phone tier). */
export const TIERS = Object.freeze({ prop: 1500, signature: 5000, hero: 8000, kit: 1000 });
export const KINDS = Object.freeze(['prop', 'character', 'creature', 'kit', 'texture', 'sky']);
export const FAMILIES = Object.freeze(['kenney', 'kaykit', 'polyhaven', 'ambientcg']);
const SOURCE_KINDS = ['kenney', 'github', 'polyhaven', 'ambientcg'];
const PACK_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** The licence pages of the two sites whose API is the source (their files carry no licence file of their own). */
const LICENCE_PAGES = { polyhaven: 'https://polyhaven.com/license', ambientcg: 'https://docs.ambientcg.com/license/' };
/**
 * A base-colour picture with at most this many colours, counted at 16 levels a channel, is a palette (flat swatches,
 * or swatches with a soft ramp as Kenney's and KayKit's are), so a palette re-tint works on it. Measured: those
 * palettes have 130 to 160; a rendered scene with smooth shading has about 400, a photo more.
 */
const FLAT_COLOURS = 256;
const MATERIAL_PX = 1024;
const THUMB_PX = 256;
/** Thumbnails per Chrome: a fresh one after this many keeps a long run from slowing down. */
const THUMBS_PER_CHROME = 150;
const PAUSE_MS = 1500;

const today = () => new Date().toISOString().slice(0, 10);
const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const posix = (p) => p.split(sep).join('/');

/* ------------------------------------------------------------------ the sources */

/** The packs of a sources file, checked: a bad entry stops here, before anything is downloaded or built. */
export function readSources(file = SOURCES) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const packs = Array.isArray(json) ? json : json.packs;
  if (!Array.isArray(packs)) throw new Error(`${file}: no "packs" list`);
  const seen = new Set();
  for (const p of packs) {
    const where = `${file}: pack ${p?.id ?? '?'}`;
    if (!PACK_ID.test(String(p?.id ?? ''))) throw new Error(`${where}: the id must be lower-case words with dashes`);
    if (seen.has(p.id)) throw new Error(`${where}: listed twice`);
    seen.add(p.id);
    if (!FAMILIES.includes(p.family)) throw new Error(`${where}: family must be one of ${FAMILIES.join(', ')}`);
    if (p.license !== 'cc0') throw new Error(`${where}: the starter library holds only CC0 packs`);
    if (!SOURCE_KINDS.includes(p.source?.kind)) throw new Error(`${where}: source.kind must be one of ${SOURCE_KINDS.join(', ')}`);
    if (p.tier && !TIERS[p.tier]) throw new Error(`${where}: tier must be one of ${Object.keys(TIERS).join(', ')}`);
    if (p.kind && !KINDS.includes(p.kind)) throw new Error(`${where}: kind must be one of ${KINDS.join(', ')}`);
    for (const s of p.select ?? []) {
      const sel = typeof s === 'string' ? { glob: s } : s;
      if (!sel?.glob) throw new Error(`${where}: every select entry needs a glob`);
      if (sel.tier && !TIERS[sel.tier]) throw new Error(`${where}: ${sel.glob}: unknown tier ${sel.tier}`);
      if (sel.kind && !KINDS.includes(sel.kind)) throw new Error(`${where}: ${sel.glob}: unknown kind ${sel.kind}`);
    }
  }
  return packs;
}

/** Where a pack sits inside the raw folder. Poly Haven and ambientCG share one folder per site. */
export function rawDirOf(pack) {
  const s = pack.source;
  if (s.dir) return s.dir;
  if (s.kind === 'kenney') return `kenney/${s.slug}`;
  if (s.kind === 'github') return `${pack.family}/${s.repo.split('/').pop()}`;
  return pack.family;
}

/* ------------------------------------------------------------------ licences */

/**
 * Does this licence text make the pack CC0? { ok, line } with the line that says so, or { ok: false, why }. A text
 * that also names another licence (CC BY, NonCommercial, GPL, all rights reserved) is refused: a mixed pack needs a
 * person to read it, not this tool.
 */
export function licenceVerdict(text) {
  const t = String(text ?? '');
  const other = /\bCC[ -]?BY\b|Attribution[- ](?:NonCommercial|ShareAlike|NoDerivatives|NoDerivs|\d)|\bNon-?Commercial\b|\bShare-?Alike\b|\bAll rights reserved\b|\bGNU General Public\b|\bGPL\b/i.exec(t);
  const says = /\bCC0\b|\bCC-0\b|Creative Commons Zero|publicdomain\/zero|\bpublic domain\b/i;
  const line = t.split(/\r?\n/).map((l) => l.trim()).find((l) => says.test(l));
  if (!line) return { ok: false, why: 'its licence text does not say CC0, Creative Commons Zero or public domain' };
  if (other) return { ok: false, why: `its licence text also names another licence ("${other[0]}"): a person must read it` };
  return { ok: true, line: line.length > 160 ? `${line.slice(0, 157)}...` : line };
}

/**
 * The licence file inside a downloaded pack: License.txt, LICENSE, LICENSE.md, the one nearest its top (a KayKit
 * repository keeps it three or four folders down, in addons/<pack>/ or addons/<pack>/Assets/).
 */
export function findLicence(dir, depth = 4) {
  const isLicence = (name) => /^licen[cs]e(\.(txt|md))?$/i.test(name);
  let level = existsSync(dir) ? [dir] : [];
  for (let d = 0; d <= depth && level.length; d++) {
    const next = [];
    for (const at of level.sort()) {
      const entries = readdirSync(at, { withFileTypes: true });
      const hit = entries.find((e) => e.isFile() && isLicence(e.name));
      if (hit) return join(at, hit.name);
      next.push(...entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => join(at, e.name)));
    }
    level = next;
  }
  return null;
}

/** A web page as plain text: one line per block, entities decoded, scripts and styles gone. */
export function pageText(html) {
  const ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', para: '', copy: '(c)', mdash: '-', ndash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(p|div|h\d|li|br|section|tr|ul|ol|header|footer|nav|main|article|table|title|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ent[n.toLowerCase()] ?? m)
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

/* ------------------------------------------------------------------ zips */

/**
 * The files of a zip archive written under `dest` (plain Node: stored and deflated entries). `strip` drops leading
 * folders (a GitHub zip wraps everything in "<repo>-<branch>/"). A name that climbs out of `dest`, a zip64 archive and
 * an archive that unpacks to more than 4 GB are refused. macOS resource forks are skipped.
 */
export function unzip(zip, dest, { strip = 0, maxBytes = 4 * 1024 ** 3 } = {}) {
  const b = Buffer.isBuffer(zip) ? zip : Buffer.from(zip);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = b.readUInt16LE(eocd + 10);
  let at = b.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error('a zip64 archive (not read here)');
  let total = 0;
  const files = [];
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(at) !== 0x02014b50) throw new Error('a broken zip directory');
    const flags = b.readUInt16LE(at + 8); const method = b.readUInt16LE(at + 10);
    const csize = b.readUInt32LE(at + 20); const usize = b.readUInt32LE(at + 24);
    const nameLen = b.readUInt16LE(at + 28); const extraLen = b.readUInt16LE(at + 30); const commentLen = b.readUInt16LE(at + 32);
    const local = b.readUInt32LE(at + 42);
    const name = b.subarray(at + 46, at + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const parts = name.split('/');
    if (name.startsWith('/') || name.includes('\\') || /^[a-z]:/i.test(name) || parts.includes('..')) throw new Error(`the zip names ${name.slice(0, 80)}, outside its own folder`);
    if (parts[0] === '__MACOSX' || parts.at(-1) === '.DS_Store') continue;
    const rel = parts.slice(strip).join('/');
    if (!rel) continue;
    if (b.readUInt32LE(local) !== 0x04034b50) throw new Error(`a broken zip entry: ${name}`);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const raw = b.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`${name}: compression method ${method} is not read here`);
    if (data.length !== usize) throw new Error(`${name}: unpacked to ${data.length} bytes, the zip says ${usize}`);
    total += data.length;
    if (total > maxBytes) throw new Error('the zip unpacks to more than 4 GB');
    const file = join(dest, ...rel.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
    files.push(rel);
  }
  return files;
}

/** Write a file whole or not at all (a cut download never looks finished). */
function writeAtomic(file, bytes) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.part`, bytes);
  renameSync(`${file}.part`, file);
}

/** Unzip into a fresh folder beside `dir`, then put it in place of `dir`. */
function unzipInto(bytes, dir, opts) {
  const tmp = `${dir}.unzipping`;
  rmSync(tmp, { recursive: true, force: true });
  unzip(bytes, tmp, opts);
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
}

/* ------------------------------------------------------------------ fetch */

/** One request at a time to every site, with a pause after each, and this tool's User-Agent. */
function netClient({ pauseMs = PAUSE_MS, log = () => {} } = {}) {
  let last = 0;
  let count = 0;
  async function get(url, { as = 'bytes', max = 1536 * 1024 * 1024 } = {}) {
    const wait = last + pauseMs - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: as === 'json' ? 'application/json' : '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20 * 60_000) });
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > max) throw new Error(`${url} is ${mb(declared)}, over ${mb(max)}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      count += 1;
      log(`    got ${url} (${mb(bytes.length)})`);
      if (as === 'json') return JSON.parse(bytes.toString('utf8'));
      return as === 'text' ? bytes.toString('utf8') : bytes;
    } finally { last = Date.now(); }
  }
  return { get, requests: () => count };
}

const fileRecord = (path, url, bytes, fetched = today()) => ({ path, url, sha256: sha256(bytes), bytes: bytes.length, fetched });

/** A pack's record: one file is the source itself; several are summed (SHA-256 of their sorted "sha256  path" lines). */
function packRecord(files, url = null) {
  if (files.length === 1 && !url) { const f = files[0]; return { url: f.url, sha256: f.sha256, bytes: f.bytes, fetched: f.fetched, files }; }
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const digest = sha256(Buffer.from(sorted.map((f) => `${f.sha256}  ${f.path}\n`).join('')));
  return { url, sha256: digest, bytes: files.reduce((n, f) => n + f.bytes, 0), fetched: files.map((f) => f.fetched).sort().at(-1) ?? today(), files: sorted };
}

/**
 * A pack that is one zip: kept when it is already there and matches its record (or has none: it came by hand, and
 * only its address is looked up), else downloaded and unpacked.
 */
async function zipPack(pack, { raw, net, prev, log, zipUrl, strip = 0 }) {
  const dirRel = rawDirOf(pack);
  const zipRel = `${dirRel}.zip`;
  const zipAbs = join(raw, zipRel);
  if (existsSync(zipAbs)) {
    const bytes = readFileSync(zipAbs);
    const known = prev?.files?.find((f) => f.path === zipRel);
    if (!known || known.sha256 === sha256(bytes)) {
      if (!existsSync(join(raw, dirRel))) unzipInto(bytes, join(raw, dirRel), { strip });
      if (known) { log(`  ${pack.id}: already here, its SHA-256 matches`); return prev; }
      const url = await zipUrl();
      log(`  ${pack.id}: already here (${mb(bytes.length)}), adopted; its address is ${url}`);
      return packRecord([fileRecord(zipRel, url, bytes, statSync(zipAbs).mtime.toISOString().slice(0, 10))]);
    }
    log(`  ${pack.id}: the zip here does not match its record; downloading it again`);
  }
  const url = await zipUrl();
  const bytes = await net.get(url);
  writeAtomic(zipAbs, bytes);
  unzipInto(bytes, join(raw, dirRel), { strip });
  log(`  ${pack.id}: ${mb(bytes.length)} from ${url}`);
  return packRecord([fileRecord(zipRel, url, bytes)]);
}

/** A Kenney pack: its page links its zip (https://kenney.nl/media/pages/assets/<slug>/.../<name>.zip). */
async function fetchKenney(pack, ctx) {
  const zipUrl = async () => {
    const html = await ctx.net.get(pack.url, { as: 'text' });
    const m = html.match(new RegExp(`https://kenney\\.nl/media/pages/assets/${pack.source.slug}/[^"'\\s<>]+?\\.zip`));
    if (!m) throw new Error(`${pack.url} links no zip`);
    return m[0];
  };
  return zipPack(pack, { ...ctx, zipUrl });
}

/** A repository on GitHub: the zip of its default branch (or source.branch), from codeload. */
async function fetchGithub(pack, ctx) {
  const repo = pack.source.repo;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error(`"${repo}" is not owner/name`);
  const zipUrl = async () => {
    const branch = pack.source.branch ?? (await ctx.net.get(`https://api.github.com/repos/${repo}`, { as: 'json' })).default_branch;
    return `https://codeload.github.com/${repo}/zip/refs/heads/${encodeURIComponent(branch)}`;
  };
  return zipPack(pack, { ...ctx, zipUrl, strip: 1 });
}

/** A site's licence page, kept as text beside its files (read once; it is short and rarely changes). */
async function licencePage(family, { raw, net, dirRel }) {
  const rel = `${dirRel}/LICENSE.txt`;
  const abs = join(raw, rel);
  const url = LICENCE_PAGES[family];
  if (existsSync(abs)) { const bytes = readFileSync(abs); return fileRecord(rel, url, bytes, statSync(abs).mtime.toISOString().slice(0, 10)); }
  const text = pageText(await net.get(url, { as: 'text' }));
  const bytes = Buffer.from(`The licence of every ${family === 'polyhaven' ? 'Poly Haven' : 'ambientCG'} asset, as ${url} states it (read ${today()} by ${TOOL}).\n\n${text}\n`);
  writeAtomic(abs, bytes);
  return fileRecord(rel, url, bytes);
}

/** A JSON answer kept on disk, so a second run asks again for nothing. */
async function cachedJson(abs, get) {
  const have = readJson(abs);
  if (have) return have;
  const j = await get();
  writeAtomic(abs, Buffer.from(JSON.stringify(j, null, 1)));
  return j;
}

/** The files of one Poly Haven asset at `res` that the library uses: [{ rel, url, md5 }]. */
function polyHavenWanted(type, files, res) {
  const pick = (map) => { const f = files[map]?.[res]?.jpg; return f ? [{ rel: basename(new URL(f.url).pathname), url: f.url, md5: f.md5 }] : []; };
  if (type === 'models') {
    const g = files.gltf?.[res]?.gltf;
    if (!g) throw new Error(`no ${res} glTF`);
    const inc = Object.entries(g.include ?? {}).map(([rel, f]) => ({ rel, url: f.url, md5: f.md5 }));
    return [{ rel: basename(new URL(g.url).pathname), url: g.url, md5: g.md5 }, ...inc];
  }
  if (type === 'textures') {
    const out = [...pick('Diffuse'), ...pick('nor_gl')];
    const arm = pick('arm');
    out.push(...(arm.length ? arm : [...pick('AO'), ...pick('Rough'), ...pick('Metal')]));
    if (!pick('Diffuse').length || !pick('nor_gl').length) throw new Error(`no ${res} colour or OpenGL normal map`);
    return out;
  }
  const h = files.hdri?.[res]?.hdr;
  if (!h) throw new Error(`no ${res} .hdr`);
  return [{ rel: basename(new URL(h.url).pathname), url: h.url, md5: h.md5 }];
}

/** Poly Haven: the listing of its type, then each asset's info, file list and files (mirrored; MD5 checked). */
async function fetchPolyHaven(pack, { raw, net, log }) {
  const s = pack.source;
  const res = s.res ?? '1k';
  const dirRel = rawDirOf(pack);
  const files = [await licencePage('polyhaven', { raw, net, dirRel })];
  const listUrl = `https://api.polyhaven.com/assets?t=${s.type}`;
  const list = await cachedJson(join(raw, dirRel, `assets-${s.type}.json`), () => net.get(listUrl, { as: 'json' }));
  for (const id of s.ids ?? []) {
    if (!/^[A-Za-z0-9_-]+$/.test(id) || !list[id]) { log(`  ${pack.id}: ${id} is not a Poly Haven ${s.type} asset; left out`); continue; }
    const aRel = `${dirRel}/${s.type}/${id}`;
    await cachedJson(join(raw, aRel, 'info.json'), () => net.get(`https://api.polyhaven.com/info/${id}`, { as: 'json' }));
    const fl = await cachedJson(join(raw, aRel, 'files.json'), () => net.get(`https://api.polyhaven.com/files/${id}`, { as: 'json' }));
    let wanted;
    try { wanted = polyHavenWanted(s.type, fl, res); } catch (error) { log(`  ${pack.id}: ${id}: ${error.message}; left out`); continue; }
    for (const w of wanted) {
      if (w.rel.split('/').includes('..') || w.rel.startsWith('/')) throw new Error(`${id} names ${w.rel}, outside its folder`);
      const rel = `${aRel}/${w.rel}`;
      const abs = join(raw, rel);
      if (existsSync(abs)) { const have = readFileSync(abs); if (!w.md5 || md5(have) === w.md5) { files.push(fileRecord(rel, w.url, have, statSync(abs).mtime.toISOString().slice(0, 10))); continue; } }
      const bytes = await net.get(w.url);
      if (w.md5 && md5(bytes) !== w.md5) throw new Error(`${w.url}: its MD5 is not the one Poly Haven lists`);
      writeAtomic(abs, bytes);
      files.push(fileRecord(rel, w.url, bytes));
    }
    log(`  ${pack.id}: ${id}`);
  }
  return packRecord(files, listUrl);
}

/** ambientCG: each material's API record, then its zip at `res` (1K-JPG), unpacked beside it. */
async function fetchAmbientCg(pack, { raw, net, prev, log }) {
  const s = pack.source;
  const res = s.res ?? '1K-JPG';
  const dirRel = rawDirOf(pack);
  const files = [await licencePage('ambientcg', { raw, net, dirRel })];
  for (const id of s.ids ?? []) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) { log(`  ${pack.id}: ${id} is not an ambientCG id; left out`); continue; }
    const apiUrl = `https://ambientcg.com/api/v2/full_json?id=${id}&include=downloadData`;
    const info = await cachedJson(join(raw, dirRel, `${id}.json`), async () => (await net.get(apiUrl, { as: 'json' })).foundAssets?.[0] ?? {});
    const dl = info.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads?.find((d) => d.attribute === res);
    if (!dl) { log(`  ${pack.id}: ${id} has no ${res} zip; left out`); continue; }
    const zipRel = `${dirRel}/${id}_${res}.zip`;
    const zipAbs = join(raw, zipRel);
    const known = prev?.files?.find((f) => f.path === zipRel);
    let bytes = existsSync(zipAbs) ? readFileSync(zipAbs) : null;
    if (bytes && (known ? known.sha256 !== sha256(bytes) : bytes.length !== dl.size)) bytes = null;
    let rec;
    if (bytes) rec = known ?? fileRecord(zipRel, dl.downloadLink, bytes, statSync(zipAbs).mtime.toISOString().slice(0, 10));
    else {
      bytes = await net.get(dl.downloadLink);
      if (dl.size && bytes.length !== dl.size) throw new Error(`${dl.downloadLink}: ${bytes.length} bytes, the API says ${dl.size}`);
      writeAtomic(zipAbs, bytes);
      rec = fileRecord(zipRel, dl.downloadLink, bytes);
    }
    if (!existsSync(join(raw, dirRel, id))) unzipInto(bytes, join(raw, dirRel, id));
    files.push(rec);
    log(`  ${pack.id}: ${id}`);
  }
  return packRecord(files, 'https://ambientcg.com/api/v2/full_json');
}

const FETCHERS = { kenney: fetchKenney, github: fetchGithub, polyhaven: fetchPolyHaven, ambientcg: fetchAmbientCg };

/** Download every pack (or one) into `raw`; returns { ok, failed, requests }. */
export async function fetchSources({ raw, only = null, sources = readSources(), log = console.log, pauseMs = PAUSE_MS } = {}) {
  const packs = only ? sources.filter((p) => p.id === only) : sources;
  if (only && !packs.length) throw new Error(`no pack "${only}" in the sources`);
  mkdirSync(raw, { recursive: true });
  const recFile = join(raw, 'fetched.json');
  const rec = readJson(recFile) ?? { v: 1, tool: TOOL, packs: {} };
  const net = netClient({ pauseMs, log });
  const failed = [];
  for (const pack of packs) {
    log(`${pack.id} (${pack.url})`);
    try {
      rec.packs[pack.id] = await FETCHERS[pack.source.kind](pack, { raw, net, prev: rec.packs[pack.id], log });
      rec.updated = new Date().toISOString();
      writeAtomic(recFile, Buffer.from(`${JSON.stringify(rec, null, 1)}\n`));
    } catch (error) {
      failed.push({ pack: pack.id, why: error.message });
      log(`  ${pack.id}: NOT FETCHED: ${error.message}`);
    }
  }
  return { ok: !failed.length, failed, requests: net.requests() };
}

/* ------------------------------------------------------------------ words, names, tags, sizes */

/** "tree_pineTallA" -> ["tree", "pine", "tall", "a"]. */
export function wordsOf(s) {
  return String(s ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Folder and file words that say nothing about the thing itself. */
const PLAIN = new Set(['models', 'model', 'glb', 'gltf', 'format', 'fbx', 'obj', 'dae', 'assets', 'asset', 'export', 'exports', 'source', 'files', 'file',
  'kaykit', 'kenney', 'pack', 'bits', 'kit', 'and', 'the', 'of', 'with', 'an', 'in', 'on', 'for', 'to', 'by', 'addons', 'remastered']);
/** Words that should find each other in a search. */
const ALSO = {
  tree: ['plant'], pine: ['tree'], palm: ['tree'], bush: ['plant'], shrub: ['bush', 'plant'], flower: ['plant'], fern: ['plant'], grass: ['plant'], cactus: ['plant'],
  mushroom: ['fungus'], rock: ['stone'], boulder: ['rock', 'stone'], crate: ['box'], chest: ['box'], barrel: ['container'], sword: ['weapon'], axe: ['weapon', 'tool'],
  bow: ['weapon'], crossbow: ['weapon'], dagger: ['weapon'], staff: ['weapon'], blaster: ['gun', 'weapon'], shield: ['armour'], car: ['vehicle'], truck: ['vehicle'],
  kart: ['vehicle', 'car'], ship: ['boat'], boat: ['ship'], coin: ['pickup'], gem: ['jewel', 'pickup'], skeleton: ['undead'], zombie: ['undead'], ghost: ['spooky'],
  pumpkin: ['halloween'], knight: ['warrior'], barbarian: ['warrior'], mage: ['wizard'], rogue: ['thief'], couch: ['sofa'], sofa: ['couch'], lamp: ['light'],
  lantern: ['light', 'lamp'], torch: ['light', 'fire'], chair: ['seat'], stool: ['seat'],
};
/** The first word names the thing in these packs' names ("tree_oak" is an oak tree). */
const HEAD_FIRST = new Set(['tree', 'rock', 'plant', 'flower', 'mushroom', 'crop', 'cactus', 'bush', 'stump', 'log', 'stone', 'grass', 'lily', 'statue']);

/** A readable name from file-name words: "tree oak" -> "Oak tree", "rock large a" -> "Rock large A". */
export function nameOf(words) {
  const w = [...words];
  if (w[0] === 'animal' && w.length > 1) w.shift();
  if (w.length === 2 && HEAD_FIRST.has(w[0]) && /^[a-z]{2,}$/.test(w[1])) w.reverse();
  const s = w.map((x) => (x.length === 1 ? x.toUpperCase() : x)).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Tags, most telling first: the name's words, their companions, folder words, the source's own tags, the pack's theme. */
export function tagsFor({ nameWords = [], folderWords = [], extra = [], theme = [], kind = 'prop' }) {
  const out = [];
  const add = (w) => { const t = String(w ?? '').toLowerCase().trim(); if (t && t.length > 1 && !/^\d+$/.test(t) && !PLAIN.has(t) && !out.includes(t)) out.push(t); };
  nameWords.forEach(add);
  nameWords.forEach((w) => (ALSO[w] ?? []).forEach(add));
  folderWords.forEach(add);
  extra.forEach((e) => wordsOf(e).forEach(add));
  theme.forEach(add);
  ({ character: ['character', 'person'], creature: ['creature', 'animal'], kit: ['modular'], texture: ['material', 'texture'], sky: ['sky', 'hdri'] }[kind] ?? []).forEach(add);
  return out.slice(0, 24);
}

/** A sensible height in metres for a game, from the item's own words first, then its tags; null when nothing says. */
const SIZES = [
  [['person', 'human', 'character', 'knight', 'mage', 'barbarian', 'rogue', 'adventurer', 'warrior', 'man', 'woman', 'zombie'], 1.7],
  [['tree', 'palm', 'pine', 'oak', 'birch', 'fir'], 4],
  [['bush', 'shrub', 'hedge'], 1],
  [['rock', 'boulder'], 0.8],
  [['crate', 'barrel', 'box'], 1],
  [['chair', 'stool', 'sofa', 'couch'], 0.9],
  [['table', 'desk'], 0.8],
  [['door'], 2.1],
  [['fence'], 1],
  [['car', 'truck', 'vehicle', 'kart'], 1.5],
  [['house', 'building', 'cabin'], 6],
  [['flower', 'mushroom', 'fern'], 0.4],
  [['coin', 'gem', 'key'], 0.3],
  [['animal', 'pet', 'creature', 'dog', 'cat', 'fox', 'bunny', 'rabbit', 'pig', 'cow', 'sheep', 'chick', 'chicken', 'duck', 'deer', 'bear', 'beaver', 'penguin', 'monkey', 'panda', 'parrot', 'tiger', 'lion', 'koala', 'horse', 'giraffe', 'elephant', 'hog', 'rat'], 0.6],
  [['food', 'fruit', 'vegetable', 'apple', 'banana', 'bread', 'burger', 'cake', 'cheese', 'pizza', 'donut', 'sandwich', 'carrot', 'tomato', 'meat'], 0.3],
];
export function suggestFor(nameWords, tags, kind) {
  if (kind === 'character') return 1.7;
  if (kind === 'texture' || kind === 'sky' || kind === 'kit') return null;
  for (const list of [nameWords, tags]) for (const w of list) for (const [words, m] of SIZES) if (words.includes(w)) return m;
  return kind === 'creature' ? 0.6 : null;
}

/* ------------------------------------------------------------------ files and globs */

/** Every file under `dir` (relative, with "/"), dot files and the tool's own part files left out. */
function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name.endsWith('.part')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(posix(relative(dir, p)));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** A glob as a regular expression: `*` within a folder, `**` across folders, `{a,b}` either. Case-insensitive. */
export function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') { const end = glob.indexOf('}', i); re += `(?:${glob.slice(i + 1, end).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`; i = end; }
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

/** The library file a build writes, with its size and SHA-256. */
function put(out, rel, bytes) {
  const file = join(out, ...rel.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return { path: rel, bytes: bytes.length, sha256: sha256(bytes) };
}

/* ------------------------------------------------------------------ models */

/** Are a raw model's colours flat: plain colours, or base-colour pictures with few colours (a palette)? */
async function flatColours(rawGlb) {
  const { io, fn, sharp } = await modelTools();
  const doc = await io.readBinary(rawGlb);
  for (const t of doc.getRoot().listTextures()) {
    if (fn.listTextureSlots(t).some((s) => s !== 'baseColorTexture')) return false;
    const img = t.getImage();
    if (!img || !sharp) return false;
    const { data, info } = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width * info.height > 4096 * 4096) return false;
    const seen = new Set();
    for (let i = 0; i < data.length; i += 3) { seen.add(((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)); if (seen.size > FLAT_COLOURS) return false; }
  }
  return true;
}

/**
 * A pack with `srgbFactors` (Kenney's 2020 exports, the "GLTF format" folders) stores each flat colour as sRGB where
 * glTF reads linear, so a correct renderer draws it pale. Measured against the packs' own preview pictures: 87 of the
 * Nature Kit's 88 colours, 98 of the Space Kit's 135 and 64 of the Furniture Kit's 89 match when read as sRGB. The
 * colours are converted here, in memory; the raw files are never changed.
 */
async function linearFactors(glb) {
  const { io } = await modelTools();
  const doc = await io.readBinary(glb);
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  for (const m of doc.getRoot().listMaterials()) { const f = m.getBaseColorFactor(); m.setBaseColorFactor([lin(f[0]), lin(f[1]), lin(f[2]), f[3]]); }
  return io.writeBinary(doc);
}

/** One model of a pack into the library: the item, or { skip: why }. */
async function modelItem(pack, { rel, abs, sel, itemId, name, nameWords, folderWords, extraTags = [], origin }, out) {
  const kind = sel.kind ?? pack.kind ?? 'prop';
  const tier = sel.tier ?? pack.tier ?? 'prop';
  const budget = TIERS[tier];
  let raw;
  let r;
  try {
    raw = await selfContained(abs, LIMITS.import);
    if (pack.srgbFactors) raw = await linearFactors(raw);
    r = await optimiseModel(raw, { triangles: budget, texture: kind === 'character' ? 1024 : 512, rigged: Boolean(sel.rigged ?? pack.rigged), metal: true });
  } catch (error) { return { skip: `could not be optimised: ${error.message}` }; }
  const safe = checkGlb(r.glb, LIMITS.game);
  if (!r.ok || !safe.ok) return { skip: `fails the GLB safety rules: ${(safe.problems ?? r.warnings).slice(0, 3).join('; ')}` };
  if (r.after.triangles > budget) return { skip: `still ${r.after.triangles} triangles after simplifying (the ${tier} budget is ${budget})` };
  const insp = await inspectModel(r.glb);
  if (!insp.ok) return { skip: `the glTF validator refuses the result: ${(insp.validator?.messages ?? [insp.why ?? 'unreadable']).slice(0, 2).join('; ')}` };
  const m = insp.measured;
  const colours = (await albedoOf(r.glb).catch(() => [])).filter((c) => c.share >= 0.03).slice(0, 5).map((c) => c.hex);
  const paletteSwap = await flatColours(raw).catch(() => false);
  const tags = tagsFor({ nameWords, folderWords, extra: extraTags, theme: [...(pack.theme ?? []), ...(sel.tags ?? [])], kind });
  const file = `items/${pack.id}/${itemId}.glb`;
  const f = put(out, file, Buffer.from(r.glb));
  const rigged = m.skins > 0;
  // A skinned mesh is stored quantised with its scale folded into the inverse bind matrices, so the shipped file's
  // static bounds are not its size (a 2.47 m knight measures 3.47 m). Its size is read before optimising instead: the
  // build never scales a model, and moving the pivot does not change a size.
  const box = (rigged ? r.before.box : m.box)?.size ?? null;
  return {
    item: {
      id: `${pack.id}/${itemId}`, pack: pack.id, item: itemId, name, kind, family: pack.family, tags, tier,
      file, files: [{ role: 'model', ...f }],
      thumb: null,
      tris: m.triangles, materials: m.materials, drawCalls: m.drawCalls, texturePx: m.maxTexturePx, heightM: box ? box[1] : null, box,
      suggestM: suggestFor(nameWords, tags, kind), rigged, bones: m.bones, clips: m.clips, paletteSwap, colours,
      license: 'cc0', author: pack.author, origin, source: rel,
    },
    warnings: r.warnings,
  };
}

/** The models a pack selects: [{ rel, abs, sel }], each file once (the first select entry that matches wins). */
function selectedModels(pack, dir) {
  const files = listFiles(dir);
  const excludes = (pack.exclude ?? []).map(globRe);
  const chosen = new Map();
  for (const s of pack.select ?? []) {
    const sel = typeof s === 'string' ? { glob: s } : s;
    const re = globRe(sel.glob);
    const ex = (sel.exclude ?? []).map(globRe);
    for (const rel of files) {
      if (chosen.has(rel) || !re.test(rel) || excludes.some((x) => x.test(rel)) || ex.some((x) => x.test(rel))) continue;
      if (!/\.(glb|gltf)$/i.test(rel)) continue;
      chosen.set(rel, { rel, abs: join(dir, ...rel.split('/')), sel });
    }
  }
  return [...chosen.values()];
}

/** Folder words worth a tag: what the pack's own folders call a group ("Characters", "Props"). */
const folderWordsOf = (rel, sel) => {
  const base = sel.glob.split('/').filter((p) => !/[*?{]/.test(p)).length;
  return rel.split('/').slice(Math.max(0, base - 1), -1).flatMap(wordsOf).filter((w) => !PLAIN.has(w));
};

/* ------------------------------------------------------------------ materials and skies */

async function pictureColours(input) {
  const { sharp } = await modelTools();
  const { data } = await sharp(input).resize(48, 48, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const samples = [];
  for (let i = 0; i < data.length; i += 3) samples.push({ rgb: [data[i], data[i + 1], data[i + 2]], w: 1 });
  return dominant(samples, 5).filter((c) => c.share >= 0.03).map((c) => c.hex);
}

/**
 * basecolor, normal and arm (AO, roughness, metalness) WebP pictures at 1,024 px, and a thumbnail. `tileM` is how many
 * metres one repeat of the picture covers in the real world, when the source says.
 */
async function materialItem(pack, { itemId, name, nameWords, extraTags, maps, origin, source, tileM }, out) {
  const { sharp } = await modelTools();
  const px = MATERIAL_PX;
  const dir = `textures/${pack.id}/${itemId}`;
  const size = (f) => sharp(f).resize(px, px, { fit: 'fill' }).removeAlpha();
  const basecolor = await size(maps.color).webp({ quality: 85 }).toBuffer();
  const normal = await size(maps.normal).webp({ quality: 92, smartSubsample: true }).toBuffer();
  let arm;
  if (maps.arm) arm = await size(maps.arm).webp({ quality: 90, smartSubsample: true }).toBuffer();
  else {
    // Packed as glTF reads it: R ambient occlusion (none: 1), G roughness (none: 1), B metalness (none: 0).
    const grey = async (f, fill) => (f ? sharp(f).resize(px, px, { fit: 'fill' }).extractChannel(0).raw().toBuffer() : Buffer.alloc(px * px, fill));
    const [a, r, m] = [await grey(maps.ao, 255), await grey(maps.rough, 255), await grey(maps.metal, 0)];
    const rgb = Buffer.alloc(px * px * 3);
    for (let i = 0; i < px * px; i++) { rgb[i * 3] = a[i]; rgb[i * 3 + 1] = r[i]; rgb[i * 3 + 2] = m[i]; }
    arm = await sharp(rgb, { raw: { width: px, height: px, channels: 3 } }).webp({ quality: 90, smartSubsample: true }).toBuffer();
  }
  // Every map is a "texture" file to a game's asset manifest; `map` says which one (its file name says it too).
  const files = [
    { role: 'texture', map: 'basecolor', ...put(out, `${dir}/basecolor.webp`, basecolor) },
    { role: 'texture', map: 'normal', ...put(out, `${dir}/normal.webp`, normal) },
    { role: 'texture', map: 'arm', ...put(out, `${dir}/arm.webp`, arm) },
  ];
  const thumb = `thumbs/${pack.id}/${itemId}.webp`;
  put(out, thumb, await sharp(maps.color).resize(THUMB_PX, THUMB_PX, { fit: 'cover' }).removeAlpha().webp({ quality: 80 }).toBuffer());
  const tags = tagsFor({ nameWords, extra: extraTags, theme: pack.theme ?? [], kind: 'texture' });
  return {
    item: {
      id: `${pack.id}/${itemId}`, pack: pack.id, item: itemId, name, kind: 'texture', family: pack.family, tags, tier: null,
      file: files[0].path, files, thumb,
      tris: null, materials: null, drawCalls: null, texturePx: px, heightM: null, box: null,
      suggestM: null, rigged: false, bones: 0, clips: [], paletteSwap: false, colours: await pictureColours(maps.color),
      license: 'cc0', author: pack.author, origin, source, ...(tileM ? { tileM } : {}),
    },
  };
}

/**
 * A Radiance .hdr picture: { width, height, data: Float32Array RGB }. Reads the usual "-Y h +X w" orientation, flat
 * or run-length scanlines.
 */
export function readHdr(bytes) {
  const b = bytes;
  let at = 0;
  const line = () => { let s = ''; while (at < b.length && b[at] !== 0x0a) s += String.fromCharCode(b[at++]); at += 1; return s; };
  if (!/^#\?(RADIANCE|RGBE)/.test(line())) throw new Error('not a Radiance .hdr');
  for (;;) {
    if (at >= b.length) throw new Error('an .hdr with no picture');
    const l = line();
    if (l === '') break;
    if (/^FORMAT=/.test(l) && !/32-bit_rle_rgbe/.test(l)) throw new Error(`an .hdr in ${l.slice(7)} (only RGBE is read)`);
  }
  const res = /^-Y (\d+) \+X (\d+)$/.exec(line().trim());
  if (!res) throw new Error('an .hdr orientation this tool does not read');
  const h = Number(res[1]); const w = Number(res[2]);
  const data = new Float32Array(w * h * 3);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (w >= 8 && w < 32768 && b[at] === 2 && b[at + 1] === 2 && ((b[at + 2] << 8) | b[at + 3]) === w) {
      at += 4;
      for (let c = 0; c < 4; c++) {
        for (let x = 0; x < w;) {
          let n = b[at++];
          if (n > 128) { n -= 128; if (x + n > w) throw new Error('a broken .hdr scanline'); const v = b[at++]; for (let i = 0; i < n; i++) scan[(x++) * 4 + c] = v; }
          else { if (!n || x + n > w) throw new Error('a broken .hdr scanline'); for (let i = 0; i < n; i++) scan[(x++) * 4 + c] = b[at++]; }
        }
      }
    } else {
      if (at + w * 4 > b.length) throw new Error('an .hdr cut short');
      scan.set(b.subarray(at, at + w * 4)); at += w * 4;
    }
    for (let x = 0; x < w; x++) {
      const e = scan[x * 4 + 3];
      const f = e ? 2 ** (e - 136) : 0;
      const o = (y * w + x) * 3;
      data[o] = (scan[x * 4] + 0.5) * f; data[o + 1] = (scan[x * 4 + 1] + 0.5) * f; data[o + 2] = (scan[x * 4 + 2] + 0.5) * f;
    }
  }
  return { width: w, height: h, data };
}

/** An HDR picture as 8-bit sRGB: exposed to its own average brightness, then a filmic curve (for previews only). */
export function toneMap({ width, height, data }) {
  let logSum = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) logSum += Math.log(1e-4 + 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2]);
  const exposure = Math.min(64, Math.max(1 / 64, 0.22 / Math.exp(logSum / n)));
  const aces = (x) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
  const srgb = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n * 3; i++) out[i] = srgb(aces(data[i] * exposure));
  return out;
}

/** A sky: its .hdr as shipped, a 512 x 256 preview and a square thumbnail of the middle of the panorama. */
async function skyItem(pack, { itemId, name, nameWords, extraTags, hdr, origin, source }, out) {
  const { sharp } = await modelTools();
  const bytes = readFileSync(hdr);
  const img = readHdr(bytes);
  const { data } = await sharp(toneMap(img), { raw: { width: img.width, height: img.height, channels: 3 } }).resize(512, 256, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const small = () => sharp(data, { raw: { width: 512, height: 256, channels: 3 } });
  const dir = `skies/${pack.id}/${itemId}`;
  const files = [{ role: 'sky', ...put(out, `${dir}/sky.hdr`, bytes) }, { role: 'preview', ...put(out, `${dir}/preview.webp`, await small().webp({ quality: 82 }).toBuffer()) }];
  const thumb = `thumbs/${pack.id}/${itemId}.webp`;
  put(out, thumb, await small().extract({ left: 128, top: 0, width: 256, height: 256 }).webp({ quality: 80 }).toBuffer());
  const samples = [];
  for (let i = 0; i < data.length; i += 3 * 37) samples.push({ rgb: [data[i], data[i + 1], data[i + 2]], w: 1 });
  const tags = tagsFor({ nameWords, extra: extraTags, theme: pack.theme ?? [], kind: 'sky' });
  return {
    item: {
      id: `${pack.id}/${itemId}`, pack: pack.id, item: itemId, name, kind: 'sky', family: pack.family, tags, tier: null,
      file: files[0].path, files, thumb,
      tris: null, materials: null, drawCalls: null, texturePx: img.width, heightM: null, box: null,
      suggestM: null, rigged: false, bones: 0, clips: [], paletteSwap: false, colours: dominant(samples, 5).filter((c) => c.share >= 0.03).map((c) => c.hex),
      license: 'cc0', author: pack.author, origin, source,
    },
  };
}

/* ------------------------------------------------------------------ build */

/** An item id from words, unique within its pack. */
function uniqueId(words, used) {
  const base = words.join('-').replace(/-+/g, '-').slice(0, 60).replace(/-$/, '') || 'item';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  if (!ITEM_ID.test(id)) throw new Error(`"${id}" is not an item id`);
  used.add(id);
  return id;
}

/** What one pack holds: [{ make: async (out) => ({ item } | { skip }), source }]. */
function packJobs(pack, dir) {
  const s = pack.source;
  const used = new Set();
  const jobs = [];
  if (s.kind === 'kenney' || s.kind === 'github') {
    for (const { rel, abs, sel } of selectedModels(pack, dir)) {
      // Some packs name a binary "x.gltf.glb": both endings go.
      const nameWords = wordsOf(basename(rel).replace(/(\.gltf)?\.(glb|gltf)$/i, ''));
      const itemId = uniqueId(nameWords, used);
      jobs.push({ source: rel, model: true, make: (out) => modelItem(pack, { rel, abs, sel, itemId, name: nameOf(nameWords), nameWords, folderWords: folderWordsOf(rel, sel), origin: pack.url }, out) });
    }
  } else if (s.kind === 'polyhaven') {
    const res = s.res ?? '1k';
    for (const id of s.ids ?? []) {
      const aDir = join(dir, s.type, id);
      const info = readJson(join(aDir, 'info.json'));
      if (!info) { jobs.push({ source: `${s.type}/${id}`, make: async () => ({ skip: 'not in the raw folder (run fetch)' }) }); continue; }
      const nameWords = wordsOf(id);
      const itemId = uniqueId(nameWords, used);
      const name = info.name ?? nameOf(nameWords);
      const extraTags = [...(info.tags ?? []), ...(info.categories ?? []).filter((c) => !/^collection:/i.test(c))];
      const origin = `https://polyhaven.com/a/${id}`;
      if (s.type === 'models') {
        const rel = `${s.type}/${id}/${id}_${res}.gltf`;
        const sel = { glob: rel, tier: pack.tier, kind: pack.kind };
        jobs.push({ source: rel, model: true, make: (out) => modelItem(pack, { rel, abs: join(dir, ...rel.split('/')), sel, itemId, name, nameWords, folderWords: [], extraTags, origin }, out) });
      } else if (s.type === 'textures') {
        const f = (part) => { const p = join(aDir, `${id}_${part}_${res}.jpg`); return existsSync(p) ? p : null; };
        const maps = { color: f('diff'), normal: f('nor_gl'), arm: f('arm'), ao: f('ao'), rough: f('rough'), metal: f('metal') };
        const tileM = Array.isArray(info.dimensions) ? +(info.dimensions[0] / 1000).toFixed(2) : null;
        jobs.push({ source: `${s.type}/${id}`, make: async (out) => (maps.color && maps.normal ? materialItem(pack, { itemId, name, nameWords, extraTags, maps, origin, source: `${s.type}/${id}`, tileM }, out) : { skip: 'no colour or OpenGL normal map in the raw folder' }) });
      } else {
        const hdr = join(aDir, `${id}_${res}.hdr`);
        jobs.push({ source: `${s.type}/${id}/${id}_${res}.hdr`, make: async (out) => (existsSync(hdr) ? skyItem(pack, { itemId, name, nameWords, extraTags, hdr, origin, source: `${s.type}/${id}/${id}_${res}.hdr` }, out) : { skip: 'no .hdr in the raw folder (run fetch)' }) });
      }
    }
  } else if (s.kind === 'ambientcg') {
    for (const id of s.ids ?? []) {
      const info = readJson(join(dir, `${id}.json`)) ?? {};
      const aDir = join(dir, id);
      const files = existsSync(aDir) ? readdirSync(aDir) : [];
      const f = (re) => { const n = files.find((x) => re.test(x)); return n ? join(aDir, n) : null; };
      const maps = { color: f(/_Color\.(jpg|png)$/i), normal: f(/_NormalGL\.(jpg|png)$/i), ao: f(/_AmbientOcclusion\.(jpg|png)$/i), rough: f(/_Roughness\.(jpg|png)$/i), metal: f(/_Metalness\.(jpg|png)$/i) };
      const nameWords = wordsOf(id);
      const itemId = uniqueId(nameWords, used);
      const name = info.displayName ?? nameOf(nameWords);
      const extraTags = [...(info.tags ?? []).filter((t) => !/^\d+$/.test(t) && t.toLowerCase() !== id.toLowerCase()), info.displayCategory ?? ''];
      const tileM = info.dimensionX ? +(info.dimensionX / 100).toFixed(2) : null;
      jobs.push({ source: id, make: async (out) => (maps.color && maps.normal ? materialItem(pack, { itemId, name, nameWords, extraTags, maps, origin: `https://ambientcg.com/a/${id}`, source: `${id}/${basename(maps.color)}`, tileM }, out) : { skip: 'no colour or NormalGL map in the raw folder (run fetch)' }) });
    }
  }
  return jobs;
}

/** Remove a library folder only when the folder is plainly a library (its index.json says so) or absent. */
function clearLibraryPath(out, rel) {
  const target = join(out, ...rel.split('/'));
  if (!existsSync(target)) return;
  const index = readJson(join(out, 'index.json'));
  if (index?.kind !== 'homie-starter-library') throw new Error(`${out} has ${rel} but no starter library index: not touching it`);
  rmSync(target, { recursive: true, force: true });
}

/** Draw the model thumbnails, a fresh Chrome every THUMBS_PER_CHROME. Returns the warnings. */
async function drawThumbs(list, out, log) {
  if (!list.length) return [];
  const { withRenderer, modelIn, saveDataUrl } = await import('../packages/studio/lib/render3d.mjs');
  const { sharp } = await modelTools();
  const warnings = [];
  for (let i = 0; i < list.length; i += THUMBS_PER_CHROME) {
    const chunk = list.slice(i, i + THUMBS_PER_CHROME);
    const t0 = Date.now();
    await withRenderer(async (r) => {
      for (const it of chunk) {
        const rel = `thumbs/${it.pack}/${it.item}.webp`;
        try {
          const shot = await r.thumb(modelIn(it.id, readFileSync(join(out, it.file))), { size: THUMB_PX });
          const file = join(out, ...rel.split('/'));
          mkdirSync(dirname(file), { recursive: true });
          saveDataUrl(shot.image, file);
          // A thumbnail of nothing (a model too small, too far, or drawn black) is a plain field: say so.
          const st = await sharp(file).stats();
          if (Math.max(...st.channels.slice(0, 3).map((c) => c.stdev)) < 3) warnings.push(`${it.id}: its thumbnail looks empty`);
          it.thumb = rel;
        } catch (error) { warnings.push(`${it.id}: no thumbnail (${error.message.slice(0, 120)})`); }
      }
    }, { log: (m) => log(`  thumbnails ${i + 1}-${i + chunk.length} of ${list.length}: ${m}`) });
    log(`  ${Math.min(i + THUMBS_PER_CHROME, list.length)} of ${list.length} thumbnails (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  return warnings;
}

const ORDER = (packs) => { const at = new Map(packs.map((p, i) => [p.id, i])); return (a, b) => (at.get(a.pack) ?? 1e9) - (at.get(b.pack) ?? 1e9) || a.id.localeCompare(b.id); };

/** The index's counts, from its items, packs and the bytes of every file it names (and the licences). */
export function countsOf(index, out) {
  const byKind = {}; const byFamily = {};
  let bytes = 0;
  for (const it of index.items) {
    byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;
    byFamily[it.family] = (byFamily[it.family] ?? 0) + 1;
    bytes += (it.files ?? []).reduce((n, f) => n + f.bytes, 0);
    if (it.thumb && existsSync(join(out, it.thumb))) bytes += statSync(join(out, it.thumb)).size;
  }
  for (const p of index.packs) if (existsSync(join(out, p.licenseFile))) bytes += statSync(join(out, p.licenseFile)).size;
  return { items: index.items.length, packs: index.packs.length, bytes, byKind, byFamily };
}

/** index.json with one pack, item or skip per line (readable diffs; the contract is the JSON, not the layout). */
function indexText(index) {
  const lines = (arr) => (arr.length ? `[\n${arr.map((x) => JSON.stringify(x)).join(',\n')}\n]` : '[]');
  const { packs, items, skipped, refused, ...head } = index;
  return `${JSON.stringify(head).slice(0, -1)},\n"packs": ${lines(packs)},\n"items": ${lines(items)},\n"skipped": ${lines(skipped)},\n"refused": ${lines(refused)}\n}\n`;
}

/**
 * Build the library (or one pack of it) from `raw` into `out`. Returns { index, refused, skipped, warnings }.
 * `thumbs: false` draws no model thumbnails (no Chrome).
 */
export async function buildLibrary({ raw, out, only = null, thumbs = true, sources = readSources(), log = console.log } = {}) {
  const { core } = await modelTools();
  // gltf-transform says what every prune removed; thousands of models would bury the report.
  core.Logger.DEFAULT_INSTANCE.verbosity = core.Verbosity.WARN;
  const packs = only ? sources.filter((p) => p.id === only) : sources;
  if (only && !packs.length) throw new Error(`no pack "${only}" in the sources`);
  mkdirSync(out, { recursive: true });
  const fetched = readJson(join(raw, 'fetched.json'))?.packs ?? {};
  const prev = only ? readJson(join(out, 'index.json')) : null;
  if (!only) for (const sub of ['items', 'thumbs', 'textures', 'skies', 'licenses']) clearLibraryPath(out, sub);
  const items = []; const skipped = []; const refused = []; const warnings = []; const builtPacks = [];
  const toDraw = [];
  for (const pack of packs) {
    for (const sub of ['items', 'thumbs', 'textures', 'skies']) clearLibraryPath(out, `${sub}/${pack.id}`);
    clearLibraryPath(out, `licenses/${pack.id}.txt`);
    const dir = join(raw, ...rawDirOf(pack).split('/'));
    if (!existsSync(dir)) { refused.push({ pack: pack.id, why: 'not in the raw folder (run fetch first)' }); log(`REFUSED ${pack.id}: not in the raw folder (run fetch first)`); continue; }
    // The licence first: nothing of a pack is read until its own text says CC0.
    const licFile = pack.source.kind === 'polyhaven' || pack.source.kind === 'ambientcg' ? join(dir, 'LICENSE.txt') : findLicence(dir);
    if (!licFile || !existsSync(licFile)) { refused.push({ pack: pack.id, why: 'it carries no licence file' }); log(`REFUSED ${pack.id}: it carries no licence file`); continue; }
    const licBytes = readFileSync(licFile);
    const verdict = licenceVerdict(licBytes.toString('utf8'));
    if (!verdict.ok) { refused.push({ pack: pack.id, why: verdict.why }); log(`REFUSED ${pack.id}: ${verdict.why}`); continue; }
    const licenseFile = `licenses/${pack.id}.txt`;
    put(out, licenseFile, licBytes);
    const rec = fetched[pack.id];
    if (!rec) warnings.push(`${pack.id}: no record in fetched.json (its source address, SHA-256 and size are unknown)`);
    log(`${pack.id}: licence "${verdict.line}"`);
    const jobs = packJobs(pack, dir);
    let n = 0;
    const t0 = Date.now();
    for (const job of jobs) {
      const r = await job.make(out).catch((error) => ({ skip: `failed: ${error.message}` }));
      if (r.skip) { skipped.push({ pack: pack.id, source: job.source, why: r.skip }); continue; }
      for (const w of r.warnings ?? []) warnings.push(`${r.item.id}: ${w}`);
      items.push(r.item);
      if (job.model && thumbs) toDraw.push(r.item);
      n += 1;
    }
    builtPacks.push({
      id: pack.id, label: pack.label, family: pack.family, author: pack.author, url: pack.url, license: 'cc0', licenseFile,
      source: { url: rec?.url ?? pack.url, sha256: rec?.sha256 ?? null, bytes: rec?.bytes ?? null, fetched: rec?.fetched ?? null },
      items: n,
    });
    log(`  ${n} items, ${skipped.filter((s) => s.pack === pack.id).length} skipped (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  if (toDraw.length) { log(`drawing ${toDraw.length} thumbnails`); warnings.push(...await drawThumbs(toDraw, out, log)); }
  const ids = new Set(packs.map((p) => p.id));
  const keep = (arr) => (arr ?? []).filter((x) => !ids.has(x.pack ?? x.id));
  const order = ORDER(sources);
  const index = {
    v: 1, kind: 'homie-starter-library', version: 'v0', built: new Date().toISOString(), tool: TOOL, counts: null,
    packs: [...keep(prev?.packs), ...builtPacks].sort((a, b) => order({ pack: a.id, id: a.id }, { pack: b.id, id: b.id })),
    items: [...keep(prev?.items), ...items].sort(order),
    skipped: [...keep(prev?.skipped), ...skipped].sort((a, b) => order({ pack: a.pack, id: a.source }, { pack: b.pack, id: b.source })),
    refused: [...keep(prev?.refused), ...refused],
  };
  index.counts = countsOf(index, out);
  writeFileSync(join(out, 'index.json'), indexText(index));
  return { index, refused, skipped, warnings };
}

/* ------------------------------------------------------------------ check */

const ITEM_FIELDS = ['id', 'pack', 'item', 'name', 'kind', 'family', 'tags', 'tier', 'file', 'files', 'thumb', 'tris', 'materials', 'drawCalls', 'texturePx', 'heightM', 'box', 'suggestM', 'rigged', 'bones', 'clips', 'paletteSwap', 'colours', 'license', 'author', 'origin', 'source'];
const PACK_FIELDS = ['id', 'label', 'family', 'author', 'url', 'license', 'licenseFile', 'source', 'items'];

/** Read the whole library back against its index. Returns { ok, problems, totals }. */
export function checkLibrary(out) {
  const problems = [];
  const index = readJson(join(out, 'index.json'));
  if (index?.kind !== 'homie-starter-library' || !Array.isArray(index.items) || !Array.isArray(index.packs)) return { ok: false, problems: [`${join(out, 'index.json')} is not a starter library index`], totals: null };
  for (const k of ['v', 'kind', 'version', 'built', 'tool', 'counts']) if (!(k in index)) problems.push(`index.json has no "${k}"`);
  const packs = new Map();
  for (const p of index.packs) {
    for (const k of PACK_FIELDS) if (!(k in p)) problems.push(`pack ${p.id}: no "${k}"`);
    if (p.license !== 'cc0') problems.push(`pack ${p.id}: licence ${p.license}, not cc0`);
    const lic = join(out, p.licenseFile ?? '');
    if (!p.licenseFile || !existsSync(lic)) problems.push(`pack ${p.id}: its licence file ${p.licenseFile} is missing`);
    else { const v = licenceVerdict(readFileSync(lic, 'utf8')); if (!v.ok) problems.push(`pack ${p.id}: ${v.why}`); }
    packs.set(p.id, { ...p, seen: 0 });
  }
  const ids = new Set();
  const totals = { items: 0, bytes: 0, byFamily: {}, byKind: {} };
  const tally = (map, key, bytes) => { map[key] ??= { items: 0, bytes: 0 }; map[key].items += 1; map[key].bytes += bytes; };
  for (const it of index.items) {
    const where = `item ${it.id}`;
    for (const k of ITEM_FIELDS) if (!(k in it)) problems.push(`${where}: no "${k}"`);
    if (ids.has(it.id)) problems.push(`${where}: listed twice`);
    ids.add(it.id);
    if (it.id !== `${it.pack}/${it.item}`) problems.push(`${where}: its id is not pack/item`);
    if (it.license !== 'cc0') problems.push(`${where}: licence ${it.license}, not cc0`);
    if (!KINDS.includes(it.kind)) problems.push(`${where}: kind ${it.kind}`);
    if (!FAMILIES.includes(it.family)) problems.push(`${where}: family ${it.family}`);
    const pack = packs.get(it.pack);
    if (!pack) problems.push(`${where}: its pack ${it.pack} is not in the index`); else pack.seen += 1;
    let bytes = 0;
    if (!Array.isArray(it.files) || !it.files.length) problems.push(`${where}: no files`);
    if (!(it.files ?? []).some((f) => f.path === it.file)) problems.push(`${where}: "file" is not one of its files`);
    for (const f of it.files ?? []) {
      const abs = join(out, ...String(f.path).split('/'));
      if (!/^[A-Za-z0-9._/-]+$/.test(f.path) || f.path.split('/').includes('..')) { problems.push(`${where}: ${f.path} is not a library path`); continue; }
      if (!existsSync(abs)) { problems.push(`${where}: ${f.path} is missing`); continue; }
      const b = readFileSync(abs);
      bytes += b.length;
      if (b.length !== f.bytes) problems.push(`${where}: ${f.path} is ${b.length} bytes, the index says ${f.bytes}`);
      if (sha256(b) !== f.sha256) problems.push(`${where}: ${f.path}: its SHA-256 does not match the index`);
      if (/\.glb$/i.test(f.path)) { const s = checkGlb(b, LIMITS.game); if (!s.ok) problems.push(`${where}: ${f.path}: ${s.problems.slice(0, 2).join('; ')}`); }
    }
    if (TIERS[it.tier] && typeof it.tris === 'number' && it.tris > TIERS[it.tier]) problems.push(`${where}: ${it.tris} triangles, over the ${it.tier} budget of ${TIERS[it.tier]}`);
    if (it.thumb) {
      const t = join(out, ...it.thumb.split('/'));
      if (!existsSync(t)) problems.push(`${where}: its thumbnail ${it.thumb} is missing`);
      else { const b = readFileSync(t); bytes += b.length; if (b.subarray(0, 4).toString('latin1') !== 'RIFF' || b.subarray(8, 12).toString('latin1') !== 'WEBP') problems.push(`${where}: its thumbnail is not a WebP`); }
    }
    totals.items += 1; totals.bytes += bytes;
    tally(totals.byFamily, it.family, bytes); tally(totals.byKind, it.kind, bytes);
  }
  for (const p of packs.values()) if (p.seen !== p.items) problems.push(`pack ${p.id}: says ${p.items} items, the index lists ${p.seen}`);
  const want = countsOf(index, out);
  const c = index.counts ?? {};
  if (c.items !== want.items || c.packs !== want.packs || c.bytes !== want.bytes) problems.push(`counts say ${c.items} items, ${c.packs} packs, ${c.bytes} bytes; the library has ${want.items}, ${want.packs}, ${want.bytes}`);
  if (JSON.stringify(c.byKind) !== JSON.stringify(want.byKind) || JSON.stringify(c.byFamily) !== JSON.stringify(want.byFamily)) problems.push('counts by kind or family do not match the items');
  for (const p of index.packs) if (existsSync(join(out, p.licenseFile ?? ''))) totals.bytes += statSync(join(out, p.licenseFile)).size;
  totals.packs = index.packs.length;
  totals.indexBytes = statSync(join(out, 'index.json')).size;
  return { ok: !problems.length, problems, totals };
}

/* ------------------------------------------------------------------ the command line */

function args(argv) {
  const flags = {}; const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-thumbs') flags.thumbs = false;
    else if (a.startsWith('--')) { flags[a.slice(2)] = argv[i + 1]; i += 1; }
    else words.push(a);
  }
  return { flags, words };
}

const table = (map) => Object.entries(map).sort((a, b) => b[1].bytes - a[1].bytes).map(([k, v]) => `  ${k.padEnd(10)} ${String(v.items).padStart(5)} items  ${mb(v.bytes).padStart(9)}  (${v.bytes} bytes)`).join('\n');

async function main(argv) {
  const [cmd, ...rest] = argv;
  const { flags, words } = args(rest);
  const sources = () => readSources(flags.sources ? resolve(flags.sources) : SOURCES);
  const raw = resolve(flags.raw ?? './library-raw');
  const out = resolve(flags.out ?? './library');
  if (cmd === 'fetch') {
    const r = await fetchSources({ raw, only: flags.only ?? null, sources: sources() });
    console.log(`${r.requests} requests; ${r.failed.length ? `NOT FETCHED: ${r.failed.map((f) => `${f.pack} (${f.why})`).join('; ')}` : 'every pack is here'}`);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'build') {
    const r = await buildLibrary({ raw, out, only: flags.only ?? null, thumbs: flags.thumbs !== false, sources: sources() });
    const c = r.index.counts;
    for (const w of r.warnings) console.log(`warning: ${w}`);
    for (const s of r.skipped) console.log(`skipped ${s.pack}/${s.source}: ${s.why}`);
    for (const x of r.refused) console.log(`refused ${x.pack}: ${x.why}`);
    console.log(`${c.items} items in ${c.packs} packs, ${mb(c.bytes)} (${c.bytes} bytes); by kind ${JSON.stringify(c.byKind)}; by family ${JSON.stringify(c.byFamily)}`);
    return 0;
  }
  if (cmd === 'check') {
    const r = checkLibrary(out);
    for (const p of r.problems.slice(0, 60)) console.log(`PROBLEM ${p}`);
    if (r.problems.length > 60) console.log(`... and ${r.problems.length - 60} more`);
    if (r.totals) console.log(`${r.totals.items} items in ${r.totals.packs} packs, ${mb(r.totals.bytes + r.totals.indexBytes)} with index.json (${r.totals.bytes + r.totals.indexBytes} bytes)\nby family:\n${table(r.totals.byFamily)}\nby kind:\n${table(r.totals.byKind)}`);
    console.log(r.ok ? 'check: ok' : `check: ${r.problems.length} problem${r.problems.length === 1 ? '' : 's'}`);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'search') {
    const index = readJson(join(out, 'index.json'));
    if (!index) throw new Error(`no library index at ${out}`);
    const hits = searchLibrary(index, words.join(' '), { kind: flags.kind ?? null, family: flags.family ?? null, limit: Number(flags.limit ?? 12) });
    for (const h of hits) console.log(`${h.score.toFixed(2).padStart(6)}  ${h.item.id.padEnd(52)} ${h.item.name.padEnd(28)} ${h.item.kind.padEnd(9)} ${String(h.item.tris ?? '-').padStart(5)} tris ${String(Math.round((h.item.files?.[0]?.bytes ?? 0) / 1024)).padStart(5)} KB  [${h.why.join(' ')}]`);
    if (!hits.length) console.log('nothing matches');
    return 0;
  }
  console.log('usage: node scripts/library.mjs fetch|build|check|search (see the top of this file)');
  return cmd ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(`library: ${error.message}`); process.exitCode = 1; });
}
