/**
 * Finding and reading a studio: the folder with studio.json at or above the
 * current directory, and its games.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

/** `homie-studio game new <id> --from <starter> --name "<Name>"`: a starter copied in as this studio's own game. */
export function newGame(root, id, { from = 'gem-rush', name } = {}) {
  if (!GAME_ID.test(String(id ?? '')) || RESERVED_IDS.has(id)) throw new Error(`a game id is lowercase letters, digits and hyphens, up to 40, and not one of ${[...RESERVED_IDS].join(', ')} (got ${JSON.stringify(id)})`);
  const src = join(PACKAGE_ROOT, 'starters', from);
  if (!existsSync(join(src, 'game.json'))) throw new Error(`no starter "${from}"; starters: ${starters().map((s) => s.id).join(', ')}`);
  const dest = join(root, 'games', id);
  if (existsSync(join(dest, 'game.json'))) throw new Error(`games/${id} already exists; pick another id or change that game`);
  // A planned game (its folder holds the Game Codex, maybe art, and no game.json yet): the starter goes in around
  // what is there, and nothing of the plan is overwritten.
  if (existsSync(dest) && readdirSync(dest).some((f) => existsSync(join(src, f)))) throw new Error(`games/${id} holds files of its own that a starter would overwrite; pick another id`);
  cpSync(src, dest, { recursive: true });
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
  return { ok: true, command: 'game new', id, from, dir: dest, files: readdirSync(dest, { recursive: true }).map(String) };
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
  return { ok: true, command: 'game remix', id, from: String(url), credit: meta.remixOf.credit, page: meta.remixOf.page, license, files: wrote };
}
