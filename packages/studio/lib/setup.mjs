/**
 * `homie-studio setup attach <hs_…>` — this repository is the studio the Claude app's setup card (the Homie MCP
 * tool studio_setup) is making, said once from the Claude Code session that works in it:
 *
 *   - the directory records that Claude works in this repository (the card's "Let Claude work in it" goes green),
 *     and answers with the studio's live address once its site is connected (the card's Cloudflare step);
 *   - a copy of the public template (studio.json `template: true`) gets the name the person chose in the chat:
 *     studio.json, the Worker's STUDIO_NAME, and AGENTS.md and README.md while they are untouched; its first-run
 *     "Connect this chat" band goes; studio.json takes the Worker and database names Cloudflare's form chose;
 *   - the live address goes into .studio/local.json (git-ignored), so `check --url` and the card know it.
 *
 * It sends the repository's owner/name and the studio's name and slug, nothing else: no key, no path, no code.
 * A setup id is single use per repository: a second attach from the same repository answers the same; another
 * repository is refused.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configNames } from './cloudflare.mjs';
import { studioClient } from './client.mjs';
import { request } from './net.mjs';
import { ENGINE_REPO, repoOf } from './repo.mjs';
import { CONNECT_BAND, agentsMd, readme, slugify, templateReadme } from './scaffold.mjs';
import { configPath, readStudio, writeLocal, writeStudio } from './studio.mjs';
import { STUDIO_VERSION } from './version.mjs';

const SETUP_ID = /^hs_[a-f0-9]{32}$/;

export async function setupAttach(root, id, { homie, client } = {}) {
  if (!SETUP_ID.test(String(id ?? ''))) return { ok: false, command: 'setup attach', why: 'attach to the setup id the setup card showed: hs_ and 32 hex digits' };
  const who = studioClient(client);
  const studio = readStudio(root);
  const directory = String(homie || studio.homie?.directory || 'https://homie.rocks').replace(/\/+$/, '');
  const repo = repoOf(root);
  if (!repo) {
    return { ok: false, command: 'setup attach', needs: 'repository', why: `this checkout names no GitHub repository of its own (its git remote is missing, or is ${ENGINE_REPO}, Homie's engine and template, which a studio never is). Run this in the studio's own repository, the one Cloudflare's Deploy to Cloudflare made, or name it in studio.json as "github": "<owner>/<name>"` };
  }
  const sent = await request(`${directory}/api/studio/setup/${id}/attach`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': `homie-studio/${STUDIO_VERSION}` },
    body: JSON.stringify({ repo, studio: { name: studio.name, slug: studio.slug, template: studio.template === true }, version: STUDIO_VERSION, ...(who.id === 'chat' ? {} : { client: who.id }) }),
  });
  // What went wrong, as it is: the directory's own answer, or the connection's error. Never a guess at the network.
  if (!sent.ok) return { ok: false, command: 'setup attach', repo, ...(sent.status ? { status: sent.status } : {}), ...(sent.code ? { code: sent.code } : {}), ...(sent.needs ? { needs: sent.needs } : {}), why: sent.why };
  const body = sent.body;

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
  // The repository goes into studio.json, so the next deploy (and Workers Builds) tells the live Worker which it is.
  const now = readStudio(root);
  if (now.github !== repo) { writeStudio(root, { ...now, github: repo }); if (!renamed.includes('studio.json')) renamed.push('studio.json'); }
  if (body.site) writeLocal(root, { url: body.site, connectedAt: new Date().toISOString() });
  return {
    ok: true, command: 'setup attach', setup: id, repo, client: who.id, site: body.site ?? null, name: name ?? studio.name, renamed,
    message: body.site ? `This repository is ${name ?? studio.name}, live at ${body.site}. ${who.card[0].toUpperCase()}${who.card.slice(1)} shows it.` : `This repository is ${name ?? studio.name}. Its site is not connected yet: ${body.connect ?? `open the site and tap ${who.connect}`}.`,
    next: [
      ...(renamed.length ? ['commit the renamed files on a branch and open a pull request (merging it names the live site)'] : []),
      ...(who.id === 'grok' ? ['a Grok Bot in this folder runs the checklist from here (there is no second session to start)'] : []),
      'npm install, then npx --no-install homie-studio progress attach <hb_…> when the chat opened a build',
    ],
  };
}
