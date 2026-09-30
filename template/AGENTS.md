# My Studio

This folder is a studio: **My Studio** (`my-studio`). It is one repository.
Its games, music, videos and posts live here; its website and public game rooms
run on the studio's **own Cloudflare account** (one Worker, one D1 database and
the Table/Lobby Durable Objects, all on Cloudflare's free Workers plan), built
from `@homie-rocks/studio`, pinned in `package.json`. The homie.rocks
directory lists its games; homie.rocks does not host them.

## Layout

| Path | What it is |
| --- | --- |
| `games/<id>/` | One game: `game.json` (id, name, blurb, players, round length), `index.html`, `src/main.ts`. |
| `music/`, `videos/` | Songs, scores, loops; trailers, music videos, cutscenes. `manifest.json` lists each one (`node_modules/@homie-rocks/studio/media/MEDIA.md`); a published entry gets a page at `/music/<slug>/` or `/videos/<slug>/`, served from the site itself (files up to 25 MiB) or, for larger media, from the studio's storage once it has storage (see below; `npx --no-install homie-studio media put <file>`). Large files never go into git. The Homie plugin's `music` and `video` skills make them. |
| `posts/` | The studio's news and drops: one markdown file each (`posts/2026-09-30-we-are-live.md`: `title:`, `date:`, `summary:`, and `game:` / `song:` / `video:` to link one). They are the site's Posts, with Atom and JSON feeds. |
| `site/` | The studio's site: its look (`theme.json`), and anything of its own that wins over the generated pages (`site/README.md`); the Worker (`src/worker.mjs`) and its D1 migrations. |
| `wrangler.jsonc` | The Worker's Cloudflare config (the Worker, D1, the Table and Lobby Durable Objects, and `previews` for branch Previews). It sits at the root, where Cloudflare's Workers Builds reads it. |
| `changes/` | One small file per change that went out through a pull request (`homie-studio progress pr` writes it): the site lists the newest, so the Claude app can tell when a merged change is live. |
| `studio.json` | The studio's name, slug, Cloudflare resource names, custom domain and stats sharing. `.studio/` (git-ignored) is this computer's own state. |
| `.claude/skills/` | Skills only this studio uses. Homie's own skills come from the Homie plugin. |

## Commands (all through the pinned CLI in node_modules)

Use `npm run <script>` or `npx --no-install homie-studio <command>`: `--no-install` makes sure it is this
studio's pinned copy, never a registry lookup of the bare name.

- `npx --no-install homie-studio game new <id> --from gem-rush --name "<Name>"` — a new game from a
  multiplayer starter (one live public room from its first build, bots fill seats).
- `npx --no-install homie-studio port plan <folder>` — read an existing single-player web game and grade
  how hard making it multiplayer will be; `port import` brings it into `games/`, `port check` runs the
  owner tests (real touch, a late joiner, a killed host, two browsers finishing a round). The Homie
  plugin's `port` skill does the whole job.
- `npm run build` — bundle every game into `site/dist`.
- `npm run dev` — the whole site locally (pages, the netplay relay in a local
  Durable Object, D1): open the printed address in two browsers and they share a room.
  Stop it with `npx --no-install homie-studio dev --stop` (this studio's dev server only;
  never `pkill` by name, which stops other projects' dev servers too).
- `npx --no-install homie-studio check <id> --url <site>` — two headless browsers press Play and must
  land in the same room and finish a round. Run it before you say a game works.
- `npx --no-install homie-studio deploy --plan` — says what deploy will create on Cloudflare and what it
  costs, and changes nothing. Tell the person before the first deploy.
- `npm run deploy` — the site on this studio's Cloudflare: one Worker, one D1 database, two
  SQLite-backed Durable Objects, all on the free Workers plan (no payment method needed).
  If Wrangler is not signed in, run `npx wrangler login`: the person approves once in
  their browser. It never overwrites a Worker or database this studio did not create.
- **Workers Builds** (Cloudflare's own CI, set up by the "Deploy to Cloudflare" button or in the dashboard): on
  every push to `main` it runs `npm run build` and `npm run deploy`, which in Workers Builds only applies
  the D1 migrations and deploys (it never creates or refuses anything); on every other branch it runs
  `npm run build` and `npx wrangler preview`, a Preview URL with its own rooms. The live site claims itself
  in the homie.rocks directory the first time it is read, so nothing is stored by hand.
- `npx --no-install homie-studio storage add` — only when the studio needs large media (songs,
  videos): an R2 bucket for `media put`, served at `/media/<key>`. Cloudflare asks for a
  payment method on the account before R2 works (its first 10 GB a month are free), so this
  is a separate step the person agrees to; nothing else needs it.
- `npx --no-install homie-studio publish` — list this studio's games in the homie.rocks directory
  (or call the Homie MCP tool `studio_publish`).
- `npx --no-install homie-studio stats` — the studio's own numbers, for its owner: visits, Play presses,
  rooms, the most people playing at once, rounds, songs played, videos watched, and where visitors came
  from (homie.rocks, other studios, search, the web). `stats link` gives the owner a one-time link to the
  private page `/_studio/stats` in their own browser; `stats key` a short read key for the Homie MCP tool
  `studio_stats` (never paste a key anywhere else). `stats share on` tells the directory two numbers
  (played this week). The site counts and never tracks: no cookie on a visitor, no person identified,
  nothing sent anywhere; house QA and `check` runs are not counted.

## The site

`npm run build` makes the studio's site from what is in this folder
(`node_modules/@homie-rocks/studio/site/SITE.md` says all of it):

- **Sections, like homie.rocks:** Home (the featured game, live rooms, latest posts), Games, Music, Videos,
  Rooms (every public room playing now, joinable) and Posts. A section with nothing in it has no tab, and its
  page is not found.
- **Every game gets a landing** at `/<id>/`: a full-bleed hero from the game's own footage
  (`games/<id>/hero/wide.mp4` and `tall.mp4`, or a trailer in `videos/` with `for.game`), else its cover
  with slow motion; the pitch, a big Play button into a public room, phone / computer / TV with the join code,
  live rooms, how to play, credits, and "Make a game like this". Give it words in game.json's `landing` block
  (`pitch`, `about`, `controls`, `howToPlay`, `credits`) and art with the plugin's `art` and `video` skills.
- **The look** is `site/theme.json` (colours, fonts, corner radius, a logo). Anything in `site/` wins: a whole
  page in `site/pages/`, a piece of every page in `site/partials/`, files in `site/public/`, extra CSS in
  `site/theme.css` (`site/README.md`).
- Every page ends with "Made with Homie", linking to homie.rocks/studio/. Restyle it in `site/theme.css`; keep it.

## Making games

- Every game is multiplayer on the web through the netplay contract
  (`node_modules/@homie-rocks/studio/netplay/NETPLAY.md`): every browser renders the game
  itself, one browser hosts the rules, strangers meet in public rooms, bots fill empty
  seats, anyone arriving takes a bot's place, rounds end and restart on their own.
- Import it as `import { createNetplay } from '@homie-rocks/studio/netplay'`.
- Phones and computers: touch controls on phones only, keys on computers; keep the
  centre of the screen clear during play.
- Change a game in small steps, build, and look at it (`dev`, then `check`).
- A game's id is its URL (`/<id>/`); keep it once published.

## Rules

- Keys stay in the providers' own logins (Wrangler, ElevenLabs, fal) or the OS
  keychain. Never write a key, token or password into this repository.
- Never touch a Cloudflare resource this studio did not create (`studio.json` says which).
- The site's workers.dev address names the Cloudflare account (often after its owner): `deploy` keeps it in
  `.studio/local.json`, which git ignores. Never copy it into a committed file. A custom domain goes in
  studio.json as `cloudflare.domain`.
- A game's room size is its netplay manifest's `maxPlayers` (game.json `netplay`, or netplay.json), up to 32.
- Nothing in this studio needs `~/.homie` or a Homie box.

## Beta

Homie for studios is in beta. When something breaks, or a game you want to port does
not fit, open an issue at https://github.com/homie-rocks/homie/issues/new/choose (a bug,
a port request or a question). Leave keys, tokens and private addresses out of it.
