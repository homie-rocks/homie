/**
 * THE HOLDS, DECIDED IN ONE PLACE. Claude Code's Homie mod (hooks/homie.mjs), Codex's hooks (hooks/codex.mjs)
 * and Grok's hooks (hooks/grok.mjs) all ask this module what a tool call means for a studio, so the three apps
 * cannot drift apart:
 *   null                  let it through;
 *   { deny }              refused outright, nobody is asked (the reason says what to do instead);
 *   { hold }              the person says Proceed or Cancel first: { question, title, lines, diff?, more?, detail,
 *                         no (the reason when they said no), nobody (the reason when nobody could be asked) };
 *   { note }              let it through, with one line for the person (the mod's toast).
 * Each app shows a hold its own way: the mod in Claude Code's question dialog with the Hold pane, Codex and Grok
 * by refusing the call with a short code the person answers in their own message (hooks/codex.mjs and hooks/grok.mjs
 * say how far each app goes).
 *
 * Everything here reads through `io`, which each app builds from what it may reach:
 *   io.exists(path) → boolean          io.read(path) → text (throws when missing)
 *   io.stat(path, { resolve }) → { kind, size, realPath?, mtimeMs }
 *   io.list(dir) → [{ name, kind }]    io.run(argv, { cwd, timeoutMs }) → { exitCode, stdout }
 *   io.fetchJson(url) → value | null  (only Ollama's model list on this computer, before a Clef download)
 * `io.run` is asked only for `git -C <studio>` (read-only) and a media skill's own `--dry-run` (free). Nothing here
 * writes a file, reads a key, the keychain or the environment, or approves anything.
 */
import { decisionsFileOf, GAME_ID, licenceIssues, lockedChanges, publicSource } from './art.mjs';
import { cloudflareChangeOf, cloudflareMcpChangeOf, deployOf, gitStagesOf, inside, modelPullOf, paidMcpOf, paidOf, protectedBy, stripeSecretWriteOf } from './commands.mjs';
import { applyEdit, unifiedDiff } from './diff.mjs';
import { ago, summarize } from './feed.mjs';
import { KIND_LABEL, cleanNote, withLine } from './feedback.mjs';

/** Which holds are on: the mod's settings of the same names (Codex: all on unless HOMIE_GUARD_* turns one off). */
export const GUARDS = Object.freeze({ guardFiles: true, guardDeploys: true, guardSpend: true });

export async function readJson(io, path) {
  try { return JSON.parse(await io.read(path)); } catch { return null; }
}

async function readText(io, path) {
  try { return await io.read(path); } catch { return null; }
}

/** The studio a folder is in: the nearest folder at or above it with a studio.json, or null. */
export async function studioRootOf(io, dir) {
  let at = String(dir ?? '').replace(/\/+$/, '');
  for (let i = 0; i < 24 && at; i++) {
    if (await io.exists(`${at}/studio.json`)) return at;
    const up = at.slice(0, at.lastIndexOf('/'));
    if (up === at) break;
    at = up;
  }
  return null;
}

/** The studio whose folder a command line's `cd` names (relative to the session's folder), or the session's. */
export async function studioFor(io, ctx, dir) {
  if (!dir) return ctx.root;
  return studioRootOf(io, dir.startsWith('/') ? dir : `${ctx.cwd}/${dir}`);
}

/** The live site: the studio's custom domain, else this computer's workers.dev address from its last deploy. */
export function liveSite(studio, local) {
  const cf = studio?.cloudflare ?? {};
  const raw = String(cf.domain ?? '').trim();
  if (raw) { try { const u = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`); if (u.protocol === 'https:') return u.origin; } catch { /* not a domain */ } }
  for (const u of [cf.url, local?.url]) { try { const x = new URL(String(u ?? '')); if (x.protocol === 'https:') return x.origin; } catch { /* none */ } }
  return null;
}

/** A studio's name, as a hold says it. */
export function studioName(studio, root) {
  return String(studio?.name ?? String(root ?? '').split('/').pop()).slice(0, 60);
}

/**
 * What a hold knows about the session, read from the studio's own files (Codex: once per call; the mod keeps its own,
 * refreshed every 2 s). { app, cwd, root, studio, local, name, feed, guards }.
 */
export async function contextOf(io, cwd, { app = 'codex', guards = GUARDS } = {}) {
  const root = await studioRootOf(io, cwd);
  const studio = root ? (await readJson(io, `${root}/studio.json`)) ?? {} : null;
  const local = root ? (await readJson(io, `${root}/.studio/local.json`)) ?? {} : null;
  let feed = null;
  if (root) {
    const dir = `${root}/.studio/progress`;
    const id = String((await readText(io, `${dir}/current`)) ?? '').trim();
    if (/^[a-z0-9][a-z0-9-]{5,63}$/.test(id)) {
      const doc = await readJson(io, `${dir}/${id}.json`);
      if (doc && typeof doc === 'object') feed = doc;
    }
  }
  return { app, cwd, root, studio, local, name: root ? studioName(studio, root) : null, feed: feed?.state === 'running' ? feed : null, last: feed?.state === 'running' ? null : feed, guards: { ...GUARDS, ...guards } };
}

/** A path with its "." and ".." folded, so it compares with the studio's own. */
export function normalPath(p) {
  const out = [];
  for (const part of String(p).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

/** A hold's whole story as plain lines: where no pane can show it (a narrow terminal), and Codex's approval text. */
export function holdText(g, { diffLines = 40 } = {}) {
  const d = g.detail ?? {};
  return [`⚠ ${g.title}`, ...(d.lines ?? []).map((l) => (typeof l === 'string' ? `  ${l}` : `  ${l.k}: ${l.v}`)), ...(d.full?.source ? d.full.source.split('\n').slice(0, diffLines).map((l) => `  ${l}`) : [])].join('\n');
}

/* ------------------------------------------------------------------ edits */

/**
 * An edit to files in a studio: { tool, by, changes: [{ path, from?, apply(before) → after | null, a?, b? }] }. `apply`
 * gives the file's text after the edit from its text before (read at `from` for a moved file; null: the edit cannot
 * apply, and the tool will refuse it); `a`/`b` give the diff straight (a notebook cell). `by` is who asked, in words
 * ("Claude", "a subagent", "Codex").
 */
export async function editDecision(io, ctx, edit) {
  if (!ctx.guards.guardFiles || !ctx.root) return null;
  const locked = await lockDecision(io, ctx, edit);
  if (locked) return locked;
  return protectDecision(io, ctx, edit);
}

/** Where a path is in the studio: the path or its real path (a link into the studio counts), or null. */
async function inStudio(io, root, path) {
  if (!String(path).startsWith('/')) return null;
  let real = path;
  try { real = (await io.stat(path, { resolve: true })).realPath ?? path; } catch { real = path; }
  return [path, real].find((p) => inside(root, p)) ?? null;
}

/**
 * An edit to games/<id>/codex/decisions.json that changes the value or the state of a decision the person locked:
 * refused, nobody asked (their lock is the answer). The toolkit writes this file; the way to change a locked decision is
 * its own `style set … --unlock --reason`, after the person saw the blast radius.
 */
async function lockDecision(io, ctx, edit) {
  const root = ctx.root;
  for (const c of edit.changes) {
    if (c.notebook) continue;
    const hit = await inStudio(io, root, c.path);
    const game = hit ? decisionsFileOf(hit.slice(root.length + 1)) : null;
    if (!game) continue;
    const before = await readText(io, c.from ?? c.path);
    if (before === null) continue;
    const after = c.apply(before);
    // An edit that cannot apply is refused by the tool itself.
    if (after === null) continue;
    const changed = lockedChanges(before, after);
    if (changed && !changed.length) continue;
    const how = (id) => `${id} is locked by the person; change it with homie-studio style set ${game} ${id} <value> --unlock --reason "<what they asked for>" after they saw the blast radius (homie-studio style blast ${game} ${id})`;
    return { deny: changed === null
      ? `games/${game}/codex/decisions.json holds decisions the person locked, and this edit would leave it unreadable (not JSON). The studio toolkit writes this file: homie-studio style set / steer / lock / unlock ${game} … changes a decision, and a locked one changes only after the person saw the blast radius (homie-studio style blast).`
      : `${changed.map(how).join('. ')}. Nothing was changed.` };
  }
  return null;
}

/** An edit to a file the studio protects (studio.json "protect"): held, with its diff, until the person says Proceed. */
async function protectDecision(io, ctx, edit) {
  const protect = ctx.studio?.protect;
  if (!Array.isArray(protect) || !protect.length) return null;
  const root = ctx.root;
  const hits = [];
  for (const c of edit.changes) {
    const hit = await inStudio(io, root, c.path);
    if (!hit) continue;
    const rel = hit.slice(root.length + 1);
    const glob = protectedBy(protect, rel);
    if (glob) hits.push({ c, rel, glob });
  }
  if (!hits.length) return null;
  const { c, rel, glob } = hits[0];
  const before = c.notebook ? '' : (await readText(io, c.from ?? c.path)) ?? '';
  const [a, b] = c.a !== undefined ? [c.a, c.b] : (() => { const after = c.apply(before); return after === null ? [String(c.old ?? ''), String(c.new ?? '')] : [before, after]; })();
  // Claude Code's question dialog has room for about five diff rows ("@@" lines count): the first changes, cut short.
  let diff = unifiedDiff(a, b, { context: 0, maxLines: 4, lineWidth: 28 });
  for (let n = 3; n >= 1 && diff.rows > 5; n--) diff = unifiedDiff(a, b, { context: 0, maxLines: n, lineWidth: 28 });
  const full = unifiedDiff(a, b, { maxLines: 400, maxChars: 9500 });
  const others = hits.slice(1).map((h) => h.rel);
  const what = others.length ? `${rel} and ${others.length} more protected file${others.length === 1 ? '' : 's'}` : rel;
  return {
    hold: {
      kind: 'file',
      question: `Change ${what}, which the studio protects?`,
      title: `Protected: ${rel.split('/').slice(-2).join('/')}${others.length ? ` +${others.length}` : ''}`,
      lines: [
        { k: 'Rule', v: glob },
        { k: edit.tool, v: `+${diff.added} −${diff.removed} lines by ${edit.by === 'a subagent' ? 'a subagent' : edit.by ?? 'Claude'}`, style: { color: 'yellow' } },
      ],
      diff,
      more: diff.shownChanges < full.added + full.removed ? `… ${full.added + full.removed - diff.shownChanges} more changed lines: Hold pane` : 'with its context in the Hold pane',
      detail: {
        lines: [
          { k: 'File', v: rel },
          { k: 'Rule', v: `studio.json "protect": "${glob}"` },
          { k: 'Change', v: `${edit.tool}${before ? '' : ' (a new file)'} · +${full.added} −${full.removed} lines`, style: { color: 'yellow' } },
          ...(others.length ? [{ k: 'Also', v: hits.slice(1).map((h) => `${h.rel} ("${h.glob}")`).join(', '), style: { color: 'yellow' } }] : []),
          { k: 'By', v: edit.byLong ?? edit.by ?? 'Claude' },
        ],
        full,
      },
      no: `The person said no to this change to ${what} (studio.json "protect": "${glob}"). Do not retry it unless they ask; say what you wanted to change and why.`,
      nobody: `${rel} is protected by studio.json ("protect": "${glob}"), and nobody could be asked here, so the change was not made. Ask the person in chat first.`,
    },
  };
}

/** The mod's (and Codex's) reading of a Claude Code edit tool's input, as a change list for editDecision. */
export function claudeEditOf(tool, input) {
  const path = String(input?.file_path ?? input?.notebook_path ?? '');
  if (tool === 'NotebookEdit') return { tool, changes: [{ path, notebook: true, a: '', b: String(input?.new_source ?? ''), apply: () => null }] };
  return { tool, changes: [{ path, apply: (before) => applyEdit(tool, before, input ?? {}), old: input?.old_string, new: input?.new_string }] };
}

/* ------------------------------------------------------------------ big files into git */

const BIG_FILE = 5 * 1024 * 1024;

/**
 * A `git add` or `git commit` in a studio that would put a file over 5 MB under games/ into git: refused, naming each
 * file and its size. What gets staged is read from git itself (read-only): the index for a commit, `status` for a
 * folder or `-A`; the sizes from the files.
 */
export async function bigFilesDecision(io, ctx, stages) {
  const big = new Map();
  for (const st of stages.slice(0, 6)) {
    const here = ctx.cwd ?? ctx.root;
    const base = st.dir ? (st.dir.startsWith('/') ? st.dir : `${here}/${st.dir}`) : here;
    if (!base) continue;
    const root = await studioRootOf(io, base);
    if (!root) continue;
    const git = async (dir, args) => { try { const r = await io.run(['git', '-C', dir, ...args], { timeoutMs: 15_000 }); return r.exitCode === 0 ? String(r.stdout ?? '') : ''; } catch { return ''; } };
    // git names files from the top of the repository; the studio may sit inside a bigger one.
    const prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim();
    const files = new Set();
    const listed = async (dir, args, mode) => {
      // `-z` entries: a path (diff), or "XY path" (status; a rename or copy is followed by its old path, which is
      // skipped). A deleted file has no size; `tracked` leaves out untracked files ("??").
      const parts = (await git(dir, args)).split('\0');
      for (let i = 0; i < parts.length; i++) {
        let p = parts[i];
        if (!p) continue;
        if (mode) {
          const xy = p.slice(0, 2);
          if (/^[RC]/.test(xy)) i++;
          if (xy.includes('D') || (mode === 'tracked' && xy === '??')) continue;
          p = p.slice(3);
        }
        if (p.startsWith(prefix)) files.add(`${root}/${p.slice(prefix.length)}`);
      }
    };
    if (st.verb === 'commit') {
      await listed(root, ['diff', '--cached', '--name-only', '-z'], null);
      if (st.all) await listed(root, ['diff', '--name-only', '-z'], null);
    } else if (st.all && !st.paths.length) {
      await listed(root, ['status', '--porcelain', '-z', '--untracked-files=all', '--', 'games'], st.all);
    }
    // A commit names only files git tracks; `add -u` only those too.
    const mode = st.verb === 'commit' || st.all === 'tracked' ? 'tracked' : 'all';
    for (const p of st.paths.slice(0, 200)) {
      const abs = normalPath(p.startsWith('/') ? p : `${base}/${p}`);
      let kind = null;
      try { kind = (await io.stat(abs)).kind; } catch { kind = null; }
      if (kind === 'file') files.add(abs);
      // A folder, a glob, or a path only git knows (git expands pathspecs itself).
      else await listed(base, ['status', '--porcelain', '-z', '--untracked-files=all', '--', abs === root ? 'games' : p], mode);
    }
    let n = 0;
    for (const f of files) {
      const abs = normalPath(f);
      if (!inside(`${root}/games`, abs) || big.has(abs) || ++n > 2000) continue;
      let size = 0;
      try { size = Number((await io.stat(abs)).size) || 0; } catch { size = 0; }
      if (size > BIG_FILE) big.set(abs, { rel: abs.slice(root.length + 1), size });
    }
  }
  if (!big.size) return null;
  const named = [...big.values()].map((b) => `${b.rel} (${(b.size / 1024 / 1024).toFixed(1)} MB)`);
  return { deny: `Not run: ${named.join(', ')} ${big.size === 1 ? 'is' : 'are'} over 5 MB under games/, and a studio keeps big files out of git. Big files go to the studio's R2 (homie-studio storage add, then media move); raw models stay in art/<slug>/raw/ (git-ignored); a shipped model is made phone-sized with homie-studio assets optimise.` };
}

/* ------------------------------------------------------------------ deploys */

/**
 * The licences a deploy ships: every public game's assets/manifest.json (game.json `launch` not private or invite,
 * `share.source` not false). { count, games, problems: [{ game, asset, problem }] }.
 */
export async function licenceFacts(io, root) {
  const out = { count: 0, games: 0, problems: [] };
  let dirs = [];
  try { dirs = await io.list(`${root}/games`); } catch { dirs = []; }
  for (const d of dirs.slice(0, 200)) {
    if (d.kind === 'file' || !GAME_ID.test(d.name)) continue;
    if (!publicSource(await readJson(io, `${root}/games/${d.name}/game.json`))) continue;
    const path = `${root}/games/${d.name}/assets/manifest.json`;
    if (!(await io.exists(path))) continue;
    const r = licenceIssues(await readJson(io, path));
    out.count += r.count;
    out.games++;
    for (const p of r.problems) out.problems.push({ game: d.name, ...p });
  }
  return out;
}

/**
 * What a deploy would change, from the studio's own files, git and (in the mod) its live site. `known` is what the
 * caller already holds: { studio, local, live, stored: { commit, at } (the mod's record of its last deploy), liveIds
 * (games the live site has), games (this studio's), feed, last, playing }.
 */
export async function deployFacts(io, root, known = {}) {
  const studio = known.studio ?? (await readJson(io, `${root}/studio.json`)) ?? {};
  const local = known.local ?? (await readJson(io, `${root}/.studio/local.json`)) ?? {};
  const live = known.live !== undefined ? known.live : liveSite(studio, local);
  const created = Array.isArray(studio.cloudflare?.created) ? studio.cloudflare.created : [];
  const first = created.length ? null : `on the Cloudflare account Wrangler is signed in to: Worker ${studio.cloudflare?.worker ?? '?'}, D1 ${studio.cloudflare?.d1 ?? '?'}, Durable Objects Table and Lobby (free plan, no payment method)`;
  const where = live ? live.replace(/^https:\/\//, '') : 'a new workers.dev address (the first deploy makes it)';
  const git = async (args) => { try { const r = await io.run(['git', '-C', root, ...args], { timeoutMs: 10_000 }); return r.exitCode === 0 ? r.stdout : null; } catch { return null; } };
  const stored = known.stored ?? null;
  const since = stored?.commit ?? null;
  let commits = [];
  let diffstat = null;
  if (since) {
    commits = String((await git(['log', '--oneline', '--no-decorate', `${since}..HEAD`])) ?? '').split('\n').filter(Boolean);
    diffstat = String((await git(['diff', '--shortstat', since])) ?? '').trim() || null;
  } else if (local?.deployedAt) {
    commits = String((await git(['log', '--oneline', '--no-decorate', `--since=${local.deployedAt}`])) ?? '').split('\n').filter(Boolean);
  }
  const uncommitted = String((await git(['status', '--porcelain'])) ?? '').split('\n').filter((l) => l.trim() && !/\.studio\//.test(l)).length;
  const liveIds = new Set(known.liveIds ?? []);
  const newGames = live && liveIds.size ? (known.games ?? []).filter((g) => !g.planned && !liveIds.has(g.id)).map((g) => g.id) : [];
  const recent = [known.feed, known.last].filter(Boolean).map((d) => summarize(d)).find((b) => b.counts.total);
  const checks = recent ? `${recent.title}: ${recent.counts.pass}/${recent.counts.total} passed${recent.counts.fail ? `, ${recent.counts.fail} failing` : ''} (${ago(recent.endedAt ?? recent.updatedAt, Date.now())})` : 'no two-browser check on record here';
  const checksShort = recent ? `${recent.counts.pass}/${recent.counts.total} passed · ${ago(recent.endedAt ?? recent.updatedAt, Date.now())}` : 'none on record';
  const stat = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(diffstat ?? '');
  const files = stat ? `${stat[1]} changed, +${stat[2] ?? 0} −${stat[3] ?? 0}` : null;
  const playing = known.playing ?? 0;
  return {
    files, checksShort, lastDeployShort: local?.deployedAt ? ago(local.deployedAt, Date.now()) : stored?.at ? ago(stored.at, Date.now()) : created.length ? 'not from here' : 'never',
    where, first, live, lastDeploy: local?.deployedAt ? `${ago(local.deployedAt, Date.now())} (${local.deployedAt.slice(0, 16).replace('T', ' ')} UTC)` : stored?.at ? ago(stored.at, Date.now()) : created.length ? 'not from this computer' : 'never',
    commits: commits.map((c) => c.replace(/^[0-9a-f]+ /, '')), commitCount: commits.length, diffstat, uncommitted, newGames, checks,
    checksOk: Boolean(recent && !recent.counts.fail && recent.counts.pass === recent.counts.total), playing,
  };
}

/** A production deploy: refused when a public game ships an unlicensed asset, else held with what will change. */
export async function deployDecision(io, root, what, known = {}) {
  // A public game shipping an asset with no allowed licence is refused before anyone is asked.
  const lic = await licenceFacts(io, root);
  if (lic.problems.length) {
    const games = [...new Set(lic.problems.map((p) => p.game))];
    return { deny: `Not deployed: ${lic.problems.length} asset${lic.problems.length === 1 ? '' : 's'} in a public game ${lic.problems.length === 1 ? 'has' : 'have'} no allowed licence: ${lic.problems.slice(0, 12).map((p) => `${p.game}/${p.asset}: ${p.problem}`).join('; ')}${lic.problems.length > 12 ? '; …' : ''}. Fix each with the studio's toolkit (${games.map((g) => `homie-studio assets check ${g}`).join(', ')} says what is wrong and how to fix it), then deploy again.` };
  }
  const licences = lic.count ? `${lic.count} asset${lic.count === 1 ? '' : 's'}, all licensed` : null;
  const d = await deployFacts(io, root, known);
  const name = known.name ?? studioName(known.studio ?? (await readJson(io, `${root}/studio.json`)), root);
  const short = [
    { k: 'Where', v: d.live ? d.where : 'a new workers.dev address', style: { bold: true } },
    ...(d.first ? [{ k: 'Creates', v: 'Worker, D1, rooms (free)', style: { color: 'yellow' } }] : []),
    { k: 'Last', v: d.lastDeployShort },
    ...(d.commitCount ? [{ k: 'Commits', v: `${d.commitCount} since` }] : []),
    ...(d.files ? [{ k: 'Files', v: d.files }] : []),
    ...(d.uncommitted ? [{ k: 'Uncommitted', v: `${d.uncommitted} file${d.uncommitted === 1 ? '' : 's'}`, style: { color: 'yellow' } }] : []),
    ...(d.newGames.length ? [{ k: 'New', v: d.newGames.join(', '), style: { color: 'green' } }] : []),
    { k: 'Checks', v: d.checksShort, ...(d.checksOk ? {} : { style: { color: 'yellow' } }) },
    ...(licences ? [{ k: 'Licences', v: licences, style: { color: 'green' } }] : []),
    ...(d.playing ? [{ k: 'Playing', v: `${d.playing} ${d.playing === 1 ? 'person' : 'people'} now` }] : []),
  ];
  const long = [
    { k: 'Where', v: d.where, style: { bold: true } },
    ...(d.first ? [{ k: 'Creates', v: d.first, style: { color: 'yellow' } }] : []),
    { k: 'Last deploy', v: d.lastDeploy },
    ...(d.commits.length ? [{ k: 'Commits', v: `${d.commitCount} since then: ${d.commits.slice(0, 6).join(' · ')}${d.commitCount > 6 ? ' …' : ''}` }] : []),
    ...(d.diffstat ? [{ k: 'Files', v: d.diffstat }] : []),
    ...(d.uncommitted ? [{ k: 'Uncommitted', v: `${d.uncommitted} file${d.uncommitted === 1 ? '' : 's'} changed and not committed (deployed as they are now)`, style: { color: 'yellow' } }] : []),
    ...(d.newGames.length ? [{ k: 'New games', v: d.newGames.join(', '), style: { color: 'green' } }] : []),
    { k: 'Checks', v: d.checks, ...(d.checksOk ? {} : { style: { color: 'yellow' } }) },
    ...(licences ? [{ k: 'Licences', v: `${licences} (assets/manifest.json of ${lic.games} public game${lic.games === 1 ? '' : 's'})`, style: { color: 'green' } }] : []),
    ...(d.playing ? [{ k: 'Playing now', v: `${d.playing} ${d.playing === 1 ? 'person' : 'people'} (rooms reconnect and keep their seats)` }] : []),
    `Run as ${known.by ?? 'Claude'} wrote it: ${what}`,
  ];
  return {
    hold: {
      kind: 'deploy',
      question: `Deploy ${name || 'the studio'} to production?`,
      title: `Deploy ${name || 'the studio'}`,
      lines: short,
      detail: { lines: long },
      no: 'The person cancelled this deploy, so nothing went live. Do not retry it unless they ask; say what is ready and what they would get.',
      nobody: 'This deploy needs the person\'s go-ahead and nobody could be asked here, so it did not run. Ask them in chat first.',
    },
  };
}

/* ------------------------------------------------------------------ Cloudflare changes outside the deploy */

/**
 * A change to a studio's Cloudflare account outside its own deploy (lib/commands.mjs says which): held until the person
 * says Proceed. The studio's deploy records what it creates and never touches what it did not; a delete, a secret, a
 * hand rollout or a write to the live database made here goes around that record, and what is deleted does not come
 * back.
 */
export async function cloudflareDecision(io, root, c, studio = null) {
  const s = studio ?? (await readJson(io, `${root}/studio.json`)) ?? {};
  const cf = s.cloudflare ?? {};
  const own = [['Worker', cf.worker, 'Worker'], ['D1 database', cf.d1, 'D1'], ['R2 bucket', cf.r2, 'R2']].filter(([, n]) => n);
  const text = `${(c.names ?? []).join(' ')} ${c.code ?? ''}`;
  const hits = own.filter(([, n]) => (c.names ?? []).includes(n) || (c.code && text.includes(n)));
  const name = studioName(s, root);
  const verb = { delete: 'Delete something on', secret: 'Change a secret on', deploy: 'Roll out a version on', schema: 'Change the live database on', data: 'Write to the live database on' }[c.kind] ?? 'Change something on';
  return {
    hold: {
      kind: 'cloudflare',
      question: `${verb} Cloudflare for ${name}, outside the studio's deploy?`,
      title: `Cloudflare: ${String(c.what).slice(0, 60)}`,
      lines: [
        { k: 'Change', v: String(c.what).slice(0, 80), style: { color: 'yellow', bold: true } },
        ...(hits.length ? [{ k: 'Studio', v: `its own ${hits.map(([, n, short]) => `${short} ${n}`).join(', ')}`, style: { color: 'red' } }] : []),
      ],
      detail: {
        lines: [
          { k: 'Change', v: String(c.what), style: { color: 'yellow', bold: true } },
          ...(hits.length ? [{ k: 'Studio\'s own', v: hits.map(([k, n]) => `${k} ${n}`).join(', '), style: { color: 'red' } }] : []),
          { k: 'Account', v: 'the Cloudflare account this computer is signed in to' },
          { k: 'Call', v: String(c.text ?? '').slice(0, 300) },
          `The studio's deploy (npm run deploy) records what it creates in studio.json and never touches what it did not create; this goes around that record${c.kind === 'delete' ? ', and what is deleted does not come back' : ''}.`,
          'Proceed lets this one call through. Cancel stops it here.',
        ],
      },
      no: `The person said no to this Cloudflare change (${c.what}). Do not retry it unless they ask for it.`,
      nobody: `This changes the Cloudflare account outside the studio's deploy (${c.what}) and nobody could be asked here, so it was not made. Ask the person first; the studio's own Worker, database, storage and secrets change through npm run deploy and homie-studio.`,
    },
  };
}

/* ------------------------------------------------------------------ paid calls */

/** Everything this studio's media jobs have spent in one unit (each job's budget.json `spent`). */
export async function spentAll(io, root, unit) {
  let total = 0;
  for (const kind of ['art', 'videos', 'music']) {
    let dirs = [];
    try { dirs = await io.list(`${root}/${kind}`); } catch { dirs = []; }
    for (const d of dirs.slice(0, 200)) {
      const b = await readJson(io, `${root}/${kind}/${d.name}/budget.json`);
      if (b && b.unit === unit) total += Number(b.spent) || 0;
    }
  }
  return Math.round(total * 10000) / 10000;
}

/**
 * A paid media call: held when it would take the studio, the open build or the job past its budget, or when its
 * cost cannot be read first. The price comes from the skill's own --dry-run (free).
 */
export async function spendDecision(io, ctx, paid) {
  const root = ctx.root;
  const unit = paid.unit;
  const money = (n) => (unit === 'usd' ? `$${Number(n).toFixed(2)}` : `${Math.round(Number(n))} credits`);
  let est = null;
  let basis = '';
  if (!paid.raw && paid.dryRun && root) {
    try {
      const dir = paid.dir ? (paid.dir.startsWith('/') ? paid.dir : `${ctx.cwd}/${paid.dir}`) : ctx.cwd;
      const r = await io.run(paid.dryRun, { cwd: dir, timeoutMs: 45_000 });
      const j = JSON.parse(String(r.stdout).slice(String(r.stdout).indexOf('{')));
      const images = Array.isArray(j?.images) ? j.images.filter((x) => Number.isFinite(Number(x?.price?.usd))) : [];
      if (j?.price && Number.isFinite(Number(j.price.usd))) { est = Number(j.price.usd); basis = j.price.basis ?? ''; }
      // The models skill's `mood` prices one image per style-board direction: the call costs their sum.
      else if (images.length) { est = images.reduce((n, x) => n + Number(x.price.usd), 0); basis = `${images.length} mood image${images.length === 1 ? '' : 's'}`; }
      else if (j?.quote && Number.isFinite(Number(j.quote.music))) { est = Number(j.quote.music); basis = j.quote.basis ?? ''; }
      else { const m = /guess of (\d+) credits/.exec(String(j?.why ?? '')); if (m) { est = Number(m[1]); basis = 'a guess from the length'; } }
    } catch { est = null; }
  }
  const budgets = [];
  if (root) {
    const cap = Number(ctx.studio?.budget?.[unit]);
    if (Number.isFinite(cap) && cap >= 0) budgets.push({ what: 'the studio\'s budget (studio.json "budget")', short: 'Studio', cap, spent: await spentAll(io, root, unit) });
    if (paid.slug) {
      const job = await readJson(io, `${root}/${paid.kind}/${paid.slug}/budget.json`);
      if (job && job.unit === unit && Number.isFinite(Number(job.cap))) budgets.push({ what: `this job's cap (${paid.kind}/${paid.slug})`, short: 'Job', cap: Number(job.cap), spent: Number(job.spent) || 0 });
    }
    if (ctx.feed) {
      const b = summarize(ctx.feed);
      if (b.spend.unit === unit && b.spend.budget !== null) budgets.push({ what: `this build's budget (${b.title})`, short: 'Build', cap: b.spend.budget, spent: b.spend.used });
    }
  }
  const over = est === null ? budgets : budgets.filter((b) => b.spent + est > b.cap + 1e-9);
  const unknown = est === null;
  if (!unknown && !over.length) {
    return budgets.length ? { note: `${paid.provider}: about ${money(est)}${budgets[0] ? ` · ${budgets[0].what.split(' (')[0]}: ${money(budgets[0].spent)} of ${money(budgets[0].cap)} spent` : ''}` } : null;
  }
  if (unknown && !budgets.length && !paid.raw) return null;
  return {
    hold: {
      kind: 'spend',
      question: unknown ? `Make a paid ${paid.provider} call whose cost could not be read first?` : `Spend about ${money(est)} at ${paid.provider}, past the budget?`,
      title: `Paid: ${paid.provider}${paid.model ? ` ${paid.model.split('/').pop()}` : paid.tool ? ` ${paid.tool}` : ''}`,
      lines: [
        { k: 'Cost', v: unknown ? 'unknown (not priced)' : `about ${money(est)}`, style: { color: 'yellow', bold: true } },
        ...budgets.map((b) => ({ k: b.short, v: `${money(b.spent)}${unknown ? '' : ` + ${money(est)}`} of ${money(b.cap)}`, ...(over.includes(b) ? { style: { color: 'red' } } : {}) })),
        { k: 'Account', v: `your own ${paid.provider}` },
      ],
      detail: {
        lines: [
          { k: 'Cost', v: unknown ? (paid.raw ? 'unknown: a request straight at the provider, not priced first' : 'unknown: the skill could not price it') : `about ${money(est)}${basis ? ` (${basis})` : ''}`, style: { color: 'yellow', bold: true } },
          ...budgets.map((b) => ({ k: 'Budget', v: `${b.what}: ${money(b.spent)} of ${money(b.cap)} spent${!unknown && b.spent + est > b.cap ? ` → ${money(b.spent + est)}, over by ${money(b.spent + est - b.cap)}` : ''}`, ...(over.includes(b) ? { style: { color: 'red' } } : {}) })),
          { k: 'Account', v: `the person's own ${paid.provider} account` },
          { k: 'Call', v: String(paid.text ?? paid.tool ?? '').slice(0, 300) },
          'Proceed lets this one call through (a job\'s own cap still applies: the skill refuses past it). Cancel stops it here.',
        ],
      },
      no: `The person said no to this ${paid.provider} call (${unknown ? 'its cost could not be read first' : `about ${money(est)}, past the budget`}). Do not retry it unless they raise the budget or ask for it.`,
      nobody: `This ${paid.provider} call would pass the studio's budget, or its cost is unknown, and nobody could be asked here, so it was not made. Ask the person first.`,
    },
  };
}

/* ------------------------------------------------------------------ a Clef model download */

/** Ollama's address on this computer: the default port, or a loopback OLLAMA_HOST the command sets; null for any other host. */
export function ollamaBase(host) {
  if (!host) return 'http://127.0.0.1:11434';
  const m = /^(?:http:\/\/)?(127\.0\.0\.1|localhost)(?::(\d{2,5}))?\/?$/.exec(String(host).trim());
  return m ? `http://${m[1]}:${m[2] ?? '11434'}` : null;
}

/**
 * A Clef model downloaded through Ollama (lib/commands.mjs says which): held until the person says Proceed, with its
 * size. Homie never downloads a model by itself. `ollama run` downloads only a model Ollama does not have, so it goes
 * through when Ollama's own list on this computer (GET /api/tags, loopback only) already has that model; a pull is
 * always held (it fetches a newer copy when there is one).
 */
export async function modelPullDecision(io, pull) {
  const base = ollamaBase(pull.host);
  const tags = base ? await io.fetchJson(`${base}/api/tags`) : null;
  const names = Array.isArray(tags?.models) ? tags.models.map((m) => String(m?.name ?? m?.model ?? '')) : null;
  const want = `${pull.model}:${pull.tag ?? 'latest'}`;
  const have = names ? names.includes(want) || (!pull.tag && names.includes(pull.model)) : false;
  if (pull.verb === 'run' && have) return null;
  const here = have ? 'already on this computer: a pull fetches a newer copy when there is one' : names ? 'not on this computer yet' : 'Ollama did not say (not running, or not on its usual port)';
  return {
    hold: {
      kind: 'model',
      question: `Download ${pull.model} (${pull.size}) to this computer with Ollama?`,
      title: `Download ${pull.model}, ${pull.size.replace(/^about /, '~')}`,
      lines: [
        { k: 'Size', v: `${pull.size} on this computer's disk`, style: { color: 'yellow', bold: true } },
        { k: 'Model', v: `${pull.ref} (Clef, ${pull.params})` },
        { k: 'Here', v: here },
      ],
      detail: {
        lines: [
          { k: 'Size', v: `${pull.size}, downloaded to this computer's disk`, style: { color: 'yellow', bold: true } },
          { k: 'Model', v: `${pull.ref}: Cloudflare's Clef decision model, the ${pull.params}, through Ollama` },
          { k: 'Here', v: here },
          { k: 'Call', v: String(pull.text ?? '').slice(0, 300) },
          'Homie never downloads a model by itself: the person says yes to the size first. Without it, AI guides and game decisions under dev play from the game\'s script, and the deployed studio still thinks with its own Workers AI.',
          'Proceed lets this one download through. Cancel stops it here.',
        ],
      },
      no: `The person said no to downloading ${pull.model} (${pull.size}). Do not retry it unless they ask for it; under dev the guides and game decisions play from the game's script without it.`,
      nobody: `This downloads ${pull.model} (${pull.size}) to this computer and nobody could be asked here, so it did not run. Ask the person first, and say the size.`,
    },
  };
}

/* ------------------------------------------------------------------ one call, in the order both apps check it */

/**
 * A shell command line, checked as the mod's Bash guard checks it: big files into git, a production deploy (refused
 * for an unlicensed asset, else held), a change to the Cloudflare account outside the deploy, a paid call, a Clef
 * download. { decision, deploy: { root } | null }: `deploy` is set when the command is a studio's deploy (the mod
 * records the commit after it ran), and then nothing after the deploy is checked. `known` is what the caller knows
 * about a deploy (deployFacts), or a function of the deploy's studio folder that gives it.
 */
export async function shellDecision(io, ctx, command, known = {}) {
  const g = ctx.guards;
  const stages = g.guardFiles ? gitStagesOf(command) : [];
  if (stages.length) {
    const big = await bigFilesDecision(io, ctx, stages);
    if (big) return { decision: big, deploy: null };
  }
  const deploy = g.guardDeploys ? deployOf(command) : null;
  if (deploy) {
    const root = await studioFor(io, ctx, deploy.dir);
    if (root) {
      const k = typeof known === 'function' ? await known(root) : known;
      const own = root === ctx.root ? { studio: ctx.studio, local: ctx.local, name: ctx.name, feed: ctx.feed, last: ctx.last, ...k } : k;
      return { decision: await deployDecision(io, root, deploy.what, own), deploy: { root } };
    }
  }
  const change = g.guardDeploys ? cloudflareChangeOf(command) : null;
  if (change) {
    const root = await studioFor(io, ctx, change.dir);
    if (root) return { decision: await cloudflareDecision(io, root, change, root === ctx.root ? ctx.studio : null), deploy: null };
  }
  const paid = g.guardSpend ? paidOf(command) : null;
  if (paid) {
    const d = await spendDecision(io, ctx, paid);
    if (d) return { decision: d, deploy: null };
  }
  const pull = g.guardSpend ? modelPullOf(command) : null;
  if (pull) {
    const d = await modelPullDecision(io, pull);
    if (d) return { decision: d, deploy: null };
  }
  return { decision: null, deploy: null };
}

/**
 * The MCP tools a hold looks at, by the pattern of their name (`mcp__<server>__<tool>`). The mod's `tool.call` filters
 * are these same patterns, written out (test/mod-lib.test.mjs checks that they match).
 */
export const MCP_TOOLS = Object.freeze({
  deploy: /^mcp__.+__studio_deploy$/,
  stripe: /^mcp__.*stripe.*__stripe_api_write$/i,
  paid: /^mcp__.*(?:fal|eleven|tripo).*__/i,
  cloudflare: /^mcp__.*cloudflare.*__/i,
  feedback: /^mcp__.*homie.*__homie_feedback$/,
});

/**
 * Tell Homie (lib/feedback.mjs): a homie_feedback send leaves only on the person's own yes, given with the note's exact
 * words in front of them: Claude Code's question (Send / Don't send), Codex's "proceed <code>". The words are the
 * call's own, cleaned as the server will clean them, or, for a send that names only its draft, the draft the app saw
 * (`seen`). A draft or a decline sends nothing and is not held. No switch turns this off.
 */
export function feedbackDecision(tool, input, { seen = null } = {}) {
  if (!MCP_TOOLS.feedback.test(String(tool ?? '')) || input?.action !== 'send') return null;
  const c = input.text
    ? cleanNote({ kind: input.kind, text: input.text, step: input.step, email: input.email, offered: input.offered === true, studioVersion: input.studioVersion, pluginVersion: input.pluginVersion, app: input.app })
    : seen?.note ? { ok: true, note: seen.note } : null;
  if (!c?.ok) return { deny: c ? `Not sent: ${c.why}.` : 'Not sent: send the note with its kind and text (as drafted), so the person sees exactly what would go.' };
  // The same words as the draft the app saw: its own facts (the server's versions and app) are what goes with them.
  if (seen?.note && seen.note.text === c.note.text && seen.note.kind === c.note.kind) c.note = seen.note;
  const words = c.note.text.split('\n');
  return {
    hold: {
      kind: 'feedback',
      question: 'Send this note to Homie?',
      title: 'Tell Homie: send this note?',
      options: ['Send', 'Don\u2019t send'],
      yes: 'Send',
      lines: [{ k: 'Kind', v: KIND_LABEL[c.note.kind] ?? c.note.kind }, ...words.slice(0, 6).map((l, i) => ({ k: i ? ' ' : 'Note', v: l || ' ' }))],
      more: 'the whole note, and what goes with it, in the Hold pane',
      detail: { lines: [{ k: 'Kind', v: KIND_LABEL[c.note.kind] ?? c.note.kind }, ...words.map((l) => `  ${l}`), { k: 'With it', v: withLine(c.note) }, 'Only the person\'s yes sends it: privately, to the people who make Homie.'] },
      no: 'The person chose not to send it. Nothing was sent. Tell them so in a few words, and do not offer to send a note again in this session.',
      nobody: 'Nothing is sent to Homie without the person\'s own yes, and nobody could be asked here. Nothing was sent.',
    },
  };
}

/** The Homie MCP's studio_deploy: a production deploy of the session's studio. */
export async function mcpDeployDecision(io, ctx, known = {}) {
  if (!ctx.guards.guardDeploys || !ctx.root) return null;
  return deployDecision(io, ctx.root, 'studio_deploy', { studio: ctx.studio, local: ctx.local, name: ctx.name, feed: ctx.feed, last: ctx.last, ...known });
}

/** A write through Stripe's MCP that would hand back a webhook's signing secret: refused, always. */
export function stripeDecision(tool, input) {
  const why = stripeSecretWriteOf(tool, input);
  return why ? { deny: why } : null;
}

/** A generating tool of a fal, ElevenLabs or Tripo MCP server: held past the budget, or when it cannot be priced. */
export async function paidMcpDecision(io, ctx, tool, input) {
  const paid = ctx.guards.guardSpend ? paidMcpOf(tool, input) : null;
  return paid ? spendDecision(io, ctx, paid) : null;
}

/** A Cloudflare MCP tool (Cloudflare's own servers, a claude.ai connector) changing the account, inside a studio. */
export async function cloudflareMcpDecision(io, ctx, tool, input) {
  const change = ctx.guards.guardDeploys && ctx.root ? cloudflareMcpChangeOf(tool, input) : null;
  return change ? cloudflareDecision(io, ctx.root, change, ctx.studio) : null;
}

/**
 * An MCP tool call, checked as the mod checks one: the Homie MCP's studio_deploy, a note to Homie (homie_feedback send,
 * held for the person's own yes), a write through Stripe's MCP that would hand back a webhook's signing secret
 * (refused), a paid call at fal, ElevenLabs or Tripo, and a change through a Cloudflare MCP server inside a studio. { decision, deploy: { root } | null }; the first that decides wins.
 */
export async function mcpDecision(io, ctx, tool, input, known = {}) {
  const t = String(tool ?? '');
  if (MCP_TOOLS.deploy.test(t)) {
    const d = await mcpDeployDecision(io, ctx, typeof known === 'function' ? await known(ctx.root) : known);
    return { decision: d, deploy: d && ctx.root ? { root: ctx.root } : null };
  }
  const checks = [
    [MCP_TOOLS.feedback, () => feedbackDecision(t, input)],
    [MCP_TOOLS.stripe, () => stripeDecision(t, input)],
    [MCP_TOOLS.paid, () => paidMcpDecision(io, ctx, t, input)],
    [MCP_TOOLS.cloudflare, () => cloudflareMcpDecision(io, ctx, t, input)],
  ];
  for (const [re, check] of checks) {
    if (!re.test(t)) continue;
    const d = await check();
    if (d) return { decision: d, deploy: null };
  }
  return { decision: null, deploy: null };
}
