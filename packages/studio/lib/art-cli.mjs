/**
 * `homie-studio style …` and `homie-studio assets …` (bin/homie-studio.mjs hands both here): art direction as decisions,
 * the style board, the asset list with its licences, the checks and the lineup. Every command that changes something
 * also writes .studio/art/<id>/latest.json, the summary the Studio mod's Art tab and the cards read.
 *
 *   style init <id> [--prompt "<the person's words>"] [--hands-on] [--budget <usd>]
 *   style [show] <id> [--phase style|cast|rigs|animations|game]
 *   style set <id> <decision> <value> [--by person] [--why "…"] [--unlock --reason "…" [--confirm]]
 *   style steer <id> <decision> "<words>"            ("warmer", "less saturated", "closer", "golden hour", …)
 *   style lock <id> <decision>|style --words "<what the person said>"
 *   style unlock <id> <decision> --reason "<why>"
 *   style board <id> [--prompt "…"]                   three directions drawn by the engine (free)
 *   style pick <id> <a|b|c> [--mix style.palette=b,style.camera=c]
 *   style mood <id> <a|b|c> --image <file> [--usd <n>] [--receipt <file>] [--model <endpoint>]
 *   style golden <id> add <image> | list
 *   style blast <id> <decision>                       what changing it makes stale, and what remaking costs
 *   style prompt <id>                                 the derived style prompt every generation call starts from
 *
 *   assets [list] <id>
 *   assets find "<words>" [--kind prop] [--family kenney] [--limit 12]
 *   assets add <id> <library item> [--as <id>] [--height <m>] [--card "Items/Berry"]
 *   assets add <id> --file <model> --license <kind> [--attribution "…"] [--kind prop] [--as <id>] [--height <m>]
 *                   [--triangles <n>] [--texture <px>] [--route imported|generated] [--steps <steps.json>] [--concept <image>]
 *   assets optimise <in> --out <file> [--triangles 1500] [--texture 512] [--height <m>]
 *   assets check <id>       budgets, validator, licences, staleness, scene totals, big files
 *   assets lineup <id>      the lineup, silhouettes and palette drift (pictures in .studio/art/<id>/)
 *   assets review <id> --score <1-10> [--outliers a,b] [--note "…"]
 *   assets rights <id>      RIGHTS.md and credits.json written from the manifest
 *   assets stale <id>       assets made under an older decision
 *   assets redo <id> <asset>            made again from its kept raw file (free): today's budgets and render style
 *   assets remove <id> <asset>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { licenceProblems, readManifest, removeAsset, rightsMarkdown, syncCredits, writeRights } from './asset-manifest.mjs';
import { CATALOGUE_IDS, PHASES, blastRadius, decisionRows, derivedPrompt, initDecisions, lockDecision, oneLine, phaseProgress, pickDirection, readDecisions, setDecision, staleAssets, steerDecision, unlockDecision } from './decisions.mjs';
import { listGames } from './studio.mjs';
import { checkLines } from './asset-check.mjs';

/** The game a command means: the one named, else the only one. */
function gameOf(root, id, command) {
  const games = listGames(root);
  const planned = id && existsSync(join(root, 'games', id, 'CODEX.md'));
  if (id && (games.some((g) => g.id === id) || planned)) return id;
  if (!id && games.length === 1) return games[0].id;
  throw new Error(`name the game: homie-studio ${command} <id>${games.length ? ` (${games.map((g) => g.id).join(', ')})` : ''}`);
}

/**
 * Spend on a game's art, from the receipts (art/receipts.jsonl lines naming the game: every paid call, a redo too),
 * against the cap the person agreed to (art/<game>-models/budget.json, else the decisions' art budget). A studio
 * whose older receipts name no game falls back to its assets' recorded steps.
 */
export function artSpend(root, id) {
  const doc = readDecisions(root, id);
  const items = [];
  try {
    for (const line of readFileSync(join(root, 'art', 'receipts.jsonl'), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r = null;
      try { r = JSON.parse(line); } catch { continue; }
      if (r?.game === id && Number(r.cost) > 0 && r.unit === 'usd') items.push({ what: r.what ?? r.artifact ?? r.model, usd: Number(r.cost), receipt: r.requestId ?? null, at: r.at });
    }
  } catch { /* no receipts yet */ }
  if (!items.length) {
    for (const a of readManifest(root, id).assets) for (const s of a.made?.steps ?? []) if (Number(s.usd) > 0) items.push({ what: `${a.id}: ${s.what}`, usd: Number(s.usd), receipt: s.receipt ?? null });
    for (const d of doc?.board?.directions ?? []) if (Number(d.mood?.usd) > 0) items.push({ what: `mood image ${d.id}`, usd: Number(d.mood.usd), receipt: d.mood.receipt ?? null });
  }
  let cap = doc?.budget?.usd ?? null;
  try { const b = JSON.parse(readFileSync(join(root, 'art', `${id}-models`, 'budget.json'), 'utf8')); if (Number.isFinite(Number(b.cap))) cap = Number(b.cap); } catch { /* the decisions' budget */ }
  return { used: +items.reduce((n, x) => n + x.usd, 0).toFixed(3), cap, items };
}

/** .studio/art/<id>/latest.json: what the mod's Art tab and the cards show, without reading a dozen files. */
export function writeArtSummary(root, id) {
  try {
    const doc = readDecisions(root, id);
    const manifest = readManifest(root, id);
    const dir = join(root, '.studio', 'art', id);
    mkdirSync(dir, { recursive: true });
    const readJson = (f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } };
    const check = readJson('check.json');
    const lineup = readJson('lineup.json');
    const summary = {
      v: 1, game: id, at: new Date().toISOString(), path: doc?.path ?? null, line: doc ? oneLine(doc) : null,
      phases: doc ? PHASES.map((p) => ({ ...p, ...phaseProgress(doc)[p.id] })) : [],
      decisions: decisionRows(doc).map((p) => ({ phase: p.id, label: p.label, rows: p.rows.map(({ id: d, name, label, state, by, colours }) => ({ id: d, name, label, state, by, colours })) })),
      cast: manifest.assets.map((a) => ({ id: a.id, kind: a.kind, route: a.route, tier: a.tier ?? null, license: a.license?.kind ?? null, state: a.review?.state ?? 'auto', usd: +(a.made?.steps ?? []).reduce((n, s) => n + (Number(s.usd) || 0), 0).toFixed(3) })),
      stale: doc ? staleAssets(doc, manifest).map((s) => s.id) : [],
      licence: licenceProblems(root, id, manifest),
      spend: artSpend(root, id),
      check: check ? { ok: check.ok, at: check.at, totals: check.totals, budgets: { drawCalls: check.budgets?.drawCalls, triangles: check.budgets?.triangles, textureMB: check.budgets?.textureMB, firstPlayMB: check.budgets?.firstPlayMB }, failing: check.rows.filter((r) => !r.ok).map((r) => r.id) } : null,
      lineup: lineup ? { at: lineup.at, flagged: lineup.flagged, images: lineup.images } : null,
      board: doc?.board ? { chosen: doc.board.chosen, directions: doc.board.directions.map((d) => ({ id: d.id, label: d.label, swatch: d.swatch, mood: d.mood?.path ?? null })) } : null,
    };
    writeFileSync(join(dir, 'latest.json'), `${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  } catch { return null; }
}

const list = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export async function styleCommand(root, sub, positional, flags, { log = () => {} } = {}) {
  const known = ['init', 'show', 'set', 'steer', 'lock', 'unlock', 'board', 'pick', 'mood', 'golden', 'blast', 'prompt'];
  const verb = known.includes(sub) ? sub : 'show';
  const args = known.includes(sub) ? positional.slice(2) : positional.slice(1);
  const id = gameOf(root, args[0], `style ${verb}`);
  const manifest = () => readManifest(root, id);
  let r;
  if (verb === 'init') r = initDecisions(root, id, { prompt: String(flags.get('prompt') ?? ''), path: flags.has('hands-on') ? 'hands-on' : flags.has('automatic') ? 'automatic' : null, budget: flags.has('budget') ? Number(flags.get('budget')) : null });
  else if (verb === 'show') {
    const doc = readDecisions(root, id);
    if (!doc) return { ok: false, command: 'style', why: `games/${id} has no decisions yet: homie-studio style init ${id} --prompt "<the person's words>"` };
    const phase = flags.get('phase') ?? null;
    r = { ok: true, command: 'style', id, line: oneLine(doc), path: doc.path, budget: doc.budget, phases: decisionRows(doc).filter((p) => !phase || p.id === phase), progress: phaseProgress(doc), prompt: doc.derived?.prompt ?? null, board: doc.board ? { chosen: doc.board.chosen, directions: doc.board.directions.map((d) => ({ id: d.id, label: d.label, swatch: d.swatch, mood: d.mood?.path ?? null })) } : null, golden: doc.golden ?? [], stale: staleAssets(doc, manifest()) };
  } else if (verb === 'set') {
    if (!args[1] || args[2] === undefined) return { ok: false, command: 'style set', why: `usage: homie-studio style set <id> <decision> <value> (decisions: ${CATALOGUE_IDS.slice(0, 10).join(', ')}, …)` };
    r = setDecision(root, id, args[1], args.slice(2).join(' '), { by: flags.get('by') === 'person' ? 'person' : 'ai', why: flags.get('why') ?? null, words: flags.get('words') ?? null, unlock: flags.has('unlock'), reason: flags.get('reason') ?? null, confirm: flags.has('confirm'), manifest: manifest() });
  } else if (verb === 'steer') r = steerDecision(root, id, args[1], args.slice(2).join(' ') || String(flags.get('words') ?? ''), { manifest: manifest() });
  else if (verb === 'lock') r = lockDecision(root, id, args[1] ?? 'style', { by: 'person', words: flags.get('words') ?? null });
  else if (verb === 'unlock') r = unlockDecision(root, id, args[1], { reason: flags.get('reason') ?? null, by: 'person' });
  else if (verb === 'board') { const { styleBoard } = await import('./style-board.mjs'); r = await styleBoard(root, id, { prompt: String(flags.get('prompt') ?? ''), log, library: !flags.has('no-library') }); }
  else if (verb === 'pick') {
    const mixes = Object.fromEntries(list(flags.get('mix')).map((x) => x.split('=')).filter(([k, v]) => k && v));
    r = pickDirection(root, id, args[1] && !args[1].includes('=') ? args[1] : null, { mixes, manifest: manifest() });
  } else if (verb === 'mood') { const { recordMood } = await import('./style-board.mjs'); r = await recordMood(root, id, args[1], resolve(String(flags.get('image') ?? '')), { usd: flags.get('usd') ?? null, receipt: flags.get('receipt') ?? null, model: flags.get('model') ?? null }); }
  else if (verb === 'golden') {
    if (args[1] === 'add') { const { addGolden } = await import('./style-board.mjs'); r = await addGolden(root, id, resolve(String(args[2] ?? flags.get('image') ?? '')), { from: flags.get('from') ?? null }); }
    else r = { ok: true, command: 'style golden', id, golden: readDecisions(root, id)?.golden ?? [] };
  } else if (verb === 'blast') {
    const doc = readDecisions(root, id);
    if (!doc) return { ok: false, command: 'style blast', why: `games/${id} has no decisions yet` };
    if (!doc.decisions[args[1]]) return { ok: false, command: 'style blast', why: `no decision "${args[1] ?? ''}"` };
    r = { ok: true, command: 'style blast', id, blast: blastRadius(doc, args[1], manifest()) };
  } else if (verb === 'prompt') {
    const doc = readDecisions(root, id);
    if (!doc) return { ok: false, command: 'style prompt', why: `games/${id} has no decisions yet` };
    r = { ok: true, command: 'style prompt', id, prompt: derivedPrompt(doc), golden: doc.golden ?? [] };
  }
  if (r?.ok !== false) writeArtSummary(root, id);
  return r;
}

export async function assetsCommand(root, sub, positional, flags, { log = () => {} } = {}) {
  const known = ['list', 'find', 'add', 'redo', 'optimise', 'optimize', 'check', 'lineup', 'review', 'rights', 'stale', 'remove'];
  const verb = known.includes(sub) ? (sub === 'optimize' ? 'optimise' : sub) : 'list';
  const args = known.includes(sub) ? positional.slice(2) : positional.slice(1);
  if (verb === 'find') {
    const { loadIndex, searchLibrary, libraryBase } = await import('./library.mjs');
    const { index, lib } = await loadIndex({ lib: libraryBase(flags.get('library') ?? undefined) });
    const hits = searchLibrary(index, args.join(' '), { kind: flags.get('kind') ?? null, family: flags.get('family') ?? null, limit: Number(flags.get('limit') ?? 12) });
    return { ok: true, command: 'assets find', query: args.join(' '), library: lib.base, version: index.version, total: index.items.length, items: hits.map(({ item, score, why }) => ({ id: item.id, name: item.name, kind: item.kind, family: item.family, pack: item.pack, tris: item.tris, kb: Math.round((item.files?.[0]?.bytes ?? 0) / 1024), heightM: item.heightM, suggestM: item.suggestM ?? null, rigged: Boolean(item.rigged), clips: item.clips ?? [], thumb: item.thumb, license: 'CC0 1.0', score: +score.toFixed(2), why })) };
  }
  if (verb === 'optimise') {
    const { optimiseModel } = await import('./optimise.mjs');
    if (!args[0] || !flags.get('out')) return { ok: false, command: 'assets optimise', why: 'usage: homie-studio assets optimise <model.glb> --out <file.glb> [--triangles 1500] [--texture 512] [--height <m>]' };
    const r = await optimiseModel(resolve(args[0]), { out: resolve(String(flags.get('out'))), triangles: Number(flags.get('triangles') ?? 1500), texture: Number(flags.get('texture') ?? 512), height: flags.has('height') ? Number(flags.get('height')) : null, rigged: flags.has('rigged'), log });
    const { glb, ...rest } = r;
    return { ...rest, command: 'assets optimise' };
  }
  const id = gameOf(root, args[0], `assets ${verb}`);
  let r;
  if (verb === 'list') {
    const m = readManifest(root, id);
    const doc = readDecisions(root, id);
    r = { ok: true, command: 'assets', id, assets: m.assets.map((a) => ({ id: a.id, kind: a.kind, route: a.route, tier: a.tier ?? null, card: a.card ?? null, license: a.license?.kind ?? null, remix: a.license?.remix ?? null, file: (a.files ?? []).find((f) => f.role === 'model')?.path ?? null, tris: a.measured?.tris ?? null, kb: a.measured?.glbKB ?? null, usd: +(a.made?.steps ?? []).reduce((n, s) => n + (Number(s.usd) || 0), 0).toFixed(3) })), stale: doc ? staleAssets(doc, m).map((s) => s.id) : [], spend: artSpend(root, id) };
  } else if (verb === 'add') {
    if (flags.get('file')) {
      const { importModel } = await import('./asset-import.mjs');
      let steps = [];
      if (flags.get('steps')) steps = JSON.parse(readFileSync(resolve(String(flags.get('steps'))), 'utf8'));
      r = await importModel(root, id, String(flags.get('file')), { as: flags.get('as') ?? args[1] ?? null, kind: flags.get('kind') ?? 'prop', tier: flags.get('tier') ?? null, card: flags.get('card') ?? null, height: flags.get('height') ?? null, triangles: flags.get('triangles') ?? null, texture: flags.get('texture') ?? null, license: flags.get('license') ?? null, attribution: flags.get('attribution') ?? null, notes: flags.get('notes') ?? null, owner: flags.get('owner') ?? null, route: flags.get('route') ?? 'imported', steps, concept: flags.get('concept') ?? null, slug: flags.get('slug') ?? null, rigged: flags.has('rigged') });
    } else {
      if (!args[1]) return { ok: false, command: 'assets add', why: 'usage: homie-studio assets add <game> <library item> (assets find "<words>" lists them), or --file <model> --license <kind>' };
      const { addFromLibrary, libraryBase } = await import('./library.mjs');
      r = await addFromLibrary(root, id, args[1], { as: flags.get('as') ?? null, height: flags.get('height') ?? null, card: flags.get('card') ?? null, lib: libraryBase(flags.get('library') ?? undefined) });
    }
  } else if (verb === 'redo') {
    if (!args[1]) return { ok: false, command: 'assets redo', why: 'usage: homie-studio assets redo <game> <asset> (made again from its kept raw file, free)' };
    const { redoModel } = await import('./asset-import.mjs');
    r = await redoModel(root, id, args[1]);
  } else if (verb === 'check') { const { assetsCheck } = await import('./asset-check.mjs'); r = await assetsCheck(root, id, { validate: !flags.has('no-validate') }); }
  else if (verb === 'lineup') { const { assetsLineup } = await import('./style-board.mjs'); r = await assetsLineup(root, id, { log }); }
  else if (verb === 'review') { const { recordReview } = await import('./style-board.mjs'); r = recordReview(root, id, { score: flags.get('score'), outliers: list(flags.get('outliers')), note: flags.get('note') ?? null }); }
  else if (verb === 'rights') { const m = readManifest(root, id); const file = writeRights(root, id, m); syncCredits(root, id, m); r = { ok: true, command: 'assets rights', id, file, text: rightsMarkdown(root, id, m), licence: licenceProblems(root, id, m) }; }
  else if (verb === 'stale') { const doc = readDecisions(root, id); r = { ok: true, command: 'assets stale', id, stale: doc ? staleAssets(doc, readManifest(root, id)) : [] }; }
  else if (verb === 'remove') { const x = removeAsset(root, id, args[1]); r = { ok: x.removed, command: 'assets remove', id, asset: args[1], deleted: x.deleted, kept: x.kept, ...(x.removed ? {} : { why: `no asset "${args[1]}" in games/${id}/assets/manifest.json` }) }; }
  if (r?.ok !== false || verb === 'check') writeArtSummary(root, id);
  return r;
}

/* ------------------------------------------------------------------ what a person reads */

const MARK = { auto: '·', steered: '~', pinned: '●', locked: '■' };

export function artLines(r) {
  const L = [];
  switch (r.command) {
    case 'style init':
      L.push(`${r.summary}.`, `  ${r.picked.length} decision${r.picked.length === 1 ? '' : 's'} picked automatically (a ${r.genre} game)${r.kept.length ? `; ${r.kept.length} kept as the person set them` : ''}. ${r.file}`, '  Open the codex to change anything; steer, lock or the style board give the person control.');
      break;
    case 'style': {
      L.push(`${r.id}: ${r.line}`, `  path: ${r.path}${r.budget ? `, art budget US$${r.budget.usd}` : ', free routes only (no art budget)'}`);
      for (const p of r.phases) {
        L.push(`  ${p.label}:`);
        for (const x of p.rows) L.push(`    ${MARK[x.state] ?? ' '} ${x.id.padEnd(18)} ${x.label}${x.state !== 'auto' ? `  [${x.state}${x.by === 'person' ? ', the person' : x.by === 'use' ? ', by use' : ''}]` : ''}`);
      }
      L.push('  · auto  ~ steered  ● pinned by use  ■ locked');
      if (r.stale?.length) L.push(`  stale: ${r.stale.map((s) => s.id).join(', ')}`);
      break;
    }
    case 'style set':
      if (r.pending) { L.push(`Not changed yet: ${r.decision} is locked. If it changes:`, ...blastLines(r.blast), r.why); break; }
      L.push(`${r.decision}: ${r.record.label} (${r.record.state}, rev ${r.record.rev})`, ...(r.blast ? blastLines(r.blast) : []), ...(r.stale?.length ? [`  stale now: ${r.stale.join(', ')}`] : []));
      break;
    case 'style steer':
      L.push(`${r.decision}: ${r.record.label} (steered: "${r.recorded}")`, ...(r.note ? [`  ${r.note}`] : []), ...(r.stale?.length ? [`  stale now: ${r.stale.join(', ')}`] : []));
      break;
    case 'style lock':
      L.push(r.locked.length ? `Locked: ${r.locked.join(', ')}` : 'Nothing new to lock.', ...(r.already.length ? [`  already locked: ${r.already.join(', ')}`] : []));
      break;
    case 'style unlock':
      L.push(r.already ? `${r.decision} was not locked.` : `Unlocked ${r.decision} (now steered).`);
      break;
    case 'style board':
      L.push(`The style board for ${r.title} (drawn on ${r.renderer ?? 'this computer'}, free):`);
      for (const d of r.directions) L.push(`  ${d.id.toUpperCase()}: ${d.label}  [${d.family}]`, `     swatch: games/${r.id}/${d.swatch}${d.mood ? `  mood (target): games/${r.id}/${d.mood.path}` : ''}`);
      L.push('  Pick, Mix, Steer or Lock: homie-studio style pick <id> <a|b|c> [--mix style.palette=b]; style lock <id> style --words "…"');
      break;
    case 'style pick':
      L.push(r.changed.length ? `Picked ${r.chosen ? `direction ${r.chosen.toUpperCase()}` : 'a mix'}: ${r.changed.join(', ')}` : 'Nothing changed (the board\'s values are the game\'s already).', ...(r.refused.length ? [`  left as locked: ${r.refused.join(', ')}`] : []), ...(r.stale?.length ? [`  stale now: ${r.stale.join(', ')}`] : []));
      break;
    case 'style mood':
      L.push(`Mood image (a target, not what the game draws) for direction ${r.direction.toUpperCase()}: ${r.mood.path}${r.mood.usd ? ` (US$${r.mood.usd})` : ''}`);
      break;
    case 'style golden':
      L.push(`${r.golden.length} golden image${r.golden.length === 1 ? '' : 's'}:`, ...r.golden.map((g) => `  ${g.path} (from ${g.from})`));
      break;
    case 'style blast':
      L.push(...blastLines(r.blast));
      break;
    case 'style prompt':
      L.push(`Derived style prompt (rev ${r.prompt.rev}):`, `  ${r.prompt.text}`, ...(r.golden.length ? [`Golden images (references): ${r.golden.map((g) => g.path).join(', ')}`] : []));
      break;
    case 'assets':
      L.push(`${r.id}: ${r.assets.length} asset${r.assets.length === 1 ? '' : 's'}${r.spend.used ? `, US$${r.spend.used} spent${r.spend.cap !== null ? ` of US$${r.spend.cap}` : ''}` : ', US$0 spent'}`);
      for (const a of r.assets) L.push(`  ${a.id.padEnd(20)} ${a.kind.padEnd(9)} ${a.route.padEnd(10)} ${String(a.license ?? 'NO LICENCE').padEnd(10)} ${a.tris ?? '?'} tris, ${a.kb ?? '?'} KB${a.usd ? `, US$${a.usd}` : ''}${r.stale.includes(a.id) ? '  STALE' : ''}`);
      break;
    case 'assets find':
      L.push(`${r.items.length} of ${r.total} library items for "${r.query}" (CC0, free; ${r.library}):`);
      for (const i of r.items) L.push(`  ${i.id.padEnd(46)} ${i.kind.padEnd(9)} ${String(i.tris).padStart(5)} tris ${String(i.kb).padStart(4)} KB${i.rigged ? `  rigged${i.clips.length ? `, ${i.clips.length} clips` : ''}` : ''}`);
      if (r.items.length) L.push(`  Add one: homie-studio assets add <game> ${r.items[0].id} [--height <m>]`);
      break;
    case 'assets add':
      L.push(`games/${r.game}: ${r.asset} added (${r.item ? `from the library: ${r.item}` : r.route}; licence ${r.license}).`, ...(r.after ? [`  ${r.before.tris} -> ${r.after.tris} triangles, ${r.before.kb} -> ${r.after.kb} KB, ${r.after.heightM} m tall; raw kept in ${r.raw} (git-ignored)`] : []), ...(r.pinned?.length ? [`  pinned by use: ${r.pinned.join(', ')}`] : []), ...(r.warnings ?? []).map((w) => `  note: ${w}`));
      break;
    case 'assets redo':
      L.push(`games/${r.game}: ${r.asset} made again from its raw file (free): ${r.before.tris} -> ${r.after.tris} triangles, ${r.after.kb} KB, ${r.after.heightM} m (${r.ops.join(', ')})`, ...(r.warnings ?? []).map((w) => `  note: ${w}`));
      break;
    case 'assets optimise':
      L.push(`${r.out}: ${r.before.triangles} -> ${r.after.triangles} triangles, ${Math.round(r.rawBytes / 1024)} -> ${Math.round(r.bytes / 1024)} KB (${r.ops.join(', ')})`, ...r.warnings.map((w) => `  note: ${w}`));
      break;
    case 'assets lineup':
      if (r.ok === false) { L.push(r.why); break; }
      L.push(`Lineup of ${r.rows.length} asset${r.rows.length === 1 ? '' : 's'} (${r.flagged} flagged), pictures: ${r.images.front}, ${r.images.quarter}, ${r.images.silhouettes}`);
      for (const x of r.rows) L.push(`  ${x.flags.length ? 'FLAG' : 'ok  '} ${x.id}${x.size ? ` (${x.size[1]} m)` : ''}${x.drift ? (x.drift.repaint ? ', repainted from style.json in the game' : `, palette distance ${x.drift.mean}`) : ''}${x.flags.length ? `: ${x.flags.join('; ')}` : ''}`);
      L.push('  Next: a fresh reviewer scores "one game?" from the board, golden images and this lineup (assets review <id> --score <n>).');
      break;
    case 'assets review':
      L.push(`Review: ${r.review.score}/10, ${r.review.verdict}${r.review.outliers.length ? `; needs review: ${r.review.outliers.join(', ')}` : ''}`);
      break;
    case 'assets rights':
      L.push(`Wrote ${r.file} (and credits.json).`, ...r.licence.map((l) => `  ${l.level === 'refuse' ? 'FIX ' : 'note'} ${l.asset}: ${l.problem}`));
      break;
    case 'assets stale':
      L.push(r.stale.length ? `Stale (made under an older decision; nothing is remade by itself):` : 'Nothing is stale.', ...r.stale.map((s) => `  ${s.id}: ${s.decisions.map((d) => `${d.id} rev ${d.was} -> ${d.now}`).join(', ')}`));
      break;
    case 'assets remove':
      L.push(r.ok ? `Removed ${r.asset} from the manifest${r.deleted.length ? `, and its shipped copy (${r.deleted.join(', ')})` : ''}.${r.kept.length ? ` Kept ${r.kept.join(', ')}: changed since it was recorded, so delete it yourself if it is unused.` : ''} A raw file in art/ stays.` : r.why);
      break;
    case 'assets check':
      L.push(...checkLines(r));
      break;
    default:
      L.push(JSON.stringify(r, null, 2));
  }
  return L;
}

export function blastLines(b) {
  const L = [`Changing the ${b.name} (${b.from ?? '?'}${b.to ? ` -> ${b.to}` : ''}): ${b.assets.length} asset${b.assets.length === 1 ? '' : 's'} would go stale${b.assets.length ? `; remaking the ones with no free fix costs about US$${b.totals.usd.toFixed(2)}` : ''}.`];
  for (const a of b.assets) L.push(`  ${a.id} (${a.route}${a.card ? `, ${a.card}` : ''}): ${a.free ? `free: ${a.free}` : a.remake.usd ? `US$${a.remake.usd.toFixed(2)} (${a.remake.how})` : a.remake.how}`);
  if (b.decisions.length) L.push(`  also worth a look: ${b.decisions.slice(0, 8).join(', ')}`);
  L.push(`  ${b.note}`);
  return L;
}
