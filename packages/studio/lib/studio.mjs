/**
 * Finding and reading a studio: the folder with studio.json at or above the
 * current directory, and its games.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { httpsPage, licenseOf, pageOfSource, remixAllowed, remixCredit, remixRow } from '../worker/license.mjs';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESERVED_IDS = new Set(['api', 'media', 'games', 'assets', '_homie', '_site', '_studio', 'well-known', 'index', 'play', 'studio', 'studios', 'music', 'videos', 'posts', 'rooms', 'feed', 'account']);

export function findStudio(from = process.cwd()) {
  let at = resolve(from);
  for (;;) {
    if (existsSync(join(at, 'studio.json'))) return at;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

export function requireStudio(from) {
  const root = findStudio(from);
  if (!root) throw new Error('not inside a studio (no studio.json here or above). Make one: npx homie-studio new <folder> --name "<Studio Name>"');
  return root;
}

/*
 * WHERE THE WORKER'S CONFIG LIVES. From 0.10.0 a new studio keeps `wrangler.jsonc` at its root, which is what
 * Cloudflare's Workers Builds and its "Deploy to Cloudflare" button read (they run the studio's own `npm run build`
 * and `npm run deploy` at the repository's root). A studio made before 0.10.0 keeps `site/wrangler.jsonc`; every
 * command runs Wrangler next to whichever the studio has, so both keep working.
 */
export function workerDir(root) { return existsSync(join(root, 'wrangler.jsonc')) || !existsSync(join(root, 'site', 'wrangler.jsonc')) ? root : join(root, 'site'); }
export function configPath(root) { return join(workerDir(root), 'wrangler.jsonc'); }
/** 'root' (0.10.0 and later: Workers Builds ready) or 'site' (older studios). */
export function layoutOf(root) { return workerDir(root) === root ? 'root' : 'site'; }

export function readStudio(root) { return JSON.parse(readFileSync(join(root, 'studio.json'), 'utf8')); }
export function writeStudio(root, studio) { writeFileSync(join(root, 'studio.json'), `${JSON.stringify(studio, null, 2)}\n`); }

/*
 * WHERE THE SITE'S ADDRESS LIVES. studio.json is committed, and a workers.dev address carries the Cloudflare
 * account's subdomain, which is often the person's own name. So studio.json keeps only a CUSTOM domain
 * (`cloudflare.domain`, e.g. "night-owls.example"); the workers.dev address `deploy` gets back stays on this
 * computer in .studio/local.json, which the studio's .gitignore leaves out.
 */
export const LOCAL_STATE = '.studio/local.json';
export const isWorkersDev = (url) => { try { return /\.workers\.dev$/i.test(new URL(url).hostname); } catch { return false; } };

/** `cloudflare.domain` as an origin: "example.com" or "https://example.com/" become "https://example.com"; else null. */
export function domainOrigin(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol !== 'https:' || !u.hostname.includes('.') || isWorkersDev(u.origin)) return null;
    return u.origin;
  } catch { return null; }
}

export function readLocal(root) {
  try { return JSON.parse(readFileSync(join(root, LOCAL_STATE), 'utf8')); } catch { return {}; }
}
export function writeLocal(root, patch) {
  const path = join(root, LOCAL_STATE);
  mkdirSync(dirname(path), { recursive: true });
  const next = { ...readLocal(root), ...patch };
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * The studio site's public address: its custom domain (studio.json `cloudflare.domain`, or a non-workers.dev
 * `cloudflare.url` an older studio wrote by hand), else the workers.dev address this computer's deploy got back,
 * else an older studio.json's workers.dev `url` (until the next deploy moves it out).
 */
export function siteUrl(root, studio = readStudio(root)) {
  const cf = studio.cloudflare ?? {};
  const custom = domainOrigin(cf.domain) ?? (cf.url && !isWorkersDev(cf.url) ? domainOrigin(cf.url) : null);
  return custom ?? readLocal(root).url ?? cf.url ?? null;
}

export function listGames(root) {
  const dir = join(root, 'games');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'game.json')))
    .map((d) => {
      const meta = JSON.parse(readFileSync(join(dir, d.name, 'game.json'), 'utf8'));
      return { ...meta, id: meta.id ?? d.name, dir: join(dir, d.name) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function starters() {
  const dir = join(PACKAGE_ROOT, 'starters');
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const meta = JSON.parse(readFileSync(join(dir, d.name, 'game.json'), 'utf8'));
    return { id: d.name, name: meta.name, blurb: meta.blurb, players: meta.players, roundSeconds: meta.roundSeconds };
  });
}

/**
 * A game's Game Lab takes (lab.json) seed its saves by the game's id (`homie-saves.local.<id>`, saves/saves.ts): a copy
 * under a new id renames them, so a take's saved hero is still found.
 */
function renameTakeSaves(dir, from, id) {
  const file = join(dir, 'lab.json');
  if (!existsSync(file) || from === id) return;
  const text = readFileSync(file, 'utf8');
  const next = text.split(`"homie-saves.local.${from}"`).join(`"homie-saves.local.${id}"`);
  if (next !== text) writeFileSync(file, next);
}

/**
 * `homie-studio game new <id> --from <starter> --name "<Name>"`: a starter copied in as this studio's own game. A starter
 * whose game.json says `"assets": "library"` gets its models from the starter library here (fetchStarterModels).
 */
export async function newGame(root, id, { from = 'gem-rush', name } = {}) {
  if (!GAME_ID.test(String(id ?? '')) || RESERVED_IDS.has(id)) throw new Error(`a game id is lowercase letters, digits and hyphens, up to 40, and not one of ${[...RESERVED_IDS].join(', ')} (got ${JSON.stringify(id)})`);
  const src = join(PACKAGE_ROOT, 'starters', from);
  if (!existsSync(join(src, 'game.json'))) throw new Error(`no starter "${from}"; starters: ${starters().map((s) => s.id).join(', ')}`);
  const dest = join(root, 'games', id);
  if (existsSync(join(dest, 'game.json'))) throw new Error(`games/${id} already exists; pick another id or change that game`);
  // A planned game (its folder holds the Game Codex, maybe its art direction and models, and no game.json yet): the
  // starter goes in around what is there, and nothing of the plan is overwritten. Its style.json (from its own
  // decisions) and credits.json stay; the starter's models join its assets/manifest.json beside the game's own.
  const ADOPT = ['style.json', 'credits.json', 'assets'];
  const planned = existsSync(dest) ? readdirSync(dest).filter((f) => existsSync(join(src, f))) : [];
  const clash = planned.filter((f) => !ADOPT.includes(f));
  if (clash.length) throw new Error(`games/${id} holds files of its own that a starter would overwrite (${clash.join(', ')}); pick another id`);
  cpSync(src, dest, { recursive: true, filter: (from) => !planned.some((f) => from === join(src, f) || from.startsWith(join(src, f) + sep)) });
  const meta = JSON.parse(readFileSync(join(dest, 'game.json'), 'utf8'));
  meta.id = id;
  if (name) meta.name = String(name).slice(0, 60);
  meta.from = { starter: from, studio: JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version };
  writeFileSync(join(dest, 'game.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const main = join(dest, meta.entry ?? 'src/main.ts');
  if (existsSync(main)) writeFileSync(main, readFileSync(main, 'utf8').replace(new RegExp(`game: '${from}'`, 'g'), `game: '${id}'`));
  renameTakeSaves(dest, from, id);
  const html = join(dest, 'index.html');
  if (name && existsSync(html)) writeFileSync(html, readFileSync(html, 'utf8').replace(/<title>[^<]*<\/title>/, `<title>${String(name).replace(/[<&]/g, '')}</title>`));
  const merged = planned.includes('assets') && existsSync(join(src, 'assets', 'manifest.json')) ? await adoptStarterAssets(root, id, src) : null;
  const needs = addNeeds(root, meta.needs);
  const models = meta.assets === 'library' ? await fetchStarterModels(dest, merged) : null;
  // A starter with models carries their rights: assets/RIGHTS.md and the credits, written again for this game.
  if (existsSync(join(dest, 'assets', 'manifest.json'))) {
    const { readManifest, syncCredits, writeRights } = await import('./asset-manifest.mjs');
    const manifest = readManifest(root, id);
    writeRights(root, id, manifest);
    syncCredits(root, id, manifest);
  }
  return { ok: true, command: 'game new', id, from, dir: dest, files: readdirSync(dest, { recursive: true }).map(String), ...needs, ...(models ? { models } : {}) };
}

/**
 * A planned game that already has models: the starter's entries join its assets/manifest.json (an id the game
 * already uses keeps the game's own). The game's code draws them under the game's current decisions (it reads
 * style.json), so each adopted entry is recorded as made under those revisions, not the starter's. Returns the
 * adopted ids (the only ones fetched).
 */
async function adoptStarterAssets(root, id, src) {
  const { readManifest, writeManifest } = await import('./asset-manifest.mjs');
  const { readDecisions, revisionsFor, setDecision } = await import('./decisions.mjs');
  const mine = readManifest(root, id);
  const theirs = JSON.parse(readFileSync(join(src, 'assets', 'manifest.json'), 'utf8'));
  // The starter is dressed from one library family: an automatic pick follows it (one family a game); one the person
  // chose stays, and the lineup flags the starter's models until they are swapped.
  const family = (theirs.assets ?? []).map((a) => String(a.from?.pack ?? '').split('-')[0]).find(Boolean);
  const before = readDecisions(root, id)?.decisions?.['cast.family'];
  if (family && before && before.value !== family && before.state === 'auto') {
    setDecision(root, id, 'cast.family', family, { by: 'ai', why: `the starter's models are ${family}; one family a game, so every piece fits` });
  }
  const doc = readDecisions(root, id);
  const adopted = [];
  for (const a of theirs.assets ?? []) {
    if (mine.assets.some((x) => x.id === a.id)) continue;
    if (doc && a.made?.under) a.made.under = revisionsFor(doc, Object.keys(a.made.under));
    mine.assets.push(a);
    adopted.push(a.id);
  }
  writeManifest(root, id, mine);
  return adopted;
}

/**
 * A STARTER'S MODELS COME FROM THE STARTER LIBRARY: the repository keeps no binaries, so such a starter ships only its
 * assets/manifest.json, each model a library item (`from.item`) and the file it goes to. Each is fetched from the
 * library (HOMIE_LIBRARY: a folder or an address; homie.rocks by default), checked by the index's SHA-256 and the GLB
 * safety rules (lib/library.mjs fetchItemFile), and written there; the manifest keeps the SHA-256 of what was written.
 * When the library cannot be reached the models stay out, `why` says so, and the game draws its stand-ins until they
 * come (`homie-studio assets add <game> <item> --as <asset>`). Returns { fetched, missing: [{ asset, item, why }], from }.
 */
async function fetchStarterModels(dest, only = null) {
  const file = join(dest, 'assets', 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  const wanted = (manifest.assets ?? []).filter((a) => (!only || only.includes(a.id)) && a.route === 'library' && a.from?.item && (a.files ?? []).some((f) => f.role === 'model' && /^public\/models\/[a-z0-9][a-z0-9-]{0,47}\.glb$/.test(String(f.path))));
  if (!wanted.length) return null;
  const { fetchItemFile, libraryBase, loadIndex } = await import('./library.mjs');
  const lib = libraryBase();
  let index;
  try { index = (await loadIndex({ lib })).index; } catch (error) {
    return { fetched: 0, missing: wanted.map((a) => ({ asset: a.id, item: a.from.item, why: 'no library' })), why: error.message, from: lib.base };
  }
  const missing = [];
  let fetched = 0;
  // A character the starter names with a `rig` recipe goes through the character pipeline (lib/characters.mjs): made
  // phone-sized, its held things picked, its clips baked into its skeleton's clip library. Everything else is copied.
  const rigged = wanted.filter((a) => a.rig && ['character', 'creature'].includes(a.kind));
  for (const a of wanted.filter((x) => !rigged.includes(x))) {
    const item = index.items.find((x) => x.id === a.from.item);
    const f = a.files.find((x) => x.role === 'model');
    if (!item) { missing.push({ asset: a.id, item: a.from.item, why: `the library has no ${a.from.item}` }); continue; }
    try {
      const { bytes, sha256 } = await fetchItemFile(lib, item);
      mkdirSync(dirname(join(dest, f.path)), { recursive: true });
      writeFileSync(join(dest, f.path), bytes);
      Object.assign(f, { bytes: bytes.byteLength, sha256 });
      a.from.sha256 = sha256;
      fetched += 1;
    } catch (error) { missing.push({ asset: a.id, item: a.from.item, why: error.message }); }
  }
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  let baked = 0;
  if (rigged.length) {
    const { addCharacter } = await import('./characters.mjs');
    const root = join(dest, '..', '..');
    const game = basename(dest);
    for (const a of rigged) {
      try {
        await addCharacter(root, game, { item: a.from.item, as: a.id, kind: a.kind, card: a.card ?? null, height: a.rig.heightM ?? null, keep: a.rig.keep ?? null, verbs: a.rig.verbs ?? [], lib, index });
        fetched += 1; baked += 1;
      } catch (error) { missing.push({ asset: a.id, item: a.from.item, why: error.message }); }
    }
  }
  return { fetched, missing, from: lib.base, ...(baked ? { characters: baked } : {}) };
}

/**
 * WHAT A STARTER NEEDS FROM NPM. A starter's game.json may say `"needs": { "three": "0.185.1" }`: libraries its code
 * imports that a studio does not have yet. Each one the studio's package.json lacks (in dependencies or
 * devDependencies) goes into devDependencies at that exact version, so the game bundles one copy of it (a second
 * three.js beside the one @homie-rocks/studio/assets imports would be two engines). A version the studio already
 * pins is left as it is and named in `needsHeld`. `needs` stays in the game's game.json: it is what the game was
 * written against. Returns { needs, needsAdded, needsHeld, installNeeded }.
 */
export function addNeeds(root, needs) {
  const want = needs && typeof needs === 'object' && !Array.isArray(needs) ? Object.entries(needs).filter(([n, v]) => /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,213}$/.test(n) && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(v))) : [];
  if (!want.length) return {};
  const file = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const added = []; const held = [];
  for (const [n, v] of want) {
    const have = pkg.dependencies?.[n] ?? pkg.devDependencies?.[n];
    if (have) { if (have !== v) held.push({ name: n, want: v, have }); continue; }
    pkg.devDependencies = { ...(pkg.devDependencies ?? {}), [n]: String(v) };
    added.push({ name: n, version: String(v) });
  }
  if (added.length) {
    pkg.devDependencies = Object.fromEntries(Object.entries(pkg.devDependencies).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return { needs: Object.fromEntries(want), needsAdded: added, needsHeld: held, installNeeded: added.length > 0 };
}

/**
 * `homie-studio game remix <source.json url> --id <new id>`: a shared game brought in as this studio's own. Its
 * game.json `remixOf` credits the original ("Remix of <game> by <studio>", with a link back to its page), and its
 * landing and credits show it. A game whose owner's licence says no remix is refused (worker/license.mjs).
 */
export async function remixGame(root, source, id, { name } = {}) {
  if (!GAME_ID.test(String(id ?? '')) || RESERVED_IDS.has(id)) throw new Error('give the new game an id: --id <lowercase-id>');
  const dest = join(root, 'games', id);
  if (existsSync(dest)) throw new Error(`games/${id} already exists`);
  let url;
  try { url = new URL(source); } catch { throw new Error('usage: homie-studio game remix <https://studio.site/games/<id>/source.json> --id <new id>'); }
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('a remix source is an https:// address');
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const body = await res.json();
  if (body?.kind !== 'homie-game-source' || !body.files || typeof body.files !== 'object') throw new Error('that address is not a shared Homie game source');
  // Who made it and what they allow: the source's credit and licence (a studio before 0.14.4 sends neither, so the
  // default licence, and the page from the address).
  const credit = body.credit && typeof body.credit === 'object' ? body.credit : {};
  const license = licenseOf(body.license);
  if (!remixAllowed(license)) {
    const who = remixRow({ name: credit.game ?? body.id, studio: credit.studio });
    throw new Error(`${who?.name ?? 'That game'}${who?.studio ? ` by ${who.studio}` : ''} is not open to remixing: its owner's licence says no remix. Make a game of your own like it instead.`);
  }
  const wrote = [];
  for (const [rel, text] of Object.entries(body.files)) {
    if (typeof text !== 'string' || rel.includes('..') || rel.startsWith('/') || !/^[A-Za-z0-9._/-]+$/.test(rel)) continue;
    const path = join(dest, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    wrote.push(rel);
  }
  if (!existsSync(join(dest, 'game.json'))) throw new Error('the shared source has no game.json');
  const meta = JSON.parse(readFileSync(join(dest, 'game.json'), 'utf8'));
  const from = meta.id;
  // The credit, in the remix's own game.json: the original's name, studio, page and licence, the line its landing and
  // credits show, and, when the original was itself a remix, what that was a remix of.
  const row = remixRow({ name: credit.game ?? meta.name ?? from, studio: credit.studio, page: httpsPage(credit.page) ?? pageOfSource(url) });
  const before = remixRow(meta.remixOf);
  meta.remixOf = {
    credit: remixCredit(row), name: row?.name ?? null, studio: row?.studio ?? null, page: row?.page ?? null,
    source: String(url), id: from, license, ...(before ? { of: before } : {}),
  };
  meta.id = id;
  if (name) meta.name = String(name).slice(0, 60);
  writeFileSync(join(dest, 'game.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const main = join(dest, meta.entry ?? 'src/main.ts');
  if (existsSync(main) && from) writeFileSync(main, readFileSync(main, 'utf8').replace(new RegExp(`game: '${from}'`, 'g'), `game: '${id}'`));
  if (from) renameTakeSaves(dest, from, id);
  // Its models and pictures (0.22.0): fetched from the original site and checked by SHA-256 where their licence lets a
  // remix carry them; a grey placeholder of the same size where it does not (lib/remix-assets.mjs).
  let assets = null;
  if (existsSync(join(dest, 'assets', 'manifest.json'))) {
    const { fetchRemixAssets } = await import('./remix-assets.mjs');
    assets = await fetchRemixAssets(root, id, url, { credit: { studio: credit.studio ?? null, game: credit.game ?? meta.name ?? from } });
  }
  // What its code imports beyond the toolkit (a 3D game: three.js). A remix source is someone else's text, so only the
  // libraries the toolkit's own starters use are added; anything else is named for the person to decide.
  const asked = meta.needs && typeof meta.needs === 'object' && !Array.isArray(meta.needs) ? meta.needs : {};
  const refusedNeeds = Object.keys(asked).filter((n) => !REMIX_NEEDS.has(n));
  const needs = addNeeds(root, Object.fromEntries(Object.entries(asked).filter(([n]) => REMIX_NEEDS.has(n))));
  return { ok: true, command: 'game remix', id, from: String(url), credit: meta.remixOf.credit, page: meta.remixOf.page, license, files: wrote, ...(assets ? { assets } : {}), ...needs, ...(refusedNeeds.length ? { needsNotAdded: refusedNeeds } : {}) };
}
/** The libraries a remix may add to a studio's package.json by itself (the ones the toolkit's starters use). */
const REMIX_NEEDS = new Set(['three']);
