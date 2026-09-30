#!/usr/bin/env node
/**
 * homie-studio — make a game studio, make its games, put its site on the
 * studio's own Cloudflare, and list its games in the homie.rocks directory.
 *
 *   homie-studio new <folder> --name "<Studio Name>" [--homie <directory url>] [--no-install]
 *   homie-studio starters
 *   homie-studio game new <id> [--from gem-rush] [--name "<Game Name>"]
 *   homie-studio game remix <source.json url> --id <new id>
 *   homie-studio games
 *   homie-studio build [<id>]
 *   homie-studio dev [--port 8787]
 *   homie-studio check <id> [--url <site>] [--shots <dir>]
 *   homie-studio port plan <game folder>
 *   homie-studio port import <game folder> --id <id> [--name "<Name>"] [--mode static|bundle|command]
 *   homie-studio port check <id> [--url <site>] [--only owner-desk,owner-phone,owner-iphone,round,life,tv] [--shots <dir>]
 *   homie-studio deploy
 *   homie-studio publish
 *   homie-studio media put <file> [--as <key>]
 *   homie-studio status
 *
 * Every command prints a few lines for a person; --json prints the result.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { build } from '../lib/build.mjs';
import { check } from '../lib/check.mjs';
import { deploy, whoami, wranglerBin } from '../lib/cloudflare.mjs';
import { publish } from '../lib/directory.mjs';
import { importPort, planPort } from '../lib/port.mjs';
import { portCheck } from '../lib/port-check.mjs';
import { newStudio } from '../lib/scaffold.mjs';
import { listGames, newGame, readStudio, remixGame, requireStudio, starters, writeStudio } from '../lib/studio.mjs';
import { STUDIO_VERSION } from '../lib/version.mjs';

const argv = process.argv.slice(2);
const flags = new Map();
const BOOL_FLAGS = ['json', 'yes', 'detach', 'no-install'];
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
      lines.push(`${result.name} is a studio now: ${result.dir}`, '', 'Wrote:', ...result.wrote.map((f) => `  ${f}`), '', `Dependencies: ${result.installed}`, '', 'Next:', ...result.next.map((n) => `  ${n}`));
      break;
    case 'game remix':
      lines.push(`games/${result.id} is a remix of ${result.from} (${result.files.length} files). Make it yours in games/${result.id}/src/, then: npx homie-studio dev`);
      break;
    case 'game new':
      lines.push(`games/${result.id} is a new game from the ${result.from} starter. Change it in games/${result.id}/src/, then: npx homie-studio dev`);
      break;
    case 'build':
      lines.push(`Built ${result.games.map((g) => `${g.id} (${Math.round(g.bytes / 1024)} KB)`).join(', ') || 'nothing'} into ${relative(process.cwd(), result.dist) || result.dist}`);
      break;
    case 'deploy':
      lines.push(`Live: ${result.url}`, ...result.games.map((g) => `  ${g.id}: ${g.play}`), '', `Cloudflare: Worker ${result.worker}, D1 ${result.d1}${result.r2 ? `, R2 ${result.r2}` : ', no R2 (not enabled on this account)'}`,
        result.claim ? 'Directory claim stored: list the games with the Homie MCP tool studio_publish, or: npx homie-studio publish' : 'No directory claim yet (the directory did not answer); publish will try again.');
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
  if (cmd === 'dev') return dev(root);
  if (cmd === 'check') {
    const game = positional[1] ?? listGames(root)[0]?.id;
    const url = flags.get('url') ?? readStudio(root).cloudflare?.url;
    if (!url) return { ok: false, command: 'check', why: 'give --url (the local dev address or the live site)' };
    return check({ url, game, shots: flags.get('shots') ? resolve(flags.get('shots')) : null, log });
  }
  if (cmd === 'deploy') return deploy(root, { log, homie: flags.get('homie') });
  if (cmd === 'publish') return publish(root, { homie: flags.get('homie'), site: flags.get('site') });
  if (cmd === 'media' && sub === 'put') return mediaPut(root, positional[2], flags.get('as'));
  return { ok: false, command: cmd, why: `unknown command "${[cmd, sub].filter(Boolean).join(' ')}" (homie-studio help)` };
}

/** The whole site locally: pages, rooms (room.mjs in a local Durable Object), D1. */
async function dev(root) {
  const port = String(flags.get('port') ?? 8787);
  const b = await build(root, { log });
  if (!b.catalogue.length) return { ok: false, command: 'dev', why: 'no games yet: npx homie-studio game new <id> --from gem-rush' };
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
  await new Promise((done) => child.on('close', done));
  return { ok: true, command: 'dev', stopped: true };
}

/** A big file into the studio's R2, and its line in music/ or videos/ manifest.json. */
function mediaPut(root, file, as) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) return { ok: false, command: 'media put', why: 'usage: homie-studio media put <file> [--as <key>]' };
  const studio = readStudio(root);
  const r2 = studio.cloudflare?.r2;
  if (!r2 || !(studio.cloudflare?.created ?? []).includes(`r2:${r2}`)) return { ok: false, command: 'media put', why: 'this studio has no R2 bucket yet (deploy first; R2 needs to be enabled on the Cloudflare account)' };
  const rel = relative(root, resolve(file));
  const folder = rel.startsWith('videos/') ? 'videos' : 'music';
  const key = as ?? `${folder}/${basename(file)}`;
  const bin = wranglerBin(root);
  return new Promise((done) => {
    const p = spawn(bin, ['r2', 'object', 'put', `${r2}/${key}`, '--file', resolve(file), '--remote'], { cwd: join(root, 'site'), env: { ...process.env, CI: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('close', (code) => {
      if (code !== 0) return done({ ok: false, command: 'media put', why: 'wrangler r2 object put failed' });
      const manifest = join(root, folder, 'manifest.json');
      const m = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : { items: [] };
      m.items = [...(m.items ?? []).filter((i) => i.key !== key), { key, file: rel, bytes: statSync(file).size, url: studio.cloudflare?.url ? `${studio.cloudflare.url}/media/${key}` : null, at: new Date().toISOString() }];
      writeFileSync(manifest, `${JSON.stringify(m, null, 2)}\n`);
      writeStudio(root, studio);
      done({ ok: true, command: 'media put', key, manifest: relative(root, manifest) });
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
