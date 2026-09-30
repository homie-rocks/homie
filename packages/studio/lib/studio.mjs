/**
 * Finding and reading a studio: the folder with studio.json at or above the
 * current directory, and its games.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GAME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESERVED_IDS = new Set(['api', 'media', 'games', 'assets', '_homie', 'well-known', 'index', 'play', 'studio', 'studios', 'music', 'videos', 'posts']);

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

/** `homie-studio game new <id> --from <starter> --name "<Name>"`: a starter copied in as this studio's own game. */
export function newGame(root, id, { from = 'gem-rush', name } = {}) {
  if (!GAME_ID.test(String(id ?? '')) || RESERVED_IDS.has(id)) throw new Error(`a game id is lowercase letters, digits and hyphens, up to 40, and not one of ${[...RESERVED_IDS].join(', ')} (got ${JSON.stringify(id)})`);
  const src = join(PACKAGE_ROOT, 'starters', from);
  if (!existsSync(join(src, 'game.json'))) throw new Error(`no starter "${from}"; starters: ${starters().map((s) => s.id).join(', ')}`);
  const dest = join(root, 'games', id);
  if (existsSync(dest)) throw new Error(`games/${id} already exists; pick another id or change that game`);
  cpSync(src, dest, { recursive: true });
  const meta = JSON.parse(readFileSync(join(dest, 'game.json'), 'utf8'));
  meta.id = id;
  if (name) meta.name = String(name).slice(0, 60);
  meta.from = { starter: from, studio: JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version };
  writeFileSync(join(dest, 'game.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const main = join(dest, meta.entry ?? 'src/main.ts');
  if (existsSync(main)) writeFileSync(main, readFileSync(main, 'utf8').replace(new RegExp(`game: '${from}'`, 'g'), `game: '${id}'`));
  const html = join(dest, 'index.html');
  if (name && existsSync(html)) writeFileSync(html, readFileSync(html, 'utf8').replace(/<title>[^<]*<\/title>/, `<title>${String(name).replace(/[<&]/g, '')}</title>`));
  return { ok: true, command: 'game new', id, from, dir: dest, files: readdirSync(dest, { recursive: true }).map(String) };
}

/** `homie-studio game remix <source.json url> --id <new id>`: a shared game brought in as this studio's own. */
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
  meta.remixOf = { source: String(url), id: from, name: meta.name };
  meta.id = id;
  if (name) meta.name = String(name).slice(0, 60);
  writeFileSync(join(dest, 'game.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const main = join(dest, meta.entry ?? 'src/main.ts');
  if (existsSync(main) && from) writeFileSync(main, readFileSync(main, 'utf8').replace(new RegExp(`game: '${from}'`, 'g'), `game: '${id}'`));
  return { ok: true, command: 'game remix', id, from: String(url), files: wrote };
}
