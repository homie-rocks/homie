/**
 * What measure.mjs (local workerd) and cloudflare.mjs (a real deploy) share: Gem Rush built from one toolkit checkout
 * (its own starter, its own view and client, its own room Worker), and the rooms measured.
 *
 * The phones are the toolkit's real client (phones.mjs): rules/view.ts over netplay/netplay.ts, on real sockets.
 */
import { fork } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Gem Rush from `toolkit`: its rules for the room, and its view bundle for the phones, in `scratch`. */
export async function gemRush({ toolkit, scratch }) {
  mkdirSync(scratch, { recursive: true });
  const studio = join(toolkit, 'packages/studio');
  const kit = await import(pathToFileURL(join(studio, 'test/rules-kit.mjs')).href);
  const { viewPlugin } = await import(pathToFileURL(join(studio, 'lib/rules-build.mjs')).href);
  const esbuild = await kit.esbuildOf(), dir = join(studio, 'starters/gem-rush');
  const meta = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8'));
  const game = { id: 'gem-rush', dir, players: meta.players, room: meta.room };
  const rules = await kit.prepareRuntimeFixture(esbuild, scratch, game);
  const entry = join(scratch, 'view-entry.ts'), view = join(scratch, 'view.mjs'), rulesFile = join(scratch, 'rules.mjs');
  writeFileSync(entry, `export {openRoom} from ${JSON.stringify(join(studio, 'rules/view.ts'))};`);
  await esbuild.build({ stdin: { contents: `import 'homie:game';export {openRoom} from ${JSON.stringify(entry)};`, resolveDir: scratch }, bundle: true, format: 'esm', platform: 'node', outfile: view, plugins: [viewPlugin(game, rules, entry)], logLevel: 'silent' });
  writeFileSync(rulesFile, rules.code);
  return { room: meta.room, view, rulesFile, dir, data: { tune: rules.tune, map: rules.map, settings: rules.settings, seats: rules.seats, build: rules.build, stateHash: rules.stateHash } };
}

/** The room Worker. `instrument`: count constructions and the time any timer was pending (local runs only). */
export async function roomWorker({ toolkit, game, instrument = false }) {
  const studio = join(toolkit, 'packages/studio');
  const { build } = await import(pathToFileURL(join(toolkit, 'node_modules/esbuild/lib/main.js')).href);
  const entry = `
import {Table as BaseTable, Lobby, hostRules} from '${join(studio, 'worker/index.mjs')}';
import rules from '${game.rulesFile}';
const data = ${JSON.stringify(game.data)};
hostRules({ 'gem-rush': { rules, ...data } });
export {Lobby};
const stats = { constructed: 0, events: 0, heldMs: 0, heldSince: null, pending: new Set() };
${instrument ? `
const st = globalThis.setTimeout, si = globalThis.setInterval, ct = globalThis.clearTimeout, ci = globalThis.clearInterval;
const add = (h) => { if (!stats.pending.size) stats.heldSince = Date.now(); stats.pending.add(h); };
const del = (h) => { if (stats.pending.delete(h) && !stats.pending.size) { stats.heldMs += Date.now() - stats.heldSince; stats.heldSince = null; } };
globalThis.setTimeout = (fn, ms, ...a) => { const h = st(() => { del(h); fn(...a); }, ms); add(h); return h; };
globalThis.setInterval = (fn, ms, ...a) => { const h = si(fn, ms, ...a); add(h); return h; };
globalThis.clearTimeout = (h) => { del(h); ct(h); };
globalThis.clearInterval = (h) => { del(h); ci(h); };` : ''}
const games = { games: [{ id: 'gem-rush', name: 'Gem Rush', players: { min: 1, max: 8 }, room: { host: 'server', contract: 2, tickHz: 20 } }] };
const assets = { fetch: async (r) => new URL(r.url).pathname === '/games.json' ? Response.json(games) : new Response('', { status: 404 }) };
export class Table extends BaseTable {
  constructor(ctx, env) { stats.constructed++; super(ctx, { ...env, ASSETS: assets, HOMIE_ROOM_LOG: '0' }); }
  async fetch(r) { stats.events++; return super.fetch(r); }
  async webSocketMessage(...a) { stats.events++; return super.webSocketMessage(...a); }
  async webSocketClose(...a) { stats.events++; return super.webSocketClose(...a); }
  async alarm() { stats.events++; return super.alarm(); }
}
export default { fetch(request, env) {
  const u = new URL(request.url);
  if (u.pathname === '/stats') return Response.json({ constructed: stats.constructed, events: stats.events, pending: stats.pending.size, heldMs: stats.heldMs + (stats.heldSince === null ? 0 : Date.now() - stats.heldSince) });
  if (u.pathname !== '/__net') return new Response('rooms', { status: 200 });
  const room = (u.searchParams.get('room') ?? 'one').replace(/[^a-z0-9-]/g, '');
  // What the studio's Worker sends a room for a socket of this game (worker/routes.mjs).
  const target = 'https://table/__net?relay=1&game=gem-rush&room=' + room + '&max=8&rules=1&hz=20&host=server&cur=' + data.build + '&gv=' + data.build + '&b=' + (u.searchParams.get('b') ?? '');
  return env.TABLE.get(env.TABLE.idFromName('gem-rush/' + room)).fetch(new Request(target, request));
} };
`;
  const out = await build({ stdin: { contents: entry, resolveDir: game.dir }, bundle: true, write: false, format: 'esm', platform: 'browser', mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], nodePaths: [join(studio, 'node_modules'), join(toolkit, 'node_modules')], logLevel: 'error' });
  return out.outputFiles[0].text;
}

/** One room's phones in a child process (phones.mjs). `ask(cmd)` answers with its one message. */
export async function phones({ game, socketUrl, count, mode }) {
  const child = fork(fileURLToPath(new URL('./phones.mjs', import.meta.url)), [game.view, socketUrl, String(count), mode], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: ['--max-old-space-size=512'] });
  const next = () => new Promise((resolve, reject) => { child.once('message', resolve); child.once('exit', (code) => reject(new Error(`phones exited ${code}`))); });
  const ready = await next();
  return { ready, ask: async (cmd) => { const answer = next(); child.send({ cmd }); return answer; }, kill: () => child.kill() };
}

export const SCENARIOS = [
  { room: 'idle-1', name: 'one phone, page open, nobody touching it', phones: 1, mode: 'idle' },
  { room: 'idle-4', name: 'four phones, pages open, nobody touching them', phones: 4, mode: 'idle' },
  { room: 'hidden-1', name: 'one phone, page in the background', phones: 1, mode: 'hidden' },
  { room: 'play-1', name: 'one phone playing the whole time', phones: 1, mode: 'play' },
  { room: 'play-2', name: 'one phone playing the whole time (second room)', phones: 1, mode: 'play' },
];
