/**
 * What `homie-studio build` does for a game written as rules plus view (rooms-milestone-1-design.md, section 8).
 *
 * A rules game is games/<id>/src/rules.ts, move.ts and view.ts, with game.json ("entry": "src/view.ts"),
 * tunables.json and map/. Its build makes two things:
 *
 *   the view's bundle     view.ts and move.ts, for the browser, as every game's bundle is made (lib/build.mjs). The
 *                         move code in it is the guarded, counted module the server runs, not the source; none of
 *                         the rules' own code is in it (rules.ts is left out whole), only their declarations as data.
 *   the rules' module     rules.ts and move.ts as ONE JavaScript module, types removed and guards added
 *                         (lib/rules-guard.mjs), written to site/src/rules/<id>.mjs with the game's tunables, map and
 *                         settings beside it (<id>.data.mjs) and a table of every such game (index.mjs). The studio's
 *                         site/src/worker.mjs imports that table, so the rules reach the Table in the Worker's own
 *                         bundle. These files are build output that is committed with the studio, like wrangler.jsonc:
 *                         the Worker cannot be bundled without them.
 *
 * Before anything is written the rules are loaded in Node, with no Cloudflare at all: compiled against the contract
 * (rules/rules.ts `compileRules`), then run for three seconds of the room's clock with bots and one seated player.
 * A declaration that does not fit, or a handler that throws or runs out its budget in those seconds, stops the build
 * with its name. (The full build check, with generated runs compared tick by tick, is a later release's.)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GUARD_MODULE, RULES_MODULE, guardRules, guardedPlugin, problemLine } from './rules-guard.mjs';
import { PACKAGE_ROOT, isRulesGame, rulesIndex } from './studio.mjs';

export { isRulesGame };

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
export async function loadRules(esbuild, root, id, code) {
  const dir = join(root, '.studio', 'rules');
  mkdirSync(dir, { recursive: true });
  const gen = join(dir, `${id}.linked.mjs`);
  writeFileSync(gen, code);
  const lib = (name) => JSON.stringify(join(PACKAGE_ROOT, 'rules', name));
  const entry = `import def from ${JSON.stringify(gen)};\nimport * as R from ${lib('rules.ts')};\nimport * as H from ${lib('host.ts')};\nimport * as C from ${lib('core.ts')};\nimport * as W from ${lib('guard.ts')};\nimport * as P from ${lib('pack.ts')};\nimport * as M from ${lib('math.ts')};\nexport { def, R, H, C, W, P, M };\n`;
  const res = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, format: 'esm', target: 'es2022', platform: 'neutral', write: false, logLevel: 'silent', plugins: [rulesModulesPlugin()] });
  const text = res.outputFiles[0].text;
  const out = join(dir, `${id}.check-${createHash('sha256').update(text).digest('hex').slice(0, 12)}-${process.pid}-${(loads += 1)}.mjs`);
  writeFileSync(out, text);
  try { return await import(pathToFileURL(out).href); } finally { rmSync(out, { force: true }); rmSync(gen, { force: true }); }
}
let loads = 0;

/** Three seconds of the room's clock with bots and one seated player, on a clock of the build's own. */
function smokeRun(H, compiled, id) {
  let now = 0;
  const host = H.createHost({ game: id, compiled, send() {}, clock: { now: () => now, setTimer: () => 0, clearTimer() {} }, random: () => 0.5 });
  host.frame({ t: 'join', peer: { id: 'build', seat: 0, name: 'Build', occ: 1 } });
  const period = 1000 / compiled.settings.tickHz;
  for (let i = 0; i < 3 * compiled.settings.tickHz; i += 1) { now += period; host.tickNow(); }
  const s = host.core.stats;
  host.stop();
  if (s.errors) throw new Error(`games/${id}: its rules ran for three seconds with bots and ${s.errors} ${s.errors === 1 ? 'handler' : 'handlers'} failed. The last: ${s.lastError}`);
  return s;
}

/**
 * Everything a rules game's build needs, or an Error that says what to fix (each refused line named).
 * Returns { code, tune, map, settings, seats, schema, publicTune, build, files, rounds, problems, units }.
 */
export async function prepareRules(esbuild, root, g, { log = () => {} } = {}) {
  const guarded = await guardRules(esbuild, root, g.dir);
  if (!guarded.ok) throw new Error(`games/${g.id}: its rules were refused.\n${guarded.problems.slice(0, 20).map((p) => `  ${problemLine(p)}`).join('\n')}${guarded.problems.length > 20 ? `\n  … and ${guarded.problems.length - 20} more` : ''}`);
  const tune = readJson(join(g.dir, 'tunables.json')) ?? {};
  const map = readMap(g);
  const { def, R, H } = await loadRules(esbuild, root, g.id, guarded.code);
  const { settings, problems } = R.roomSettings(g.room);
  for (const p of problems) log(`warning: games/${g.id}/game.json: ${p}`);
  if (settings.host === 'browser') throw new Error(`games/${g.id}/game.json asks for "room": { "host": "browser" }. Rules hosted by a player's browser arrive in a later release; until then a rules game is hosted by the server ("host": "server", the default).`);
  const seats = Math.max(1, Math.min(32, Math.floor(Number(g.players?.max)) || 8));
  let compiled;
  try { compiled = R.compileRules(def, { tune, map: R.compileMap(map, map.name), settings, seats }); } catch (error) { throw new Error(`games/${g.id}/src/rules.ts: ${error.message}`); }
  const stats = smokeRun(H, compiled, g.id);
  const data = { tune, map, settings, seats };
  return {
    code: guarded.code, ...data, schema: R.schemaOf(compiled), publicTune: compiled.publicTune, files: guarded.files, rounds: compiled.rounds,
    build: createHash('sha256').update(guarded.code).update(JSON.stringify(data)).digest('hex').slice(0, 16), units: stats.maxUnits,
  };
}

/**
 * An esbuild plugin for a rules game's view bundle. The bundle's entry becomes two imports: first the game's
 * declarations and its guarded move code handed to the view library (`setGame`), then the game's own view.ts. So
 * `openRoom()` in view.ts needs no argument, and `move` in the bundle is the module the server runs.
 */
export function viewPlugin(g, rules, entry) {
  const move = join(g.dir, 'src', 'move.ts');
  const game = { id: g.id, schema: rules.schema, tune: rules.publicTune, map: rules.map };
  const guarded = guardedPlugin(rules.files, { stub: [join(g.dir, 'src', 'rules.ts')] });
  return {
    name: 'homie-rules-view',
    setup(b) {
      b.onResolve({ filter: /^homie:(?:view|game)$/ }, (a) => ({ path: a.path, namespace: 'homie-view' }));
      b.onLoad({ filter: /.*/, namespace: 'homie-view' }, (a) => (a.path === 'homie:view'
        ? { contents: `import 'homie:game';\nimport ${JSON.stringify(entry)};\n`, resolveDir: g.dir, loader: 'js' }
        : { contents: `${existsSync(move) ? `import { move } from ${JSON.stringify(move)};` : 'const move = {};'}\nimport { setGame } from '${RULES_MODULE}/view';\nsetGame(${JSON.stringify(game)}, move);\n`, resolveDir: g.dir, loader: 'js' }));
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
  for (const r of built) {
    writeFileSync(join(dir, `${r.id}.mjs`), `${HEADER}// The rules of games/${r.id}, checked and guarded (build ${r.build}).\n${r.code}`);
    writeFileSync(join(dir, `${r.id}.data.mjs`), `${HEADER}export default ${JSON.stringify({ tune: r.tune, map: r.map, settings: r.settings, seats: r.seats, build: r.build }, null, 2)};\n`);
  }
  const have = ids.filter((id) => existsSync(join(dir, `${id}.mjs`)) && existsSync(join(dir, `${id}.data.mjs`)));
  for (const name of readdirSync(dir)) {
    const id = /^(.+?)(?:\.data)?\.mjs$/.exec(name)?.[1];
    if (name !== 'index.mjs' && id && !have.includes(id)) rmSync(join(dir, name), { force: true });
  }
  writeFileSync(join(dir, 'index.mjs'), rulesIndex(have));
  return have;
}
