/**
 * THE GAME LAB (`homie-studio lab <game>`): a page on this computer that plays one short take of a game in two builds
 * side by side, New (the working tree) and Today (the last commit, or any ref), on one clock, with the same seed and
 * the same presses, so a change to how a jump, a hit or a drift FEELS can be seen, scrubbed, slowed down, measured
 * and tuned before it is kept.
 *
 *   homie-studio lab <game> [--port 8790] [--today HEAD|<ref>]   the lab's server, in the foreground (--stop stops it)
 *   homie-studio lab check <game> [--take <name>] [...]           the same take played headless: numbers and pictures
 *   homie-studio lab set <game> <name>=<value> ...                 write tunables into games/<game>/tunables.json
 *
 * What it serves (127.0.0.1 only):
 *   /<game>/                   the lab page (lab/page/)
 *   /<game>/new/...            New: the game built from the working tree, rebuilt when a file in games/<game>/ changes
 *   /<game>/today/...          Today: the game built from a checkout of the ref (HEAD by default), cached per commit
 *   /_lab/...                  the page's own files, the harness (lab/harness.js) and the take format (lab/take.js)
 *   /_lab/api/<game>/state     both builds, the takes (games/<game>/lab.json), the tunables (tunables.json) of each
 *   /_lab/api/<game>/events    server-sent events: a build finished (New rebuilt after an edit)
 *   POST /_lab/api/<game>/tunables   { values }: written into tunables.json (one tunable a line)
 *   POST /_lab/api/<game>/take       { name, take }: a recorded take, written into lab.json
 * Each game's page gets the harness as its first script. Writes come only from the lab page itself (same origin).
 *
 * Builds live in .studio/lab/<game>/ (git-ignored): new/, today-<commit>/ (the last three), and checkout/, where git
 * checks out the ref's games/<game>/ and whatever else New's bundle reads from the studio (a shared folder), and
 * nothing else. The checkout is git's own `git worktree add --no-checkout`, removed by `lab --stop`.
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { buildGameFiles, studioEsbuild } from './build.mjs';
import { GAME_ID, PACKAGE_ROOT, listGames, readStudio } from './studio.mjs';
import { STUDIO_VERSION } from './version.mjs';
import { formatLabFile, formatTunables, readLabFile, checkTake, setTunables, tunableValue, TAKE_NAME } from '../lab/take.js';

export const LAB_PORT = 8790;
const LAB_FILES = join(PACKAGE_ROOT, 'lab');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

export const labDir = (root, id) => join(root, '.studio', 'lab', id);
const serverFile = (root) => join(root, '.studio', 'lab', 'server.json');
const git = (cwd, args, opts = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024, ...opts });
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/* ------------------------------------------------------------------ the game's own lab files */

/** games/<id>/lab.json, checked (lab/take.js): { takes, default, problems, exists }. */
export function readTakes(dir) {
  const file = join(dir, 'lab.json');
  if (!existsSync(file)) return { takes: {}, default: null, problems: [], exists: false };
  let json;
  try { json = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { return { takes: {}, default: null, problems: [`lab.json is not JSON: ${error.message}`], exists: true }; }
  return { ...readLabFile(json), exists: true };
}

/** games/<id>/tunables.json, or null. */
export function readTunables(dir) {
  const file = join(dir, 'tunables.json');
  if (!existsSync(file)) return null;
  const json = readJson(file);
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error(`${relative(process.cwd(), file) || file} is not a JSON object of tunables`);
  return json;
}

/** `homie-studio lab set <game> name=value ...`: values written into tunables.json, one tunable a line. */
export function labSet(root, id, pairs) {
  const g = gameOf(root, id);
  const spec = readTunables(g.dir);
  if (!spec) return { ok: false, command: 'lab set', why: `games/${g.id} has no tunables.json yet: the lab skill says how a game gets one (lab.tunables)` };
  const values = {};
  for (const p of pairs) {
    const m = /^([A-Za-z_$][\w$]{0,47})=(.+)$/.exec(String(p));
    if (!m) return { ok: false, command: 'lab set', why: `"${p}" is not name=value` };
    values[m[1]] = m[2];
  }
  if (!Object.keys(values).length) return { ok: false, command: 'lab set', why: 'usage: homie-studio lab set <game> <name>=<value> ...' };
  const r = setTunables(spec, values);
  if (r.refused.length) return { ok: false, command: 'lab set', why: r.refused.join('; ') };
  writeFileSync(join(g.dir, 'tunables.json'), formatTunables(r.spec));
  return { ok: true, command: 'lab set', game: g.id, file: `games/${g.id}/tunables.json`, changed: r.changed };
}

function gameOf(root, id) {
  const games = listGames(root);
  const pick = id ?? (games.length === 1 ? games[0].id : null);
  if (!pick) throw new Error(games.length ? `name the game: ${games.map((g) => g.id).join(', ')}` : 'there is no game in games/ yet');
  if (!GAME_ID.test(String(pick))) throw new Error(`"${pick}" is not a game id`);
  const g = games.find((x) => x.id === pick);
  if (!g) throw new Error(`no game "${pick}" in games/ (${games.map((x) => x.id).join(', ') || 'none yet'})`);
  return g;
}

/* ------------------------------------------------------------------ Today: a checkout of the ref */

/** The commit a ref names in the studio's repository, and its one-line subject; null when there is none. */
export function commitOf(root, ref = 'HEAD') {
  if (!/^[\w./@{}^~-]{1,100}$/.test(String(ref)) || String(ref).startsWith('-')) return null;
  const r = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (r.status !== 0) return null;
  const sha = r.stdout.trim();
  const subject = git(root, ['log', '-1', '--format=%s', sha]).stdout?.trim() ?? '';
  return { sha, short: sha.slice(0, 7), ref: String(ref), subject: subject.slice(0, 100) };
}

/** Whether games/<id>/ differs from HEAD (staged, changed or new files). */
export function dirtyOf(root, id) {
  const r = git(root, ['status', '--porcelain', '--', `games/${id}`]);
  return r.status === 0 ? r.stdout.trim().split('\n').filter(Boolean).length : null;
}

/** The paths of `sha` that New's bundle read from outside games/<id>/ (a shared folder), plus the game's own. */
function pathsFor(root, id, sha, metafile) {
  const want = new Set([`games/${id}`]);
  for (const input of Object.keys(metafile?.inputs ?? {})) {
    const rel = input.split(sep).join('/');
    if (rel.startsWith('node_modules/') || rel.startsWith('../') || rel.startsWith('/') || rel.startsWith(`games/${id}/`) || rel.includes('/node_modules/')) continue;
    want.add(rel);
  }
  for (const f of ['package.json', 'studio.json']) want.add(f);
  const r = git(root, ['ls-tree', '-r', '--name-only', sha, '--', ...want]);
  const present = new Set((r.stdout ?? '').split('\n').filter(Boolean));
  return [...want].filter((p) => present.has(p) || [...present].some((x) => x.startsWith(`${p}/`)));
}

/** git's own checkout of `sha` with only `paths` in it, at .studio/lab/<id>/checkout. */
function checkout(root, id, sha, paths) {
  const dir = join(labDir(root, id), 'checkout');
  const stamp = join(labDir(root, id), 'checkout.json');
  const had = readJson(stamp);
  if (had?.sha === sha && JSON.stringify(had.paths) === JSON.stringify(paths) && existsSync(join(dir, 'games', id))) return dir;
  removeCheckout(root, dir);
  mkdirSync(labDir(root, id), { recursive: true });
  const add = git(root, ['worktree', 'add', '--no-checkout', '--detach', dir, sha]);
  if (add.status !== 0) throw new Error(`git could not check out ${sha.slice(0, 7)}: ${(add.stderr || add.stdout).trim().split('\n').pop()}`);
  const co = git(dir, ['checkout', sha, '--', ...paths]);
  if (co.status !== 0) throw new Error(`git could not check out games/${id} at ${sha.slice(0, 7)}: ${(co.stderr || co.stdout).trim().split('\n').pop()}`);
  // A game with its own build (game.json build.mode "command") builds with its own node_modules: the working tree's.
  const nm = join(root, 'games', id, 'node_modules');
  if (existsSync(nm) && existsSync(join(dir, 'games', id)) && !existsSync(join(dir, 'games', id, 'node_modules'))) { try { symlinkSync(nm, join(dir, 'games', id, 'node_modules'), 'dir'); } catch { /* builds without */ } }
  writeFileSync(stamp, `${JSON.stringify({ sha, paths, at: new Date().toISOString() })}\n`);
  return dir;
}

function removeCheckout(root, dir) {
  if (existsSync(dir)) {
    const r = git(root, ['worktree', 'remove', '--force', dir]);
    if (r.status !== 0) rmSync(dir, { recursive: true, force: true });
  }
  git(root, ['worktree', 'prune']);
}

/* ------------------------------------------------------------------ the two builds */

class Builds {
  constructor(root, id, { today = 'HEAD', log = () => {} } = {}) {
    this.root = root;
    this.id = id;
    this.todayRef = today;
    this.log = log;
    this.new = { ok: false, building: false, error: null };
    this.today = { ok: false, building: false, error: null };
    this.listeners = new Set();
    this.watcher = null;
    this.timer = null;
    this.esbuild = null;
  }

  emit(event) { for (const l of this.listeners) { try { l(event); } catch { /* a closed stream */ } } }

  async buildNew() {
    const g = gameOf(this.root, this.id);
    this.esbuild ??= await studioEsbuild(this.root);
    const out = join(labDir(this.root, this.id), 'new');
    const t0 = Date.now();
    this.new = { ...this.new, building: true };
    try {
      const r = await buildGameFiles(this.esbuild, this.root, g, out, { sourcemap: 'linked', log: this.log });
      this.new = { ok: true, building: false, error: null, dir: out, at: new Date().toISOString(), ms: Date.now() - t0, bytes: sizeOf(join(out, 'assets', 'main.js')), metafile: r.metafile, mode: r.mode, dirty: dirtyOf(this.root, this.id) };
    } catch (error) {
      this.new = { ok: false, building: false, error: error.message, dir: out, at: new Date().toISOString() };
    }
    this.emit({ k: 'build', pane: 'new', ok: this.new.ok, error: this.new.error, at: this.new.at });
    return this.new;
  }

  async buildToday(ref = this.todayRef) {
    this.todayRef = ref;
    const c = commitOf(this.root, ref);
    if (!c) { this.today = { ok: false, building: false, error: null, none: existsSync(join(this.root, '.git')) ? `no commit "${ref}" in this studio's repository` : 'this studio is not a git repository, so there is no Today to compare with' }; return this.today; }
    const out = join(labDir(this.root, this.id), `today-${c.sha.slice(0, 12)}`);
    const has = git(this.root, ['cat-file', '-e', `${c.sha}:games/${this.id}/game.json`]);
    if (has.status !== 0) { this.today = { ok: false, building: false, error: null, commit: c, none: `games/${this.id} is not in ${c.short} yet: commit it, and Today is that commit` }; return this.today; }
    const stamp = readJson(join(out, '.lab-build.json'));
    if (stamp?.sha === c.sha && stamp.version === STUDIO_VERSION && existsSync(join(out, 'index.html'))) {
      this.today = { ok: true, building: false, error: null, dir: out, commit: c, at: stamp.at, bytes: sizeOf(join(out, 'assets', 'main.js')), tunables: stamp.tunables ?? null };
      return this.today;
    }
    this.today = { ...this.today, building: true, commit: c };
    const t0 = Date.now();
    try {
      if (!this.new.metafile) await this.buildNew();
      const paths = pathsFor(this.root, this.id, c.sha, this.new.metafile);
      const dir = checkout(this.root, this.id, c.sha, paths);
      const g = listGames(dir).find((x) => x.id === this.id);
      if (!g) throw new Error(`games/${this.id}/game.json is not in ${c.short}`);
      this.esbuild ??= await studioEsbuild(this.root);
      await buildGameFiles(this.esbuild, dir, g, out, { sourcemap: 'linked', log: this.log });
      let tunables = null;
      try { tunables = readTunables(g.dir); } catch { tunables = null; }
      const at = new Date().toISOString();
      writeFileSync(join(out, '.lab-build.json'), `${JSON.stringify({ sha: c.sha, version: STUDIO_VERSION, at, tunables })}\n`);
      this.today = { ok: true, building: false, error: null, dir: out, commit: c, at, ms: Date.now() - t0, bytes: sizeOf(join(out, 'assets', 'main.js')), tunables };
      prune(labDir(this.root, this.id), out);
    } catch (error) {
      this.today = { ok: false, building: false, error: error.message, commit: c, at: new Date().toISOString() };
    }
    this.emit({ k: 'build', pane: 'today', ok: this.today.ok, error: this.today.error, at: this.today.at });
    return this.today;
  }

  /** Rebuild New a moment after the last change in games/<id>/ (an editor saves in bursts). */
  watch() {
    if (this.watcher) return;
    // A commit changes Today: look every 2 s (one cheap `git rev-parse`).
    this.refTimer = setInterval(() => { void this.followRef(); }, 2000);
    this.refTimer.unref?.();
    const dir = join(this.root, 'games', this.id);
    try {
      this.watcher = watch(dir, { recursive: true }, (_e, file) => {
        const f = String(file ?? '');
        if (/(^|[\\/])(\.port|node_modules|dist|\.git)([\\/]|$)/.test(f) || f.endsWith('lab.json') || f.endsWith('CODEX.md') || /\.(md|log)$/.test(f)) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.buildNew().then((n) => this.log(n.ok ? `New rebuilt (${f})` : `New did not build: ${n.error}`)); }, 220);
      });
    } catch (error) { this.log(`not watching games/${this.id} for changes (${error.message}); the lab's Rebuild button rebuilds New`); }
  }

  /** Today follows its ref: a new commit (HEAD moved, a branch was switched) rebuilds it, and the page is told. */
  async followRef() {
    if (this.today.building) return;
    const c = commitOf(this.root, this.todayRef);
    const had = this.today.commit?.sha ?? null;
    if ((c?.sha ?? null) === had && !this.today.error) return;
    if (!c && !had) return;
    await this.buildToday();
    this.new.dirty = dirtyOf(this.root, this.id);
    this.log(this.today.ok ? `Today is now ${this.today.commit.short} "${this.today.commit.subject}"` : `Today: ${this.today.error ?? this.today.none}`);
  }

  close() { clearTimeout(this.timer); clearInterval(this.refTimer); this.watcher?.close(); this.watcher = null; }
}

function prune(dir, keep) {
  const builds = readdirSync(dir).filter((n) => n.startsWith('today-')).map((n) => ({ n, at: statSync(join(dir, n)).mtimeMs })).sort((a, b) => b.at - a.at);
  for (const b of builds.slice(3)) if (join(dir, b.n) !== keep) rmSync(join(dir, b.n), { recursive: true, force: true });
}
function sizeOf(p) { try { return statSync(p).size; } catch { return null; } }

/* ------------------------------------------------------------------ the server */

/**
 * The lab's server for one studio: every game's lab, on demand. Resolves once listening, with { url, port, close }.
 * `today` is the ref Today is built from (HEAD by default; the page can ask for another with ?today=<ref>).
 */
export async function startLabServer(root, { port = LAB_PORT, today = 'HEAD', log = () => {}, watchFiles = true, host = '127.0.0.1' } = {}) {
  const labs = new Map();
  const labFor = async (id) => {
    let b = labs.get(id);
    if (!b) {
      gameOf(root, id);
      b = new Builds(root, id, { today, log });
      labs.set(id, b);
      b.ready = (async () => { await b.buildNew(); await b.buildToday(); if (watchFiles) b.watch(); })();
    }
    await b.ready;
    return b;
  };
  let origin = '';
  const server = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (error) {
      send(res, 500, { ok: false, why: error instanceof Error ? error.message : String(error) });
    }
  });

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', origin);
    const path = decodeURIComponent(url.pathname);
    if (req.method === 'POST') return post(req, res, path);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false, why: 'GET or POST' });
    if (path === '/' || path === '/index.html') return page(res, indexHtml(root));
    if (path === '/_lab/health') return send(res, 200, { ok: true, studio: readStudio(root).name ?? null, version: STUDIO_VERSION, games: [...labs.keys()] });
    if (path.startsWith('/_lab/api/')) {
      const [, , , id, what] = path.split('/');
      const b = await labFor(id);
      if (what === 'state') {
        const ref = url.searchParams.get('today');
        if (ref && ref !== b.todayRef) await b.buildToday(ref);
        // The ref moved (a commit), or the last build failed (a fix may have landed meanwhile): Today again.
        else await b.followRef();
        if (b.new.error && !b.new.building && Date.now() - Date.parse(b.new.at ?? 0) > 3000) await b.buildNew();
        return send(res, 200, stateOf(root, b));
      }
      if (what === 'events') return events(req, res, b);
      return send(res, 404, { ok: false, why: 'no such lab call' });
    }
    if (path.startsWith('/_lab/')) {
      const name = path.slice('/_lab/'.length);
      const file = name === 'harness.js' || name === 'take.js' ? join(LAB_FILES, name) : join(LAB_FILES, 'page', name);
      if (!within(LAB_FILES, file) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, { ok: false, why: 'not found' });
      return file200(res, file);
    }
    const m = /^\/([a-z0-9][a-z0-9-]{0,39})(\/(?:(new|today)(\/.*)?)?)?$/.exec(path);
    if (!m) return send(res, 404, { ok: false, why: 'not found' });
    const id = m[1];
    if (!m[2]) { res.writeHead(302, { location: `/${id}/${url.search}` }); return res.end(); }
    if (!m[3]) {
      if (!listGames(root).some((g) => g.id === id)) return send(res, 404, { ok: false, why: `no game "${id}"` });
      return page(res, readFileSync(join(LAB_FILES, 'page', 'index.html'), 'utf8'));
    }
    const b = await labFor(id);
    const pane = m[3] === 'new' ? b.new : b.today;
    if (!pane.ok || !pane.dir) return page(res, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b0e17;color:#8a93ad;font:600 13px ui-monospace,monospace;display:grid;place-items:center;height:100vh;text-align:center;padding:24px;box-sizing:border-box">${esc(pane.error ?? pane.none ?? 'building…')}</body>`, 200);
    let rest = m[4] ?? '/';
    if (rest.endsWith('/')) rest += 'index.html';
    const file = normalize(join(pane.dir, rest));
    if (!within(pane.dir, file) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, { ok: false, why: 'not found' });
    if (rest === '/index.html') return page(res, withHarness(readFileSync(file, 'utf8')));
    return file200(res, file);
  }

  async function post(req, res, path) {
    // Only the lab page itself may write: same origin, JSON, small.
    const from = req.headers.origin;
    if (from !== origin && from !== origin.replace('127.0.0.1', 'localhost')) return send(res, 403, { ok: false, why: 'only the lab page may write' });
    if (!/^application\/json\b/.test(String(req.headers['content-type'] ?? ''))) return send(res, 415, { ok: false, why: 'JSON only' });
    const body = await readBody(req, 512 * 1024);
    if (body === null) return send(res, 413, { ok: false, why: 'too big' });
    let json;
    try { json = JSON.parse(body); } catch { return send(res, 400, { ok: false, why: 'not JSON' }); }
    const [, , , id, what] = path.split('/');
    const b = await labFor(id);
    const dir = gameOf(root, id).dir;
    if (what === 'tunables') {
      const spec = readTunables(dir);
      if (!spec) return send(res, 400, { ok: false, why: `games/${id} has no tunables.json` });
      const r = setTunables(spec, json.values ?? {});
      if (r.refused.length) return send(res, 400, { ok: false, why: r.refused.join('; ') });
      writeFileSync(join(dir, 'tunables.json'), formatTunables(r.spec));
      log(`kept in games/${id}/tunables.json: ${r.changed.map((c) => `${c.name} ${c.from} -> ${c.to}`).join(', ') || 'nothing changed'}`);
      // New is rebuilt with the kept values (the watcher would too; this answers once it is).
      await b.buildNew();
      return send(res, 200, { ok: true, changed: r.changed, file: `games/${id}/tunables.json` });
    }
    if (what === 'take') {
      const name = String(json.name ?? '');
      if (!TAKE_NAME.test(name)) return send(res, 400, { ok: false, why: 'a take name is lowercase letters, digits and hyphens' });
      const problems = checkTake(json.take, name);
      if (problems.length) return send(res, 400, { ok: false, why: problems.slice(0, 4).join('; ') });
      const file = join(dir, 'lab.json');
      const cur = readJson(file) ?? { v: 1, default: name, takes: {} };
      cur.takes = { ...(cur.takes ?? {}), [name]: json.take };
      if (!cur.default || json.default === true) cur.default = name;
      writeFileSync(file, formatLabFile(cur));
      log(`take "${name}" written into games/${id}/lab.json (${json.take.inputs?.length ?? 0} inputs, ${json.take.seconds} s)`);
      return send(res, 200, { ok: true, file: `games/${id}/lab.json`, name });
    }
    if (what === 'rebuild') { await b.buildNew(); await b.buildToday(json.today ?? b.todayRef); return send(res, 200, stateOf(root, b)); }
    return send(res, 404, { ok: false, why: 'no such lab call' });
  }

  function events(req, res, b) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': the lab\n\n');
    const l = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    b.listeners.add(l);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => { clearInterval(ping); b.listeners.delete(l); });
  }

  const at = await listen(server, port, host);
  origin = `http://${host}:${at}`;
  return {
    url: origin,
    port: at,
    labs,
    async close() {
      for (const b of labs.values()) b.close();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    },
  };
}

function listen(server, port, host) {
  return new Promise((resolveP, reject) => {
    const any = Number(port) === 0;
    let p = any ? 0 : Number(port) || LAB_PORT;
    const tries = any ? 1 : 20;
    let n = 0;
    const attempt = () => {
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && ++n < tries) { p += 1; attempt(); } else reject(error);
      });
      server.listen(p, host, () => resolveP(server.address().port));
    };
    attempt();
  });
}

function stateOf(root, b) {
  const g = gameOf(root, b.id);
  if (b.new.ok) b.new.dirty = dirtyOf(root, b.id);
  const takes = readTakes(g.dir);
  let tunables = null;
  let tunablesError = null;
  try { tunables = readTunables(g.dir); } catch (error) { tunablesError = error.message; }
  const pane = (p) => ({ ok: p.ok, building: p.building, error: p.error ?? null, none: p.none ?? null, at: p.at ?? null, ms: p.ms ?? null, bytes: p.bytes ?? null });
  const todayValues = b.today.tunables ? Object.fromEntries(Object.entries(b.today.tunables).map(([k, s]) => [k, tunableValue(s)])) : null;
  return {
    ok: true,
    version: STUDIO_VERSION,
    studio: readStudio(root).name ?? null,
    game: { id: g.id, name: g.name ?? g.id },
    new: { ...pane(b.new), dirty: b.new.dirty ?? null, mode: b.new.mode ?? null },
    today: { ...pane(b.today), ref: b.todayRef, commit: b.today.commit ?? null },
    takes: { default: takes.default, takes: takes.takes, problems: takes.problems, file: `games/${g.id}/lab.json`, exists: takes.exists },
    tunables: { file: `games/${g.id}/tunables.json`, spec: tunables, today: todayValues, error: tunablesError },
  };
}

/** The harness first in <head>, before any of the game's scripts. */
export function withHarness(html) {
  const tag = '<script src="/_lab/harness.js"></script>';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (h) => `${h}\n${tag}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (h) => `${h}\n<head>${tag}</head>`);
  return `${tag}\n${html}`;
}

function indexHtml(root) {
  const games = listGames(root);
  const rows = games.map((g) => `<li><a href="/${g.id}/">${esc(g.name ?? g.id)}</a> <small>${esc(g.id)}${existsSync(join(g.dir, 'lab.json')) ? ' · takes' : ''}${existsSync(join(g.dir, 'tunables.json')) ? ' · tunables' : ''}</small></li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Game Lab</title><link rel="stylesheet" href="/_lab/lab.css"></head><body class="index"><main><p class="brand"><span class="mark"></span>GAME LAB</p><h1>${esc(readStudio(root).name ?? 'This studio')}</h1><ul class="games">${rows || '<li>No game yet.</li>'}</ul></main></body></html>`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function within(base, p) { const b = resolve(base); const x = resolve(p); return x === b || x.startsWith(b.endsWith(sep) ? b : `${b}${sep}`); }
function send(res, code, body) {
  if (res.headersSent) { try { res.end(); } catch { /* gone */ } return; }
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`${JSON.stringify(body)}\n`);
}
function page(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(html);
}
function file200(res, file) {
  res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(readFileSync(file));
}
function readBody(req, max) {
  return new Promise((done) => {
    let n = 0;
    const parts = [];
    req.on('data', (c) => { n += c.length; if (n > max) { done(null); req.destroy(); } else parts.push(c); });
    req.on('end', () => done(Buffer.concat(parts).toString('utf8')));
    req.on('error', () => done(null));
  });
}

/* ------------------------------------------------------------------ the command */

/** The lab server already running for this studio (its address), or null. */
export async function runningLab(root) {
  const rec = readJson(serverFile(root));
  if (!rec?.port) return null;
  try { process.kill(rec.pid, 0); } catch { return null; }
  try {
    const r = await fetch(`http://127.0.0.1:${rec.port}/_lab/health`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) return { url: `http://127.0.0.1:${rec.port}`, port: rec.port, pid: rec.pid };
  } catch { /* not answering */ }
  return null;
}

/**
 * `homie-studio lab <game>`: the server in the foreground until stopped, and the link. One server serves every game of
 * the studio; a second `lab` while one runs gives that one's link.
 */
export async function labServe(root, id, { port = LAB_PORT, today = 'HEAD', log = () => {}, take = null } = {}) {
  const g = gameOf(root, id);
  const suffix = `${take ? `?take=${encodeURIComponent(take)}` : ''}${today !== 'HEAD' ? `${take ? '&' : '?'}today=${encodeURIComponent(today)}` : ''}`;
  const already = await runningLab(root);
  if (already) return { ok: true, command: 'lab', already: true, url: `${already.url}/${g.id}/${suffix}`, game: g.id };
  const s = await startLabServer(root, { port, today, log });
  mkdirSync(join(root, '.studio', 'lab'), { recursive: true });
  writeFileSync(serverFile(root), `${JSON.stringify({ pid: process.pid, port: s.port, at: new Date().toISOString() })}\n`);
  log(`Game Lab: ${s.url}/${g.id}/${suffix}   (New: the working tree; Today: ${today}). Stop it with: npx --no-install homie-studio lab --stop`);
  // Both builds now, so the first page load is quick.
  const t0 = Date.now();
  await fetch(`${s.url}/_lab/api/${g.id}/state`).then((r) => r.json()).then((st) => {
    log(`New ${st.new.ok ? `built (${Math.round((st.new.bytes ?? 0) / 1024)} KB)` : `did not build: ${st.new.error}`}; Today ${st.today.ok ? `is ${st.today.commit?.short} "${st.today.commit?.subject}"` : st.today.error ? `did not build: ${st.today.error}` : `: ${st.today.none}`} (${Date.now() - t0} ms)`);
  }).catch(() => {});
  await new Promise((done) => {
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, done);
  });
  await s.close();
  rmSync(serverFile(root), { force: true });
  return { ok: true, command: 'lab', stopped: true, url: `${s.url}/${g.id}/` };
}

/** `homie-studio lab --stop`: this studio's lab server (only it), and the checkouts it made. */
export async function labStop(root) {
  const rec = readJson(serverFile(root));
  const stopped = [];
  if (rec?.pid && rec.pid !== process.pid) {
    let ours = false;
    try {
      process.kill(rec.pid, 0);
      const ps = spawnSync('ps', ['-p', String(rec.pid), '-o', 'command='], { encoding: 'utf8' });
      ours = ps.status !== 0 ? process.platform === 'win32' : /homie-studio|lab/.test(ps.stdout);
    } catch { ours = false; }
    if (ours) {
      try { process.kill(rec.pid, 'SIGTERM'); stopped.push(rec.pid); } catch { /* gone */ }
      const until = Date.now() + 5000;
      while (Date.now() < until) { try { process.kill(rec.pid, 0); await new Promise((r) => setTimeout(r, 150)); } catch { break; } }
    }
  }
  rmSync(serverFile(root), { force: true });
  // The checkouts Today was built from: git forgets them, and their folders go (the builds stay, for next time).
  const base = join(root, '.studio', 'lab');
  const removed = [];
  if (existsSync(base)) {
    for (const id of readdirSync(base)) {
      const dir = join(base, id, 'checkout');
      if (existsSync(dir)) { removeCheckout(root, dir); rmSync(join(base, id, 'checkout.json'), { force: true }); removed.push(`.studio/lab/${id}/checkout`); }
    }
  }
  return { ok: true, command: 'lab stop', stopped, removed };
}

