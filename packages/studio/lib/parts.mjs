/**
 * GAME PARTS: THE FORMAT AND ITS CHECKER (parts/PARTS.md is the design; this file holds it to its word).
 *
 * Games build on each other by sharing parts: a piece of a game its studio chooses to share (a creature, a level, a
 * bot brain), in whatever form suits the piece: code, assets, data, a JSON description, a tuned config, or a mix. It
 * is `parts/<id>/part.json` and the files beside it. A part is a piece of a game, never the whole game.
 *
 *   checkPart()        the shape of a part.json, each problem in plain words with its fix
 *   hashDir()          every file of a part with its SHA-256 and size (node:crypto): written by the tool, never by hand
 *   newPart()          a part lifted out of one of the studio's games (the game still builds and plays the same)
 *   fileRights()       whose each file is: its own record, a game's asset record of the same bytes, or the part's provenance
 *   shareProblems()    why a part cannot be shared (no SPDX licence, credit owed and none named, a file of unknown rights)
 *   packPart()         this version's exact bytes frozen in parts/_packed/<id>/<version>/: a shared version never changes
 *   sharedPartsOf()    THE one answer to "what does this studio share": the site, the well-known file and the hub read it
 *   licenceIssues()    the licences of the parts a game uses, and where they cannot be combined
 *
 * PRIVATE UNTIL SHARED: `share` defaults to false and is each part's own switch; nothing else decides it.
 * NOTHING HERE IS A PACKAGE MANAGER: packages are npm's (lib/parts-store.mjs hands them to npm), and a part is copied
 * in and then the studio's own. There are no version ranges, no resolver and no lockfile of Homie's.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const PART_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const PART_KINDS = Object.freeze(['character', 'rig', 'clips', 'environment', 'effect', 'sound', 'ui', 'mechanic', 'shader', 'level-generator', 'bot-brain', 'audio-pack', 'set-piece']);
export const NETPLAY_KINDS = Object.freeze(['host-authoritative', 'replicated', 'local']);
export const PROVENANCE = Object.freeze(['original', 'generated', 'imported']);
export const PIVOTS = Object.freeze(['feet', 'centre', 'base', 'origin']);
export const PARTS_DIR = 'parts';
export const PACKED_DIR = '_packed';
export const VENDOR_DIR = '_vendor';
/** Where each brought-in part came from: a record, not a lock (nothing is resolved against it). */
export const ORIGINS_FILE = 'origins.json';
/** The one file of a part that belongs to whoever uses it: an update never overwrites it. */
export const TUNING_FILE = 'tuning.json';
export const TUNING_UPSTREAM = 'tuning.upstream.json';
/** Workers serves no asset over 25 MiB, so no part file may be; the rest keeps a part something a phone can fetch. */
export const LIMITS = Object.freeze({ fileBytes: 25 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, files: 400, json: 256 * 1024 });

const clean = (s, n = 300) => (typeof s === 'string' ? s.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, n) : '');
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/* ------------------------------------------------------------------ versions and ranges */

const VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-[0-9A-Za-z.-]{1,40})?$/;
export const isVersion = (v) => VERSION.test(String(v ?? ''));
const nums = (v) => { const m = VERSION.exec(String(v ?? '')); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
/** -1, 0 or 1; a version that is not one sorts below every version. A pre-release tag is not ordered (1.0.0-a = 1.0.0). */
export function compareVersions(a, b) {
  const x = nums(a) ?? [-1, -1, -1]; const y = nums(b) ?? [-1, -1, -1];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
export function bumpVersion(v, level = 'patch') {
  const n = nums(v);
  if (!n) throw new Error(`"${v}" is not a version (1.0.0)`);
  return level === 'major' ? `${n[0] + 1}.0.0` : level === 'minor' ? `${n[0]}.${n[1] + 1}.0` : `${n[0]}.${n[1]}.${n[2] + 1}`;
}

/* ------------------------------------------------------------------ licences */

/**
 * The SPDX identifiers the toolkit can reason about, by what each asks of a game that uses the part. Anything else
 * well-formed is accepted and reported as one a person has to read: it never passes silently as compatible.
 */
const CLASSES = {
  'public-domain': { ids: ['CC0-1.0', 'Unlicense', '0BSD'], credit: false, asks: 'nothing' },
  permissive: { ids: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Zlib', 'CC-BY-4.0', 'CC-BY-3.0', 'OFL-1.1'], credit: true, asks: 'credit' },
  'weak-copyleft': { ids: ['MPL-2.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later'], credit: true, asks: 'credit, and changes to the part\'s own files stay open' },
  'share-alike': { ids: ['CC-BY-SA-4.0', 'CC-BY-SA-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later', 'AGPL-3.0-only', 'AGPL-3.0-or-later'], credit: true, asks: 'credit, and the combined game is offered under the same terms' },
  'non-commercial': { ids: ['CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0'], credit: true, asks: 'credit, and no game that sells anything' },
  'no-derivatives': { ids: ['CC-BY-ND-4.0', 'CC-BY-NC-ND-4.0'], credit: true, asks: 'credit, and the part is used unchanged' },
};
const SPDX_SHAPE = /^(?:LicenseRef-[A-Za-z0-9.-]{1,60}|[A-Za-z0-9][A-Za-z0-9.+-]{0,63})$/;
/** Words people write that are not SPDX identifiers, with the one they most likely mean. */
const NOT_SPDX = { cc0: 'CC0-1.0', 'cc-by': 'CC-BY-4.0', 'cc-by-4.0': 'CC-BY-4.0', apache: 'Apache-2.0', 'apache 2.0': 'Apache-2.0', bsd: 'BSD-3-Clause', gpl: 'GPL-3.0-only', own: null, proprietary: null, 'all rights reserved': null, none: null };
/** { id, class, credit, asks, known } for an SPDX identifier; null when the value is not one. */
export function licenseOfPart(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  // Not an identifier at all; a word people write instead of one (cc0, proprietary); or a real
  // identifier in the wrong case (SPDX is case-sensitive, and "mit" must not pass as some unknown licence).
  if (!id || !SPDX_SHAPE.test(id)) return null;
  const cased = Object.values(CLASSES).flatMap((c) => c.ids).find((k) => k.toLowerCase() === id.toLowerCase());
  if (cased ? cased !== id : Object.hasOwn(NOT_SPDX, id.toLowerCase())) return null;
  for (const [name, c] of Object.entries(CLASSES)) if (c.ids.includes(id)) return { id, class: name, credit: c.credit, asks: c.asks, known: true };
  // NC and ND are read off the identifier even for a version the table does not list (CC-BY-NC-3.0).
  const guess = /-NC(-|$)/.test(id) ? 'non-commercial' : /-ND(-|$)/.test(id) ? 'no-derivatives' : null;
  return { id, class: guess ?? 'unrecognised', credit: true, asks: guess ? CLASSES[guess].asks : 'something the toolkit cannot reason about: read the licence yourself', known: false };
}
/** What to say about a licence value that is not an SPDX identifier. */
function licenceHint(value) {
  const v = String(value ?? '').trim();
  if (!v) return 'name one: an SPDX identifier such as CC0-1.0, CC-BY-4.0, MIT or Apache-2.0';
  const meant = NOT_SPDX[v.toLowerCase()];
  const cased = Object.values(CLASSES).flatMap((c) => c.ids).find((k) => k.toLowerCase() === v.toLowerCase());
  if (cased) return `SPDX identifiers are case-sensitive: write "${cased}"`;
  if (meant) return `"${v}" is not an SPDX identifier: write "${meant}"`;
  if (Object.hasOwn(NOT_SPDX, v.toLowerCase())) return `"${v}" tells a stranger nothing they can rely on; a shared part needs an SPDX identifier (CC0-1.0, CC-BY-4.0, MIT, Apache-2.0, …)`;
  return `"${v.slice(0, 40)}" is not an SPDX identifier (CC0-1.0, CC-BY-4.0, MIT, Apache-2.0, …)`;
}

/* ------------------------------------------------------------------ files and hashes */

/** A file's path inside a part: forward slashes, no dot segments, nothing a file system could read as elsewhere. */
export function safePath(p) {
  const s = String(p ?? '');
  if (!s || s.length > 200 || s.startsWith('/') || s.includes('\\') || s.includes('\0')) return false;
  const segs = s.split('/');
  return segs.length <= 8 && segs.every((x) => /^[A-Za-z0-9_][A-Za-z0-9._ @+-]{0,79}$/.test(x) && x !== '..' && !x.endsWith('.'));
}
/** Never part of a part: its own description, the upstream tuning an update leaves, anything hidden, dependencies. */
const skipName = (name, rel) => name.startsWith('.') || name === 'node_modules' || (!rel && (name === 'part.json' || name === TUNING_UPSTREAM));

/** Every file under a part's folder as [{ path, sha256, bytes }], sorted. Throws on a link or a path that is not safe. */
export function hashDir(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (skipName(e.name, rel)) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) throw new Error(`${path} is a link; a part holds real files only`);
      if (e.isDirectory()) walk(path);
      else if (e.isFile()) {
        if (!safePath(path)) throw new Error(`"${path}" is not a file name a part can carry (letters, digits, . _ - + @ and spaces; no leading dot)`);
        const bytes = readFileSync(join(dir, path));
        out.push({ path, sha256: sha256(bytes), bytes: bytes.length });
      }
    }
  };
  walk('');
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The files on disk against the part's `files`: { ok, changed, missing, extra }. `skipTuning`: a brought-in part's
 * tuning.json is its user's to change, so it is not compared.
 */
export function verifyFiles(dir, part, { skipTuning = false } = {}) {
  const have = new Map(hashDir(dir).map((f) => [f.path, f]));
  const want = new Map((Array.isArray(part.files) ? part.files : []).map((f) => [f.path, f]));
  const changed = []; const missing = []; const extra = [];
  for (const [path, f] of want) {
    if (skipTuning && path === TUNING_FILE) continue;
    const h = have.get(path);
    if (!h) missing.push(path);
    else if (h.sha256 !== f.sha256 || h.bytes !== f.bytes) changed.push(path);
  }
  for (const path of have.keys()) if (!want.has(path) && !(skipTuning && path === TUNING_FILE)) extra.push(path);
  return { ok: !changed.length && !missing.length && !extra.length, changed, missing, extra };
}

/* ------------------------------------------------------------------ reading and writing */

export const partsRoot = (root) => join(root, PARTS_DIR);
export const partDir = (root, id) => join(root, PARTS_DIR, id);

export function readPart(dir) {
  const file = join(dir, 'part.json');
  if (!existsSync(file)) throw new Error(`no part.json in ${dir}`);
  let part;
  try { part = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { throw new Error(`${file} is not JSON: ${error.message}`); }
  if (!isObj(part)) throw new Error(`${file} is not a part (an object)`);
  return part;
}
export function writePart(dir, part) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'part.json');
  writeFileSync(`${file}.tmp`, `${JSON.stringify(part, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
  return part;
}

/** The studio's own parts: parts/<id>/part.json (folders starting with _ are the tool's: packed versions, brought-in parts). */
export function listOwnParts(root) {
  const dir = partsRoot(root);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.') || !existsSync(join(dir, e.name, 'part.json'))) continue;
    try { out.push({ id: e.name, dir: join(dir, e.name), part: readPart(join(dir, e.name)) }); } catch (error) { out.push({ id: e.name, dir: join(dir, e.name), part: null, error: error.message }); }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
/** The packed versions of one of the studio's parts, oldest first. */
export function packedVersions(root, id) {
  const dir = join(partsRoot(root), PACKED_DIR, id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && isVersion(e.name) && existsSync(join(dir, e.name, 'part.json'))).map((e) => e.name).sort(compareVersions);
}
export const packedDir = (root, id, version) => join(partsRoot(root), PACKED_DIR, id, version);

/* ------------------------------------------------------------------ the shape */

/**
 * A part.json against the format: { ok, problems: [{ level: 'refuse' | 'warn', field, problem, fix }] }. `refuse`
 * is something no tool will work with; `warn` is worth a person's look. Whether it can be SHARED is shareProblems().
 */
export function checkPart(part, { id = null } = {}) {
  const problems = [];
  const bad = (field, problem, fix = null) => problems.push({ level: 'refuse', field, problem, fix });
  const warn = (field, problem, fix = null) => problems.push({ level: 'warn', field, problem, fix });
  if (!isObj(part)) return { ok: false, problems: [{ level: 'refuse', field: 'part.json', problem: 'it is not an object', fix: 'start one with part_new' }] };
  if (!PART_ID.test(String(part.id ?? ''))) bad('id', `"${String(part.id ?? '').slice(0, 60)}" is not a part id`, 'lowercase letters, digits and hyphens, starting with a letter or digit (chase-camera)');
  else if (id && part.id !== id) bad('id', `the folder is parts/${id} but part.json says "${part.id}"`, 'name them the same');
  if (!clean(part.name, 80)) bad('name', 'it has no name', 'a few words a person would search for ("Third-person chase camera")');
  if (!PART_KINDS.includes(part.kind)) bad('kind', part.kind === undefined ? 'it has no kind' : `"${String(part.kind).slice(0, 40)}" is not a kind of part`, `one of: ${PART_KINDS.join(', ')}`);
  if (!isVersion(part.version)) bad('version', part.version === undefined ? 'it has no version' : `"${String(part.version).slice(0, 40)}" is not a version`, 'three numbers: 1.0.0');
  // A part being written has no summary yet; one that is shared must (shareProblems).
  if (!clean(part.summary)) warn('summary', 'it has no summary', 'one sentence: what it does and what it needs from a game');
  else if (String(part.summary).length > 200) warn('summary', 'it is over 200 characters; lists show the first 200', 'one sentence');
  if (part.share !== undefined && typeof part.share !== 'boolean') bad('share', 'it is neither true nor false', 'false keeps the part private (the default); sharing the part sets it true');
  if (part.license !== undefined && part.license !== null && part.license !== '' && !licenseOfPart(part.license)) bad('license', 'it is not a licence a stranger can rely on', licenceHint(part.license));
  if (part.attribution !== undefined && typeof part.attribution !== 'string') bad('attribution', 'it is not text', 'the line a game using the part shows in its credits, or ""');
  if (part.tags !== undefined) {
    if (!Array.isArray(part.tags) || part.tags.some((t) => typeof t !== 'string' || !/^[a-z0-9][a-z0-9-]{0,29}$/.test(t))) bad('tags', 'a tag is not a lowercase word', 'up to 12 words such as "camera", "3d", "top-down"');
    else if (part.tags.length > 12) warn('tags', 'more than 12 tags; the first 12 are used', null);
  }
  if (part.entry !== undefined && part.entry !== null && (!safePath(part.entry) || !/\.(ts|tsx|js|mjs|jsx)$/.test(part.entry))) bad('entry', `"${String(part.entry).slice(0, 80)}" is not a module inside the part`, 'a path such as src/index.ts');
  if (part.files !== undefined) {
    if (!Array.isArray(part.files)) bad('files', 'it is not a list', 'never written by hand: checking the part rewrites it');
    else {
      if (part.files.length > LIMITS.files) bad('files', `${part.files.length} files; a part holds at most ${LIMITS.files}`, 'split it into parts that require each other');
      const seen = new Set(); let total = 0;
      for (const f of part.files) {
        if (!isObj(f) || !safePath(f.path)) { bad('files', `"${String(f?.path ?? '').slice(0, 80)}" is not a path inside the part`, 'no "..", no leading slash or dot'); continue; }
        if (seen.has(f.path)) bad('files', `${f.path} is listed twice`, 'checking the part rewrites the list');
        seen.add(f.path);
        if (!/^[a-f0-9]{64}$/.test(String(f.sha256 ?? '')) || !Number.isInteger(f.bytes) || f.bytes < 0) bad('files', `${f.path} has no SHA-256 or size`, 'checking the part writes both');
        else if (f.bytes > LIMITS.fileBytes) bad('files', `${f.path} is ${Math.round(f.bytes / 1048576)} MB; the site serves no file over 25 MB`, 'make it smaller or leave it out');
        total += Number(f.bytes) || 0;
        if (f.rights !== undefined && f.rights !== 'unknown' && !(isObj(f.rights) && licenseOfPart(f.rights.license))) bad('files', `${f.path} "rights" is neither "unknown" nor { "license": "<SPDX>" }`, licenceHint(f.rights?.license));
      }
      if (total > LIMITS.totalBytes) bad('files', `the part is ${Math.round(total / 1048576)} MB; at most 100 MB`, 'split it');
      if (part.entry && !seen.has(part.entry)) bad('entry', `${part.entry} is not one of the part's files`, 'check the path; checking the part rewrites its file list');
    }
  }
  if (part.preview !== undefined) {
    if (!isObj(part.preview)) bad('preview', 'it is not an object', '{ "page": "preview/index.html", "image": "preview/cover.jpg" }');
    else {
      if (part.preview.page != null && (!safePath(part.preview.page) || !/\.html?$/.test(part.preview.page))) bad('preview.page', 'it is not an HTML file inside the part', 'preview/index.html');
      if (part.preview.image != null && (!safePath(part.preview.image) || !/\.(png|jpe?g|webp|gif|svg)$/i.test(part.preview.image))) bad('preview.image', 'it is not a picture inside the part', 'preview/cover.jpg');
      const listed = new Set((Array.isArray(part.files) ? part.files : []).map((f) => f?.path));
      for (const k of ['page', 'image']) if (part.preview[k] && Array.isArray(part.files) && safePath(part.preview[k]) && !listed.has(part.preview[k])) bad(`preview.${k}`, `${part.preview[k]} is not one of the part's files`, 'check the path; checking the part rewrites its file list');
    }
  }
  if (part.requires !== undefined) {
    if (!isObj(part.requires)) bad('requires', 'it is not an object', '{ "packages": { "@homie-rocks/camera": "^0.2.0" }, "parts": ["other-studio.example/some-part"] }');
    else {
      const pk = part.requires.packages;
      if (pk !== undefined) {
        if (!isObj(pk)) bad('requires.packages', 'it is not an object of package name to what npm should install', '{ "@homie-rocks/camera": "^0.2.0" }');
        else for (const [name, range] of Object.entries(pk)) {
          if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) bad('requires.packages', `"${name.slice(0, 60)}" is not a package's name`, '"@homie-rocks/camera"');
          // What follows the name is npm's to read (it is handed to npm as <name>@<this>); all that is checked is that it can be nothing but a version spec.
          if (typeof range !== 'string' || !/^[0-9A-Za-z.*^~<>=| -]{1,80}$/.test(range) || range.startsWith('-')) bad('requires.packages', `${name}: "${String(range).slice(0, 40)}" is not something npm installs by`, '"^0.2.0", as package.json would say it');
        }
      }
      if (part.requires.parts !== undefined && requiredParts(part).bad.length) bad('requires.parts', `${requiredParts(part).bad.map((b) => `"${b}"`).slice(0, 3).join(', ')} does not name a part`, 'a list such as ["other-studio.example/some-part"]');
    }
  }
  if (part.physical !== undefined) {
    if (!isObj(part.physical)) bad('physical', 'it is not an object', '{ "units": "metres", "scale": 1, "pivot": "feet", "collision": "collision.json" }');
    else {
      if (part.physical.units !== undefined && part.physical.units !== 'metres') bad('physical.units', `"${String(part.physical.units).slice(0, 20)}": a part is measured in metres`, 'convert it and write "metres"');
      if (part.physical.scale !== undefined && !(Number.isFinite(part.physical.scale) && part.physical.scale > 0)) bad('physical.scale', 'it is not a number above 0', '1 when the files are already in metres');
      if (part.physical.pivot !== undefined && !PIVOTS.includes(part.physical.pivot)) bad('physical.pivot', `"${String(part.physical.pivot).slice(0, 20)}" is not a pivot`, `one of: ${PIVOTS.join(', ')}`);
      if (part.physical.collision != null && (!safePath(part.physical.collision) || !/\.json$/.test(part.physical.collision))) bad('physical.collision', 'it is not a JSON file inside the part', 'collision.json, or null for none');
    }
  }
  if (part.skeleton !== undefined) {
    if (!isObj(part.skeleton)) bad('skeleton', 'it is not an object', '{ "rig": "humanoid-v1", "clips": ["idle", "run"] }');
    else {
      if (part.skeleton.rig != null && !/^[a-z0-9][a-z0-9._-]{0,47}$/.test(String(part.skeleton.rig))) bad('skeleton.rig', 'it is not a rig name', 'a lowercase name such as "humanoid-v1"');
      if (part.skeleton.clips !== undefined && (!Array.isArray(part.skeleton.clips) || part.skeleton.clips.some((c) => typeof c !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(c)))) bad('skeleton.clips', 'it is not a list of clip names', '["idle", "run", "jump"]');
    }
  }
  if (part.contract !== undefined) {
    if (!isObj(part.contract)) bad('contract', 'it is not an object', '{ "inputs": {}, "state": {}, "netplay": "host-authoritative" }');
    else {
      for (const k of ['inputs', 'state']) if (part.contract[k] !== undefined && !isObj(part.contract[k])) bad(`contract.${k}`, 'it is not an object of name to description', '{ "position": "where the player is, in metres" }');
      if (part.contract.netplay !== undefined && !NETPLAY_KINDS.includes(part.contract.netplay)) bad('contract.netplay', `"${String(part.contract.netplay).slice(0, 40)}" is not a netplay contract`, `one of: ${NETPLAY_KINDS.join(', ')}`);
    }
  }
  if (part.kind === 'mechanic' && !NETPLAY_KINDS.includes(part.contract?.netplay)) warn('contract.netplay', 'a mechanic does not say how it behaves in a room', `${NETPLAY_KINDS.join(', ')}: another game needs to know who decides`);
  if (part.cost !== undefined) {
    if (!isObj(part.cost)) bad('cost', 'it is not an object', '{ "triangles": 0, "drawCalls": 0, "textureMB": 0, "bytes": 0, "measuredOn": "…" }');
    else for (const k of ['triangles', 'drawCalls', 'textureMB', 'bytes']) if (part.cost[k] !== undefined && !(Number.isFinite(part.cost[k]) && part.cost[k] >= 0)) bad(`cost.${k}`, 'it is not a number of 0 or more', 'leave out a cost nobody measured');
  }
  if (part.from !== undefined && part.from !== null) {
    if (!isObj(part.from) || (part.from.game != null && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(part.from.game)))) bad('from', 'it does not name the game the part came out of', '{ "game": "<the game\'s id>", "studio": "<the studio\'s name>" }');
  }
  if (part.provenance !== undefined) {
    if (!isObj(part.provenance)) bad('provenance', 'it is not an object', '{ "source": "original" }');
    else if (part.provenance.source !== undefined && !PROVENANCE.includes(part.provenance.source)) bad('provenance.source', `"${String(part.provenance.source).slice(0, 40)}" does not say where the part came from`, `one of: ${PROVENANCE.join(', ')}`);
  }
  return { ok: !problems.some((p) => p.level === 'refuse'), problems };
}

/** `<host>/<id>` (and an optional exact `@version`): { host, id, version, ref }, or null. A host is a site's name, optionally a port. */
export function parseRef(text) {
  const m = /^([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::\d{1,5})?)\/([a-z0-9][a-z0-9-]{0,47})(?:@(.{1,60}))?$/.exec(String(text ?? '').trim().replace(/^https?:\/\//, ''));
  if (!m) return null;
  if (m[3] !== undefined && !isVersion(m[3])) return null;
  return { host: m[1], id: m[2], version: m[3] ?? null, ref: `${m[1]}/${m[2]}` };
}

/**
 * The other parts a part says it needs: `requires.parts`, a plain list of "<host>/<id>". They are NAMED to the
 * person with what adds each; nothing is solved.
 */
export function requiredParts(part) {
  const raw = part?.requires?.parts;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const parts = []; const bad = [];
  for (const item of list) { const r = typeof item === 'string' ? parseRef(item) : null; if (r) parts.push({ ref: r.ref, host: r.host, id: r.id }); else bad.push(String(item).slice(0, 60)); }
  return { parts, bad };
}

/* ------------------------------------------------------------------ rights */

/**
 * Every game's asset records by the SHA-256 of the file they are about (games/<id>/assets/manifest.json, what
 * RIGHTS.md is written from): a part made from a game's model takes that model's licence record, not a guess.
 */
export function assetRecords(root) {
  const out = new Map();
  const games = join(root, 'games');
  if (!existsSync(games)) return out;
  for (const e of readdirSync(games, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    let m = null;
    try { m = JSON.parse(readFileSync(join(games, e.name, 'assets', 'manifest.json'), 'utf8')); } catch { m = null; }
    for (const a of Array.isArray(m?.assets) ? m.assets : []) for (const f of a.files ?? []) if (/^[a-f0-9]{64}$/.test(String(f.sha256 ?? ''))) out.set(f.sha256, { game: e.name, asset: a.id, kind: a.license?.kind ?? null, attribution: a.license?.attribution ?? null });
  }
  return out;
}
/** The asset-manifest licence kinds a file may be handed on under (lib/asset-manifest.mjs LICENSES, `redistribute`). */
const ASSET_SHAREABLE = new Set(['cc0', 'cc-by-4.0', 'cc-by-3.0', 'own', 'generated']);

/**
 * Whose one file is: { known, why, from }. In order: the file's own `rights`; a game's asset record of the same
 * bytes; the part's provenance. `known: false` is what stops a share.
 */
export function fileRights(part, file, records = new Map()) {
  if (file.rights === 'unknown') return { known: false, from: 'file', why: 'its rights are marked unknown' };
  if (isObj(file.rights)) return licenseOfPart(file.rights.license) ? { known: true, from: 'file', license: file.rights.license } : { known: false, from: 'file', why: 'its "rights" names no SPDX licence' };
  const rec = records.get(file.sha256);
  if (rec) {
    if (!rec.kind) return { known: false, from: 'asset', why: `it is ${rec.asset} of games/${rec.game}, which has no licence record` };
    if (!ASSET_SHAREABLE.has(rec.kind)) return { known: false, from: 'asset', why: `it is ${rec.asset} of games/${rec.game}, recorded as "${rec.kind}": that licence does not let the file be handed on` };
    return { known: true, from: 'asset', license: rec.kind };
  }
  const src = part.provenance?.source;
  if (!PROVENANCE.includes(src)) return { known: false, from: 'part', why: 'the part does not say where it came from (provenance.source)' };
  if (src === 'imported' && !clean(part.provenance.origin)) return { known: false, from: 'part', why: 'the part is imported and does not say from where (provenance.origin)' };
  return { known: true, from: 'part', license: part.license ?? null };
}

/**
 * Why a part cannot be shared, in plain words: [{ field, problem, fix }]; empty when it can. `dir` (its folder)
 * also checks the files on disk against the hashes.
 */
export function shareProblems(part, { dir = null, records = new Map() } = {}) {
  const out = [];
  const add = (field, problem, fix) => out.push({ field, problem, fix });
  const shape = checkPart(part);
  for (const p of shape.problems.filter((x) => x.level === 'refuse')) add(p.field, p.problem, p.fix);
  const lic = licenseOfPart(part.license);
  if (!clean(part.summary)) add('summary', 'it has no summary: nobody searching can tell what it is', 'one sentence: what it does and what it needs from a game');
  if (!part.license) add('license', 'it has no licence: a stranger cannot tell what they may do with it', licenceHint(''));
  else if (lic?.credit && lic.class !== 'unrecognised' && !clean(part.attribution)) add('attribution', `${lic.id} asks for credit, and the part names nobody to credit`, 'set "attribution" to the line a game should show (the studio\'s name, or who made it)');
  if (!PROVENANCE.includes(part.provenance?.source)) add('provenance.source', 'it does not say where it came from', `set provenance.source: ${PROVENANCE.join(', ')}`);
  if (!Array.isArray(part.files) || !part.files.length) add('files', 'its files are not hashed yet', 'checking the part rewrites them (part_share with nothing to change)');
  else {
    for (const f of part.files) {
      if (!isObj(f)) continue;
      const r = fileRights(part, f, records);
      if (!r.known) add('files', `${f.path}: ${r.why}`, r.from === 'asset' ? 'leave the file out of the part, or replace it with one you may share' : r.from === 'file' ? `find out, then set its "rights" to { "license": "<SPDX>" } or leave the file out` : 'say where the part came from');
    }
    if (dir) {
      const v = verifyFiles(dir, part);
      if (!v.ok) add('files', `the files differ from the hashes (${[...v.changed.map((p) => `${p} changed`), ...v.missing.map((p) => `${p} is missing`), ...v.extra.map((p) => `${p} is not listed`)].slice(0, 6).join('; ')})`, 'checking the part rewrites them (part_share with nothing to change)');
    }
  }
  return out;
}

/* ------------------------------------------------------------------ writing hashes, packing */

/** Rewrites `files` (keeping each file's own `rights`) and `cost.bytes` from what is on disk. Returns the part. */
export function writeHashes(dir) {
  const part = readPart(dir);
  const rights = new Map((Array.isArray(part.files) ? part.files : []).filter((f) => isObj(f) && f.rights !== undefined).map((f) => [f.path, f.rights]));
  part.files = hashDir(dir).map((f) => (rights.has(f.path) ? { ...f, rights: rights.get(f.path) } : f));
  part.cost = { ...(isObj(part.cost) ? part.cost : {}), bytes: part.files.reduce((n, f) => n + f.bytes, 0) };
  return writePart(dir, part);
}

/** A part.json as another studio may see it: no field whose name starts with `_`, at any depth. */
export function publicPart(part) {
  const strip = (v) => (Array.isArray(v) ? v.map(strip) : isObj(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([k, x]) => [k, strip(x)])) : v);
  return strip(part);
}

/**
 * `parts pack`: the hashes written, the part checked, and this version's exact bytes frozen in
 * parts/_packed/<id>/<version>/. A version packed before with other bytes is refused: a packed version never
 * changes, because a game somewhere locked its hashes. `bump` moves the version first.
 */
export function packPart(root, id, { bump = null } = {}) {
  const dir = partDir(root, id);
  let part = readPart(dir);
  if (bump) { part.version = bumpVersion(part.version, bump); writePart(dir, part); }
  part = writeHashes(dir);
  const shape = checkPart(part, { id });
  if (!shape.ok) return { ok: false, command: 'parts pack', id, why: `parts/${id} is not a part yet: ${shape.problems.filter((p) => p.level === 'refuse').map((p) => `${p.field}: ${p.problem}${p.fix ? ` (${p.fix})` : ''}`).slice(0, 4).join('; ')}`, problems: shape.problems };
  const out = packedDir(root, id, part.version);
  if (existsSync(out)) {
    const was = readPart(out);
    const same = JSON.stringify((was.files ?? []).map((f) => [f.path, f.sha256])) === JSON.stringify(part.files.map((f) => [f.path, f.sha256]));
    if (!same) return { ok: false, command: 'parts pack', id, version: part.version, why: `parts/${id} ${part.version} is already packed with different files, and a shared version never changes (another studio may have copied it). Give the change a new version: raise "version" in parts/${id}/part.json, then share it again.` };
    // The same bytes: only the description may have moved (a summary, `share`), so the frozen copy takes it.
    writePart(out, part);
    return { ok: true, command: 'parts pack', id, version: part.version, files: part.files.length, bytes: part.cost.bytes, already: true };
  }
  const tmp = `${out}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const f of part.files) { mkdirSync(dirname(join(tmp, f.path)), { recursive: true }); cpSync(join(dir, f.path), join(tmp, f.path)); }
  writePart(tmp, part);
  renameSync(tmp, out);
  return { ok: true, command: 'parts pack', id, version: part.version, files: part.files.length, bytes: part.cost.bytes, already: false };
}

/**
 * WHAT THIS STUDIO SHARES: the one answer, read by the build (so by the site and its well-known file, and through
 * them the hub), by the deploy plan and by the tools. A part is in it when its own `share` is true and a version of
 * it is packed; each entry is { id, versions, part } with `part` the latest packed version as another studio may
 * see it. Nothing else anywhere decides what a studio shares.
 */
export function sharedPartsOf(root) {
  const out = [];
  for (const o of listOwnParts(root)) {
    if (o.part?.share !== true) continue;
    const versions = packedVersions(root, o.id);
    if (!versions.length) continue;
    out.push({ id: o.id, versions, part: publicPart({ ...readPart(packedDir(root, o.id, versions.at(-1))), share: true }) });
  }
  return out;
}

/* ------------------------------------------------------------------ a new part */

const PREVIEW_HTML = (name) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name.replace(/[<&]/g, '')}</title>
<style>html,body{margin:0;height:100%;background:#10131a;color:#e8ecf4;font:16px/1.4 system-ui,sans-serif}main{display:grid;place-items:center;height:100%;text-align:center;padding:16px;box-sizing:border-box}</style>
</head>
<body>
<main><p>${name.replace(/[<&]/g, '')}<br><small>Show the part working here: this page is what people try before they add it. It must run as served (relative imports only).</small></p></main>
</body>
</html>
`;

const MODULE = /\.(ts|tsx|js|mjs|jsx)$/;
const RESOLVE = ['', '.ts', '.tsx', '.js', '.mjs', '.jsx', '/index.ts', '/index.js', '/index.mjs'];
/** The relative specifiers a module imports or re-exports (static, side-effect and dynamic). */
function relativeImports(text) {
  const out = new Set();
  for (const re of [/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g, /\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g, /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g]) for (const m of text.matchAll(re)) out.add(m[1]);
  return [...out];
}
const posix = (p) => p.split('\\').join('/');
function relSpec(fromFile, toFile) {
  let r = posix(relative(dirname(fromFile), toFile));
  if (!r.startsWith('.')) r = `./${r}`;
  return r;
}

/**
 * LIFTING A PART OUT OF A GAME (`parts new <id> --from <game> <paths…>`): parts are pieces of real games, so the
 * usual way to make one is to take files a game already has. The files move into parts/<id>/src/ (keeping their
 * layout under the folder they share), and each module's old path keeps a one-line module that re-exports the
 * part's, so the game builds and behaves exactly as before and now imports the part. Anything that is not a module
 * (a model, a picture, a JSON table) is copied: the game keeps its own.
 *
 * A lifted module that imports a file of the game's that is NOT being lifted is refused by name: moved, that import
 * would point nowhere, and a part that reaches back into one game is not a part another game can use.
 */
function liftPlan(root, game, paths) {
  const gdir = join(root, 'games', game);
  const files = [];
  const walk = (rel) => {
    const abs = join(gdir, rel);
    if (!existsSync(abs)) throw new Error(`games/${game}/${rel} is not there`);
    if (statSync(abs).isDirectory()) { for (const e of readdirSync(abs, { withFileTypes: true })) if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(`${rel}/${e.name}`); } else files.push(rel);
  };
  for (const raw of paths) {
    const rel = posix(String(raw)).replace(/^\.\//, '').replace(/^games\/[^/]+\//, '').replace(/\/+$/, '');
    if (!rel || rel.split('/').includes('..') || rel.startsWith('/')) throw new Error(`"${raw}" is not a path inside games/${game}`);
    walk(rel);
  }
  if (!files.length) throw new Error(`name the files of games/${game} that become the part (src/creature.ts, or a folder)`);
  // A part is a piece of a game, never the whole game: its entry, its page and its game.json stay the game's.
  let entry = 'src/main.ts';
  try { entry = JSON.parse(readFileSync(join(gdir, 'game.json'), 'utf8')).entry ?? entry; } catch { /* the default entry */ }
  const whole = files.filter((f) => f === entry || f === 'game.json' || f === 'index.html');
  if (whole.length) throw new Error(`${whole.join(', ')} ${whole.length === 1 ? 'is' : 'are'} the game itself. A part is a piece of a game, never the whole game: name the files of one piece (the creature, the level generator, the camera).`);
  // The folder they share (without a leading src/, which every part has of its own).
  const dirs = files.map((f) => f.split('/').slice(0, -1));
  let common = dirs[0];
  for (const d of dirs) { let n = 0; while (n < common.length && n < d.length && common[n] === d[n]) n++; common = common.slice(0, n); }
  const base = common.join('/');
  const to = (f) => `src/${base ? f.slice(base.length + 1) : f}`;
  const set = new Set(files);
  const outside = [];
  for (const f of files.filter((x) => MODULE.test(x))) {
    for (const spec of relativeImports(readFileSync(join(gdir, f), 'utf8'))) {
      const target = posix(join(dirname(f), spec));
      const hit = RESOLVE.map((ext) => `${target}${ext}`).find((c) => existsSync(join(gdir, c)) && statSync(join(gdir, c)).isFile());
      if (target.startsWith('..') || (hit && !set.has(hit))) outside.push(`${f} imports ${spec}`);
    }
  }
  return { gdir, files, to, outside };
}

/**
 * `parts new`: a private part with every field a sharer will need, so the gaps are visible from the first minute.
 * `from` (a game's id) with `paths` lifts those files out of the game (above); without, the part starts empty.
 */
export function newPart(root, id, { kind = 'mechanic', name = null, from = null, paths = [] } = {}) {
  if (!PART_ID.test(String(id ?? ''))) return { ok: false, command: 'parts new', why: `"${id ?? ''}" is not a part id: lowercase letters, digits and hyphens (chase-camera)` };
  if (!PART_KINDS.includes(kind)) return { ok: false, command: 'parts new', why: `"${kind}" is not a kind of part: ${PART_KINDS.join(', ')}` };
  const dir = partDir(root, id);
  if (existsSync(dir)) return { ok: false, command: 'parts new', why: `parts/${id} is there already` };
  const title = clean(name, 80) || id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  let entry = null; let lifted = null; let fromGame = null;
  if (from) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(from)) || !existsSync(join(root, 'games', from, 'game.json'))) return { ok: false, command: 'parts new', why: `there is no game "${from}" in this studio to lift a part out of` };
    let plan;
    try { plan = liftPlan(root, from, paths); } catch (error) { return { ok: false, command: 'parts new', why: error.message }; }
    if (plan.outside.length) return { ok: false, command: 'parts new', why: `These files still reach into the rest of games/${from}: ${plan.outside.slice(0, 6).join('; ')}. A part has to stand without the game: lift those files too, or pass what they provide in as an argument first. Nothing was moved.`, outside: plan.outside };
    mkdirSync(dir, { recursive: true });
    lifted = { moved: [], copied: [] };
    for (const f of plan.files) {
      const src = join(plan.gdir, f); const dest = join(dir, plan.to(f));
      mkdirSync(dirname(dest), { recursive: true });
      if (!MODULE.test(f)) { cpSync(src, dest); lifted.copied.push(f); continue; }
      const text = readFileSync(src, 'utf8');
      writeFileSync(dest, text);
      const spec = relSpec(src, dest);
      const hasDefault = /\bexport\s+default\b|\bas\s+default\b/.test(text);
      writeFileSync(src, `// This is now the "${id}" part (parts/${id}): the game imports it from there.\nexport * from '${spec}';\n${hasDefault ? `export { default } from '${spec}';\n` : ''}`);
      lifted.moved.push(f);
    }
    const mods = plan.files.filter((f) => MODULE.test(f)).map(plan.to);
    entry = mods.find((p) => /^src\/index\.[a-z]+$/.test(p)) ?? mods[0] ?? null;
    let studio = null;
    try { studio = JSON.parse(readFileSync(join(root, 'studio.json'), 'utf8')).name ?? null; } catch { studio = null; }
    fromGame = { game: from, ...(studio ? { studio: clean(studio, 80) } : {}) };
  } else {
    mkdirSync(dir, { recursive: true });
    if (['mechanic', 'ui', 'effect', 'shader', 'level-generator', 'bot-brain'].includes(kind)) {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'index.ts'), `/**\n * ${title}. What a game imports: \`import { create } from '@parts/${id}'\`.\n * Keep it free of the game's own globals: everything it needs comes in as an argument (see "contract" in part.json).\n */\nimport tuning from '../tuning.json';\n\nexport function create(options: Record<string, unknown> = {}) {\n  return { tuning: { ...tuning, ...options } };\n}\n`);
      entry = 'src/index.ts';
    }
  }
  if (!existsSync(join(dir, TUNING_FILE))) writeFileSync(join(dir, TUNING_FILE), '{}\n');
  mkdirSync(join(dir, 'preview'), { recursive: true });
  if (!existsSync(join(dir, 'preview', 'index.html'))) writeFileSync(join(dir, 'preview', 'index.html'), PREVIEW_HTML(title));
  writePart(dir, {
    id, name: title, kind, version: '0.1.0', summary: '', license: '', attribution: '', share: false, tags: [],
    ...(fromGame ? { from: fromGame } : {}),
    ...(entry ? { entry } : {}),
    files: [],
    preview: { page: 'preview/index.html' },
    requires: {},
    ...(['character', 'rig', 'clips', 'environment', 'set-piece'].includes(kind) ? { physical: { units: 'metres', scale: 1, pivot: kind === 'environment' || kind === 'set-piece' ? 'origin' : 'feet', collision: null } } : {}),
    ...(['character', 'rig', 'clips'].includes(kind) ? { skeleton: { rig: null, clips: [] } } : {}),
    ...(kind === 'mechanic' || kind === 'bot-brain' ? { contract: { inputs: {}, state: {}, netplay: 'host-authoritative' } } : {}),
    cost: {},
    provenance: { source: 'original', notes: '' },
  });
  const part = writeHashes(dir);
  return {
    ok: true, command: 'parts new', id, dir: `${PARTS_DIR}/${id}`, kind, entry, files: part.files.map((f) => f.path), ...(lifted ? { from, lifted } : {}),
    next: [
      ...(lifted ? [`games/${from} imports it now (each lifted module's old path re-exports the part's); build the game to see it unchanged.`] : []),
      `Write a one-sentence "summary" in parts/${id}/part.json, and what it needs from a game under "contract".`,
      `Another game of this studio uses it with: import … from '@parts/${id}'`,
      'It is private. Sharing it needs a licence (an SPDX identifier such as CC-BY-4.0) and is live after the studio\'s next deploy.',
    ],
  };
}

/* ------------------------------------------------------------------ checking a set together */

const creditsFile = (root, game) => join(root, 'games', game, 'credits.json');

/**
 * THE LICENCES OF THE PARTS A GAME USES, and where they cannot be combined: [{ level: 'conflict' | 'warn' | 'note',
 * parts, problem, fix }]. Each item is { ref, part, vendored, changed } (lib/parts-store.mjs partItems). What is
 * shown before a game with brought-in parts goes online, and when a part is added.
 *
 *   conflict   two parts under different share-alike licences in one game; a non-commercial part in a studio that
 *              sells; a no-derivatives part whose files were changed here; a part that names no licence; credit owed
 *              and missing from the game's credits
 *   warn       a share-alike part (the game built with it has to be offered under the same terms: the person's
 *              call); a licence the toolkit cannot reason about
 *
 * `game`: { id, sells, credits[] } when the set is one game's (lib/parts-store.mjs gameFacts).
 */
export function licenceIssues(items, { game = null } = {}) {
  const out = [];
  const add = (level, parts, problem, fix = null) => out.push({ level, parts, problem, fix });
  const sa = new Map();
  for (const x of items.filter((y) => isObj(y.part))) {
    const lic = licenseOfPart(x.part.license);
    if (!lic) { if (x.vendored) add('conflict', [x.ref], 'it names no licence, so nothing says a game may use it', 'ask its studio, or use another part'); continue; }
    if (lic.class === 'unrecognised') add('warn', [x.ref], `${lic.id} is not a licence the toolkit can reason about`, 'read it with the person before the game goes online');
    if (lic.class === 'share-alike') { if (!sa.has(lic.id)) sa.set(lic.id, []); sa.get(lic.id).push(x.ref); if (x.vendored) add('warn', [x.ref], `${lic.id} asks that a game built with it be offered under the same terms, its own source included`, 'the person decides: publish the game under that licence, or use a part under a permissive one'); }
    if (lic.class === 'non-commercial' && game?.sells) add('conflict', [x.ref], `${lic.id} does not allow commercial use, and this studio has a shop`, 'use another part, or ask its studio for a commercial licence');
    if (lic.class === 'non-commercial' && game && !game.sells) add('note', [x.ref], `${lic.id}: fine while nothing is sold; a shop would make it a conflict`, null);
    if (lic.class === 'no-derivatives') add(x.changed?.length ? 'conflict' : 'warn', [x.ref], x.changed?.length ? `${lic.id} asks that it be used unchanged, and ${x.changed.join(', ')} ${x.changed.length === 1 ? 'was' : 'were'} changed here` : `${lic.id} asks that it be used unchanged: change its tuning.json, never its files`, x.changed?.length ? `adding ${x.ref} again puts the original files back` : null);
    if (lic.class === 'weak-copyleft') add('note', [x.ref], `${lic.id}: changes to this part's own files must stay open; the rest of the game is unaffected`, null);
    if (lic.credit && game && x.vendored && !game.credits.some((c) => c?.part === x.ref)) add('conflict', [x.ref], `${lic.id} asks for credit, and games/${game.id}/credits.json has no line for it`, 'building the game writes it');
  }
  if (sa.size > 1) add('conflict', [...sa.values()].flat(), `${[...sa.keys()].join(' and ')} each ask that the whole game be under their own terms; one game cannot be under both`, 'keep the parts of one of those licences');
  const rank = { conflict: 0, warn: 1, note: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** The credit line a game owes one brought-in part (games/<id>/credits.json `parts[]`, the landing's credits page). */
export function creditLine(ref, entry) {
  const lic = licenseOfPart(entry.license);
  return {
    what: `${entry.name ?? ref.split('/').pop()} (${entry.kind ?? 'part'})`,
    author: clean(entry.attribution, 120) || clean(entry.studio, 80) || ref.split('/')[0],
    url: entry.page ?? null,
    licence: lic?.id ?? null,
    licenceUrl: lic?.known ? `https://spdx.org/licenses/${lic.id}.html` : null,
    note: entry.from?.name || entry.from?.game ? `A part of ${entry.from.name ?? entry.from.game}, from ${ref.split('/')[0]}` : `A game part from ${ref.split('/')[0]}`,
    part: ref,
  };
}
/**
 * games/<id>/credits.json `parts[]`, with one line per brought-in part the game uses (lines this wrote carry
 * `"part": "<host>/<id>"`; every other line stays, as lib/asset-manifest.mjs syncCredits leaves these alone).
 */
export function syncPartCredits(root, game, origins) {
  const file = creditsFile(root, game);
  let credits = {};
  try { credits = JSON.parse(readFileSync(file, 'utf8')); } catch { credits = {}; }
  const keep = (Array.isArray(credits.parts) ? credits.parts : []).filter((p) => typeof p?.part !== 'string');
  const mine = Object.entries(origins.parts ?? {}).filter(([, e]) => (e.games ?? []).includes(game)).map(([ref, e]) => creditLine(ref, e));
  if (!mine.length && !existsSync(file)) return null;
  if (!existsSync(join(root, 'games', game))) return null;
  const text = `${JSON.stringify({ ...credits, parts: [...keep, ...mine] }, null, 2)}\n`;
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
  return `games/${game}/credits.json`;
}

/* ------------------------------------------------------------------ where brought-in parts came from */

/**
 * parts/origins.json: for each part brought in from another studio, where it came from (site, version, address), its
 * licence and attribution, the game it came out of, the hashes it had when fetched, and which of this studio's games
 * use it. A record to read, not a lock: nothing is resolved or pinned against it.
 */
export function readOrigins(root) {
  const file = join(partsRoot(root), ORIGINS_FILE);
  if (!existsSync(file)) return { v: 1, parts: {} };
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { throw new Error(`parts/${ORIGINS_FILE} is not JSON: ${error.message}`); }
  if (doc?.v !== 1 || !isObj(doc.parts)) throw new Error(`parts/${ORIGINS_FILE} is not the record of brought-in parts (v 1)`);
  return doc;
}
export function writeOrigins(root, doc) {
  const file = join(partsRoot(root), ORIGINS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  const sorted = { v: 1, parts: Object.fromEntries(Object.entries(doc.parts).sort(([a], [b]) => a.localeCompare(b))) };
  writeFileSync(`${file}.tmp`, `${JSON.stringify(sorted, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
  return sorted;
}
/** Where a brought-in part lives: parts/_vendor/<host>/<id>/ (a port's colon cannot be in a folder name everywhere). */
export const vendorDir = (root, ref) => { const r = parseRef(ref); return join(partsRoot(root), VENDOR_DIR, r.host.replace(':', '_'), r.id); };
