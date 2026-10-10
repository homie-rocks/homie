import { FUNCTIONS_MIGRATION, FUNCTIONS_MIGRATION_FILE, FUNCTIONS_CURSOR_MIGRATION, FUNCTIONS_CURSOR_MIGRATION_FILE } from '../worker/functions-schema.mjs';
import { MCP_MIGRATION, MCP_MIGRATION_FILE } from '../worker/mcp-store.mjs';
import { APPS_MIGRATION, APPS_MIGRATION_FILE } from '../worker/app-records.mjs';
import { PURCHASE_MIGRATION, PURCHASE_MIGRATION_FILE, PURCHASE_STATE, PURCHASE_STATE_FILE } from '../worker/purchase-schema.mjs';
/**
 * `homie-studio new <folder> --name "<Studio Name>"` — a studio is ONE
 * monorepo: a visible folder the person opens in Claude or Codex.
 *
 *   AGENTS.md            what this studio is and how to work in it (both apps)
 *   CLAUDE.md            imports AGENTS.md (Claude Code's documented way to share it)
 *   HANDOFF.md           what a Claude Code session started from the Claude app does with its one-line prompt
 *   studio.json          the studio's name, slug, and its Cloudflare resources
 *   package.json         @homie-rocks/studio and wrangler, pinned
 *   games/<id>/          one folder per game (game.json, index.html, src/)
 *   music/ videos/       manifests in the repo; the big files go to the studio's own storage
 *                        (R2) once it is added with `homie-studio storage add` (media move, deploy)
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
import { OFFICE_MIGRATION, OFFICE_MIGRATION_FILE } from '../worker/office-schema.mjs';
import { SERVERS_MIGRATION, SERVERS_MIGRATION_FILE } from '../worker/servers.mjs';
import { CHAT_MIGRATION, CHAT_MIGRATION_FILE } from '../worker/chat-store.mjs';
import { SHOP_MIGRATION, SHOP_MIGRATION_FILE, SHOP_RESERVATIONS, SHOP_RESERVATIONS_FILE, SHOP_STATEMENTS, SHOP_STATEMENTS_FILE, SHOP_LINES, SHOP_LINES_FILE } from '../worker/shop-store.mjs';
import { LOUNGE_MIGRATION, LOUNGE_MIGRATION_FILE } from '../worker/lounge-store.mjs';
import { themeFile } from './site.mjs';
import { rulesIndex } from './studio.mjs';

export const COMPAT_DATE = '2026-06-01';
/** 4.135.0 or later: Worker Previews (`wrangler preview`, a Durable Object namespace per Preview). */
export const WRANGLER_VERSION = '4.145.0';
/**
 * The TypeScript a new studio asks for, so `build --types` (and an editor) has a compiler: the studio's own
 * devDependency, never one of the toolkit's (a studio that never checks types pays nothing for it at runtime).
 */
export const TYPESCRIPT_VERSION = '5.9.3';

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
export function wranglerConfig({ worker, name, d1, d1Id = null, r2 = null, layout = 'root', main = null, ai = false, routes = null, paidParts = false, partsRateLimit = null, triggers = null }) {
  const at = layout === 'site' ? { schema: '../node_modules', main: 'src/runtime/worker.js', dist: './dist', migrations: 'migrations' }
    : { schema: 'node_modules', main: 'site/src/runtime/worker.js', dist: './site/dist', migrations: 'site/migrations' };
  const rooms = [{ name: 'TABLE', class_name: 'Table' }, { name: 'LOBBY', class_name: 'Lobby' }];
  const config = {
    $schema: `${at.schema}/wrangler/config-schema.json`,
    name: worker,
    main: main ?? at.main,
    compatibility_date: COMPAT_DATE,
    // The site's own fetches (its directory claim, "played this week") go out as any browser's would, so a studio
    // whose directory is on the same zone (a house studio on *.homie.rocks, or two Workers on one workers.dev
    // subdomain) reaches it instead of failing with 1042.
    // `disallow_eval_during_startup`: no code is made from a string while the Worker loads (Cloudflare never allows it
    // later). A game's rules run in this Worker (NETPLAY.md section 29), and nothing in them is ever made from text.
    no_bundle: true, find_additional_modules: true, rules: [{ type: 'ESModule', globs: ['**/*.js'], fallthrough: true }],
    compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public', 'disallow_eval_during_startup'],
    ...(paidParts ? { alias: { '@homie-rocks/studio/worker': '@homie-rocks/studio/worker/selling' }, triggers: { crons: ['*/5 * * * *'] }, ...(partsRateLimit ? { ratelimits: [partsRateLimit] } : {}) } : {}),
    workers_dev: true,
    preview_urls: true,
    // The studio's own custom-domain and exact-host routes, as its owner wrote them: this file is written again by
    // every deploy, and one written without them sends the studio's domain back to whatever else the zone routes
    // (lib/routes.mjs). A studio without routes gets no key at all.
    ...(routes?.length ? { routes } : {}),
    ...(triggers ? { triggers: paidParts ? { ...triggers, crons: [...new Set([...(triggers.crons ?? []), '*/5 * * * *'])] } : triggers } : {}),
    assets: { directory: at.dist, binding: 'ASSETS', run_worker_first: true },
    durable_objects: { bindings: rooms },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['Table', 'Lobby'] }],
    d1_databases: [{ binding: 'DB', database_name: d1, ...(d1Id ? { database_id: d1Id } : {}), migrations_dir: at.migrations }],
    ...(r2 ? { r2_buckets: [{ binding: 'MEDIA', bucket_name: r2 }, ...(paidParts ? [{ binding: 'PURCHASE_MEDIA', bucket_name: `${r2.slice(0, 52)}-purchases` }] : [])] } : {}),
    // Workers AI, only when a server's AI guides think with it (agents_brain workers-ai; deploy adds it, 0.17.0).
    // Never in Previews: they do not inherit it, so a Preview's guides answer from the game's script.
    ...(ai ? { ai: { binding: 'AI' } } : {}),
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

## Version-matched authoring guides

Before authoring or rewriting a game, read \`node_modules/@homie-rocks/studio/guides/game/SKILL.md\`,
\`RULES.md\` and \`REWRITE.md\` in that same folder. These ship with the installed toolkit;
use them when an installed plugin describes an older API. \`homie-studio check\` reports older
plugin copies and the update step. After upgrading the plugin, start a new session.

## Layout

| Path | What it is |
| --- | --- |
| \`games/<id>/\` | One game: \`game.json\` (id, name, blurb, players, round length), \`index.html\`, \`src/rules.ts\`, \`src/move.ts\`, \`src/view.ts\` and shared \`map/\` data; and, when it has them, \`tunables.json\` (the numbers that shape how it feels: the Game Lab's sliders, kept values written back) and \`lab.json\` (the Game Lab's takes). |
| \`music/\`, \`videos/\` | Songs, scores, loops; trailers, music videos, cutscenes. \`manifest.json\` lists each one (\`node_modules/@homie-rocks/studio/media/MEDIA.md\`); a published entry gets a page at \`/music/<slug>/\` or \`/videos/<slug>/\`. Without storage the site serves each file itself (up to 25 MiB). Once the studio has storage (see below), its big media (over 1 MiB, or left out of git) lives in its own R2: every deploy uploads it, checks it by SHA-256 and serves it from R2 at the same address. Large files never go into git. The Homie plugin's \`music\` and \`video\` skills make them. |
| \`games/<id>/assets/\` | Every model and texture a game ships, with where it came from and its licence (\`manifest.json\`), and \`RIGHTS.md\` in plain words; \`games/<id>/codex/decisions.json\` (private, like the codex) is its look as decisions, and \`style.json\` the palette, fonts, light and camera the game draws with. \`art/<slug>/\` holds art jobs (concepts, receipts; \`raw/\` is git-ignored). |
| \`posts/\` | The studio's news and drops: one markdown file each (\`posts/2026-09-30-we-are-live.md\`: \`title:\`, \`date:\`, \`summary:\`, and \`game:\` / \`song:\` / \`video:\` to link one). They are the site's Posts, with Atom and JSON feeds. |
| \`site/\` | The studio's site: its look (\`theme.json\`), and anything of its own that wins over the generated pages (\`site/README.md\`); the Worker (\`src/worker.mjs\`) and its D1 migrations. |
| \`wrangler.jsonc\` | The Worker's Cloudflare config (the Worker, D1, the Table and Lobby Durable Objects, and \`previews\` for branch Previews), at the root, where Cloudflare's Workers Builds reads it. A studio made before 0.10.0 keeps it in \`site/\` and deploys from a computer; every command finds either. |
| \`changes/\` | One small file per change that went out through a pull request (\`homie-studio progress pr\` writes it): the site lists the newest, so the Claude app can tell when a merged change is live. |
| \`perf/\` | Performance reports, one folder per game (the Homie plugin's \`perf\` skill): \`README.md\` (the goal, before and after with the noise, every change tried and why it was kept or reverted), \`numbers.json\` and \`before-after/\`. The raw runs, screenshots and CPU profiles stay in \`.perf/\`, which git ignores. |
| \`studio.json\` | The studio's name, slug, Cloudflare resource names, custom domain and stats sharing. \`.studio/\` (git-ignored) is this computer's own state. |
| \`.claude/skills/\` | Skills only this studio uses. Homie's own skills come from the Homie plugin. |

The person describes an outcome; you carry it through setup, building and checks without a tutorial
or a planning interview. Choose engineering and design defaults from their words and record them
in the codex. Use "My Studio" when unnamed, phones and computers, local sound and CC0 art.
They can change anything by asking. A business or charity may want an app, not a game.
Install missing prerequisites yourself; never ask the person to run a command or handle a key,
account id, zone id or setting. Honour an existing request to go live or list, subject to host holds.
For a requested custom hostname, add its custom_domain route in Wrangler along with cloudflare.domain;
Cloudflare creates DNS and TLS during deploy with the existing sign-in.


## Apps: one screen, roles and parts

An app lives in \`apps/<id>/app.json\` and \`src/\`. Make one with \`homie-studio app new <id>\` (or \`app_make\`). Use the Homie plugin's \`app\` skill for businesses, venues, causes and customer apps. No game demo, rounds, scores, bots or mandatory fun: build what the person needs with the fewest human steps.

An app is ONE screen that morphs with context: camera moves, panels unfold, its roles see and do different things, and parts plug into the scene. No page-to-page navigation or menus of links inside it. Use all the same engine packages and media skills as games (camera, geom, props, render, postfx, fx, audio, input, ui-world; style, art, models, animate, music, sound, video). It can be fully 3D and wild while remaining useful and legible.

Declare roles, surfaces, words and lasting record collections in app.json. Netplay's host is not a staff permission. Use \`@homie-rocks/studio/apps\` for authorized lasting records and \`@homie-rocks/studio/links\` for ticket links, QR and HTTP-safe IDs. Staff use private role links plus existing account grants; keep private records out of public collections. Look for engine mechanisms and shared parts before writing a component. Credit licences; sharing is optional and separate from selling.

Your studio also serves MCP at \`/mcp\`. Staff connect their own AI with their existing account and one browser approval; never ask them for a key. Add business actions with \`homie-studio tool new <name> --app <id>\`, keep their declared role narrow, and reuse the app's existing record IDs, field formats and versions. Customers can browse and buy through this same endpoint, and tools may declare a price using the studio's existing payments. Add event handlers with \`homie-studio function new <name> --event order.paid\`; read \`node_modules/@homie-rocks/studio/functions/FUNCTIONS.md\`. Test owner, staff and public calls locally. Read \`node_modules/@homie-rocks/studio/tools/TOOLS.md\` and the Homie plugin's \`tools\` skill.

Build normally, run \`homie-studio dev --lan\`, then \`homie-studio check <id> --url <origin>\`: the app check proves an actual action across a wall and two phones plus reconnect. The public screen is \`/<id>/open\`, the wall \`/<id>/tv\`. Customer apps use the same \`standalone\` build for desktop/iOS/Android; its existing sign-in and store limitations still apply. See \`node_modules/@homie-rocks/studio/apps/APPS.md\`.

## Commands (all through the pinned CLI in node_modules)

Use \`npm run <script>\` or \`npx --no-install homie-studio <command>\`: \`--no-install\` makes sure it is this
studio's pinned copy, never a registry lookup of the bare name.

- \`npx --no-install homie-studio demo\` — a live multiplayer game to try right now (on Homie Arcade, with
  whoever is playing and bots in the empty seats). Nothing is copied into this studio.
- \`npx --no-install homie-studio game new <id> --from gem-rush --name "<Name>"\` — a new game from a
  multiplayer starter (one live public room from its first build, bots fill seats). A new studio starts with no
  game: copy a starter only when the person asks for one, or once their game is planned.
- \`npx --no-install homie-studio port plan <folder>\` — read an existing single-player web game and grade
  how hard making it multiplayer will be; \`port import\` brings it into \`games/\`, \`port check\` runs the
  owner tests (real touch, a late joiner, one browser leaving, two browsers finishing a round). The Homie
  plugin's \`port\` skill does the whole job.
- \`npm run build\` — bundle every game into \`site/dist\`. It builds in a folder of its own and puts the result
  in place only when all of it is there: a game that does not build fails the command (a non-zero exit) and
  leaves \`site/dist\` exactly as it was, and nothing running from \`site/dist\` loses its files. Each game's line
  says \`changed\`, \`unchanged\` or \`new\` (against the build before) and its build hash;
  \`site/dist/_site/build.json\` keeps the same, and the live site says each game's hash in
  \`/.well-known/homie-studio.json\` (\`games[].build.hash\`), so "is the live game the one I built?" is one
  comparison. A game's bundle is named by its content (\`assets/main-<HASH>.js\`; its built \`index.html\` names
  it, so write \`./assets/main.js\` in the game's own \`index.html\` as always), and \`await import('./later')\` in
  a game becomes a file of its own that loads when asked for: a 3D game can show its first screen before the
  rest of its code arrives.
- \`npx --no-install homie-studio build --types\` — the same, after checking the games' TypeScript (the build
  itself only strips types; a type error ships otherwise). It uses the studio's own \`typescript\`
  (\`npm install --save-dev typescript\` if this studio has none), reads a game's own \`tsconfig.json\` when it
  has one, and a type error in a game's files stops the build.
- \`npx --no-install homie-studio preview <id>\` — one built game's files at an address on this computer
  (\`http://127.0.0.1:8788/\`), nothing else: no Wrangler, no rooms, no database. For a capture, a screenshot or
  a perf script; the game plays offline with its bots. Ctrl-C stops it.
- \`npm run dev\` — the whole site locally (pages, the netplay relay in a local
  Durable Object, D1): open the printed address in two browsers and they share a room.
  Stop it with \`npx --no-install homie-studio dev --stop\` (this studio's dev server only;
  never \`pkill\` by name, which stops other projects' dev servers too).
- \`npx --no-install homie-studio check <id> --url <site>\` — two headless browsers press Play and must
  land in the same room and finish a round. Run it before you say a game works.
- \`npx --no-install homie-studio perf <id> --url <site>\` — how fast a game runs, on a computer and an emulated
  phone, with two browsers in a room (two replicas when the server hosts): frame times, the game's JavaScript and the main thread
  per frame, time to playable, what it downloads, the heap, netplay messages a second (files under \`.perf/\`). The
  Homie plugin's \`perf\` skill runs the whole loop: one change at a time, kept only when it is better beyond the noise
  and \`check\` still passes, and a report in \`perf/<id>/\`.
- \`npx --no-install homie-studio lab <id>\` — the Game Lab, on this computer (run it in the background; stop it with
  \`lab --stop\`): one take of a move (\`games/<id>/lab.json\`) played in the working tree beside the last commit, on
  one clock, slowed down or a frame at a time, with the phases, graphs and tunables the game reports
  (\`@homie-rocks/studio/lab\`). \`lab check <id>\` plays it headless and writes the numbers and a contact sheet. The
  Homie plugin's \`lab\` skill runs the whole loop: instrument and commit first, change how it feels, keep what the
  person likes.
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
- \`npx --no-install homie-studio storage add\` — only when the studio has songs or videos: an R2
  bucket on the studio's own Cloudflare account. Cloudflare asks for a payment method on the account
  before R2 works, so this is a separate step the person agrees to; nothing else needs it. R2 has no
  egress fees; storage is free up to 10 GB-month, then US$0.015 per GB-month.
- \`npx --no-install homie-studio media move\` (\`--dry-run\` first) — with storage, the big files of
  published songs and videos (over 1 MiB, or left out of git; studio.json \`media.r2Over\` changes the
  size) go to R2: each is uploaded, read back and checked by SHA-256, and only then does the site stop
  carrying it; it keeps its address, and the file stays in this folder. Every \`npm run deploy\` does
  it too; once a file is in R2 (the committed manifest says so), a deploy from another computer or
  Workers Builds still serves it. \`media list\` says where each file is served from.
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
  \`npx -y @homie-rocks/studio@<its version> upgrade\`): what the newer template adds to this studio (AGENTS.md
  sections, READMEs, .gitignore lines) and what it keeps. It changes nothing until \`--apply\`, and never
  touches a file or section this studio changed; \`--diff\` shows how those differ from the template's.

## The site

\`npm run build\` makes the studio's site from what is in this folder
(\`node_modules/@homie-rocks/studio/site/SITE.md\` says all of it):

- **Sections, like homie.rocks:** Home (the featured game, live rooms, latest posts), Games, Music, Videos,
  Rooms (every public room playing now, joinable and watchable) and Posts. A section with nothing in it has no tab, and its
  page is not found.
- **A new studio goes live with its Home only:** its name and "First game coming soon", with what is on the way
  (games, posts, music and videos), until its first game, song or video is published. A post shows there at once.
- **Every game gets a landing** at \`/<id>/\`: a full-bleed hero from the game's own files in
  \`games/<id>/hero/\`: \`wide.jpg\` (16:9, 1280×720 or larger) and \`tall.jpg\` (9:16, 720×1280, what an upright
  phone gets) for a still, and \`wide.mp4\` and \`tall.mp4\` in the same shapes for footage (a silent loop of 8 to
  15 s, under 3 MB each); else a trailer in \`videos/\` with \`for.game\`; else its cover with slow motion. Any
  size is shown, cropped to fill; one file may be 25 MiB at most. Then the pitch, a big Play button into a public room, phone / computer / TV with the join code,
  live rooms, how to play and credits. Give it words in game.json's \`landing\` block
  (\`pitch\`, \`about\`, \`controls\`, \`howToPlay\`, \`credits\`) and art with the plugin's \`art\` and \`video\` skills.
- **The look** is \`site/theme.json\` (colours, fonts, corner radius, a logo). Anything in \`site/\` wins: a whole
  page in \`site/pages/\`, a piece of every page in \`site/partials/\`, files in \`site/public/\`, extra CSS in
  \`site/theme.css\` (\`site/README.md\`). **The order of the games** everywhere (Home, the Games page, the cards,
  the directory's manifest) is studio.json \`"site": { "order": ["<id>", "<id>"] }\`: those first, as named, the
  rest by id; \`"site": { "featured": "<id>" }\` picks Home's hero. A game whose picture is white or cream gets a light landing with
  game.json \`"landing": { "scheme": "light" }\` (a dark tint would turn it grey).
- **Cards and the directory** show each game's landing still (\`hero/wide.jpg\`), else its cover. A song without
  a cover of its own shows the music manifest's \`cover\`, else its game's still.
- **Live rooms** are listed on homie.rocks too; studio.json \`"rooms": { "share": false }\` keeps them off it.
- **Search engines and AI agents** read every page's schema.org data (a full VideoGame on each landing) and
  \`/robots.txt\`, \`/sitemap.xml\`, \`/llms.txt\`, made from what is public. Give a game game.json \`"genre"\`, put
  pictures of play in \`games/<id>/screenshots/\`, give each video a \`"date"\`, and never invent ratings.
- Every page ends with "Made with Homie", linking to homie.rocks/studio/. Restyle it in \`site/theme.css\`; keep it.

## Making games

- **New games are rules plus view, hosted by the server.** Read the Homie game skill and its
  RULES.md before writing code (MCP: studio_guide game, then studio_guide game file RULES.md).
  Start with coin-dash, gem-rush, ember-vale, gem-rush-3d or hero-rush-3d; all five follow this contract.
  In games/<id>/src/rules.ts, defineRules declares entities, fields, handlers, events, rounds and companions.
  The view calls openRoom and sends input/commands; it draws, plays sound and handles controls. It never
  decides a hit, score, spawn, turn or result. Keep game.json room.host set to server, up to 32 seats.
- **Movement feels immediate through prediction.** Put the shared defineMove callback in src/move.ts;
  it runs authoritatively on the server and immediately for your own view, then reconciles. Other bodies
  interpolate. Use the starter's sweep/slide and room.me/room.each poses; no second browser physics loop,
  and no owner-movement workaround. Discrete actions wait for the server's decision.
- **Truth is declared and deterministic.** Entity handlers write their own fields and send next-tick events;
  room handlers write shared fields. Use world.tick/dt/ticks/after/random and world.math (ctx.math in move),
  never clocks, Math.random, hidden module state, async/network calls or browser APIs in rules.
  Read RULES.md for the bounded query and execution budget, declared commands/effects/asks, and message fixes.
- **Level data is shared.** map/main.json describes collision and bounds in metres. A 3D rules body's z is
  height at its feet; Three.js draws x,z,y. Floors, walls and platforms must agree in rules and view.
  Public tunables describe movement. Bots and companions use the same inputs and declared goals, with a
  scripted floor that plays without AI. Asks declare bounded state, questions and a deterministic floor.
- **Choose sensible defaults yourself.** Do not ask the person for a hosting mode, movement mode, tick rate
  or serialization scheme. Preserve the requested mechanic. Turn-based games and live apps may use manual
  rounds. Shared live app state uses these same rooms; durable records and authentication use the app APIs.
  A build-only request ends with a working local result; publish only within the owner's requested scope.
- **Check changes honestly.** Build first, repair each source-located guard/type/play-check error using RULES.md,
  then check with two browsers and play the requested mechanic with network delay. Info is not a failure.
  Never remove rules, weaken checks, forge a probe or switch hosting to get past a message.
  Rules hashes and room saves are automatic; character saves are player-owned, untrusted input. Room state
  is replicated, not secret. Bigger rooms and private state are not delivered by milestone 1.
- **Existing games:** change rules truth in rules and presentation in view. Browser hosting is for offline,
  local development and private friends games. Untouched older createNetplay/createRoom games still work;
  when asked to rewrite one, read the game skill's REWRITE.md and preserve its art, view and feel. There is
  no automatic converter. NETPLAY.md section 29 is the rules contract; earlier sections describe older APIs.
- Phones and computers: touch controls on phones only, keys on computers; keep the
  centre of the screen clear during play.
- The play page's small room button (Invite, Big screen, the room code) sits top right, with the Chat pill
  beside it (a round icon on a phone, as the room button is). If the game's scoreboard or a bar is there, move
  both in game.json \`"screen": { "share": … }\`: a corner or \`top-center\`, per device (\`desk\`, \`phone\`,
  \`sideways\`), with an \`x\` / \`y\` offset in pixels, and \`"label": false\` to keep them small icons
  (\`node_modules/@homie-rocks/studio/site/SITE.md\`). Room chat's strip of new lines shows for a moment at the
  bottom left: if the game's HUD or controls are there, \`"screen": { "chat": … }\` puts it where the game has
  room (\`at\`: a corner, \`top-center\` or \`bottom-center\`; \`x\` / \`y\`; per device, and \`tv\` for the big
  screen), or \`"lines": "sheet-only"\` keeps new lines in the Chat sheet, the pill counting them, so a game with
  a busy HUD keeps typed chat (\`node_modules/@homie-rocks/studio/chat/CHAT.md\`). Look at both on a phone and a
  computer while a round is on and somebody says something.
- **Watch any player.** Every live room can be watched at \`/<id>/watch?room=<room>\` (each room on the Rooms page
  and the landing has a Watch button): the game itself, drawn by the watcher's own browser, which never takes a
  seat, with a strip of the players to switch between (a tap, keys 1-9, A for Auto, O for the whole room). Point the
  camera and the HUD at \`net.viewSeat\` (your own seat when playing; the followed player when watching; null: the
  overview camera; \`room.viewBody()\` in a port), and call \`net.spotlight(seat)\` on a hit, a kill or a goal so
  Auto cuts to it (\`NETPLAY.md\` section 16). A game that never reads \`viewSeat\` is watched as its overview. A
  game with hidden hands or roles says game.json \`"watch": "overview"\` (the whole room only) or \`false\` (no
  watch door); a private or invite-only game is watched only by those it lets in.
- **A touch game guards its own page.** The play page refuses text selection, the long-press callout and page
  gestures around the game's frame, but a long press INSIDE the game (a HUD label, a button's text, the canvas) is
  the game's own: on a phone it raises copy/paste and the thumb's touch is lost. Call
  \`guardGestures({ touch: 'canvas, [data-action]' })\` from \`@homie-rocks/studio/netplay\` once, early: no
  selection, no callout, no pan or pinch on the gameplay surfaces; text fields, links and ordinary buttons keep the
  browser's own behaviour (\`NETPLAY.md\` section 24). Try it with a real thumb on a real phone: emulated touch
  does not raise the callout.
- **The frame has no storage of its own.** The game runs in a sandboxed frame without \`allow-same-origin\` (a
  stranger's game must never read this site's storage or the owner's session), so \`localStorage\` throws inside it.
  A setting or a personal best goes in \`net.prefs\` (\`net.prefs.string('quality', 'high')\`, \`net.prefs.number('volume', 0.8, { min: 0, max: 1 })\` after \`await net.prefs.ready\`: the typed readers give your fallback for a missing key, never a null that turns into 0,
  \`net.prefs.set('quality', 'low')\`: the play page keeps 16 KB a game); progress that must last goes in saves.
  The play page's \`?debug\` and \`?q=…\` reach the game as \`net.params\`, with any names game.json
  \`"netplay": { "params": ["seed"] }\` declares (\`NETPLAY.md\` section 24).
- **game.json \`"netplay"\`** also takes \`"version"\` (the game's revision: bump it when a change makes an
  already-open tab unable to play with a new one; rooms then run one build at a time and the old tab is told to
  reload) and \`"stallMs"\` (1500 to 10000: how long a host may send no snapshot before the room is handed on, for
  a heavy 3D game). \`NETPLAY.md\` sections 22 and 23.
- Change a game in small steps, build, and look at it (\`dev\`, then \`check\`).
- A game's id is its URL (\`/<id>/\`); keep it once published.
- **A game's own licence.** game.json \`"license": "MIT"\` (any SPDX identifier) is said on the game's page; a game
  that names none says nothing. It is a statement about the game, not an offer of its source: no game is handed
  over whole. A game.json that still has \`"remix"\`, \`"share"\`, \`landing.make\` or one of the old licence words
  builds as before with one note (remix was retired; delete them). A game that has \`"remixOf"\` was made from another
  studio's game: keep it, it is the credit its landing and credits show ("Based on <game> by <studio>").
- **A 3D game's models.** \`createModels()\` warns in development about a model over 1,500 triangles or 300 KB,
  which is a small prop's budget. A game whose models are bigger on purpose says so once in its game.json:
  \`"assets": { "budgets": { "triangles": 8000, "bytes": 1500000 } }\` (per model; \`texturePx\` and \`materials\`
  too). A game copied from a 3D starter has \`"assets": "library"\` there, which only mattered when it was copied:
  replace it with the object.
- **Parts: how games build on each other.** A part is a piece of a game its studio chose to share (a creature, a
  level generator, a camera, a bot brain, an audio pack), never the whole game. **Before writing a system from
  scratch, look for one**: the \`@homie-rocks/*\` packages (npm) have the general mechanism (camera, input, audio,
  effects), and \`parts_find\` searches the pieces other studios shared; packages are not parts. \`part_add\` with
  \`"<studio site>/<part id>"\` fetches one exact version, checks every file, copies it into \`parts/_vendor/\` where
  the studio owns and tunes it (its \`tuning.json\` survives a newer version), credits it in the game, and lets npm
  install the packages it builds on; the game imports it in one line, \`import … from '@parts/<studio site>/<part
  id>'\`. Write in the game's CODEX (Built from) what came from where. A reusable piece of this studio's own game
  becomes a part with \`part_new\` (it is lifted out and the game keeps working). **A part is private until the
  person asks to share it** (\`part_share\`, with an SPDX licence they picked and who to credit); it is live after
  the next deploy. Without the chat tools, the same jobs are \`npx --no-install homie-studio parts
  find|add|new|share\`. The design is \`node_modules/@homie-rocks/studio/parts/PARTS.md\`.
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

## Art direction and models

- **A game's look is a set of decisions** (\`games/<id>/codex/decisions.json\`, drawn in the codex's Art direction
  tab): render style, palette, shape, proportions, materials, light, camera, fonts, effects; the cast, its library
  family, scale and phone budgets. \`npx --no-install homie-studio style init <id> --prompt "<the person's words>"\`
  picks every one automatically with a why. The person can steer one ("warmer"), lock one, or explore three
  directions drawn by the game engine itself (\`style board <id>\`, free). The first asset built on a decision pins
  it; a locked one changes only with the person's yes after \`style blast\` shows what goes stale and what remaking
  it would cost. Nothing is ever remade by itself. The Homie plugin's \`style\` skill has the rest.
- **Models come free first**: the engine, then Homie's CC0 starter library (\`assets find "<words>"\`, then
  \`assets add <id> <item>\`, copied in, never hot-linked), then the person's own files (\`assets add <id> --file …
  --license …\`), then generated props on the person's own fal account under a budget with receipts (the plugin's
  \`models\` skill). Every model is checked (no external URIs, no oversized files), made phone-sized and recorded
  with its licence; \`RIGHTS.md\` and the credits page follow. \`assets check <id>\` holds a game to the phone
  budgets; \`assets lineup <id>\` shows everything at true scale. A three.js game loads models through
  \`@homie-rocks/studio/assets\` (\`createModels\`); \`game new <id> --from gem-rush-3d\` starts one.
- **Characters and clips**: an animated library character (\`assets find "knight" --kind character\`) comes in
  phone-sized, one draw call, its bones named by the skeleton standard, its clips in one shared clip library per
  skeleton (\`public/anims/<skeleton>.glb\`); \`anim plan <id>\` lists each one's clips against the verbs the game
  needs, \`anim add <id> <asset> --verbs jump,attack\` retargets more onto it (free), \`anim preview <id>\` draws
  them looping. A game plays them through \`@homie-rocks/studio/animate\` (\`loadCharacter\`: blends, hits, jumps,
  lean, look-at, crowds; every number a Game Lab tunable); \`game new <id> --from hero-rush-3d\` starts one. The
  plugin's \`animate\` skill has the rest.
- **Licences**: a public game ships only assets whose licence allows it (CC0, CC BY with credit, the studio's own,
  generated); \`publish\` refuses an asset with no licence record.

## Running live games (the back office)

- The owner runs the studio's live games from \`/_studio/office\` (\`npx --no-install homie-studio office link\` gives
  the owner a one-time sign-in link): every live room of every game, who is in it (handles; accounts once players
  sign in), bots, the round and uptime, refreshing by itself; Kick (that player cannot come back to that room for
  the minutes chosen), Mute (their chat and emotes reach nobody), Announce (one line every player sees), Close a
  room; and per game: launch state, players per room and invites.
- **Launch states:** \`private\` (only the owner, signed in; \`office link --to /<id>/play\` signs the owner's phone
  in), \`invite\` (an invite-only beta: \`office invite <id>\` makes invite links and codes, each for one browser or
  as many as \`--uses\` says), \`public\` (the default; listed). A game that is not public is in no list and not in
  the directory manifest, so the directory drops it the next time it reads the studio. A new game stays private
  from its first deploy with \`"launch": "private"\` in its game.json.
- The owner is recognised in their own games: signed in, their play page has a small Owner button (tap a player:
  Mute, Kick; Announce). Nobody else's page has it.
- **From the AI:** \`npx --no-install homie-studio office\` lists who is playing now; \`office announce "<text>"\` and
  \`office invite <id>\` happen at once; \`office kick\`, \`office mute\`, \`office close\` and \`office launch\` only ASK, and print a
  one-time link that opens the ask in the owner's own browser, where one tap does it. An ask is not done until the
  owner tapped. \`office key\` gives a key for the Homie MCP's owner tools (\`studio_office\`, \`room_announce\`,
  \`room_kick\`, \`room_close\`, \`game_launch_state\`), which ask the same way; never paste a key anywhere else.
- A game can listen (\`NETPLAY.md\` section 15): \`net.on('announce', …)\`, \`net.isMuted(seat)\` to hide a muted
  player's chat, and \`net.pickPlayer(seat)\` when a player is clicked (the owner's page opens their card).

## Servers and AI seats

- **A server** is a named, lasting pool of rooms for one game, with its own policy and door. Strangers are matched
  only inside one server. Every game's \`pub-N\` rooms are its \`public\` server (Quick play), so old links keep
  working. A server's page is \`/<id>/s/<server>/\`; its rooms are \`s-<server>-<n>\`; \`/<id>/servers/\` lists them.
- **Policies:** \`open\` (anyone; an AI with an agent pass may sit, always marked AI), \`humans-only\` (no AI of any
  kind; the game's bots are off unless \`--bots fill\`), \`hybrid\` (N seats in every room are AI companions),
  \`beginner\` (accounts under 30 days, AI guides, quick lines only, optionally \`--kids\`: handles only, the AI's
  level at most 3). **Doors:** \`open\`, \`accounts\` (a passkey account) or \`invite\` (\`office invite\` with
  \`--server\`). AI is ALWAYS marked AI: every agent's name ends in " · AI", and the relay, not the game, enforces it.
- \`npx --no-install homie-studio servers\` lists them; \`servers new <id> "<Name>" --policy hybrid --ai 2\` (or
  \`--policy beginner --guides 2 [--kids]\`, \`--policy humans-only\`) makes one at once; \`servers set <id> <server>
  --level-max 3 …\` changes one; \`servers close <id> <server>\`. A change that narrows who may come in (humans-only,
  a stricter door) and closing one only ASK, with the owner's one-tap link, like \`office kick\`.
- **Rules companions:** use world.level, world.guideLevel, world.guideSeats and world.kids; guide.view,
  guide.floor, think and goalDone follow the rules contract. The old BotBrain/useAgents/decide recipes below
  apply only to unchanged browser-hosted games. Read RULES.md for a new game.
- **The skill dial (older browser-hosted games):** every room has a level, 1 Rookie, 2 Steady, 3 Fair, 4 Strong, 5 Maxed, each \`{ reactionMs,
  aimNoise, aggression, positioning }\`. The party sets it by voting on a card in the play page (the middle vote
  wins, capped by the server's ceiling). Make a game's bots honour it: \`net.skillOf(slot)\` in their step (the
  snippet is in \`NETPLAY.md\` section 17; \`BotBrain\` from the port kit reads it with a rebuild), and declare
  \`caps: ['skill', 'agents']\` in \`createNetplay\` (a game on \`createRoom\` has \`agents\` already). A build
  from before 0.16.0 still plays on every server; the office says it predates servers until it is rebuilt.
- **Agent passes:** \`npx --no-install homie-studio agents pass <id> --label Claude [--server <server>]\` gives an
  AI its way into a seat (shown once; \`agents revoke <pass>\` ends it). It sits with \`POST /<id>/api/agent\`
  (Bearer pass), only in a room with people in it, and never on a humans-only server.
- **AI guides that talk (0.17.0):** a beginner server's guides get a brain. A game's own words for them are
  \`games/<id>/agents.json\` (its vocabulary: goals, lines, the asks a player taps; the build checks it), and
  \`useAgents\` from \`@homie-rocks/studio/agents\` is the host's side: a view per guide, the scripted floor, goals
  for the hands, lines drawn from the vocabulary (\`NETPLAY.md\` section 18; Ember Vale is the reference). The
  brain is the server's: \`agents brain <id> <server> workers-ai\` (the studio's own Workers AI; \`npm run deploy\`
  binds it; at most \`--budget\` neurons a day, 8,000 by default) or \`owner-key\` (the owner's own key, set with
  \`agents brain key\` on this computer, never in a chat; a dollar cap a day). The first time AI talk is turned on
  it only ASKS. The AI never types: it picks a goal and a line id; the relay drops anything else. With no AI, over
  budget, or between decisions, the game's \`decide\` plays. \`agent_sit\` (the local MCP) puts the owner's own
  Claude in a guide's seat.
- **Clef (0.24.4):** Workers AI's guides think with Cloudflare's decision model \`@cf/cloudflare/clef-flash\` (it
  picks among the vocabulary's goals, values and lines; it never writes text; about 9 neurons a decision).
  \`agents try <id> --view <file> [--ask …] [--model …]\` shows what the brain would decide in one moment. Under
  \`npm run dev\`, Clef on this computer (Ollama with \`clef-flash\`) runs the guides, chat review and game
  decisions for free when it is here; **never download it without the person's yes** (\`ollama pull clef-flash\` is
  about 11 GB). A game whose game.json says \`"decide": true\` may ask \`net.decide(state, questions, { floor })\`
  on the host (\`NETPLAY.md\` section 20): per beat or per turn, never per frame.

## Selling things (the shop)

Your shop, your choices. The studio sells through its own Stripe account and is responsible for the law
where it sells and for Stripe's terms. Homie takes no cut.

- \`shop.json\` lists items, wording, kinds, prices, quantities and entitlements. Optional settings include
  sale dates, tips, currency, \`automaticTax\`, refund windows, spending caps and referral terms.
- The default is open: guests can buy repeatedly, without age questions, from any page. Signing in keeps
  guest purchases. \`shop init --supporter\` writes an example item without a policy, cap or refund window.
- Choose \`policy.preset: "protective"\` or \`"adults-only"\` to enable an account and age policy. Omitted
  presets, including in existing files, use the open default. Individual overrides are in SHOP.md.
- \`createShop()\` from \`@homie-rocks/studio/shop\` supplies \`open\`, \`has\`, \`entitlements\`, \`used\`, and \`change\`.
  \`shop.add(item, quantity)\` builds a cart; \`shop.checkout()\` pays; \`shop.buy(item)\` buys directly.
- With the fuller connection, a cart has independent lines and quantities. The office can refund a whole order or line. The optional
  player refund window covers items; a tip is never taken back by the player.
- Flood settings are configurable: buyer attempts 6/minute, address attempts 600/minute,
  new guest buyers 600/hour. Stripe constraints, integer arithmetic, ownership and signatures protect payments.
- \`shop check\` validates settings; \`stripe_login\` / \`shop connect\` starts Stripe browser approval.
  Never ask a person for a key. Follow the result's next step: deploy first if needed, then rerun connect.
  The default syncs Products, Prices, Payment Links and the webhook through the approved Stripe CLI.
  The Worker stores only links and a signing secret; buying needs no API key or running AI.
  Rerun \`shop connect\` after shop.json changes; use \`shop connect --renew\` if approval needs renewal.
  Verify a test purchase, signed webhook, item grant, and a refund in Stripe or through the connected AI.
  Never ask a person for a key. An existing Worker key selects the fuller cart/cap/refund path;
  explain it only when those features are requested. Never silently choose \`--manual\`. Live only on request.
  A lost webhook stays pending: ask Stripe to resend it. Free orders need no Stripe.
  Never create secret-returning webhooks through conversation MCP tools; connect captures secrets privately.
  Stripe's approval links belong to the owner. \`checkoutMinutes\` is optional (Stripe: 30 to 1440 minutes,
  default 1440; values below 31 use 31 for transport margin); cancelling a named checkout, or replacing one at least a minute old, expires the open session on Stripe's confirmation.
- \`shop orders\` and \`/_studio/office/shop\` show sales. \`shop refund <order>\` asks the owner to confirm.
  \`shop statements\` records optional referral shares; studios pay their referrers directly.

The guide is \`node_modules/@homie-rocks/studio/shop/SHOP.md\`.

## Continuing a build from the Claude app

A Claude Code session started from the Claude app's card gets one short line, like
\`Continue building Night Owls: build hb_…\`. \`HANDOFF.md\` says what to do with it:
\`npx --no-install homie-studio handoff hb_…\` fetches the brief the person gave in the chat, takes the build (the
chat's card follows the work from then on) and, for a studio still being set up, checks in from this repository.

## Rules

- Keys stay in the providers' own logins (Wrangler, ElevenLabs, fal) or the OS
  keychain. Never write a key, token or password into this repository.
- Never touch a Cloudflare resource this studio did not create (\`studio.json\` says which).
- The site's workers.dev address names the Cloudflare account (often after its owner): \`deploy\` keeps it in
  \`.studio/local.json\`, which git ignores. Never copy it into a committed file. A custom domain goes in
  studio.json as \`cloudflare.domain\`.
- A game's room size is its netplay manifest's \`maxPlayers\` (game.json \`netplay\`, or netplay.json), up to 32.
- Nothing in this studio needs \`~/.homie\` or a Homie box.
- This studio is this folder. A studio in a folder beside it (another folder with its own \`studio.json\`) is
  somebody else's work: never read it or copy from it unless the person asks.
- Optional in studio.json: \`"protect"\` (globs of files the owner wants to look at before any change, such as
  \`"games/*/game.json"\`) and \`"budget"\` (\`{ "usd": <n>, "credits": <n> }\`: the most the studio's media jobs spend
  in all). In Claude Code, the Homie plugin's mod holds an edit to a protected file, a deploy, and a paid call past
  the budget until the person says Proceed, and takes keys out of command output. In Codex the plugin's hooks hold
  the same calls until the person's own \`proceed <code>\`, once the person has trusted them, and in Grok Build once
  the plugin is trusted. \`npx --no-install homie-studio setup status --client codex\` (or \`grok\`) says whether Homie's
  holds are on, and while they are off, ask before each of those yourself. When a call is refused, say what you
  meant to do and why; do not retry it unless the person asks.

## Telling Homie

The people who make Homie read every note, and someone who is stuck rarely writes to a forum. So when the person is
stuck, confused or frustrated, after an error you could not fix, or at the end of their first studio setup or first
publish, you may OFFER, once in a session, to send them a short note about it: the Homie MCP's \`homie_feedback\`
(in Claude Code also \`/feedback\`, and Tell Homie in the Studio pane). Draft it in plain words from what happened
(what they tried, what they expected, what they saw); a draft sends nothing. Show it exactly as it would go, and send
it only after they say yes (in Claude Code, Claude Code itself asks them with the exact note). Never nag: a no is
final for the session, and help never depends on it. Never put a key, a log, a file, code or anyone's name in a
note; a reply address only if they typed it. When they ask to tell Homie something, draft it with
\`offered: false\`.

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

/**
 * HANDOFF.md: what a Claude Code session started from the Claude app does with the one line it is given
 * ("Continue building <Studio>: build hb_…"). The brief stays with the build in the directory; the session fetches it
 * (`homie-studio handoff`, lib/handoff.mjs), so no wall of text ever goes through a prompt.
 */
export const HANDOFF_MD = `# Continuing a build from the Claude app

The Claude app (claude.ai on a phone or the web) hands a build to a Claude Code session in this repository with
one short line:

    Continue building <Studio>: build hb_<32 hex digits>

That line is all the session is given. The brief (what the person asked for, in their words) stays with the build:

1. \`npm install\` (once per session).
2. \`npx --no-install homie-studio handoff hb_…\` prints the brief and the steps for this kind of build (a new
   studio's first session, a new game, a port or a change). It takes the build once, so the chat's card
   follows the work, and for a studio still being set up it checks in from this repository.
3. If it says this session's network does not reach homie.rocks and the Homie connector's tools are in this session,
   call \`build_progress\` with \`{ "build": "hb_…" }\`: its answer carries the same brief. Otherwise tell the person
   in one line and ask what to build; the card in their chat shows the brief.
4. Do the work the brief asks for, as AGENTS.md says: \`npm run build\`, \`npm run dev\` in the background, and
   \`npx --no-install homie-studio check <id> --url http://127.0.0.1:8787\` (on Linux without Chrome, first
   \`npx --no-install homie-studio chrome install\`).
5. \`npx --no-install homie-studio progress change "<what it does, one line>"\`; commit on a new branch, push,
   \`gh pr create\`; then \`npx --no-install homie-studio progress pr --url <the pull request>\`.

Never merge the pull request: the person publishes it from the chat's card, in GitHub. A new studio has no game
yet: copy a starter only when the brief or the person asks for one.

On a computer, the Claude desktop app with the Homie extension builds in the same chat, with no hand-off at all.
`;

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
| \`pages/<path>/index.html\` | A whole page at \`/<path>/\`, instead of the generated one (\`pages/<id>/index.html\` replaces a game's landing) or beside them (\`pages/about/index.html\`). It may borrow \`<!-- homie:style -->\`, \`<!-- homie:header -->\`, \`<!-- homie:footer -->\`, \`<!-- homie:script -->\`, and \`<!-- homie:schema -->\` in its \`<head>\` (the page's structured data for search engines). A Home of your own (\`pages/index.html\`) takes the generated hero with \`<!-- homie:home-hero -->\` (the featured game) or \`<!-- homie:home-hero <id> -->\` (that game); a game's own hero files are served at \`/games/<id>/_landing/<file>\` (\`wide.jpg\`, \`tall.jpg\`, \`wide.mp4\`, \`tall.mp4\`) if a page of yours needs one by address (\`/api/games\` says each exactly, in \`landing.hero\`). |
| \`public/\` | Files served as they are, at the same path (\`public/fonts/x.woff2\` is \`/fonts/x.woff2\`). A \`robots.txt\`, \`sitemap.xml\` or \`llms.txt\` here replaces the one the site makes. |

\`src/worker.mjs\` and \`migrations/\` are the Worker (its config is \`wrangler.jsonc\`, at the studio's root); \`dist/\` is the build (not committed).
`;

const GITIGNORE = `node_modules/
site/src/runtime/
site/src/tools/
# This computer's own state: the site's workers.dev address (it names the Cloudflare account, often after its owner).
.studio/
# This person's own Claude Code settings for this studio (the status line, for one).
.claude/settings.local.json
site/dist/
site/.wrangler/
.wrangler/
.dev.vars
.env
# Stripe Projects (setup --via stripe-projects): credentials stay in its vault and the .env files it syncs, never in git.
.env.*
.projects/vault/
.projects/cache/
*.log
# Port checks: receipts and screenshots of each run (games/<id>/.port/check-*/).
games/*/.port/
# Screenshots from check and look runs.
.checks/
# Performance runs (homie-studio perf, the perf skill): numbers, screenshots and CPU profiles of each run.
.perf/
# Large media lives in this studio's storage (R2, after storage add: media move) or is served by the site; the manifests beside it (which name each file's R2 copy) are committed.
# Working files of the music and video skills (frames, captures, provider answers) stay on this computer.
music/**/work/
videos/**/work/
music/**/*.wav
music/**/*.mp3
music/**/*.flac
videos/**/*.mp4
videos/**/*.mov
videos/**/*.webm
# 3D: raw provider output, high-poly sources and Blender files stay on this computer (or the studio's R2): never shipped, never committed. The phone-sized model in games/<id>/public/models/ is committed.
art/**/raw/
*.blend
*.blend1
*.fbx
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
    devDependencies: { '@homie-rocks/studio': packageSpec(homie), typescript: TYPESCRIPT_VERSION, wrangler: WRANGLER_VERSION },
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
    'HANDOFF.md': HANDOFF_MD,
    'studio.json': `${JSON.stringify(studio, null, 2)}\n`,
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
    '.gitignore': GITIGNORE,
    'apps/README.md': 'One folder per app: app.json, index.html and src/. One transforming screen, its roles and its parts. Start with `npx --no-install homie-studio app new <id>`. The app guide explains lasting records, staff sign-in, LAN preview and standalone builds.\n',
    'games/README.md': 'One folder per game. A new studio has none (its home page says "First game coming soon"). Start one with `npx --no-install homie-studio game new <id> --from gem-rush` when the person asks for a copy of the starter, or once their game is planned.\n',
    'music/README.md': 'Songs, game scores, loops and stems, one folder each (`music/<slug>/`). `manifest.json` lists them (`node_modules/@homie-rocks/studio/media/MEDIA.md`); a published entry gets a page at `/music/<slug>/`. Without storage the site serves files up to 25 MiB itself. With storage (`npx --no-install homie-studio storage add`), the big ones live in the studio\'s R2: `npx --no-install homie-studio media move` and every deploy put them there, checked by SHA-256, at the same address. Never into git.\n',
    'music/manifest.json': '{ "v": 1, "items": [] }\n',
    'videos/README.md': 'Trailers, music videos and cutscenes, one folder each (`videos/<slug>/`). `manifest.json` lists them (`node_modules/@homie-rocks/studio/media/MEDIA.md`); a published entry gets a page at `/videos/<slug>/`. Without storage the site serves files up to 25 MiB itself. With storage (`npx --no-install homie-studio storage add`), the big ones live in the studio\'s R2: `npx --no-install homie-studio media move` and every deploy put them there, checked by SHA-256, at the same address. Never into git.\n',
    'videos/manifest.json': '{ "v": 1, "items": [] }\n',
    'posts/README.md': POSTS_README,
    'site/theme.json': themeFile(slug),
    'site/README.md': SITE_README,
    'site/src/worker.mjs': `// This studio's site: pages, public rooms (Table + Lobby Durable Objects), D1, and R2 once storage is added.
// The code is @homie-rocks/studio's, pinned in package.json, so an update never changes a published game by surprise.
import { hostRules, useTools } from '@homie-rocks/studio/worker';
// The rules of this studio's games that run on the server (written by homie-studio build; empty until a game has some).
import rules from './rules/index.mjs';

hostRules(rules);
useTools(async () => (await import('./tools/index.mjs')).default);
export { default, Table, Lobby } from '@homie-rocks/studio/worker';
`,
    'site/src/rules/index.mjs': rulesIndex([]),
    'site/migrations/0001_studio.sql': MIGRATION,
    [`site/migrations/${STATS_MIGRATION_FILE}`]: STATS_MIGRATION,
    [`site/migrations/${PLAYERS_MIGRATION_FILE}`]: PLAYERS_MIGRATION,
    [`site/migrations/${OFFICE_MIGRATION_FILE}`]: OFFICE_MIGRATION,
    [`site/migrations/${SERVERS_MIGRATION_FILE}`]: SERVERS_MIGRATION,
    [`site/migrations/${CHAT_MIGRATION_FILE}`]: CHAT_MIGRATION,
    [`site/migrations/${SHOP_MIGRATION_FILE}`]: SHOP_MIGRATION,
    [`site/migrations/${PURCHASE_MIGRATION_FILE}`]: PURCHASE_MIGRATION,
    [`site/migrations/${PURCHASE_STATE_FILE}`]: PURCHASE_STATE,
    [`site/migrations/${SHOP_RESERVATIONS_FILE}`]: SHOP_RESERVATIONS,
    [`site/migrations/${SHOP_STATEMENTS_FILE}`]: SHOP_STATEMENTS,
    [`site/migrations/${SHOP_LINES_FILE}`]: SHOP_LINES,
    [`site/migrations/${APPS_MIGRATION_FILE}`]: APPS_MIGRATION,
    [`site/migrations/${MCP_MIGRATION_FILE}`]: MCP_MIGRATION,
    [`site/migrations/${FUNCTIONS_MIGRATION_FILE}`]: FUNCTIONS_MIGRATION,
    [`site/migrations/${FUNCTIONS_CURSOR_MIGRATION_FILE}`]: FUNCTIONS_CURSOR_MIGRATION,
    [`site/migrations/${LOUNGE_MIGRATION_FILE}`]: LOUNGE_MIGRATION,
    'wrangler.jsonc': wranglerConfig({ worker, name, d1: studio.cloudflare.d1, r2: studio.cloudflare.r2, layout: 'root' }),
    '.claude/skills/.gitkeep': '',
  };
  if (template) {
    // No game: a new studio goes live with its own Home ("first game coming soon"), and a band there that connects
    // it to the Claude chat that set it up (`setup attach` removes the band once Claude works in the studio). A
    // starter is copied in only when the person asks for one (`homie-studio game new`).
    files['site/partials/home.html'] = CONNECT_BAND;
  }
  return files;
}

/** The template's first-run band on Home: one link that connects this studio to the chat that set it up. */
export const CONNECT_BAND = `<!-- A new studio from the Homie template. This band goes away once a chat works in the studio
     (homie-studio setup attach removes it); delete it by hand any time. -->
<div class="band-in" style="text-align:center">
  <p class="kicker">New studio</p>
  <h2>{{studio.name}} is live</h2>
  <p>It runs on your own Cloudflare account. Connect it to the chat that set it up, and that chat takes it from here.</p>
  <p><a class="btn" href="/_studio/connect">Connect this chat</a></p>
</div>
`;

export function templateReadme() {
  return `# A Homie studio

This repository is a game studio made with [Homie](https://homie.rocks): its games, music, videos and posts,
and a site with public multiplayer rooms that runs on **your own Cloudflare account**, on the free plan.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/homie-rocks/homie/tree/main/template)

The button copies this studio into your GitHub, creates its Worker, database and rooms on your Cloudflare, and
deploys it with Workers Builds: every push to \`main\` goes live, and every other branch gets its own Preview.
The site goes live at once with its own home page ("first game coming soon"); the games come next.

Then open the site and tap **Connect this chat**, or ask Claude, Codex or Grok (with the Homie connector,
https://homie.rocks/mcp) to set up your studio: it makes games, songs and videos here, in a pull request you merge
with one tap. Grok has no Cloudflare connector. Approving Cloudflare in the browser is still your step.

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
 * A studio made before 0.13.0 has no back-office migration (worker/office.mjs): add it, so the next
 * `d1 migrations apply` makes its tables. Returns the file it wrote, or null when it was there.
 */
export function ensureOfficeMigration(root) {
  const file = join(root, 'site', 'migrations', OFFICE_MIGRATION_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, OFFICE_MIGRATION);
  return `site/migrations/${OFFICE_MIGRATION_FILE}`;
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

/**
 * A studio made before 0.16.0 has no servers migration (worker/servers.mjs: servers, members, agent passes): add
 * it, so the next `d1 migrations apply` makes its tables. It needs the office's (0005) before it: its last line
 * gives office_invites a `server`. Returns the file it wrote, or null when it was there.
 */
export function ensureServersMigration(root) {
  const file = join(root, 'site', 'migrations', SERVERS_MIGRATION_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SERVERS_MIGRATION);
  return `site/migrations/${SERVERS_MIGRATION_FILE}`;
}

/**
 * A studio made before 0.24.0 has no shop migration (worker/shop-store.mjs: orders, entitlements, the age band,
 * referral lines): add it, so the next `d1 migrations apply` makes its tables. A studio with no shop.json keeps
 * them empty. Returns the file it wrote, or null when it was there.
 */
export function ensureShopMigration(root) {
  const file = join(root, 'site', 'migrations', SHOP_MIGRATION_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SHOP_MIGRATION);
  return `site/migrations/${SHOP_MIGRATION_FILE}`;
}

function ensureShopReservations(root) {
  const file = join(root, 'site', 'migrations', SHOP_RESERVATIONS_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SHOP_RESERVATIONS);
  return `site/migrations/${SHOP_RESERVATIONS_FILE}`;
}

function ensureShopStatements(root) {
  const file = join(root, 'site', 'migrations', SHOP_STATEMENTS_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SHOP_STATEMENTS);
  return `site/migrations/${SHOP_STATEMENTS_FILE}`;
}

function ensureShopLines(root) {
  const file = join(root, 'site', 'migrations', SHOP_LINES_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SHOP_LINES);
  return `site/migrations/${SHOP_LINES_FILE}`;
}

/** Every migration the template owns that this studio lacks, added: the files written (deploy and dev say so). */
/** A studio made before 0.23.0 has no room chat tables: the owner's chat rules and players' reports. */
function ensureChatMigration(root) {
  const file = join(root, 'site', 'migrations', CHAT_MIGRATION_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, CHAT_MIGRATION);
  return `site/migrations/${CHAT_MIGRATION_FILE}`;
}

/** A studio made before 0.29.0 has no Lounge tables: kept chat (only when an owner turns history on), play nights, moderators. */
function ensureLoungeMigration(root) {
  const file = join(root, 'site', 'migrations', LOUNGE_MIGRATION_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, LOUNGE_MIGRATION);
  return `site/migrations/${LOUNGE_MIGRATION_FILE}`;
}

function ensureAppsMigration(root) {
  const file = join(root, 'site', 'migrations', APPS_MIGRATION_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, APPS_MIGRATION);
  return `site/migrations/${APPS_MIGRATION_FILE}`;
}
export function ensurePartsMigration(root) {
  const file = join(root, 'site', 'migrations', PURCHASE_MIGRATION_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, PURCHASE_MIGRATION);
  return `site/migrations/${PURCHASE_MIGRATION_FILE}`;
}

function ensurePartsStateMigration(root) {
  const file = join(root, 'site', 'migrations', PURCHASE_STATE_FILE);
  if (existsSync(file)) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, PURCHASE_STATE);
  return `site/migrations/${PURCHASE_STATE_FILE}`;
}

function ensureFunctionCursors(root) {
  const file=join(root,'site','migrations',FUNCTIONS_CURSOR_MIGRATION_FILE);
  if(existsSync(file))return null;
  mkdirSync(dirname(file),{recursive:true});writeFileSync(file,FUNCTIONS_CURSOR_MIGRATION);return `site/migrations/${FUNCTIONS_CURSOR_MIGRATION_FILE}`;
}
function ensureFunctionsMigration(root) {
  const file=join(root,'site','migrations',FUNCTIONS_MIGRATION_FILE);
  if(existsSync(file))return null;
  mkdirSync(dirname(file),{recursive:true});writeFileSync(file,FUNCTIONS_MIGRATION);return `site/migrations/${FUNCTIONS_MIGRATION_FILE}`;
}
function ensureMcpMigration(root) {
  const file=join(root,'site','migrations',MCP_MIGRATION_FILE);
  if(existsSync(file))return null;
  mkdirSync(dirname(file),{recursive:true});writeFileSync(file,MCP_MIGRATION);return `site/migrations/${MCP_MIGRATION_FILE}`;
}
export function ensureMigrations(root) {
  return [ensureStatsMigration(root), ensurePlayersMigration(root), ensureOfficeMigration(root), ensureServersMigration(root), ensureChatMigration(root), ensureShopMigration(root), ensureLoungeMigration(root), ensureShopReservations(root), ensureShopStatements(root), ensureShopLines(root), ensureAppsMigration(root), ensurePartsMigration(root), ensurePartsStateMigration(root), ensureMcpMigration(root), ensureFunctionsMigration(root), ensureFunctionCursors(root)].filter(Boolean);
}

/** What a migration file the template added is for, in a few words (deploy and dev say it). */
export function migrationWord(file) {
  return /studio_mcp/.test(file) ? 'AI connections and tool call history' : /studio_apps/.test(file) ? 'apps: lasting records and signed-in role grants' : /lounge/.test(file) ? 'the Lounge and kept chat: play nights, moderators, and what was said only where an owner turns history on' : /shop/.test(file) ? 'the shop: orders, what players own, refunds and referral books (paid sales wait until shop.json and the studio\'s Stripe connection are ready)' : /players/.test(file) ? 'player accounts and cloud saves' : /chat/.test(file) ? 'room chat: the owner\'s chat rules and players\' reports (never the chat itself)' : /servers/.test(file) ? 'servers and agent seats: room pools with their own rules, AI passes' : /office/.test(file) ? 'the back office: launch states, invites, the owner\'s controls' : 'the studio\'s own stats: counts, never tracks';
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
    'read the game skill and RULES.md; choose sensible defaults and make the requested game as server rules plus view',
    'optional live example, without copying a game here: npx --no-install homie-studio demo',
    'only when the person asks for a game: start from a rules starter and implement the requested mechanic: npx --no-install homie-studio game new <id> --from gem-rush --name "<Game Name>"',
    'npm run dev   (the home page, "first game coming soon", at http://127.0.0.1:8787/; with a game: npx --no-install homie-studio check <id> --url http://127.0.0.1:8787)',
    'when the owner asks to publish: npm run deploy   (then studio_publish, or: npx --no-install homie-studio publish)',
  ], online: 'Going online creates one Worker, one D1 database and two Durable Objects on your own Cloudflare account: free plan, no payment method, no R2. `npx --no-install homie-studio deploy --plan` says exactly what, and changes nothing.' };
}

export const _test = { relative };
