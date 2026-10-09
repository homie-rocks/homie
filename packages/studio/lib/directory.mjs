/**
 * The homie.rocks directory, from a studio's side. The directory lists games;
 * it never hosts them. A studio proves it controls its site by serving the
 * claim the directory gave it (`homie-studio deploy` stores it in D1), so
 * nobody can list games under someone else's site.
 */
import { request } from './net.mjs';
import { listExperiences as listGames, readLocal, readStudio, siteUrl, writeLocal } from './studio.mjs';
import { licenceProblems, readManifest } from './asset-manifest.mjs';
import { partsPlanLines, partsPublishReport } from './parts-build.mjs';

/*
 * HOW MANY PUBLISHES ARE LEFT TODAY. In the beta the directory lets a studio publish only so many times a day, and
 * the first a person heard of it was the refusal. The directory's answer is the only place the real number can come
 * from, so `quotaOf` reads it wherever the directory puts it: a count in the body (`remaining`, `left`,
 * `publishesLeft`, or those inside `quota` / `limits` / `rateLimit`), or the standard rate-limit headers
 * (`ratelimit-remaining`, `x-ratelimit-remaining`, `retry-after`). What it finds is said after every publish.
 *
 * Before a publish, `publishBefore` asks the directory itself, with a read (GET /api/studio/publish?site=<origin>
 * answers { ok, site, listed, limit, remaining, resetsAt } and changes nothing). When the directory cannot be
 * reached, or is one that has no such read, it says so plainly and falls back to what THIS COMPUTER knows: how many
 * it has sent today (UTC, the day the cap counts in), and what the directory said was left after the last one. That
 * is a floor, never a promise: a publish from another computer or from the Homie connector is not counted here.
 */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : null);
const first = (...values) => { for (const v of values) { const n = num(v); if (n !== null) return n; } return null; };
const utcDay = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);

/** What the directory's answer says about the day's publishes: { remaining, limit, resetsAt, retryAfter }, each null when it did not say. */
export function quotaOf(body, headers = null) {
  const b = body && typeof body === 'object' ? body : {};
  const nests = [b, b.quota, b.limits, b.limit, b.rateLimit, b.publishes, b.cap].filter((x) => x && typeof x === 'object');
  const pick = (...keys) => first(...nests.flatMap((n) => keys.map((k) => n[k])));
  const head = (k) => headers?.get?.(k) ?? null;
  const reset = nests.map((n) => n.resetsAt ?? n.resetAt ?? n.reset).find((v) => typeof v === 'string' && !Number.isNaN(Date.parse(v))) ?? null;
  return {
    remaining: first(pick('remaining', 'left', 'publishesLeft', 'publishesRemaining'), head('ratelimit-remaining'), head('x-ratelimit-remaining')),
    limit: first(pick('limit', 'max', 'perDay', 'daily', 'cap'), num(b.limit), head('ratelimit-limit'), head('x-ratelimit-limit')),
    resetsAt: reset,
    retryAfter: first(head('retry-after')),
  };
}

/** Whether a refusal is the day's cap (a 429, or the directory's own words for it). */
export function isPublishCap(sent) {
  if (sent?.ok) return false;
  const words = `${sent?.body?.error ?? ''} ${sent?.body?.code ?? ''} ${sent?.body?.message ?? ''} ${sent?.why ?? ''}`;
  return sent?.status === 429 || /\b(daily|per day|today)\b.*\b(cap|limit|quota|publish)|\b(cap|limit|quota)\b.*\b(reached|exceeded|used up|hit)\b|too many publish|rate.?limit/i.test(words);
}

/** One sentence about the day's publishes, from the directory's own numbers when it gave any. */
export function quotaLine(q, { sentToday = 0, refused = false } = {}) {
  const when = q.resetsAt ? ` It resets at ${q.resetsAt}.` : q.retryAfter !== null ? ` Try again in ${q.retryAfter >= 120 ? `${Math.ceil(q.retryAfter / 60)} min` : `${q.retryAfter} s`}.` : refused ? ' The count is per UTC day: it resets at 00:00 UTC.' : '';
  if (q.remaining !== null) return `Publishes left today: ${q.remaining}${q.limit !== null ? ` of ${q.limit}` : ''}.${when}`;
  if (refused) return `The directory's daily publish cap for the beta is used up${q.limit !== null ? ` (${q.limit} a day)` : ''}.${when} Nothing is wrong with the studio: the listing it has stays as it is until then.`;
  const mine = `This computer has sent ${sentToday} publish${sentToday === 1 ? '' : 'es'} today (UTC)`;
  return `${mine}${q.limit !== null ? `, of the ${q.limit} a day the directory allows` : '; the directory has a daily cap in the beta and did not say how many are left'}.`;
}

/** What this computer knows before a publish: how many it sent today and what the directory last said was left. */
export function publishesSoFar(root, now = Date.now()) {
  const p = readLocal(root).publishes;
  if (!p || p.day !== utcDay(now)) return { day: utcDay(now), sent: 0, remaining: null, limit: null };
  return { day: p.day, sent: Number(p.sent) || 0, remaining: num(p.remaining), limit: num(p.limit) };
}

/** The line said BEFORE a publish goes out. */
export function beforeLine(so) {
  if (so.remaining !== null) return so.remaining > 0
    ? `Publishing to the directory: it said ${so.remaining} publish${so.remaining === 1 ? ' was' : 'es were'} left today after the last one${so.limit !== null ? ` (of ${so.limit} a day)` : ''}.`
    : `Publishing to the directory: it said none were left today after the last one${so.limit !== null ? ` (of ${so.limit} a day)` : ''}, so this one may be refused until 00:00 UTC.`;
  return `Publishing to the directory: publish ${so.sent + 1} from this computer today (UTC). The beta has a daily cap; the directory's answer says how many are left when it gives the number.`;
}

/**
 * The parts report for a listing: lib/parts-build.mjs partsPublishReport, for the games a listing shows (a private
 * or invite-only game is not listed, so its parts are not this moment's question).
 */
export function partsForListing(root) {
  const report = partsPublishReport(root);
  const hidden = new Set(listGames(root).filter((g) => g.launch === 'private' || g.launch === 'invite').map((g) => g.id));
  const games = report.games.filter((g) => !hidden.has(g.game));
  return { ...report, games, ok: games.every((g) => g.ok) && !report.why };
}

/** The asset licence problems that stop a listing: a public game may ship only assets with a licence record that allows it. */
function licenceRefusals(root) {
  const refused = [];
  for (const g of listGames(root)) {
    if (g.launch === 'private' || g.launch === 'invite') continue;
    for (const p of licenceProblems(root, g.id, readManifest(root, g.id))) if (p.level === 'refuse') refused.push({ game: g.id, ...p });
  }
  return refused;
}

/**
 * `homie-studio publish --before` and the studio_publish tool's `before: true`, one code path: what a publish would
 * meet, and NOTHING is published. It sends one GET (the directory's own read-only count for this site), never a
 * POST, and writes no file, not even this computer's count. { ok: true, published: false, listed, publishes: {
 * remaining, limit, resetsAt, sentToday, from: 'directory' | 'this computer', line }, parts?, refused? }, and
 * `unreached: { why }` when the directory could not be asked. `ok` says the preflight ran, never that a publish
 * would go through.
 */
export async function publishBefore(root, { homie, site, log = () => {}, fetchFn } = {}) {
  const studio = readStudio(root);
  const directory = (homie || studio.homie?.directory || 'https://homie.rocks').replace(/\/+$/, '');
  const url = site || siteUrl(root, studio);
  const refused = licenceRefusals(root);
  const parts = partsForListing(root);
  const local = publishesSoFar(root);
  const mine = `this computer has sent ${local.sent} publish${local.sent === 1 ? '' : 'es'} today (UTC)${local.remaining !== null ? `, and the directory said ${local.remaining === 0 ? 'none were' : `${local.remaining} ${local.remaining === 1 ? 'was' : 'were'}`} left after the last one${local.limit !== null ? ` (of ${local.limit} a day)` : ''}` : ''}; a publish from another computer or from the Homie connector is not counted here`;
  let origin = null;
  try { origin = url ? new URL(url).origin : null; } catch { origin = null; }
  let asked = null;
  if (origin) asked = await request(`${directory}/api/studio/publish?site=${encodeURIComponent(origin)}`, { method: 'GET', headers: { accept: 'application/json' } }, { timeout: 15_000, ...(fetchFn ? { fetchFn } : {}) });
  const q = asked?.ok ? quotaOf(asked.body, asked.headers) : null;
  const counted = Boolean(q && q.remaining !== null);
  const listed = asked?.ok && typeof asked.body?.listed === 'boolean' ? asked.body.listed : null;
  const why = !origin ? null : asked.ok ? 'it answered without a count' : String(asked.body?.message ?? asked.why ?? 'no answer').split('\n')[0];
  const line = !origin
    ? 'Not published. This studio has no live site yet, so there is nothing to list: put it online first (npm run deploy).'
    : counted
      ? `Not published. The directory says: this site is ${listed === true ? 'listed' : listed === false ? 'not listed yet' : 'known to it or not, it did not say'}; ${quotaLine(q).replace(/^P/, 'p')}`
      : `Not published. The directory could not be asked how many publishes are left (${why}), so this is only what this computer knows: ${mine}.`;
  const lines = [
    line,
    ...(refused.length ? [`A publish now would be refused: ${refused.length} asset licence problem${refused.length === 1 ? '' : 's'} (${refused.slice(0, 6).map((p) => `${p.game}/${p.asset}: ${p.problem}`).join('; ')}${refused.length > 6 ? '; …' : ''}). homie-studio assets check <id> says how to fix each.`] : []),
    ...partsPlanLines(parts, { at: 'publish' }),
  ];
  for (const l of lines) log(l);
  return {
    ok: true, command: 'publish before', published: false, directory, site: url ?? null, listed,
    publishes: { remaining: counted ? q.remaining : local.remaining, limit: (counted ? q.limit : null) ?? local.limit, resetsAt: q?.resetsAt ?? null, sentToday: local.sent, from: counted ? 'directory' : 'this computer', line },
    ...(origin && !counted ? { unreached: { why, ...(asked.status !== undefined ? { status: asked.status } : {}) } } : {}),
    ...(refused.length ? { refused } : {}),
    ...(parts.games.length || parts.sharing.length || parts.why ? { parts } : {}),
    lines,
  };
}

export async function publish(root, { homie, site, log = () => {}, fetchFn } = {}) {
  const studio = readStudio(root);
  const directory = (homie || studio.homie?.directory || 'https://homie.rocks').replace(/\/+$/, '');
  const url = site || siteUrl(root, studio);
  // Licences first: a public game may ship only assets with a licence record that allows it.
  const refused = licenceRefusals(root);
  if (refused.length) return { ok: false, command: 'publish', refused, why: `not listed: ${refused.length} asset licence problem${refused.length === 1 ? '' : 's'}:\n${refused.map((p) => `  ${p.game}/${p.asset}: ${p.problem}${p.fix ? ` (${p.fix})` : ''}`).join('\n')}\nhomie-studio assets check <id> says the same; fix them, deploy, then publish again.` };
  if (!url) return { ok: false, command: 'publish', why: 'this studio has no live site yet: run `npm run deploy` first' };
  // Parts from other studios in the games about to be listed: their licences and credits, and plainly when two
  // cannot be combined, in the same lines the deploy plan gave (lib/parts-build.mjs). Said before anything is sent.
  // It does not stop the listing: the person decides, having been told.
  const parts = partsForListing(root);
  for (const line of partsPlanLines(parts, { at: 'publish' })) log(line);
  const before = publishesSoFar(root);
  log(beforeLine(before));
  const sent = await request(`${directory}/api/studio/publish`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site: url }),
  }, { timeout: 30_000, ...(fetchFn ? { fetchFn } : {}) });
  const quota = quotaOf(sent.body, sent.headers);
  const capped = isPublishCap(sent);
  // A request that reached the directory counts against the day whether it listed or not; one that never got
  // there (no network) does not.
  const reached = sent.ok || sent.status !== undefined;
  const sentToday = before.sent + (reached ? 1 : 0);
  try {
    writeLocal(root, {
      publishes: { day: before.day, sent: sentToday, remaining: quota.remaining ?? (capped ? 0 : null), limit: quota.limit ?? before.limit },
      // That THIS computer listed the studio: what lets a later deploy ask the directory to read it again (the one
      // deploy that withdraws the whole-game source an older toolkit offered), and never lists a studio that was not
      // listed (a deploy alone lists nothing).
      ...(sent.ok ? { listed: { at: new Date().toISOString(), site: url, directory } } : {}),
    });
  } catch { /* a read-only folder: the count is only a convenience */ }
  // The day's limit, once the directory has said it, is remembered for the answers that leave it out.
  const known = { ...quota, limit: quota.limit ?? before.limit };
  const publishes = { ...known, sentToday, before: before.remaining, line: quotaLine(known, { sentToday, refused: capped }) };
  // The directory's own answer (what it listed, or why not), or the connection's error as it is.
  return {
    ...(sent.body ?? {}), ok: sent.ok, command: 'publish', directory, site: url, publishes,
    ...(parts.games.length || parts.sharing.length || parts.why ? { parts } : {}),
    ...(sent.ok ? {} : { why: `${sent.body?.message ?? sent.why}${capped ? `\n${publishes.line}` : ''}`, ...(sent.code ? { code: sent.code } : {}), ...(capped ? { needs: 'publish-cap' } : sent.needs ? { needs: sent.needs } : {}) }),
  };
}

/** Whether this computer listed the studio at this site in this directory (lib/directory.mjs `publish` records it). */
export function listedHere(root, { site = null, directory = null } = {}) {
  const l = readLocal(root).listed;
  if (!l?.at) return null;
  const same = (a, b) => !a || !b || String(a).replace(/\/+$/, '') === String(b).replace(/\/+$/, '');
  return same(l.site, site) && same(l.directory, directory) ? l : null;
}
