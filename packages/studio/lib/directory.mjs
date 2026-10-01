/**
 * The homie.rocks directory, from a studio's side. The directory lists games;
 * it never hosts them. A studio proves it controls its site by serving the
 * claim the directory gave it (`homie-studio deploy` stores it in D1), so
 * nobody can list games under someone else's site.
 */
import { request } from './net.mjs';
import { readStudio, siteUrl } from './studio.mjs';

export async function publish(root, { homie, site } = {}) {
  const studio = readStudio(root);
  const directory = (homie || studio.homie?.directory || 'https://homie.rocks').replace(/\/+$/, '');
  const url = site || siteUrl(root, studio);
  if (!url) return { ok: false, command: 'publish', why: 'this studio has no live site yet: run `npm run deploy` first' };
  const sent = await request(`${directory}/api/studio/publish`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site: url }),
  }, { timeout: 30_000 });
  // The directory's own answer (what it listed, or why not), or the connection's error as it is.
  return { ...(sent.body ?? {}), ok: sent.ok, command: 'publish', directory, site: url, ...(sent.ok ? {} : { why: sent.body?.message ?? sent.why, ...(sent.code ? { code: sent.code } : {}), ...(sent.needs ? { needs: sent.needs } : {}) }) };
}
