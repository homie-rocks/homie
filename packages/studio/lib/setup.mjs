/**
 * `homie-studio setup attach <hs_…>` — this repository is the studio the Claude app's setup card (the Homie MCP
 * tool studio_setup) is making, said once from the Claude Code session that works in it:
 *
 *   - the directory records that Claude works in this repository (the card's "Let Claude work in it" goes green),
 *     and answers with the studio's live address once its site is connected (the card's Cloudflare step);
 *   - a copy of the public template (studio.json `template: true`) gets the name the person chose in the chat:
 *     studio.json, the Worker's STUDIO_NAME, and AGENTS.md and README.md while they are untouched; its first-run
 *     "Connect to Claude" band goes; studio.json takes the Worker and database names Cloudflare's form chose;
 *   - the live address goes into .studio/local.json (git-ignored), so `check --url` and the card know it.
 *
 * It sends the repository's owner/name and the studio's name and slug, nothing else: no key, no path, no code.
 * A setup id is single use per repository: a second attach from the same repository answers the same; another
 * repository is refused.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configNames } from './cloudflare.mjs';
import { networkWhy } from './progress.mjs';
import { CONNECT_BAND, agentsMd, readme, slugify, templateReadme } from './scaffold.mjs';
import { configPath, readStudio, writeLocal, writeStudio } from './studio.mjs';
import { STUDIO_VERSION } from './version.mjs';

const SETUP_ID = /^hs_[a-f0-9]{32}$/;

/** owner/repo of this checkout's GitHub remote (a Claude Code cloud session's remote goes through its own proxy). */
export function repoOf(root) {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return null;
  const url = r.stdout.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = /[/:]([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

export async function setupAttach(root, id, { homie } = {}) {
  if (!SETUP_ID.test(String(id ?? ''))) return { ok: false, command: 'setup attach', why: 'attach to the setup id the Claude app\'s setup card showed: hs_ and 32 hex digits' };
  const studio = readStudio(root);
  const directory = String(homie || studio.homie?.directory || 'https://homie.rocks').replace(/\/+$/, '');
  const repo = repoOf(root);
  let res; let body = null;
  try {
    res = await fetch(`${directory}/api/studio/setup/${id}/attach`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': `homie-studio/${STUDIO_VERSION}` },
      body: JSON.stringify({ repo, studio: { name: studio.name, slug: studio.slug, template: studio.template === true }, version: STUDIO_VERSION }),
      signal: AbortSignal.timeout(10_000),
    });
    body = await res.json().catch(() => null);
  } catch (error) { return { ok: false, command: 'setup attach', why: `${directory} did not answer (${error?.message ?? error})` }; }
  const blocked = networkWhy(res, directory);
  if (blocked) return { ok: false, command: 'setup attach', needs: 'network', why: blocked };
  if (!res.ok || !body?.ok) return { ok: false, command: 'setup attach', why: body?.message ?? `${directory} answered ${res.status}` };

  const renamed = [];
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : null;
  if (studio.template === true) {
    const next = { ...readStudio(root) };
    delete next.template;
    const was = { name: next.name, slug: next.slug };
    if (name) { next.name = name; next.slug = slugify(name); }
    // The Worker and database are whatever Cloudflare's form named them: studio.json follows wrangler.jsonc.
    const names = configNames(root);
    next.cloudflare = { ...next.cloudflare, ...(names.worker ? { worker: names.worker } : {}), ...(names.d1 ? { d1: names.d1 } : {}) };
    writeStudio(root, next);
    renamed.push('studio.json');
    if (name) {
      const cfg = configPath(root);
      const text = readFileSync(cfg, 'utf8');
      const fixed = text.replace(/("STUDIO_NAME"\s*:\s*)"(?:[^"\\]|\\.)*"/g, (_, k) => `${k}${JSON.stringify(name)}`);
      if (fixed !== text) { writeFileSync(cfg, fixed); renamed.push('wrangler.jsonc'); }
      const untouched = (file, before, after) => {
        const path = join(root, file);
        if (existsSync(path) && readFileSync(path, 'utf8') === before) { writeFileSync(path, after); renamed.push(file); }
      };
      untouched('AGENTS.md', agentsMd(was), agentsMd({ name: next.name, slug: next.slug }));
      untouched('README.md', templateReadme(), readme({ name: next.name }));
    }
    const band = join(root, 'site', 'partials', 'home.html');
    if (existsSync(band) && readFileSync(band, 'utf8') === CONNECT_BAND) { rmSync(band); renamed.push('site/partials/home.html (removed)'); }
  }
  if (body.site) writeLocal(root, { url: body.site, connectedAt: new Date().toISOString() });
  return {
    ok: true, command: 'setup attach', setup: id, repo, site: body.site ?? null, name: name ?? studio.name, renamed,
    message: body.site ? `This repository is ${name ?? studio.name}, live at ${body.site}. The Claude app's card shows it.` : `This repository is ${name ?? studio.name}. Its site is not connected yet: ${body.connect ?? 'open the site and tap Connect to Claude'}.`,
    next: [
      ...(renamed.length ? ['commit the renamed files on a branch and open a pull request (merging it names the live site)'] : []),
      'npm install, then npx --no-install homie-studio progress attach <hb_…> when the chat opened a build',
    ],
  };
}
