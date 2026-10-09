#!/usr/bin/env node
/**
 * The check a Claude Code cloud session runs, on this machine, from nothing: a studio from the public template (its
 * home page live with no game: "First game coming soon"; then the Gem Rush starter, copied in as a creator asks),
 * @homie-rocks/studio from this checkout (packed, as npm would install it), Wrangler from the registry, Chrome for
 * Testing when the machine has none, the site under `homie-studio dev`, and the real two-browser `check` against
 * it: a computer and a phone press Play, land in the same public room and finish a round.
 *
 *   node scripts/studio-check.mjs [--keep] [--port 8799] [--chrome-for-testing] [--record] [--perf] [--lab] [--game gem-rush|coin-dash] [--controls] [--drive]
 *     --chrome-for-testing: Chrome for Testing even when the machine has a Chrome, as a machine without one gets
 *     --game: Gem Rush by default; coin-dash exercises the other server-rules starter
 *     --controls: held keys, alternating keys, touch, browser disconnect and late joining
 *     --drive: also run the playtest instruments and shoot live and preview frames; keep the playtest report
 *               for visual/sound findings (these are separate from tool failures and round completion)
 *     --record: then the video skill's page recorder runs its tested examples against the same dev site
 *               (plugins/homie/skills/video/references/examples/studio-play.json and studio-play-phone.json): the
 *               landing, Play, a few moves on a computer and on a phone, recorded in real time; it fails when a
 *               step fails or the game's frame received none of the input, never on a slow frame rate
 *     --perf: then `homie-studio perf` measures one run per device (two replicas in a room hosted by the server):
 *               it fails when a run is missing a number (load, frames, the main thread, the heap, netplay
 *               messages) or a role (two replicas for server rules); on a software renderer every run must say it is blocked (nothing judged there)
 *     --lab: then the starter is committed and `homie-studio lab check` plays its Game Lab take (the bump) headless in
 *               New and Today: it fails unless both replay on the same frames, New names the bump's phases, and the
 *               report, contact sheet and still are written
 *
 * CI runs it on ubuntu-24.04 (no GPU), the closest free stand-in for a cloud session's VM: it prints how fast each
 * browser drew the game and on which renderer (SwiftShader there), and fails only when the round does not finish.
 * It writes nothing outside a temporary folder (and Chrome for Testing into .cache/homie-studio in the home folder when needed).
 */
import { perfProblems } from './studio-check-perf.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const game = process.argv.includes('--game') ? process.argv[process.argv.indexOf('--game') + 1] : 'gem-rush';
if (!['gem-rush', 'coin-dash'].includes(game)) throw new Error('--game: gem-rush or coin-dash');
const keep = process.argv.includes('--keep');
const port = String(process.argv[process.argv.indexOf('--port') + 1] > 0 ? process.argv[process.argv.indexOf('--port') + 1] : 8799);
const work = mkdtempSync(join(tmpdir(), 'homie-studio-check-'));
const studio = join(work, 'my-studio');
const say = (line) => process.stdout.write(`${line}\n`);
const sh = (cmd, args, cwd, extra = {}) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false', ...extra }, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${(r.stdout ?? '').slice(-2000)}${(r.stderr ?? '').slice(-2000)}`);
  return r.stdout;
};
const cli = join(studio, 'node_modules', '.bin', 'homie-studio');
let dev = null;
const started = Date.now();
try {
  const tgz = sh('npm', ['pack', '--silent', '--pack-destination', work], join(ROOT, 'packages', 'studio')).trim().split('\n').pop();
  say(`packed ${tgz}`);
  sh(process.execPath, [join(ROOT, 'packages', 'studio', 'bin', 'homie-studio.mjs'), 'new', studio, '--name', 'My Studio', '--template', '--no-install'], work);
  const pkg = JSON.parse(readFileSync(join(studio, 'package.json'), 'utf8'));
  pkg.devDependencies['@homie-rocks/studio'] = `file:${join(work, tgz)}`;
  writeFileSync(join(studio, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  sh('npm', ['install', '--no-audit', '--no-fund'], studio);
  say(`installed the studio (wrangler ${pkg.devDependencies.wrangler})`);
  const chrome = JSON.parse(sh(cli, ['chrome', 'install', '--json', ...(process.argv.includes('--chrome-for-testing') ? ['--fresh'] : [])], studio));
  say(`chrome: ${chrome.chrome}${chrome.already ? '' : ` (Chrome for Testing ${chrome.buildId}, installed)`}`);
  const env = { CHROME_PATH: chrome.chrome };
  const startDev = async () => {
    dev = spawn(cli, ['dev', '--port', port], { cwd: studio, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
    dev.stdout.on('data', () => {}); dev.stderr.on('data', () => {});
    const up = Date.now() + 120_000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/games`)).ok) break; } catch { /* not yet */ }
      if (Date.now() > up) throw new Error('the dev site did not answer within 120 s');
      await new Promise((r) => setTimeout(r, 1000));
    }
    say(`dev site up on :${port} after ${Math.round((Date.now() - started) / 1000)} s`);
  };
  const stopDev = async () => {
    sh(cli, ['dev', '--stop'], studio);
    await new Promise((r) => { if (dev.exitCode !== null) r(); else dev.on('close', r); });
    dev = null;
  };
  // A new studio goes live with its own home page and no game.
  const empty = JSON.parse(sh(cli, ['build', '--json'], studio, env));
  if (empty.games.length) throw new Error(`a new studio has no game, but the build made ${empty.games.map((g) => g.id).join(', ')}`);
  await startDev();
  const home = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  if (!/First game coming soon/.test(home)) throw new Error('the new studio\'s home page does not say "First game coming soon"');
  say('home page: "First game coming soon" (no game yet)');
  await stopDev();
  // The creator asks for a copy of the starter.
  sh(cli, ['game', 'new', game, '--from', game, '--json'], studio);
  const built = JSON.parse(sh(cli, ['build', '--json'], studio, env));
  say(`asked for the starter; built: ${built.games.map((g) => `${g.id} ${Math.round(g.bytes / 1024)} KB`).join(', ')}`);
  await startDev();
  const r = spawnSync(cli, ['check', game, '--url', `http://127.0.0.1:${port}`, '--json'], { cwd: studio, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  const result = JSON.parse(r.stdout || '{}');
  const lines = [
    `### A studio on ${process.platform} ${process.arch}, ${result.ok ? 'PASSED' : 'NOT YET'}`,
    '',
    result.ok ? `Two fresh browsers in room ${result.room} finished round ${result.round.n} (${result.round.humans} people, ${result.round.bots} bots) in ${Math.round(result.totalMs / 1000)} s.` : `Why: ${result.why ?? r.stderr?.slice(-500)}`,
    ...(result.seats ?? []).map((s) => `- ${s.browser}: seat ${s.seat} (${s.role}), seated in ${(s.seatedMs / 1000).toFixed(1)} s`),
    ...(result.frames ?? []).map((f) => `- ${f.browser} drew **${f.fps ?? '?'} fps** on ${f.renderer ?? 'an unknown renderer'}`),
    ...(result.software ? [`- ${result.software}`] : []),
  ];
  // The video skill's page recorder, on the same site: its tested examples (a studio's own game, Play, a few moves).
  let recorded = true;
  if (process.argv.includes('--record')) {
    const recorder = join(ROOT, 'plugins', 'homie', 'skills', 'video', 'scripts', 'record-page.mjs');
    for (const name of ['studio-play', 'studio-play-phone']) {
      const example = join(ROOT, 'plugins', 'homie', 'skills', 'video', 'references', 'examples', `${name}.json`);
      const steps = join(work, `${name}.json`);
      const take = JSON.parse(readFileSync(example, 'utf8'));
      take.path = `/${game}/`;
      writeFileSync(steps, JSON.stringify(take));
      const outDir = join(studio, 'videos', 'demo', 'work', name);
      const rec = spawnSync(process.execPath, [recorder, '--steps', steps, '--url', `http://127.0.0.1:${port}`, '--out', outDir], { cwd: studio, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 });
      let j = null; try { j = JSON.parse(rec.stdout.trim().split('\n').pop()); } catch { /* none */ }
      const got = j?.inputs?.game ?? {};
      const delivered = (got.keys ?? 0) + (got.pointers ?? 0) + (got.touches ?? 0);
      const ok = Boolean(j?.ok) && delivered > 0;
      recorded &&= ok;
      lines.push(`- recorded ${name}: ${ok ? `${j.seconds} s, ${j.steps} steps, the game's frame received ${got.keys ?? 0} key presses, ${got.pointers ?? 0} pointer presses and ${got.touches ?? 0} touches; the page drew ${j.pageFps?.page ?? '?'} fps, the game ${j.pageFps?.game ?? '?'} fps, ${j.heldFrames} frames held${j.warnings?.length ? ` (${j.warnings.join(' ')})` : ''}` : `FAILED: ${j?.failed ? `step ${j.failed.step} (${j.failed.do}): ${j.failed.why}` : j ? `the game's frame received no input` : ((rec.stderr ?? '').split('\n').filter((l) => /record-page:|Error|error:/.test(l)).slice(0, 3).join(' ') || (rec.stderr ?? '').trim().split('\n').slice(-3).join(' ')).slice(0, 600)}`}`);
    }
  }
  // homie-studio perf on the same site: every number of a run is there, and a software renderer judges nothing.
  let measured = true;
  if (process.argv.includes('--perf')) {
    const pr = spawnSync(cli, ['perf', game, '--url', `http://127.0.0.1:${port}`, '--runs', '1', '--seconds', '5', '--warm', '1', '--max-load', '50', '--json'], { cwd: studio, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 8 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    let pj = null; try { pj = JSON.parse(pr.stdout); } catch { /* none */ }
    const runs = (pj?.runs ?? []).map((f) => { try { return JSON.parse(readFileSync(join(studio, f), 'utf8')); } catch { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } } });
    const problems = perfProblems(runs, { hosted: 'server' });
    if (!pj) problems.push((pr.stderr ?? '').slice(-600));
    measured = problems.length === 0;
    const r0 = runs.find((x) => x?.device === 'computer');
    const replica = r0?.browsers?.find((b) => b.role === 'replica');
    lines.push(`- perf: ${measured ? `${runs.length} runs, two replicas each (server hosts); computer replica playable at ${replica?.load?.playableMs} ms, ${replica?.frames?.fps} fps, ${replica?.main?.busyPerFrame} ms of main thread a frame, ${replica?.net?.msgsOut} netplay messages out a second; ${runs.every((x) => x.blocked) ? `every run blocked (${r0?.renderer}): measured, never judged` : `renderer ${r0?.renderer}`}` : `FAILED: ${problems.slice(0, 6).join('; ')}`}`);
  }
  // The Game Lab: the starter's take, New (the working tree) against Today (its commit), replayed frame for frame.
  let labbed = true;
  if (process.argv.includes('--lab')) {
    const who = { GIT_AUTHOR_NAME: 'Studio check', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'Studio check', GIT_COMMITTER_EMAIL: '' };
    spawnSync('git', ['add', 'games'], { cwd: studio, env: { ...process.env, ...who } });
    spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', `${game} from the starter`], { cwd: studio, env: { ...process.env, ...who } });
    const lr = spawnSync(cli, ['lab', 'check', game, '--json'], { cwd: studio, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    let lj = null; try { lj = JSON.parse(lr.stdout); } catch { /* none */ }
    const problems = [];
    if (!lj?.ok) problems.push(lj?.why ?? (lr.stderr ?? '').trim().split('\n').slice(-3).join(' '));
    else {
      if (lj.deterministic.new !== null || lj.deterministic.today !== null) problems.push(`a replay differed: ${JSON.stringify(lj.deterministic)}`);
      if (!lj.today) problems.push(`no Today: ${lj.todayNote}`);
      if (lj.take !== (game === 'gem-rush' ? 'knock' : 'run')) problems.push('the starter take was not played');
      if (!(lj.rules?.new?.tick > 0) || !(lj.rules?.today?.tick > 0)) problems.push('the rules clock did not advance');
      for (const p of game === 'gem-rush' ? ['HIT-STOP', 'LAUNCH', 'SLIDE', 'SETTLE'] : []) if (!lj.phases.new.some((x) => x.startsWith(p))) problems.push(`New has no ${p} phase`);
      for (const f of [lj.report, lj.sheet, lj.still]) { try { readFileSync(join(studio, f)); } catch { problems.push(`no ${f}`); } }
      if (lj.errors?.length) problems.push(`errors: ${lj.errors.join('; ')}`);
    }
    labbed = problems.length === 0;
    lines.push(`- Game Lab: ${labbed ? `take "${lj.take}", ${lj.frames} frames in New and Today (${lj.today}), both replayed on the same frames; New: ${lj.phases.new.join(' · ')}; JavaScript ${lj.cost.new?.mean} ms a frame${lj.software ? ` (${lj.renderer})` : ''}` : `FAILED: ${problems.slice(0, 6).join('; ')}`}`);
  }
  let controlled = true;
  if (process.argv.includes('--controls')) {
    const cr = spawnSync(cli, ['port', 'check', game, '--url', `http://127.0.0.1:${port}`, '--only', 'owner-desk,owner-phone,life', '--json'], { cwd: studio, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    let cj = null; try { cj = JSON.parse(cr.stdout); } catch { /* missing report fails */ }
    controlled = Boolean(cj?.ok) && ['owner-desk', 'owner-phone', 'host-kill', 'late-join'].every((name) => cj.rows?.some((r) => r.name === name && r.ok === true));
    lines.push(`- controls: ${controlled ? 'keys, touch, browser disconnect and late joining passed' : JSON.stringify(cj ?? cr.stderr)}`);
  }
  let driven = true;
  if (process.argv.includes('--drive')) {
    const playtest = join(ROOT, 'plugins', 'homie', 'skills', 'playtest', 'scripts', 'playtest.mjs');
    const pt = spawnSync(process.execPath, [playtest, 'run', game, '--url', `http://127.0.0.1:${port}`, '--seconds', '8', '--out', join(studio, 'playtest', game)], { cwd: studio, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 12 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(join(work, 'playtest.log'), (pt.stdout ?? '') + (pt.stderr ?? ''));
    let report = null; try { report = JSON.parse(readFileSync(join(studio, 'playtest', game, 'report.json'), 'utf8')); } catch { /* missing report fails */ }
    driven &&= Boolean(report?.rows?.length) && report.rows.some((r) => r.name === 'round' && r.completed) && !report.rows.some((r) => r.instrument || /check itself|instrument fault/i.test(r.why ?? '') || (['controls', 'play', 'round', 'errors'].includes(r.name) && r.verdict === 'FAIL'));
    // A visual or sound judgement is not an instrument fault. Preserve every row in the log for inspection.
    lines.push(`- playtest: exit ${pt.status}; ${join(work, 'playtest.log')}`);
    for (const mode of ['live', 'preview']) {
      const shot = spawnSync(cli, ['shoot', game, ...(mode === 'live' ? ['--url', `http://127.0.0.1:${port}`] : ['--preview']), '--frames', '12', '--hold', 'ArrowRight', '--out', join(studio, 'shoot', mode), '--json'], { cwd: studio, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 4 * 60_000, maxBuffer: 16 * 1024 * 1024 });
      let sj = null; try { sj = JSON.parse(shot.stdout); } catch { /* missing result */ }
      const expected = Boolean(sj?.ok) && sj?.rules?.status === 'playing' && sj?.rules?.tick > 0;
      driven &&= expected && !(sj?.errors?.length);
      lines.push(`- shoot ${mode}: ${expected ? `${sj.frames} frames; ${sj.why ?? sj.limits}` : shot.stdout + shot.stderr}`);
    }
  }
  say(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  process.exitCode = result.ok && recorded && measured && labbed && controlled && driven ? 0 : 1;
} catch (error) {
  say(String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  if (dev) { try { spawnSync(cli, ['dev', '--stop'], { cwd: studio }); } catch { /* gone */ } try { dev.kill('SIGTERM'); } catch { /* gone */ } }
  if (!keep) rmSync(work, { recursive: true, force: true });
  else say(`kept ${work}`);
}
