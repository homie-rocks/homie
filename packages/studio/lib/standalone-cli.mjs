/**
 * `homie-studio standalone …`: a game as a desktop app (macOS, Windows, Linux) and a phone app (iOS, Android): the
 * files Steam and the stores accept for upload. lib/standalone.mjs does the work; standalone/STANDALONE.md is the
 * guide. In chat it is the game_standalone tool (lib/standalone-tools.mjs).
 *
 *   standalone plan <game> [--for mac,windows,linux,ios,android] [--release] [--site <address>]
 *       what would be built, with what, what each target still needs on this computer, and what a standalone copy
 *       does not have. Changes nothing, installs nothing.
 *   standalone build <game> [--for …] [--release] [--site <address>] [--build <n>]
 *       builds the game for the web, then every target this computer can make; one it cannot is skipped with why.
 *   standalone run <game> [--for ios|android]      the built copy, started here (none: this computer's desktop app)
 *   standalone steam <game>                        Steam's build files from game.json's numbers; uploads nothing
 *   standalone ci <game>                           .github/workflows/standalone.yml: every target on GitHub's machines
 *
 * `on` (tests): the computer the command is run "on" (its platform, environment and tools), handed to the library.
 */
import { STANDALONE_VERBS, standaloneBuild, standaloneCi, standalonePlan, standaloneRun, standaloneSteam } from './standalone.mjs';

export { STANDALONE_VERBS };

/** What follows the list of what a standalone copy lacks, wherever an AI reads it: never softened, never left out. */
export const SAY_MISSING = 'Say this to the person as it is, before they ship anything: it is what a player of the standalone game does not get.';

export async function standaloneCommand(root, sub, positional, flags, { log = () => {}, on = {} } = {}) {
  const id = positional[2] ?? null;
  const str = (k) => (typeof flags.get(k) === 'string' ? flags.get(k) : null);
  // `--for` with nothing after it is passed on as it is (true), so the command can refuse it: never "all five".
  const opts = { for: flags.has('for') ? flags.get('for') : null, release: flags.has('release'), site: str('site'), build: flags.has('build') ? flags.get('build') : null, log, ...on };
  /*
   * WHAT A PERSON IS TOLD rides in the result itself (`say`): the same lines the command prints, then the instruction
   * about the missing list. A chat tool that started this as a job and reads the result later (studio_job) says
   * these lines, not a page of JSON with the list buried in it.
   */
  const told = (r) => (r && (r.targets || r.rows) ? { ...r, say: [...standaloneLines(r), '', SAY_MISSING] } : r);
  switch (sub ?? 'plan') {
    case 'plan': return told(await standalonePlan(root, id, opts));
    case 'build': return told(await standaloneBuild(root, id, opts));
    case 'run': return standaloneRun(root, id, { for: flags.has('for') ? flags.get('for') : null });
    case 'steam': return standaloneSteam(root, id);
    case 'ci': return standaloneCi(root, id);
    default: return { ok: false, command: 'standalone', why: `"${sub}" is not a standalone command: ${STANDALONE_VERBS.join(', ')}` };
  }
}

/* ------------------------------------------------------------------ plain lines */

const MARK = { ready: '→', built: '✓', skipped: '○', failed: '✗' };
const fixLine = (t) => (t.fix ? `      ${t.fix.run ? `${t.fix.run}  ` : ''}${t.fix.open ? `${t.fix.open}  ` : ''}${t.fix.say ?? ''}` : null);

/** What a standalone copy does not have, under the heading every surface uses. */
export function missingLines(missing) {
  return ['What the standalone game does not have (v1):', ...missing.map((m) => `  - ${m.what}: ${m.why}.`)];
}

export function standaloneLines(r) {
  const L = [];
  // A refusal with something to do about it (a release with no id yet, Steam with no numbers) still says it all.
  if (r.ok === false && !r.targets && !r.rows) { L.push(r.why ?? 'failed'); if (r.instead) L.push('', r.instead); return L; }
  switch (r.command) {
    case 'standalone plan': {
      L.push(`${r.name} as a standalone game${r.release ? ' (a release)' : ' (a build to try)'}: ${r.appId}${r.appIdFrom === 'derived' ? ' (made up for now)' : ''}, version ${r.version} build ${r.build}, held ${r.orientation === 'any' ? 'any way' : r.orientation}.`,
        `  The same web build of the game, in Electron on computers and Capacitor on phones. Everything is made in ${r.dir}/ (never committed).`,
        `  Rooms: ${r.site ? `${r.site} (${r.siteFrom})` : 'none: this copy would play offline only'}${r.netplayVersion ? `, netplay version "${r.netplayVersion}"` : ''}.`,
        `  Icon: ${r.icon.note}.`, '');
      for (const t of r.targets) {
        L.push(`  ${MARK[t.state]} ${t.target.padEnd(8)} ${t.state === 'ready' ? `${t.with}: ${t.output}` : `SKIPPED here: ${t.why}`}`);
        if (t.state === 'skipped') { const f = fixLine(t); if (f) L.push(f); if (t.instead) L.push(`      ${t.instead}`); }
      }
      L.push('', 'On this computer:');
      for (const row of r.rows) L.push(`  ${row.state === 'ok' ? '✓' : '○'} ${row.label} (${row.need}): ${row.detail}`);
      if (r.warnings.length) L.push('', ...r.warnings.map((w) => `Warning: ${w}`));
      L.push('', r.toolkitNote ?? r.needs, '', ...missingLines(r.missing));
      if (r.ok === false) L.push('', r.why, '', r.instead);
      break;
    }
    case 'standalone build': {
      L.push(`${r.name} ${r.version} build ${r.build}${r.release ? ' (release)' : ''}, ${r.appId}${r.appIdFrom === 'derived' ? ' (made up for now)' : ''}: in ${r.dir}/`);
      for (const t of r.targets) {
        L.push(`  ${t.unsigned ? '!' : MARK[t.state]} ${t.target.padEnd(8)} ${t.state === 'built' ? `${t.unsigned ? 'BUILT, UNSIGNED (no store takes it): ' : ''}${t.path}` : t.state === 'skipped' ? `SKIPPED: ${t.why}` : `FAILED: ${t.why}`}`);
        for (const n of t.notes ?? []) L.push(`      ${n}`);
        if (t.state === 'skipped') { const f = fixLine(t); if (f) L.push(f); if (t.instead) L.push(`      ${t.instead}`); }
      }
      L.push(`  Rooms: ${r.site ?? 'none: these copies play offline only'}. Icon: ${r.icon.note}.`);
      if (r.warnings.length) L.push('', ...r.warnings.map((w) => `Warning: ${w}`));
      if (r.next.length) L.push('', 'Next, by you (nothing was uploaded):', ...r.next.map((n) => `  ${n}`));
      if (r.toolkitNote) L.push('', r.toolkitNote);
      L.push('', ...missingLines(r.missing));
      if (r.ok === false) L.push('', `NOT DONE: ${r.why}`);
      break;
    }
    case 'standalone run':
      L.push(`${r.game} (${r.target}) ended.`);
      break;
    case 'standalone steam':
      L.push(`Steam's build file for app ${r.app}: ${r.dir}/${r.wrote.join(', ')} (each depot is that system's release build, out/<system>/release/).`,
        ...(r.unbuilt.length ? [`  NO RELEASE BUILD YET for ${r.unbuilt.join(', ')} (its depot would upload nothing): homie-studio standalone build ${r.game} --for ${r.unbuilt.join(',')} --release`] : []),
        'In Steamworks:', ...r.setup, `  ${r.upload}`, r.note);
      break;
    case 'standalone ci':
      L.push(`${r.changed ? 'Wrote' : 'Unchanged:'} ${r.file}.`, ...r.next.map((n) => `  ${n}`));
      break;
    default:
      L.push(JSON.stringify(r));
  }
  return L;
}
