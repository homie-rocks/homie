/**
 * EVERY ASSET'S PROVENANCE AND LICENCE: games/<id>/assets/manifest.json, one entry per model,
 * texture, sky or procedural part a game ships, with where it came from (procedural, library, generated, imported),
 * each step that made it (endpoint, receipt, price), the decision revisions it was made under (lib/decisions.mjs),
 * its licence and what a remix gets, its measurements and its review. An entry the game's code changes at runtime
 * says so in `inGame` ({ heightM, repaint }: drawn at that height, repainted from style.json), so the lineup draws
 * it as the game does. From it:
 *
 *   games/<id>/assets/RIGHTS.md   what each file is, where it came from, its licence and what that allows, in plain words
 *   games/<id>/credits.json       a `parts[]` line per pack or attribution-required file (the landing's credits page)
 *   licenceProblems()             what `publish` and `assets check` refuse: a file with no licence record, a licence
 *                                 that forbids a public source or a web game, attribution that never reached credits
 *   servedAssets()                /games/<id>/assets.json on the site: each redistributable file's address and SHA-256,
 *                                 which `game remix` fetches
 *
 * Both files are text: they travel in the remix source; the codex/ folder (decisions, the board) does not.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pinByUse, readDecisions, revisionsFor } from './decisions.mjs';
import { GAME_ID } from './studio.mjs';

export const MANIFEST_FILE = join('assets', 'manifest.json');
export const RIGHTS_FILE = join('assets', 'RIGHTS.md');
export const ROUTES = Object.freeze(['procedural', 'library', 'generated', 'imported', 'premium']);
export const KINDS = Object.freeze(['prop', 'character', 'creature', 'kit', 'environment', 'texture', 'sky', 'clip']);
export const ASSET_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * Licence kinds: whether the file may sit in a public remix source and on Homie's mirror, whether
 * credit is required, what a remix gets by default, and whether a browser game may serve the file at all.
 */
export const LICENSES = Object.freeze({
  cc0: { label: 'CC0 1.0 (public domain)', spdx: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', redistribute: true, attribution: false, remix: 'include', web: true },
  'cc-by-4.0': { label: 'CC BY 4.0', spdx: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/', redistribute: true, attribution: true, remix: 'include', web: true },
  'cc-by-3.0': { label: 'CC BY 3.0', spdx: 'CC-BY-3.0', url: 'https://creativecommons.org/licenses/by/3.0/', redistribute: true, attribution: true, remix: 'include', web: true },
  own: { label: 'The studio\'s own work', spdx: null, url: null, redistribute: true, attribution: false, remix: 'include', web: true },
  generated: { label: 'Generated on the studio\'s own account', spdx: null, url: null, redistribute: true, attribution: false, remix: 'include', web: true },
  qal: { label: 'Quaternius Asset License', spdx: null, url: 'https://quaternius.com/license.html', redistribute: false, attribution: false, remix: 'reference', web: true },
  mixamo: { label: 'Mixamo (Adobe)', spdx: null, url: 'https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html', redistribute: false, attribution: false, remix: 'none', web: true },
  other: { label: 'Other (see notes)', spdx: null, url: null, redistribute: false, attribution: false, remix: 'none', web: true },
});
/** `eula:<name>` and `market:<listing>` are commercial licences: never in a public source; TurboSquid never on the web. */
export function licenseInfo(kind) {
  const k = String(kind ?? '');
  if (LICENSES[k]) return { kind: k, ...LICENSES[k] };
  if (/^eula:[a-z0-9-]{1,40}$/.test(k)) return { kind: k, label: `Commercial licence (${k.slice(5)})`, spdx: null, url: null, redistribute: false, attribution: false, remix: 'none', web: k !== 'eula:turbosquid' };
  if (/^market:[a-z0-9:._-]{1,80}$/.test(k)) return { kind: k, label: `Bought (${k.slice(7)})`, spdx: null, url: null, redistribute: false, attribution: false, remix: 'none', web: true };
  return null;
}

/** The decisions each kind of asset is made under (its `made.under`). */
const UNDER = {
  prop: ['style.render', 'style.palette', 'style.shape', 'style.materials', 'style.light', 'cast.scale'],
  character: ['style.render', 'style.palette', 'style.shape', 'style.materials', 'style.light', 'style.proportions', 'cast.scale', 'rig.skeleton'],
  kit: ['style.render', 'style.palette', 'style.materials', 'cast.scale'],
  texture: ['style.render', 'style.palette', 'style.materials'],
  sky: ['style.light', 'style.palette'],
  clip: ['anim.style', 'rig.skeleton'],
};
UNDER.creature = UNDER.character;
UNDER.environment = UNDER.kit;
export function underFor(kind, route) {
  return [...(UNDER[kind] ?? UNDER.prop), ...(route === 'library' ? ['cast.family'] : []), ...(route === 'generated' ? ['derived.prompt'] : [])];
}

const fileOf = (root, id) => join(root, 'games', id, MANIFEST_FILE);
const now = () => new Date().toISOString();
const clean = (s, n = 300) => (typeof s === 'string' ? s.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, n) : null);

export function readManifest(root, id) {
  if (!GAME_ID.test(String(id ?? ''))) throw new Error(`"${id}" is not a game id`);
  const file = fileOf(root, id);
  if (!existsSync(file)) return { v: 1, assets: [] };
  const m = JSON.parse(readFileSync(file, 'utf8'));
  if (m?.v !== 1 || !Array.isArray(m.assets)) throw new Error(`games/${id}/${MANIFEST_FILE} is not an asset manifest (v 1)`);
  return m;
}

export function writeManifest(root, id, manifest) {
  const file = fileOf(root, id);
  mkdirSync(dirname(file), { recursive: true });
  manifest.assets.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(`${file}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
  return manifest;
}

/** One entry's shape, checked: { ok, problems }. */
export function checkEntry(e) {
  const problems = [];
  if (!ASSET_ID.test(String(e?.id ?? ''))) problems.push('an id: lowercase letters, digits and hyphens');
  if (!KINDS.includes(e?.kind)) problems.push(`a kind: ${KINDS.join(', ')}`);
  if (!ROUTES.includes(e?.route)) problems.push(`a route: ${ROUTES.join(', ')}`);
  if (!e?.license || !licenseInfo(e.license.kind)) problems.push('a licence record (license.kind: cc0, cc-by-4.0, own, generated, …)');
  else if (licenseInfo(e.license.kind).attribution && !clean(e.license.attribution)) problems.push(`${e.license.kind} requires an attribution line (license.attribution)`);
  if (e?.route !== 'procedural' && !(e?.files ?? []).some((f) => f.role === 'model' || f.role === 'texture' || f.role === 'sky' || f.role === 'clip')) problems.push('a shipped file (files[].role model, texture, sky or clip)');
  return { ok: problems.length === 0, problems };
}

/**
 * Record (or replace) one asset. Fills `made.under` with the current decision revisions for its kind and route,
 * pins the auto decisions it was made under (pinned by use), then writes the manifest, RIGHTS.md and credits.json.
 * Returns { entry, pinned }.
 */
export function recordAsset(root, id, entry) {
  const manifest = readManifest(root, id);
  const e = JSON.parse(JSON.stringify(entry));
  e.license = { remix: licenseInfo(e.license?.kind)?.remix ?? 'none', ...e.license };
  const check = checkEntry(e);
  if (!check.ok) throw new Error(`asset ${e.id ?? '?'} needs ${check.problems.join('; ')}`);
  const doc = readDecisions(root, id);
  const under = underFor(e.kind, e.route);
  e.made = { ...(e.made ?? {}), under: { ...revisionsFor(doc, under), ...(e.made?.under ?? {}) } };
  e.recordedAt = now();
  const at = manifest.assets.findIndex((a) => a.id === e.id);
  if (at >= 0) manifest.assets[at] = e; else manifest.assets.push(e);
  writeManifest(root, id, manifest);
  const pinned = pinByUse(root, id, under.filter((d) => d !== 'derived.prompt'), e.id);
  writeRights(root, id, manifest);
  syncCredits(root, id, manifest);
  return { entry: e, pinned };
}

/**
 * `assets remove`: the record goes, and so does the copy the game ships (its files under public/) when it is still
 * byte for byte what the record put there and no other asset names it. A raw file in art/ stays, and so does a
 * shipped file someone changed since. Returns { removed, deleted: [paths], kept: [paths] }.
 */
export function removeAsset(root, id, assetId) {
  const manifest = readManifest(root, id);
  const gone = manifest.assets.find((a) => a.id === assetId);
  if (!gone) return { removed: false, deleted: [], kept: [] };
  manifest.assets = manifest.assets.filter((a) => a.id !== assetId);
  writeManifest(root, id, manifest);
  writeRights(root, id, manifest);
  syncCredits(root, id, manifest);
  const gdir = join(root, 'games', id);
  const named = new Set(manifest.assets.flatMap((a) => (a.files ?? []).map((f) => f.path)));
  const deleted = []; const kept = [];
  for (const f of gone.files ?? []) {
    const path = String(f.path ?? '');
    if (!/^public\//.test(path) || path.split('/').includes('..') || named.has(path)) continue;
    const abs = join(gdir, path);
    if (!existsSync(abs)) continue;
    if (f.sha256 && createHash('sha256').update(readFileSync(abs)).digest('hex') === f.sha256) { rmSync(abs); deleted.push(path); } else kept.push(path);
  }
  return { removed: true, deleted, kept };
}

/* ------------------------------------------------------------------ the licence check (publish, assets check) */

/**
 * What stops a public game, per asset: [{ asset, level: 'refuse' | 'warn', problem, fix }]. `public`: the game's
 * source is shared (game.json share.source is not false) and it is listed. A file a game ships under games/<id>/public
 * with no manifest entry at all is refused too: every shipped model needs a record.
 */
export function licenceProblems(root, id, manifest = readManifest(root, id), { public: pub = true } = {}) {
  const out = [];
  for (const a of manifest.assets) {
    const info = licenseInfo(a.license?.kind);
    if (!info) { out.push({ asset: a.id, level: 'refuse', problem: 'no licence record', fix: `record its licence: homie-studio assets add ${id} --file … --license <cc0|cc-by-4.0|own|…>` }); continue; }
    if (!info.web) out.push({ asset: a.id, level: 'refuse', problem: `${info.label} does not allow a three.js web game to serve the file`, fix: 'replace it (a library match, or generate one)' });
    if (info.attribution && !clean(a.license.attribution)) out.push({ asset: a.id, level: 'refuse', problem: `${info.label} requires credit, and there is no attribution line`, fix: 'add license.attribution (who made it, where it is from)' });
    if (pub && !info.redistribute && a.license.remix === 'include') out.push({ asset: a.id, level: 'refuse', problem: `${info.label} forbids handing the file to remixers, but its remix is "include"`, fix: `set license.remix to "${info.remix}" (remixers get ${info.remix === 'reference' ? 'it from its origin' : 'a placeholder'})` });
    else if (pub && !info.redistribute) out.push({ asset: a.id, level: 'warn', problem: `${info.label}: a public game serves the file to players but never to remixers (${a.license.remix}); keep the studio's repository private while it holds the raw file`, fix: null });
  }
  for (const f of unrecordedModels(root, id, manifest)) out.push({ asset: f, level: 'refuse', problem: 'a shipped model with no record in assets/manifest.json', fix: `homie-studio assets add ${id} --file ${f} --license <kind>` });
  return out;
}

/** Model files a game ships (.glb, .gltf, .fbx, .obj, .vrm under games/<id>/) that no manifest entry names. */
export function unrecordedModels(root, id, manifest = readManifest(root, id)) {
  const dir = join(root, 'games', id);
  const named = new Set(manifest.assets.flatMap((a) => (a.files ?? []).map((f) => f.path)));
  const out = [];
  const walk = (rel, depth) => {
    if (depth > 6) return;
    let entries = [];
    try { entries = readdirSyncSafe(join(dir, rel)); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || ['node_modules', 'codex', 'dist', 'raw'].includes(e.name)) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(glb|gltf|fbx|obj|vrm)$/i.test(e.name) && !named.has(p)) out.push(p);
    }
  };
  walk('', 0);
  return out;
}
const readdirSyncSafe = (p) => readdirSync(p, { withFileTypes: true });

/* ------------------------------------------------------------------ RIGHTS.md */

/**
 * What the providers' own terms say, with the date they were read (the models skill's references/RIGHTS.md keeps the
 * same text and says to read the live pages again before commercial publishing).
 */
export const PROVIDER_TERMS = Object.freeze([
  { who: 'fal (generated images and models)', url: 'https://fal.ai/terms', read: '2026-10-02', says: 'You own what you upload; fal\'s terms give no express assignment of the output to you, and say output may not be unique and is not promised to be non-infringing. The models used here carry fal\'s "Commercial use" label.' },
  { who: 'Tripo (image to 3D through fal)', url: 'https://developers.tripo3d.ai/en/terms', read: '2026-10-02', says: 'Calls through fal are paid calls. Tripo\'s developer terms (last updated 2025-07-11): "you may use Outputs for lawful commercial or non-commercial purposes". Its free plan\'s outputs are public under CC BY 4.0 (a free plan is not used here).' },
  { who: 'Kenney', url: 'https://kenney.nl/support', read: '2026-10-02', says: 'Public domain (CC0): use in any project, commercial or not; credit is not required (kindly given anyway).' },
  { who: 'KayKit', url: 'https://kaylousberg.itch.io/', read: '2026-10-02', says: 'CC0 1.0: free for personal and commercial use, no attribution required.' },
  { who: 'Poly Haven', url: 'https://polyhaven.com/license', read: '2026-10-02', says: 'CC0: use for any purpose, redistribute, even in a product you sell; no credit needed for downloaded files.' },
  { who: 'ambientCG', url: 'https://docs.ambientcg.com/license/', read: '2026-10-02', says: 'CC0 1.0: the raw files may be included in a project such as a video game.' },
]);

const REMIX_WORDS = { include: 'a remix gets this file (fetched from this studio\'s site, checked by SHA-256)', reference: 'a remix fetches it from its origin, never from this studio', none: 'a remix gets a grey placeholder of the same size and needs its own licence' };
const ROUTE_WORDS = { procedural: 'made by the game\'s own code', library: 'from the Homie starter library', generated: 'generated on the studio\'s own account', imported: 'brought in by the studio', premium: 'bought' };
/** A remix's file was made by the original studio, not this one: say whose. */
const whoseAccount = (a) => (a.from?.remixOf?.studio ? `${a.from.remixOf.studio}'s` : 'the original studio\'s');
function routeWords(a) {
  if (!a.from?.remixOf) return ROUTE_WORDS[a.route] ?? a.route;
  if (a.route === 'generated') return `generated on ${whoseAccount(a)} own account`;
  if (a.route === 'imported') return `brought in by ${a.from.remixOf.studio ?? 'the original studio'}`;
  return ROUTE_WORDS[a.route] ?? a.route;
}

/** RIGHTS.md for one game, in plain words. */
export function rightsMarkdown(root, id, manifest = readManifest(root, id)) {
  let game = {};
  try { game = JSON.parse(readFileSync(join(root, 'games', id, 'game.json'), 'utf8')); } catch { game = {}; }
  const lines = [
    `# Rights: ${game.name ?? id}`,
    '',
    `Every file this game ships, where it came from, its licence and what that allows. Written by \`homie-studio assets rights ${id}\` from \`assets/manifest.json\`; do not edit it by hand.`,
    '',
    '## What the providers\' terms say',
    '',
    'Read on the dates shown. Terms change: read the live page again before publishing anything commercial.',
    '',
    ...PROVIDER_TERMS.filter((t) => manifest.assets.some((a) => termsApply(t, a))).map((t) => `- **${t.who}** (${t.url}, read ${t.read}): ${t.says}`),
    ...(manifest.assets.some((a) => a.route === 'generated') ? ['- **Copyright in AI-made files** may be thin: "remix with credit" may not bind a remixer for files no person authored. This file never claims more than the terms above.'] : []),
    '',
    '## Files',
    '',
  ];
  if (!manifest.assets.length) lines.push('None yet: everything on screen is drawn by the game\'s own code.');
  for (const a of manifest.assets) {
    const info = licenseInfo(a.license?.kind);
    const files = (a.files ?? []).filter((f) => f.public !== false).map((f) => `\`${f.path}\``).join(', ');
    lines.push(`### ${a.id}`, '', `- **What:** ${a.kind}${a.card ? ` (${a.card})` : ''}${files ? `: ${files}` : ''}`,
      `- **From:** ${routeWords(a)}${a.from?.pack ? `: ${a.from.packLabel ?? a.from.pack}${a.from.item ? `, ${String(a.from.item).split('/').pop()}` : ''}` : ''}${a.from?.packUrl ?? a.from?.origin ? ` (${a.from.packUrl ?? a.from.origin})` : ''}${a.from?.remixOf ? `; carried from ${a.from.remixOf.game ?? 'the original'}${a.from.remixOf.studio ? ` by ${a.from.remixOf.studio}` : ''}` : ''}${a.made?.steps?.length ? `; ${a.made.steps.map((s) => s.endpoint ? `${s.what} with ${s.endpoint}${Number(s.usd) ? ` (US$${Number(s.usd).toFixed(3)})` : ''}` : `${s.what}${s.tool ? ` (${s.tool})` : ''}`).join(', ')}` : ''}`,
      `- **Licence:** ${info ? (a.from?.remixOf && info.kind === 'generated' ? `Generated on ${whoseAccount(a)} own account` : info.label) : 'NONE RECORDED: this file cannot be published'}${info?.url ? ` (${info.url})` : ''}${a.license?.owner ? `; owner: ${a.license.owner}` : ''}`,
      ...(a.license?.attribution ? [`- **Credit:** ${a.license.attribution}`] : []),
      `- **A remix:** ${REMIX_WORDS[a.license?.remix] ?? REMIX_WORDS.none}`,
      ...(a.license?.notes ? [`- **Notes:** ${a.license.notes}`] : []),
      '');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
function termsApply(t, a) {
  const w = t.who.toLowerCase();
  if (w.startsWith('fal')) return a.route === 'generated';
  if (w.startsWith('tripo')) return (a.made?.steps ?? []).some((s) => /tripo/i.test(String(s.endpoint ?? '')));
  return String(a.from?.pack ?? a.from?.library ?? a.license?.attribution ?? '').toLowerCase().includes(w.split(' ')[0]) || String(a.from?.origin ?? '').toLowerCase().includes(w.split(' ')[0].replace(/\s+/g, ''));
}

export function writeRights(root, id, manifest = readManifest(root, id)) {
  const file = join(root, 'games', id, RIGHTS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  const text = rightsMarkdown(root, id, manifest);
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
  return relative(root, file);
}

/* ------------------------------------------------------------------ credits.json */

/**
 * credits.json `parts[]` (the landing's credits page): one line per library pack used (CC0 needs none; it is kind),
 * and one per attribution-required file. Lines this function wrote carry `"asset": true`; every other part stays.
 */
export function syncCredits(root, id, manifest = readManifest(root, id)) {
  const file = join(root, 'games', id, 'credits.json');
  let credits = {};
  try { credits = JSON.parse(readFileSync(file, 'utf8')); } catch { credits = {}; }
  const keep = (Array.isArray(credits.parts) ? credits.parts : []).filter((p) => p?.asset !== true);
  const parts = [];
  const packs = new Map();
  for (const a of manifest.assets) {
    const info = licenseInfo(a.license?.kind);
    if (!info) continue;
    if (info.attribution) parts.push({ what: `${a.card ?? a.id} (${a.kind})`, author: clean(a.license.attribution, 120), url: a.from?.origin ?? null, licence: info.spdx ?? info.label, licenceUrl: info.url, asset: true });
    else if (a.route === 'library' && a.from?.pack) {
      const key = a.from.pack;
      if (!packs.has(key)) packs.set(key, { what: `${a.from.packLabel ?? a.from.pack} (${a.kind === 'texture' ? 'textures' : 'models'})`, author: a.from.author ?? null, url: a.from.packUrl ?? a.from.origin ?? null, licence: info.spdx ?? info.label, licenceUrl: info.url, note: 'Copied from the Homie starter library', asset: true });
    }
  }
  const next = [...keep, ...packs.values(), ...parts].slice(0, 40);
  if (!next.length && !existsSync(file)) return null;
  const out = { ...credits, parts: next };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
  return relative(root, file);
}

/* ------------------------------------------------------------------ the site's assets.json (remix carry-over) */

/**
 * /games/<id>/assets.json on the built site: each asset's licence and remix rule, and for `include` files their
 * served address (relative to /games/<id>/) and SHA-256, so `game remix` can fetch them. Only files under the
 * game's public/ folder are served; a file's address there is its path without "public/".
 */
export function servedAssets(root, id, out, manifest = readManifest(root, id)) {
  const assets = [];
  for (const a of manifest.assets) {
    const info = licenseInfo(a.license?.kind);
    const remix = info ? (info.redistribute ? a.license.remix ?? info.remix : info.remix === 'include' ? 'none' : info.remix) : 'none';
    const files = (a.files ?? []).filter((f) => f.public !== false && /^public\//.test(String(f.path ?? ''))).map((f) => {
      const served = f.path.replace(/^public\//, '');
      const abs = join(out, served);
      return existsSync(abs) ? { role: f.role, path: f.path, url: served, bytes: statSync(abs).size, sha256: f.sha256 ?? null } : null;
    }).filter(Boolean);
    assets.push({ id: a.id, kind: a.kind, route: a.route, card: a.card ?? null, license: { kind: a.license?.kind ?? null, spdx: info?.spdx ?? null, attribution: a.license?.attribution ?? null, remix }, from: a.from ? { library: a.from.library ?? null, pack: a.from.pack ?? null, item: a.from.item ?? null, origin: a.from.origin ?? null, sha256: a.from.sha256 ?? null } : null, size: a.measured?.box?.size ?? null, files: remix === 'include' ? files : files.map(({ url, ...f }) => ({ ...f, url: null })) });
  }
  return { v: 1, kind: 'homie-game-assets', game: id, assets };
}
