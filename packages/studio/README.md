# @homie-rocks/studio

A studio for games, music and video on its own Cloudflare. One repository (`AGENTS.md`,
`games/`, `music/`, `videos/`, `posts/`, `site/`), multiplayer games on the Homie netplay
contract (every browser renders, strangers meet in public rooms, bots fill seats, rounds
restart), and a site Worker with Table/Lobby Durable Objects and D1 that the studio deploys
to its own Cloudflare account with Wrangler. The homie.rocks directory lists the games.

Most people never run this by hand: the Homie plugin for Claude Code and Codex does,
and the person approves Cloudflare once in their browser.

```sh
npx -y @homie-rocks/studio new ./night-owls --name "Night Owls"
cd night-owls && npm install
npx homie-studio game new crown-thief --from gem-rush --name "Crown Thief"
npx homie-studio dev                                   # the whole site locally
npx homie-studio check crown-thief --url http://127.0.0.1:8787
npx homie-studio deploy --plan                         # what deploy will create, and what it costs; changes nothing
npx homie-studio deploy                                # the studio's own Cloudflare
npx homie-studio publish                               # the homie.rocks directory
npx homie-studio stats                                 # the studio's own numbers, for its owner
npx homie-studio upgrade                               # what a newer template adds to this studio (--apply to take it)
```

## From GitHub, with Cloudflare's own CI (Workers Builds, Previews, Deploy to Cloudflare)

A studio keeps `wrangler.jsonc` at its root (a studio made before 0.10.0 keeps `site/wrangler.jsonc`, and every
command still finds it), so Cloudflare's Workers Builds can build and deploy it from its GitHub repository with no
computer involved:

| Workers Builds runs | On | What happens |
| --- | --- | --- |
| `npm run build` | every push | `homie-studio build`: the site, with the commit it is built from |
| `npm run deploy` | the production branch | In Workers Builds (`WORKERS_CI=1`), `homie-studio deploy` only applies the D1 migrations (by binding name) and deploys: the Worker and database are Cloudflare's to make, so it creates and refuses nothing. The first deploy creates the database as it goes. |
| `npx wrangler preview` | every other branch | A **Preview**: its own URL, and its own Durable Object namespace, so a branch's public rooms never meet production's. A Preview has no D1: it counts nothing into the studio's stats and never claims itself in the directory. |

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/homie-rocks/homie/tree/main/template)

The button copies the public template (`template/` in this repository, exactly what `homie-studio new --template`
writes) into the person's GitHub, makes the Worker, the D1 database and the rooms on their Cloudflare account,
and connects Workers Builds. The site plays its first game (Gem Rush) the moment it is up, and its Home has a
**Connect to Claude** band: one tap links it to the Claude chat that set it up (the Homie MCP tool `studio_setup`).
In the Claude Code session that works in the repository, `homie-studio setup attach <hs_…>` then gives the studio
the name chosen in the chat and removes the band.

**The site claims itself in the directory.** The homie.rocks directory lists a studio only when its site serves
the claim the directory handed out for that address. From 0.10.0 the site asks for it the first time its
`/.well-known/homie-studio.json` is read (by `studio_publish`, or by `deploy` reading it once) and keeps it in
its D1; nothing is stored by hand. studio.json `homie.directory: false` keeps a studio out.

## The site: the hub's shape, and a landing for every game

Every studio site has the same sections as homie.rocks, in the studio's own look (`site/theme.json`): Home (the
featured game, live rooms, the latest posts), Games, Music, Videos, Rooms (every public room playing now,
joinable) and Posts (`posts/*.md`, with Atom and JSON feeds). A section with nothing in it has no tab, and its
page answers 404. Every game gets a landing at `/<game>/`: a full-bleed hero from its own footage or art, the
pitch, a big Play button into a public room, how to play on a phone, a computer and a TV (with the join code),
live rooms, credits (the original and its licence for a port), and "Make a game like this". Every page ends with
"Made with Homie". Anything the studio puts in `site/` wins: a whole page, a partial, its tokens, its CSS, its
files. `site/SITE.md` says all of it.

The play page writes its room into the address, and a small room button at the edge shares it: Invite, Big
screen and the room code. game.json's `screen.share` puts it where each game has room, per device (a corner or
the top's middle, moved in by `x` / `y`, or kept a small icon), so it never covers a scoreboard. A game whose
picture is white or cream gets a light landing (`landing.scheme: "light"`). Every card and the directory show a
game's landing still. Every HTML answer is `no-transform`, and the site's pages are never framed by another
site. A game made with Homie's arcade controls that knocks for a Homie box (`/__homie/call`) is told
`not-a-homie`, at the site's root as under the game.

## Upgrading a studio

A studio pins one version, so nothing changes until it asks. To take a newer one:

```sh
npx -y --package=https://homie.rocks/npm/homie-studio-0.9.0.tgz homie-studio upgrade          # the plan; changes nothing
npx -y --package=https://homie.rocks/npm/homie-studio-0.9.0.tgz homie-studio upgrade --apply  # after the person agrees
npm install && npm run build
```

`upgrade` compares the studio with what this version's `new` would write for it: an AGENTS.md section, a README,
a `.gitignore` line, a D1 migration or a package.json script it lacks is added, and one it never changed since an
older template wrote it (`lib/template-history.json` knows every earlier version's text by a fingerprint) takes
the newer text. Anything the studio changed or wrote itself is kept as it is: the plan lists it, and `--diff`
shows how it differs from the template. `--apply` also pins this version in package.json and sets studio.json's
`homie.studio`. When the template's words change, `node scripts/studio-template-history.mjs` records them (a test
fails until it has).

## Rooms of up to 32

Every room of a game has the seats its netplay manifest names: game.json's `netplay`
block (`maxPlayers`), or a `netplay.json` beside game.json or in the game's build
(`maxPlayers` or `players.max`), else game.json's `players.max`, else 8; at most 32.
Bots, a late joiner taking a bot's body and a new host after the old one leaves work
the same at 32 as at 4. One address may hold every seat plus four sockets, so a party
on one Wi-Fi (or strangers behind one carrier's address) fills a room with a TV beside it.

## The studio's own stats

The site counts, and never tracks: pages opened, Play presses, rooms opened, the most
people playing at once, rounds finished, songs played, videos watched, and which site
sent each visitor (a host name: homie.rocks, another studio, search, the web, or a
`?via=` tag). They are daily counters in the studio's own D1, on the free plan (a write
per visit and per round, never per frame), with no cookie on a visitor and nothing sent
to anyone. Prefetches, crawlers and house QA are not counted. Only the owner reads them:

```sh
npx homie-studio stats [--range 7d] [--game crown-thief]   # prints them
npx homie-studio stats link                             # a one-time link: /_studio/stats in the owner's browser
npx homie-studio stats key                              # a 1-hour read key for the Homie MCP tool studio_stats
npx homie-studio stats share on                         # tell the directory "played this week" (two numbers)
```

Each key is minted on the owner's computer; only its SHA-256 goes into D1, through the
studio's own Cloudflare login. `worker/stats.mjs` says exactly what is counted.

## A build the person can watch (the progress feed)

A build of a game, song or video can keep a small progress feed, so the person follows it
from wherever they are (the Claude app on a phone, through the Homie MCP's build progress
card), sees each check go green, what it spent against its budget, and can press Stop:

```sh
npx homie-studio progress start crown-thief --share --title "Crown Thief: faster rounds" --budget 2
npx homie-studio progress stage plan done --note "Rounds from 60 s to 45 s"
npm run build && npx homie-studio check crown-thief --url http://127.0.0.1:8787 && npm run deploy
```

While a feed is open, `build`, `check`, `port check` and `deploy` report into it by
themselves: their stage (a game: plan → build → checks → deploy), each check as it runs
and passes, a small picture of the game and the address to play it; a deploy with every
check green ends the build. The AI marks what only it knows with `progress stage`,
`progress check`, `progress spend`, `progress shot` (a video's shots) and `progress song`
(a song's waveform and lyric check). Before each stage starts, and every few seconds while
one runs, a shared feed asks whether Stop was pressed; a stopped command closes its
browsers and says so, and nothing already built or deployed is undone.

**From the Claude app.** The chat can open the build first (the Homie MCP tool `build_open`, or the "Build it"
card on a make, port or remix) and hand the work to a Claude Code session with a prefilled prompt. The session
takes the build once, with no key in the prompt, and the card follows it; the change goes out as a pull request
the person merges with one tap:

```sh
npx homie-studio progress attach hb_…                  # this session takes the build the chat opened (once)
npx homie-studio progress change "Crowns spawn twice as often"   # its mark, in changes/, committed with the change
git switch -c faster-crowns && git add -A && git commit -m "Faster crowns" && git push -u origin HEAD
gh pr create --fill                                     # then:
npx homie-studio progress pr --url https://github.com/<owner>/<repo>/pull/<n>
```

Workers Builds deploys the branch as a Preview; the card's **Publish** opens the pull request in GitHub, where the
person's merge is the approval; Workers Builds deploys `main`, and the card says **Live** when the live site's
manifest lists the change's mark (`homie-studio build` lists the newest marks from `changes/`).

A Claude Code cloud session's default network ("Trusted") does not reach homie.rocks; the toolkit says so, and
names the setting (the environment's Network access: Custom, add homie.rocks), instead of "did not answer". The
build goes on with its local feed.

The feed is `.studio/progress/<build>.json` (git-ignored). With `--share` the studio's
directory (studio.json `homie.directory`, homie.rocks by default) keeps a copy for 24
hours so the Claude app can show it: the feed only (plain bounded text, pictures under
96 KB), never a key, a path or code. Its write key stays in `.studio/progress/` and is
never printed; the shared id is printed for the MCP tool `build_progress`. Without an open
feed every command behaves exactly as before. `lib/progress.mjs` has the whole format.

## The site's address

`deploy` keeps the `workers.dev` address in `.studio/local.json`, which git ignores: it
names the Cloudflare account, often after its owner. A custom domain goes in studio.json
as `cloudflare.domain` and is what the directory claim, `publish`, `check` and `stats` use.

## Checks on a computer without a GPU

`check`, `port check` and `look` run Chrome headless. On a Mac they use its GPU. On Linux (a Claude Code cloud
session, GitHub Actions, a container) `npx homie-studio chrome install` puts Chrome for Testing in
the home folder's `.cache/homie-studio` (from storage.googleapis.com, which a cloud session's default network reaches), and WebGL
renders with SwiftShader. `check` reports how fast each browser drew the game and on what renderer; on SwiftShader
it says the frame rate is not a person's, and judges only seats, rooms and rounds.

## No payment method needed

`deploy` creates only what Cloudflare's free Workers plan gives a new account with no
payment method: one Worker, one D1 database and two SQLite-backed Durable Objects
(`Table`, `Lobby`). It never creates or binds R2. A brand-new Cloudflare account verifies
its email address before it can run a Worker; a missing `workers.dev` subdomain is
registered by Wrangler when Claude Code or Codex runs the deploy.

Storage for large media (songs, videos, big art) is a separate, optional step:

```sh
npx homie-studio storage add                           # an R2 bucket, bound as MEDIA, served at /media/<key>
npx homie-studio deploy
npx homie-studio media put music/theme.wav
```

Cloudflare asks for a payment method on the account before R2 works, even inside R2's free
tier (10 GB-month of storage, 1 million writes and 10 million reads a month), so `storage add`
refuses with the dashboard link until the account has R2 turned on, and creates nothing.
The free plan's daily limits (100,000 Worker requests; D1 5 million rows read and 100,000
written) reset at 00:00 UTC; past them requests fail until the reset and nothing is charged.

An existing single-player web game becomes a multiplayer one with the port toolkit
(the plugin's `port` skill drives it):

```sh
npx homie-studio port plan ../my-game                  # grade it: easy, medium, hard or not a fit, and why
npx homie-studio port import ../my-game --id my-game   # bring it into games/ (static, bundle or its own build)
npx homie-studio port check my-game --url http://127.0.0.1:8787   # the owner tests, real touch, host kill, late joiner, a round
```

| Path | What it is |
| --- | --- |
| `bin/homie-studio.mjs` | The CLI. |
| `lib/scaffold.mjs` | `new`: the studio monorepo, only into a new or empty folder, every file listed. |
| `lib/build.mjs` | `build`: games bundled with esbuild into `site/dist`, `games.json`, each game's shared `source.json`. |
| `lib/cloudflare.mjs` | `deploy` (and `deploy --plan`): Wrangler, D1, migrations; refuses resources it did not create. In Workers Builds, migrations and deploy only. `storage add`: the optional R2 bucket. |
| `lib/check.mjs` | `check`: two fresh Chrome processes (computer + phone) must share a room and finish a round with both in it, with each one's frame rate; on a busy computer it waits out a round a browser was dropped from, and says why when none counts. `lib/chrome.mjs`: which Chrome, and how (the GPU on a Mac, SwiftShader on Linux). |
| `lib/upgrade.mjs`, `lib/template-history.json` | `upgrade`: an existing studio takes what a newer template adds, never over its own edits. |
| `lib/progress.mjs`, `lib/setup.mjs` | The progress feed (`progress …`), a build the chat opened (`progress attach`), a change as a pull request (`progress change`, `progress pr`), and `setup attach`. |
| `template/` (repository root), `scripts/template.mjs` | The public "Deploy to Cloudflare" template, generated from `new --template`. |
| `lib/port.mjs` | `port plan` (reads a game and grades the port) and `port import`. |
| `lib/port-check.mjs` | `port check`: held and alternating directions on keys, Android Chrome and iPhone WebKit touch, UI cover, two browsers finishing a round, a killed host, a late joiner, the big screen. |
| `port/` | The port toolkit (`@homie-rocks/studio/port`, or `window.HomiePort` from `homie-port.js` in a static game): `createRoom`, the touch kit, keys, camera rules, bots, a HUD, sandbox shims, first-touch audio, `exposePort`. |
| `worker/index.mjs` | The site Worker and the `Table` (netplay relay, `room.mjs`) and `Lobby` Durable Objects; `/<game>/tv` is the big screen with a join QR (`qr.mjs`); `/music/<slug>/` and `/videos/<slug>/` are song and video pages (their files served with byte ranges, from the site or from storage at `/media/<key>`). `seats.mjs`: room sizes (up to 32). |
| `worker/site.mjs`, `lib/site.mjs`, `lib/markdown.mjs`, `site/SITE.md` | The site: its sections, each game's landing, posts and their feeds, the look (theme tokens) and what the studio's `site/` folder overrides; the safe markdown posts are written in. `worker/pages.mjs`: the play page. |
| `worker/stats.mjs`, `worker/stats-page.mjs`, `lib/stats.mjs` | The studio's own stats: what is counted and how, the owner-only `/api/stats` and `/_studio/stats`, and `homie-studio stats`. |
| `lib/media.mjs`, `media/MEDIA.md` | The `music/` and `videos/` manifests: which entries get a page, and where each file's bytes come from (the site itself up to 25 MiB a file, the studio's storage, or a link). `media list` shows it; `media put` uploads a file to storage and records its key. |
| `netplay/` | The netplay contract (`NETPLAY.md`) and its game helper (`@homie-rocks/studio/netplay`). |
| `starters/gem-rush/` | The reference multiplayer starter. |

Versions are immutable: a published version never changes, so a studio that pinned one
never changes by surprise. A change ships as a new `version` on the npm registry as
`@homie-rocks/studio`, which is what `homie-studio new` pins (the exact version; package-lock.json keeps its
integrity). The registry is what Workers Builds and a Claude Code cloud session reach by default. Older studios
pinned a tarball at `https://homie.rocks/npm/homie-studio-<version>.tgz`, which stays.

## Beta

This is a beta. Bugs, port requests and questions go to
<https://github.com/homie-rocks/homie/issues/new/choose>.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
