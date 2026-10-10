/**
 * `homie-studio trailer <id>`: a trailer of a game, in one command.
 *
 * The work is not here. It is the Homie plugin's video skill (`video.mjs trailer`): live footage for server rules,
 * or a virtual clock and rebuilt sound for older browser games, selected highlights, an end card,
 * and 16:9, 1:1 and 9:16 deliveries. This finds that script and hands the command over, so a person at a terminal
 * and an agent with the plugin run the same thing. The video goes to videos/<id>-trailer/ (or --slug <slug>).
 *
 * The skills are looked for where the MCP server looks: --skills <folder>, HOMIE_SKILLS, beside this package in the
 * repository (plugins/homie/skills), or beside it in the plugin (../skills). When none is there, it says so and
 * says what to install, instead of pretending there is a trailer tool in this package alone.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PACKAGE_ROOT } from './studio.mjs';

export function trailerScript(skills = null) {
  const dirs = [skills, process.env.HOMIE_SKILLS, join(PACKAGE_ROOT, '..', '..', 'plugins', 'homie', 'skills'), join(PACKAGE_ROOT, '..', 'skills')].filter(Boolean).map((d) => resolve(String(d)));
  return dirs.map((d) => join(d, 'video', 'scripts', 'video.mjs')).find((f) => existsSync(f)) ?? null;
}

/** `rest` is every word after the game's id, as typed: it goes to the script unchanged. */
export function trailerCommand(root, id, rest, { skills = null, slug = null } = {}) {
  if (!id || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(id))) return { ok: false, command: 'trailer', why: 'usage: homie-studio trailer <game id> [--url <site>] [--seconds 40] [--length 20] [--title "…"] [--end "…"] (the site: http://127.0.0.1:8787 while `homie-studio dev` runs)' };
  const script = trailerScript(skills);
  if (!script) return { ok: false, command: 'trailer', why: 'the trailer tool is the Homie plugin\'s video skill, and its scripts are not on this computer where this package looks. Install the plugin (the studio\'s AGENTS.md says how), or point at its skills folder: homie-studio trailer <id> --skills <the plugin\'s skills folder>' };
  const pass = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--skills' || rest[i] === '--slug') { i++; continue; }
    if (rest[i] === '--json' || rest[i].startsWith('--skills=') || rest[i].startsWith('--slug=')) continue;
    pass.push(rest[i]);
  }
  const r = spawnSync(process.execPath, [script, 'trailer', String(slug ?? `${id}-trailer`), '--game', String(id), ...pass, '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 90 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  try { return { ...JSON.parse(r.stdout), command: 'trailer' }; } catch { return { ok: false, command: 'trailer', why: `the video skill's script gave no result (${(r.stdout ?? '').trim().split('\n').pop() || `exit ${r.status}`})` }; }
}

export function trailerLines(r) {
  const live = r.capture?.mode === 'live';
  const audio = r.capture?.audio;
  const sound = audio?.rebuilt ? `${audio.placed} sounds rebuilt from the game's own files`
    : audio ? 'game audio captured live' : live ? 'no audio captured' : 'the game logged no sound';
  return [
    ...(r.problems ?? []).map((x) => `PROBLEM: ${x}`),
    `${r.seconds} s trailer of ${r.game}: ${Object.values(r.outputs ?? {}).map((o) => o.file).join(', ')}`,
    `  filmed ${r.capture?.seconds} s ${live ? 'live' : 'frame by frame'} (${r.capture?.frames} frames, ${r.capture?.heldFrames} held); ${sound}`,
    `  ${r.edit?.shots} shots of ${r.edit?.shotSeconds} s, picked ${r.edit?.picked}`,
    ...(r.warnings ?? []).map((w) => `  warning: ${w}`),
    ...(r.next ? [`  next (the video skill's script): ${r.next}`] : []),
  ];
}
