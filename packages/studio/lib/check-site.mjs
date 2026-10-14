/**
 * WHERE A CHECK RUNS, AND ON WHICH GAMES, WHEN NOBODY SAYS (0.46.5).
 *
 * A check puts real browsers in a real room. With no `--url` it used to open the studio's LIVE site, and with no game
 * the first game by name: `npm run check` in a studio working on one game sat two check browsers in a live public
 * room of another. A check is a gate on what is in this folder, so:
 *
 *   where   `--url <site>` as given; else this studio's own dev server: the one already running (lib/dev.mjs keeps
 *           its record), or one started for the check on a free port and stopped when the check ends. The live site
 *           only when asked by name: `--live`, or its address in `--url`.
 *   which   the game named; else every game this checkout changed (files under games/<id>/ that differ from the
 *           default branch, committed or not); else, when nothing changed or this is not a git checkout, every game.
 */
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { runningDev } from './dev.mjs';
import { listExperiences, siteUrl } from './studio.mjs';

const CLI = fileURLToPath(new URL('../bin/homie-studio.mjs', import.meta.url));

async function freePort() {
  const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  const port = s.address().port; await new Promise((r) => s.close(r)); return port;
}

/**
 * The site a check opens: { ok, url, local, live, started, stop() }. `stop` ends only a server this call started.
 * `spawnFn` and `fetchFn` are for tests.
 */
export async function checkSite(root, { url = null, live = false, log = () => {}, spawnFn = spawn, fetchFn = globalThis.fetch, waitMs = 240_000 } = {}) {
  const none = async () => {};
  if (url) return { ok: true, url: String(url), local: /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/.test(String(url)), live: false, started: false, stop: none };
  if (live) {
    const site = siteUrl(root);
    return site ? { ok: true, url: site, local: false, live: true, started: false, stop: none } : { ok: false, why: 'this studio has no live site yet (deploy it first), so there is nothing for --live to check' };
  }
  const running = runningDev(root);
  if (running) return { ok: true, url: running.url, local: true, live: false, started: false, stop: none };
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  log(`check: no --url, so this studio's own build is checked: starting its dev server on ${origin} (stopped when the check ends; --live checks the live site)`);
  const child = spawnFn(process.execPath, [CLI, 'dev', '--port', String(port), '--no-local-ai'], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk) => { tail = (tail + chunk).slice(-4000); });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, 'exit');
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
    const force = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 8000);
    try { await ended; } finally { clearTimeout(force); }
  };
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    const up = await fetchFn(`${origin}/games.json`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
    if (up) return { ok: true, url: origin, local: true, live: false, started: true, stop };
    await new Promise((r) => setTimeout(r, 400));
  }
  await stop();
  return { ok: false, why: `this studio's dev server did not start for the check${tail ? `:\n${tail.trim().split('\n').slice(-12).join('\n')}` : ''}\nStart it yourself (npm run dev) and give its address with --url, or fix the build.` };
}

/** The ids of the games this checkout changed against its default branch (committed or not), in the studio's order; [] when it cannot be told. */
export function changedGames(root, { run = spawnSync } = {}) {
  const git = (...args) => { const r = run('git', args, { cwd: root, encoding: 'utf8' }); return r.status === 0 ? String(r.stdout) : null; };
  if (git('rev-parse', '--is-inside-work-tree') === null) return [];
  const files = new Set((git('status', '--porcelain', '--', 'games', 'apps') ?? '').split('\n').map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()).filter(Boolean));
  const head = (git('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD') ?? '').trim();
  for (const base of [head, 'origin/main', 'main', 'origin/master', 'master'].filter(Boolean)) {
    const fork = (git('merge-base', 'HEAD', base) ?? '').trim();
    if (!fork) continue;
    for (const f of (git('diff', '--name-only', `${fork}..HEAD`, '--', 'games', 'apps') ?? '').split('\n')) if (f) files.add(f);
    break;
  }
  const touched = new Set([...files].map((f) => /^(?:games|apps)\/([^/]+)\//.exec(f)?.[1]).filter(Boolean));
  return listExperiences(root).map((g) => g.id).filter((id) => touched.has(id));
}

/** The games a check covers: the one named, else what changed, else all of them. */
export function gamesToCheck(root, named, options) {
  if (named) return { games: [named], why: 'named' };
  const changed = changedGames(root, options);
  if (changed.length) return { games: changed, why: 'changed in this checkout' };
  return { games: listExperiences(root).map((g) => g.id), why: 'nothing changed against the default branch: every game' };
}
