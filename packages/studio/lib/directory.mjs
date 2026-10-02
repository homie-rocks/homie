/**
 * The homie.rocks directory, from a studio's side. The directory lists games;
 * it never hosts them. A studio proves it controls its site by serving the
 * claim the directory gave it (`homie-studio deploy` stores it in D1), so
 * nobody can list games under someone else's site.
 */
import { request } from './net.mjs';
import { listGames, readStudio, siteUrl } from './studio.mjs';
import { licenceProblems, readManifest } from './asset-manifest.mjs';

export async function publish(root, { homie, site } = {}) {
  const studio = readStudio(root);
  const directory = (homie || studio.homie?.directory || 'https://homie.rocks').replace(/\/+$/, '');
  const url = site || siteUrl(root, studio);
  // Licences first: a public game may ship only assets with a licence record that allows it.
  const refused = [];
  for (const g of listGames(root)) {
    if (g.launch === 'private' || g.launch === 'invite') continue;
    for (const p of licenceProblems(root, g.id, readManifest(root, g.id), { public: g.share?.source !== false })) if (p.level === 'refuse') refused.push({ game: g.id, ...p });
  }
  if (refused.length) return { ok: false, command: 'publish', refused, why: `not listed: ${refused.length} asset licence problem${refused.length === 1 ? '' : 's'}:\n${refused.map((p) => `  ${p.game}/${p.asset}: ${p.problem}${p.fix ? ` (${p.fix})` : ''}`).join('\n')}\nhomie-studio assets check <id> says the same; fix them, deploy, then publish again.` };
  if (!url) return { ok: false, command: 'publish', why: 'this studio has no live site yet: run `npm run deploy` first' };
  const sent = await request(`${directory}/api/studio/publish`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site: url }),
  }, { timeout: 30_000 });
  // The directory's own answer (what it listed, or why not), or the connection's error as it is.
  return { ...(sent.body ?? {}), ok: sent.ok, command: 'publish', directory, site: url, ...(sent.ok ? {} : { why: sent.body?.message ?? sent.why, ...(sent.code ? { code: sent.code } : {}), ...(sent.needs ? { needs: sent.needs } : {}) }) };
}
