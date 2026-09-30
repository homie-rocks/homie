#!/usr/bin/env node
/**
 * homie-studio — make a studio (games, music, videos, posts), make its games,
 * put its site on the studio's own Cloudflare (free plan, no payment method), and
 * list its games in the homie.rocks directory.
 *
 *   homie-studio new <folder> --name "<Studio Name>" [--homie <directory url>] [--no-install]
 *   homie-studio starters
 *   homie-studio game new <id> [--from gem-rush] [--name "<Game Name>"]
 *   homie-studio game remix <source.json url> --id <new id>
 *   homie-studio games
 *   homie-studio build [<id>]
 *   homie-studio dev [--port 8787]        (--stop: stop exactly this studio's dev server, nothing else)
 *   homie-studio check <id> [--url <site>] [--shots <dir>]
 *   homie-studio port plan <game folder>
 *   homie-studio port import <game folder> --id <id> [--name "<Name>"] [--mode static|bundle|command]
 *   homie-studio port check <id> [--url <site>] [--only owner-desk,owner-phone,owner-iphone,round,life,tv] [--shots <dir>]
 *   homie-studio deploy [--plan]          (--plan: what it will create on Cloudflare and what it costs; changes nothing)
 *   homie-studio publish
 *   homie-studio storage add              (large media only: an R2 bucket; needs R2 turned on for the account)
 *   homie-studio media put <file> [--as <key>]
 *   homie-studio media list
 *   homie-studio status
 *
 * Every command prints a few lines for a person; --json prints the result.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { build } from '../lib/build.mjs';
import { check } from '../lib/check.mjs';
import { deploy, deployPlan, storageAdd, whoami, wranglerBin } from '../lib/cloudflare.mjs';
import { publish } from '../lib/directory.mjs';
import { importPort, planPort } from '../lib/port.mjs';
import { portCheck } from '../lib/port-check.mjs';
import { recordUpload, resolveMedia, typeOf } from '../lib/media.mjs';
import { newStudio } from '../lib/scaffold.mjs';
import { listGames, newGame, readStudio, remixGame, requireStudio, starters } from '../lib/studio.mjs';
import { STUDIO_VERSION } from '../lib/version.mjs';

const argv = process.argv.slice(2);
const flags = new Map();
const BOOL_FLAGS = ['json', 'yes', 'detach', 'no-install', 'plan', 'stop'];
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split(/=(.*)/s, 2);
    if (v !== undefined) flags.set(k, v);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && !BOOL_FLAGS.includes(k)) flags.set(k, argv[++i]);
    else flags.set(k, true);
  } else positional.push(a);
}
const asJson = flags.has('json');
const log = asJson ? () => {} : (line) => process.stderr.write(`${line}\n`);

function print(result) {
  if (asJson) { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return; }
  if (result.ok === false && result.command !== 'port check') { process.stdout.write(`homie-studio: ${result.why ?? 'failed'}\n`); return; }
  if (result.ok === false && result.command === 'port check' && !result.rows) { process.stdout.write(`homie-studio: ${result.why ?? 'failed'}\n`); return; }
  const lines = [];
  switch (result.command) {
    case 'new':
      lines.push(`${result.name} is a studio now: ${result.dir}`, '', 'Wrote:', ...result.wrote.map((f) => `  ${f}`), '', `Dependencies: ${result.installed}`, '', 'Next:', ...result.next.map((n) => `  ${n}`), '', result.online);
      break;
    case 'game remix':
      lines.push(`games/${result.id} is a remix of ${result.from} (${result.files.length} files). Make it yours in games/${result.id}/src/, then: npx homie-studio dev`);
      break;
    case 'game new':
      lines.push(`games/${result.id} is a new game from the ${result.from} starter. Change it in games/${result.id}/src/, then: npx homie-studio dev`);
      break;
    case 'dev stop':
      lines.push(result.stopped.length ? `Stopped this studio's dev server (${result.stopped.join(', ')}).` : `Nothing to stop: ${result.why ?? 'no dev server of this studio is running'}.`);
      break;
    case 'build':
      lines.push(`Built ${result.games.map((g) => `${g.id} (${Math.round(g.bytes / 1024)} KB)`).join(', ') || 'no games'} into ${relative(process.cwd(), result.dist) || result.dist}`);
      if (result.songs?.length || result.videos?.length) lines.push(`Media pages: ${[...result.songs.map((x) => `/music/${x}/`), ...result.videos.map((x) => `/videos/${x}/`)].join(', ')}`);
      for (const m of result.mediaSkipped ?? []) lines.push(`  left out: ${m.kind}/${m.item}${m.file ? ` ${m.file}` : ''}: ${m.why}`);
      break;
    case 'media list':
      for (const kind of ['music', 'videos']) {
        lines.push(`${kind}/manifest.json: ${result[kind].pages.length} page(s)`);
        for (const e of result[kind].pages) lines.push(`  /${kind}/${e.slug}/  ${e.title}  (${e.files.map((f) => `${f.role} from ${f.from}`).join(', ')})`);
        for (const m of result[kind].skipped) lines.push(`  left out: ${m.item}${m.file ? ` ${m.file}` : ''}: ${m.why}`);
      }
      break;
    case 'deploy':
      lines.push(`Live: ${result.url}`, ...result.games.map((g) => `  ${g.id}: ${g.play}`), ...(result.songs ?? []).map((m) => `  song ${m.slug}: ${m.page}`), ...(result.videos ?? []).map((m) => `  video ${m.slug}: ${m.page}`), '', `Cloudflare: Worker ${result.worker}, D1 ${result.d1}, Durable Objects Table + Lobby${result.r2 ? `, R2 ${result.r2}` : ' (no storage: none needed; `homie-studio storage add` adds it for large media)'}. All on the free Workers plan${result.r2 ? ' plus R2' : ''}.`,
        result.claim ? 'Directory claim stored: list the games with the Homie MCP tool studio_publish, or: npx --no-install homie-studio publish' : 'No directory claim yet (the directory did not answer); publish will try again.');
      break;
    case 'deploy plan':
      lines.push(`What \`npm run deploy\` does for ${result.studio}, on the Cloudflare account the person approves:`, '',
        ...result.cloudflare.map((r) => `  ${r.kind}${r.name ? ` ${r.name}` : ''}: ${r.what} [${r.state}${r.plan ? `; ${r.plan}` : ''}]`), '',
        `Cost: ${result.cost}`, `Sign-in: ${result.login}`, `Address: ${result.address}`,
        `The directory (${result.directory.site}) stores: ${result.directory.stores}`, result.never);
      break;
    case 'storage add':
      lines.push(result.already ? `Storage is already added: R2 bucket ${result.bucket}.` : `Storage added: R2 bucket ${result.bucket}.`, 'Next:', ...result.next.map((n) => `  ${n}`));
      break;
    case 'publish':
      lines.push(`Listed in the directory: ${result.studioPage ?? result.directory}`, ...(result.games ?? []).map((g) => `  ${g.name}: ${g.play}`));
      break;
    case 'port plan': {
      const f = result.facts;
      lines.push(`Port plan for ${result.folder}`, '', `Difficulty: ${result.grade.toUpperCase()}`, ...result.reasons.map((r) => `  - ${r}`), '',
        `What it is: ${f.engine.join(', ')}; ${f.loc} lines of game code in ${f.files} files (${Math.round(f.bytes / 1024)} KB); ${f.turnBased ? 'turn-based / moves on input' : 'real time'}${f.physics.length ? `; physics: ${f.physics.join(', ')}` : ''}.`,
        `Input: keys ${f.input.keys}, mouse ${f.input.mouse}, touch ${f.input.touch}, pointer ${f.input.pointer}${f.input.pointerLock ? ', pointer lock' : ''}.`,
        `Recommended: movement "${result.recommend.movement}", check view "${result.recommend.view}", build "${result.recommend.build}".`,
        `Licence: ${result.licence.kind}${result.licence.file ? ` (${result.licence.file})` : ''}.`, '', 'Risks:', ...(result.risks.length ? result.risks.map((r) => `  - ${r}`) : ['  - none found by reading; the checks will say']));
      break;
    }
    case 'port import':
      lines.push(`games/${result.id} is a port of ${result.from} (${result.files} files, build "${result.mode}", draft grade ${result.plan.grade}).`, ...result.edits.map((e) => `  ${e}`), '', 'Next:', ...result.next.map((n) => `  - ${n}`));
      break;
    case 'port check':
      lines.push(`${result.ok ? 'PASS' : 'NOT YET'}: ${result.game} at ${result.url} (${Math.round(result.totalMs / 1000)} s)`,
        ...result.passed.map((p) => `  ok    ${p}`), ...result.failed.map((f) => `  FAIL  ${f}`), ...result.skipped.map((f) => `  skip  ${f}`), '', `Receipt and screenshots: ${result.out}`);
      break;
    case 'check':
      lines.push(`PASS: two fresh browsers in room ${result.room} finished round ${result.round.n} (${result.round.humans} humans, ${result.round.bots} bots) in ${Math.round(result.totalMs / 1000)} s.`,
        ...result.seats.map((s) => `  ${s.browser}: seat ${s.seat} (${s.role}), seated in ${(s.seatedMs / 1000).toFixed(1)} s`));
      break;
    default:
      lines.push(JSON.stringify(result, null, 2));
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main() {
  const [cmd, sub] = positional;
  if (!cmd || cmd === 'help' || flags.has('help')) {
    const text = readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].split('\n').slice(1).map((l) => l.replace(/^ \* ?/, '')).join('\n');
    process.stdout.write(`homie-studio ${STUDIO_VERSION}\n${text}\n`);
    return { ok: true, command: 'help' };
  }
  if (cmd === 'version' || flags.has('version')) return { ok: true, command: 'version', version: STUDIO_VERSION };
  if (cmd === 'new') return newStudio(positional[1], { name: flags.get('name'), homie: flags.get('homie'), slug: flags.get('slug'), install: !flags.has('no-install') });
  if (cmd === 'starters') return { ok: true, command: 'starters', starters: starters() };

  if (cmd === 'port' && sub === 'plan') return planPort(positional[2] ?? '.');
  const root = requireStudio();
  if (cmd === 'port' && sub === 'import') return importPort(root, positional[2], flags.get('id'), { name: flags.get('name'), mode: flags.get('mode') });
  if (cmd === 'port' && sub === 'check') {
    const game = positional[2] ?? listGames(root)[0]?.id;
    const url = flags.get('url') ?? readStudio(root).cloudflare?.url;
    if (!url) return { ok: false, command: 'port check', why: 'give --url (the local dev address or the live site)' };
    return portCheck({ url, game, root, only: flags.get('only') ?? null, shots: flags.get('shots') ? resolve(flags.get('shots')) : null, log });
  }
  if (cmd === 'game' && sub === 'new') return newGame(root, positional[2], { from: flags.get('from') ?? 'gem-rush', name: flags.get('name') });
  if (cmd === 'game' && sub === 'remix') return remixGame(root, positional[2], flags.get('id'), { name: flags.get('name') });
  if (cmd === 'games') return { ok: true, command: 'games', games: listGames(root).map(({ dir, ...g }) => ({ ...g, dir: relative(root, dir) })) };
  if (cmd === 'build') return build(root, { only: positional[1] ?? null, log });
  if (cmd === 'status') {
    const studio = readStudio(root);
    return { ok: true, command: 'status', root, studio, games: listGames(root).map((g) => g.id), cloudflareSignedIn: Boolean(wranglerBin(root) && whoami(root)) };
  }
  if (cmd === 'dev' && flags.has('stop')) return stopDev(root);
  if (cmd === 'dev') return dev(root);
  if (cmd === 'check') {
    const game = positional[1] ?? listGames(root)[0]?.id;
    const url = flags.get('url') ?? readStudio(root).cloudflare?.url;
    if (!url) return { ok: false, command: 'check', why: 'give --url (the local dev address or the live site)' };
    return check({ url, game, shots: flags.get('shots') ? resolve(flags.get('shots')) : null, log });
  }
  if (cmd === 'deploy' && flags.has('plan')) return deployPlan(root);
  if (cmd === 'deploy') return deploy(root, { log, homie: flags.get('homie') });
  if (cmd === 'storage' && sub === 'add') return storageAdd(root, { log });
  if (cmd === 'storage') {
    const cf = readStudio(root).cloudflare ?? {};
    const has = Boolean(cf.r2 && (cf.created ?? []).includes(`r2:${cf.r2}`));
    return { ok: true, command: 'storage', storage: has ? { kind: 'r2', bucket: cf.r2 } : null, why: has ? undefined : 'no storage yet: the studio runs without it; `homie-studio storage add` adds an R2 bucket for large media (Cloudflare asks for a payment method before R2 works)' };
  }
  if (cmd === 'publish') return publish(root, { homie: flags.get('homie'), site: flags.get('site') });
  if (cmd === 'media' && sub === 'put') return mediaPut(root, positional[2], flags.get('as'));
  if (cmd === 'media' && sub === 'list') {
    const studio = readStudio(root);
    const r2 = Boolean(studio.cloudflare?.r2 && (studio.cloudflare?.created ?? []).includes(`r2:${studio.cloudflare.r2}`));
    const view = (kind) => { const r = resolveMedia(root, kind, { r2 }); return { pages: r.entries.map((e) => ({ slug: e.slug, title: e.title, kind: e.kind, files: e.files.map(({ abs, rel, ...f }) => f) })), skipped: r.skipped }; };
    return { ok: true, command: 'media list', r2, site: studio.cloudflare?.url ?? null, music: view('music'), videos: view('videos') };
  }
  return { ok: false, command: cmd, why: `unknown command "${[cmd, sub].filter(Boolean).join(' ')}" (homie-studio help)` };
}

/*
 * WHICH DEV SERVER IS THIS STUDIO'S. `dev` writes its own PID and Wrangler's to site/.wrangler/homie-dev.json,
 * and `dev --stop` stops exactly those two (each checked to still be a process of this studio's folder), so an AI
 * never has to reach for `pkill -f "wrangler dev"`, which stops every project's dev server on the machine.
 */
const devFile = (root) => join(root, 'site', '.wrangler', 'homie-dev.json');
function processOfStudio(pid, root, kind) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false;
  try { process.kill(pid, 0); } catch { return false; }
  const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  if (ps.status !== 0) return process.platform === 'win32'; // no ps: the PID file is all there is
  let real = root;
  try { real = realpathSync(root); } catch { /* keep */ }
  // A PID the file names is still ours when it runs from this studio, or is still the kind of process it was
  // (a recycled PID is neither), so nothing else on the machine is ever stopped.
  return ps.stdout.includes(root) || ps.stdout.includes(real) || (kind === 'dev' ? /homie-studio/.test(ps.stdout) : /wrangler|workerd/.test(ps.stdout));
}
async function stopDev(root) {
  const file = devFile(root);
  if (!existsSync(file)) return { ok: true, command: 'dev stop', stopped: [], why: 'no dev server of this studio is running' };
  let rec = {};
  try { rec = JSON.parse(readFileSync(file, 'utf8')); } catch { /* a torn file */ }
  const pids = [[rec.child, 'wrangler'], [rec.pid, 'dev']].filter(([p, kind]) => processOfStudio(p, root, kind)).map(([p]) => p);
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  const deadline = Date.now() + 8000;
  const alive = () => pids.filter((p) => { try { process.kill(p, 0); return true; } catch { return false; } });
  while (alive().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  for (const pid of alive()) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  rmSync(file, { force: true });
  return { ok: true, command: 'dev stop', stopped: pids };
}

/** The whole site locally: pages, rooms (room.mjs in a local Durable Object), D1. */
async function dev(root) {
  const port = String(flags.get('port') ?? 8787);
  const b = await build(root, { log });
  if (!b.catalogue.length && !b.songs.length && !b.videos.length) return { ok: false, command: 'dev', why: 'nothing to show yet: npx homie-studio game new <id> --from gem-rush, or publish a song or video (media/MEDIA.md)' };
  const bin = wranglerBin(root);
  if (!bin) return { ok: false, command: 'dev', why: 'run npm install in the studio first' };
  const studio = readStudio(root);
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' };
  await new Promise((done) => {
    const m = spawn(bin, ['d1', 'migrations', 'apply', studio.cloudflare.d1, '--local'], { cwd: join(root, 'site'), env, stdio: ['ignore', 'ignore', 'inherit'] });
    m.on('close', done);
  });
  log(`Local site: http://127.0.0.1:${port}/  (each game: http://127.0.0.1:${port}/<id>/play — open it in two browsers)`);
  const child = spawn(bin, ['dev', '--local', '--ip', '127.0.0.1', '--port', port], { cwd: join(root, 'site'), env, stdio: 'inherit' });
  mkdirSync(dirname(devFile(root)), { recursive: true });
  writeFileSync(devFile(root), `${JSON.stringify({ pid: process.pid, child: child.pid, port: Number(port), at: new Date().toISOString() })}\n`);
  log(`Stop it with: npx --no-install homie-studio dev --stop   (this studio's dev server only)`);
  // Stopping this process stops Wrangler with it, so no dev server is left running on its own.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { try { child.kill(signal); } catch { /* gone */ } });
  await new Promise((done) => child.on('close', done));
  rmSync(devFile(root), { force: true });
  return { ok: true, command: 'dev', stopped: true };
}

/** A big file into the studio's R2, and its key on the music/ or videos/ manifest entry that names it. */
function mediaPut(root, file, as) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) return { ok: false, command: 'media put', why: 'usage: homie-studio media put <file> [--as <key>]' };
  const studio = readStudio(root);
  const r2 = studio.cloudflare?.r2;
  if (!r2 || !(studio.cloudflare?.created ?? []).includes(`r2:${r2}`)) return { ok: false, command: 'media put', needs: 'storage', why: 'this studio has no storage yet. `npx --no-install homie-studio storage add` adds an R2 bucket; Cloudflare asks for a payment method on the account before R2 works (10 GB-month free), so ask the person first. Games never need it.' };
  const rel = relative(root, resolve(file));
  const folder = rel.startsWith('videos/') ? 'videos' : 'music';
  // A file already in music/ or videos/ keeps its repository path as its key (two songs may share a file name).
  const key = as ?? (/^(music|videos)\//.test(rel) && !rel.includes('..') ? rel : `${folder}/${basename(file)}`);
  const bin = wranglerBin(root);
  return new Promise((done) => {
    const p = spawn(bin, ['r2', 'object', 'put', `${r2}/${key}`, '--file', resolve(file), '--content-type', typeOf(file), '--remote'], { cwd: join(root, 'site'), env: { ...process.env, CI: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('close', (code) => {
      if (code !== 0) return done({ ok: false, command: 'media put', why: 'wrangler r2 object put failed' });
      const rec = recordUpload(root, rel, key, statSync(file).size, studio.cloudflare?.url ?? null);
      done({ ok: true, command: 'media put', key, manifest: rec.manifest, entry: rec.entry, url: studio.cloudflare?.url ? `${studio.cloudflare.url}/media/${key}` : null });
    });
  });
}

try {
  const result = await main();
  if (result && result.command !== 'help') print(result);
  if (result?.ok === false) process.exitCode = 1;
  // Chrome's pipes can outlive browser.close(); a finished check must not hang its caller.
  if (result?.command === 'check' || result?.command === 'port check') process.exit(process.exitCode ?? 0);
} catch (error) {
  print({ ok: false, why: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
