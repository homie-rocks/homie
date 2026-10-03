/**
 * THE ART TOOLS OF THE LOCAL MCP (`homie-studio mcp`, lib/mcp-tools.mjs pushes these): art direction as decisions, the
 * style board, the cast, the starter library, generated props, the checks, the lineup and the rights, each with a card.
 *
 *   style_explore   three directions drawn by the engine (free); painted mood images only with paid + approve   style card
 *   style_board     the board and the decisions, as they are (nothing drawn)                                     style card
 *   decision_set    pick, mix, set, steer, lock, unlock one decision; a locked change answers with its blast radius
 *                   first and changes only on confirm (the person's yes)                                        decision card
 *   assets_plan     the cast: each asset's route, a library match or a price, against the art budget            cast card
 *   assets_find     the free CC0 starter library                                                                 cast card
 *   asset_add       a library item, or a file with its licence, into the game (checked, optimised, recorded)
 *   asset_make      one generated prop on the person's own fal account: a priced dry run unless approve; the
 *                   concept first, then (after looking) the mesh                                                  lineup card
 *   asset_check     phone budgets, the validator, licences, staleness
 *   asset_lineup    true scale, silhouettes, palette drift, flags                                                 lineup card
 *   asset_rights    RIGHTS.md and every asset's licence                                                           rights card
 *   cast_plan       the characters: proportions, silhouette, palette, skeleton family, source, clips, cost         cast card
 *   character_make  one generated, rigged character on the person's own fal account: a priced dry run unless approve;
 *                   the A-pose concept first, then (after looking) Meshy's mesh and auto-rig, the library's clips
 *                   retargeted onto it for free                                                                    lineup card
 *   anim_plan       each character's clips against the verbs the game needs, as looping previews; Feel opens the
 *                   Game Lab on the move                                                                          animation card
 *   anim_add        more verbs for a character, retargeted onto its skeleton (free)                              animation card
 *   anim_preview    the looping previews drawn again (free)                                                       animation card
 *
 * Work that needs the studio's own tools (rendering, optimising) runs the studio's pinned CLI as a job; decisions are
 * plain files and change here directly. Pictures go to cards as small data: URLs (each a few hundred KB at most).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readManifest } from './asset-manifest.mjs';
import { artSpend, castView, writeArtSummary } from './art-cli.mjs';
import { animPlan } from './characters.mjs';
import { CATALOGUE_IDS, decisionRows, lockDecision, oneLine, phaseProgress, pickDirection, readDecisions, setDecision, staleAssets, steerDecision, unlockDecision } from './decisions.mjs';
import { libraryBase, loadIndex, searchLibrary, itemThumb } from './library.mjs';
import { boardView } from './style-board.mjs';
import { listGames } from './studio.mjs';

export const ART_UI = Object.freeze({
  style: 'ui://homie-studio/style',
  decision: 'ui://homie-studio/decision',
  cast: 'ui://homie-studio/cast',
  lineup: 'ui://homie-studio/lineup',
  rights: 'ui://homie-studio/rights',
  animation: 'ui://homie-studio/animation',
});

/** A picture file as a data: URL no bigger than `max` (a smaller JPEG when it is over), or null. */
function picture(h, file, max = 160 * 1024) {
  if (!file || !existsSync(file)) return null;
  try { const p = h.pictureFor(file, { max }); return `data:${p.mimeType};base64,${p.data}`; } catch { return null; }
}

function gameOf(root, id) {
  const games = listGames(root);
  if (id && (games.some((g) => g.id === id) || existsSync(join(root, 'games', String(id), 'CODEX.md')))) return String(id);
  if (!id && games.length === 1) return games[0].id;
  throw new Error(`which game? ${games.map((g) => g.id).join(', ') || 'there is none yet (game_plan or game_make first)'}`);
}

/** The style card's data: the board's directions with their pictures, the style phase's decisions, money, staleness. */
function styleData(h, root, game, extra = {}) {
  const doc = readDecisions(root, game);
  let title = null;
  try { title = JSON.parse(readFileSync(join(root, 'games', game, 'game.json'), 'utf8')).name ?? null; } catch { /* planned: its codex names it */ }
  if (!title) { try { title = /^#\s+(.+)$/m.exec(readFileSync(join(root, 'games', game, 'CODEX.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, ''))?.[1]?.trim() ?? null; } catch { title = null; } }
  title = title ?? game;
  const manifest = readManifest(root, game);
  const dirs = doc ? boardView(root, game, doc).map((d) => ({ ...d, swatch: picture(h, d.swatch ? join(root, 'games', game, d.swatch) : null), mood: d.mood?.path ? { image: picture(h, join(root, 'games', game, d.mood.path)), usd: d.mood.usd ?? null, label: 'a painted target, not what the game draws' } : null })) : [];
  const rows = doc ? decisionRows(doc) : [];
  return {
    kind: 'style', game, title, path: doc?.path ?? null, line: doc ? oneLine(doc) : null, budget: doc?.budget?.usd ?? null, chosen: doc?.board?.chosen ?? null,
    directions: dirs, phases: rows.map((p) => ({ id: p.id, label: p.label, rows: p.rows.map(({ id, name, label, why, state, by, colours, steer }) => ({ id, name, label, why, state, by, colours, steer: steer.at(-1) ?? null })) })),
    progress: doc ? phaseProgress(doc) : null, prompt: doc?.derived?.prompt?.text ?? null, golden: (doc?.golden ?? []).length,
    stale: doc ? staleAssets(doc, manifest).map((s) => s.id) : [], spend: artSpend(root, game), ...extra,
  };
}

function styleText(d) {
  if (!d.line) return `${d.title}: no decisions yet.`;
  return [
    `${d.title}. ${d.line}.`,
    ...(d.directions.length ? [`Style board: ${d.directions.map((x) => `${x.id.toUpperCase()} ${x.label}${x.chosen ? ' (chosen)' : ''}`).join(' | ')}.`] : ['No style board yet.']),
    ...(d.phases.find((p) => p.id === 'style')?.rows ?? []).map((r) => `  ${r.id}: ${r.label} [${r.state}]`),
    ...(d.stale.length ? [`Stale: ${d.stale.join(', ')}.`] : []),
    `Spent US$${d.spend.used.toFixed(2)}${d.spend.cap !== null ? ` of US$${d.spend.cap}` : ' (no art budget: free routes only)'}.`,
  ].join('\n');
}

/** A character's small picture: its looping idle preview, else its library thumbnail, else its concept. */
async function characterThumb(h, root, game, row) {
  const idle = join(root, '.studio', 'art', game, 'anim', `${row.id}-idle.webp`);
  if (existsSync(idle)) return picture(h, idle, 40 * 1024);
  const m = readManifest(root, game).assets.find((a) => a.id === row.id);
  if (m?.from?.item) {
    try { const lib = await loadIndex({ lib: libraryBase() }); const it = lib.index.items.find((x) => x.id === m.from.item); const t = it ? await itemThumb(lib.lib, it) : null; if (t) return `data:image/webp;base64,${Buffer.from(t).toString('base64')}`; } catch { /* no library here */ }
  }
  const concept = (m?.files ?? []).find((f) => f.role === 'concept');
  return concept ? picture(h, join(root, 'games', game, concept.path), 60 * 1024) : null;
}

/** Which Game Lab take tunes a verb (lab.json): one named for it or whose note says it, else the default. */
function takeFor(lab, verb) {
  const takes = Object.entries(lab?.takes ?? {});
  const words = { attack: /swing|attack|strike|hit|punch|knock/i, jump: /jump|hop|leap/i, cast: /cast|spell/i, dodge: /dodge|roll/i, run: /run|dash|sprint/i };
  const hit = takes.find(([k]) => k === verb) ?? takes.find(([k, t]) => (words[verb] ?? new RegExp(verb, 'i')).test(`${k} ${t?.note ?? ''}`));
  return hit ? hit[0] : null;
}

/** The animation card's data: the plan, with looping previews for up to `max` characters (the answer stays small). */
function animationData(h, root, game, { asset = null, max = 4 } = {}) {
  const plan = animPlan(root, game);
  const dir = join(root, '.studio', 'art', game, 'anim');
  let budget = 560 * 1024;
  const order = asset ? [...plan.rows.filter((r) => r.id === asset), ...plan.rows.filter((r) => r.id !== asset)] : plan.rows;
  // One character a skeleton first (its clips are its skeleton's), then the rest.
  const seen = new Set(); const first = []; const rest = [];
  for (const r of order) { if (!seen.has(r.skeleton) || r.id === asset) { seen.add(r.skeleton); first.push(r); } else rest.push(r); }
  const shown = new Set([...first, ...rest].slice(0, Math.max(1, max)).map((r) => r.id));
  // Each shown character gets an even share of the answer, its core verbs first, so none is left all placeholders.
  const CORE = ['idle', 'run', 'jump', 'attack', 'cast', 'hit', 'walk', 'land'];
  const share = Math.floor(budget / Math.max(1, shown.size));
  const rows = order.map((r) => {
    const have = [...r.clips.filter((c) => c.have).map((c) => c.verb), ...r.extra];
    const verbs = [...CORE.filter((v) => have.includes(v)), ...have.filter((v) => !CORE.includes(v))];
    const previews = {};
    if (shown.has(r.id)) {
      let left = Math.min(share, budget);
      for (const v of verbs) {
        const f = join(dir, `${r.id}-${v}.webp`);
        if (!existsSync(f)) continue;
        const pic = picture(h, f, 40 * 1024);
        if (!pic || pic.length > left) continue;
        left -= pic.length; budget -= pic.length; previews[v] = pic;
      }
    }
    return { ...r, shown: shown.has(r.id), previews, previewed: Object.keys(previews).length };
  });
  const takes = plan.lab?.takes ? Object.fromEntries(Object.entries(plan.lab.takes).map(([k, t]) => [k, t?.note ?? ''])) : {};
  const feel = Object.fromEntries(['jump', 'attack', 'cast', 'run', 'dodge', 'hit', 'land'].map((v) => [v, takeFor(plan.lab, v)]).filter(([, t]) => t));
  return { kind: 'animation', game, verbs: plan.verbs, rows, decisions: plan.decisions, takes, feel, unrigged: plan.unrigged };
}

function animationText(d) {
  return [
    `Clips for ${d.game}: the game needs ${d.verbs.join(', ')}.`,
    ...d.rows.map((r) => `  ${r.id} (${r.familyLabel}, ${r.bones} bones): ${r.clips.map((c) => `${c.verb}${c.have ? '' : ' MISSING'}`).join(', ')}${r.extra.length ? `; also ${r.extra.join(', ')}` : ''}${r.previewed ? ` (${r.previewed} previews on the card)` : ''}`),
    ...(Object.keys(d.feel).length ? [`Feel: the Game Lab tunes ${Object.entries(d.feel).map(([v, t]) => `${v} (take "${t}")`).join(', ')} New beside Today (game_lab { "take": "<take>" }).`] : ['Feel: the game has no Game Lab take for a move yet (lab.json; the lab guide).']),
  ].join('\n');
}

export function artToolDefs(ctx, h) {
  const { ok, fail, cli, stillRunning, whyOf, needsInstall, ui, str, STUDIO_ARG, RO, RW } = h;
  const GAME = { game: str('The game\'s id (default: the only game)'), ...STUDIO_ARG };
  const modelsScript = () => (ctx.skillsDir && existsSync(join(ctx.skillsDir, 'models', 'scripts', 'models.mjs')) ? join(ctx.skillsDir, 'models', 'scripts', 'models.mjs') : null);
  /** The models skill's script in the studio, as a job (it prices, caps, receipts and resumes every paid call). */
  async function models(root, label, args, { wait = ctx.waitMs } = {}) {
    const script = modelsScript();
    if (!script) throw new Error('the models guide is not on this computer (it comes with the Homie plugin and the Homie extension)');
    const node = h.findNode();
    if (!node) throw new Error('no Node.js 22 or newer on this computer');
    const job = h.startJob({ root, label, cmd: node.bin, args: [script, ...args, '--json'], json: true });
    const ended = await h.waitJob(job, wait);
    return { ended, job, result: job.result };
  }

  return [
    {
      name: 'style_explore', title: 'Explore the look',
      description: 'The style board: three coherent directions for a game\'s look (render style, palette, light, camera, materials, fonts, proportions), each DRAWN BY THE GAME ENGINE as the game would draw it, with the starter library\'s own pieces re-tinted into its palette. Free, about 10 to 30 s. The card has Pick, Mix, Steer and Lock. A painted mood image per direction is optional and paid (paid: true quotes it; approve: true after the person agreed makes them on their own fal account, labelled a target). Decisions start automatic from the person\'s words (prompt) and the codex.',
      inputSchema: { type: 'object', properties: { ...GAME, prompt: str('Optional: the person\'s words about the game and its look (first time)'), paid: { type: 'boolean', description: 'Also quote painted mood images (paid, on the person\'s fal account)' }, approve: { type: 'boolean', description: 'Make the mood images now: only after the person agreed to the price' } } },
      annotations: { title: 'Explore the look', ...RW }, _meta: ui(ART_UI.style),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const game = gameOf(root, a.game);
        const r = await cli(ctx, root, `style board ${game}`, ['style', 'board', game, ...(a.prompt ? ['--prompt', String(a.prompt).slice(0, 600)] : [])]);
        if (!r.ended) return stillRunning(r.job, 'The style board');
        if (r.job.code !== 0) return fail(`The style board was not drawn: ${whyOf(r.job)}`);
        let quote = null; let moods = null;
        if (a.paid === true) {
          const q = await models(root, `mood images for ${game}`, ['mood', game, 'all', ...(a.approve === true ? ['--yes'] : ['--dry-run'])], { wait: a.approve === true ? ctx.waitMs : 30_000 }).catch((e) => ({ error: e.message }));
          if (q.error) quote = { error: q.error };
          else if (!q.ended) return stillRunning(q.job, 'The mood images');
          else if (a.approve === true) moods = q.result;
          else quote = { usd: +(q.result?.images ?? []).reduce((n, x) => n + (x.price?.usd ?? 0), 0).toFixed(3), per: q.result?.images?.[0]?.price?.usd ?? null, why: q.result?.why ?? null };
        }
        const d = styleData(h, root, game, { quote, moods: moods ? { ok: moods.ok, why: moods.why ?? null } : null });
        writeArtSummary(root, game);
        return ok([styleText(d), ...(quote?.usd ? [`Painted mood images: about US$${quote.usd} for all three on the person's own fal account (US$${quote.per} each). Ask first; then style_explore with paid and approve.`] : []), ...(quote?.error ? [`Mood images: ${quote.error}`] : []), 'The swatches are what the game will look like; Pick, Mix, Steer and Lock are on the card (decision_set does the same from chat).'].join('\n'), d);
      },
    },
    {
      name: 'style_board', title: 'Show the look',
      description: 'The style board and a game\'s art-direction decisions as they are now (auto, steered, pinned by use, locked), on the style card. Nothing is drawn or changed.',
      inputSchema: { type: 'object', properties: { ...GAME } },
      annotations: { title: 'Show the look', ...RO }, _meta: ui(ART_UI.style),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const game = gameOf(root, a.game);
        if (!readDecisions(root, game)) return fail(`${game} has no art-direction decisions yet: style_explore draws the board (or the plan's automatic picks: npx --no-install homie-studio style init ${game} --prompt "…")`);
        const d = styleData(h, root, game);
        return ok(styleText(d), d);
      },
    },
    {
      name: 'decision_set', title: 'Change a look decision',
      description: `One art-direction decision: pick a style-board direction (pick: "b") or mix rows (mix: { "style.palette": "b" }), set a value, steer it in the person's words ("warmer", "less saturated", "closer", "golden hour"), lock it (lock: true, or lock: "style" for the whole style phase; only when the person said so, with their words), or unlock it (with the reason). A LOCKED decision changes only with unlock: true and a reason, and answers first with its blast radius (every asset made under it that would go stale and what remaking each would cost, and what a free palette re-tint fixes); it changes only with confirm: true after the person said yes, and nothing is ever remade by itself. Decisions: ${CATALOGUE_IDS.slice(0, 16).join(', ')}, …`,
      inputSchema: { type: 'object', properties: {
        ...GAME, decision: str('The decision, e.g. style.palette'), value: str('A new value: an option id, a preset name, or JSON'), steer: str('The person\'s words to nudge it'),
        lock: { description: 'true: lock this decision; "style" (or a phase): lock the whole phase' }, unlock: { type: 'boolean' }, reason: str('Why a locked one changes (the person\'s words)'),
        confirm: { type: 'boolean', description: 'The person saw the blast radius and said yes' }, pick: str('A style-board direction: a, b or c'), mix: { type: 'object', description: 'Rows from other directions: { "style.palette": "b" }' },
        words: str('What the person said (recorded with a lock)'), by: str('person when the person asked for it or tapped it (the card always does); else the AI', { enum: ['person', 'ai'] }),
      } },
      annotations: { title: 'Change a look decision', ...RW }, _meta: ui(ART_UI.decision),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const game = gameOf(root, a.game);
        if (!readDecisions(root, game)) return fail(`${game} has no decisions yet: style_explore first`);
        const manifest = readManifest(root, game);
        const by = a.by === 'person' ? 'person' : 'ai';
        let r; let action;
        try {
          if (a.pick || a.mix) { action = 'pick'; r = pickDirection(root, game, a.pick ? String(a.pick).toLowerCase() : null, { mixes: a.mix && typeof a.mix === 'object' ? a.mix : {}, manifest }); }
          else if (!a.decision) return fail('name the decision (decision: "style.palette"), or pick a direction (pick: "b")');
          else if (a.lock) { action = 'lock'; r = lockDecision(root, game, a.lock === true ? a.decision : String(a.lock), { by: 'person', words: a.words ?? (by === 'person' ? 'tapped Lock' : null) }); }
          else if (a.unlock && a.value === undefined && a.steer === undefined) { action = 'unlock'; r = unlockDecision(root, game, a.decision, { reason: a.reason ?? null, by: 'person' }); }
          else if (a.steer) { action = 'steer'; r = steerDecision(root, game, a.decision, String(a.steer), { manifest }); }
          else if (a.value !== undefined) { action = 'set'; r = setDecision(root, game, a.decision, a.value, { by, why: null, words: a.words ?? null, unlock: a.unlock === true, reason: a.reason ?? null, confirm: a.confirm === true, manifest }); }
          else return fail('say what to do: value, steer, lock, unlock, pick or mix');
        } catch (error) { return fail(error.message); }
        writeArtSummary(root, game);
        const doc = readDecisions(root, game);
        const rec = a.decision ? doc.decisions[a.decision] : null;
        const data = {
          kind: 'decision', game, action, decision: a.decision ?? null, ok: r.ok !== false, pending: Boolean(r.pending), why: r.why ?? r.note ?? null,
          record: rec ? { id: a.decision, label: rec.label, state: rec.state, by: rec.by, rev: rec.rev, why: rec.why, colours: a.decision === 'style.palette' ? ['bg', 'ink', 'accent', 'accent2', 'danger', 'good', 'gold'].map((k) => rec.value?.[k]).filter(Boolean) : null } : null,
          changed: r.changed ?? r.locked ?? null, refused: r.refused ?? null, blast: r.blast ?? null, stale: staleAssets(doc, manifest).map((s) => s.id), spend: artSpend(root, game),
          ask: r.pending ? { decision: a.decision, value: a.value, reason: a.reason ?? null } : null,
        };
        const text = r.ok === false ? r.why
          : r.pending ? [`Not changed yet. If ${a.decision} changes, ${r.blast.assets.length} asset(s) go stale:`, ...r.blast.assets.map((x) => `  ${x.id}: ${x.free ? `free (${x.free})` : x.remake.usd ? `US$${x.remake.usd.toFixed(2)} to remake` : x.remake.how}`), `Total to remake what has no free fix: about US$${r.blast.totals.usd.toFixed(2)}. Nothing is remade by itself. Ask the person; their yes is decision_set again with confirm: true.`].join('\n')
            : action === 'pick' ? `Picked ${a.pick ? `direction ${String(a.pick).toUpperCase()}` : 'a mix'}: ${r.changed.join(', ') || 'nothing changed'}.${r.refused.length ? ` Left as locked: ${r.refused.join(', ')}.` : ''}${r.stale?.length ? ` Stale now: ${r.stale.join(', ')}.` : ''}`
              : action === 'lock' ? `Locked: ${r.locked.join(', ') || 'nothing new'}.`
                : `${a.decision}: ${rec?.label} (${rec?.state}).${data.stale.length ? ` Stale: ${data.stale.join(', ')} (nothing remade).` : ''}${r.blast ? ` ${r.blast.assets.length} asset(s) made under the old one.` : ''}`;
        return r.ok === false ? fail(text, data) : ok(text, data);
      },
    },
    {
      name: 'assets_plan', title: 'Plan the cast',
      description: 'The cast a game needs (its codex cards and genre: characters, props, places), each with its route (procedural, the free CC0 starter library, generated on the person\'s fal account, imported), a library match with a thumbnail or a price, its tier and budget, and the total against the art budget. Quotes only; nothing is made.',
      inputSchema: { type: 'object', properties: { ...GAME } },
      annotations: { title: 'Plan the cast', ...RO }, _meta: ui(ART_UI.cast),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const game = gameOf(root, a.game);
        const doc = readDecisions(root, game);
        if (!doc) return fail(`${game} has no decisions yet: style_explore, or npx --no-install homie-studio style init ${game}`);
        const manifest = readManifest(root, game);
        const family = doc.decisions['cast.family']?.value ?? null;
        let lib = null;
        try { lib = await loadIndex({ lib: libraryBase() }); } catch (error) { lib = { error: error.message }; }
        const perProp = 0.535;
        const rows = [];
        for (const c of doc.decisions['cast.list']?.value ?? []) {
          const made = manifest.assets.find((x) => x.id === c.id || x.card === c.card);
          let match = null;
          if (!made && lib?.index && c.kind !== 'environment') {
            const hit = searchLibrary(lib.index, c.id.replace(/-/g, ' '), { family, limit: 1 })[0] ?? searchLibrary(lib.index, c.id.replace(/-/g, ' '), { limit: 1 })[0];
            if (hit) { const t = await itemThumb(lib.lib, hit.item); match = { id: hit.item.id, name: hit.item.name, family: hit.item.family, tris: hit.item.tris, thumb: t ? `data:image/webp;base64,${Buffer.from(t).toString('base64')}` : null }; }
          }
          rows.push({ ...c, state: made ? (staleAssets(doc, manifest).some((s) => s.id === made.id) ? 'stale' : 'made') : 'planned', asset: made?.id ?? null, route: made?.route ?? (c.kind === 'environment' ? 'procedural' : match ? 'library' : 'generated'), match, usd: made ? 0 : match || c.kind === 'environment' ? 0 : perProp });
        }
        const spend = artSpend(root, game);
        const total = +rows.reduce((n, r) => n + r.usd, 0).toFixed(3);
        const data = { kind: 'cast', mode: 'plan', game, family, rows, total, budget: doc.budget?.usd ?? null, spend, library: lib?.error ? { error: lib.error } : { items: lib?.index?.items?.length ?? 0 } };
        return ok([`The cast of ${game} (${rows.length}):`, ...rows.map((r) => `  ${r.id} (${r.kind}, ${r.tier}): ${r.state}${r.state === 'planned' ? `, ${r.route}${r.match ? ` match ${r.match.id}` : r.usd ? ` about US$${r.usd} (concept + mesh)` : ''}` : ` (${r.route})`}`), `To generate what has no match: about US$${total}${doc.budget ? ` against a budget of US$${doc.budget.usd}` : ' (no art budget yet: free routes only until the person sets one)'}.`, ...(lib?.error ? [`Library: ${lib.error}`] : [])].join('\n'), data);
      },
    },
    {
      name: 'assets_find', title: 'Find free models',
      description: 'Search Homie\'s free starter library (CC0 only: Kenney, KayKit, Poly Haven, ambientCG; every item phone-sized, with its triangles, size and licence) by words, e.g. "fox", "pine tree", "crate", "knight rigged". Free. asset_add brings one into the game (copied, never hot-linked).',
      inputSchema: { type: 'object', properties: { query: str('Words: what it is'), kind: str('Optional: prop, character, creature, kit, texture or sky'), family: str('Optional: kenney, kaykit, polyhaven or ambientcg'), limit: { type: 'number', description: 'At most this many (default 8)' }, ...GAME } },
      annotations: { title: 'Find free models', readOnlyHint: true, destructiveHint: false, openWorldHint: true }, _meta: ui(ART_UI.cast),
      run: async (a) => {
        let lib;
        try { lib = await loadIndex({ lib: libraryBase() }); } catch (error) { return fail(`The starter library is not reachable: ${error.message}`); }
        const hits = searchLibrary(lib.index, String(a.query ?? ''), { kind: a.kind ?? null, family: a.family ?? null, limit: Math.min(16, Number(a.limit ?? 8)) });
        const items = [];
        for (const { item } of hits) { const t = await itemThumb(lib.lib, item); items.push({ id: item.id, name: item.name, kind: item.kind, family: item.family, pack: item.pack, tris: item.tris, kb: Math.round((item.files?.[0]?.bytes ?? 0) / 1024), heightM: item.heightM, rigged: Boolean(item.rigged), license: 'CC0 1.0', thumb: t ? `data:image/webp;base64,${Buffer.from(t).toString('base64')}` : null }); }
        const game = a.game ?? null;
        return ok([`${items.length} free CC0 model(s) for "${a.query}":`, ...items.map((i) => `  ${i.id} (${i.kind}, ${i.tris} triangles, ${i.kb} KB${i.rigged ? ', rigged' : ''})`), items.length ? `asset_add { "game": "<id>", "item": "${items[0].id}" } copies one in.` : 'Nothing matched: other words, or a generated prop (asset_make, paid).'].join('\n'), { kind: 'cast', mode: 'find', game, query: String(a.query ?? ''), items });
      },
    },
    {
      name: 'asset_add', title: 'Add a model',
      description: 'Bring a model into a game: a starter-library item (item: its id; free, CC0), or a file on this computer (file, with license: own, cc0, cc-by-4.0 with attribution, eula:<store>, …; ask the person whose it is). It is checked first (a file with an external URI, or one over the size caps, is refused), made phone-sized (triangles, pictures, pivot, height in metres), copied into games/<id>/public/models/ and recorded with its licence; RIGHTS.md and the credits follow, and the decisions it was made under are pinned.',
      inputSchema: { type: 'object', properties: { ...GAME, item: str('A starter-library item id (assets_find)'), file: str('Or a .glb/.gltf on this computer'), license: str('With file: own, cc0, cc-by-4.0, cc-by-3.0, eula:<name>, other'), attribution: str('Who made it, where from (CC BY)'), as: str('The asset\'s id in the game'), height: { type: 'number', description: 'Its height in metres' }, card: str('Its codex card, e.g. "Items/Lantern"'), kind: str('prop, character, creature or kit') } },
      annotations: { title: 'Add a model', ...RW }, _meta: ui(ART_UI.cast),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const game = gameOf(root, a.game);
        if (!a.item && !a.file) return fail('item (from assets_find) or file (with its licence)');
        const args = ['assets', 'add', game, ...(a.item ? [String(a.item)] : ['--file', resolve(root, String(a.file)), '--license', String(a.license ?? '')]), ...(a.attribution ? ['--attribution', String(a.attribution)] : []), ...(a.as ? ['--as', String(a.as)] : []), ...(a.height ? ['--height', String(a.height)] : []), ...(a.card ? ['--card', String(a.card)] : []), ...(a.kind ? ['--kind', String(a.kind)] : [])];
        const r = await cli(ctx, root, `assets add ${game}`, args);
        if (!r.ended) return stillRunning(r.job, 'Adding the model');
        if (r.job.code !== 0) return fail(`Not added: ${whyOf(r.job)}`);
        const x = r.result;
        writeArtSummary(root, game);
        return ok(`${x.asset} is in games/${game} (${x.item ? `from the library: ${x.item}, CC0` : `${x.route}, ${x.license}`})${x.after ? `: ${x.after.tris} triangles, ${x.after.kb} KB, ${x.after.heightM} m` : ''}.${x.pinned?.length ? ` Pinned by use: ${x.pinned.join(', ')}.` : ''} asset_lineup shows it beside the rest.`, { kind: 'cast', mode: 'added', game, added: x });
      },
    },
    {
      name: 'asset_make', title: 'Make a prop (paid)',
      description: 'One generated 3D prop for a game, in its locked style, on the person\'s OWN fal account: a concept image (the derived style prompt; the golden images as references), then Tripo P1 image-to-3D, then free local optimising and recording (receipts, licence, decisions). About US$0.54 a prop. Without approve it is a priced dry run: tell the person the price and ask. budget sets the cap they agreed to (refused past it). Step 1 (no concept yet) makes only the concept: LOOK at it; then step: "mesh" with approve makes the model. Never in a loop.',
      inputSchema: { type: 'object', properties: { ...GAME, asset: str('The new asset\'s id, e.g. ember-lantern'), card: str('Its codex card, e.g. "Items/Ember Lantern"'), what: str('The thing in plain words: shape, material, what it is for'), height: { type: 'number', description: 'Its height in metres' }, step: str('concept (default) or mesh', { enum: ['concept', 'mesh'] }), approve: { type: 'boolean', description: 'The person agreed to the price' }, budget: { type: 'number', description: 'The cap in US dollars the person agreed to for this game\'s models' }, again: { type: 'boolean', description: 'A new concept with changed words (costs another concept)' } }, required: ['asset'] },
      annotations: { title: 'Make a prop (paid)', readOnlyHint: false, destructiveHint: false, openWorldHint: true }, _meta: ui(ART_UI.lineup),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const game = gameOf(root, a.game);
        const asset = String(a.asset ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        if (a.budget !== undefined) {
          const b = await models(root, `budget for ${game}`, ['budget', game, '--cap', String(Number(a.budget))], { wait: 20_000 }).catch((e) => ({ error: e.message }));
          if (b.error || b.job?.code) return fail(`The budget was not set: ${b.error ?? whyOf(b.job)}`);
        }
        const args = ['prop', game, asset, ...(a.card ? ['--card', String(a.card)] : []), ...(a.what ? ['--what', String(a.what)] : []), ...(a.height ? ['--height', String(a.height)] : []), ...(a.step === 'mesh' ? ['--mesh'] : []), ...(a.again ? ['--concept-again'] : []), ...(a.approve === true ? ['--yes'] : ['--dry-run'])];
        let r;
        try { r = await models(root, `${a.step === 'mesh' ? 'the model' : 'the concept'} for ${asset}`, args, { wait: a.approve === true ? ctx.waitMs : 30_000 }); } catch (error) { return fail(error.message); }
        if (!r.ended) return stillRunning(r.job, a.step === 'mesh' ? `The 3D model for ${asset} (about 1 to 3 minutes)` : `The concept for ${asset}`);
        const x = r.result ?? {};
        writeArtSummary(root, game);
        const concept = x.concept ? picture(h, join(root, x.concept), 260 * 1024) : null;
        // What the card sends back with the person's press: the same prop, the same words.
        const request = { ...(a.card ? { card: String(a.card) } : {}), ...(a.what ? { what: String(a.what) } : {}), ...(a.height ? { height: Number(a.height) } : {}) };
        const data = { kind: 'lineup', mode: 'make', game, asset, request, step: x.step ?? a.step ?? 'concept', dryRun: Boolean(x.dryRun), price: x.price ?? null, total: x.total ?? null, then: x.then ?? null, needs: x.needs ?? null, concept, model: x.model ?? null, before: x.before ?? null, after: x.after ?? null, usd: x.usd ?? null, spend: artSpend(root, game), next: x.next ?? null, why: x.why ?? null };
        if (r.job.code !== 0 && !x.needs) return fail(`Not made: ${x.why ?? whyOf(r.job)}`, data);
        const text = x.dryRun ? `${x.step === 'mesh' ? 'The 3D model' : `The concept for ${asset}`} would cost about US$${x.price?.usd} (${x.price?.basis})${x.total ? `; with the model, about US$${x.total} for the prop` : ''}, on the person's own fal account. Ask them; then asset_make with approve: true (and budget: <their cap> the first time).`
          : x.needs === 'approval' ? x.why
            : x.step === 'concept' ? `The concept for ${asset} is made (US$${x.usd}). LOOK at it (file_read ${x.concept}): the thing, whole, in the game's style, on a plain background? Then asset_make { "asset": "${asset}", "step": "mesh", "approve": true } (about US$${x.then?.usd ?? '0.50'}), or new words with again: true.`
              : x.step === 'mesh' ? `${asset} is a model in games/${game}: ${x.before?.tris} -> ${x.after?.tris} triangles, ${x.after?.kb} KB, ${x.after?.heightM} m (US$${x.usd}; receipts ${x.receipts?.join(', ')}). asset_lineup shows it at true scale beside the rest.`
                : (x.next ?? JSON.stringify(x));
        return ok(text, data);
      },
    },
    {
      name: 'asset_check', title: 'Check the assets',
      description: 'Every asset of a game against the phone budgets (triangles, draw calls, picture memory, download), the Khronos glTF-Validator, its licence record, and whether a decision it was made under has changed; scene totals; big files in git. Free, a few seconds.',
      inputSchema: { type: 'object', properties: { ...GAME } },
      annotations: { title: 'Check the assets', ...RO },
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const game = gameOf(root, a.game);
        const r = await cli(ctx, root, `assets check ${game}`, ['assets', 'check', game]);
        if (!r.ended) return stillRunning(r.job, 'The asset check');
        const x = r.result;
        if (!x?.rows) return fail(`The check did not run: ${whyOf(r.job)}`);
        const { checkLines } = await import('./asset-check.mjs');
        return ok(checkLines(x).join('\n'), { kind: 'check', ...x });
      },
    },
    {
      name: 'asset_lineup', title: 'Lineup',
      description: 'The made assets of a game side by side at true scale on a 1 m grid under the game\'s light (front and three-quarter), their silhouettes at phone size, and flags: over budget, palette drift from the locked palette, an unreadable silhouette, another library family, stale. Free. Look at it, then have a fresh reviewer score "does it look like one game?" (the playtest guide\'s blind review).',
      inputSchema: { type: 'object', properties: { ...GAME } },
      annotations: { title: 'Lineup', ...RO }, _meta: ui(ART_UI.lineup),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const game = gameOf(root, a.game);
        const r = await cli(ctx, root, `assets lineup ${game}`, ['assets', 'lineup', game]);
        if (!r.ended) return stillRunning(r.job, 'The lineup');
        const x = r.result;
        if (!x?.rows) return fail(x?.why ?? `The lineup was not drawn: ${whyOf(r.job)}`);
        writeArtSummary(root, game);
        let check = null;
        try { check = JSON.parse(readFileSync(join(root, '.studio', 'art', game, 'check.json'), 'utf8')); } catch { check = null; }
        const data = { kind: 'lineup', mode: 'lineup', game, rows: x.rows, flagged: x.flagged, palette: x.palette, family: x.family, images: { front: picture(h, join(root, x.images.front), 220 * 1024), quarter: picture(h, join(root, x.images.quarter), 220 * 1024), silhouettes: picture(h, join(root, x.images.silhouettes), 80 * 1024) }, files: x.images, totals: check?.totals ?? null, budgets: check?.budgets ?? null, spend: artSpend(root, game) };
        return ok([`Lineup of ${x.rows.length} asset(s), ${x.flagged} flagged. Pictures: ${x.images.front}, ${x.images.quarter} (file_read shows them).`, ...x.rows.map((row) => `  ${row.flags.length ? 'FLAG' : 'ok'} ${row.id}${row.size ? ` ${row.size[1]} m` : ''}${row.flags.length ? `: ${row.flags.join('; ')}` : ''}`)].join('\n'), data);
      },
    },
    {
      name: 'asset_rights', title: 'Rights',
      description: 'Every asset\'s licence in plain words (what it is, where it came from, what the licence allows, any credit owed, what a remixer gets) and what the providers\' terms say; writes RIGHTS.md and the credits. Anything that would stop a public game from publishing is named with its fix.',
      inputSchema: { type: 'object', properties: { ...GAME } },
      annotations: { title: 'Rights', ...RW }, _meta: ui(ART_UI.rights),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const game = gameOf(root, a.game);
        const r = await cli(ctx, root, `assets rights ${game}`, ['assets', 'rights', game]);
        if (!r.ended) return stillRunning(r.job, 'RIGHTS.md');
        const x = r.result;
        if (!x?.text) return fail(`Not written: ${whyOf(r.job)}`);
        const m = readManifest(root, game);
        const rows = m.assets.map((e) => ({ id: e.id, kind: e.kind, route: e.route, license: e.license?.kind ?? null, remix: e.license?.remix ?? null, attribution: e.license?.attribution ?? null, from: e.from?.pack ?? e.from?.item ?? null, placeholder: Boolean(e.placeholder) }));
        return ok(`${x.file}:\n\n${x.text.slice(0, 6000)}`, { kind: 'rights', game, file: x.file, rows, problems: x.licence, text: x.text.slice(0, 20_000) });
      },
    },
    {
      name: 'cast_plan', title: 'Plan the characters',
      description: 'The cast card for a game\'s characters: the decisions that shape them (proportions in heads and metres, the silhouette rule, the palette, the skeleton family, where rigs come from) and every character made or planned, with its picture, source (the free CC0 starter library, generated on the person\'s fal account, their own), skeleton and bones, triangles, height and clips. Free; nothing is made. A library character comes in with asset_add (its clips baked into its skeleton\'s clip library); a generated one with character_make (paid, priced first).',
      inputSchema: { type: 'object', properties: { ...GAME } },
      annotations: { title: 'Plan the characters', ...RO }, _meta: ui(ART_UI.cast),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const game = gameOf(root, a.game);
        const c = castView(root, game);
        const rows = [];
        for (const r of c.rows) rows.push({ ...r, thumb: r.state === 'made' ? await characterThumb(h, root, game, r) : null });
        const data = { kind: 'cast', mode: 'characters', game, decisions: c.decisions, silhouette: c.silhouette, palette: c.palette, rows, spend: c.spend };
        return ok([`The characters of ${game} (${rows.length}):`, ...Object.entries(c.decisions).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v.label} [${v.state}]`), ...rows.map((r) => `  ${r.state} ${r.id}${r.family ? `: ${r.family} skeleton, ${r.bones} bones, ${r.tris} triangles, ${r.heightM} m, clips ${r.verbs.join(', ')}` : ''} (${r.route ?? 'planned'}${r.usd ? `, US$${r.usd}` : ''})`), 'anim_plan shows each one\'s clips, looping.'].join('\n'), data);
      },
    },
    {
      name: 'character_make', title: 'Make a character (paid)',
      description: 'One generated, rigged character for a game, in its locked style, on the person\'s OWN fal account: a full-body concept image in an A-pose (the derived style prompt; the golden images, or like: a library character, as the style reference), then Meshy 7.1 image-to-3D with its humanoid auto-rig, then free local work: made phone-sized, its skeleton mapped to the standard, the starter library\'s CC0 clips retargeted onto it (idle, run, jump, attack, hit, ...), recorded with receipts and licence. About US$1.44 (US$0.035 concept + US$1.40 mesh and rig). Without approve it is a priced dry run: tell the person the price and ask. budget sets the cap they agreed to. Step 1 makes only the concept: LOOK at it; then step: "mesh" with approve. Humanoids with clear limbs only. Never in a loop.',
      inputSchema: { type: 'object', properties: { ...GAME, asset: str('The new character\'s id, e.g. ranger'), card: str('Its codex card, e.g. "Players/Ranger"'), what: str('Who, in plain words: build, clothes, colours, what they carry'), height: { type: 'number', description: 'Its height in metres (default: the game\'s character height)' }, like: str('A starter-library character whose look it should match (a style reference), e.g. kaykit-adventurers/rogue'), step: str('concept (default) or mesh', { enum: ['concept', 'mesh'] }), approve: { type: 'boolean', description: 'The person agreed to the price' }, budget: { type: 'number', description: 'The cap in US dollars the person agreed to for this game\'s models' }, again: { type: 'boolean', description: 'A new concept with changed words (costs another concept)' } }, required: ['asset'] },
      annotations: { title: 'Make a character (paid)', readOnlyHint: false, destructiveHint: false, openWorldHint: true }, _meta: ui(ART_UI.lineup),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const game = gameOf(root, a.game);
        const asset = String(a.asset ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        if (a.budget !== undefined) {
          const b = await models(root, `budget for ${game}`, ['budget', game, '--cap', String(Number(a.budget))], { wait: 20_000 }).catch((e) => ({ error: e.message }));
          if (b.error || b.job?.code) return fail(`The budget was not set: ${b.error ?? whyOf(b.job)}`);
        }
        const args = ['character', game, asset, ...(a.card ? ['--card', String(a.card)] : []), ...(a.what ? ['--what', String(a.what)] : []), ...(a.height ? ['--height', String(a.height)] : []), ...(a.like ? ['--like', String(a.like)] : []), ...(a.step === 'mesh' ? ['--mesh'] : []), ...(a.again ? ['--concept-again'] : []), ...(a.approve === true ? ['--yes'] : ['--dry-run'])];
        let r;
        try { r = await models(root, `${a.step === 'mesh' ? 'the rigged character' : 'the concept'} for ${asset}`, args, { wait: a.approve === true ? ctx.waitMs : 30_000 }); } catch (error) { return fail(error.message); }
        if (!r.ended) return stillRunning(r.job, a.step === 'mesh' ? `The rigged character ${asset} (about 2 to 5 minutes)` : `The concept for ${asset}`);
        const x = r.result ?? {};
        writeArtSummary(root, game);
        const concept = x.concept ? picture(h, join(root, x.concept), 260 * 1024) : null;
        const request = { ...(a.card ? { card: String(a.card) } : {}), ...(a.what ? { what: String(a.what) } : {}), ...(a.height ? { height: Number(a.height) } : {}), ...(a.like ? { like: String(a.like) } : {}) };
        const data = { kind: 'lineup', mode: 'make', character: true, game, asset, request, step: x.step ?? a.step ?? 'concept', dryRun: Boolean(x.dryRun), price: x.price ?? null, total: x.total ?? null, then: x.then ?? null, needs: x.needs ?? null, concept, model: x.model ?? null, before: x.before ?? null, after: x.after ?? null, usd: x.usd ?? null, verbs: x.verbs ?? [], skeleton: x.skeleton ?? null, spend: artSpend(root, game), next: x.next ?? null, why: x.why ?? null };
        if (r.job.code !== 0 && !x.needs) return fail(`Not made: ${x.why ?? whyOf(r.job)}`, data);
        const text = x.dryRun ? `${x.step === 'mesh' ? 'The rigged character' : `The concept for ${asset}`} would cost about US$${x.price?.usd} (${x.price?.basis})${x.total ? `; with the mesh and rig, about US$${x.total} for the character` : ''}, on the person's own fal account. Ask them; then character_make with approve: true (and budget: <their cap> the first time).`
          : x.needs === 'approval' ? x.why
            : x.step === 'concept' ? `The concept for ${asset} is made (US$${x.usd}). LOOK at it (file_read ${x.concept}): one character, whole, in an A-pose, in the game's style, on a plain background? Then character_make { "asset": "${asset}", "step": "mesh", "approve": true } (about US$${x.then?.usd ?? '1.40'}), or new words with again: true.`
              : x.step === 'mesh' ? `${asset} is a rigged character in games/${game}: ${x.after?.tris} triangles, ${x.after?.kb} KB, ${x.after?.heightM} m, skeleton ${x.skeleton}; clips (retargeted, free): ${(x.verbs ?? []).join(', ')} (US$${x.usd}; receipts ${x.receipts?.join(', ')}). anim_preview shows its clips looping; asset_lineup shows it beside the rest.`
                : (x.next ?? JSON.stringify(x));
        return ok(text, data);
      },
    },
    {
      name: 'anim_plan', title: 'Clips',
      description: 'The animation card: every character\'s clips against the verbs the game needs (its anim.clips decision: idle, walk, run, jump, attack, hit, die, ...), each as a LOOPING PREVIEW (when drawn: anim_preview), where it came from (its own, or the CC0 library\'s retargeted onto its skeleton), what is missing (anim_add adds it, free), and Feel: the Game Lab on the move (game_lab with the take that plays it), New beside Today. Free.',
      inputSchema: { type: 'object', properties: { ...GAME, asset: str('Optional: the character to show first') } },
      annotations: { title: 'Clips', ...RO }, _meta: ui(ART_UI.animation),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const game = gameOf(root, a.game);
        const d = animationData(h, root, game, { asset: a.asset ?? null });
        if (!d.rows.length) return fail(`${game} has no rigged characters yet: asset_add a library character (assets_find "knight" kind character), or character_make`, d);
        return ok(animationText(d), d);
      },
    },
    {
      name: 'anim_add', title: 'Add clips',
      description: 'More verbs for a character (jump, attack, hit, die, emote, cast, block, dodge, ...): baked into its skeleton\'s clip library at build time, its own clip where it has one, else retargeted from the starter library\'s CC0 humanoid clips (from: another library item or a file). Free, a few seconds; every character with that skeleton gets them.',
      inputSchema: { type: 'object', properties: { ...GAME, asset: str('The character'), verbs: { description: 'Verbs to add, e.g. ["jump","attack"] or "jump,attack"' }, from: str('Optional: a library item or a file to take them from') }, required: ['asset', 'verbs'] },
      annotations: { title: 'Add clips', ...RW }, _meta: ui(ART_UI.animation),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const game = gameOf(root, a.game);
        const verbs = (Array.isArray(a.verbs) ? a.verbs : String(a.verbs ?? '').split(',')).map((v) => String(v).trim()).filter(Boolean);
        const r = await cli(ctx, root, `clips for ${a.asset}`, ['anim', 'add', game, String(a.asset), '--verbs', verbs.join(','), ...(a.from ? ['--from', String(a.from)] : [])]);
        if (!r.ended) return stillRunning(r.job, 'Baking the clips');
        if (r.job.code !== 0) return fail(`Not added: ${whyOf(r.job)}`);
        const p = await cli(ctx, root, `previews of ${a.asset}`, ['anim', 'preview', game, '--asset', String(a.asset)]).catch(() => null);
        const d = animationData(h, root, game, { asset: String(a.asset) });
        const x = r.result ?? {};
        return ok(`${a.asset}: ${x.added?.length ? `added ${x.added.join(', ')}` : 'nothing new'}${x.missing?.length ? `; no source has ${x.missing.join(', ')}` : ''}.${p?.ended ? '' : ' (Its previews are still being drawn.)'}\n${animationText(d)}`, { ...d, added: x.added ?? [], missing: x.missing ?? [] });
      },
    },
    {
      name: 'anim_preview', title: 'Draw the clips',
      description: 'Draw every character\'s clips as small looping previews (animated WebP, under the game\'s light; free, one headless Chrome on this computer, a few seconds a character) and answer with the animation card.',
      inputSchema: { type: 'object', properties: { ...GAME, asset: str('Optional: only this character') } },
      annotations: { title: 'Draw the clips', ...RW }, _meta: ui(ART_UI.animation),
      run: async (a) => {
        const root = ctx.root(a.studio);
        const need = needsInstall(ctx, root); if (need) return need;
        const game = gameOf(root, a.game);
        const r = await cli(ctx, root, `clip previews for ${game}`, ['anim', 'preview', game, ...(a.asset ? ['--asset', String(a.asset)] : [])]);
        if (!r.ended) return stillRunning(r.job, 'The previews');
        if (r.job.code !== 0) return fail(`Not drawn: ${whyOf(r.job)}`);
        const d = animationData(h, root, game, { asset: a.asset ?? null });
        return ok(`${animationText(d)}\nSheets (a person reads them with file_read): ${(r.result?.rows ?? []).map((x) => x.sheet).filter(Boolean).join(', ')}`, d);
      },
    },
  ];
}
