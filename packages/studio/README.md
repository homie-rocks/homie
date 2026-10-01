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
npx homie-studio office                                 # who is playing now, in every live room (the back office)
npx homie-studio upgrade                               # what a newer template adds to this studio (--apply to take it)
```

A new studio has no game: its home page says "First game coming soon" until the first one is made, and
`homie-studio demo` names a live game on Homie Arcade to try meanwhile. A starter is copied in only when the person
asks (`game new <id> --from gem-rush`, or `--from ember-vale` for a hero who lasts, with cloud saves).

## In one chat: `homie-studio mcp`

```sh
npx -y @homie-rocks/studio mcp --studios "<the folder the studios live in>"   # the toolkit as a local MCP server (stdio)
```

The toolkit as MCP tools, so the chat that shows Homie's cards also does the work: the setup status, a new studio,
the live demo, make / remix / port / plan a game and its Game Codex, build, run it here, the two-browser check, a
playtest, deploy, publish, the progress feed, the studio's files, and the music, sound, art and video scripts where
their provider is set up. Where a tool overlaps the remote Homie MCP (homie.rocks/mcp) it has the same name and
input shape. Long work (npm install, a check, a deploy) runs in the background and reports through the progress
feed; MCP Apps cards (setup, build progress, studio, codex) are served as `ui://homie-studio/*`, and every tool also
answers in plain text. Homie for Claude Desktop (`desktop/` in this repository) is this server as a Desktop
Extension: the plain Claude app gets it with one install, and no terminal.

## From a phone: a one-line hand-off

The Claude app on a phone hands a build to a Claude Code cloud session with one line, `Continue building <Studio>:
build hb_…`. In the session, `homie-studio handoff hb_…` fetches the brief from the directory by the build id, checks
in for a studio still being set up, takes the build so the chat's card follows it, and prints the steps (every
studio's `HANDOFF.md` says so).

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
and connects Workers Builds. The site goes live with its own home page ("First game coming soon": no starter game
is put in a studio unless the person asks for one), and its Home has a
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
npx -y @homie-rocks/studio@0.14.2 upgrade          # the plan; changes nothing
npx -y @homie-rocks/studio@0.14.2 upgrade --apply  # after the person agrees
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

## Player accounts and cloud saves

A game whose progress must last (a character that levels up for days, unlocks, a collection, a hardcore mode)
keeps it in **saves**, not in its room: a room forgets everything 60 s after its last player leaves.

```json
{ "id": "my-rpg", "saves": true }
```

```ts
import { createSaves } from '@homie-rocks/studio/saves';
const saves = createSaves({ game: 'my-rpg' });
const hero = (await saves.get('hero')) ?? newHero();
await saves.set('hero', hero);                       // on this device at once, in the studio's D1 when online
saves.stats.add({ kills: 1 });                       // lifetime numbers that outlive any hero
await saves.fall({ character: hero.name, summary: { level: hero.level }, wipe: true });   // hardcore
```

Pressing Play needs no account. A player who saves something is a guest on that browser; with a **passkey**
(Face ID, a fingerprint, a PIN, no password, no email) it becomes an account on this studio only, and the same
saves follow them to every device they sign in on. Saves are per player and game, versioned (a stale offline
copy is a conflict, never an overwrite), capped in size, and offline-tolerant. Players see, download and delete
everything at `/account/`; the owner sees counts (`homie-studio players`) and, through the back office, names,
never a passkey or an email. The `ember-vale` starter is a small persistent-character game on the same public
rooms. Everything, including what is stored and the back office's API: [saves/SAVES.md](saves/SAVES.md).

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

## The back office: run your live games

The owner sees and runs the studio's live games from `/_studio/office`, a private page
that refreshes itself: every live room of every game (players, bots, the round, how long
it has been up) and who is in it (each seat's handle, its device, whether it hosts, the
browser it came from; signed-in players once a studio has player accounts). From there,
and from a small Owner button in the owner's own play page (nobody else's page carries
it):

- **Kick** a player: they get a polite notice and cannot come back to that room for the
  minutes the owner chose (their seat, their browser, their account; their network only
  when asked, since a household shares one).
- **Mute** a player: their chat and emotes reach nobody (the `say`, `chat` and `emote`
  events; a game hides the rest with `net.isMuted(seat)`).
- **Announce** one line to a room, a game or the whole studio: every player sees it as a
  banner, and a game can show it its own way (`net.on('announce')`).
- **Close** a room: everyone is sent out with a thank-you; nobody gets in until it opens.
- Per game: **players per room**, the **launch state** (`private`: only the owner;
  `invite`: an invite-only beta, where each invite link or code lets a browser in;
  `public`: anyone, listed), and **remixable** (publish or withdraw the game's source).
  A game that is not public is in no list and not in the directory manifest, so the
  directory drops it the next time it reads the studio. A new game is private from its
  first deploy with `"launch": "private"` in its game.json.

```sh
npx homie-studio office link                            # a one-time link that signs the owner's browser in
npx homie-studio office link --to /crown-thief/play     # ... onto a private game, on the owner's phone
npx homie-studio office                                 # every live room and who is in it, now
npx homie-studio office announce "Double gems this round!" --game crown-thief
npx homie-studio office invite crown-thief --label "Sam" --uses 1
npx homie-studio office launch crown-thief invite       # asks: the owner confirms with one tap
npx homie-studio office kick crown-thief pub-3 2        # asks: seat 2 of Room 3
npx homie-studio office key                             # a key for the Homie MCP's owner tools
```

Going private or invite-only never cuts a round short: each live room finishes its current round with a notice to
the players, then everyone the new state leaves out is sent out with a thank-you (the owner, and in a beta the
invited, play on). A known edge: a room that opens in the same moment as the change can be missed by it, because the
office reaches the rooms its Lobby already knows. Each room therefore reads its game's launch state once, on its
first heartbeat after it opens, and re-gates the same way; nobody new can join a game that is not public meanwhile. Mute drops a player's `say…`, `chat…` and `emote…` events, so a game that sends its chat and
emotes under those kinds needs nothing more (`netplay/NETPLAY.md` section 15). Kicking a whole network address is in
the studio's API (`address: true`) and deliberately not in the office. A Preview (a branch's own unlisted address, with
no D1) enforces no launch state and has no office.

**Privacy.** The site still sets no cookie on a visitor to count or follow them. Two things are kept for the back
office, both functional: a random room key in the play page's own storage (what a kick holds; it says nothing about
who the player is), and, for an invited player of an invite-only beta only, their pass to that game: an HttpOnly
cookie for that game's pages alone, for 90 days. D1 keeps only a hash of each pass.

**Only the owner.** The owner's browser is signed in with the same one-time link as the
stats (an HttpOnly session no page or game can read; games run in a sandboxed, opaque
frame). An office key (minted with the studio's own Cloudflare login) lets the owner's AI
look, announce and invite at once; a kick, a mute, a closed room or a launch change is only
**asked** for, and the owner confirms it with one tap in their own browser. No key can
confirm. The Worker signs each control with the studio's own secret and the room verifies
it before it acts (`netplay/NETPLAY.md` section 15). Everything is in the studio's own
Worker and D1 (migration `0003_studio_office.sql`); homie.rocks stores none of it.

With player accounts (0.12.0), a signed-in player's play page names their account in its room ticket (an invited
player's names the invite and the account), so the office shows them by name and a kick holds the account on every
device; the owner's own passkey account (`homie-studio players owner`) counts as the owner.

## Setup status

```sh
npx -y @homie-rocks/studio@0.14.2 setup status --connector yes   # before a studio exists
npx homie-studio setup status                                    # in a studio (also: homie-studio doctor)
```

One checklist of what this computer and the person's accounts have for a studio: Node.js, the Homie
connector (the AI says whether its Homie tools are there; the directory is reached), Cloudflare (signed in
with the studio's own Wrangler, and the account's email verified: a deploy that went through proves it, a
deploy refused for it is remembered), Chrome for the checks, ffmpeg, and the optional GitHub, ElevenLabs and
fal (and, in Claude Code, the status line). Each row is green, missing or "do this now", says what it
unlocks, and gives the exact fix: a command the AI runs or a page the person taps. It only reads, answers in
seconds, and never prints a key, a token or an account's name. A studio the Claude app's setup card made
(`setup attach`) counts as connected to Cloudflare and GitHub there. `--json` gives the rows.

## The Game Codex

`games/<id>/CODEX.md` is a game's plan: Markdown with a small frontmatter for its look (palette, fonts, a
cover, pixel art) and a few conventions that become cards (`### Name` with a picture, `` `M-01` `` id and tag
chips, an italic subtitle and `**Key:** value` stats), tables, checklists, a dated decision log and open
questions (`lib/codex.mjs` has the whole format).

```sh
npx homie-studio codex new crown-thief          # every section, in the studio's colours
npx homie-studio codex crown-thief --open       # .studio/codex/crown-thief.html, in the browser
npx homie-studio codex crown-thief --artifact   # one self-contained page to publish as a Claude artifact
npx homie-studio codex link crown-thief         # a one-time link to the site's private copy
```

The page has a tab per section and a **Build status** tab from the game's progress feed; the local copy
redraws itself whenever the feed changes and refreshes in the browser while a build runs. `npm run build`
puts each game's codex on the site at `/_studio/codex/<id>/`, served only to the studio's owner (the same
one-time sign-in as the stats page), never listed or indexed. Text is escaped and the page runs only its own
script (the site allows it by its hash); pictures and fonts come only from inside the studio and are
embedded, so it loads nothing but Google Fonts. CODEX.md is never in a game's remix source or among a
static game's served files.

## The Claude Code status line

```sh
npx homie-studio statusline --install    # .claude/settings.local.json: this person, this studio
npx homie-studio statusline --install --project ..   # Claude Code started in the folder above the studio
npx homie-studio statusline --remove
```

One line under the prompt, from the current build's feed: `▶ Crown Thief · Checks ▰▰▰▰▰▰▱▱▱▱ 62% · 3/5 checks
· $0.40 of $2.00`; the studio's name, dimmed, when nothing runs; a finished build's result for ten minutes.
Claude Code runs `bin/statusline.mjs` with the session as JSON on stdin (it reads only the studio's progress
files, in about 40 ms) and, with the 5 s `refreshInterval` it sets, keeps it moving while a long check runs.
It never replaces a status line the person already has (`--replace` puts this one in for this studio only).
Plugins cannot set a status line, so it is always the person's yes. Codex CLI's status line takes only its
own built-in items, so there the codex page is the progress view.

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

A Claude Code cloud session sends all its traffic through a proxy (`HTTPS_PROXY`). curl, npm and git use it;
Node's own `fetch` does not unless Node is started with `NODE_USE_ENV_PROXY=1` (Node.js 22.21 and later). So from
0.12.1 the CLI restarts itself once with that set whenever a proxy is in the environment. Before that, `setup attach`
and `progress attach` connected directly, failed the lookup, and said "did not answer", which read like a blocked
network in a session with full network access. A failed request now says what happened (`lib/net.mjs`):

- the directory's status and its own words (`homie.rocks answered 409: …`);
- or the connection error's code (ENOTFOUND, ECONNREFUSED, a timeout, an untrusted certificate) and whether the
  proxy was used.

Only a refusal by the proxy itself (a 403 with `x-deny-reason: host_not_allowed`, or a refused CONNECT) names the
network setting (the environment's Network access: Custom, add homie.rocks). The build goes on with its local feed.

**The hand-off opens the studio's repository.** The chat's "Start building" and "Build it" open a Claude Code
session in one repository, and homie.rocks never asks GitHub which one Deploy to Cloudflare made. So the studio's
Worker tells it: `deploy` (and Workers Builds, which runs it) passes the repository as the Worker's private
`HOMIE_REPO` variable, from `HOMIE_REPO`, studio.json `github`, or the git remote, in that order (`lib/repo.mjs`;
Workers Builds sets no repository variable of its own). The Worker says it with its claim, a request Cloudflare
stamps with the Worker's own zone. It is never in the public manifest. `setup attach` writes it into studio.json
`github` too. When the directory does not know it, the card asks the person for it. It never opens Homie's engine
repository (`homie-rocks/homie`), which is also never accepted as a studio's.

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
| `lib/net.mjs`, `lib/repo.mjs` | The toolkit's own web requests: through the environment's proxy, and an honest reason when one fails. The studio's repository (`owner/name`), from its remote, never the engine's. |
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
