/** Unattended edit trials. Supply an installed agent as a JSON argv array; no provider or credential is chosen here. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(pkg, 'bin/homie-studio.mjs');
export const REQUESTS = Object.freeze([
  { id: 'double-coins', text: 'Make every coin worth two points.' },
  { id: 'short-round', text: 'Make a round last thirty seconds and the break five seconds.' },
  { id: 'slower-runners', text: 'Make runners move at four metres per second.' },
]);
function command(argv, cwd, input, log, timeout = 300_000) {
  return new Promise((ok, no) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill('SIGKILL'); }, timeout);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (b) => { output += b; });
    child.stdin.end(input);
    child.on('error', (e) => { clearTimeout(timer); no(e); });
    child.on('close', (code) => { clearTimeout(timer); writeFileSync(log, output); if (code || expired) no(new Error(`${argv[0]} ${expired ? 'timed out' : `exited ${code}`}; see ${log}`)); else ok(output); });
  });
}
function digest(dir) {
  const h = createHash('sha256');
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { if (e.isDirectory()) walk(join(d, e.name)); else h.update(e.name).update(readFileSync(join(d, e.name))); } };
  walk(dir); return h.digest('hex');
}
/** Check the requested behavior using the edited rules and their real movement and event dispatch. */
export async function verifyRequest(root, dir, request) {
  const { loadGame } = await import('./rules-kit.mjs');
  const L = await loadGame(root, dir, `verify-${request}`);
  const tune = JSON.parse(readFileSync(join(dir, 'tunables.json'), 'utf8'));
  const map = L.R.compileMap(JSON.parse(readFileSync(join(dir, 'map/main.json'), 'utf8')), 'main');
  const c = L.R.compileRules(L.def, { tune, map, seats: 8 });
  const core = L.C.createCore(c, { seed: 7 });
  if (request === 'short-round') {
    core.step(); core.drain();
    const round = core.save().round;
    if (c.rounds?.seconds !== 30 || c.rounds?.breakSeconds !== 5 || round[2] - round[3] !== 30 * c.settings.tickHz) throw new Error('requested thirty-second rounds with five-second breaks; expected both actual deadlines');
    return { seconds: 30, breakSeconds: 5 };
  }
  let peak = 0; let scores = 0; const previous = new Map();
  for (let tick = 0; tick < 600; tick++) {
    core.step(); core.drain();
    for (const body of core.bodies()) {
      const before = previous.get(body.id) ?? 0;
      if (body.score > before) {
        const increase = body.score - before;
        if (request === 'double-coins' && increase !== 2) throw new Error(`requested two points per coin; expected 2, observed ${increase}`);
        scores++;
      }
      previous.set(body.id, body.score);
    }
    for (const e of core.save().ents) if (c.kinds[e[2]].player) peak = Math.max(peak, Math.hypot(...e[8]));
    if (request === 'double-coins' && scores >= 6) return { pickups: scores, points: 2 };
    if (request === 'slower-runners' && tick >= 100) {
      if (Math.abs(peak - 4) > 0.02) throw new Error(`requested four metres per second; expected 4, observed ${peak.toFixed(3)}`);
      return { metresPerSecond: peak };
    }
  }
  throw new Error('requested coin change was not demonstrated: expected six observed pickups');
}
/** The caller supplies a disposable, installed studio. Each request starts from the unchanged starter. */
export async function authoring({ studio, agent, skill, port = 18944, run = command }) {
  if (!Array.isArray(agent) || !agent.length || agent.some((v) => typeof v !== 'string')) throw new Error('--agent-json is a nonempty JSON array of executable and arguments');
  const output = join(studio, '.checks/authoring'); mkdirSync(output, { recursive: true });
  const guide = readFileSync(skill, 'utf8'); const reference = readFileSync(join(dirname(skill), 'RULES.md'), 'utf8');
  const rows = [];
  for (const request of REQUESTS) {
    const game = `author-${request.id}`;
    const dir = join(studio, 'games', game);
    if (existsSync(dir)) throw new Error(`${game} already exists; use a fresh disposable studio`);
    cpSync(join(pkg, 'starters/coin-dash'), dir, { recursive: true });
    const meta = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8')); meta.id = game;
    writeFileSync(join(dir, 'game.json'), `${JSON.stringify(meta, null, 2)}\n`);
    const before = digest(dir);
    const row = { request: request.text, game, ok: false };
    try {
      await run(agent, studio, `${guide}\n\n${reference}\n\nEdit only games/${game}. Do not deploy or ask questions. ${request.text}\n`, join(output, `${game}-agent.log`));
      if (digest(dir) === before) throw new Error('the agent made no change to the game');
      await run([process.execPath, cli, 'build', game], studio, '', join(output, `${game}-build.log`));
      row.behavior = await verifyRequest(studio, dir, request.id);
      // The studio's preview owns Wrangler and starts in the background using the existing MCP job mechanism.
      const { startJob } = await import('../lib/jobs.mjs');
      const preview = startJob({ root: studio, label: 'authoring preview', cmd: process.execPath, args: [cli, 'dev', '--port', String(port)] });
      row.preview = preview.id;
      try {
        const url = `http://127.0.0.1:${port}`;
        const until = Date.now() + 120_000;
        while (Date.now() < until) { try { if ((await fetch(`${url}/${game}/play`)).ok) break; } catch { /* still building */ } await new Promise((r) => setTimeout(r, 500)); }
        await run([process.execPath, cli, 'check', game, '--url', url, '--shots', join(output, game)], studio, '', join(output, `${game}-browsers.log`));
        row.ok = true;
      } finally { await run([process.execPath, cli, 'dev', '--stop'], studio, '', join(output, `${game}-stop.log`)); }
    } catch (e) { row.error = e.message; }
    rows.push(row);
    writeFileSync(join(output, 'report.json'), `${JSON.stringify({ agent, rows }, null, 2)}\n`);
  }
  return rows;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { studio: { type: 'string' }, 'agent-json': { type: 'string' }, skill: { type: 'string' }, port: { type: 'string' } } });
  if (!values.studio || !values['agent-json'] || !values.skill) throw new Error('Usage: node test/authoring.mjs --studio <disposable installed studio> --agent-json <JSON argv> --skill <game/SKILL.md>');
  const rows = await authoring({ studio: resolve(values.studio), agent: JSON.parse(values['agent-json']), skill: resolve(values.skill), port: Number(values.port ?? 18944) });
  console.log(JSON.stringify(rows, null, 2));
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
}
