/**
 * `homie-studio new <folder> --name "<Studio Name>"` — a studio is ONE
 * monorepo: a visible folder the person opens in Claude or Codex.
 *
 *   AGENTS.md            what this studio is and how to work in it (both apps)
 *   CLAUDE.md            imports AGENTS.md (Claude Code's documented way to share it)
 *   studio.json          the studio's name, slug, and its Cloudflare resources
 *   package.json         @homie-rocks/studio and wrangler, pinned
 *   games/<id>/          one folder per game (game.json, index.html, src/)
 *   music/ videos/       manifests in the repo; the big files live in the studio's R2
 *   posts/               words the studio publishes
 *   site/                the studio's Worker (pages, rooms), its D1 migrations
 *   .claude/skills/      skills only this studio uses
 *
 * It writes only into a folder that is new or empty, never guesses one, and
 * lists every file it writes, so the person sees exactly what changed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { STUDIO_VERSION, packageSpec } from './version.mjs';

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
// fills in the D1 id, and drops the R2 binding when the account has no R2).
${JSON.stringify(config, null, 2)}
`;
}

function agentsMd({ name, slug }) {
  return `# ${name}

This folder is a game studio: **${name}** (\`${slug}\`). It is one repository.
Its games, music, videos and posts live here; its website and public game rooms
run on the studio's **own Cloudflare account** (a Worker, D1, R2, and the
Table/Lobby Durable Objects), built from \`@homie-rocks/studio\`, pinned in
\`package.json\`. The homie.rocks directory lists its games; homie.rocks does
not host them.

## Layout

| Path | What it is |
| --- | --- |
| \`games/<id>/\` | One game: \`game.json\` (id, name, blurb, players, round length), \`index.html\`, \`src/main.ts\`. |
| \`music/\`, \`videos/\` | \`manifest.json\` lists each file and its R2 key. Large files go to R2 (\`npx --no-install homie-studio media put <file>\`), never into git. |
| \`posts/\` | Markdown the studio publishes. |
| \`site/\` | The studio's Worker (\`src/worker.mjs\`), D1 migrations, \`wrangler.jsonc\`. |
| \`studio.json\` | The studio's name, slug and Cloudflare resource names. |
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
- \`npx --no-install homie-studio check <id> --url <site>\` — two headless browsers press Play and must
  land in the same room and finish a round. Run it before you say a game works.
- \`npm run deploy\` — the site on this studio's Cloudflare (Workers, D1, R2).
  If Wrangler is not signed in, run \`npx wrangler login\`: the person approves once in
  their browser. It never overwrites a Worker or database this studio did not create.
- \`npx --no-install homie-studio publish\` — list this studio's games in the homie.rocks directory
  (or call the Homie MCP tool \`studio_publish\`).

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
- Nothing in this studio needs \`~/.homie\` or a Homie box.
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

const GITIGNORE = `node_modules/
site/dist/
site/.wrangler/
.wrangler/
.dev.vars
.env
*.log
# Port checks: receipts and screenshots of each run (games/<id>/.port/check-*/).
games/*/.port/
# Large media lives in this studio's R2; the manifests beside it are committed.
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
    cloudflare: { worker, d1: `${slug}-db`, r2: `${slug}-media`, accountId: null, url: null, created: [] },
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
    'music/README.md': 'Songs and stems. `manifest.json` lists them; the files themselves go to R2 with `npx --no-install homie-studio media put`.\n',
    'music/manifest.json': '{ "items": [] }\n',
    'videos/README.md': 'Trailers and clips. `manifest.json` lists them; the files themselves go to R2 with `npx --no-install homie-studio media put`.\n',
    'videos/manifest.json': '{ "items": [] }\n',
    'posts/README.md': 'Markdown posts this studio publishes, one file each.\n',
    'site/src/worker.mjs': `// This studio's site: pages, public rooms (Table + Lobby Durable Objects), D1 and R2.
// The code is @homie-rocks/studio's, pinned in package.json, so an update never changes a published game by surprise.
export { default, Table, Lobby } from '@homie-rocks/studio/worker';
`,
    'site/migrations/0001_studio.sql': MIGRATION,
    'site/wrangler.jsonc': wranglerConfig({ worker, name, d1: studio.cloudflare.d1, r2: studio.cloudflare.r2 }),
    '.claude/skills/.gitkeep': '',
  };
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
  ] };
}

export const _test = { relative };
