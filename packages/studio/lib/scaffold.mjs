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
import { themeFile } from './site.mjs';

export const COMPAT_DATE = '2026-06-01';
export const WRANGLER_VERSION = '4.126.0';

export function slugify(name) {
  return String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '') || 'studio';
}

/** The Worker config, generated so a later deploy can rewrite exactly what it owns. */
export function wranglerConfig({ worker, name, d1, d1Id = null, r2 = null }) {
  const config = {
    $schema: '../node_modules/wrangler/config-schema.json',
    name: worker,
    main: 'src/worker.mjs',
    compatibility_date: COMPAT_DATE,
    workers_dev: true,
    preview_urls: false,
    assets: { directory: './dist', binding: 'ASSETS', run_worker_first: true },
    durable_objects: { bindings: [{ name: 'TABLE', class_name: 'Table' }, { name: 'LOBBY', class_name: 'Lobby' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['Table', 'Lobby'] }],
    d1_databases: [{ binding: 'DB', database_name: d1, ...(d1Id ? { database_id: d1Id } : {}), migrations_dir: 'migrations' }],
    ...(r2 ? { r2_buckets: [{ binding: 'MEDIA', bucket_name: r2 }] } : {}),
    vars: { STUDIO_NAME: name },
    observability: { enabled: true },
  };
  return `// This studio's site on its own Cloudflare account (written by homie-studio; \`homie-studio deploy\`
// fills in the D1 id). Everything here runs on Cloudflare's Workers Free plan. There is no R2 binding
// until \`homie-studio storage add\` gives the studio storage for large media.
${JSON.stringify(config, null, 2)}
`;
}

function agentsMd({ name, slug }) {
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
| \`site/\` | The studio's site: its look (\`theme.json\`), and anything of its own that wins over the generated pages (\`site/README.md\`); the Worker (\`src/worker.mjs\`), D1 migrations, \`wrangler.jsonc\`. |
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
  \`site/theme.css\` (\`site/README.md\`).
- Every page ends with "Made with Homie", linking to homie.rocks/studio/. Restyle it in \`site/theme.css\`; keep it.

## Making games

- Every game is multiplayer on the web through the netplay contract
  (\`node_modules/@homie-rocks/studio/netplay/NETPLAY.md\`): every browser renders the game
  itself, one browser hosts the rules, strangers meet in public rooms, bots fill empty
  seats, anyone arriving takes a bot's place, rounds end and restart on their own.
- Import it as \`import { createNetplay } from '@homie-rocks/studio/netplay'\`.
- Phones and computers: touch controls on phones only, keys on computers; keep the
  centre of the screen clear during play.
- Change a game in small steps, build, and look at it (\`dev\`, then \`check\`).
- A game's id is its URL (\`/<id>/\`); keep it once published.

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

function readme({ name }) {
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

\`src/worker.mjs\`, \`migrations/\` and \`wrangler.jsonc\` are the Worker; \`dist/\` is the build (not committed).
`;

const GITIGNORE = `node_modules/
# This computer's own state: the site's workers.dev address (it names the Cloudflare account, often after its owner).
.studio/
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
export function studioFiles({ name, slug, homie }) {
  const worker = slug;
  const studio = {
    name, slug,
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
  };
  return {
    'AGENTS.md': agentsMd({ name, slug }),
    'CLAUDE.md': claudeMd(),
    'README.md': readme({ name }),
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
    'site/wrangler.jsonc': wranglerConfig({ worker, name, d1: studio.cloudflare.d1, r2: studio.cloudflare.r2 }),
    '.claude/skills/.gitkeep': '',
  };
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

export function newStudio(folder, { name, homie, slug: askedSlug, install = true } = {}) {
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
  const files = studioFiles({ name: String(name).trim(), slug, homie: homie || 'https://homie.rocks' });
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
