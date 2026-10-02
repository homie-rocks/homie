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
npx homie-studio perf crown-thief --url http://127.0.0.1:8787   # how fast it runs: a computer and an emulated phone, host and replica
npx homie-studio lab crown-thief                       # the Game Lab: how a move feels, New beside Today, frame by frame
npx homie-studio style board crown-thief               # its look as decisions: three directions drawn by the engine (free)
npx homie-studio assets find "pine tree"               # free CC0 models from Homie's starter library, phone-sized
npx homie-studio assets check crown-thief              # every model against phone budgets, the validator and its licence
npx homie-studio deploy --plan                         # what deploy will create, and what it costs; changes nothing
npx homie-studio deploy                                # the studio's own Cloudflare
npx homie-studio publish                               # the homie.rocks directory
npx homie-studio stats                                 # the studio's own numbers, for its owner
npx homie-studio office                                 # who is playing now, in every live room (the back office)
npx homie-studio servers                                # each game's servers: humans-only, hybrid AI seats, beginner guides
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
joinable and watchable) and Posts (`posts/*.md`, with Atom and JSON feeds). A section with nothing in it has no tab, and its
page answers 404. Every game gets a landing at `/<game>/`: a full-bleed hero from its own footage or art, the
pitch, a big Play button into a public room, how to play on a phone, a computer and a TV (with the join code),
live rooms, credits (the original and its licence for a port; "Remix of <game> by <studio>", linked, for a
remix), and "Make a game like this". A game's shared source (`/games/<id>/source.json`) says who made it and the
licence its owner picked in game.json `"license"`: `"remix-with-credit"` (the default), `"remix-freely"` or
`"no-remix"`, which `game remix` refuses. Every page ends with "Made with Homie". Anything the studio puts in `site/` wins: a whole page, a partial, its tokens, its CSS, its
files. `site/SITE.md` says all of it.

The play page writes its room into the address, and a small room button at the edge shares it: Invite, Big
screen and the room code. game.json's `screen.share` puts it where each game has room, per device (a corner or
the top's middle, moved in by `x` / `y`, or kept a small icon), so it never covers a scoreboard. A game whose
picture is white or cream gets a light landing (`landing.scheme: "light"`). Every card and the directory show a
game's landing still. Every HTML answer is `no-transform`, and the site's pages are never framed by another
site. A game made with Homie's arcade controls that knocks for a Homie box (`/__homie/call`) is told
`not-a-homie`, at the site's root as under the game.

Anyone can **watch** a live room from any player's view at `/<game>/watch?room=<room>` (a Watch button sits beside
Join on every room): the game itself, drawn by the watcher's own browser as a watcher that never takes a seat,
with a strip of the players to switch between (a tap, keys 1-9, Auto, the whole room). A game draws the followed
player's camera and HUD from `net.viewSeat` (Gem Rush and Ember Vale do; a game that does not is watched as its
overview), and game.json `"watch": "overview"` or `false` keeps hidden hands hidden. Private and invite-only games
are watched only by those they let in (NETPLAY.md section 16, site/SITE.md).

## Upgrading a studio

A studio pins one version, so nothing changes until it asks. To take a newer one (`latest`, or a version):

```sh
npx -y @homie-rocks/studio@latest upgrade          # what's new, and the plan; changes nothing
npx -y @homie-rocks/studio@0.19.2 upgrade --apply  # after the person agrees (the version the plan named)
npm install && npm run build
```

The plan starts with **what's new** since the version the studio pins: one line per version and every upgrade note
(anything the person has to do), read from the new version's own `CHANGELOG.md`, which ships in the package (the
repository's [CHANGELOG.md](https://github.com/homie-rocks/homie/blob/main/CHANGELOG.md) is the same file). `--json`
carries it as `whatsNew`. In Claude Desktop, `studio_run ["upgrade"]` runs the extension's own newer toolkit for
this, and the studio card says what's new when a studio is behind.

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
Worker and D1 (migration `0005_studio_office.sql`); homie.rocks stores none of it.

With player accounts (0.12.0), a signed-in player's play page names their account in its room ticket (an invited
player's names the invite and the account), so the office shows them by name and a kick holds the account on every
device; the owner's own passkey account (`homie-studio players owner`) counts as the owner.

## Servers and AI seats

A game's **servers** (0.16.0) are named, lasting pools of rooms with their own rules; strangers are matched only
inside one server, and every game's public rooms are its Quick play server, so nothing old changes:

```sh
npx homie-studio servers new night-rush "Night Shift" --policy hybrid --ai 2      # 2 AI companions in every room
npx homie-studio servers new night-rush "People Only" --policy humans-only        # no AI of any kind
npx homie-studio servers new night-rush "First Light" --policy beginner --guides 2 --kids
npx homie-studio servers                                                           # every server, live, and builds that predate them
npx homie-studio agents pass night-rush --label Claude                             # an AI's way into a seat (shown once)
```

- **Policies:** open (an AI with a pass may sit, always marked AI), humans-only (the site and the room refuse
  every AI; the game's bots are off), hybrid (the top N seats of every room are AI companions), beginner (new
  accounts, AI guides, quick lines only; `--kids`: handles only, gentle AI). **Doors:** open, accounts (a passkey
  account) or invite (`office invite <id> --server <server>`).
- **AI is always marked AI**, by the room's relay, not the game: every agent is named "<label> · AI", and the
  relay rewrites a host's roster and results so a game cannot hide one.
- **The skill dial:** 1 Rookie to 5 Maxed (`{ reactionMs, aimNoise, aggression, positioning }`). The party votes it
  on a card in the play page (the middle vote wins); `net.skillOf(slot)` is what a bot reads (`NETPLAY.md` section
  17), and `BotBrain` reads it with a rebuild. In the starters, Gem Rush's Rookie bots collect far fewer gems than
  its Maxed ones.
- **Asks:** making a server, a widening change, a pass and a room's level happen at once; narrowing one
  (humans-only, a stricter door), closing it, removing a member, and the first time AI guides may talk are asked
  for, and the owner confirms with one tap.
- **AI guides that talk** (0.17.0): a game's `agents.json` is its guides' vocabulary (goals, lines, the asks a
  player taps), and `useAgents` from `@homie-rocks/studio/agents` its host side (Ember Vale is the reference). The
  brain is the server's: `agents brain night-rush first-light workers-ai` (the studio's own Workers AI; deploy binds
  it; 8,000 neurons a day by default) or `owner-key` (the owner's own key, `agents brain key`, capped in dollars a
  day); with none, the game's scripted floor. The local MCP's `agent_sit` puts the owner's own Claude in a guide's
  seat. The AI never types: it picks ids; the room drops anything else.
  [agents/GUIDES.md](agents/GUIDES.md) is the short path for an existing RPG.
- Everything is in the studio's own Worker and D1 (migration `0006_studio_servers.sql`). The site's side is in
  [site/SITE.md](site/SITE.md); the room's in [netplay/NETPLAY.md](netplay/NETPLAY.md) sections 17 and 18.

## Setup status

```sh
npx -y @homie-rocks/studio@0.18.2 setup status --connector yes   # before a studio exists
npx homie-studio setup status                                    # in a studio (also: homie-studio doctor)
```

One checklist of what this computer and the person's accounts have for a studio: Node.js, the Homie
connector (the AI says whether its Homie tools are there; the directory is reached), Cloudflare (signed in
with the studio's own Wrangler, and the account's email verified: a deploy that went through proves it, a
deploy refused for it is remembered), Chrome for the checks, ffmpeg, and the optional GitHub, ElevenLabs and
fal (and, in Claude Code, the status line). Each row is green, missing or "do this now", says what it
unlocks, and gives the exact fix: a command the AI runs or a page the person taps. It only reads, answers in
seconds, and never prints a key, a token or an account's name or id. A studio the Claude app's setup card made
(`setup attach`) counts as connected to Cloudflare and GitHub there. `--json` gives the rows.

When a server's AI guides think with Workers AI (0.18.1), a **Workers AI** row checks that the model they use
(`HOMIE_BRAIN_MODEL` in wrangler.jsonc `vars`, else `@cf/meta/llama-3.1-8b-instruct-fp8-fast`) answers on the
studio's account: one tiny call through Cloudflare's API with the studio's own Wrangler login (a one-word prompt,
one token out: about 0.1 of the 10,000 free neurons a day; `lib/brain-probe.mjs`). A model Cloudflare moved to
Workers Paid (error 5035) or retired (5007) is named, with what to do: pick another model, or, the person's money,
Workers Paid. A spent daily allowance (3036) is said as that, not as a broken model.

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

## How fast it runs: `homie-studio perf`

```sh
npx homie-studio perf crown-thief --url http://127.0.0.1:8787 [--device computer,phone] [--runs 3] [--profile]
npx homie-studio perf sizes crown-thief                     # every built file, raw and gzipped; with build --maps, the bundle's modules
npx homie-studio perf compare .perf/crown-thief/<before> .perf/crown-thief/<after> --goal phone.host.frame.p95
```

One run is two headless Chromes on this computer's GPU in a fresh room of their own (`?room=perf-…`): the host (the
rules, the bots, the snapshots) and a replica, both a computer (1280x800 at 2x) or both an emulated phone (390x844 at
3x, touch, Chrome's CPU throttle at 4x with `--cpu`, 4G; each run records the slow-down the throttle really gave, which
on a fast computer is less than its rate). They play the same seeded presses through a warm-up and a measured
window, and each run's JSON says, per browser: the time between animation frames (median, p95, p99, the share over 33
and 50 ms), the game's JavaScript per frame (every requestAnimationFrame callback timed), the main thread per frame
(Chrome's TaskDuration), time to the first frame, to a seat and to playable, the game's files on the wire, the heap
after a garbage collection, and netplay messages and kilobytes a second each way. `--profile` adds a CPU profile per
browser in a window of its own (a `.cpuprofile` for Chrome DevTools) and its hottest functions, read through the
game's source map when the build kept one (`homie-studio build --maps` keeps it in `.studio/maps/<id>/`, never in
`site/dist`).

The computer is shared, so every run waits for the 1-minute load to fall under 0.8 per core (`--max-load`) and
records the load before and after; a run that started busy says `loaded` and `compare` leaves it out. A software
renderer (SwiftShader) makes the run `blocked`: nothing on it is judged. `compare` calls a metric better only when a
rank test says it is unlikely to be chance (p < 0.05), the 95% bootstrap interval of the change stays below zero, and
it is at least 3% better; runs taken side by side with the same `--pair` label are judged as pairs (a signed-rank
test on their ratios), so a computer that drifted busier cancels. Guards (frame time, main thread per frame, time to
playable, heap, the host's upload) must not get worse. Results are files under `.perf/<id>/` (git-ignored); the
command prints paths and medians. The Homie plugin's `perf` skill runs the whole loop: baseline, one change at a time,
keep or revert, and a report in the studio's `perf/` folder.

`perf sizes` reads each big script for whether it is minified from its code, not from how well it gzips: whitespace,
comments and names outside its strings (a minifier leaves about 1 to 2% whitespace; indented source has 15 to 30%).
Minified JavaScript gzips about as well as source text, and a bundle with three.js in it carries the shaders as GLSL
source in strings, which no minifier touches; the line for such a file says `minified, 19% GLSL shader source in
strings`, and the JSON's `code` has every measure.

## How it feels: the Game Lab (`homie-studio lab`)

```sh
npx homie-studio lab crown-thief [--today HEAD|<ref>] [--port 8790]   # http://127.0.0.1:8790/crown-thief/ until --stop
npx homie-studio lab check crown-thief [--take knock] [--fps 30] [--device phone]   # the same, headless: numbers and pictures
npx homie-studio lab set crown-thief hitStopMs=80 knockDistance=200                 # values into games/crown-thief/tunables.json
npx homie-studio lab --stop
```

A page on this computer for one mechanic at a time (a jump, a hit, a dash, a drift). It plays one short **take**
(`games/<id>/lab.json`: a few seconds, a seed, the presses) in two builds side by side: **New**, the working tree,
rebuilt on every save, and **Today**, the last commit (or any ref), built from git's own checkout of it with only the
game's files (and what its bundle reads from the studio), cached per commit in `.studio/lab/`. Both play on the lab's
clock: requestAnimationFrame, performance.now(), Date.now(), timers and Math.random() are the lab's in the game's page
(its harness, `lab/harness.js`, is the page's first script), so frame f is exactly f/fps seconds in both builds, the
dice are the same, the presses land on the same frames, and netplay's offline host, a round's clock and a knockback's
timer all slow down, pause and step together. Every replay is compared with the last run, frame by frame: the page
says "Replays match", or the frame where a build read something the lab does not drive.

The page: New, Today, both side by side or Today ghosted over New; the game's own views (`lab.camera`) and overlays
(`lab.overlay`: onion skin, arcs, reach); Desk (1280x800) or Phone (390x844); play, pause, a frame back or forward,
start and end; 1x, ½, ¼ and ⅒ speed (each frame is the same frame at any speed); 60, 30, 15 or 12 frames a second (what
a slower device draws); a frame counter; a timeline of the phases each build names (`lab.phase`), scrubbable, with each
frame's motion marked HOLD, MOVE or FAST; graphs of every tracked value (`lab.track`), New against Today, beside the
body's speed from the port probe and the game's JavaScript per frame; the phase each pane is in, as a caption; the
game's tunables (`games/<id>/tunables.json`) as sliders, with Today's value marked, that restart New with the new value
and write kept values back into the file ("Keep in code", one tunable a line); and REC, which records a new take while
the person plays it in New (both builds get the same presses, on the same frames). A phone opens it too.

A game opts in with `@homie-rocks/studio/lab` (`lab` from `/port` too, `HomiePort.lab` in a static game): every call is
a no-op outside the lab. Both starters do: Gem Rush's bump (a dummy to bump: `lab.stage`) and Ember Vale's strike (a
training slime). `lab check` plays the take headless twice per build and writes `.studio/lab/<id>/check-<time>/`:
summary.json (each phase's frames, each tracked value's peak and where it ends, the JavaScript per frame, errors, the
replay check), REPORT.md (New against Today), sheet.png (the lab at each phase's start) and still.jpg; and
`.studio/lab/<id>/latest.json`, the last check in a few fields (`.studio/lab/server.json` says where a running lab is).
The local MCP's `game_lab` starts the lab and answers with a card. The Homie plugin's `lab` skill has the method:
instrument and commit first (Today is the game as it is), then change how it feels, and keep what the person likes.

## Art direction and models (`homie-studio style`, `homie-studio assets`)

```sh
npx homie-studio style init crown-thief --prompt "a cozy low-poly forest where foxes gather berries"
npx homie-studio style crown-thief                       # every decision: · auto  ~ steered  ● pinned by use  ■ locked
npx homie-studio style board crown-thief                 # three directions, drawn by the game engine: codex/board/*.jpg
npx homie-studio style pick crown-thief b --mix style.camera=a
npx homie-studio style steer crown-thief style.palette "warmer"
npx homie-studio style lock crown-thief style.palette --words "keep that palette"
npx homie-studio style blast crown-thief style.palette   # what a change would make stale, and what remaking costs
npx homie-studio assets find "fox" --kind creature        # the starter library (HOMIE_LIBRARY: another copy)
npx homie-studio assets add crown-thief kenney-cube-pets/animal-fox --height 0.7 --card "Characters/Fox"
npx homie-studio assets add crown-thief --file ./lantern.glb --license own --height 0.6
npx homie-studio assets check crown-thief                # budgets, the glTF-Validator, licences, staleness, big files
npx homie-studio assets lineup crown-thief               # true scale, silhouettes, palette drift: .studio/art/<id>/
npx homie-studio assets rights crown-thief               # games/<id>/assets/RIGHTS.md and the credits
npx homie-studio assets redo crown-thief lantern         # made again from its kept raw file, free
npx homie-studio assets remove crown-thief lantern       # the record and the copy the game ships
```

A game's look is a set of decisions (`games/<id>/codex/decisions.json`, private like the codex, drawn in its Art
direction tab): render style, palette, shape, proportions, materials, light, camera, fonts and effects; the cast, its
library family, scale and phone budgets; rigs and animation (later phases). Each starts as an automatic pick with a
why. A person's nudge makes it steered, their lock freezes it, and the first asset built on an automatic one pins it.
Every asset records the revision of each decision it was made under, so changing one lists exactly what went stale and
what remaking it would cost; nothing is remade by itself. `games/<id>/style.json` (public) is the palette, fonts, light
and camera the game, its landing and its title cards draw with.

Every model, texture and sky a game ships has an entry in `games/<id>/assets/manifest.json`: its route (procedural,
library, generated, imported), each step that made it, its licence and what a remix gets, its measurements. From it:
`RIGHTS.md`, the credits on the game's landing, `assets check`, the licence check `publish` makes, and
`/games/<id>/assets.json` on the site, from which `game remix` fetches every model its licence lets a remix carry
(checked by SHA-256; a grey placeholder of the same size for the rest). Models are refused when they load anything
from an address or are over the size caps; `assets add` makes them phone-sized (meshopt geometry, WebP pictures, the
pivot at the bottom centre, scaled to metres) with @gltf-transform, meshoptimizer and sharp; raw files stay in
`art/<slug>/raw/`, which git ignores.

In a three.js game, `@homie-rocks/studio/assets` is the one loader:

```ts
import { createModels } from '@homie-rocks/studio/assets';
const models = createModels();
const fox = await models.instance('./models/fox.glb').catch(() => models.placeholder({ x: 0.6, y: 0.7, z: 0.9 }));
```

It checks every file before three.js parses it (no external URIs, no buffer over the cap, only extensions three.js
reads), decodes meshopt, clones skinned models properly, and says in development when a model is over its budget
(`stats()`, `window.__homieModels`). `game new <id> --from gem-rush-3d` is Gem Rush in 3D, dressed from the library.
The local MCP's `style_explore`, `decision_set`, `assets_plan`, `assets_find`, `asset_add`, `asset_make`,
`asset_check`, `asset_lineup` and `asset_rights` do the same with cards. Generated props (on the person's own fal
account, under a budget, receipted) are the Homie plugin's `models` skill.

## Checks on a computer without a GPU

`check`, `port check` and `look` run Chrome headless. On a Mac they use its GPU. On Linux (a Claude Code cloud
session, GitHub Actions, a container) `npx homie-studio chrome install` puts Chrome for Testing in
the home folder's `.cache/homie-studio` (from storage.googleapis.com, which a cloud session's default network reaches), and WebGL
renders with SwiftShader. `check` reports how fast each browser drew the game and on what renderer; on SwiftShader
it says the frame rate is not a person's, and judges only seats, rooms and rounds.

## No payment method needed

`deploy` creates only what Cloudflare's free Workers plan gives a new account with no
payment method: one Worker, one D1 database and two SQLite-backed Durable Objects
(`Table`, `Lobby`). It never creates R2. A brand-new Cloudflare account verifies
its email address before it can run a Worker; a missing `workers.dev` subdomain is
registered by Wrangler when Claude Code or Codex runs the deploy.

Storage for songs and videos is a separate, optional step. Once a studio has it, its big media
lives in R2 by default:

```sh
npx homie-studio storage add                           # the studio's R2 bucket, bound as MEDIA
npx homie-studio media move --dry-run                  # what goes: over 1 MiB, or left out of git
npx homie-studio deploy                                # moves it (uploaded, read back, SHA-256 checked), then deploys
```

Each moved file keeps its address (`/videos/<slug>/<file>.mp4`), served from R2 with byte ranges,
HEAD, ETags and the site's own cache headers, and the site's static files stop carrying it; the file
stays in the studio folder, and the committed manifest names its R2 copy, so a deploy from another
computer or Workers Builds still has it (`media/MEDIA.md`). Cloudflare asks for a payment method on
the account before R2 works, even inside R2's free tier (10 GB-month of storage, 1 million writes and
10 million reads a month; no egress fees; then US$0.015 per GB-month), so `storage add` refuses with
the dashboard link until the account has R2 turned on, and creates nothing.
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
| `lib/cloudflare.mjs` | `deploy` (and `deploy --plan`): Wrangler, D1, migrations; refuses resources it did not create. In Workers Builds, migrations and deploy only. `storage add`: the optional R2 bucket; `media move`: big media into it, checked by SHA-256 (every deploy runs it). |
| `lib/check.mjs` | `check`: two fresh Chrome processes (computer + phone) must share a room and finish a round with both in it, with each one's frame rate; on a busy computer it waits out a round a browser was dropped from, and says why when none counts. `lib/chrome.mjs`: which Chrome, and how (the GPU on a Mac, SwiftShader on Linux). |
| `lib/upgrade.mjs`, `lib/template-history.json` | `upgrade`: an existing studio takes what a newer template adds, never over its own edits. |
| `lib/changelog.mjs`, `CHANGELOG.md` | The release history this package carries (a copy of the repository's): `upgrade`'s what's new, the studio card's, and the release notes. |
| `lib/progress.mjs`, `lib/setup.mjs` | The progress feed (`progress …`), a build the chat opened (`progress attach`), a change as a pull request (`progress change`, `progress pr`), and `setup attach`. |
| `lib/net.mjs`, `lib/repo.mjs` | The toolkit's own web requests: through the environment's proxy, and an honest reason when one fails. The studio's repository (`owner/name`), from its remote, never the engine's. |
| `template/` (repository root), `scripts/template.mjs` | The public "Deploy to Cloudflare" template, generated from `new --template`. |
| `lib/port.mjs` | `port plan` (reads a game and grades the port) and `port import`. |
| `lib/port-check.mjs` | `port check`: held and alternating directions on keys, Android Chrome and iPhone WebKit touch, UI cover, two browsers finishing a round, a killed host, a late joiner, the big screen. |
| `port/` | The port toolkit (`@homie-rocks/studio/port`, or `window.HomiePort` from `homie-port.js` in a static game): `createRoom`, the touch kit, keys, camera rules, bots, a HUD, sandbox shims, first-touch audio, `exposePort`; `fitView` and `createLabels` (`port/view.ts`): a flat world on every screen (the whole of it where it reads, else filling a phone held upright and following the player) and names that never pile up when bodies crowd (yours placed first, the rest moved or faded). |
| `worker/index.mjs` | The site Worker and the `Table` (netplay relay, `room.mjs`) and `Lobby` Durable Objects; `/<game>/tv` is the big screen with a join QR (`qr.mjs`); `/<game>/watch` watches a live room from any player's view (NETPLAY.md section 16); `/music/<slug>/` and `/videos/<slug>/` are song and video pages (their files served with byte ranges, from the site's files or, once moved, from the studio's R2 at the same address; a loose file from `media put` at `/media/<key>`). `seats.mjs`: room sizes (up to 32). |
| `worker/site.mjs`, `lib/site.mjs`, `lib/markdown.mjs`, `site/SITE.md` | The site: its sections, each game's landing, posts and their feeds, the look (theme tokens) and what the studio's `site/` folder overrides; the safe markdown posts are written in. `worker/pages.mjs`: the play page. |
| `worker/stats.mjs`, `worker/stats-page.mjs`, `lib/stats.mjs` | The studio's own stats: what is counted and how, the owner-only `/api/stats` and `/_studio/stats`, and `homie-studio stats`. |
| `lib/media.mjs`, `media/MEDIA.md` | The `music/` and `videos/` manifests: which entries get a page, and where each file's bytes come from (the site itself up to 25 MiB a file, the studio's R2, or a link). `media list` shows it; `media move` puts the big ones in R2 and records each one's SHA-256; `media put` uploads a loose file to `/media/<key>`. |
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
