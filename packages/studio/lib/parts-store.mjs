import { paidAccess, savePurchaseBackup, offlinePurchase, purchaseFacts } from './parts-purchase.mjs';
import { priceWords } from "../worker/purchase-pricing.mjs";

/**
 * FINDING, ADDING AND SHARING PARTS (parts/PARTS.md): what the four chat tools do (lib/parts-tools.mjs).
 *
 * A part is copied into the studio and is then the studio's own to tune. This file is deliberately NOT a package
 * manager, and rebuilds nothing that already works:
 *
 *   packages   are npm's. What a part builds on (`requires.packages`) is handed to npm: `npm ls` says whether the
 *              studio has it, `npm install` installs what is missing, and npm's own words are relayed as they are.
 *              package.json and package-lock.json are the only record. No resolver, no ranges, no lockfile here.
 *   parts      one exact version is fetched (the latest shared one unless a version is named), its integrity
 *              checked (every file's SHA-256 and size, node:crypto) BEFORE a byte reaches the studio, copied to
 *              parts/_vendor/<host>/<id>/, and where it came from recorded in parts/origins.json.
 *   credits    one line in the game's credits.json, through the same `parts[]` the asset credits use.
 *
 * Two things are injectable so tests touch neither the network nor the registry: `fetch` (every request goes
 * through the one get() below) and `npm` (every npm call goes through one runner).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  LIMITS, TUNING_FILE, TUNING_UPSTREAM, assetRecords, checkPart, compareVersions, isVersion, licenceIssues, licenseOfPart, listOwnParts, packPart, packedDir,
  packedVersions, parseRef, partDir, readOrigins, readPart, requiredParts, sha256, shareProblems, syncPartCredits, vendorDir, verifyFiles, writeHashes,
  writeOrigins, writePart,
} from './parts.mjs';
import { experienceDir, experienceFile, listExperiences as listGames, readStudio } from './studio.mjs';

export const HUB = 'https://homie.rocks';
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const line = (v, n = 200) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, n) : '');

/* ------------------------------------------------------------------ the one fetch */

/** A studio's site from its host: https, except a site on this computer (the local preview), which has no certificate. */
export function baseOf(host) {
  return `${/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https'}://${host}`;
}

/** Every request this file makes. Bytes back, capped; a plain sentence when it fails. */
async function get(url, { fetch: f = globalThis.fetch, max = LIMITS.fileBytes, what = 'the file', authorization } = {}) {
  let res;
  try { res = await f(url, { redirect: authorization ? 'error' : 'follow', headers: { accept: '*/*', ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) }, signal: AbortSignal.timeout(30000) }); } catch (error) { throw new Error(`${new URL(url).host} could not be reached (${String(error?.cause?.code ?? error?.message ?? error).slice(0, 80)})`); }
  if (!res.ok) throw new Error(`${url} answered ${res.status}: ${what} is not there`);
  const reader = res.body?.getReader(); const chunks = []; let size = 0;
  if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); throw new Error(`${url} exceeds the size ${what} may be (${max} bytes)`); } chunks.push(value); }
  return Buffer.concat(chunks);
}
async function getJson(url, opts) {
  const bytes = await get(url, { max: 4 * 1024 * 1024, ...opts });
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`${url} is not JSON`); }
}

/**
 * One exact version of a shared part, fetched and CHECKED: { part, files: Map(path → bytes), entry, base, version }.
 * Nothing is returned unless every file's SHA-256 and size are what the part.json says, so nothing unverified can
 * be written by a caller.
 */
export async function fetchPart(refText, { fetch, onPaid } = {}) {
  const ref = parseRef(refText);
  if (!ref) throw new Error(`"${String(refText).slice(0, 80)}" does not name a part: "<studio site>/<part id>", such as "owls.example/pickup-field" (and "@1.2.0" for one version)`);
  const base = baseOf(ref.host);
  let catalog = `${base}/parts/catalog.json`;
  try {
    const discovery = await getJson(`${base}/.well-known/api-catalog`, { fetch, what: 'the studio API catalogue' });
    const candidate = discovery.linkset?.flatMap((item) => item.item ?? []).find((item) => item.type === 'application/json' && new URL(item.href).origin === base);
    if (candidate) catalog = candidate.href;
  } catch { /* Older studios expose the resource catalogue directly. */ }
  const index = await getJson(catalog, { fetch, what: 'the studio list of shared parts' }).catch(() => getJson(`${base}/.well-known/homie-parts.json`, { fetch, what: 'the older studio catalogue' })).catch((error) => { throw new Error(`${ref.host} shares no parts that can be read: ${error.message}`); });
  let entry = (Array.isArray(index?.parts) ? index.parts : []).find((p) => p?.id === ref.id);
  if (!entry && ref.version) {
    const retired = await getJson(`${base}/parts/${ref.id}/${ref.version}/part.json`, { fetch, max: LIMITS.json, what: 'the previously sold release' });
    if (retired.sale) entry = { ...retired, versions: [ref.version] };
  }
  if (!entry) {
    const names = (Array.isArray(index?.parts) ? index.parts : []).map((p) => p?.id).filter(Boolean);
    throw new Error(`${ref.host} does not share a part "${ref.id}"${names.length ? ` (it shares: ${names.slice(0, 12).join(', ')})` : ' (it shares none)'}. A part its studio keeps private is not there to add.`);
  }
  const versions = (Array.isArray(entry.versions) ? entry.versions : [entry.version]).filter(isVersion).sort(compareVersions);
  const version = ref.version ?? (isVersion(entry.version) ? entry.version : versions.at(-1));
  if (!version || !versions.includes(version)) throw new Error(`${ref.ref} has no version ${ref.version ?? '(none listed)'}; it has ${versions.join(', ') || 'none'}`);
  const at = `${base}/parts/${ref.id}/${version}/`;
  const part = await getJson(`${at}part.json`, { fetch, max: LIMITS.json, what: 'the part\'s part.json' });
  const shape = checkPart(part);
  if (!shape.ok) throw new Error(`${ref.ref} ${version} is not a part this toolkit can read: ${shape.problems.filter((p) => p.level === 'refuse').map((p) => `${p.field}: ${p.problem}`).slice(0, 3).join('; ')}`);
  if (part.id !== ref.id || part.version !== version) throw new Error(`${at}part.json says it is ${part.id} ${part.version}, not ${ref.id} ${version}`);
  if (part.share !== true) throw new Error(`${ref.ref} is not shared`);
  if (!Array.isArray(part.files) || !part.files.length) throw new Error(`${ref.ref} ${version} lists no files`);
  const access = part.sale ? (onPaid ? await onPaid(ref, part, entry.releases?.find((r) => r.version === version)?.offer ?? part.sale) : null) : null;
  if (part.sale && !access) throw new Error(`This is a paid part: ${priceWords(part.sale)}. Use part_add to review its price first.`);
  const files = new Map();
  let total = 0;
  for (const f of part.files) {
    const delivered = access?.files?.find((item) => item.path === f.path);
    const bytes = delivered ? Buffer.from(delivered.data, 'base64') : await get(`${at}${f.path.split('/').map(encodeURIComponent).join('/')}`, { fetch, max: Math.min(LIMITS.fileBytes, f.bytes), what: f.path, authorization: access?.token });
    if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256) throw new Error(`${ref.ref} ${version}: ${f.path} is not the file its part.json describes (its SHA-256 or size differs). Nothing was written; tell its studio.`);
    total += bytes.length;
    if (total > LIMITS.totalBytes) throw new Error(`${ref.ref} is over ${Math.round(LIMITS.totalBytes / 1048576)} MB`);
    files.set(f.path, bytes);
  }
  return { ref, part, files, entry, base, version, versions, access };
}

/* ------------------------------------------------------------------ packages: npm's */

/** npm, in the studio folder: { status, stdout, stderr }. The one place npm is run (tests pass their own). */
export function runNpm(args, { cwd }) {
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024, shell: process.platform === 'win32' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? String(r.error.message) : '') };
}
const pinnedIn = (root, name) => {
  try { const p = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); return p.dependencies?.[name] ?? p.devDependencies?.[name] ?? null; } catch { return null; }
};
/** The packages a set of parts builds on: [{ name, range, by }] (one row per part that asks; npm judges each). */
export function wantedPackages(items) {
  const out = [];
  for (const x of items) for (const [name, range] of Object.entries(isObj(x.part?.requires?.packages) ? x.part.requires.packages : {})) out.push({ name, range, by: x.ref });
  return out;
}

/**
 * What npm says about each wanted package, and (with `install`) npm installing what is missing.
 *
 *   ok        `npm ls <name>@<range>` found it: nothing to do
 *   pinned    the studio's package.json already names the package and npm says that version does not fit: explained,
 *             and NOTHING is changed (a studio's pin is its own; moving it is the person's call)
 *   installed npm installed it (pinned exactly, as studios pin); `said` is npm's own output
 *   failed    npm could not; `said` is npm's own error, as it printed it
 *   missing   not installed and not asked to (`install: false`, or --no-install): `command` installs it
 *
 * `say` gets one plain line BEFORE anything is installed: what, and which part it is for.
 */
export function ensurePackages(root, wants, { npm = runNpm, install = false, say = () => {} } = {}) {
  const rows = [];
  for (const w of wants) {
    const spec = `${w.name}@${w.range}`;
    const ls = npm(['ls', spec, '--depth=0'], { cwd: root });
    if (ls.status === 0) { rows.push({ ...w, state: 'ok' }); continue; }
    const pinned = pinnedIn(root, w.name);
    if (pinned) { rows.push({ ...w, state: 'pinned', has: pinned, why: `${w.by} is built on ${w.name} ${w.range}; this studio's package.json has ${w.name} at ${pinned}, which npm says does not fit. Nothing was changed: move the studio to a version in that range if the part is worth it, or use a part written against ${pinned}.` }); continue; }
    const command = `npm install --ignore-scripts --save-exact ${spec}`;
    if (!install) { rows.push({ ...w, state: 'missing', command, why: `${w.by} is built on ${w.name} ${w.range}, which this studio does not have.` }); continue; }
    say(`Installing ${spec} from npm: ${w.by} is built on it.`);
    const r = npm(['install', '--ignore-scripts', '--save-exact', spec], { cwd: root });
    const said = `${r.stdout}${r.stderr}`.trim();
    rows.push(r.status === 0 ? { ...w, state: 'installed', said } : { ...w, state: 'failed', said, command, why: `npm could not install ${spec} for ${w.by}. npm said:\n${said}` });
  }
  return rows;
}

/* ------------------------------------------------------------------ what a game is, to a licence */

/** What a part's licence can care about in the game using it: whether the studio sells, and who the game credits. */
export function gameFacts(root, id) {
  let g = {}; let credits = {};
  try { g = JSON.parse(readFileSync(experienceFile(root, id), 'utf8')); } catch { g = {}; }
  try { credits = JSON.parse(readFileSync(join(experienceDir(root, id), 'credits.json'), 'utf8')); } catch { credits = {}; }
  return { id, name: g.name ?? id, sells: existsSync(join(root, 'shop.json')), credits: Array.isArray(credits.parts) ? credits.parts : [] };
}

/** The studio's parts as licenceIssues() takes them: its own, and the ones it brought in (with what was changed locally). */
export function partItems(root, { game = null, refs = null } = {}) {
  const lock = readOrigins(root);
  const items = [];
  for (const [ref, e] of Object.entries(lock.parts)) {
    if (refs ? !refs.includes(ref) : game && !(e.games ?? []).includes(game)) continue;
    const dir = vendorDir(root, ref);
    let part = null;
    try { part = readPart(dir); } catch { part = null; }
    items.push({ ref, part, vendored: true, purchase: e.purchase ? { ...(e.purchases?.[game] ?? e.purchase), ...purchaseFacts(root, ref, game) } : null, changed: part ? verifyFiles(dir, { files: e.files }, { skipTuning: true }).changed : [] });
  }
  for (const o of listOwnParts(root)) if (refs ? refs.includes(o.id) : !game) items.push({ ref: o.id, part: o.part, vendored: false });
  return items;
}

/* ------------------------------------------------------------------ add (and the newer version) */

const diffFiles = (was, now) => {
  const a = new Map((was ?? []).map((f) => [f.path, f.sha256])); const b = new Map((now ?? []).map((f) => [f.path, f.sha256]));
  return { added: [...b.keys()].filter((p) => !a.has(p)), removed: [...a.keys()].filter((p) => !b.has(p)), changed: [...b.keys()].filter((p) => a.has(p) && a.get(p) !== b.get(p)) };
};

/**
 * Adding a part (`<host>/<id>[@version]`, for a game), and the same call for a part already here: the newer
 * version, with what changed shown.
 *
 * Order matters and is the safety: fetch and verify everything; refuse to replace a file the studio edited unless
 * told to (`overwrite`); only then write. tuning.json is the studio's from the first add and is never replaced: a
 * new version's defaults land beside it as tuning.upstream.json.
 */
export async function addPart(root, refText, { game = null, fetch, npm = runNpm, install = true, overwrite = false, say = () => {}, approve = null, quantity = 1, offline = false, wallet, walletPay } = {}) {
  const command = 'parts add';
  const fail = (why, extra = {}) => ({ ok: false, command, why, ...extra });
  if (game && !existsSync(experienceFile(root, game))) return fail(`there is no game "${game}" in this studio (${listGames(root).map((g) => g.id).join(', ') || 'it has none yet'})`);
  let got;
  try {
    got = offline ? await offlinePurchase(root, refText, game) : await fetchPart(refText, { fetch, onPaid: (ref, part, offer) => paidAccess(root, ref, part, { game, quantity, approve, fetch, offer, wallet, walletPay }) });
    if (got.access) {
      savePurchaseBackup(root, got, got.access, game);
      const c = got.access.claims;
      got.purchase = { version: c.version, mode: c.mode, scope: c.terms.scope, game: c.game, quantity: c.quantity, paidUntil: c.paidUntil, onExpiry: c.onExpiry, onRefund: c.onRefund, status: 'paid', checkedAt: new Date().toISOString() };
    }
  } catch (error) { return fail(error.message, error.purchase ? { purchase: error.purchase } : {}); }
  const { ref, part, files, version, base, entry } = got;
  const lock = readOrigins(root);
  const was = lock.parts[ref.ref] ?? null;
  const dir = vendorDir(root, ref.ref);
  const here = was && existsSync(dir);
  // What the studio changed in its copy (tuning.json is meant to be changed and is never in this list).
  const edited = here ? verifyFiles(dir, { files: was.files }, { skipTuning: true }) : { changed: [], missing: [] };
  const changes = here ? diffFiles(was.files, part.files) : null;
  const same = here && was.version === version && !changes.added.length && !changes.removed.length && !changes.changed.length;
  if (here && !same && edited.changed.length && !overwrite) {
    return fail(`${ref.ref} ${was.version} has files this studio edited: ${edited.changed.join(', ')}. Version ${version} would replace them, so nothing was changed. Keep your edits by moving them into tuning.json (which an update never touches) or into the game; or ask to replace them (overwrite).`, { ref: ref.ref, from: was.version, to: version, edited: edited.changed, changes });
  }
  if (!same) {
    for (const p of changes?.removed ?? []) if (p !== TUNING_FILE) rmSync(join(dir, p), { force: true });
    for (const [path, bytes] of files) {
      const dest = join(dir, path);
      mkdirSync(dirname(dest), { recursive: true });
      if (path === TUNING_FILE && existsSync(dest)) { if (!readFileSync(dest).equals(bytes)) writeFileSync(join(dir, TUNING_UPSTREAM), bytes); else rmSync(join(dir, TUNING_UPSTREAM), { force: true }); continue; }
      writeFileSync(dest, bytes);
    }
    writePart(dir, part);
  }
  const games = [...new Set([...(was?.games ?? []), ...(game ? [game] : [])])].sort();
  const from = isObj(entry.from) ? { game: line(entry.from.game, 40) || null, name: line(entry.from.name, 80) || null, studio: line(entry.from.studio, 80) || null, page: /^https:\/\//.test(String(entry.from.page ?? '')) ? String(entry.from.page).slice(0, 300) : null } : isObj(part.from) ? { game: part.from.game ?? null, studio: line(part.from.studio, 80) || null } : null;
  lock.parts[ref.ref] = {
    ...(got.purchase ? { purchase: got.purchase, purchases: { ...(was?.purchases ?? {}), ...(got.purchase.scope === 'game' ? { [game]: got.purchase } : {}) } } : {}),
    version, url: `${base}/parts/${ref.id}/${version}/`, license: part.license ?? null, attribution: part.attribution ?? '', name: part.name, kind: part.kind,
    ...(from ? { from } : {}), page: `${base}/parts/${ref.id}/`, studio: line(got.entry?.studio?.name, 80) || null,
    files: part.files.map(({ path, sha256: h, bytes }) => ({ path, sha256: h, bytes })), games, addedAt: was?.addedAt ?? new Date().toISOString(), ...(was && !same ? { updatedAt: new Date().toISOString() } : {}),
  };
  writeOrigins(root, lock);
  const credits = games.map((g) => syncPartCredits(root, g, lock)).filter(Boolean);
  // Packages: npm judges, npm installs, npm's words are relayed.
  const packages = ensurePackages(root, wantedPackages([{ ref: ref.ref, part }]), { npm, install, say });
  // Other parts it names: named, with what adds each. Nothing is solved or fetched for them.
  const needs = requiredParts(part).parts.filter((d) => !lock.parts[d.ref]).map((d) => ({ ...d, add: `homie-studio parts add ${d.ref}${game ? ` --game ${game}` : ''}` }));
  const lic = licenseOfPart(part.license);
  const licences = game ? licenceIssues(partItems(root, { game }), { game: gameFacts(root, game) }) : licenceIssues(partItems(root, { refs: [ref.ref] }));
  const blocked = packages.filter((p) => p.state === 'pinned' || p.state === 'failed');
  return {
    ok: true, command, ref: ref.ref, id: ref.id, host: ref.host, version, name: part.name, kind: part.kind, dir: `parts/_vendor/${ref.host.replace(':', '_')}/${ref.id}`,
    ...(here ? { was: was.version, same, changes, replaced: same ? [] : edited.changed } : {}),
    license: lic?.id ?? null, asks: lic?.asks ?? null, attribution: part.attribution ?? '', ...(from ? { from } : {}),
    files: part.files.length, bytes: part.files.reduce((n, f) => n + f.bytes, 0), verified: true,
    entry: part.entry ?? null, import: part.entry ? `@parts/${ref.ref}` : null, game, credits,
    packages, needs, licences, ...(got.purchase ? { purchase: got.purchase } : {}),
    ready: !blocked.length && !packages.some((p) => p.state === 'missing') && !needs.length && !licences.some((c) => c.level === 'conflict'),
  };
}

/* ------------------------------------------------------------------ list, check, share */

/** `parts check [<id>] [--write]`: each of the studio's parts against the format, its hashes and the rights of every file; and each brought-in part against what was fetched. */
export function checkParts(root, id = null, { write = false } = {}) {
  const records = assetRecords(root);
  const own = listOwnParts(root).filter((o) => !id || o.id === id);
  if (id && !own.length && !existsSync(partDir(root, id))) return { ok: false, command: 'parts check', why: `there is no part "${id}" in parts/ (${listOwnParts(root).map((o) => o.id).join(', ') || 'none yet'})` };
  const rows = [];
  for (const o of own) {
    if (!o.part) { rows.push({ id: o.id, ok: false, problems: [{ level: 'refuse', field: 'part.json', problem: o.error, fix: null }], shareable: false, sharing: [] }); continue; }
    const part = write ? writeHashes(o.dir) : o.part;
    const shape = checkPart(part, { id: o.id });
    const v = verifyFiles(o.dir, part);
    const problems = [...shape.problems];
    if (!v.ok) problems.push({ level: 'refuse', field: 'files', problem: `the files differ from the hashes (${[...v.changed.map((p) => `${p} changed`), ...v.missing.map((p) => `${p} is missing`), ...v.extra.map((p) => `${p} is not listed`)].slice(0, 6).join('; ')})`, fix: 'checking the part rewrites them (part_share with nothing to change)' });
    const sharing = shareProblems(part, { dir: o.dir, records });
    rows.push({ id: o.id, version: part.version, share: part.share === true, ok: !problems.some((p) => p.level === 'refuse'), problems, shareable: !sharing.length, sharing, files: (part.files ?? []).length });
  }
  const lock = readOrigins(root);
  const brought = id ? [] : Object.entries(lock.parts).map(([ref, e]) => {
    const dir = vendorDir(root, ref);
    if (!existsSync(dir)) return { ref, ok: false, problem: 'its files are gone from parts/_vendor', fix: `add it again: homie-studio parts add ${ref}@${e.version}` };
    const v = verifyFiles(dir, { files: e.files }, { skipTuning: true });
    return { ref, version: e.version, ok: !v.missing.length, edited: v.changed, missing: v.missing, ...(v.changed.length ? { note: 'edited here: a newer version will not replace them without being told to' } : {}) };
  });
  return { ok: rows.every((r) => r.ok) && brought.every((b) => b.ok), command: 'parts check', rows, brought, wrote: write };
}

/**
 * Sharing a part, or stopping. Sharing checks everything, packs this version and sets `share`; nothing is uploaded:
 * it is LIVE AFTER THE STUDIO'S NEXT DEPLOY, and every answer says so.
 */
export function sharePart(root, id, on = true) {
  const dir = partDir(root, id);
  const command = on ? 'parts share' : 'parts unshare';
  if (!existsSync(join(dir, 'part.json'))) return { ok: false, command, why: `there is no part "${id}" in parts/ (${listOwnParts(root).map((o) => o.id).join(', ') || 'none yet'}). A part brought in from another studio is theirs to share.` };
  if (!on) {
    const part = readPart(dir);
    const was = part.share === true;
    part.share = false;
    writePart(dir, part);
    for (const v of packedVersions(root, id)) { const d = packedDir(root, id, v); const p = readPart(d); p.share = false; writePart(d, p); }
    return { ok: true, command, id, share: false, was, effect: was ? 'It stays public until the studio\'s next deploy; from that deploy on it is gone from the site and the hub. Copies other studios already made stay theirs under the licence it was shared with.' : 'It was already private.' };
  }
  const part = writeHashes(dir);
  const problems = shareProblems(part, { dir, records: assetRecords(root) });
  if (problems.length) return { ok: false, command, id, why: `parts/${id} cannot be shared yet:\n${problems.map((p) => `  ${p.field}: ${p.problem}${p.fix ? `\n      ${p.fix}` : ''}`).join('\n')}`, problems };
  part.share = true;
  writePart(dir, part);
  const packed = packPart(root, id);
  if (!packed.ok) { part.share = false; writePart(dir, part); return { ...packed, command }; }
  const lic = licenseOfPart(part.license);
  return { ok: true, command, id, share: true, version: part.version, license: lic.id, asks: lic.asks, files: part.files.length, bytes: part.cost?.bytes ?? 0, ...(part.from ? { from: part.from } : {}), effect: 'It is live after the studio\'s next deploy, not before: nothing was uploaded now. Sharing a part does not list the studio in the directory.' };
}

/* ------------------------------------------------------------------ find */

const row = (p, extra) => ({
  id: p.id, name: p.name, kind: p.kind, version: p.version, summary: line(p.summary), license: p.license || null, tags: Array.isArray(p.tags) ? p.tags.slice(0, 12) : [],
  ...(Array.isArray(p.uses) ? { uses: p.uses } : {}),
  from: isObj(p.from) ? { ...(p.from.kind ? { kind: p.from.kind, id: p.from.id ?? null } : {}), ...(p.from.app ? { app: p.from.app, open: p.from.open ?? null } : {}), ...(p.from.music ? { music: p.from.music } : {}), ...(p.from.video ? { video: p.from.video } : {}), game: p.from.game ?? null, name: p.from.name ?? null, studio: p.from.studio ?? null, play: p.from.play ?? null } : null,
  sale: p.sale ?? null, price: priceWords(p.sale), purchaseRequired: Boolean(p.sale), licenseTerms: p.licenseTerms ?? null, quality: p.quality ?? null, checkedAt: p.checkedAt ?? null, available: p.available ?? null, cost: isObj(p.cost) ? p.cost : {}, requires: isObj(p.requires) ? p.requires : {}, rig: p.skeleton?.rig ?? null, netplay: p.contract?.netplay ?? null, ...extra,
});
function matches(p, { words, kind, tag, license, builds }) {
  if (kind && p.kind !== kind) return false;
  if (tag && !(p.tags ?? []).includes(tag)) return false;
  if (license && String(p.license ?? '').toLowerCase() !== String(license).toLowerCase()) return false;
  // What a part builds on: a package it names, or the skeleton it is made for.
  if (builds && !(Object.keys(p.requires?.packages && typeof p.requires.packages === 'object' ? p.requires.packages : {}).includes(builds) || p.rig === builds)) return false;
  const hay = [p.id, p.name, p.kind, p.summary, ...(p.tags ?? []), p.from?.name, p.from?.game, p.from?.app, p.from?.music, p.from?.video, ...(p.uses ?? []), p.from?.studio].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * Finding parts (words, and kind, tag, licence, what a part builds on): the hub's catalogue of parts studios shared, and this
 * studio's own and brought-in parts. Packages are not parts and are not listed.
 *
 * A HUB THAT CANNOT BE REACHED IS SAID, NEVER HIDDEN: `hub.ok` is false with why, and the studio's own results still
 * come back, so an empty list is never mistaken for "nothing exists".
 */
export async function findParts(root, query = '', { kind = null, tag = null, license = null, builds = null, fetch, hub = null } = {}) {
  const words = String(query ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8);
  const filter = { words, kind, tag, license, builds };
  const here = [];
  if (root) {
    for (const o of listOwnParts(root)) if (o.part) here.push(row(o.part, { where: 'own', share: o.part.share === true, import: o.part.entry ? `@parts/${o.id}` : null, say: `It is this studio's own part: import it from '@parts/${o.id}'.` }));
    for (const [ref, e] of Object.entries(readOrigins(root).parts)) {
      let part = null;
      try { part = readPart(vendorDir(root, ref)); } catch { part = null; }
      if (part) here.push(row({ ...part, from: e.from ?? part.from }, { where: 'here', ref, add: ref, import: part.entry ? `@parts/${ref}` : null, games: e.games ?? [], say: `Already in this studio (${e.version}): import it from '@parts/${ref}'.` }));
    }
  }
  let base = hub;
  if (!base && root) { try { const d = readStudio(root).homie?.directory; base = d === false || d === null ? null : d; } catch { base = null; } }
  base = /^https?:\/\/[a-z0-9.:-]+$/i.test(String(base ?? '')) ? base : HUB;
  const url = `${base}/parts/index.json`;
  let hubState; let found = [];
  try {
    const index = await getJson(url, { fetch, what: 'the catalogue of shared parts' });
    if (!Array.isArray(index?.parts)) throw new Error(`${url} is not a parts catalogue`);
    const have = new Set(here.filter((h) => h.where === 'here').map((h) => h.ref));
    found = index.parts.filter((p) => isObj(p) && typeof p.id === 'string' && (typeof p.host === 'string' || typeof p.add === 'string')).map((p) => {
      const ref = parseRef(typeof p.add === 'string' ? p.add : `${p.host}/${p.id}`)?.ref;
      return ref ? row(p, { where: 'hub', ref, add: ref, studio: line(p.studio?.name, 80) || null, page: /^https:\/\//.test(String(p.page ?? '')) ? p.page : null, here: have.has(ref), say: `${p.sale ? `Paid: ${priceWords(p.sale)}. Ask for approval of the exact quote before requesting payment. ` : 'Free. '}Add it: part_add { "part": "${ref}" }.` }) : null;
    }).filter(Boolean);
    hubState = { ok: true, url, parts: found.length };
  } catch (error) {
    hubState = { ok: false, url, why: `The catalogue of shared parts could not be read just now (${error.message}). This is NOT "no parts exist": only this studio's own parts were searched. Try again, or add a part straight from a studio you know (part_add with "<studio site>/<part id>").` };
  }
  const results = [...here.filter((p) => matches(p, filter)), ...found.filter((p) => !p.here && matches(p, filter))];
  for (const p of results) {
    p.relevance = words.reduce((n, w) => n + (String(p.name ?? '').toLowerCase().includes(w) ? 3 : 0) + (String(p.id).includes(w) ? 2 : 0) + (String(p.summary ?? '').toLowerCase().includes(w) ? 1 : 0), 0);
    p.availability = p.available === false ? 'unavailable' : p.where === 'hub' && (!Number.isFinite(Date.parse(p.checkedAt)) || Date.parse(p.checkedAt) > Date.now() + 300000 || Date.now() - Date.parse(p.checkedAt) > 86400000) ? 'stale: verify with seller' : 'recently checked';
    p.qualityMeaning = 'Seller-attested purchases are not independent payment verification; quality is informational and does not change ranking.';
  }
  results.sort((a, b) => b.relevance - a.relevance || (a.where === 'hub') - (b.where === 'hub') || Boolean(a.sale) - Boolean(b.sale) || String(a.ref ?? a.id).localeCompare(String(b.ref ?? b.id)));
  for (const p of results) p.ranking = 'Text relevance first (name 3, id 2, summary 1 per matching word); ties: local first, then free before paid, then reference. Quality is informational.';
  return { ok: true, command: 'parts find', query: words.join(' '), filter: { kind, tag, license, builds }, hub: hubState, results, searched: { hub: found.length, here: here.length } };
}
