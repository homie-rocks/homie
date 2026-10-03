/**
 * `homie-studio handoff <hb_…|hs_…>` — what a session started from the chat does with the ONE line it
 * was given ("Continue building <Studio>: build hb_…", HANDOFF.md in every studio):
 *
 *   1. fetch the brief the person gave in the chat from the directory (GET /api/studio/progress/<hb>/brief: the
 *      build id is the read capability, and it is only ever shown in the person's own chat and that link);
 *   2. for a build that belongs to a studio still being set up, check in from this repository (`setup attach`);
 *   3. take the build once (`progress attach`), so the chat's card follows the work;
 *   4. print the brief and the steps for its kind, in this toolkit's own commands.
 *
 * No key travels in a prompt, and no wall of text either. When this session's network does not reach the directory,
 * it says so and names the other road: the Homie connector's build_progress, which answers with the same brief.
 */
import { request } from './net.mjs';
import { startProgress } from './progress.mjs';
import { spawnSync } from 'node:child_process';
import { studioRepo } from './repo.mjs';

/** The repository this checkout IS (its origin remote), even Homie's engine one: the session must be in the studio's. */
function originRepo(root) {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return null;
  // Not repoFromUrl: that one never names the engine repository, and this must, to refuse it.
  const m = /[/:]([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(r.stdout.trim().replace(/\.git$/, '').replace(/\/+$/, ''));
  return m ? `${m[1]}/${m[2]}` : null;
}
import { setupAttach } from './setup.mjs';
import { listGames, readStudio } from './studio.mjs';
import { STUDIO_VERSION } from './version.mjs';

const BUILD = /^hb_[a-f0-9]{32}$/;
const SETUP = /^hs_[a-f0-9]{32}$/;

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const line = (v, max) => String(v ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const lines = (v, max) => String(v ?? '').split(/\r?\n/).map((l) => line(l, max)).filter(Boolean).join('\n').slice(0, max);

/** The steps for a kind of build, in this toolkit's commands (the brief says what; these say how). */
export function stepsFor(h, { games = [] } = {}) {
  const id = ID.test(String(h.id ?? '')) ? h.id : null;
  const has = id && games.includes(id);
  const q = (s) => JSON.stringify(String(s));
  const work = {
    setup: [
      'This studio was just set up. Go through the new-studio checklist with the person, one step at a time and never ahead (the plugin\'s studio-setup skill): it has no game yet, and its home page says "First game coming soon".',
      'See a working game: `npx --no-install homie-studio demo` names a live one on Homie Arcade; copy a starter in only if they ask.',
      'One small change from one sentence of theirs (the studio\'s colours in site/theme.json, a tagline in studio.json, or a first post in posts/), then plan their game into its Game Codex (`npx --no-install homie-studio codex new <id> --name "<Name>"`) before any game is made.',
    ],
    make: [
      has ? `games/${id} is here already: change it as the brief says.` : id ? `npx --no-install homie-studio game new ${id} --from ${ID.test(String(h.from ?? '')) ? h.from : 'gem-rush'}${h.name ? ` --name ${q(line(h.name, 60))}` : ''}` : 'Pick an id and a name from the brief, then npx --no-install homie-studio game new <id> --from gem-rush --name "<Name>".',
      'Make it the game the brief describes (its Game Codex, games/<id>/CODEX.md, when there is one).',
    ],
    port: [
      `npx --no-install homie-studio port plan ${h.folder ? q(line(h.folder, 200)) : '<the game\'s folder>'}, then port import${id ? ` --id ${id}` : ''} (the plugin's port skill has the whole job).`,
    ],
    remix: [
      h.source && id ? `npx --no-install homie-studio game remix ${line(h.source, 300)} --id ${id}` : 'npx --no-install homie-studio game remix <source.json> --id <new id>',
      'Then make it the brief\'s own.',
    ],
    change: ['Make the change the brief asks for, in small steps.'],
  }[h.kind] ?? ['Do what the brief asks.'];
  return [
    ...work,
    'npm run build; npm run dev in the background; npx --no-install homie-studio check <id> --url http://127.0.0.1:8787 (on Linux without Chrome, first: npx --no-install homie-studio chrome install).',
    'npx --no-install homie-studio progress change "<what it does, one line>"; commit on a new branch, push, gh pr create; then npx --no-install homie-studio progress pr --url <the pull request>.',
    'Never merge the pull request: the person publishes it from the chat\'s card, in GitHub.',
  ];
}

export async function handoff(root, build, { homie, client, fetchFn = globalThis.fetch, attach = startProgress, checkIn = setupAttach, repoOf = originRepo } = {}) {
  const studio = readStudio(root);
  // "Continue building <Studio>: setup hs_…": a studio being set up, before any build: check in, then the checklist.
  if (SETUP.test(String(build ?? ''))) {
    const r = await checkIn(root, build, { homie, client });
    if (!r.ok) return { ok: false, command: 'handoff', setup: build, why: r.why, ...(r.needs ? { needs: r.needs } : {}) };
    const h = { kind: 'setup', what: 'game', title: 'first steps', studio: r.name ?? studio.name, brief: '', setup: build };
    return { ok: true, command: 'handoff', build: null, ...h, setup: { ok: true, message: r.message, renamed: r.renamed ?? [] }, attached: null, attachWhy: 'no build was opened in the chat yet (the setup card\'s Start building opens one)', steps: stepsFor(h) };
  }
  if (!BUILD.test(String(build ?? ''))) return { ok: false, command: 'handoff', why: 'the id from the one line the chat gave: hb_ (a build) or hs_ (a setup) and 32 hex digits' };
  const directory = String(homie || studio.homie?.directory || 'https://homie.rocks').replace(/\/+$/, '');
  // lib/net.mjs: through the environment's proxy, and an honest reason when it fails (the directory's own words, or
  // the connection's error; only a refusal by the proxy names the network setting).
  const got = await request(`${directory}/api/studio/progress/${build}/brief`, { headers: { accept: 'application/json', 'user-agent': `homie-studio/${STUDIO_VERSION}` } }, { fetchFn });
  const instead = `If the Homie connector's tools are in this session, call build_progress with { "build": "${build}" }: it answers with the brief. Otherwise ask the person what to build; the card in their chat shows it.`;
  if (!got.ok) return { ok: false, command: 'handoff', build, why: got.why, ...(got.needs ? { needs: got.needs } : {}), ...(got.status === 404 ? {} : { instead }) };
  const body = got.body ?? {};
  // The build is for one repository: a session in any other stops here (claude.ai may open the person's last one).
  const want = studioRepo(body.repo)?.toLowerCase() ?? null;
  const here = want ? (repoOf(root) ?? null)?.toLowerCase() ?? null : null;
  if (want && here && here !== want) return { ok: false, command: 'handoff', build, why: `this build is for ${body.repo}, but this session is in ${here}: open it in ${body.repo} (the card's Build it does), and change nothing here` };
  const h = {
    kind: ['make', 'port', 'remix', 'change', 'setup'].includes(body.kind) ? body.kind : 'change',
    what: ['game', 'song', 'video'].includes(body.what) ? body.what : 'game',
    title: line(body.title, 120), studio: line(body.studio, 60) || studio.name, brief: lines(body.brief, 1200),
    id: ID.test(String(body.id ?? '')) ? body.id : null, name: line(body.name, 60) || null, from: ID.test(String(body.from ?? '')) ? body.from : null,
    source: /^https:\/\/\S{8,300}$/.test(String(body.source ?? '')) ? body.source : null, folder: line(body.folder, 200) || null,
    setup: /^hs_[a-f0-9]{32}$/.test(String(body.setup ?? '')) ? body.setup : null,
  };
  let setup = null;
  if (h.setup) {
    const r = await checkIn(root, h.setup, { homie: directory, client });
    setup = { ok: r.ok, message: r.ok ? r.message : r.why, renamed: r.renamed ?? [] };
  }
  const taken = await attach(root, { attach: build, what: h.what, id: h.id, directory });
  let games = [];
  try { games = listGames(root).map((g) => g.id); } catch { games = []; }
  return {
    ok: true, command: 'handoff', build, ...h, setup,
    attached: taken.ok ? { feed: taken.build, shared: taken.shared?.build ?? build } : null,
    attachWhy: taken.ok ? null : taken.why,
    steps: stepsFor(h, { games }),
  };
}

/** The hand-off as the session reads it. */
export function formatHandoff(r) {
  return [
    `Continue building ${r.studio}: ${r.title || r.kind}`,
    '',
    r.brief ? `The person's brief, from the chat:\n${r.brief.split('\n').map((l) => `  ${l}`).join('\n')}` : 'No brief beyond the title: ask the person one question if anything is unclear.',
    '',
    r.setup ? `Setup: ${r.setup.message}${r.setup.renamed?.length ? ` (changed: ${r.setup.renamed.join(', ')}; commit them on the branch)` : ''}` : null,
    r.attached ? `This session took build ${r.build}: the chat's card follows the work.` : r.build ? `The chat's card will not follow this session: ${r.attachWhy}` : null,
    '',
    'Steps:',
    ...r.steps.map((s, i) => `  ${i + 1}. ${s}`),
  ].filter((l) => l !== null).join('\n');
}
