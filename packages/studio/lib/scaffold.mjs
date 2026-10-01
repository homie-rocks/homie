/**
 * `homie-studio new <folder> --name "<Studio Name>"` — a studio is ONE
 * monorepo: a visible folder the person opens in Claude or Codex.
 *
 *   AGENTS.md            what this studio is and how to work in it (both apps)
 *   CLAUDE.md            imports AGENTS.md (Claude Code's documented way to share it)
 *   studio.json          the studio's name, slug, and its Cloudflare resources
 *   package.json         @homie-rocks/studio and wrangler, pinned
 *   games/<id>/          one folder per game (game.json, index.html, src/)
 *   music/ videos/       manifests in the repo; the big files go to the studio's own storage
 *                        (R2) once it is added with `homie-studio storage add`
 *   posts/               the studio's news and drops (markdown; the site's Posts, with feeds)
 *   site/                the studio's Worker (pages, rooms), its look (theme.json), its D1 migrations (no R2
 *                        binding until the studio adds storage: a free Cloudflare account
 *                        without a payment method cannot use R2, and a new studio needs none)
 *   .claude/skills/      skills only this studio uses
 *
 * It writes only into a folder that is new or empty, never guesses one, and
 * lists every file it writes, so the person sees exactly what changed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { STUDIO_VERSION, packageSpec } from './version.mjs';
import { STATS_MIGRATION, STATS_MIGRATION_FILE } from '../worker/stats.mjs';
import { PLAYERS_MIGRATION, PLAYERS_MIGRATION_FILE } from '../worker/players.mjs';
import { themeFile } from './site.mjs';
import { PACKAGE_ROOT } from './studio.mjs';

export const COMPAT_DATE = '2026-06-01';
/** 4.135.0 or later: Worker Previews (`wrangler preview`, a Durable Object namespace per Preview). */
export const WRANGLER_VERSION = '4.145.0';

export function slugify(name) {
  return String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '') || 'studio';
}

/*
 * The Worker config, generated so a later deploy can rewrite exactly what it owns.
 *
 * `layout: 'root'` (every studio from 0.10.0) keeps it at the studio's root, where Cloudflare's Workers Builds and
 * the "Deploy to Cloudflare" button look for it; `'site'` is the older site/wrangler.jsonc.
 *
 * PREVIEWS (Cloudflare Worker Previews, Wrangler 4.135.0+): a branch deploys with `npx wrangler preview` (Workers
 * Builds does it on every push that is not to the production branch) to its own URL, and Cloudflare gives every
 * Preview its OWN Durable Object namespace, so a Preview's public rooms never meet production's. The `previews`
 * block binds the same Table and Lobby classes and names the Preview (HOMIE_PREVIEW). It binds no D1 on purpose:
 * a Preview counts nothing into the studio's stats, records no rounds and never claims itself in the directory;
 * its pages and rooms work without it.
 *
 * No `database_id` until one is known: Wrangler (4.45.0+) and the Deploy to Cloudflare flow create the database
 * the binding names and keep it linked.
 */
export function wranglerConfig({ worker, name, d1, d1Id = null, r2 = null, layout = 'root' }) {
  const at = layout === 'site' ? { schema: '../node_modules', main: 'src/worker.mjs', dist: './dist', migrations: 'migrations' }
    : { schema: 'node_modules', main: 'site/src/worker.mjs', dist: './site/dist', migrations: 'site/migrations' };
  const rooms = [{ name: 'TABLE', class_name: 'Table' }, { name: 'LOBBY', class_name: 'Lobby' }];
  const config = {
    $schema: `${at.schema}/wrangler/config-schema.json`,
    name: worker,
    main: at.main,
    compatibility_date: COMPAT_DATE,
    // The site's own fetches (its directory claim, "played this week") go out as any browser's would, so a studio
    // whose directory is on the same zone (a house studio on *.homie.rocks, or two Workers on one workers.dev
    // subdomain) reaches it instead of failing with 1042.
    compatibility_flags: ['global_fetch_strictly_public'],
    workers_dev: true,
    preview_urls: true,
    assets: { directory: at.dist, binding: 'ASSETS', run_worker_first: true },
    durable_objects: { bindings: rooms },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['Table', 'Lobby'] }],
    d1_databases: [{ binding: 'DB', database_name: d1, ...(d1Id ? { database_id: d1Id } : {}), migrations_dir: at.migrations }],
    ...(r2 ? { r2_buckets: [{ binding: 'MEDIA', bucket_name: r2 }] } : {}),
    vars: { STUDIO_NAME: name },
    observability: { enabled: true },
    previews: { vars: { STUDIO_NAME: name, HOMIE_PREVIEW: '1' }, durable_objects: { bindings: rooms } },
  };
  return `// This studio's site on its own Cloudflare account (written by homie-studio). Everything here runs on
// Cloudflare's Workers Free plan. \`npm run deploy\` (on this computer, or in Workers Builds) puts it live;
// \`npx wrangler preview\` puts a branch on its own Preview URL with its own rooms. There is no R2 binding
// until \`homie-studio storage add\` gives the studio storage for large media.
${JSON.stringify(config, null, 2)}
`;
}

export function agentsMd({ name, slug }) {
  return `# ${name}

This folder is a studio: **${name}** (\`${slug}\`). It is one repository.
Its games, music, videos and posts live here; its website and public game rooms
run on the studio's **own Cloudflare account** (one Worker, one D1 database and
the Table/Lobby Durable Objects, all on Cloudflare's free Workers plan), built
from \`@homie-rocks/studio\`, pinned in \`package.json\`. The homie.rocks
directory lists its games; homie.rocks does not host them.

## Layout

| Path | What it is |
| --- | --- |
| \`games/<id>/\` | One game: \`game.json\` (id, name, blurb, players, round length), \`index.html\`, \`src/main.ts\`. |
| \`music/\`, \`videos/\` | Songs, scores, loops; trailers, music videos, cutscenes. \`manifest.json\` lists each one (\`node_modules/@homie-rocks/studio/media/MEDIA.md\`); a published entry gets a page at \`/music/<slug>/\` or \`/videos/<slug>/\`, served from the site itself (files up to 25 MiB) or, for larger media, from the studio's storage once it has storage (see below; \`npx --no-install homie-studio media put <file>\`). Large files never go into git. The Homie plugin's \`music\` and \`video\` skills make them. |
| \`posts/\` | The studio's news and drops: one markdown file each (\`posts/2026-09-30-we-are-live.md\`: \`title:\`, \`date:\`, \`summary:\`, and \`game:\` / \`song:\` / \`video:\` to link one). They are the site's Posts, with Atom and JSON feeds. |
| \`site/\` | The studio's site: its look (\`theme.json\`), and anything of its own that wins over the generated pages (\`site/README.md\`); the Worker (\`src/worker.mjs\`) and its D1 migrations. |
| \`wrangler.jsonc\` | The Worker's Cloudflare config (the Worker, D1, the Table and Lobby Durable Objects, and \`previews\` for branch Previews), at the root, where Cloudflare's Workers Builds reads it. A studio made before 0.10.0 keeps it in \`site/\` and deploys from a computer; every command finds either. |
| \`changes/\` | One small file per change that went out through a pull request (\`homie-studio progress pr\` writes it): the site lists the newest, so the Claude app can tell when a merged change is live. |
| \`studio.json\` | The studio's name, slug, Cloudflare resource names, custom domain and stats sharing. \`.studio/\` (git-ignored) is this computer's own state. |
| \`.claude/skills/\` | Skills only this studio uses. Homie's own skills come from the Homie plugin. |

## Commands (all through the pinned CLI in node_modules)

Use \`npm run <script>\` or \`npx --no-install homie-studio <command>\`: \`--no-install\` makes sure it is this
studio's pinned copy, never a registry lookup of the bare name.

- \`npx --no-install homie-studio game new <id> --from gem-rush --name "<Name>"\` — a new game from a
  multiplayer starter (one live public room from its first build, bots fill seats).
- \`npx --no-install homie-studio port plan <folder>\` — read an existing single-player web game and grade
  how hard making it multiplayer will be; \`port import\` brings it into \`games/\`, \`port check\` runs the
  owner tests (real touch, a late joiner, a killed host, two browsers finishing a round). The Homie
  plugin's \`port\` skill does the whole job.
- \`npm run build\` — bundle every game into \`site/dist\`.
- \`npm run dev\` — the whole site locally (pages, the netplay relay in a local
  Durable Object, D1): open the printed address in two browsers and they share a room.
  Stop it with \`npx --no-install homie-studio dev --stop\` (this studio's dev server only;
  never \`pkill\` by name, which stops other projects' dev servers too).
- \`npx --no-install homie-studio check <id> --url <site>\` — two headless browsers press Play and must
  land in the same room and finish a round. Run it before you say a game works.
- \`npx --no-install homie-studio deploy --plan\` — says what deploy will create on Cloudflare and what it
  costs, and changes nothing. Tell the person before the first deploy.
- \`npm run deploy\` — the site on this studio's Cloudflare: one Worker, one D1 database, two
  SQLite-backed Durable Objects, all on the free Workers plan (no payment method needed).
  If Wrangler is not signed in, run \`npx wrangler login\`: the person approves once in
  their browser. It never overwrites a Worker or database this studio did not create.
- **Workers Builds** (Cloudflare's own CI, set up by the "Deploy to Cloudflare" button or in the dashboard): on
  every push to \`main\` it runs \`npm run build\` and \`npm run deploy\`, which in Workers Builds only applies
  the D1 migrations and deploys (it never creates or refuses anything); on every other branch it runs
  \`npm run build\` and \`npx wrangler preview\`, a Preview URL with its own rooms. The live site claims itself
  in the homie.rocks directory the first time it is read, so nothing is stored by hand.
- \`npx --no-install homie-studio storage add\` — only when the studio needs large media (songs,
  videos): an R2 bucket for \`media put\`, served at \`/media/<key>\`. Cloudflare asks for a
  payment method on the account before R2 works (its first 10 GB a month are free), so this
  is a separate step the person agrees to; nothing else needs it.
- \`npx --no-install homie-studio publish\` — list this studio's games in the homie.rocks directory
  (or call the Homie MCP tool \`studio_publish\`).
- \`npx --no-install homie-studio stats\` — the studio's own numbers, for its owner: visits, Play presses,
  rooms, the most people playing at once, rounds, songs played, videos watched, and where visitors came
  from (homie.rocks, other studios, search, the web). \`stats link\` gives the owner a one-time link to the
  private page \`/_studio/stats\` in their own browser; \`stats key\` a short read key for the Homie MCP tool
  \`studio_stats\` (never paste a key anywhere else). \`stats share on\` tells the directory two numbers
  (played this week). The site counts and never tracks: no cookie on a visitor, no person identified,
  nothing sent anywhere; house QA and \`check\` runs are not counted.
- \`npx --no-install homie-studio players\` — how many players have accounts here (and guests, and who played
  this week): counts and names for the owner, never a passkey or an email. \`players owner\` gives the owner a
  one-time link that marks their own player account (a passkey on this site) as the owner's, so their games and
  the studio's back office recognise them.
- \`npx --no-install homie-studio upgrade\` — after pinning a newer \`@homie-rocks/studio\` (or through
  \`npx -y --package=<its tarball> homie-studio upgrade\`): what the newer template adds to this studio (AGENTS.md
  sections, READMEs, .gitignore lines) and what it keeps. It changes nothing until \`--apply\`, and never
  touches a file or section this studio changed; \`--diff\` shows how those differ from the template's.

## The site

\`npm run build\` makes the studio's site from what is in this folder
(\`node_modules/@homie-rocks/studio/site/SITE.md\` says all of it):

- **Sections, like homie.rocks:** Home (the featured game, live rooms, latest posts), Games, Music, Videos,
  Rooms (every public room playing now, joinable) and Posts. A section with nothing in it has no tab, and its
  page is not found.
- **Every game gets a landing** at \`/<id>/\`: a full-bleed hero from the game's own footage
  (\`games/<id>/hero/wide.mp4\` and \`tall.mp4\`, or a trailer in \`videos/\` with \`for.game\`), else its cover
  with slow motion; the pitch, a big Play button into a public room, phone / computer / TV with the join code,
  live rooms, how to play, credits, and "Make a game like this". Give it words in game.json's \`landing\` block
  (\`pitch\`, \`about\`, \`controls\`, \`howToPlay\`, \`credits\`) and art with the plugin's \`art\` and \`video\` skills.
- **The look** is \`site/theme.json\` (colours, fonts, corner radius, a logo). Anything in \`site/\` wins: a whole
  page in \`site/pages/\`, a piece of every page in \`site/partials/\`, files in \`site/public/\`, extra CSS in
  \`site/theme.css\` (\`site/README.md\`). A game whose picture is white or cream gets a light landing with
  game.json \`"landing": { "scheme": "light" }\` (a dark tint would turn it grey).
- **Cards and the directory** show each game's landing still (\`hero/wide.jpg\`), else its cover. A song without
  a cover of its own shows the music manifest's \`cover\`, else its game's still.
- **Live rooms** are listed on homie.rocks too; studio.json \`"rooms": { "share": false }\` keeps them off it.
- Every page ends with "Made with Homie", linking to homie.rocks/studio/. Restyle it in \`site/theme.css\`; keep it.

## Making games

- Every game is multiplayer on the web through the netplay contract
  (\`node_modules/@homie-rocks/studio/netplay/NETPLAY.md\`): every browser renders the game
  itself, one browser hosts the rules, strangers meet in public rooms, bots fill empty
  seats, anyone arriving takes a bot's place, rounds end and restart on their own.
- Import it as \`import { createNetplay } from '@homie-rocks/studio/netplay'\`.
- Phones and computers: touch controls on phones only, keys on computers; keep the
  centre of the screen clear during play.
- The play page's small room button (Invite, Big screen, the room code) sits top right. If the game's
  scoreboard or a bar is there, move it in game.json \`"screen": { "share": … }\`: a corner or \`top-center\`, per
  device (\`desk\`, \`phone\`, \`sideways\`), with an \`x\` / \`y\` offset in pixels, and \`"label": false\` to keep it
  a small icon (\`node_modules/@homie-rocks/studio/site/SITE.md\`). Look at it on a phone and a computer.
- Change a game in small steps, build, and look at it (\`dev\`, then \`check\`).
- A game's id is its URL (\`/<id>/\`); keep it once published.
- **Progress that lasts** (a character, unlocks, a collection, days of play) goes in **saves**, never in the room:
  a room forgets everything 60 s after its last player leaves. game.json \`"saves": true\` and
  \`createSaves\` from \`@homie-rocks/studio/saves\` (\`node_modules/@homie-rocks/studio/saves/SAVES.md\`): per
  player and game, versioned, offline-tolerant, in this studio's own D1. Pressing Play needs no account; a guest's
  progress stays on that device until they make a passkey account (at \`/account/\`, or the game's own button), and
  then it follows them to every device. Lifetime stats and a hardcore "hall of the fallen" are in it too. The
  \`ember-vale\` starter shows the whole pattern.

## The Game Codex and progress

- **Every game has a Game Codex:** \`games/<id>/CODEX.md\`, its plan in plain words for everyone who makes it, coder
  or not: concept, world, characters, art direction, controls per device, rooms and players, music and sound,
  milestones, open questions, and under Latest the decisions as they are made, newest first, each with its date.
  It is the source of truth: when a decision changes, change the codex in the same change.
  \`npx --no-install homie-studio codex new <id>\` starts one with every section.
- \`npx --no-install homie-studio codex <id>\` draws it as a page in the game's own look
  (\`.studio/codex/<id>.html\`, \`--open\` opens it; \`--artifact\` makes a copy to publish as a Claude artifact).
  The site has it too, for the owner only and never listed: \`codex link <id>\` gives the one-time sign-in link.
- **Progress:** \`npx --no-install homie-studio progress start <id> --title "<what this build does>"\` opens a
  build's progress feed; build, check and deploy report into it. The codex page's Build status tab redraws itself
  as it moves (stages, checks going green, how to try it, spend), and \`homie-studio statusline --install\` puts
  one line of it under the prompt in Claude Code.
- \`npx --no-install homie-studio setup status\` says what this computer and the person's accounts have (Node,
  Cloudflare, Chrome, ffmpeg, GitHub, ElevenLabs, fal), what each unlocks, and the exact fix. Optional ones never
  block anything.

## Rules

- Keys stay in the providers' own logins (Wrangler, ElevenLabs, fal) or the OS
  keychain. Never write a key, token or password into this repository.
- Never touch a Cloudflare resource this studio did not create (\`studio.json\` says which).
- The site's workers.dev address names the Cloudflare account (often after its owner): \`deploy\` keeps it in
  \`.studio/local.json\`, which git ignores. Never copy it into a committed file. A custom domain goes in
  studio.json as \`cloudflare.domain\`.
- A game's room size is its netplay manifest's \`maxPlayers\` (game.json \`netplay\`, or netplay.json), up to 32.
- Nothing in this studio needs \`~/.homie\` or a Homie box.

## Beta

Homie for studios is in beta. When something breaks, or a game you want to port does
not fit, open an issue at https://github.com/homie-rocks/homie/issues/new/choose (a bug,
a port request or a question). Leave keys, tokens and private addresses out of it.
`;
}

function claudeMd() {
  return `@AGENTS.md

<!-- Claude Code reads AGENTS.md through the import above (the documented way to share it with Codex).
Claude-only notes go below this line. -->
`;
}

export function readme({ name }) {
  return `# ${name}

A game studio made with [Homie](https://homie.rocks). Open this folder in Claude Code or Codex
and ask for a game; \`AGENTS.md\` says how everything here works.
`;
}

const MIGRATION = `-- A studio's own D1: the directory claim, and every finished round of every public room.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  room TEXT NOT NULL,
  n INTEGER NOT NULL,
  humans INTEGER NOT NULL,
  bots INTEGER NOT NULL,
  results TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rounds_game_at ON rounds (game, at);
`;

const POSTS_README = `# Posts

The studio's news and drops. One markdown file each; the site shows them at \`/posts/\` (newest first), on the home
page, and in two feeds: \`/posts/feed.xml\` (Atom) and \`/posts/feed.json\` (JSON Feed).

The file's name is its address: \`posts/2026-09-30-we-are-live.md\` is \`/posts/we-are-live/\`, dated by its prefix.

\`\`\`markdown
---
title: We are live
date: 2026-09-30
summary: One line for the cards and the feeds.
game: crown-thief
image: /games/crown-thief/cover.jpg
---

The body, in markdown: **bold**, *italic*, [links](https://homie.rocks/), images, lists, quotes.
\`\`\`

\`game:\`, \`song:\` and \`video:\` link one of this studio's games, songs or videos (by id or slug); the post shows
it with a Play, Listen or Watch button. \`draft: true\` keeps a post off the site. Raw HTML is shown as text.
Files README.md, and names starting with \`_\` or \`.\`, are not posts.
`;

const SITE_README = `# site/

The studio's site. \`npm run build\` makes every page from the studio (its games, music, videos and posts);
anything here wins. The whole list is in \`node_modules/@homie-rocks/studio/site/SITE.md\`.

| Put it in | What it does |
| --- | --- |
| \`theme.json\` | The look: \`bg\`, \`fg\`, \`accent\`, \`glow\` colours, \`display\` and \`text\` fonts (\`fonts\` loads a file from \`public/\`), \`radius\`, \`mark\` (a logo). Or \`palette\`: neon, dock, gold, acid, ember, orchid, tide, candy. |
| \`theme.css\` | Extra CSS on every page (restyle anything, the "Made with Homie" footer included). |
| \`partials/<name>.html\` | A piece of every page: \`head\`, \`header\`, \`footer\`, \`home\` (a band on Home), \`game\` (a band on every game's landing), \`game-<id>\` (on one game's), \`post\`. |
| \`pages/<path>/index.html\` | A whole page at \`/<path>/\`, instead of the generated one (\`pages/<id>/index.html\` replaces a game's landing) or beside them (\`pages/about/index.html\`). It may borrow \`<!-- homie:style -->\`, \`<!-- homie:header -->\`, \`<!-- homie:footer -->\`, \`<!-- homie:script -->\`. |
| \`public/\` | Files served as they are, at the same path (\`public/fonts/x.woff2\` is \`/fonts/x.woff2\`). |

\`src/worker.mjs\` and \`migrations/\` are the Worker (its config is \`wrangler.jsonc\`, at the studio's root); \`dist/\` is the build (not committed).
`;

const GITIGNORE = `node_modules/
# This computer's own state: the site's workers.dev address (it names the Cloudflare account, often after its owner).
.studio/
# This person's own Claude Code settings for this studio (the status line, for one).
.claude/settings.local.json
site/dist/
site/.wrangler/
.wrangler/
.dev.vars
.env
*.log
# Port checks: receipts and screenshots of each run (games/<id>/.port/check-*/).
games/*/.port/
# Screenshots from check and look runs.
.checks/
# Large media lives in this studio's storage (R2, after storage add) or is served by the site; the manifests beside it are committed.
# Working files of the music and video skills (frames, captures, provider answers) stay on this computer.
music/**/work/
videos/**/work/
music/**/*.wav
music/**/*.mp3
music/**/*.flac
videos/**/*.mp4
videos/**/*.mov
videos/**/*.webm
`;

/** Every file a new studio gets, relative to its folder. */
export function studioFiles({ name, slug, homie, template = false }) {
  const worker = slug;
  const studio = {
    name, slug,
    // A copy of the public template (Deploy to Cloudflare) until `homie-studio setup attach` names it for real:
    // meanwhile its site shows the name the person typed in Cloudflare's form (STUDIO_NAME).
    ...(template ? { template: true } : {}),
    homie: { studio: STUDIO_VERSION, directory: homie },
    // r2 stays null until `homie-studio storage add`: a new studio deploys with no R2 at all.
    // `domain`: the studio's own domain once it has one (e.g. "night-owls.example"). The workers.dev address never
    // goes here: it names the Cloudflare account, so deploy keeps it in .studio/local.json (git-ignored).
    cloudflare: { worker, d1: `${slug}-db`, r2: null, accountId: null, domain: null, created: [] },
    // The site counts visits, plays, rooms, rounds and songs for the owner only (`homie-studio stats`); `share`
    // also tells the homie.rocks directory "played this week" (two numbers) for the hub.
    stats: { share: false },
  };
  const pkg = {
    name: `${slug}-studio`,
    private: true,
    type: 'module',
    scripts: { dev: 'homie-studio dev', build: 'homie-studio build', deploy: 'homie-studio deploy', check: 'homie-studio check', studio: 'homie-studio' },
    devDependencies: { '@homie-rocks/studio': packageSpec(homie), wrangler: WRANGLER_VERSION },
    // What Cloudflare's "Deploy to Cloudflare" form says about each setting (package.json `cloudflare.bindings`).
    cloudflare: {
      label: 'Homie studio',
      products: ['Workers', 'D1', 'Durable Objects'],
      bindings: {
        STUDIO_NAME: { description: 'Your studio\'s name, as its site shows it (for example **Night Owls**). Claude can change it later.' },
        DB: { description: 'The studio\'s own database: finished rounds, the studio\'s own stats (counts, never a visitor), player accounts and cloud saves for games that keep them, and its claim in the [homie.rocks](https://homie.rocks/studios/) directory. Free plan.' },
      },
    },
  };
  const files = {
    'AGENTS.md': agentsMd({ name, slug }),
    'CLAUDE.md': claudeMd(),
    'README.md': template ? templateReadme() : readme({ name }),
    'studio.json': `${JSON.stringify(studio, null, 2)}\n`,
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
    '.gitignore': GITIGNORE,
    'games/README.md': 'One folder per game. Start one with `npx --no-install homie-studio game new <id> --from gem-rush`.\n',
    'music/README.md': 'Songs, game scores, loops and stems, one folder each (`music/<slug>/`). `manifest.json` lists them (`node_modules/@homie-rocks/studio/media/MEDIA.md`); a published entry gets a page at `/music/<slug>/`. The site serves files up to 25 MiB itself; larger ones go to the studio\'s storage with `npx --no-install homie-studio media put` (after `npx --no-install homie-studio storage add`). Never into git.\n',
    'music/manifest.json': '{ "v": 1, "items": [] }\n',
    'videos/README.md': 'Trailers, music videos and cutscenes, one folder each (`videos/<slug>/`). `manifest.json` lists them (`node_modules/@homie-rocks/studio/media/MEDIA.md`); a published entry gets a page at `/videos/<slug>/`. The site serves files up to 25 MiB itself; larger ones go to the studio\'s storage with `npx --no-install homie-studio media put` (after `npx --no-install homie-studio storage add`). Never into git.\n',
    'videos/manifest.json': '{ "v": 1, "items": [] }\n',
    'posts/README.md': POSTS_README,
    'site/theme.json': themeFile(slug),
    'site/README.md': SITE_README,
    'site/src/worker.mjs': `// This studio's site: pages, public rooms (Table + Lobby Durable Objects), D1, and R2 once storage is added.
// The code is @homie-rocks/studio's, pinned in package.json, so an update never changes a published game by surprise.
export { default, Table, Lobby } from '@homie-rocks/studio/worker';
`,
    'site/migrations/0001_studio.sql': MIGRATION,
    [`site/migrations/${STATS_MIGRATION_FILE}`]: STATS_MIGRATION,
    [`site/migrations/${PLAYERS_MIGRATION_FILE}`]: PLAYERS_MIGRATION,
    'wrangler.jsonc': wranglerConfig({ worker, name, d1: studio.cloudflare.d1, r2: studio.cloudflare.r2, layout: 'root' }),
    '.claude/skills/.gitkeep': '',
  };
  if (template) {
    // A first game, so the site plays the moment Cloudflare deploys it; and a band on Home that connects the new
    // studio to the Claude chat that set it up (`setup attach` removes both once Claude works in the studio).
    for (const [rel, text] of starterFiles('gem-rush')) files[`games/gem-rush/${rel}`] = text;
    files['site/partials/home.html'] = CONNECT_BAND;
  }
  return files;
}

/** A starter's files, as text, relative to its folder. */
function starterFiles(id) {
  const dir = join(PACKAGE_ROOT, 'starters', id);
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else out.push([path, readFileSync(join(dir, path), 'utf8')]);
    }
  };
  walk('');
  return out;
}

/** The template's first-run band on Home: one link that connects this studio to the Claude chat that set it up. */
export const CONNECT_BAND = `<!-- A new studio from the Homie template. This band goes away once Claude works in the studio
     (homie-studio setup attach removes it); delete it by hand any time. -->
<div class="band-in" style="text-align:center">
  <p class="kicker">New studio</p>
  <h2>{{studio.name}} is live</h2>
  <p>It runs on your own Cloudflare account. Connect it to the Claude chat that set it up, and Claude takes it from here.</p>
  <p><a class="btn" href="/_studio/connect">Connect to Claude</a></p>
</div>
`;

export function templateReadme() {
  return `# A Homie studio

This repository is a game studio made with [Homie](https://homie.rocks): its games, music, videos and posts,
and a site with public multiplayer rooms that runs on **your own Cloudflare account**, on the free plan.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/homie-rocks/homie/tree/main/template)

The button copies this studio into your GitHub, creates its Worker, database and rooms on your Cloudflare, and
deploys it with Workers Builds: every push to \`main\` goes live, and every other branch gets its own Preview.
The site plays a first game the moment it is up.

Then open the site and tap **Connect to Claude**, or ask Claude in the Claude app to set up your studio with the
Homie connector: it makes games, songs and videos here, in a pull request you merge with one tap.

\`AGENTS.md\` says how everything here works.
`;
}

/**
 * A studio made before 0.6.0 has no stats migration: add it (the template owns site/migrations/), so the next
 * `d1 migrations apply` makes the counters. Returns the file it wrote, or null when it was there.
 */
export function ensureStatsMigration(root) {
  const file = join(root, 'site', 'migrations', STATS_MIGRATION_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, STATS_MIGRATION);
  return `site/migrations/${STATS_MIGRATION_FILE}`;
}

/**
 * A studio made before 0.12.0 has no players migration (player accounts and cloud saves, saves/SAVES.md): add it,
 * so the next `d1 migrations apply` makes the tables. Returns the file it wrote, or null when it was there.
 */
export function ensurePlayersMigration(root) {
  const file = join(root, 'site', 'migrations', PLAYERS_MIGRATION_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, PLAYERS_MIGRATION);
  return `site/migrations/${PLAYERS_MIGRATION_FILE}`;
}

/** Every migration the template owns that this studio lacks, added: the files written (deploy and dev say so). */
export function ensureMigrations(root) {
  return [ensureStatsMigration(root), ensurePlayersMigration(root)].filter(Boolean);
}

/**
 * A studio made before 0.6.0 committed nothing under .studio/ yet: make sure git leaves it out before the first
 * deploy writes the workers.dev address there. Returns true when it added the line.
 */
export function ensureLocalIgnored(root) {
  const file = join(root, '.gitignore');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (/^\/?\.studio\/?$/m.test(text)) return false;
  writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}# This computer's own state: the site's workers.dev address (it names the Cloudflare account).\n.studio/\n`);
  return true;
}

function insideGit(dir) {
  try { return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true'; } catch { return false; }
}

export function newStudio(folder, { name, homie, slug: askedSlug, install = true, template = false } = {}) {
  if (typeof folder !== 'string' || !folder.trim()) throw new Error('name the folder for the new studio, e.g. `homie-studio new ~/studios/night-owls --name "Night Owls"`. Nothing was written.');
  if (!name || !String(name).trim()) throw new Error('give the studio a name: --name "Night Owls". Nothing was written.');
  const dir = resolve(folder.replace(/^~(?=\/|$)/, homedir()));
  const home = realpathSync(homedir());
  let real = null;
  try { real = realpathSync(dir); } catch { /* new */ }
  const at = real ?? dir;
  if (at === home || at === '/' || home.startsWith(`${at}/`)) throw new Error(`${at} is your home folder or above it; a studio needs its own folder. Nothing was written.`);
  if (real) {
    if (!statSync(real).isDirectory()) throw new Error(`${real} is a file. Nothing was written.`);
    const entries = readdirSync(real).filter((n) => n !== '.DS_Store' && n !== '.git');
    if (entries.length) throw new Error(`${real} is not empty (${entries.slice(0, 5).join(', ')}${entries.length > 5 ? ', …' : ''}). A new studio goes in a new or empty folder. Nothing was written.`);
  }
  const slug = slugify(askedSlug || name);
  const files = studioFiles({ name: String(name).trim(), slug, homie: homie || 'https://homie.rocks', template });
  mkdirSync(dir, { recursive: true });
  const wrote = [];
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    wrote.push(rel);
  }
  let git = 'already inside a git repository';
  if (!insideGit(dir)) {
    try { execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); git = 'initialised'; wrote.push('.git/'); } catch { git = 'git not found'; }
  }
  // Install the pinned @homie-rocks/studio and wrangler now, so every later `npx homie-studio` is this studio's own
  // copy and never a registry lookup of the bare name.
  let installed = 'skipped (--no-install): run npm install before any other command';
  if (install) {
    try {
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, npm_config_update_notifier: 'false' } });
      installed = 'npm install done';
      wrote.push('node_modules/', 'package-lock.json');
    } catch (error) { installed = `npm install failed (${String(error.stderr ?? error.message).trim().split('\n').slice(-2).join(' ')}): run it in the studio folder`; }
  }
  const q = JSON.stringify(realpathSync(dir));
  return { ok: true, command: 'new', dir: realpathSync(dir), name, slug, wrote, git, installed, studio: STUDIO_VERSION, next: [
    `cd ${q}${install ? '' : ' && npm install'}`,
    'npx --no-install homie-studio game new <id> --from gem-rush --name "<Game Name>"',
    'npm run dev   (then: npx --no-install homie-studio check <id> --url http://127.0.0.1:8787)',
    'npm run deploy   (then the Homie MCP tool studio_publish, or: npx --no-install homie-studio publish)',
  ], online: 'Going online creates one Worker, one D1 database and two Durable Objects on your own Cloudflare account: free plan, no payment method, no R2. `npx --no-install homie-studio deploy --plan` says exactly what, and changes nothing.' };
}

export const _test = { relative };
