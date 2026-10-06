/**
 * Art direction, as the mod reads it. The studio toolkit writes `.studio/art/<game>/latest.json` after every
 * `homie-studio style …` and `assets …` command (lib/art-cli.mjs `writeArtSummary`): the phase strip, the look line,
 * the decisions, the cast, the scene budgets, the spend and the licence problems in one small file. The mod did not
 * write it, so every field is checked here before anything is drawn. Also the plain parts of the art guards: which
 * locked decisions an edit to `decisions.json` would change, and what a public game ships without an allowed
 * licence. Plain functions: no `$`, no I/O.
 */
import { ago } from './feed.mjs';

export const GAME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DECISION_ID = /^[a-z]+(?:\.[a-z0-9-]{1,40}){1,2}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const STATES = ['auto', 'steered', 'pinned', 'locked'];
const PHASES = ['style', 'cast', 'rigs', 'animations', 'game'];
const ROUTES = ['procedural', 'library', 'generated', 'imported', 'premium'];

/** The state marks the toolkit prints too (art-cli.mjs `artLines`). */
export const MARK = { auto: '·', steered: '~', pinned: '●', locked: '■' };
export const LEGEND = '· auto  ~ steered  ● pinned by use  ■ locked by the person';
export const BY = { ai: 'AI', person: 'the person', use: 'by use' };

// A string from the file without terminal escapes or control characters (a label would draw them), cut to `n`.
const str = (v, n = 120) => (typeof v === 'string' ? v.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, n) || null : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
// A studio-relative path to show (never followed): no absolute path, no "..".
const relPath = (v) => { const s = str(v, 200); return s && !s.startsWith('/') && !s.split('/').includes('..') ? s : null; };
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, num(o?.[k]) !== null && o[k] >= 0 ? o[k] : null]));

const TOTALS = ['assets', 'triangles', 'drawCalls', 'textureMB', 'firstPlayMB'];
const BUDGETS = ['drawCalls', 'triangles', 'textureMB', 'firstPlayMB'];

/** One latest.json as the Art tab shows it, every field checked; null when it is not one (it is then ignored). */
export function artSummaryOf(l, id) {
  if (!l || typeof l !== 'object' || l.v !== 1 || typeof l.at !== 'string' || !Number.isFinite(Date.parse(l.at)) || !GAME_ID.test(String(id))) return null;
  if (l.game !== undefined && l.game !== id) return null;
  const phases = list(l.phases, 8).flatMap((p) => {
    const total = count(p?.total);
    const settled = count(p?.settled);
    if (!PHASES.includes(p?.id) || total === null || settled === null || settled > total) return [];
    return [{ id: p.id, label: str(p.label, 24) ?? p.id, total, settled, locked: Math.min(count(p.locked) ?? 0, total) }];
  });
  const decisions = list(l.decisions, 8).flatMap((g) => {
    if (!PHASES.includes(g?.phase)) return [];
    const rows = list(g.rows, 40).flatMap((r) => {
      if (typeof r?.id !== 'string' || !DECISION_ID.test(r.id) || !STATES.includes(r.state)) return [];
      const colours = Array.isArray(r.colours) ? r.colours.filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, 8) : null;
      return [{ id: r.id, name: str(r.name, 32) ?? r.id.split('.').pop(), label: str(r.label, 100) ?? '', state: r.state, by: Object.hasOwn(BY, r.by) ? r.by : null, colours: colours?.length ? colours : null }];
    });
    return [{ phase: g.phase, label: str(g.label, 24) ?? g.phase, rows }];
  });
  const cast = list(l.cast, 80).flatMap((a) => {
    if (typeof a?.id !== 'string' || !GAME_ID.test(a.id)) return [];
    return [{ id: a.id, kind: str(a.kind, 16) ?? 'asset', route: ROUTES.includes(a.route) ? a.route : 'unknown', tier: str(a.tier, 16), license: str(a.license, 48), state: str(a.state, 16) ?? 'auto', usd: Math.max(0, num(a.usd) ?? 0) }];
  });
  const licence = list(l.licence, 40).flatMap((x) => {
    const problem = str(x?.problem, 200);
    if (!problem || !['refuse', 'warn'].includes(x.level)) return [];
    return [{ asset: str(x.asset, 120) ?? 'an asset', level: x.level, problem, fix: str(x.fix, 200) }];
  });
  const sp = l.spend && typeof l.spend === 'object' ? l.spend : {};
  const spend = {
    used: Math.max(0, num(sp.used) ?? 0),
    cap: num(sp.cap) !== null && sp.cap >= 0 ? sp.cap : null,
    items: list(sp.items, 50).flatMap((x) => (str(x?.what, 80) && num(x.usd) !== null ? [{ what: str(x.what, 80), usd: Math.max(0, x.usd) }] : [])),
  };
  const c = l.check;
  const check = c && typeof c === 'object' && typeof c.ok === 'boolean'
    ? { ok: c.ok, at: str(c.at, 40), totals: pick(c.totals, TOTALS), budgets: pick(c.budgets, BUDGETS), failing: list(c.failing, 40).filter((f) => typeof f === 'string' && GAME_ID.test(f)) }
    : null;
  const u = l.lineup;
  const lineup = u && typeof u === 'object' && typeof u.at === 'string'
    ? { at: u.at, flagged: count(u.flagged) ?? 0, images: { front: relPath(u.images?.front), quarter: relPath(u.images?.quarter), silhouettes: relPath(u.images?.silhouettes) } }
    : null;
  const b = l.board;
  const directions = b && typeof b === 'object' ? list(b.directions, 6).flatMap((d) => (/^[a-f]$/.test(d?.id) && str(d.label, 100) ? [{ id: d.id, label: str(d.label, 100) }] : [])) : [];
  const board = directions.length ? { chosen: /^[a-f]$/.test(b.chosen) ? b.chosen : null, directions } : null;
  const VERB = /^[a-z][a-z0-9]{1,15}$/;
  const verbs = (v, n = 24) => list(v, n).filter((x) => typeof x === 'string' && VERB.test(x));
  const characters = list(l.characters, 40).flatMap((c) => {
    if (typeof c?.id !== 'string' || !GAME_ID.test(c.id)) return [];
    return [{ id: c.id, kind: str(c.kind, 16) ?? 'character', route: ROUTES.includes(c.route) ? c.route : 'unknown', family: str(c.family, 16), skeleton: str(c.skeleton, 40), bones: count(c.bones), verbs: verbs(c.verbs), missing: verbs(c.missing), retargeted: count(c.retargeted) ?? 0, animsKB: count(c.animsKB) }];
  });
  const k = l.skinning;
  const skinning = k && typeof k === 'object' && count(k.vertices) !== null ? { players: count(k.players) ?? 0, vertices: k.vertices, bones: count(k.bones) ?? 0, budget: { vertices: count(k.budget?.vertices), bones: count(k.budget?.bones) } } : null;
  return {
    game: id, at: l.at, path: ['automatic', 'hands-on'].includes(l.path) ? l.path : null, line: str(l.line, 240),
    phases, decisions, cast, stale: list(l.stale, 80).filter((s) => typeof s === 'string' && GAME_ID.test(s)),
    licence, spend, check, lineup, board, need: verbs(l.need), characters, skinning,
  };
}

/** The phase strip: "Style ✓ → Cast 3/7 → Rigs → Animations → In game" (✓ once every decision of a phase is settled). */
export function phaseStrip(phases) {
  return phases.map((p) => (p.total && p.settled === p.total ? `${p.label} ✓` : p.settled ? `${p.label} ${p.settled}/${p.total}` : p.label)).join(' → ');
}

export const usd = (n) => `$${Number(n).toFixed(2)}`;

/** The games a command means: the one named, else every game with art direction; or why there is none. */
export function artFor(arts, want) {
  const w = String(want ?? '').trim().toLowerCase();
  if (!arts.length) return { why: 'No art direction yet: ask Claude for a look ("make it cozy and low-poly"); the style skill decides it with you (homie-studio style init <game>).' };
  if (!w) return { list: arts };
  const hit = arts.filter((a) => a.game === w);
  return hit.length ? { list: hit } : { why: `${w} has no art direction yet (games with one: ${arts.map((a) => a.game).join(', ')}).` };
}

const title = (a, name) => (name && name !== a.game ? `${name} (${a.game})` : a.game);

/** `/look`: the look line, the phase strip and the style phase's decisions, as text. */
export function lookText(a, name, now) {
  const style = a.decisions.find((d) => d.phase === 'style');
  const rest = a.decisions.filter((d) => d.phase !== 'style' && d.rows.length);
  const more = rest.reduce((n, d) => n + d.rows.length, 0);
  const width = Math.max(8, ...(style?.rows ?? []).map((r) => r.name.length));
  return [
    `${title(a, name)}: ${a.line ?? 'no look line yet'}`,
    `  ${phaseStrip(a.phases)}${a.path ? ` · ${a.path}` : ''} · ${ago(a.at, now)}`,
    ...(style ? [`  ${style.label}:`, ...style.rows.map((r) => `    ${MARK[r.state]} ${r.name.padEnd(width)}  ${r.label}${r.state !== 'auto' && r.by ? `  (${r.state}, ${BY[r.by]})` : ''}`)] : ['  no style decisions yet']),
    ...(more ? [`  + ${more} more decision${more === 1 ? '' : 's'} in ${rest.map((d) => d.label).join(', ')}: npx --no-install homie-studio style ${a.game}`] : []),
    `  ${LEGEND}. /lock <decision> locks one; Unlock in the Studio pane (Art) asks first, with what goes stale.`,
  ].join('\n');
}

/** `/assets`: the cast, the spend and the licence problems, as text. */
export function castText(a, name) {
  const stale = new Set(a.stale);
  const width = Math.max(6, ...a.cast.map((c) => c.id.length));
  const refuse = a.licence.filter((x) => x.level === 'refuse');
  return [
    `${title(a, name)}: ${a.cast.length ? `${a.cast.length} asset${a.cast.length === 1 ? '' : 's'}` : 'no assets yet (homie-studio assets find "<words>" searches the free library)'}`,
    ...a.cast.map((c) => `  ${c.id.padEnd(width)}  ${[c.kind, c.route, c.license ?? 'NO LICENCE', c.state, c.usd ? usd(c.usd) : 'free'].join(' · ')}${stale.has(c.id) ? '  STALE (made under an older decision)' : ''}`),
    `  spent ${usd(a.spend.used)}${a.spend.cap !== null ? ` of ${usd(a.spend.cap)}` : ' (no art budget: free routes only)'}${a.spend.items.length ? ` on ${a.spend.items.length} paid step${a.spend.items.length === 1 ? '' : 's'}` : ''}`,
    ...(a.check ? [`  scene: ${budgetWords(a.check)}`] : []),
    ...(a.licence.length ? [`  licences: ${refuse.length ? `${refuse.length} to fix before a public deploy` : 'warnings only'} (/rights ${a.game})`] : a.cast.length ? ['  licences: every asset recorded and allowed'] : []),
  ].join('\n');
}

/** `/cast`: the characters, each with its skeleton, bones, source and how many of the game's clips it has. */
export function charactersText(a, name) {
  if (!a.characters.length) return `${title(a, name)}: no characters with a rig yet (homie-studio assets find "<words>" --kind character: free, animated, CC0).`;
  const width = Math.max(6, ...a.characters.map((c) => c.id.length));
  return [
    `${title(a, name)}: ${a.characters.length} character${a.characters.length === 1 ? '' : 's'}${a.need.length ? `; the game needs ${a.need.join(', ')}` : ''}`,
    ...a.characters.map((c) => `  ${c.id.padEnd(width)}  ${[c.kind, c.route, `${c.family ?? '?'} skeleton`, `${c.bones ?? '?'} bones`, `${c.verbs.length} clips${c.retargeted ? ` (${c.retargeted} retargeted)` : ''}`].join(' · ')}${c.missing.length ? `  MISSING ${c.missing.join(', ')}` : ''}`),
    ...(a.skinning ? [`  skinning a room of ${a.skinning.players}: ${fmt(a.skinning.vertices)}/${fmt(a.skinning.budget.vertices ?? 0)} vertices, ${fmt(a.skinning.bones)}/${fmt(a.skinning.budget.bones ?? 0)} bones a frame on a phone${a.skinning.budget.vertices !== null && a.skinning.vertices > a.skinning.budget.vertices ? ' (OVER: crowd mode, or lighter characters)' : ''}`] : []),
    '  /clips <game> lists each one\'s clips; ask Claude for the animation card to see them move.',
  ].join('\n');
}

/** `/clips`: every character's clips against the verbs the game needs. */
export function clipsText(a, name) {
  if (!a.characters.length) return `${title(a, name)}: no characters with clips yet.`;
  return [
    `${title(a, name)}: the game needs ${a.need.length ? a.need.join(', ') : '(no anim.clips decision yet)'}`,
    ...a.characters.flatMap((c) => [`  ${c.id} (${c.skeleton ?? c.family ?? '?'}${c.animsKB !== null ? `, ${c.animsKB} KB of clips` : ''})`, `    ${c.verbs.join(', ') || 'no clips'}${c.missing.length ? `  · missing ${c.missing.join(', ')} (homie-studio anim add ${a.game} ${c.id} --verbs ${c.missing.join(',')})` : ''}`]),
  ].join('\n');
}

/** The scene's totals against its budgets in one line: "8/100 draw calls, 898/150,000 triangles, …". */
export function budgetWords(check) {
  return budgetRows(check).map((b) => `${b.value === null ? '?' : fmt(b.value)}/${b.budget === null ? '?' : fmt(b.budget)}${b.unit ? ` ${b.unit}` : ''} ${b.label}${b.over ? ' (OVER)' : ''}`).join(', ');
}

const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(+n.toFixed(1)));

/**
 * The four scene budgets as rows for bars: draw calls, triangles, picture MB, and the shipped payload (every built file
 * gzipped; the check's key for it is still `firstPlayMB`, its old name, and it never was a measured first-play
 * download). All four are the asset check's inventory estimate, not a reading of the running game.
 */
export function budgetRows(check) {
  return [['drawCalls', 'draw calls', ''], ['triangles', 'triangles', ''], ['textureMB', 'picture memory', 'MB'], ['firstPlayMB', 'shipped payload', 'MB']].map(([k, label, unit]) => {
    const value = check.totals[k];
    const budget = check.budgets[k];
    return { key: k, label, unit, value, budget, over: value !== null && budget !== null && value > budget, percent: value !== null && budget ? Math.min(100, (value / budget) * 100) : 0 };
  });
}

/** `/lineup`: the last lineup's flags and its pictures (never rendered here), or how to get one. */
export function lineupText(a, name, now) {
  if (!a.lineup) return `${title(a, name)}: no lineup yet: ask Claude for one (every asset side by side at true scale, silhouettes, palette drift).`;
  const pics = Object.entries(a.lineup.images).filter(([, p]) => p).map(([k, p]) => `    ${k}: ${p}`);
  return [
    `${title(a, name)}: last lineup ${ago(a.lineup.at, now)}: ${a.lineup.flagged ? `${a.lineup.flagged} asset${a.lineup.flagged === 1 ? '' : 's'} flagged` : 'nothing flagged'}.`,
    ...(pics.length ? ['  Pictures (open them yourself):', ...pics] : ['  no pictures recorded']),
  ].join('\n');
}

/** `/rights`: licence problems with their fixes, and where RIGHTS.md is. */
export function rightsText(a, name, hasRights) {
  const rights = `games/${a.game}/assets/RIGHTS.md`;
  return [
    `${title(a, name)}: ${a.licence.length ? `${a.licence.length} licence problem${a.licence.length === 1 ? '' : 's'}` : a.cast.length ? `every asset's licence is recorded and allowed (${a.cast.length})` : 'no assets yet'}`,
    ...a.licence.flatMap((x) => [`  ${x.level === 'refuse' ? '✗' : '!'} ${x.asset}: ${x.problem}`, ...(x.fix ? [`      → ${x.fix}`] : [])]),
    `  ${hasRights ? rights : `${rights} is not written yet: npx --no-install homie-studio assets rights ${a.game}`}`,
  ].join('\n');
}

/* ------------------------------------------------------------------ the lock guard */

/** The game whose decisions.json a studio-relative path is, or null. */
export function decisionsFileOf(rel) {
  const m = /^games\/([a-z0-9][a-z0-9-]{0,63})\/codex\/decisions\.json$/.exec(String(rel ?? ''));
  return m ? m[1] : null;
}

// JSON with every object's keys sorted: the same value written in another order or spacing is the same value.
const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

/**
 * The decisions locked in `before` (decisions.json's text now) whose value or state `after` (its text after the edit)
 * changes or drops: [ids]. Null when something is locked and `after` is not JSON: the toolkit writes this file, and an
 * edit that breaks it cannot be checked. Other edits (anything not locked, a label, a note) change nothing here.
 */
export function lockedChanges(before, after) {
  let doc;
  try { doc = JSON.parse(before); } catch { return []; }
  const decisions = doc && typeof doc.decisions === 'object' && doc.decisions ? doc.decisions : {};
  const locked = Object.keys(decisions).filter((id) => decisions[id]?.state === 'locked');
  if (!locked.length) return [];
  let next;
  try { next = JSON.parse(after); } catch { return null; }
  const now = next && typeof next.decisions === 'object' && next.decisions ? next.decisions : {};
  return locked.filter((id) => !now[id] || now[id].state !== 'locked' || canonical(now[id].value) !== canonical(decisions[id].value));
}

/* ------------------------------------------------------------------ the licence guard */

const KNOWN = new Set(['cc0', 'cc-by-4.0', 'cc-by-3.0', 'own', 'generated', 'qal', 'mixamo', 'other']);
/**
 * A public game: game.json `launch` is not private or invite-only. (It used to matter too whether the game's source
 * was shared, `share.source`; no game's source is shared any more, and that key is ignored.)
 */
export function publicGame(meta) {
  return Boolean(meta && typeof meta === 'object' && !['private', 'invite'].includes(meta.launch));
}

/**
 * What a public game's assets/manifest.json ships that a deploy must not: { count, problems: [{ asset, problem }] }.
 * Refused: no licence, a kind the studio does not know, TurboSquid's EULA (never on the web), and a CC BY asset with
 * no attribution. A licence that forbids handing the file on (Quaternius, Mixamo, a EULA, a bought asset) is no
 * problem here: a game serves its files to its players only, and what may be in a shared part is the toolkit's check.
 */
export function licenceIssues(manifest) {
  const assets = manifest && typeof manifest === 'object' && Array.isArray(manifest.assets) ? manifest.assets : null;
  if (!assets) return { count: 0, problems: [{ asset: 'assets/manifest.json', problem: 'it is not a manifest the toolkit wrote (no "assets" list)' }] };
  const problems = [];
  for (const a of assets.slice(0, 2000)) {
    const id = str(a?.id, 64) ?? '(an asset with no id)';
    const lic = a?.license && typeof a.license === 'object' ? a.license : {};
    const kind = typeof lic.kind === 'string' ? lic.kind : '';
    const eula = /^eula:[a-z0-9-]{1,40}$/.test(kind);
    const market = /^market:[a-z0-9:._-]{1,80}$/.test(kind);
    if (!kind) { problems.push({ asset: id, problem: 'no licence recorded' }); continue; }
    if (kind === 'eula:turbosquid') { problems.push({ asset: id, problem: 'TurboSquid\'s licence never allows a web game to serve the file' }); continue; }
    if (!KNOWN.has(kind) && !eula && !market) { problems.push({ asset: id, problem: `"${str(kind, 40)}" is not a licence kind the studio knows` }); continue; }
    if (kind.startsWith('cc-by') && !str(lic.attribution, 300)) problems.push({ asset: id, problem: `${kind} needs credit, and there is no attribution line` });
  }
  return { count: assets.length, problems };
}
