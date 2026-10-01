#!/usr/bin/env node
/**
 * homie-studio — make a studio (games, music, videos, posts), make its games,
 * put its site on the studio's own Cloudflare (free plan, no payment method), and
 * list its games in the homie.rocks directory.
 *
 *   homie-studio new <folder> --name "<Studio Name>" [--homie <directory url>] [--no-install] [--template]
 *                                         (--template: the public "Deploy to Cloudflare" template, with a Connect band;
 *                                          a new studio has no game: its home says "First game coming soon")
 *   homie-studio starters
 *   homie-studio demo                     a live multiplayer game to try now (Homie Arcade), nothing copied into the studio
 *   homie-studio mcp [--studios <folder>] [--skills <folder>]
 *                                         this toolkit as a local MCP server (stdio): the Claude desktop app's Homie
 *                                          extension, Claude Code or any MCP client builds in the same chat that shows
 *                                          the cards (lib/mcp.mjs); --studios: the folder the studios live in
 *   homie-studio game new <id> [--from gem-rush] [--name "<Game Name>"]
 *   homie-studio game remix <source.json url> --id <new id>
 *   homie-studio games
 *   homie-studio build [<id>]
 *   homie-studio dev [--port 8787]        (--stop: stop exactly this studio's dev server, nothing else)
 *   homie-studio check <id> [--url <site>] [--shots <dir>]
 *   homie-studio chrome [install] [--fresh]  (which Chrome the checks use; on Linux, `install` fetches Chrome for Testing;
 *                                          --fresh fetches it even when the machine has a Chrome)
 *   homie-studio look [<path>...] [--url <site>] [--shots <dir>] [--only computer,phone,sideways]
 *                                         (the site's pages on a computer and a phone, as pictures, with what is wrong)
 *   homie-studio port plan <game folder>
 *   homie-studio port import <game folder> --id <id> [--name "<Name>"] [--mode static|bundle|command]
 *   homie-studio port check <id> [--url <site>] [--only owner-desk,owner-phone,owner-iphone,round,life,tv] [--shots <dir>]
 *   homie-studio deploy [--plan]          (--plan: what it will create on Cloudflare and what it costs; changes nothing)
 *                                         In Cloudflare's Workers Builds (WORKERS_CI=1, or --ci) it only applies the D1
 *                                         migrations and deploys: the Worker and database are the Deploy button's.
 *   homie-studio publish
 *   homie-studio storage add              (large media only: an R2 bucket; needs R2 turned on for the account)
 *   homie-studio media put <file> [--as <key>]
 *   homie-studio media list
 *   homie-studio status
 *   homie-studio upgrade [--apply] [--diff]
 *                                         (what this version's template adds to an existing studio: AGENTS.md
 *                                          sections, READMEs, .gitignore lines, the pin; changes nothing until
 *                                          --apply, and never a file or section the studio changed)
 *   homie-studio stats [--range 1d|7d|30d|90d] [--game <id> | --song <slug> | --video <slug>] [--url <site>]
 *   homie-studio stats key [--hours 1]    (a read key for the Homie MCP tool studio_stats)
 *   homie-studio stats link               (a one-time link to the private stats page, for the owner's browser)
 *   homie-studio stats revoke             (every stats key and page session ends)
 *   homie-studio stats share on|off       (tell the homie.rocks directory "played this week", or stop)
 *   homie-studio players                  (player accounts and guests with saves: counts, never a passkey or an email)
 *   homie-studio players owner [--revoke] (a one-time link that marks the owner's own player account as the owner's)
 *
 *   homie-studio office [--url <site>]    the back office: every live room of every game and who is in it, now
 *   homie-studio office link [--to <path>]   a one-time link that signs the owner's browser in (the office; or
 *                                          --to /<game>/play: a private game on the owner's own phone)
 *   homie-studio office key [--hours 1]   a key for the Homie MCP's owner tools (studio_office, room_kick, ...)
 *   homie-studio office announce "<text>" [--game <id>] [--room <code>] [--seconds 30]
 *   homie-studio office invite <game> [--label "<who>"] [--uses 1|<n>|any] [--count 1] [--days <n>]
 *   homie-studio office launch <game> private|invite|public [--remixable on|off] [--max <n>|game]
 *   homie-studio office kick <game> <room> <seat number | name> [--minutes 10]
 *   homie-studio office close <game> <room> [--minutes 10] [--reopen]
 *                                         (kick, close and launch are ASKED for: the owner confirms each with one
 *                                          tap in their own browser, from the link this prints)
 *   homie-studio office revoke            (every office key, play ticket and pending ask ends)
 *
 *   homie-studio progress start [<id>] [--what game|song|video] [--title "<what this build does>"]
 *                                        [--budget <dollars>] [--unit usd|credits] [--share]
 *                                         (a progress feed for one build; --share shows it in the Claude app
 *                                          through the Homie MCP's build_progress widget, which can press Stop)
 *   homie-studio progress stage <stage> running|done|failed|skipped [--note "<one line>"]
 *   homie-studio progress check <id> pending|running|pass|fail|skip [--label "<words>"] [--note "<one line>"]
 *   homie-studio progress preview [--url <address>] [--image <small .jpg/.png>] [--caption "<words>"]
 *   homie-studio progress spend <amount> --what "<what it bought>" [--receipt <file>]
 *   homie-studio progress shot <id> pending|running|pass|fail [--label "<words>"] [--image <small .jpg>]
 *   homie-studio progress song [--peaks <peaks.json>] [--lyric "<line>" --sung yes|no]
 *   homie-studio progress log "<one line>"
 *   homie-studio progress stop            (ask the running build to stop at its next safe point)
 *   homie-studio progress end passed|failed|stopped [--note "<one line>"]
 *   homie-studio progress attach <hb_…>   (the build the Claude app opened with build_open: this session takes it, once)
 *   homie-studio progress change "<what the change does>"   (its mark in changes/, committed with the change)
 *   homie-studio progress pr --url <pull request> [--state open|merged|closed] [--files n --additions n --deletions n]
 *                                         [--preview <Preview URL>]   (the card's Publish opens it for the person's merge)
 *   homie-studio progress show [<build>]
 *                                         While a feed is open, build, check, port check and deploy report
 *                                         into it (stage, each check going green, a preview picture) and stop
 *                                         when asked. Without one, nothing changes.
 *
 *   homie-studio handoff <hb_…>           (a Claude Code session started from the Claude app with one line, "Continue building
 *                                          <Studio>: build hb_…": fetch the person's brief, check in for a new studio, take
 *                                          the build so the chat's card follows it, and print the steps; HANDOFF.md)
 *   homie-studio setup attach <hs_…>      (this repository is the studio the Claude app's setup card is making: say so, once,
 *                                          learn its live address, and give a template copy its real name)
 *   homie-studio setup status [--connector yes|no]   (also: homie-studio doctor)
 *                                         what this computer and the person's accounts have for a studio: Node, the Homie
 *                                         connector, Cloudflare (signed in, email verified), Chrome, ffmpeg, GitHub,
 *                                         ElevenLabs, fal; green, missing or "do this now", what each unlocks and its
 *                                         exact fix. Read-only and safe any time, inside a studio or before one exists.
 *
 *   homie-studio codex new <id> [--name "<Name>"]
 *                                         games/<id>/CODEX.md: the Game Codex, every section, in the game's colours (a game
 *                                          is planned before it is made: with no game <id> yet, it starts its folder)
 *   homie-studio codex <id> [--artifact] [--open]
 *                                         the codex as a page in the game's own look (.studio/codex/<id>.html; it redraws
 *                                         itself as the build's progress changes); --artifact: a copy to publish as a
 *                                         Claude artifact; --open: open it in this computer's browser
 *   homie-studio codex link <id>          a one-time link to the codex on the live site (a private page for the owner)
 *
 *   homie-studio statusline               the current build in one line (what Claude Code's status line shows)
 *   homie-studio statusline --install [--project <folder>]
 *                                         turn it on in Claude Code for this studio (.claude/settings.local.json);
 *                                         --project: the folder Claude Code was started in, when that is above the
 *                                         studio; --remove turns it off; --replace when another status line is set
 *
 * Every command prints a few lines for a person; --json prints the result.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { build } from '../lib/build.mjs';
import { check } from '../lib/check.mjs';
import { ciDeploy, deploy, deployPlan, storageAdd, whoami, wranglerBin } from '../lib/cloudflare.mjs';
import { setupAttach } from '../lib/setup.mjs';
import { chromeArgs, findChrome, installChrome, noChrome } from '../lib/chrome.mjs';
import { publish } from '../lib/directory.mjs';
import { look } from '../lib/look.mjs';
import { importPort, planPort } from '../lib/port.mjs';
import { portCheck } from '../lib/port-check.mjs';
import { recordUpload, resolveMedia, typeOf } from '../lib/media.mjs';
import { ensureMigrations, migrationWord, newStudio } from '../lib/scaffold.mjs';
import { lineDiff, upgradeApply, upgradePlan } from '../lib/upgrade.mjs';
import { listGames, newGame, readStudio, remixGame, requireStudio, siteUrl, starters, workerDir } from '../lib/studio.mjs';
import { STUDIO_VERSION } from '../lib/version.mjs';
import { statsKey, statsLink, statsRevoke, statsShare, statsShow } from '../lib/stats.mjs';
import { playersOwner, playersShow } from '../lib/players.mjs';
import { officeAnnounce, officeClose, officeInvite, officeKey, officeKick, officeLaunch, officeLines, officeLink, officeRevoke, officeShow } from '../lib/office.mjs';
import { Feed, currentFeed, currentId, flushProgress, publicFeed, readFeed, recordChange, startProgress } from '../lib/progress.mjs';
import { formatStatus, setupStatus } from '../lib/doctor.mjs';
import { codexTarget, newCodex, writeCodexPage } from '../lib/codex.mjs';
import { installStatusLine, statusLine } from '../lib/statusline.mjs';
import { restartWithProxy } from '../lib/net.mjs';
import { demoGames, formatDemo } from '../lib/demo.mjs';
import { serveMcp } from '../lib/mcp.mjs';
import { formatHandoff, handoff } from '../lib/handoff.mjs';

const argv = process.argv.slice(2);
const flags = new Map();
const BOOL_FLAGS = ['revoke', 'json', 'yes', 'detach', 'no-install', 'plan', 'stop', 'share', 'apply', 'diff', 'template', 'ci', 'fresh', 'install', 'remove', 'replace', 'artifact', 'open', 'reopen'];
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
  if (result.ok === false && result.command !== 'port check' && !(result.command === 'look' && result.rows)) { process.stdout.write(`homie-studio: ${result.why ?? 'failed'}${result.instead ? `\n${result.instead}` : ''}\n`); return; }
  if (result.ok === false && result.command === 'port check' && !result.rows) { process.stdout.write(`homie-studio: ${result.why ?? 'failed'}\n`); return; }
  const lines = [];
  switch (result.command) {
    case 'new':
      lines.push(`${result.name} is a studio now: ${result.dir}`, '', 'Wrote:', ...result.wrote.map((f) => `  ${f}`), '', `Dependencies: ${result.installed}`, '', 'Next:', ...result.next.map((n) => `  ${n}`), '', result.online);
      break;
    case 'game remix':
      lines.push(`games/${result.id} is a remix of ${result.from} (${result.files.length} files). Its game.json credits the original: "${result.credit}"${result.page ? ` (${result.page})` : ''}, on its landing and in its credits. Make it yours in games/${result.id}/src/, then: npx homie-studio dev`);
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
      for (const l of result.landings ?? []) lines.push(`Landing /${l.id}/: hero from ${l.hero === 'footage' ? 'its footage' : l.hero === 'art' ? 'its art (moving)' : 'the studio\'s colours (add a cover or hero/ footage)'}${l.credits ? ', credits' : ''}${l.source ? ', "Make a game like this" with its source' : ''}`);
      if (result.posts?.length) lines.push(`Posts: ${result.posts.map((x) => `/posts/${x}/`).join(', ')} (feeds: /posts/feed.xml, /posts/feed.json)`);
      if (result.pages?.length || result.partials?.length) lines.push(`The studio's own: ${[...(result.pages ?? []).map((x) => `page ${x}`), ...(result.partials ?? []).map((x) => `partial ${x}`)].join(', ')}`);
      for (const m of result.mediaSkipped ?? []) lines.push(`  left out: ${m.kind}/${m.item}${m.file ? ` ${m.file}` : ''}: ${m.why}`);
      for (const m of result.postsSkipped ?? []) lines.push(`  left out: posts/${m.post}: ${m.why}`);
      for (const m of result.siteSkipped ?? []) lines.push(`  left out: ${m.what}: ${m.why}`);
      if (result.codexes?.length) lines.push(`Game Codex (the owner's private pages; codex link <id> opens one): ${result.codexes.map((x) => `/_studio/codex/${x}/`).join(', ')}`);
      break;
    case 'media list':
      for (const kind of ['music', 'videos']) {
        lines.push(`${kind}/manifest.json: ${result[kind].pages.length} page(s)`);
        for (const e of result[kind].pages) lines.push(`  /${kind}/${e.slug}/  ${e.title}  (${e.files.map((f) => `${f.role} from ${f.from}`).join(', ')})`);
        for (const m of result[kind].skipped) lines.push(`  left out: ${m.item}${m.file ? ` ${m.file}` : ''}: ${m.why}`);
      }
      break;
    case 'deploy':
      if (result.ci) {
        lines.push(`Live: ${result.url ?? '(Wrangler printed no address)'}${result.commit ? ` (commit ${result.commit.slice(0, 7)}${result.branch ? ` on ${result.branch}` : ''})` : ''}`, ...result.steps.map((x) => `  ${x.what}`), ...result.games.map((g) => `  ${g.id}: ${g.play}`));
        break;
      }
      lines.push(`Live: ${result.url}`, ...(result.workersDev && result.workersDev !== result.url ? [`  also at ${result.workersDev}`] : []),
        ...(result.local ? [`  (the workers.dev address names your Cloudflare account, so it is kept in ${result.local} on this computer, never in studio.json)`] : []),
        ...result.games.map((g) => `  ${g.id}: ${g.play}`), ...(result.songs ?? []).map((m) => `  song ${m.slug}: ${m.page}`), ...(result.videos ?? []).map((m) => `  video ${m.slug}: ${m.page}`), '', `Cloudflare: Worker ${result.worker}, D1 ${result.d1}, Durable Objects Table + Lobby${result.r2 ? `, R2 ${result.r2}` : ' (no storage: none needed; `homie-studio storage add` adds it for large media)'}. All on the free Workers plan${result.r2 ? ' plus R2' : ''}.`,
        result.claim ? 'The site claimed itself in the directory: list the games with the Homie MCP tool studio_publish, or: npx --no-install homie-studio publish' : 'No directory claim yet (the site claims itself when the directory first reads it; publish does).');
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
    case 'stats': {
      const t = result.totals;
      const n = (x) => Number(x || 0).toLocaleString('en-US');
      lines.push(`${result.studio ?? 'Studio'}: ${result.range.from} to ${result.range.to} (UTC)${result.only ? `, ${result.only.kind} ${result.only.id}` : ''}`,
        `  ${n(t.visits)} visits · ${n(t.plays)} Play presses · ${n(t.rooms)} rooms opened · ${n(t.rounds)} rounds finished (${n(t.roundsWithPeople)} with people, ${n(t.peopleInRounds)} people in them)`,
        `  most playing at once: ${n(t.peakPlayers)} (${n(t.peakInOneRoom)} in one room) · playing now: ${n(t.playingNow)} · songs played: ${n(t.songPlays)} · videos watched: ${n(t.videoViews)}`,
        `  came from homie.rocks: ${n(result.crossings.fromHub)} · other studios: ${n(result.crossings.fromStudios)} · search: ${n(result.crossings.fromSearch)} · the web: ${n(result.crossings.fromWeb)} · ?via= links: ${n(result.crossings.fromLinks)}`);
      for (const g of result.games) lines.push(`  game ${g.id}: ${n(g.visits)} visits, ${n(g.plays)} plays, ${n(g.rooms)} rooms, ${n(g.rounds)} rounds, peak ${n(g.peakPlayers)}, now ${n(g.playingNow)}`);
      for (const e of result.songs) lines.push(`  song ${e.slug}: ${n(e.visits)} page visits, played ${n(e.plays)}`);
      for (const e of result.videos) lines.push(`  video ${e.slug}: ${n(e.visits)} page visits, watched ${n(e.views)}`);
      for (const r of result.referrers.slice(0, 10)) lines.push(`  from ${r.from} (${r.kind}): ${n(r.visits)} visits, ${n(r.plays)} plays`);
      if (result.players) lines.push(`  players: ${n(result.players.accounts)} accounts (${n(result.players.newAccounts7d)} new this week), ${n(result.players.guests)} guests with saves, ${n(result.players.active7d)} played this week`);
      break;
    }
    case 'players': {
      const p = result.players;
      lines.push(`${p.accounts} player accounts (${p.newAccounts7d} new this week), ${p.guests} guests with saves, ${p.active7d} played this week.`, result.note);
      break;
    }
    case 'players owner':
      lines.push(result.revoked ? result.message : `One-time link (until ${result.expiresAt}): ${result.link}`, ...(result.revoked ? [] : [result.use]));
      break;
    case 'stats key':
      lines.push(`Read key (until ${result.expiresAt}): ${result.key}`, result.use);
      break;
    case 'stats link':
      lines.push(`One-time link (until ${result.expiresAt}): ${result.link}`, result.use);
      break;
    case 'stats revoke':
    case 'stats share':
      lines.push(result.message);
      break;
    case 'office':
      lines.push(...officeLines(result));
      break;
    case 'office link':
      lines.push(`One-time link (until ${result.expiresAt}): ${result.link}`, result.use);
      break;
    case 'office key':
      lines.push(`Office key (until ${result.expiresAt}): ${result.key}`, result.use);
      break;
    case 'office announce':
    case 'office revoke':
      lines.push(result.message);
      break;
    case 'office invite':
      for (const i of result.invites) lines.push(`Invite ${i.code}${i.label ? ` (${i.label})` : ''}, ${i.maxUses ? `${i.maxUses} use${i.maxUses === 1 ? '' : 's'}` : 'any number of uses'}: ${i.link}`);
      if (result.note) lines.push(result.note);
      break;
    case 'office launch':
    case 'office kick':
    case 'office close':
      lines.push(result.asked ? `Asked: ${result.what}` : result.message, ...(result.asked ? [`Owner's one-tap link (until the ask ends, 15 min): ${result.link}`, result.use] : []));
      break;
    case 'setup status':
      lines.push(formatStatus(result));
      break;
    case 'demo':
      lines.push(formatDemo(result));
      break;
    case 'handoff':
      lines.push(formatHandoff(result));
      break;
    case 'codex':
      lines.push(`The Game Codex for ${result.title}: ${result.file}${result.opened ? ' (opened in the browser)' : ''}`,
        `  tabs: ${result.sections.map((x) => x.title).join(' · ')} · Build status${result.build ? ` (${result.build.state}, ${result.build.percent}%)` : ''}`,
        ...(result.missing.length ? [`  not decided yet: ${result.missing.join(', ')}`] : ['  every section has something in it']),
        `  open questions: ${result.openQuestions}`,
        ...result.warnings.map((w) => `  warning: ${w}`),
        result.mode === 'artifact' ? '  publish this file as an artifact where your app can (Claude: the Artifact tool); it is one self-contained page' : '  on the site, for the owner only, after the next deploy: npx --no-install homie-studio codex link ' + result.id);
      break;
    case 'codex new':
      lines.push(`Wrote ${result.file}.`, ...result.next.map((n) => `  next: ${n}`));
      break;
    case 'codex link':
      lines.push(`One-time link (until ${result.expiresAt}): ${result.link}`, result.use);
      break;
    case 'statusline install':
    case 'statusline remove':
      lines.push(result.message);
      break;
    case 'setup attach':
      lines.push(result.message, ...(result.site ? [`  live site: ${result.site}`] : []), ...(result.renamed?.length ? ['  changed (commit these on a branch):', ...result.renamed.map((f) => `    ${f}`)] : []), ...(result.next ?? []).map((n) => `  next: ${n}`));
      break;
    case 'progress attach':
    case 'progress start':
      lines.push(`Build ${result.build}: ${result.title} (${result.stages.join(' → ')})${result.budget !== null ? `, budget ${result.unit === 'usd' ? `$${result.budget.toFixed(2)}` : `${result.budget} credits`}` : ''}`,
        `  feed: ${result.file}`,
        ...(result.shared ? [`  shared for the Claude app until ${result.shared.expiresAt ?? 'tomorrow'}: ${result.widget}`] : []),
        ...(result.sharedWhy ? [`  ${result.sharedWhy}`] : []),
        '  build, check, port check and deploy now report into it; mark the plan done with: npx --no-install homie-studio progress stage plan done --note "<the plan in one line>"');
      break;
    case 'progress':
      lines.push(result.message ?? `${result.feed?.title}: ${result.feed?.state}${result.feed?.stage ? ` (${result.feed.stage})` : ''}`);
      break;
    case 'progress show': {
      const f = result.feed;
      const mark = { done: 'ok  ', pass: 'ok  ', running: '... ', failed: 'FAIL', fail: 'FAIL', skipped: 'skip', skip: 'skip', stopped: 'stop', pending: '    ' };
      lines.push(`${f.title} [${f.state}] build ${f.build}${f.shared ? ` (shared as ${f.shared.build})` : ''}`,
        ...f.stages.map((s) => `  ${mark[s.state] ?? s.state} ${s.label}${s.note ? `: ${s.note}` : ''}`),
        ...f.checks.map((c) => `      ${mark[c.state] ?? c.state} ${c.label}${c.note ? `: ${c.note}` : ''}`),
        ...(f.preview?.url ? [`  preview: ${f.preview.url}`] : []),
        `  spent ${f.spend.unit === 'usd' ? `$${f.spend.used.toFixed(2)}` : `${f.spend.used} credits`}${f.spend.budget !== null ? ` of ${f.spend.unit === 'usd' ? `$${f.spend.budget.toFixed(2)}` : `${f.spend.budget} credits`}` : ''}`,
        ...(f.stop?.requested ? [`  stop asked (${f.stop.by}) at ${f.stop.at}`] : []));
      break;
    }
    case 'look':
      lines.push(`${result.ok ? 'Looks right' : 'Look again'}: ${result.rows.length} views of ${result.url}`, ...result.rows.map((r) => `  ${r.ok ? 'ok  ' : 'FIX '} ${r.path} on ${({ computer: 'a computer', phone: 'a phone', sideways: 'a phone turned sideways' })[r.device] ?? r.device}${r.problems.length ? `: ${r.problems.join('; ')}` : ''}`), '', `Pictures (open them and look): ${result.shots}`);
      break;
    case 'upgrade': {
      const show = (text, n = 14) => { const l = String(text ?? '').replace(/\n+$/, '').split('\n'); return [...l.slice(0, n).map((x) => `      ${x}`), ...(l.length > n ? [`      … (${l.length - n} more lines; --json has all of it)`] : [])]; };
      const mark = { 'add-file': '+', 'add-section': '+', 'add-lines': '+', scripts: '+', 'update-file': '~', 'update-section': '~', pin: '~', version: '~' };
      const list = result.applied ? result.done : result.changes;
      lines.push(result.applied
        ? `${result.studio} is on the @homie-rocks/studio ${result.to} template now (${list.length} change${list.length === 1 ? '' : 's'}).`
        : list.length ? `${result.studio}: what the @homie-rocks/studio ${result.to} template adds (from ${result.from ?? 'an older version'}). Nothing is changed until --apply.` : `${result.studio} has everything the @homie-rocks/studio ${result.to} template writes.`);
      if (list.length) lines.push('');
      for (const c of list) {
        lines.push(`  ${mark[c.kind] ?? '·'} ${c.file.padEnd(18)} ${c.what}${c.kind === 'add-section' && (c.after || c.before) ? ` (${c.after ? `after "${c.after}"` : `before "${c.before}"`})` : ''}`);
        if (result.applied) continue;
        if (c.kind === 'add-section' || (c.kind === 'add-file' && c.file.endsWith('.md'))) lines.push(...show(c.text));
        if (c.kind === 'update-section' || c.kind === 'update-file') lines.push(...lineDiff(c.from, c.text).map((x) => `      ${x}`));
      }
      for (const c of result.skipped ?? []) lines.push(`  ! ${c.file.padEnd(18)} not applied: ${c.why}`);
      if (result.kept?.length) {
        lines.push('', 'Kept as this studio wrote them (never changed by upgrade; the template\'s text differs):');
        for (const k of result.kept) {
          lines.push(`  = ${k.file.padEnd(18)} ${k.what}`);
          if (flags.has('diff') && k.mine !== undefined) lines.push(...lineDiff(k.mine, k.template).map((x) => `      ${x}`));
        }
        if (!flags.has('diff')) lines.push('  (--diff shows how each differs from the template: "-" this studio\'s lines, "+" the template\'s)');
      }
      if (result.uncommitted && !result.applied && result.changes.length) lines.push('', `Note: ${result.uncommitted} file(s) have uncommitted changes; commit them first so the upgrade is a change of its own.`);
      if (result.next?.length) lines.push('', 'Next:', ...result.next.map((n) => `  ${n}`));
      break;
    }
    case 'chrome':
    case 'chrome install':
      lines.push(result.already || result.command === 'chrome' ? `Chrome: ${result.chrome}` : `Installed Chrome for Testing ${result.buildId}: ${result.chrome}`);
      break;
    case 'check':
      lines.push(`PASS: two fresh browsers in room ${result.room} finished round ${result.round.n} (${result.round.humans} humans, ${result.round.bots} bots) in ${Math.round(result.totalMs / 1000)} s.`,
        ...result.seats.map((s) => `  ${s.browser}: seat ${s.seat} (${s.role}), seated in ${(s.seatedMs / 1000).toFixed(1)} s`),
        ...(result.frames ?? []).map((f) => `  ${f.browser} drew ${f.fps ?? '?'} fps${f.renderer ? ` on ${f.renderer}` : ''}`),
        ...(result.software ? [`  ${result.software}`] : []));
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
  if (cmd === 'new') return newStudio(positional[1], { name: flags.get('name'), homie: flags.get('homie'), slug: flags.get('slug'), install: !flags.has('no-install'), template: flags.has('template') });
  if (cmd === 'starters') return { ok: true, command: 'starters', starters: starters() };
  if (cmd === 'demo') return demoGames();
  if (cmd === 'mcp') {
    // stdout carries MCP messages only from here on (lib/mcp.mjs); every word for a person goes to stderr.
    await serveMcp({ studios: flags.get('studios') ?? process.env.HOMIE_STUDIOS ?? null, skills: flags.get('skills') ?? process.env.HOMIE_SKILLS ?? null, install: !flags.has('no-install'), directory: flags.get('homie') ?? null });
    return { ok: true, command: 'help' };
  }

  if (cmd === 'port' && sub === 'plan') return planPort(positional[2] ?? '.');
  if (cmd === 'chrome' && sub === 'install') return installChrome({ log, fresh: flags.has('fresh') });
  if (cmd === 'chrome') { const chrome = findChrome(); return chrome ? { ok: true, command: 'chrome', chrome, args: chromeArgs() } : { ok: false, command: 'chrome', why: noChrome() }; }
  if ((cmd === 'setup' && sub === 'status') || cmd === 'doctor') return setupStatus({ connector: flags.get('connector') ?? null, homie: flags.get('homie') ?? null });
  if (cmd === 'statusline' && !flags.has('install') && !flags.has('remove')) {
    const line = statusLine({ columns: Number(process.env.COLUMNS) || 100, color: !process.env.NO_COLOR && !asJson && process.stdout.isTTY });
    if (asJson) return { ok: true, command: 'statusline', line };
    if (line) process.stdout.write(`${line}\n`);
    return { ok: true, command: 'help' };
  }
  const root = requireStudio();
  if (cmd === 'statusline') return installStatusLine(root, { remove: flags.has('remove'), replace: flags.has('replace'), project: flags.get('project') ?? null });
  if (cmd === 'codex') return codexCommand(root, sub);
  if (cmd === 'progress') return progressCommand(root, sub);
  if (cmd === 'setup' && sub === 'attach') return setupAttach(root, positional[2], { homie: flags.get('homie') });
  if (cmd === 'handoff') return handoff(root, sub, { homie: flags.get('homie') });
  if (cmd === 'port' && sub === 'import') return importPort(root, positional[2], flags.get('id'), { name: flags.get('name'), mode: flags.get('mode') });
  if (cmd === 'port' && sub === 'check') {
    const game = positional[2] ?? listGames(root)[0]?.id;
    const url = flags.get('url') ?? siteUrl(root);
    if (!url) return { ok: false, command: 'port check', why: 'give --url (the local dev address or the live site)' };
    return tracked(root, 'checks', (report) => portCheck({ url, game, root, only: flags.get('only') ?? null, shots: flags.get('shots') ? resolve(flags.get('shots')) : null, log, report }), 'port check');
  }
  if (cmd === 'game' && sub === 'new') return newGame(root, positional[2], { from: flags.get('from') ?? 'gem-rush', name: flags.get('name') });
  if (cmd === 'game' && sub === 'remix') return remixGame(root, positional[2], flags.get('id'), { name: flags.get('name') });
  if (cmd === 'games') return { ok: true, command: 'games', games: listGames(root).map(({ dir, ...g }) => ({ ...g, dir: relative(root, dir) })) };
  if (cmd === 'build') return tracked(root, 'build', () => build(root, { only: positional[1] ?? null, log }), 'build');
  if (cmd === 'status') {
    const studio = readStudio(root);
    return { ok: true, command: 'status', root, studio, site: siteUrl(root, studio), games: listGames(root).map((g) => g.id), cloudflareSignedIn: Boolean(wranglerBin(root) && whoami(root)) };
  }
  if (cmd === 'upgrade') {
    const plan = upgradePlan(root);
    return flags.has('apply') || flags.has('yes') ? upgradeApply(root, plan) : plan;
  }
  if (cmd === 'dev' && flags.has('stop')) return stopDev(root);
  if (cmd === 'dev') return dev(root);
  if (cmd === 'check') {
    const game = positional[1] ?? listGames(root)[0]?.id;
    const url = flags.get('url') ?? siteUrl(root);
    if (!url) return { ok: false, command: 'check', why: 'give --url (the local dev address or the live site)' };
    return tracked(root, 'checks', (report) => check({ url, game, shots: flags.get('shots') ? resolve(flags.get('shots')) : null, log, report }), 'check');
  }
  if (cmd === 'look') {
    const url = flags.get('url') ?? siteUrl(root);
    if (!url) return { ok: false, command: 'look', why: 'give --url (the local dev address or the live site)' };
    let paths = positional.slice(1).map((p) => (p.startsWith('/') ? p : `/${p}`));
    if (!paths.length) {
      let cat = null;
      try { cat = JSON.parse(readFileSync(join(root, 'site', 'dist', 'games.json'), 'utf8')); } catch { /* not built */ }
      const games = cat?.games?.map((g) => g.id) ?? listGames(root).map((g) => g.id);
      paths = ['/', ...games.map((id) => `/${id}/`), ...(games.length ? ['/games/', '/rooms/'] : []), ...(cat?.posts?.length ? ['/posts/', `/posts/${cat.posts[0].slug}/`] : [])];
    }
    const only = flags.get('only') ? String(flags.get('only')).split(',').filter((d) => ['computer', 'phone', 'sideways'].includes(d)) : undefined;
    return look({ url, paths, shots: flags.get('shots') ? resolve(flags.get('shots')) : join(root, '.studio', 'look'), devices: only, log });
  }
  if (cmd === 'deploy' && flags.has('plan')) return deployPlan(root);
  // Cloudflare's Workers Builds runs `npm run deploy` with WORKERS_CI=1 (and its own token for this one account).
  if (cmd === 'deploy' && (process.env.WORKERS_CI === '1' || flags.has('ci'))) return tracked(root, 'deploy', () => ciDeploy(root, { log }), 'deploy');
  if (cmd === 'deploy') return tracked(root, 'deploy', () => deploy(root, { log, homie: flags.get('homie') }), 'deploy');
  if (cmd === 'storage' && sub === 'add') return storageAdd(root, { log });
  if (cmd === 'storage') {
    const cf = readStudio(root).cloudflare ?? {};
    const has = Boolean(cf.r2 && (cf.created ?? []).includes(`r2:${cf.r2}`));
    return { ok: true, command: 'storage', storage: has ? { kind: 'r2', bucket: cf.r2 } : null, why: has ? undefined : 'no storage yet: the studio runs without it; `homie-studio storage add` adds an R2 bucket for large media (Cloudflare asks for a payment method before R2 works)' };
  }
  if (cmd === 'publish') return publish(root, { homie: flags.get('homie'), site: flags.get('site') });
  if (cmd === 'players' && sub === 'owner') return playersOwner(root, { url: flags.get('url'), revoke: flags.has('revoke') });
  if (cmd === 'players' && !sub) return playersShow(root, { url: flags.get('url') });
  if (cmd === 'stats' && sub === 'key') return statsKey(root, { url: flags.get('url'), hours: flags.get('hours') });
  if (cmd === 'stats' && sub === 'link') return statsLink(root, { url: flags.get('url') });
  if (cmd === 'stats' && sub === 'revoke') return statsRevoke(root, { url: flags.get('url') });
  if (cmd === 'stats' && sub === 'share') return statsShare(root, positional[2]);
  if (cmd === 'stats' && !sub) return statsShow(root, { url: flags.get('url'), range: flags.get('range'), game: flags.get('game'), song: flags.get('song'), video: flags.get('video') });
  if (cmd === 'office') {
    const url = flags.get('url');
    if (!sub) return officeShow(root, { url });
    if (sub === 'link') return officeLink(root, { url, to: flags.get('to') });
    if (sub === 'key') return officeKey(root, { url, hours: flags.get('hours') });
    if (sub === 'announce') return officeAnnounce(root, positional.slice(2).join(' '), { url, game: flags.get('game'), room: flags.get('room'), seconds: flags.get('seconds') });
    if (sub === 'invite') return officeInvite(root, positional[2], { url, label: flags.get('label'), uses: flags.get('uses'), count: flags.get('count'), days: flags.get('days') });
    if (sub === 'launch') return officeLaunch(root, positional[2], positional[3], { url, remixable: flags.get('remixable'), max: flags.get('max') });
    if (sub === 'kick') return officeKick(root, positional[2], positional[3], positional.slice(4).join(' ') || undefined, { url, minutes: flags.get('minutes') });
    if (sub === 'close') return officeClose(root, positional[2], positional[3], { url, minutes: flags.get('minutes'), reopen: flags.has('reopen') });
    if (sub === 'revoke') return officeRevoke(root, { url });
  }
  if (cmd === 'media' && sub === 'put') return mediaPut(root, positional[2], flags.get('as'));
  if (cmd === 'media' && sub === 'list') {
    const studio = readStudio(root);
    const r2 = Boolean(studio.cloudflare?.r2 && (studio.cloudflare?.created ?? []).includes(`r2:${studio.cloudflare.r2}`));
    const view = (kind) => { const r = resolveMedia(root, kind, { r2 }); return { pages: r.entries.map((e) => ({ slug: e.slug, title: e.title, kind: e.kind, files: e.files.map(({ abs, rel, ...f }) => f) })), skipped: r.skipped }; };
    return { ok: true, command: 'media list', r2, site: siteUrl(root, studio), music: view('music'), videos: view('videos') };
  }
  return { ok: false, command: cmd, why: `unknown command "${[cmd, sub].filter(Boolean).join(' ')}" (homie-studio help)` };
}

/** `homie-studio codex …` (lib/codex.mjs): the Game Codex of one game. */
function codexCommand(root, sub) {
  const games = listGames(root);
  if (sub === 'new') return newCodex(root, positional[2] ?? (games.length === 1 ? games[0].id : undefined), { name: flags.get('name') ?? null });
  if (sub === 'link') {
    const id = positional[2] ?? (games.length === 1 ? games[0].id : null);
    if (!id || !games.some((g) => g.id === id)) return { ok: false, command: 'codex link', why: 'name the game: homie-studio codex link <id>' };
    const r = statsLink(root, { url: flags.get('url') });
    if (!r.ok) return { ...r, command: 'codex link' };
    return { ...r, command: 'codex link', link: `${r.link}&to=${encodeURIComponent(codexTarget(id))}`, use: 'Give this link to the studio\'s owner to open in their own browser: it works once, within 30 minutes, opens the codex, and keeps that browser signed in to the studio\'s private pages (the codex and the stats) for 30 days. Do not post it anywhere.' };
  }
  const id = sub ?? (games.length === 1 ? games[0].id : null);
  if (!id) return { ok: false, command: 'codex', why: `name the game: homie-studio codex <id> (${games.map((g) => g.id).join(', ') || 'no games yet'})` };
  let r;
  try { r = writeCodexPage(root, id, { mode: flags.has('artifact') ? 'artifact' : 'file' }); } catch (error) { return { ok: false, command: 'codex', why: error.message }; }
  if (flags.has('open')) {
    const opener = process.platform === 'darwin' ? ['open', [r.path]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', r.path]] : ['xdg-open', [r.path]];
    r.opened = spawnSync(opener[0], opener[1], { stdio: 'ignore', timeout: 10_000 }).status === 0;
  }
  return r;
}

/*
 * THE PROGRESS FEED (lib/progress.mjs). A command that is a stage of the open build (build, check, port check,
 * deploy) says so: the stage runs, then is done or failed with one line; a check's steps go green as they pass; a
 * stop asked in the Claude app (or by `progress stop`) ends it at the next safe point. With no open feed, or a
 * feed whose build has no such stage (a song has no deploy), the command runs exactly as it did before.
 */
async function tracked(root, stage, run, command) {
  const feed = currentFeed(root);
  if (!feed || !feed.doc.stages.some((s) => s.id === stage)) return run(null);
  await feed.sync();
  if (feed.stopRequested()) {
    feed.stage(stage, 'stopped', 'stopped by the person before it started');
    feed.end('stopped', 'Stopped by the person.');
    return { ok: false, command, stopped: true, why: 'stopped by the person (in the Claude app, or `progress stop`): the build is over; ask them before starting again' };
  }
  if (stage === 'checks') feed.resetChecks('checks');
  feed.stage(stage, 'running');
  const report = {
    check: (id, state, opts) => feed.check(id, state, { ...opts, stage }),
    preview: (p) => feed.preview(p),
    stopped: () => feed.stopRequested(),
    state: (id) => feed.doc?.checks.find((c) => c.id === id)?.state,
  };
  let result;
  try { result = await run(report); } catch (error) { feed.stage(stage, 'failed', error instanceof Error ? error.message : String(error)); throw error; }
  if (result?.stopped || feed.stopRequested()) {
    feed.stage(stage, 'stopped', 'stopped by the person');
    feed.end('stopped', 'Stopped by the person.');
    return { ...result, ok: false, stopped: true, why: result?.why ?? 'stopped by the person' };
  }
  if (!result?.ok) { feed.stage(stage, 'failed', result?.why ?? 'failed'); return result; }
  const note = stage === 'build' ? `Built ${(result.games ?? []).map((g) => `${g.id} (${Math.round(g.bytes / 1024)} KB)`).join(', ') || 'the site'}`
    : stage === 'deploy' ? `Live: ${result.url ?? 'deployed'}`
      : result.command === 'port check' ? `${result.passed.length} passed${result.skipped.length ? `, ${result.skipped.length} skipped` : ''} in ${Math.round(result.totalMs / 1000)} s`
        : `Room ${result.room}: round ${result.round?.n} finished with ${result.round?.humans} people in ${Math.round(result.totalMs / 1000)} s`;
  feed.stage(stage, 'done', note);
  if (stage === 'deploy') {
    const doc = feed.doc;
    const game = (result.games ?? []).find((g) => g.id === doc.id) ?? (result.games ?? [])[0];
    if (game?.play) feed.preview({ url: game.play });
    // Deployed, and every check that ran passed: the build is done.
    if (doc.checks.every((c) => ['pass', 'skip'].includes(c.state))) feed.end('passed', `Live: ${game?.play ?? result.url}`);
  }
  return result;
}

async function progressCommand(root, sub) {
  const arg = positional[2];
  if (sub === 'start') {
    return startProgress(root, {
      what: flags.get('what') ?? 'game', id: arg ?? flags.get('id') ?? null, title: flags.get('title'),
      budget: flags.get('budget'), unit: flags.get('unit'), share: flags.has('share'), directory: flags.get('homie'),
    });
  }
  if (sub === 'attach') {
    return startProgress(root, {
      attach: arg ?? null, what: flags.get('what') ?? 'game', id: flags.get('id') ?? null, title: flags.get('title'),
      budget: flags.get('budget'), unit: flags.get('unit'), directory: flags.get('homie'),
    });
  }
  if (sub === 'show') {
    const id = arg ?? currentId(root) ?? flags.get('build');
    const doc = readFeed(root, id);
    return doc ? { ok: true, command: 'progress show', feed: publicFeed(doc) } : { ok: false, command: 'progress show', why: id ? `no feed ${id} in .studio/progress/` : 'no build is open (homie-studio progress start)' };
  }
  const id = flags.get('build') ?? currentId(root);
  if (!id || !readFeed(root, id)) return { ok: false, command: 'progress', why: 'no build is open: start one with `homie-studio progress start <id> --share`' };
  const feed = new Feed(root, id);
  const done = (message) => ({ ok: true, command: 'progress', build: id, message, feed: publicFeed(feed.doc) });
  const note = flags.has('note') ? String(flags.get('note')) : undefined;
  try {
    switch (sub) {
      case 'stage': feed.stage(arg, positional[3], note); return done(`${arg}: ${positional[3]}`);
      case 'check': feed.check(arg, positional[3], { label: flags.get('label'), note }); return done(`check ${arg}: ${positional[3]}`);
      case 'preview': feed.preview({ url: flags.get('url'), image: flags.get('image') ? resolve(String(flags.get('image'))) : undefined, caption: flags.get('caption') }); return done('preview updated');
      case 'spend': feed.spend(arg, flags.get('what'), { receipt: flags.get('receipt'), unit: flags.get('unit') }); {
        const s = feed.doc.spend;
        return done(`spent ${s.unit === 'usd' ? `$${s.used.toFixed(2)}` : `${s.used} credits`}${s.budget !== null ? ` of ${s.unit === 'usd' ? `$${s.budget.toFixed(2)}` : `${s.budget} credits`}` : ''}`);
      }
      case 'shot': feed.shot(arg, positional[3], { label: flags.get('label'), image: flags.get('image') ? resolve(String(flags.get('image'))) : undefined }); return done(`shot ${arg}: ${positional[3]}`);
      case 'song': {
        const peaks = flags.get('peaks') ? JSON.parse(readFileSync(resolve(String(flags.get('peaks'))), 'utf8')) : undefined;
        const sung = flags.get('sung') === 'yes' ? true : flags.get('sung') === 'no' ? false : null;
        feed.song({ peaks: Array.isArray(peaks) ? peaks : peaks?.peaks, lyric: flags.get('lyric'), sung });
        return done('song updated');
      }
      case 'log': feed.log(positional.slice(2).join(' ')); return done('logged');
      case 'stop': feed.stop('local'); return done('stop asked: the running command stops at its next safe point');
      case 'change': { const c = recordChange(root, id, positional.slice(2).join(' ') || flags.get('title')); return { ...done(`change recorded: commit ${c.file} with the change`), file: c.file, mark: c.mark }; }
      case 'pr': feed.pr({ url: flags.get('url'), state: flags.get('state') ?? 'open', title: flags.get('title'), branch: flags.get('branch'), files: flags.get('files'), additions: flags.get('additions'), deletions: flags.get('deletions'), preview: flags.get('preview'), site: siteUrl(root) }); return done(`pull request on the card: ${feed.doc.change.url}`);
      case 'end': feed.end(arg, note); return done(`ended: ${arg}`);
      default: return { ok: false, command: 'progress', why: `unknown: progress ${sub ?? ''} (start, attach, stage, check, preview, spend, shot, song, log, change, pr, stop, end, show)` };
    }
  } catch (error) { return { ok: false, command: 'progress', why: error instanceof Error ? error.message : String(error) }; }
}

/*
 * WHICH DEV SERVER IS THIS STUDIO'S. `dev` writes its own PID and Wrangler's to site/.wrangler/homie-dev.json,
 * and `dev --stop` stops exactly those two (each checked to still be a process of this studio's folder), so an AI
 * never has to reach for `pkill -f "wrangler dev"`, which stops every project's dev server on the machine.
 */
const devFile = (root) => join(workerDir(root), '.wrangler', 'homie-dev.json');
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
  if (!b.catalogue.length && !b.songs.length && !b.videos.length) log('No game yet: the home page says "First game coming soon" until the first one is made.');
  const bin = wranglerBin(root);
  if (!bin) return { ok: false, command: 'dev', why: 'run npm install in the studio first' };
  const studio = readStudio(root);
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' };
  for (const added of ensureMigrations(root)) log(`added ${added} (${migrationWord(added)})`);
  await new Promise((done) => {
    const m = spawn(bin, ['d1', 'migrations', 'apply', 'DB', '--local'], { cwd: workerDir(root), env, stdio: ['ignore', 'ignore', 'inherit'] });
    m.on('close', done);
  });
  log(`Local site: http://127.0.0.1:${port}/  (each game: http://127.0.0.1:${port}/<id>/play — open it in two browsers)`);
  const child = spawn(bin, ['dev', '--local', '--ip', '127.0.0.1', '--port', port], { cwd: workerDir(root), env, stdio: 'inherit' });
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
    const p = spawn(bin, ['r2', 'object', 'put', `${r2}/${key}`, '--file', resolve(file), '--content-type', typeOf(file), '--remote'], { cwd: workerDir(root), env: { ...process.env, CI: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('close', (code) => {
      if (code !== 0) return done({ ok: false, command: 'media put', why: 'wrangler r2 object put failed' });
      // The manifest is committed: it names the file by its path on the site, never the workers.dev address.
      const rec = recordUpload(root, rel, key, statSync(file).size);
      const site = siteUrl(root, studio);
      done({ ok: true, command: 'media put', key, manifest: rec.manifest, entry: rec.entry, url: site ? `${site}/media/${key}` : null });
    });
  });
}

/*
 * A machine whose web traffic goes through a proxy (a Claude Code cloud session: HTTPS_PROXY) runs this command once
 * more with Node's own proxy support on, so the toolkit's requests go the way curl's and npm's do (lib/net.mjs).
 */
const proxied = await restartWithProxy();
if (proxied !== null) process.exit(proxied);

try {
  const result = await main();
  // A shared progress feed sends its last word before the command exits.
  await flushProgress();
  if (result && result.command !== 'help') print(result);
  if (result?.ok === false) process.exitCode = 1;
  // Chrome's pipes can outlive browser.close(); a finished check must not hang its caller.
  if (result?.command === 'check' || result?.command === 'port check' || result?.command === 'look') process.exit(process.exitCode ?? 0);
} catch (error) {
  await flushProgress().catch(() => {});
  print({ ok: false, why: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
