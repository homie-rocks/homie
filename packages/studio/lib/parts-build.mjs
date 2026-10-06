/**
 * GAME PARTS IN THE BUILD (parts/PARTS.md). Three small things lib/build.mjs and the deploy plan call, so the build
 * itself stays one line longer in each place:
 *
 *   partsPlugin(root, game)     esbuild resolves `@parts/<host>/<id>` (a part brought in) and `@parts/<id>` (one of
 *                               the studio's own) to the part's entry, so adding a part and one import line is a
 *                               running piece. A game that imports a brought-in part is recorded against it and
 *                               credited (the existing credits.json), whether or not the add named the game.
 *   buildParts(root, dist)      site/dist/parts/: every packed version of every SHARED part, byte for byte as
 *                               hashed, and index.json, what the Worker answers /.well-known/homie-parts.json from.
 *                               What is shared is sharedPartsOf() and nothing else. A private part is never copied:
 *                               what is not in dist cannot be served.
 *   partsPublishReport(root)    before a game that uses parts goes online: each part's licence and attribution, and
 *                               plainly where licences cannot be combined.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  assetRecords, licenceIssues, licenseOfPart, listOwnParts, packPart, packedDir, packedVersions, publicPart, readOrigins, readPart, safePath, shareProblems,
  sharedPartsOf, syncPartCredits, vendorDir, verifyFiles, writeOrigins,
} from './parts.mjs';
import { gameFacts, partItems } from './parts-store.mjs';

/* ------------------------------------------------------------------ importing a part */

/**
 * Where `@parts/…` points: { path } or { error }. `@parts/<host>/<id>[/<file>]` is a part the lock names;
 * `@parts/<id>[/<file>]` is one of the studio's own. With no file it is the part's `entry`.
 */
export function resolvePartImport(root, spec, lock = readOrigins(root)) {
  const segs = String(spec).replace(/^@parts\//, '').split('/').filter(Boolean);
  let dir = null; let rest = []; let ref = null; let vendored = false;
  if (segs.length >= 2 && lock.parts[`${segs[0]}/${segs[1]}`]) { ref = `${segs[0]}/${segs[1]}`; dir = vendorDir(root, ref); rest = segs.slice(2); vendored = true; }
  else if (segs.length >= 1 && existsSync(join(root, 'parts', segs[0], 'part.json'))) { ref = segs[0]; dir = join(root, 'parts', segs[0]); rest = segs.slice(1); }
  if (!dir) return { error: `'${spec}' names a part this studio does not have. Parts here: ${[...Object.keys(lock.parts), ...listOwnParts(root).map((o) => o.id)].join(', ') || 'none'}. Bring one in with part_add ("<studio site>/<part id>").` };
  if (!existsSync(dir)) return { error: `'${spec}': parts/origins.json names ${ref} but its files are gone. Add it again (${ref}@${lock.parts[ref].version}).` };
  if (rest.length) {
    const file = rest.join('/');
    if (!safePath(file) || !existsSync(join(dir, file))) return { error: `'${spec}': the ${ref} part has no file ${file}` };
    return { path: join(dir, file), ref, vendored };
  }
  let part;
  try { part = readPart(dir); } catch (error) { return { error: `'${spec}': ${error.message}` }; }
  if (!part.entry) return { error: `'${spec}': the ${ref} part has no code to import (it is ${part.kind}: files only). Name a file: '@parts/${ref}/<path>'.` };
  if (!existsSync(join(dir, part.entry))) return { error: `'${spec}': the ${ref} part's entry ${part.entry} is missing` };
  return { path: join(dir, part.entry), ref, vendored };
}

/** The esbuild plugin (lib/build.mjs passes it to every game's bundle). `game`: the game being bundled, to credit. */
export function partsPlugin(root, game = null) {
  return {
    name: 'homie-parts',
    setup(build) {
      const used = new Set();
      let lock = null;
      build.onStart(() => { used.clear(); lock = null; });
      build.onResolve({ filter: /^@parts\// }, (args) => {
        try { lock ??= readOrigins(root); } catch (error) { return { errors: [{ text: error.message }] }; }
        const r = resolvePartImport(root, args.path, lock);
        if (r.error) return { errors: [{ text: r.error }] };
        if (r.vendored) used.add(r.ref);
        return { path: r.path };
      });
      // A brought-in part a game imports is that game's to credit, even when it was added without naming the game.
      build.onEnd(() => {
        if (!game || !used.size || !existsSync(join(root, 'games', game))) return;
        try {
          const now = readOrigins(root);
          let changed = false;
          for (const ref of used) { const e = now.parts[ref]; if (e && !(e.games ?? []).includes(game)) { e.games = [...(e.games ?? []), game].sort(); changed = true; } }
          if (changed) writeOrigins(root, now);
          syncPartCredits(root, game, now);
        } catch { /* a credit line is never worth a failed bundle; the publish report says what is missing */ }
      });
    },
  };
}

/* ------------------------------------------------------------------ the site's parts */

/**
 * site/dist/parts/: the shared parts and their index. Returns { shared: [{ id, versions }], kept: <private count> }.
 * A part marked shared that cannot be (someone set `share` by hand past the checks) STOPS the build with the
 * reasons: publishing a file of unknown rights quietly is the one thing this must never do.
 */
export function buildParts(root, dist, { studio = {}, log = () => {} } = {}) {
  const out = join(dist, 'parts');
  rmSync(out, { recursive: true, force: true });
  const own = listOwnParts(root);
  const records = assetRecords(root);
  for (const o of own) {
    if (o.part?.share !== true) continue;
    const problems = shareProblems(o.part, { dir: o.dir, records }).filter((p) => !(p.field === 'files' && /^the files differ/.test(p.problem)));
    if (problems.length) throw new Error(`parts/${o.id} is marked shared but cannot be: ${problems.map((p) => `${p.field}: ${p.problem}`).slice(0, 4).join('; ')}. Fix it, or stop sharing it (part_share with share: false); the site was not built with it.`);
    // Edited since it was packed: the packed version is what is public; the edit needs a version of its own.
    if (!verifyFiles(o.dir, o.part).ok || !packedVersions(root, o.id).includes(o.part.version)) {
      const packed = verifyFiles(o.dir, o.part).ok ? packPart(root, o.id) : { ok: false };
      if (!packed.ok) log(`warning: parts/${o.id} changed since version ${packedVersions(root, o.id).at(-1) ?? '(none)'} was shared; the site shares that version. To share the change, raise "version" in its part.json and share it again.`);
    }
  }
  // The one answer to "what does this studio share".
  const sharing = sharedPartsOf(root);
  const names = new Map();
  const index = [];
  for (const { id, versions, part } of sharing) {
    for (const v of versions) {
      const src = packedDir(root, id, v);
      const packed = readPart(src);
      if (!verifyFiles(src, packed).ok) throw new Error(`parts/_packed/${id}/${v} no longer matches its hashes: a shared version never changes. Restore it from git.`);
      const dest = join(out, id, v);
      for (const f of packed.files) { mkdirSync(dirname(join(dest, f.path)), { recursive: true }); cpSync(join(src, f.path), join(dest, f.path)); }
      writeFileSync(join(dest, 'part.json'), `${JSON.stringify(publicPart({ ...packed, share: true }))}\n`);
    }
    // The game it came out of, by the name the studio gives it.
    const g = part.from?.game;
    if (g && !names.has(g)) names.set(g, gameFacts(root, g).name);
    index.push({ ...part, ...(g ? { from: { ...part.from, name: names.get(g) } } : {}), url: `/parts/${id}/${versions.at(-1)}/`, page: `/parts/${id}/`, versions });
    log(`shared part ${id} (${versions.join(', ')})`);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'index.json'), `${JSON.stringify({ v: 1, studio: { name: studio.name ?? null }, parts: index.sort((a, b) => a.id.localeCompare(b.id)) })}\n`);
  return { shared: sharing.map(({ id, versions }) => ({ id, versions })), kept: own.length - sharing.length };
}

/* ------------------------------------------------------------------ before going online */

/**
 * What a deploy plan shows about parts, and changes nothing:
 *
 *   games     each game that uses brought-in parts: every part's licence, what it asks, its attribution and the game
 *             it came from, and plainly where licences cannot be combined (licenceIssues)
 *   sharing   the studio's own parts this deploy makes live (sharedPartsOf)
 *   ok        false when a game's licences cannot be combined: the caller decides whether that stops it
 *
 * `partsPlanLines(report)` is the same in plain lines: said before a deploy (its plan) and before a studio is listed
 * (`publish`, lib/directory.mjs), in the same words.
 */
export function partsPublishReport(root) {
  let lock;
  try { lock = readOrigins(root); } catch (error) { return { ok: false, games: [], sharing: [], why: error.message }; }
  const byGame = new Map();
  for (const [ref, e] of Object.entries(lock.parts)) for (const g of e.games ?? []) { if (!byGame.has(g)) byGame.set(g, []); byGame.get(g).push([ref, e]); }
  const games = [];
  for (const [game, list] of [...byGame].sort(([a], [b]) => a.localeCompare(b))) {
    if (!existsSync(join(root, 'games', game, 'game.json'))) continue;
    const issues = licenceIssues(partItems(root, { game }), { game: gameFacts(root, game) });
    games.push({
      game,
      parts: list.sort(([a], [b]) => a.localeCompare(b)).map(([ref, e]) => { const lic = licenseOfPart(e.license); return { ref, name: e.name, version: e.version, license: lic?.id ?? null, asks: lic?.asks ?? 'nothing is known: it names no licence', attribution: e.attribution || null, from: e.from ?? null }; }),
      issues, ok: !issues.some((i) => i.level === 'conflict'),
    });
  }
  const sharing = sharedPartsOf(root).map(({ id, versions, part }) => ({ id, version: versions.at(-1), license: part.license ?? null, from: part.from ?? null }));
  return { ok: games.every((g) => g.ok), games, sharing };
}

export function partsPlanLines(report, { at = 'deploy' } = {}) {
  const L = [];
  if (report.why) L.push(`Parts: ${report.why}`);
  for (const g of report.games) {
    L.push(`Parts in ${g.game} from other studios (their licences travel with the game):`);
    for (const p of g.parts) L.push(`  ${p.name} ${p.version} (${p.ref})${p.from?.name || p.from?.game ? `, from ${p.from.name ?? p.from.game}` : ''}: ${p.license ?? 'NO LICENCE'}; asks ${p.asks}${p.attribution ? `; credit: ${p.attribution}` : ''}`);
    for (const i of g.issues) L.push(`  ${i.level === 'conflict' ? 'CANNOT BE COMBINED' : i.level === 'warn' ? 'look' : 'note'} ${i.parts.join(' + ')}: ${i.problem}${i.fix ? ` (${i.fix})` : ''}`);
    if (!g.issues.length) L.push('  Their licences can be combined, and each is credited in the game\'s credits.');
  }
  // The same lines before a deploy and before a listing; only where a shared part becomes visible differs.
  if (report.sharing.length) L.push(`Parts this studio shares (${at === 'publish' ? 'the parts catalog shows them once the studio is listed' : 'live with this deploy'}): ${report.sharing.map((s) => `${s.id} ${s.version} (${s.license})`).join(', ')}`);
  return L;
}
