import { networkInterfaces } from 'node:os';
/**
 * `homie-studio dev` and `dev --stop`: the whole site on this computer (pages, rooms in a local Durable Object, D1),
 * and exactly this studio's dev server stopped, never another project's.
 *
 * THE REGISTRATION FILE. `dev` records itself in <worker folder>/.wrangler/homie-dev.json (the worker folder is where
 * wrangler.jsonc is: the studio's root, or site/ in a studio made before 0.10.0). It is the whole contract between
 * a running dev server and `dev --stop`, the MCP tools `preview_run` / `preview_stop`, and a studio's own wrapper
 * script that wants to be stopped the same way:
 *
 *   { "pid": 4242,          the process that owns the server (homie-studio dev, or a wrapper); stopped second
 *     "child": 4243,        the Wrangler it started; stopped first (optional: a wrapper with one process leaves it out)
 *     "port": 8787,         the local port; what "is it running" and the Play addresses are read from
 *     "at": "2026-10-06T12:00:00.000Z" }   when it started (ISO 8601)
 *
 * One JSON object on one line; unknown keys are ignored. `dev --stop` signals a process the file names ONLY when it
 * is still this studio's: it is alive, and its command line names the studio's folder, or its working directory is
 * inside the studio's folder, or it is still the kind of program the key says (`pid`: homie-studio; `child`: wrangler
 * or workerd). A recycled process id is none of those, so nothing else on the computer is ever signalled. A wrapper
 * that is started from the studio's folder therefore qualifies as it is; it should delete the file when it ends.
 *
 * STALE STATE HEALS ITSELF. A server stopped another way (its terminal closed, a kill by process id or by port)
 * leaves the file behind, and sometimes a runtime still listening on the port. Both `dev` and `dev --stop` look at
 * what is really there: a record whose processes are gone is removed and said to be stale; a listener left on the
 * recorded port is stopped only when it provably runs from this studio's folder; a port held by anything else is
 * named and left alone.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, sep } from 'node:path';
import { detectLocalAi, localAiVars } from './local-ai.mjs';
import { projectsCloudflareEnv } from './projects-env.mjs';
import { routesOf } from './routes.mjs';
import { ensureMigrations, migrationWord } from './scaffold.mjs';
import { isRulesGame, listExperiences as listGames, workerDir } from './studio.mjs';

export const devFile = (root) => join(workerDir(root), '.wrangler', 'homie-dev.json');

/** The registration file's record, or null (no file, or a torn one). */
export function readDevRecord(root) {
  try { const rec = JSON.parse(readFileSync(devFile(root), 'utf8')); return rec && typeof rec === 'object' ? rec : null; } catch { return null; }
}

const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; } };
const realOf = (p) => { try { return realpathSync(p); } catch { return p; } };
const inside = (dir, root) => Boolean(dir) && (dir === root || dir.startsWith(root.endsWith(sep) ? root : `${root}${sep}`));

/** A process's command line (`ps`), or null when it cannot be read. */
function commandOf(pid) {
  const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return ps.status === 0 ? ps.stdout : null;
}

/** A process's working directory (Linux: /proc; macOS: lsof), or null. */
export function cwdOf(pid) {
  try { return readlinkSync(`/proc/${pid}/cwd`); } catch { /* not Linux */ }
  const r = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', timeout: 4000 });
  if (r.status !== 0) return null;
  return /^n(.+)$/m.exec(r.stdout ?? '')?.[1] ?? null;
}

/**
 * Whether a process provably runs from this studio: its command line names the studio's folder, or its working
 * directory is inside it. The strict test: what a process the registration file does NOT name must pass before it
 * is stopped (a runtime left listening on the recorded port).
 */
export function runsFromStudio(pid, root) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid || !isAlive(pid)) return false;
  const real = realOf(root);
  const cmd = commandOf(pid) ?? '';
  if (cmd.includes(root) || cmd.includes(real)) return true;
  const cwd = cwdOf(pid);
  return inside(cwd, root) || inside(cwd ? realOf(cwd) : null, real);
}

/**
 * Whether a process id the registration file names is still this studio's (see the header): alive, and from this
 * studio's folder or still the kind of program its key says. A recycled id is neither.
 */
export function processOfStudio(pid, root, kind) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid || !isAlive(pid)) return false;
  const cmd = commandOf(pid);
  if (cmd === null) return process.platform === 'win32' || runsFromStudio(pid, root); // no ps: the registration file is all there is
  if (kind === 'dev' ? /homie-studio/.test(cmd) : /wrangler|workerd/.test(cmd)) return true;
  return runsFromStudio(pid, root);
}

/** Whether something accepts connections on a local port. */
export function portOpen(port, host = '127.0.0.1', timeout = 800) {
  return new Promise((done) => {
    const s = connect({ port: Number(port), host });
    const end = (v) => { s.destroy(); done(v); };
    s.setTimeout(timeout, () => end(false));
    s.on('connect', () => end(true));
    s.on('error', () => end(false));
  });
}

/** The process ids listening on a local TCP port (lsof, else Linux's ss; an empty list where neither can say). */
export function listenersOn(port) {
  const ids = (list) => [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 1))];
  const r = spawnSync('lsof', ['-nP', `-iTCP:${Number(port)}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', timeout: 4000 });
  if (r.status === 0) return ids(String(r.stdout ?? '').split(/\s+/));
  const ss = spawnSync('ss', ['-Hltnp', `sport = :${Number(port)}`], { encoding: 'utf8', timeout: 4000 });
  if (ss.status === 0) return ids([...String(ss.stdout ?? '').matchAll(/pid=(\d+)/g)].map((m) => m[1]));
  return [];
}

/**
 * What is really there for this studio's dev server:
 *   state 'none'     no registration file
 *   state 'running'  the file names at least one process that is still this studio's
 *   state 'stale'    the file is there and none of its processes is this studio's any more (or it is torn)
 * `pids` are the ones `dev --stop` would signal; `named` every id the file gives, with why one does not count.
 */
export function devState(root) {
  const file = devFile(root);
  if (!existsSync(file)) return { state: 'none', file, rec: null, pids: [], named: [], port: null };
  const rec = readDevRecord(root);
  const named = [[rec?.child, 'wrangler'], [rec?.pid, 'dev']].filter(([p]) => Number.isInteger(p)).map(([pid, kind]) => {
    const ours = processOfStudio(pid, root, kind);
    return { pid, kind, ours, alive: ours || isAlive(pid) };
  });
  const pids = named.filter((n) => n.ours).map((n) => n.pid);
  const port = Number.isInteger(rec?.port) ? rec.port : null;
  return { state: pids.length ? 'running' : 'stale', file, rec, pids, named, port };
}

/** This studio's running dev server as { url, port, pid }, or null: what `preview_run` reuses (a stale record is not one). */
export function runningDev(root) {
  const st = devState(root);
  if (st.state !== 'running' || !st.port) return null;
  return { url: `http://127.0.0.1:${st.port}`, port: st.port, pid: st.rec.pid ?? st.pids[0] };
}

async function endAll(pids, ms = 8000) {
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  const deadline = Date.now() + ms;
  const left = () => pids.filter(isAlive);
  while (left().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  for (const pid of left()) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}

/**
 * A runtime left listening on the dev port by a server that was stopped another way: stopped only when it runs
 * from this studio's folder. Returns { stopped: [pid], foreign: [pid] }; `foreign` holds the port and is not ours.
 */
export async function clearLeftover(root, port) {
  if (!port || !(await portOpen(port))) return { stopped: [], foreign: [], open: false };
  const pids = listenersOn(port);
  const ours = pids.filter((p) => runsFromStudio(p, root));
  if (ours.length) await endAll(ours);
  return { stopped: ours, foreign: pids.filter((p) => !ours.includes(p)), open: ours.length ? await portOpen(port) : true };
}

/** `dev --stop`: this studio's dev server only; a stale record is cleaned up and said to be one. */
export async function stopDev(root) {
  const st = devState(root);
  if (st.state === 'none') return { ok: true, command: 'dev stop', stopped: [], why: 'no dev server of this studio is running' };
  if (st.pids.length) await endAll(st.pids);
  rmSync(st.file, { force: true });
  // What a kill by process id or by port leaves: the runtime still on the port. Ours is stopped; anything else is named.
  const left = await clearLeftover(root, st.port);
  const stopped = [...st.pids, ...left.stopped];
  const notes = [];
  if (!st.pids.length) notes.push(st.rec ? 'its record was stale (the server had been stopped another way) and was removed' : 'its record was unreadable and was removed');
  const strangers = st.named.filter((n) => !n.ours && n.alive);
  if (strangers.length) notes.push(`process ${strangers.map((n) => n.pid).join(', ')} named in the record is running but is not this studio's (its command line and working directory are elsewhere), so it was left alone`);
  if (left.open && !left.stopped.length && st.port) notes.push(`something still answers on port ${st.port}${left.foreign.length ? ` (process ${left.foreign.join(', ')})` : ''} that is not this studio's, so it was left alone`);
  return { ok: true, command: 'dev stop', stopped, ...(st.pids.length ? {} : { stale: true }), ...(notes.length ? { why: notes.join('; '), notes } : {}) };
}

/*
 * THE CONFIG WRANGLER RUNS LOCALLY. Two things in a studio's wrangler.jsonc must not reach `wrangler dev`:
 *
 *   - ROUTES. With a route or a custom domain in its config, Wrangler serves the local Worker AS that production
 *     hostname: the request's host is the live domain, and the game page hands the game a room socket there
 *     (`wss://<the live domain>/...`). An unpublished game then finds no room and plays alone; a published one
 *     silently joins its LIVE relay, so a "local" two-browser test was never local. Local dev has no use for a
 *     route, so `routes`, `route` and the zone keys are left out of what it runs.
 *   - THE AI BINDING, unless --remote-ai asked for it: AI guides think scripted (or with Clef here) for free.
 *
 * When either differs from the file, dev runs from a copy in .wrangler/ (absolute paths, the same local state),
 * and wrangler.jsonc itself is never changed by dev. A fresh studio's config needs neither, and runs as it is.
 */
const ROUTE_KEYS = ['routes', 'route', 'zone_id', 'zone_name'];

export function devConfig(root, remoteAi) {
  const base = workerDir(root);
  const file = join(base, 'wrangler.jsonc');
  let json;
  try { json = JSON.parse(readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '')); } catch { return { args: [], stripped: [] }; }
  const stripped = routesOf(json).map((r) => r.pattern);
  const routed = ROUTE_KEYS.some((k) => k in json);
  const aiNote = remoteAi ? 'AI guides think with Workers AI (remote, billed to the signed-in account).' : null;
  if (Boolean(json.ai) === remoteAi && !routed) return { args: [], note: aiNote, stripped: [] };
  const abs = (p) => (p && !p.startsWith('/') ? join(base, p) : p);
  delete json.$schema;
  json.main = abs(json.main);
  if (json.assets?.directory) json.assets.directory = abs(json.assets.directory);
  json.d1_databases = (json.d1_databases ?? []).map((d) => ({ ...d, ...(d.migrations_dir ? { migrations_dir: abs(d.migrations_dir) } : {}) }));
  for (const k of ROUTE_KEYS) delete json[k];
  const aiChanged = Boolean(json.ai) !== remoteAi;
  if (remoteAi) json.ai = { binding: 'AI', remote: true }; else delete json.ai;
  const copy = join(base, '.wrangler', 'homie-dev.wrangler.json');
  mkdirSync(dirname(copy), { recursive: true });
  writeFileSync(copy, `${JSON.stringify(json, null, 2)}\n`);
  const notes = [
    ...(routed ? [`Local dev leaves out the production route${stripped.length === 1 ? '' : 's'} in wrangler.jsonc (${stripped.join(', ') || 'route keys'}): rooms here use this computer's own address, never the live site's. wrangler.jsonc is unchanged.`] : []),
    ...(aiChanged ? [remoteAi ? aiNote : 'No Workers AI under dev (--remote-ai for the real one, billed): AI guides think with Clef on this computer when Ollama has it, else scripted.'] : aiNote ? [aiNote] : []),
  ];
  return { args: ['--config', copy, '--persist-to', join(base, '.wrangler', 'state')], note: notes.join('\n') || null, stripped, copy };
}

/** The room socket address a game page hands its game (`window.HOMIE_NET.url`), or null when the page has none. */
export function socketUrlIn(html) {
  const m = /window\.HOMIE_NET=(\{.*?\})<\/script>/s.exec(String(html ?? ''));
  if (!m) return null;
  try { return String(JSON.parse(m[1]).url ?? '') || null; } catch { return null; }
}

/**
 * LOCAL ROOMS MUST BE LOCAL. Read one game's page from the local site as a browser would and compare the room socket
 * it is handed with the address it was read from, host AND port. Null when they match (or there is nothing to
 * compare: no game, a game behind a door, the site not answering); else what is wrong, as one refusal.
 */
export async function socketOriginProblem(origin, game, { fetchFn = globalThis.fetch } = {}) {
  let html;
  try {
    const res = await fetchFn(`${origin}/${game}/__game/?room=homie-dev-check`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    html = await res.text();
  } catch { return null; }
  const ws = socketUrlIn(html);
  if (!ws) return null;
  let got; let want;
  try { got = new URL(ws); want = new URL(origin); } catch { return null; }
  if (got.host === want.host && got.protocol === (want.protocol === 'https:' ? 'wss:' : 'ws:')) return null;
  return {
    socket: `${got.protocol}//${got.host}`, expected: `${want.protocol === 'https:' ? 'wss' : 'ws'}://${want.host}`,
    why: `local rooms are not local: the page ${origin}/${game}/play hands the game a room socket at ${got.protocol}//${got.host}, not at this computer's ${want.host}. A game here would join that other relay, or find none and play alone, so a test here would prove nothing. The dev server was stopped. The usual reason is a hostname set for local dev in wrangler.jsonc (a "dev" section with "host", or a route this version does not know to leave out): take it out (a host without its port is never right for local dev), then start dev again.`,
  };
}

/*
 * RELAY LINES WITH A TIME ON THEM. Wrangler prints a room socket opening (`GET /<game>/__net 101`) and a runtime
 * error (`Uncaught Error: Network connection lost`) with no time and no room, so a clean check that closed its
 * browsers left errors nobody could match to anything. dev puts the wall-clock time in front of the lines about
 * room sockets and errors (every line with --timestamps), so they can be laid beside a check's own receipts, and
 * says once what a connection-loss line can and cannot mean. It changes nothing in the Worker.
 */
const RELAY_LINE = /__net\b|__watch\b|Network connection lost|Uncaught|\[ERROR\]|✘/;
const LOST = /Network connection lost/;
export const LOST_HINT = '  (homie dev: the local runtime prints "Network connection lost" when a connection to a room ends abruptly: a tab or a check\'s browser closing, a host leaving. It prints the same for a room operation that really failed. The times here are this computer\'s clock: lay them beside the "__net" lines above and the browser\'s own report before calling it either.)';
const ANSI = /\u001b\[[0-9;]*m/g;

export function stampOf(at = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}.${p(at.getMilliseconds(), 3)}`;
}

/** One line of Wrangler's output as dev prints it: [the line(s)], with `state.hinted` remembering the one-time hint. */
export function relayLines(line, { all = false, at = new Date(), state = {} } = {}) {
  const plain = line.replace(ANSI, '');
  if (!plain.trim()) return [line];
  const about = RELAY_LINE.test(plain);
  const out = [all || about ? `[${stampOf(at)}] ${line}` : line];
  if (LOST.test(plain) && !state.hinted) { state.hinted = true; out.push(LOST_HINT); }
  return out;
}

/** Pass a child's stream on line by line through relayLines; a last line without a newline is flushed at the end. */
function passLines(stream, to, opts) {
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    const parts = `${rest}${d}`.split('\n');
    rest = parts.pop();
    for (const line of parts) to.write(`${relayLines(line, opts).join('\n')}\n`);
  });
  stream.on('end', () => { if (rest) to.write(relayLines(rest, opts).join('\n')); });
}

/**
 * RULES ON THE SERVER, WHILE DEV RUNS (NETPLAY.md section 29). A game whose rules run in the Table is in the Worker's
 * own bundle (site/src/rules/), so a change to its rules, its movement, its tunables, its map or its settings is live
 * only after a build: the build checks and guards the rules again and writes the module, and Wrangler, which watches
 * the Worker's files, restarts the local Worker with it. dev does that build by itself when one of those files is
 * saved. `rulesStamp` is what it compares: the newest change among them, and how many there are.
 */
export function rulesStamp(g) {
  const files = [join(g.dir, g.kind === 'app' ? 'app.json' : 'game.json'), join(g.dir, 'tunables.json')];
  for (const sub of ['src', 'map']) {
    const dir = join(g.dir, sub);
    if (existsSync(dir)) for (const name of readdirSync(dir, { recursive: true })) files.push(join(dir, String(name)));
  }
  let newest = 0;
  let n = 0;
  for (const f of files) { try { const st = statSync(f); if (st.isFile()) { n += 1; newest = Math.max(newest, st.mtimeMs); } } catch { /* gone */ } }
  return `${n}:${Math.round(newest)}`;
}

const builtIds = (root) => { try { return JSON.parse(readFileSync(join(root, 'site', 'dist', 'games.json'), 'utf8')).games.map((g) => g.id); } catch { return null; } };

/**
 * `homie-studio dev`: build once, then Wrangler's local runtime until it is stopped. Returns the command's result.
 * options: port, remoteAi, localAi (false: --no-local-ai), timestamps (every line of Wrangler's gets a time), log.
 */
export async function dev(root, { lan = false, port: askedPort = 8787, remoteAi = false, localAi = true, timestamps = false, log = () => {}, watchMs = 2000 } = {}) {
  const port = String(askedPort ?? 8787);
  const stop = 'npx --no-install homie-studio dev --stop';

  // What is really there, before anything is built or started (the header: stale state heals itself).
  const st = devState(root);
  if (st.state === 'running') {
    const at = st.port ? `http://127.0.0.1:${st.port}/` : 'an unknown port';
    return { ok: false, command: 'dev', already: true, ...(st.port ? { url: `http://127.0.0.1:${st.port}` } : {}), why: `this studio's dev server is already running at ${at} (process ${st.pids.join(', ')}). Use that one, or stop it first: ${stop}` };
  }
  if (st.state === 'stale') {
    rmSync(st.file, { force: true });
    log(`Cleared a stale dev record (${st.rec ? 'its server had been stopped another way' : 'it was unreadable'}).`);
  }
  for (const p of new Set([st.port, Number(port)].filter(Boolean))) {
    const left = await clearLeftover(root, p);
    if (left.stopped.length) log(`Stopped a leftover local runtime of this studio on port ${p} (process ${left.stopped.join(', ')}): its dev server had been stopped another way.`);
    if (p === Number(port) && left.open) {
      return { ok: false, command: 'dev', needs: 'port', why: `port ${port} is already in use by another program${left.foreign.length ? ` (process ${left.foreign.join(', ')})` : ''}, and it is not this studio's dev server, so nothing was stopped or started. Use another port: npx --no-install homie-studio dev --port ${Number(port) + 1}` };
    }
  }

  // The build and Wrangler's own helpers are loaded here, not at the top: the MCP server reads this file for the
  // registration (runningDev) and must not load the bundler to do it.
  const [{ build }, { wranglerBin }] = await Promise.all([import('./build.mjs'), import('./cloudflare.mjs')]);
  const b = await build(root, { log });
  if (!b.catalogue.length && !b.songs.length && !b.videos.length) log('No game yet: the home page says "First game coming soon" until the first one is made.');
  const bin = wranglerBin(root);
  if (!bin) return { ok: false, command: 'dev', why: 'run npm install in the studio first' };
  const env = { ...process.env, ...projectsCloudflareEnv(root), WRANGLER_SEND_METRICS: 'false', CI: '1', ...(process.stdout.isTTY && !process.env.NO_COLOR ? { FORCE_COLOR: process.env.FORCE_COLOR ?? '1' } : {}) };
  for (const added of ensureMigrations(root)) log(`added ${added} (${migrationWord(added)})`);
  await new Promise((done) => {
    const m = spawn(bin, ['d1', 'migrations', 'apply', 'DB', '--local'], { cwd: workerDir(root), env, stdio: ['ignore', 'ignore', 'inherit'] });
    m.on('close', done);
    m.on('error', done);
  });
  const origin = `http://127.0.0.1:${port}`;
  log(`Local site: ${origin}/  (each game: ${origin}/<id>/play — open it in two browsers)`);
  if (lan) for (const address of lanAddresses()) log(`Same Wi-Fi: http://${address}:${port}/ (open this address on phones and wall screens)`);
  const ai = devConfig(root, remoteAi);
  if (ai.note) log(ai.note);
  // The person's own Clef (0.24.4, lib/local-ai.mjs): with Ollama and clef-flash on this computer, the local Worker's
  // guides, chat review and game decisions think here, free. Never a download: dev only says what one would cost.
  let localVars = [];
  if (!remoteAi && localAi) {
    const found = await detectLocalAi();
    localVars = localAiVars(found);
    log(found.ok ? `AI guides, chat review and game decisions think with ${found.model} on this computer (Ollama ${found.version}): free, nothing sent to Cloudflare.` : found.say);
  }
  // --remote-ai: Wrangler's --local turns every remote binding off ("not supported"), so a dev with the real Workers AI
  // (the guides' brains, room chat's review) runs without it; everything else stays local all the same.
  const args = ['dev', ...(remoteAi ? [] : ['--local']), '--ip', lan ? '0.0.0.0' : '127.0.0.1', '--port', port, '--var', 'HOMIE_EMBED_PREVIEW:1', ...ai.args, ...localVars];
  log(`Stop it with: ${stop}   (this studio's dev server only)`);

  let child = null;
  let ending = false;
  let restart = null;
  let failed = null;
  const lineState = {};
  // Stopping this process stops Wrangler with it, so no dev server is left running on its own.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { ending = true; try { child?.kill(signal); } catch { /* gone */ } });

  /*
   * A GAME ADDED WHILE DEV RUNS. dev serves what `build` wrote into site/dist. Two things made a new game answer
   * 404 on a server that was already up: it was not built yet (dev builds once, at its start), or it was built and
   * Wrangler's watch of the site's files had not followed the rebuild (a build replaces site/dist). So dev looks every
   * couple of seconds: a game folder that is not built is named, once, with the command; a built game the running
   * site answers 404 for is picked up by restarting Wrangler (this process stays, the address stays; rooms that
   * were open reconnect), once per game.
   */
  const startedWith = new Set(builtIds(root) ?? []);
  const told = new Set();
  const strikes = new Map();
  const restarted = new Set();
  let up = false;
  let busy = false;
  const look = async () => {
    if (busy || ending || restart || !up) return;
    busy = true;
    try {
      const built = builtIds(root);
      if (!built) return; // mid-build: site/dist is being written
      for (const g of listGames(root)) {
        if (built.includes(g.id) || told.has(g.id)) continue;
        told.add(g.id);
        log(`${g.kind === 'app' ? 'apps' : 'games'}/${g.id} is new and not built yet, so ${origin}/${g.id}/play is a 404 for now. Build it (npx --no-install homie-studio build): this dev server serves what build wrote and picks the new game up by itself.`);
      }
      for (const id of built) {
        if (startedWith.has(id)) continue;
        let status = 0;
        try { status = (await fetch(`${origin}/${id}/play`, { redirect: 'manual', signal: AbortSignal.timeout(4000) })).status; } catch { continue; }
        if (status !== 404) { log(`New game ${id} is served here: ${origin}/${id}/play`); startedWith.add(id); strikes.delete(id); continue; }
        const n = (strikes.get(id) ?? 0) + 1;
        strikes.set(id, n);
        if (n < 3) continue;
        if (restarted.has(id)) { startedWith.add(id); log(`${origin}/${id}/play is still a 404 after a restart: check games/${id}/game.json (its "id") and what the build printed for it.`); continue; }
        restarted.add(id);
        strikes.delete(id);
        log(`New game ${id} is built but the running site answers 404 for it: restarting the local site to pick it up (same address; open rooms reconnect).`);
        restart = id;
        try { child?.kill('SIGTERM'); } catch { /* gone */ }
        return;
      }
    } finally { busy = false; }
  };
  // A rules game saved while dev runs is built again (see rulesStamp), one game at a time.
  const stamps = new Map(listGames(root).filter(isRulesGame).map((g) => [g.id, rulesStamp(g)]));
  const timingRetries = new Map();
  let rebuilding = false;
  let published = Promise.resolve();
  const rulesLook = async () => {
    if (rebuilding || ending) return;
    for (const g of listGames(root).filter(isRulesGame)) {
      const now = rulesStamp(g);
      const retry = timingRetries.get(g.id);
      if (stamps.get(g.id) === now && !(retry?.stamp === now && Date.now() >= retry.at)) continue;
      if (retry?.stamp !== now) timingRetries.delete(g.id);
      stamps.set(g.id, now);
      rebuilding = true;
      try {
        log(`${g.kind === 'app' ? 'apps' : 'games'}/${g.id} changed: checking its rules and building it again…`);
        const hash = () => { try { return JSON.parse(readFileSync(join(root, 'site/dist/games.json'), 'utf8')).games.find((x) => x.id === g.id)?.room?.stateHash; } catch { return null; } };
        const before = hash();
        let release;
        published = new Promise(resolve => { release = resolve; });
        try {
          await build(root, { only: g.id, log, beforePublish: async () => {
            // Wrangler independently watches assets and code. Publishing both while it runs
            // reloads the old bundle first, then the new one. Stop once at the publish boundary;
            // the loop below starts once with the complete build and the same local storage.
            if (!child || child.exitCode !== null) return;
            restart = g.id;
            const stopped = new Promise(resolve => child.once('close', resolve));
            child.kill('SIGTERM');
            await stopped;
          } });
        } finally { release(); }
        timingRetries.delete(g.id);
        log(`${g.kind === 'app' ? 'apps' : 'games'}/${g.id} is rebuilt. ${before && before === hash() ? 'Local rooms resume their saved match; pages reconnect.' : 'The stored shape changed: local rooms reset to a fresh match; pages reconnect.'}`);
      } catch (error) {
        log(`${g.kind === 'app' ? 'apps' : 'games'}/${g.id} did not build, so the local site still runs what it had:\n${String(error?.message ?? error)}`);
        // A busy machine can fail the wall-clock tick guard once. Keep the guard, resample at most three times,
        // and never retry syntax, contract or deterministic budget failures until the author edits them.
        const attempts = timingRetries.get(g.id)?.attempts ?? 0;
        if (/rules ran for .*seconds with bots and were too slow/.test(String(error?.message ?? error)) && attempts < 3) {
          timingRetries.set(g.id, { stamp: now, attempts: attempts + 1, at: Date.now() + 10000 });
          log(`${g.id}: retrying the timing check in 10 seconds (${attempts + 1}/3); the last good build stays live.`);
        } else timingRetries.delete(g.id);
      } finally { rebuilding = false; }
      return;
    }
  };
  const { functionFiles } = await import('./functions-build.mjs');
  const { toolFiles } = await import('./tools-build.mjs');
  const toolsStamp = () => [...toolFiles(root),...functionFiles(root)].map(file => `${file}:${statSync(file).mtimeMs}:${statSync(file).size}`).join('|');
  let lastTools = toolsStamp();
  const toolsLook = async () => {
    if (rebuilding || ending) return;
    const stamp = toolsStamp(); if (stamp === lastTools) return;
    lastTools = stamp; rebuilding = true;
    try { log('Studio tools changed: type-checking and rebuilding…'); await build(root, { log }); }
    catch (error) { log(`Studio tools did not build: ${error.message}`); }
    finally { rebuilding = false; }
  };
  const timer = setInterval(() => { look().catch(() => {}); rulesLook().catch(() => {}); toolsLook().catch(() => {}); }, watchMs);
  timer.unref?.();

  /** Wait for the local site, then hold it to its own address (socketOriginProblem); a mismatch ends dev. */
  const settle = async () => {
    const until = Date.now() + 90_000;
    while (Date.now() < until && !ending && child?.exitCode === null) {
      try { if ((await fetch(`${origin}/api/games`, { signal: AbortSignal.timeout(1500) })).ok) { up = true; break; } } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!up) return;
    const game = (builtIds(root) ?? [])[0];
    if (!game) return;
    const bad = await socketOriginProblem(origin, game);
    if (!bad) { log(`Rooms here are local: games open their room sockets at ws://127.0.0.1:${port}.`); return; }
    failed = bad;
    ending = true;
    try { child?.kill('SIGTERM'); } catch { /* gone */ }
  };

  for (;;) {
    up = false;
    child = spawn(bin, args, { cwd: workerDir(root), env, stdio: ['inherit', 'pipe', 'pipe'] });
    passLines(child.stdout, process.stdout, { all: timestamps, state: lineState });
    passLines(child.stderr, process.stderr, { all: timestamps, state: lineState });
    mkdirSync(dirname(devFile(root)), { recursive: true });
    writeFileSync(devFile(root), `${JSON.stringify({ pid: process.pid, child: child.pid, port: Number(port), at: new Date().toISOString() })}\n`);
    settle().catch(() => {});
    await new Promise((done) => { child.on('close', done); child.on('error', done); });
    await published;
    if (!restart || ending) break;
    restart = null;
  }
  clearInterval(timer);
  rmSync(devFile(root), { force: true });
  if (failed) return { ok: false, command: 'dev', needs: 'local-rooms', socket: failed.socket, expected: failed.expected, why: failed.why };
  return { ok: true, command: 'dev', stopped: true };
}

export function lanAddresses(interfaces = networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flat().filter((n) => n && !n.internal && n.family === 'IPv4' && !n.address.startsWith('169.254.')).map((n) => n.address))].sort();
}
