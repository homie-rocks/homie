/**
 * What `homie-studio build` does for a game written as rules plus view (rooms-milestone-1-design.md, section 8).
 *
 * A rules game is games/<id>/src/rules.ts, move.ts and view.ts, with game.json ("entry": "src/view.ts"),
 * tunables.json and map/. Its build makes the view and the guarded rules:
 *
 *   the view's bundle     view.ts and move.ts, for the browser, as every game's bundle is made (lib/build.mjs). The
 *                         move code in it is the guarded, counted module the server runs, not the source; none of
 *                         the rules' handlers enter the view itself, only their declarations as data.
 *   the offline module   the guarded rules, host runtime and all tunables, fetched after playable when offline is
 *                         enabled. Browser-hosted games import it eagerly; private server games do not ship it.
 *   the server module    rules.ts and move.ts as ONE JavaScript module, types removed and guards added
 *                         (lib/rules-guard.mjs), written to site/src/rules/<id>.mjs with the game's tunables, map and
 *                         settings beside it (<id>.data.mjs) and a table of every such game (index.mjs). The studio's
 *                         site/src/worker.mjs imports that table, so the rules reach the Table in the Worker's own
 *                         bundle. These files are build output that is committed with the studio, like wrangler.jsonc:
 *                         the Worker cannot be bundled without them.
 *
 * Before anything is written, the toolkit's own compiler checks rules, movement and view against the game's
 * declarations (lib/typecheck.mjs, on every build), and the guarded module is played with generated input in a worker
 * thread (lib/rules-check.mjs). The module that is played is the module that is written.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GUARD_MODULE, RULES_MODULE, guardRules, guardedPlugin, problemLine } from './rules-guard.mjs';
import { capOf, RULES_FRAMES, rulesRates } from '../worker/limits.mjs';
import { PACKAGE_ROOT, isRulesGame, rulesIndex } from './studio.mjs';
import { ALLOWANCE, LONG_ALLOWANCE, runRulesWorker } from './rules-check.mjs';
import { typecheckRules } from './typecheck.mjs';

export { isRulesGame };
export { stateHash } from './rules-check.mjs';

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const RULES_FILES = { [RULES_MODULE]: 'rules.ts', [GUARD_MODULE]: 'guard.ts', [`${RULES_MODULE}/view`]: 'view.ts', [`${RULES_MODULE}/host`]: 'host.ts' };

/** An esbuild plugin: Homie's rules modules resolve to this package's own files, wherever the studio's node_modules puts it. */
export function rulesModulesPlugin() {
  return {
    name: 'homie-rules-modules',
    setup(b) { b.onResolve({ filter: /^@homie-rocks\/studio\/rules(?:\/(?:guard|view|host))?$/ }, (a) => ({ path: join(PACKAGE_ROOT, 'rules', RULES_FILES[a.path]) })); },
  };
}

/** The game's map: games/<id>/map/main.json, else the first map file by name. One file per map. */
function readMap(g) {
  const dir = join(g.dir, 'map');
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')).sort() : [];
  const name = names.includes('main.json') ? 'main.json' : names[0];
  if (!name) throw new Error(`games/${g.id}/map/ needs a map: map/main.json with "bounds", and the "boxes", "circles" and named "spots" the rules use`);
  const raw = readJson(join(dir, name));
  if (!raw || typeof raw !== 'object') throw new Error(`games/${g.id}/map/${name} is not JSON`);
  return { ...raw, name: name.replace(/\.json$/, '') };
}

/**
 * The rules, loaded in Node: the linked module beside the runtime, as one file of its own that imports nothing.
 * Returns the module (`def`) and the runtime it was linked with: `R` (rules.ts), `H` (host.ts), `C` (core.ts),
 * `W` (guard.ts, the wall), `P` (pack.ts) and `M` (math.ts). They are one instance together, apart from any other
 * copy of the runtime in this process, so the guard's budget counter is theirs alone.
 */
export async function loadRules(esbuild, root, id, code, { bundleOnly = false } = {}) {
  const dir = join(root, '.studio', 'rules');
  mkdirSync(dir, { recursive: true });
  const gen = join(dir, `${id}-${process.pid}-${++loads}.linked.mjs`);
  writeFileSync(gen, code);
  const lib = (name) => JSON.stringify(join(PACKAGE_ROOT, 'rules', name));
  const entry = `import def from ${JSON.stringify(gen)};\nimport * as R from ${lib('rules.ts')};\nimport * as H from ${lib('host.ts')};\nimport * as C from ${lib('core.ts')};\nimport * as W from ${lib('guard.ts')};\nimport * as P from ${lib('pack.ts')};\nimport * as M from ${lib('math.ts')};\nexport { def, R, H, C, W, P, M };\n`;
  try {
  const res = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, format: bundleOnly ? 'cjs' : 'esm', target: 'es2022', platform: 'neutral', write: false, logLevel: 'silent', plugins: [rulesModulesPlugin()] });
  const text = res.outputFiles[0].text;
  if (bundleOnly) { rmSync(gen, { force: true }); return text; }
  const out = join(dir, `${id}.check-${createHash('sha256').update(text).digest('hex').slice(0, 12)}-${process.pid}-${(loads += 1)}.mjs`);
  writeFileSync(out, text);
  try { return await import(pathToFileURL(out).href); } finally { rmSync(out, { force: true }); }
  } catch (error) {
    if (/No matching export.*default/s.test(error.message)) throw new Error(`games/${id}/src/rules.ts: the rules need a default export. Use export default defineRules({ ... }).`);
    throw error;
  } finally { rmSync(gen, { force: true }); }
}
let loads = 0;

/**
 * Three seconds of the room's clock with bots and one seated player, on a clock of the caller's own.
 *
 * Every tick is also timed (`timer`, milliseconds). A tick has one period of the room's clock to run in. One slow tick
 * on a busy computer proves nothing, so the line is three ticks of the run over the period, or one tick over four
 * periods: either throws, naming the handler that used the most.
 *
 * The build calls this with a constant timer solely to measure browser frame sizes and rates. Real CPU timing is
 * only for manual measurements: what it would decide depends on the computer and on what else that computer is doing,
 * and a build's verdict may not (lib/rules-check.mjs plays the game instead, and counts in budget units).
 */
export function smokeRun(H, compiled, id, { timer = () => { const t = process.cpuUsage(); return (t.user + t.system) / 1000; }, vocab = null } = {}) {
  let now = 1_000_000_000_000;
  let control = [];
  let snapshotBytes = 0; let checkpointBytes = 0;
  const frameBytes = {}; const frameRates = {}; const sentAt = {};
  const measure = (m, text) => {
    if (!RULES_FRAMES.includes(m.t)) return;
    frameBytes[m.t] = Math.max(frameBytes[m.t] ?? 0, Buffer.byteLength(JSON.stringify({ ...m, rules: true })));
    const times = (sentAt[m.t] ??= []);
    // The large synthetic clock loses a fraction of a millisecond at sixty ticks per second.
    while (times.length && now - times[0] >= 1000 - 0.1) times.shift();
    times.push(now);
    frameRates[m.t] = Math.max(frameRates[m.t] ?? 0, times.length);
    if (m.t === 'snap') { snapshotBytes = frameBytes.snap; control = m.c.map(([seat, r, ack]) => [seat, r, 1, ack]); }
  };
  const host = H.createHost({ game: id, compiled, check: true, send: measure, clock: { now: () => now, setTimer: () => 0, clearTimer() {} }, random: () => 0.5 });
  if (vocab) { host.frame({ t: 'vocabulary', vocab }); host.frame({ t: 'policy', policy: { kind: 'beginner', guides: 1, aiSeats: 0, bots: 'fill', brain: 'script' } }); }
  if (typeof compiled.join === 'function') host.frame({ t: 'join', peer: { id: 'build', seat: 0, name: 'Build', occ: 1 } });
  const period = 1000 / compiled.settings.tickHz;
  let slowest = 0; let slowestTick = 0; let over = 0;
  for (let i = 0; i < 3 * compiled.settings.tickHz; i += 1) {
    now += period;
    const t0 = timer();
    host.tickNow();
    const ms = timer() - t0;
    checkpointBytes = Math.max(checkpointBytes, Buffer.byteLength(JSON.stringify({ t: 'ckpt', rules: true, k: host.tick, st: now, c: control, d: { rules: '0000000000000000', data: JSON.parse(new TextDecoder().decode(host.save())) } })));
    if (ms > slowest) { slowest = ms; slowestTick = host.tick; }
    if (ms > period) over += 1;
  }
  const s = host.core.stats;
  const facts = host.facts();
  host.stop();
  if (facts.faults) throw new Error(`games/${id}: its rules ran for three seconds with bots and the runtime itself failed ${facts.faults} ${facts.faults === 1 ? 'time' : 'times'}. The last: ${facts.lastFault}`);
  if (s.errors) throw new Error(`games/${id}: its rules ran for three seconds with bots and ${s.errors} ${s.errors === 1 ? 'handler' : 'handlers'} failed. The last: ${s.lastError}`);
  if (over >= 3 || slowest > 4 * period) throw new Error(`games/${id}: its rules ran for three seconds with bots and were too slow: tick ${slowestTick} took ${Math.round(slowest)} ms${over > 1 ? `, and ${over} ticks took longer than a tick lasts` : ''}. A tick lasts ${Math.round(period)} ms at ${compiled.settings.tickHz} ticks a second. The handler that used the most: ${s.worst || 'none'} (${s.maxUnits} budget units); the busiest tick used ${s.maxTickUnits} of ${compiled.settings.budget.tick}`);
  return { ...s, slowestMs: slowest, snapshotBytes, checkpointBytes, frameBytes: { ...frameBytes, ckpt: checkpointBytes }, frameRates };
}

/**
 * Everything a rules game's build needs, or an Error that says what to fix (each refused line named).
 * Returns { code, tune, map, settings, seats, stateHash, schema, publicTune, build, files, rounds, units, tickUnits, check }.
 * `longCheck`: eight times the generated play (`homie-studio build --long-check`).
 */
export async function prepareRules(esbuild, root, g, { log = () => {}, longCheck = false } = {}) {
  const guarded = await guardRules(esbuild, root, g.dir);
  if (!guarded.ok) throw new Error(`games/${g.id}: its rules were refused.\n${guarded.problems.slice(0, 20).map((p) => `  ${problemLine(p)}`).join('\n')}${guarded.problems.length > 20 ? `\n  … and ${guarded.problems.length - 20} more` : ''}`);
  const tune = readJson(join(g.dir, 'tunables.json')) ?? {};
  const map = readMap(g);
  const seats = Math.max(1, Math.min(32, Math.floor(Number(g.players?.max)) || 8));
  const bundle = await loadRules(esbuild, root, g.id, guarded.code, { bundleOnly: true });
  const data = { id: g.id, tune, map, room: g.room, seats, vocab: readJson(join(g.dir, 'agents.json')), sites: guarded.sites };
  // The declarations first, for the type check: a wrong program is named by the compiler before anything is played.
  await typecheckRules(root, g, await runRulesWorker(bundle, data, { declarationsOnly: true }), tune, { log });
  const checked = await runRulesWorker(bundle, data, { allowance: longCheck ? LONG_ALLOWANCE : ALLOWANCE });
  for (const p of checked.problems) log(`warning: games/${g.id}/game.json: ${p}`);
  for (const line of checked.information) log(`info: ${line}`);
  const { settings, schema, publicTune, rounds, stateHash } = checked;
  const { def, R, H } = await loadRules(esbuild, root, g.id, guarded.code);
  const compiled = R.compileRules(def, { tune, map: R.compileMap(map, map.name), settings, seats });
  const stats = smokeRun(H, compiled, g.id, { timer: () => 0, vocab: data.vocab });
  const snapshotCap = capOf('snap', seats); const checkpointCap = capOf('ckpt', seats);
  const exceeded = RULES_FRAMES.flatMap(t => {
    const bytes = stats.frameBytes[t] ?? 0; const cap = capOf(t, seats);
    const rate = stats.frameRates[t] ?? 0; const rateCap = rulesRates(settings.tickHz, seats)[t];
    return [...(bytes > cap ? [`${t} ${bytes} B (cap ${cap} B; over by ${bytes - cap} B)`] : []),
      ...(t !== 'snap' && rate > rateCap ? [`${t} ${rate}/s (cap ${rateCap}/s; over by ${rate - rateCap}/s)`] : [])];
  });
  if (exceeded.length) {
    const message = `games/${g.id}: browser rules smoke run measured snapshot ${stats.snapshotBytes} B (cap ${snapshotCap} B), checkpoint ${stats.checkpointBytes} B (cap ${checkpointCap} B). Exceeded: ${exceeded.join(', ')}. Reduce these frames or use room.host: server; offline play has no relay caps.`;
    if (settings.host === 'browser') throw new Error(message);
    log(`warning: ${message}`);
  }
  const built = { tune, map, settings, seats };
  return {
    code: guarded.code, ...built, stateHash, schema, publicTune, files: guarded.files, rounds,
    build: createHash('sha256').update(guarded.code).update(JSON.stringify(built)).digest('hex'),
    snapshotCap, checkpointCap, snapshotBytes: stats.snapshotBytes, checkpointBytes: stats.checkpointBytes,
    units: checked.maxUnits, tickUnits: checked.maxTickUnits,
    check: { information: checked.information, plays: checked.plays, ticks: checked.ticks, rounds: checked.roundsPlayed, restores: checked.restores, units: checked.units, largestSaveBytes: checked.largestSaveBytes },
  };
}

/**
 * An esbuild plugin for a rules game's view bundle. The bundle's entry becomes two imports: first the game's
 * declarations and its guarded move code handed to the view library (`setGame`), then the game's own view.ts. So
 * `openRoom()` in view.ts needs no argument, and `move` in the bundle is the module the server runs.
 */
export function viewPlugin(g, rules, entry, { lab = false } = {}) {
  const move = join(g.dir, 'src', 'move.ts');
  const game = { id: g.id, schema: lab ? { ...rules.schema, settings: { ...rules.settings, offline: true } } : rules.schema, tune: rules.publicTune, map: rules.map, vocab: readJson(join(g.dir, 'agents.json')) };
  const local = lab || rules.settings.host === 'browser';
  const available = local || rules.settings.offline;
  const factory = local ? `import { makeHost } from 'homie:host';\nconst loadHost = () => Promise.resolve(makeHost);` : available ? `const loadHost = () => import('homie:host').then(m => m.makeHost);` : 'const loadHost = undefined;';
  const guarded = guardedPlugin(rules.files, { stub: [join(g.dir, 'src', 'rules.ts')] });
  return {
    name: 'homie-rules-view',
    setup(b) {
      if (!lab) {
        b.onResolve({ filter: /lab\/lab\.ts$/ }, () => ({ path: 'production-lab', namespace: 'homie-no-lab' }));
        b.onLoad({ filter: /.*/, namespace: 'homie-no-lab' }, () => ({ contents: 'export const lab = { rulesTune: x => x, stage: null };', loader: 'js' }));
      }
      b.onResolve({ filter: /^homie:(?:view|game|host|rules)$/ }, (a) => ({ path: a.path, namespace: 'homie-view' }));
      b.onLoad({ filter: /.*/, namespace: 'homie-view' }, (a) => {
        if (a.path === 'homie:rules') return { contents: rules.code, resolveDir: g.dir, loader: 'js' };
        if (a.path === 'homie:host') return { contents: `import def from 'homie:rules';\nimport { browserHost } from ${JSON.stringify(join(PACKAGE_ROOT, 'rules', 'browser.ts'))};\nexport const makeHost = browserHost(def, ${JSON.stringify({ id: g.id, build: rules.build, tune: rules.tune, map: rules.map, settings: rules.settings, seats: rules.seats, vocab: game.vocab })});\n`, resolveDir: g.dir, loader: 'js' };
        return (a.path === 'homie:view'
        ? { contents: `import 'homie:game';\nimport ${JSON.stringify(entry)};\n`, resolveDir: g.dir, loader: 'js' }
        : { contents: `${existsSync(move) ? `import { move } from ${JSON.stringify(move)};` : 'const move = {};'}\nimport { setGame${game.vocab ? ', setAgentFactory' : ''} } from '${RULES_MODULE}/view';\n${game.vocab ? `import { useAgents } from ${JSON.stringify(join(PACKAGE_ROOT, 'agents/agents.ts'))}; setAgentFactory(useAgents);` : ''}\n${factory}\nsetGame(${JSON.stringify(game)}, move, loadHost);\n`, resolveDir: g.dir, loader: 'js' });
      });
      rulesModulesPlugin().setup(b);
      guarded.setup(b);
    },
  };
}

const HEADER = '// Written by `homie-studio build` from this studio\'s games. Do not edit: the next build writes it again.\n';

/**
 * site/src/rules/: one module and one data file per server-hosted game, and the table the Worker imports. `built` are
 * the games this build made; a one-game build keeps the others' files. A game that is gone, or no longer a rules game,
 * loses its files.
 */
export function writeRules(root, built, ids) {
  const dir = join(root, 'site', 'src', 'rules');
  mkdirSync(dir, { recursive: true });
  for (const r of built.filter((r) => r.settings.host === 'server')) {
    writeFileSync(join(dir, `${r.id}.mjs`), `${HEADER}// The rules of games/${r.id}, checked and guarded (build ${r.build}).\n${r.code}`);
    writeFileSync(join(dir, `${r.id}.data.mjs`), `${HEADER}export default ${JSON.stringify({ tune: r.tune, map: r.map, settings: r.settings, seats: r.seats, build: r.build, stateHash: r.stateHash }, null, 2)};\n`);
  }
  const have = ids.filter((id) => existsSync(join(dir, `${id}.mjs`)) && existsSync(join(dir, `${id}.data.mjs`)));
  for (const name of readdirSync(dir)) {
    const id = /^(.+?)(?:\.data)?\.mjs$/.exec(name)?.[1];
    if (name !== 'index.mjs' && id && !have.includes(id)) rmSync(join(dir, name), { force: true });
  }
  writeFileSync(join(dir, 'index.mjs'), rulesIndex(have));
  return have;
}
