import {refreshWorkerConfig} from './worker-config.mjs';
/**
 * `homie-studio upgrade [--apply] [--diff]` — an existing studio takes what this version's template adds, and
 * nothing it made its own is ever overwritten.
 *
 * `homie-studio new` writes a studio's first files (lib/scaffold.mjs). A studio made on an older version keeps its
 * old ones: its AGENTS.md lacks the sections the template grew since (the site, the room button, how to upgrade),
 * a README it never touched is out of date, its .gitignore misses lines. This command compares the studio with
 * what this version would write for it, and sorts every difference:
 *
 *   added      a file, an AGENTS.md section, a .gitignore line or a package.json script the studio does not have;
 *   updated    a file or an AGENTS.md section the studio never changed since an older template wrote it (its text
 *              is exactly an earlier version's: lib/template-history.json keeps a fingerprint of every one, and of
 *              every one as a studio the template itself names reads it), so the template's newer text replaces it;
 *   kept       anything the studio changed, or wrote itself: never touched. The plan says it differs, and
 *              `--diff` prints the difference, so the person can take the template's words by hand.
 *
 * Plus the pin: when this CLI is newer than the version package.json pins (run through
 * `npx -y @homie-rocks/studio@<the new version> upgrade`), --apply pins this version (then `npm install`), and
 * studio.json's `homie.studio` says the version the studio is on. The pin it writes is always the npm registry's:
 * a studio made before 0.10.0 pinned an address on homie.rocks, and its first upgrade moves it to the registry.
 *
 * Without --apply it changes nothing and says what --apply would do: the person agrees first. It never touches
 * studio.json beyond `homie.studio`, the studio's look (site/theme.json), its Worker config (deploy's), its games,
 * media or posts.
 *
 * Media (0.18.0): the plan also says which songs and videos are big media (over studio.json media.r2Over, 1 MiB
 * unless set, or left out of git), what is in the studio's R2 already, and the step that moves the rest
 * (`media move`, which every deploy of a studio with storage also runs). Upgrade itself never moves a file.
 *
 * What's new (0.19.2): the plan and the applied result carry `whatsNew`, every version after the one the studio
 * was on up to this one, each with its one-line summary and its upgrade notes, read from THIS package's own
 * CHANGELOG.md (lib/changelog.mjs): the version being moved to says what it brings, with no network.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { whatsNew } from './changelog.mjs';
import { R2_COST, mediaPlan, r2OverOf, sizeOf } from './media.mjs';
import { studioFiles } from './scaffold.mjs';
import { readStudio } from './studio.mjs';
import { STUDIO_VERSION, packageSpec } from './version.mjs';

/** Whole files the template writes and a studio may keep as they are: updated only while the studio never changed them. */
export const TEMPLATE_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'HANDOFF.md', 'games/README.md', 'music/README.md', 'videos/README.md', 'posts/README.md', 'site/README.md', 'site/src/worker.mjs'];
/** Files the template adds when missing and never changes once they exist (a migration is applied; a manifest is the studio's). */
export const ADD_ONLY = ['music/manifest.json', 'videos/manifest.json', '.claude/skills/.gitkeep', 'site/src/rules/index.mjs'];
const MIGRATIONS = /^site\/migrations\/[^/]+\.sql$/;
/** The name and slug stand-ins the history is fingerprinted with. */
export const STAND_IN = { name: '{{studio.name}}', slug: '{{studio.slug}}' };
/**
 * Studios the template's own words name: `demo` plays a live game "on Homie Arcade" (the Commands section). A
 * studio's text is compared with its own name and slug made neutral (normalize), so for the studio that IS Homie
 * Arcade that mention turns into the stand-in too, and no stand-in fingerprint could ever match its untouched text:
 * it read as changed by the studio, and kept the template's older words for good. The history also keeps, for each of
 * these names, the fingerprints that differ when the template is written for that studio (`named`).
 */
export const NAMED_IN_TEMPLATE = Object.freeze([Object.freeze({ name: 'Homie Arcade', slug: 'homie-arcade' })]);
const INTRO = '(intro)';

/** A text as the template compares it: line ends, trailing spaces and the studio's own name and slug made neutral. */
export function normalize(text, { name = null, slug = null } = {}) {
  let t = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').trim();
  if (name && name !== STAND_IN.name) t = t.split(name).join(STAND_IN.name);
  if (slug && slug !== STAND_IN.slug) t = t.split(slug).join(STAND_IN.slug);
  return t;
}
export const fingerprint = (text, who = {}) => createHash('sha256').update(normalize(text, who)).digest('hex').slice(0, 16);

/** AGENTS.md as its sections: the intro (the title and the lines before the first `## `), then each `## ` heading's. */
export function sections(text) {
  const out = [];
  let cur = { heading: INTRO, lines: [] };
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (/^## /.test(line)) { out.push(cur); cur = { heading: line.trim(), lines: [line] }; } else cur.lines.push(line);
  }
  out.push(cur);
  return out.map((s) => ({ heading: s.heading, text: s.lines.join('\n') })).filter((s, i) => i > 0 || s.text.trim());
}

/** What the history keeps of one template: a fingerprint of every whole file and every AGENTS.md section, as `who`
 * (the stand-ins, or a studio the template names) reads them. */
export function templatePrint(files, who = STAND_IN) {
  return {
    files: Object.fromEntries(TEMPLATE_FILES.filter((f) => f !== 'AGENTS.md' && files[f] !== undefined).map((f) => [f, fingerprint(files[f], who)])),
    sections: { 'AGENTS.md': Object.fromEntries(sections(files['AGENTS.md']).map((s) => [s.heading, fingerprint(s.text, who)])) },
  };
}

export function readHistory() {
  try { return JSON.parse(readFileSync(new URL('./template-history.json', import.meta.url), 'utf8')); } catch { return { v: 1, versions: {} }; }
}

/**
 * A template as the studios it names read it (NAMED_IN_TEMPLATE): for each, the fingerprints that differ from the
 * stand-ins' (only a file or section that names it does). `render(who)` is what `homie-studio new` writes for `who`.
 */
export function namedPrint(render, plain = templatePrint(render(STAND_IN))) {
  const named = {};
  for (const who of NAMED_IN_TEMPLATE) {
    const p = templatePrint(render(who), who);
    const files = Object.fromEntries(Object.entries(p.files).filter(([f, h]) => plain.files[f] !== h));
    const secs = Object.fromEntries(Object.entries(p.sections['AGENTS.md']).filter(([s, h]) => plain.sections['AGENTS.md'][s] !== h));
    if (Object.keys(files).length || Object.keys(secs).length) named[who.name] = { ...(Object.keys(files).length ? { files } : {}), sections: { 'AGENTS.md': secs } };
  }
  return named;
}

/** Every fingerprint an older template wrote, per file and per AGENTS.md section, as this studio (`who`) reads it. */
function known(history, who = {}) {
  const files = new Map();
  const secs = new Map();
  for (const v of Object.values(history.versions ?? {})) {
    // A studio the template names reads those mentions as its own name: its fingerprints are kept beside the rest.
    const as = who.name && v.named && Object.hasOwn(v.named, who.name) ? v.named[who.name] : null;
    for (const p of as ? [v, as] : [v]) {
      // A version may hold more than one hash for a file (two templates published under it): a list.
      for (const [f, h] of Object.entries(p.files ?? {})) for (const x of [h].flat()) (files.get(f) ?? files.set(f, new Set()).get(f)).add(x);
      for (const [heading, h] of Object.entries(p.sections?.['AGENTS.md'] ?? {})) for (const x of [h].flat()) (secs.get(heading) ?? secs.set(heading, new Set()).get(heading)).add(x);
    }
  }
  return { files, secs };
}

const semver = (v) => (/^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '')) ?? []).slice(1).map(Number);
const newer = (a, b) => { const x = semver(a); const y = semver(b); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); return false; };

/**
 * The version in the address a studio made before 0.10.0 pinned (https://<directory>/npm/homie-studio-<version>.tgz),
 * or null. Read for one thing only: so that studio's upgrade knows which version it is leaving. Nothing writes
 * such an address; its upgrade writes the npm registry's exact version.
 */
const addressPin = (spec) => /^https?:\/\/.+\/homie-studio-(\d+\.\d+\.\d+)\.tgz(?:[?#].*)?$/.exec(String(spec ?? ''))?.[1] ?? null;

/** The @homie-rocks/studio version a package.json spec pins: an exact version, npm:… of one, or an older studio's address. */
export function pinnedVersion(spec) {
  const s = String(spec ?? '');
  return /^(?:npm:@homie-rocks\/studio@)?=?(\d+\.\d+\.\d+)$/.exec(s)?.[1] ?? addressPin(s);
}
/** The pin for this version: the npm registry's exact version (an npm: alias stays an alias). */
function specFor(spec) {
  return /^npm:@homie-rocks\/studio@/.test(String(spec ?? '')) ? `npm:@homie-rocks/studio@${STUDIO_VERSION}` : packageSpec();
}

/** A line diff (the longest common run kept), for the plan: `  ` same, `- ` the studio's, `+ ` the template's. */
export function lineDiff(a, b, { context = 2, max = 60 } = {}) {
  const x = String(a ?? '').split('\n');
  const y = String(b ?? '').split('\n');
  const n = x.length; const m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const rows = [];
  let i = 0; let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { rows.push(['  ', x[i]]); i++; j++; } else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { rows.push(['- ', x[i]]); i++; } else { rows.push(['+ ', y[j]]); j++; }
  }
  // Only the changed lines and a little context around them.
  const keep = rows.map((r, k) => r[0] !== '  ' || rows.slice(Math.max(0, k - context), k + context + 1).some((q) => q[0] !== '  '));
  const out = [];
  let skipped = false;
  rows.forEach((r, k) => { if (keep[k]) { out.push(`${r[0]}${r[1]}`); skipped = false; } else if (!skipped) { out.push('  …'); skipped = true; } });
  return out.length > max ? [...out.slice(0, max), `  … (${out.length - max} more lines)`] : out;
}

const read = (root, rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; } };

/** The plan: every change --apply would make, and everything it keeps as the studio wrote it. */
export function upgradePlan(root, { history = readHistory() } = {}) {
  const studio = readStudio(root);
  const name = String(studio.name ?? '').trim();
  const slug = String(studio.slug ?? '').trim();
  if (!name || !slug) return { ok: false, command: 'upgrade', why: 'studio.json has no name or slug; this does not look like a studio made with homie-studio new' };
  const who = { name, slug };
  const tmpl = studioFiles({ name, slug, homie: studio.homie?.directory ?? 'https://homie.rocks' });
  const { files: oldFiles, secs: oldSecs } = known(history, who);
  const changes = [];
  const kept = [];

  // package.json: the pin, and the scripts the template's studios have.
  let pkg = null;
  try { pkg = JSON.parse(read(root, 'package.json') ?? 'null'); } catch { pkg = null; }
  const where = pkg?.devDependencies?.['@homie-rocks/studio'] !== undefined ? 'devDependencies' : pkg?.dependencies?.['@homie-rocks/studio'] !== undefined ? 'dependencies' : null;
  const spec = where ? pkg[where]['@homie-rocks/studio'] : null;
  const pinned = pinnedVersion(spec);
  const from = pinned ?? studio.homie?.studio ?? null;
  if (pinned && newer(pinned, STUDIO_VERSION)) {
    return { ok: false, command: 'upgrade', from: pinned, to: STUDIO_VERSION, why: `this studio pins @homie-rocks/studio ${pinned}, newer than this ${STUDIO_VERSION}: run its own copy (npx --no-install homie-studio upgrade)` };
  }
  // An older studio's address is moved to the registry even when it names this very version: it is no longer served.
  if (pkg && where && pinned && (newer(STUDIO_VERSION, pinned) || addressPin(spec))) {
    changes.push({ file: 'package.json', kind: 'pin', what: `pin @homie-rocks/studio ${STUDIO_VERSION}${addressPin(spec) ? ' from the npm registry' : ''} (was ${pinned}${addressPin(spec) ? ', at an address that is no longer served' : ''}); then npm install`, from: spec, to: specFor(spec) });
  } else if (pkg && where && !pinned) {
    kept.push({ file: 'package.json', what: `@homie-rocks/studio is "${String(spec).slice(0, 80)}" (not a published version): left as it is` });
  }
  const wantScripts = JSON.parse(tmpl['package.json']).scripts ?? {};
  const missingScripts = pkg ? Object.fromEntries(Object.entries(wantScripts).filter(([k]) => pkg.scripts?.[k] === undefined)) : {};
  if (Object.keys(missingScripts).length) changes.push({ file: 'package.json', kind: 'scripts', what: `add scripts: ${Object.keys(missingScripts).join(', ')}`, scripts: missingScripts });
  if (studio.homie?.studio !== STUDIO_VERSION) changes.push({ file: 'studio.json', kind: 'version', what: `homie.studio ${studio.homie?.studio ?? '(none)'} → ${STUDIO_VERSION}`, to: STUDIO_VERSION });

  // AGENTS.md, section by section; the other template files whole.
  for (const rel of TEMPLATE_FILES) {
    const mine = read(root, rel);
    const want = tmpl[rel];
    if (want === undefined) continue;
    if (mine === null) { changes.push({ file: rel, kind: 'add-file', what: 'new file', text: want }); continue; }
    if (normalize(mine, who) === normalize(want, who)) continue;
    if (rel !== 'AGENTS.md') {
      if (oldFiles.get(rel)?.has(fingerprint(mine, who))) changes.push({ file: rel, kind: 'update-file', what: 'the template\'s newer text (the studio never changed it)', from: mine, text: want });
      else kept.push({ file: rel, what: rel === 'site/src/worker.mjs' ? 'the studio\'s own Worker' : 'changed by the studio', mine, template: want });
      continue;
    }
    const have = sections(mine);
    const tsecs = sections(want);
    const adding = new Set();
    for (const [k, t] of tsecs.entries()) {
      const at = have.find((s) => s.heading === t.heading);
      if (!at) {
        // After the nearest template section before it that the studio has (or that this plan adds just before it, so
        // two new sections in a row keep the template's order); else before the first one after it.
        const before = tsecs.slice(0, k).reverse().find((p) => have.some((s) => s.heading === p.heading) || adding.has(p.heading));
        adding.add(t.heading);
        const after = before ? null : tsecs.slice(k + 1).find((p) => have.some((s) => s.heading === p.heading));
        changes.push({ file: rel, kind: 'add-section', section: t.heading, what: `new section ${t.heading === INTRO ? 'intro' : `"${t.heading}"`}`, after: before?.heading ?? null, before: after?.heading ?? null, text: t.text });
        continue;
      }
      if (normalize(at.text, who) === normalize(t.text, who)) continue;
      if (oldSecs.get(t.heading)?.has(fingerprint(at.text, who))) changes.push({ file: rel, kind: 'update-section', section: t.heading, what: `section "${t.heading}": the template's newer text (the studio never changed it)`, from: at.text, text: t.text });
      else kept.push({ file: rel, section: t.heading, what: `section "${t.heading}": changed by the studio`, mine: at.text, template: t.text });
    }
  }

  // Files added only when missing: the empty manifests, the skills folder, and any D1 migration the template has.
  for (const rel of [...ADD_ONLY, ...Object.keys(tmpl).filter((f) => MIGRATIONS.test(f))]) {
    if (tmpl[rel] !== undefined && read(root, rel) === null) changes.push({ file: rel, kind: 'add-file', what: MIGRATIONS.test(rel) ? 'D1 migration (the next deploy applies it)' : 'new file', text: tmpl[rel] });
  }

  // .gitignore: every pattern the template ignores and the studio does not, with the comment lines above it.
  const gi = read(root, '.gitignore');
  const bare = (l) => l.trim().replace(/^\//, '').replace(/\/$/, '');
  const have = new Set((gi ?? '').split('\n').map(bare).filter((l) => l && !l.startsWith('#')));
  const add = [];
  let notes = [];
  for (const line of tmpl['.gitignore'].split('\n')) {
    if (!line.trim()) { notes = []; continue; }
    if (line.trim().startsWith('#')) { notes.push(line); continue; }
    // A pattern's comment lines are the ones right above it (they go with the first missing pattern below them).
    if (!have.has(bare(line))) add.push(...notes, line);
    notes = [];
  }
  if (add.length) changes.push({ file: '.gitignore', kind: 'add-lines', what: `${add.filter((l) => !l.startsWith('#')).length} line(s): ${add.filter((l) => !l.startsWith('#')).join(' ')}`, lines: add });

  const git = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const dirty = git.status === 0 ? git.stdout.split('\n').filter(Boolean).length : null;
  const media = mediaNote(root, studio);
  const news = whatsNew(from, STUDIO_VERSION);
  return {
    ok: true, command: 'upgrade', applied: false, root, studio: name, from, to: STUDIO_VERSION,
    ...(news ? { whatsNew: news } : {}),
    changes, kept,
    ...(media ? { media } : {}),
    ...(dirty ? { uncommitted: dirty } : {}),
    // A plan that moves the pin is this (newer) toolkit's to apply: the studio's own older copy knows nothing newer.
    next: changes.length ? [`${changes.some((c) => c.kind === 'pin') ? `npx -y @homie-rocks/studio@${STUDIO_VERSION} upgrade --apply` : 'npx --no-install homie-studio upgrade --apply'}   (after the person agrees)`] : [],
  };
}

/** What the studio's big media does from this version on: what R2 holds, what would go there, and the step that does it. */
function mediaNote(root, studio) {
  const cf = studio.cloudflare ?? {};
  const storage = cf.r2 && (cf.created ?? []).includes(`r2:${cf.r2}`) ? cf.r2 : null;
  const over = r2OverOf(studio);
  let rows = [];
  try { rows = mediaPlan(root, { over }); } catch { return null; }
  const big = rows.filter((r) => r.state === 'move' || r.state === 'too-big').map(({ abs, held, ...r }) => r);
  const inR2 = rows.filter((r) => r.state === 'r2').map(({ abs, held, ...r }) => r);
  if (!big.length && !inR2.length) return null;
  const bytes = big.reduce((n, r) => n + (r.bytes ?? 0), 0);
  return {
    storage, over, big, inR2,
    next: !big.length ? null : storage
      ? `npx --no-install homie-studio media move --dry-run, then media move (the next npm run deploy also does it): ${big.length} file(s), ${sizeOf(bytes)}, go to R2 ${storage}, each read back and checked by SHA-256 before the site stops carrying it; the addresses stay the same and the files stay in this folder. Upgrade itself moves nothing.`
      : `no storage: these stay on the site (up to 25 MiB a file), and a deploy from another computer or Workers Builds leaves out any that git does not keep. With the person's agreement: npx --no-install homie-studio storage add (Cloudflare asks for a payment method on the account first), then media move.`,
    cost: R2_COST,
  };
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.upgrade-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Apply a plan made a moment ago on the same files (each change checks that what it replaces is still there). */
export function upgradeApply(root, plan) {
  if (!plan?.ok) return plan;
  const done = [];
  const skipped = [];
  const byFile = new Map();
  for (const c of plan.changes) (byFile.get(c.file) ?? byFile.set(c.file, []).get(c.file)).push(c);
  for (const [rel, list] of byFile) {
    const path = join(root, rel);
    let text = existsSync(path) ? readFileSync(path, 'utf8') : null;
    for (const c of list) {
      if (c.kind === 'add-file') { if (text === null) { text = c.text; done.push(c); } else skipped.push({ ...c, why: 'it exists now' }); continue; }
      if (c.kind === 'update-file') { if (text === c.from) { text = c.text; done.push(c); } else skipped.push({ ...c, why: 'it changed since the plan' }); continue; }
      if (c.kind === 'add-lines') { text = `${text ?? ''}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${c.lines.join('\n')}\n`; done.push(c); continue; }
      if (c.kind === 'update-section' || c.kind === 'add-section') {
        // Sections joined by line ends are the file byte for byte: only the section that changes changes.
        const secs = sections(text ?? '');
        if (c.kind === 'update-section') {
          const at = secs.find((s) => s.heading === c.section);
          if (!at || at.text !== c.from) { skipped.push({ ...c, why: 'the section changed since the plan' }); continue; }
          at.text = `${c.text.replace(/\n+$/, '')}${/\n*$/.exec(at.text)[0]}`;
        } else {
          if (secs.some((s) => s.heading === c.section)) { skipped.push({ ...c, why: 'it exists now' }); continue; }
          // A new section ends with a blank line (before the next heading), and the one above it ends its last line.
          const item = { heading: c.section, text: `${c.text.replace(/\n+$/, '')}\n` };
          const i = c.after ? secs.findIndex((s) => s.heading === c.after) : -1;
          const j = !c.after && c.before ? secs.findIndex((s) => s.heading === c.before) : -1;
          const at = i >= 0 ? i + 1 : j >= 0 ? j : secs.length;
          secs.splice(at, 0, item);
          if (at > 0 && !secs[at - 1].text.endsWith('\n')) secs[at - 1].text += '\n';
        }
        text = secs.map((s) => s.text).join('\n');
        done.push(c);
        continue;
      }
      if (c.kind === 'pin' || c.kind === 'scripts') {
        const pkg = JSON.parse(text);
        if (c.kind === 'pin') {
          const where = pkg.devDependencies?.['@homie-rocks/studio'] !== undefined ? 'devDependencies' : 'dependencies';
          if (pkg[where]?.['@homie-rocks/studio'] !== c.from) { skipped.push({ ...c, why: 'the pin changed since the plan' }); continue; }
          pkg[where]['@homie-rocks/studio'] = c.to;
        } else pkg.scripts = { ...(pkg.scripts ?? {}), ...c.scripts };
        text = `${JSON.stringify(pkg, null, 2)}\n`;
        done.push(c);
        continue;
      }
      if (c.kind === 'version') {
        const s = JSON.parse(text);
        s.homie = { ...(s.homie ?? {}), studio: c.to };
        text = `${JSON.stringify(s, null, 2)}\n`;
        done.push(c);
      }
    }
    if (text !== null && (!existsSync(path) || readFileSync(path, 'utf8') !== text)) writeAtomic(path, text);
  }
  refreshWorkerConfig(root);
  const pinned = done.some((c) => c.kind === 'pin');
  return {
    ...plan, applied: true, done, skipped,
    next: [...(pinned ? [`npm install   (fetches @homie-rocks/studio ${STUDIO_VERSION})`] : []), 'npm run build, then look at the site (npm run dev) before the next deploy', 'git diff, then commit the upgrade on its own'],
  };
}
