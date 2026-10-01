/**
 * WHICH GITHUB REPOSITORY THIS STUDIO IS. The Claude app's hand-off opens Claude Code on it, so it must be the
 * studio's own: never the engine and template repository (homie-rocks/homie) that Cloudflare's "Deploy to
 * Cloudflare" copied the studio from, and never a guess.
 *
 * In order:
 *   1. HOMIE_REPO, a build variable naming it;
 *   2. studio.json `github` (`setup attach` writes it, and the person may);
 *   3. the checkout's git remotes, origin first. A Workers Builds checkout, a Claude Code cloud session (its remote
 *      goes through the session's own git proxy) and a person's clone all carry one. Only owner/name is kept,
 *      never a token in the URL.
 *
 * A deploy hands it to the live Worker as a variable (HOMIE_REPO), never into a public file. The Worker tells its
 * directory alongside its claim, so the setup card can open the right repository.
 */
import { spawnSync } from 'node:child_process';
import { readStudio } from './studio.mjs';

export const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** The engine and template repository: a studio is never this. */
export const ENGINE_REPO = 'homie-rocks/homie';

/** owner/name in a git remote URL (https, ssh, a proxy's /git/owner/name path), without any credentials; or null. */
export function repoFromUrl(url) {
  const s = String(url ?? '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  if (!s) return null;
  const m = /[/:]([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(s);
  return m ? studioRepo(`${m[1]}/${m[2]}`) : null;
}

/** A studio repository slug, or null (not a slug, or the engine repository). */
export function studioRepo(value) {
  const r = String(value ?? '').trim();
  return REPO.test(r) && r.toLowerCase() !== ENGINE_REPO ? r : null;
}

/** This studio's repository: HOMIE_REPO, studio.json `github`, else its git remotes (origin first). */
export function repoOf(root, { env = process.env } = {}) {
  const named = studioRepo(env.HOMIE_REPO);
  if (named) return named;
  try { const s = studioRepo(readStudio(root).github); if (s) return s; } catch { /* no studio.json */ }
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000 });
  const origin = git(['remote', 'get-url', 'origin']);
  if (origin.status === 0) { const r = repoFromUrl(origin.stdout); if (r) return r; }
  const all = git(['config', '--get-regexp', '^remote\\..*\\.url$']);
  for (const line of (all.status === 0 ? all.stdout : '').split('\n')) {
    const r = repoFromUrl(line.split(/\s+/)[1]);
    if (r) return r;
  }
  return null;
}
