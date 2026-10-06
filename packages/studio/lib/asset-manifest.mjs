/**
 * EVERY ASSET'S PROVENANCE AND LICENCE: games/<id>/assets/manifest.json, one entry per model,
 * texture, sky or procedural part a game ships, with where it came from (procedural, library, generated, imported),
 * each step that made it (endpoint, receipt, price), the decision revisions it was made under (lib/decisions.mjs),
 * its licence, its measurements and its review. An entry the game's code changes at runtime
 * says so in `inGame` ({ heightM, repaint }: drawn at that height, repainted from style.json), so the lineup draws
 * it as the game does. An entry may also say what the game does with it now (`usage`: cast, prop, environment, or
 * unused for a file kept in the folder that the game no longer draws), so a lineup and a scene estimate are about the
 * game, not the folder. From it:
 *
 *   games/<id>/assets/RIGHTS.md   what each file is, where it came from, its licence and what that allows, in plain words
 *   games/<id>/credits.json       a `parts[]` line per pack or attribution-required file (the landing's credits page)
 *   licenceProblems()             what `publish` and `assets check` refuse: a file with no licence record, a licence
 *                                 that forbids a web game, attribution that never reached credits
 *
 * A game's files reach its players and nobody else: no game is handed over whole (remix was retired). A piece of a
 * game its studio shares is a part, and lib/parts.mjs decides what may be in one from the `redistribute` word here.
 * A manifest written by an older toolkit carries `license.remix` on every entry (what a remix was to get); nothing
 * reads it any more and nothing writes it.
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
 * What the game does with an asset now (`usage` on its record): `cast` (the characters and creatures in play), `prop`
 * (things in play: pickups, weapons, set pieces), `environment` (scenery, kits, ground textures, skies) or `unused`
 * (a file still in the folder that the game no longer draws). A record that does not say is read by its kind, so a
 * manifest written before this field is sorted the way it always was, with nothing marked unused.
 */
export const USAGES = Object.freeze(['cast', 'prop', 'environment', 'unused']);
const USAGE_OF_KIND = { character: 'cast', creature: 'cast', prop: 'prop', kit: 'environment', environment: 'environment', texture: 'environment', sky: 'environment' };
/** An asset's usage: what its record says, else what its kind suggests. A clip library has none (it is drawn by no one). */
export function usageOf(a) {
  if (a?.kind === 'clip') return null;
  return USAGES.includes(a?.usage) ? a.usage : USAGE_OF_KIND[a?.kind] ?? 'prop';
}

/**
 * Licence kinds: whether the file itself may be handed on (in a shared part, lib/parts.mjs, and on Homie's mirror),
 * whether credit is required, and whether a browser game may serve the file at all.
 */
export const LICENSES = Object.freeze({
  cc0: { label: 'CC0 1.0 (public domain)', spdx: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', redistribute: true, attribution: false, web: true },
  'cc-by-4.0': { label: 'CC BY 4.0', spdx: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/', redistribute: true, attribution: true, web: true },
  'cc-by-3.0': { label: 'CC BY 3.0', spdx: 'CC-BY-3.0', url: 'https://creativecommons.org/licenses/by/3.0/', redistribute: true, attribution: true, web: true },
  own: { label: 'The studio\'s own work', spdx: null, url: null, redistribute: true, attribution: false, web: true },
  generated: { label: 'Generated on the studio\'s own account', spdx: null, url: null, redistribute: true, attribution: false, web: true },
  qal: { label: 'Quaternius Asset License', spdx: null, url: 'https://quaternius.com/license.html', redistribute: false, attribution: false, web: true },
  mixamo: { label: 'Mixamo (Adobe)', spdx: null, url: 'https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html', redistribute: false, attribution: false, web: true },
  other: { label: 'Other (see notes)', spdx: null, url: null, redistribute: false, attribution: false, web: true },
});
/** `eula:<name>` and `market:<listing>` are commercial licences: never handed on; TurboSquid never on the web. */
export function licenseInfo(kind) {
  const k = String(kind ?? '');
  if (LICENSES[k]) return { kind: k, ...LICENSES[k] };
  if (/^eula:[a-z0-9-]{1,40}$/.test(k)) return { kind: k, label: `Commercial licence (${k.slice(5)})`, spdx: null, url: null, redistribute: false, attribution: false, web: k !== 'eula:turbosquid' };
  if (/^market:[a-z0-9:._-]{1,80}$/.test(k)) return { kind: k, label: `Bought (${k.slice(7)})`, spdx: null, url: null, redistribute: false, attribution: false, web: true };
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
  if (e?.usage !== undefined && e.usage !== null && !USAGES.includes(e.usage)) problems.push(`a usage: ${USAGES.join(', ')}`);
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
  const check = checkEntry(e);
  if (!check.ok) throw new Error(`asset ${e.id ?? '?'} needs ${check.problems.join('; ')}`);
  // One clip library a skeleton, unless the second says what it is. A second library registered for the same skeleton
  // used to shadow the first silently: every verb of the original then read as missing and its previews drew nothing.
  // Only a NEW record is a registration: baking more verbs into a library already here replaces its own record.
  if (e.kind === 'clip' && e.rig?.skeleton && e.rig.supplemental !== true && !manifest.assets.some((a) => a.id === e.id)) {
    const other = manifest.assets.find((a) => a.kind === 'clip' && a.id !== e.id && a.rig?.skeleton === e.rig.skeleton && a.rig?.supplemental !== true);
    if (other) throw new Error(`asset ${e.id} would be a second clip library for the skeleton ${e.rig.skeleton}, which ${other.id} already is. Add its verbs to that library instead (homie-studio anim add ${id} <character> --verbs … --from <this file>), or record it as a supplemental library the game loads itself ("rig": { …, "supplemental": true })`);
  }
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
  // Its pack's name, author and page go with it; a clip library still holding clips retargeted from that pack keeps
  // them, so the credit for the animation outlives the model it came in with.
  if (gone.from?.pack) {
    for (const a of manifest.assets) {
      if (a.kind !== 'clip' || !clipPacks(a).includes(gone.from.pack)) continue;
      a.from = { ...(a.from ?? {}), packs: { ...(a.from?.packs ?? {}), [gone.from.pack]: a.from?.packs?.[gone.from.pack] ?? packDetails(gone) } };
    }
  }
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

/** `assets use <id> <asset> <usage>`: say what the game does with an asset now (USAGES); `auto` forgets it. */
export function setUsage(root, id, assetId, usage) {
  const manifest = readManifest(root, id);
  const a = manifest.assets.find((x) => x.id === assetId);
  if (!a) throw new Error(`no asset "${assetId}" in games/${id}/${MANIFEST_FILE}`);
  if (a.kind === 'clip') throw new Error(`${assetId} is a clip library: it has no usage (its characters do)`);
  if (usage === 'auto' || usage === null) delete a.usage;
  else if (USAGES.includes(usage)) a.usage = usage;
  else throw new Error(`a usage is one of ${USAGES.join(', ')} (or auto, to go by its kind again)`);
  writeManifest(root, id, manifest);
  return { asset: assetId, usage: usageOf(a), explicit: Boolean(a.usage) };
}

/* ------------------------------------------------------------------ the licence check (publish, assets check) */

/**
 * What stops a public game, per asset: [{ asset, level: 'refuse' | 'warn', problem, fix }]. A file a game ships under
 * games/<id>/public with no manifest entry at all is refused too: every shipped model needs a record.
 */
export function licenceProblems(root, id, manifest = readManifest(root, id)) {
  const out = [];
  for (const a of manifest.assets) {
    const info = licenseInfo(a.license?.kind);
    if (!info) { out.push({ asset: a.id, level: 'refuse', problem: 'no licence record', fix: `record its licence: homie-studio assets add ${id} --file … --license <cc0|cc-by-4.0|own|…>` }); continue; }
    if (!info.web) out.push({ asset: a.id, level: 'refuse', problem: `${info.label} does not allow a three.js web game to serve the file`, fix: 'replace it (a library match, or generate one)' });
    if (info.attribution && !clean(a.license.attribution)) out.push({ asset: a.id, level: 'refuse', problem: `${info.label} requires credit, and there is no attribution line`, fix: 'add license.attribution (who made it, where it is from)' });
    // A licence that lets the game serve the file but not hand it on: nothing in a build hands it on, so this is a
    // word about the two places it still could be (the studio's own repository, and a part the studio shares).
    if (!info.redistribute) out.push({ asset: a.id, level: 'warn', problem: `${info.label}: the game may serve the file to players, but the file itself may not be handed on; keep the studio's repository private while it holds the raw file, and leave it out of any part the studio shares`, fix: null });
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

const PICTURE = /\.(png|jpe?g|webp|avif|gif|hdr|exr|ktx2)$/i;
/**
 * Pictures in a game's folder that no manifest entry names, in two lists that mean different things:
 *   shipped      under public/ (the build serves them): runtime artwork with no hash, size or licence on record, and
 *                no part of the picture-memory estimate. The game's cover and its hero/ footage are left out (they are
 *                the landing's, never a texture).
 *   notShipped   anywhere else in the folder (raw or private art the build never serves): named, never counted.
 * The codex (private, the style board's own swatches) is not walked at all.
 */
export function unrecordedPictures(root, id, manifest = readManifest(root, id), { cover = null } = {}) {
  const dir = join(root, 'games', id);
  const named = new Set(manifest.assets.flatMap((a) => (a.files ?? []).map((f) => f.path)));
  const coverPaths = new Set(cover ? [String(cover).replace(/^\.\//, ''), `public/${String(cover).replace(/^\.\//, '')}`] : []);
  const shipped = []; const notShipped = [];
  const walk = (rel, depth) => {
    if (depth > 6) return;
    let entries = [];
    try { entries = readdirSyncSafe(join(dir, rel)); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || ['node_modules', 'codex', 'dist', 'hero', '_landing'].includes(e.name)) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, depth + 1);
      else if (PICTURE.test(e.name) && !named.has(p) && !coverPaths.has(p)) (p.startsWith('public/') ? shipped : notShipped).push(p);
    }
  };
  walk('', 0);
  return { shipped: shipped.sort(), notShipped: notShipped.sort() };
}

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

const ROUTE_WORDS = { procedural: 'made by the game\'s own code', library: 'from the Homie starter library', generated: 'generated on the studio\'s own account', imported: 'brought in by the studio', premium: 'bought' };
/**
 * A game made from another studio's while that was possible (`game remix`, retired) carried that game's files, and
 * each such record says so in `from.remixOf` ({ studio, game }). The file was made by the original studio, not this
 * one: RIGHTS.md keeps saying whose, as a credit owed.
 */
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
    ...(manifest.assets.some((a) => a.route === 'generated') ? ['- **Copyright in AI-made files** may be thin: a licence on a file no person authored may not bind whoever copies it. This file never claims more than the terms above.'] : []),
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
  const before = Array.isArray(credits.parts) ? credits.parts : [];
  const keep = before.filter((p) => p?.asset !== true);
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
  // Clips retargeted from a pack are that pack's work for as long as a clip library holds them, whether or not any of
  // its models is still in the game: removing the starter characters must not drop the credit for their animation.
  // The pack's name and page come from the clip record (kept when its last model left), else from a model of the pack
  // still here, else from the line this file already had; a pack nothing describes is credited by its id.
  for (const a of manifest.assets) {
    if (a.kind !== 'clip') continue;
    const info = licenseInfo(a.license?.kind) ?? licenseInfo('cc0');
    for (const key of clipPacks(a)) {
      if (packs.has(key)) continue;
      const peer = manifest.assets.find((x) => x.from?.pack === key);
      const d = a.from?.packs?.[key] ?? (peer ? packDetails(peer) : null);
      const was = before.find((p) => p?.asset === true && (p.pack === key || (d?.label && String(p.what ?? '').startsWith(d.label))));
      packs.set(key, { what: `${d?.label ?? (was ? String(was.what).replace(/ \([^)]*\)$/, '') : key)} (animation clips)`, author: d?.author ?? was?.author ?? null, url: d?.url ?? was?.url ?? null, licence: info.spdx ?? info.label, licenceUrl: info.url, note: 'Animation clips from the Homie starter library, retargeted onto this game\'s characters', pack: key, asset: true });
    }
  }
  const next = [...keep, ...packs.values(), ...parts].slice(0, 40);
  if (!next.length && !existsSync(file)) return null;
  const out = { ...credits, parts: next };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
  return relative(root, file);
}

/** The packs a clip library's clips came from: the pack part of each library item it names ("<pack>/<item>"). */
export function clipPacks(a) {
  const from = [...(a?.from?.items ?? []), ...(a?.clips ?? []).map((c) => c?.from)];
  return [...new Set(from.filter((x) => typeof x === 'string' && /^[a-z0-9][a-z0-9-]*\/[^/]+$/i.test(x)).map((x) => x.split('/')[0]))];
}
/** A pack's name, author and page as a record of one of its items holds them. */
const packDetails = (a) => ({ label: a.from?.packLabel ?? a.from?.pack ?? null, author: a.from?.author ?? null, url: a.from?.packUrl ?? a.from?.origin ?? null });
