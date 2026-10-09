# @homie-rocks/studio

A studio for games, music and video on its own Cloudflare. One repository (`AGENTS.md`,
`games/`, `music/`, `videos/`, `posts/`, `site/`), multiplayer games on the Homie netplay
contract (every browser renders, strangers meet in public rooms, bots fill seats, rounds
restart), and a site Worker with Table/Lobby Durable Objects and D1 that the studio deploys
to its own Cloudflare account with Wrangler. The homie.rocks directory lists the games.

Most people never run this by hand: the Homie plugin for Claude Code, Codex and Grok does,
and the person approves Cloudflare once in their browser.

```sh
npx -y @homie-rocks/studio new ./night-owls --name "Night Owls"
cd night-owls && npm install
npx homie-studio game new crown-thief --from gem-rush --name "Crown Thief"
npx homie-studio dev                                   # the whole site locally
npx homie-studio check crown-thief --url http://127.0.0.1:8787
npx homie-studio shoot crown-thief --url http://127.0.0.1:8787  # frames on a stepped clock (works without a GPU) and a two-client seat smoke check
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
npx homie-studio chat                                   # room chat: each game's rules, the rooms' last minutes, reports
npx homie-studio lounge                                 # the studio's Lounge: play nights, moderators, kept chat
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
the live demo, make / port / plan a game and its Game Codex, build, run it here, the two-browser check, a
playtest, deploy, publish, the progress feed, the studio's files, and the music, sound, art and video scripts where
their provider is set up. Where a tool overlaps the remote Homie MCP (homie.rocks/mcp) it has the same name and
input shape. Long work (npm install, a check, a deploy) runs in the background and reports through the progress
feed; MCP Apps cards (setup, build progress, studio, codex) are served as `ui://homie-studio/*`, and every tool also
answers in plain text. Homie for Claude Desktop (`desktop/` in this repository) is this server as a Desktop
Extension: the plain Claude app gets it with one install, and no terminal.

**Tell Homie** (0.28.0): `homie_feedback` drafts a short note to the people who make Homie (stuck, confusing, idea,
praise or bug) from what happened, and sends it only after the person has seen it word for word and said yes: its
card (`ui://homie-studio/feedback`) has Send, Edit and Don't send, and a send must name the draft the person saw,
with the same words. Keys, home folders, email addresses, code and a workers.dev account name are taken out before
it is shown (`lib/feedback.mjs`, with the Homie mod's own redaction). Claude offers one at most once a session, and a
no is final for it. It goes to homie.rocks (`/api/feedback/tell`): a studio.json can name only Homie's own directory or
this computer, so a borrowed studio cannot send notes elsewhere.

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
**Connect this chat** band: one tap links it to the chat that set it up (the Homie MCP tool `studio_setup`).
In the session that works in the repository, `homie-studio setup attach <hs_…> [--client claude|codex|grok]` then gives the studio
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
live rooms and credits (the original and its licence for a port; "Based on <game> by <studio>", linked, for a
game that was made from another studio's). game.json `"license": "MIT"` (an SPDX identifier) is the licence the game
names for itself, said in its credits; a game that names none says nothing. No game's source is served: games build on
each other through parts ("Game parts", below). studio.json `"site": { "order": ["<id>", …] }` is the
order of the games in every list, the directory's manifest included. Every page ends with "Made with Homie". Anything the studio puts in `site/` wins: a whole page, a partial, its tokens, its CSS, its
files. `site/SITE.md` says all of it.

The play page never opens blank (0.26.0): from its first paint an arrival card shows the game's own look (its title,
pitch and key art in its palette, a progress line that says what is happening, and the controls for the device) until
the game says it is playable (`NETPLAY.md` section 21; `worker/arrival.mjs`). It writes its room into the address, and
a small room button at the edge shares it: Invite, Big screen and the room code. game.json's `screen.share` puts it where each game has room, per device (a corner or
the top's middle, moved in by `x` / `y`, or kept a small icon), so it never covers a scoreboard. A game whose
picture is white or cream gets a light landing (`landing.scheme: "light"`). Every card and the directory show a
game's landing still. A game with its own palette (style.json) and no landing colours of its own gets its landing
in that palette, light or dark as its paper is (0.26.0). Every HTML answer is `no-transform`, and the site's pages are never framed by another
site. A game made with Homie's arcade controls that knocks for a Homie box (`/__homie/call`) is told
`not-a-homie`, at the site's root as under the game.

Search engines and AI agents read a studio correctly (0.27.0): every generated page carries schema.org JSON-LD
(`worker/schema.mjs`: the studio's `Organization` and `WebSite` on Home, a full `VideoGame` on each landing with its
players, platforms, licence, trailer, dates and a free-to-play offer whose add-ons are what the shop
really sells, `MusicRecording`, `VideoObject`, `BlogPosting`, `ItemList` and `BreadcrumbList`; never a rating), and the
site makes `/robots.txt`, `/sitemap.xml`, `/llms.txt` and `/llms-full.txt` from its public catalogue
(`worker/discover.mjs`). `lib/schema-check.mjs` checks every block against schema.org's own vocabulary and what Google
documents as required. game.json `"schema"` and studio.json `site.schema` add the owner's own properties.

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

### Remix was retired

Handing over a whole game (`game remix`, the `game_remix` tool, a game's `/games/<id>/source.json`, the office's
Remixable switch, the "Make a game like this" band) is gone. Games build on each other through **parts**: pieces of a
game its studio chooses to share, each with its own licence ("Game parts", below). For a studio that upgrades:

- **Old settings still build.** A game.json that carries `"remix"`, `"share"`, `landing.make`, or a `"license"` that
  is one of the old words (`"remix-with-credit"`, `"remix-freely"`, `"no-remix"`, or an object with `"kind"`) builds
  as before. The keys do nothing, and the build says so in one note that lists them; delete them when convenient. An
  SPDX identifier in `"license"` (`"MIT"`, or `{ "spdx": "MIT" }`) is still the licence the game names on its page.
- **A game that was a remix keeps its credit.** game.json `"remixOf"` is still read: the landing and the credits page
  say "Based on <game> by <studio>", linked to the original. That credit is owed, so leave the key where it is. The
  files such a game carried keep saying whose they were in its `assets/RIGHTS.md`.
- **No source is served.** The build writes no `source.json` or `assets.json` and takes out the ones an older build
  left. `/games/<id>/source.json` answers 410 with `{ "retired": "remix", "see": "/parts/" }`, and
  `/.well-known/homie-studio.json` no longer has `remix`, `source` or `remixOf`. The first deploy after the upgrade
  asks the directory to read a listed studio again, once, so it drops the old offer.
- **Nothing is dropped from the database.** The office's `office_games.remix` column stays in D1 with whatever it
  held; nothing reads or writes it.
- **Asset records.** `license.remix` on an entry of `assets/manifest.json` is ignored and no longer written, and
  RIGHTS.md has no "A remix" line. Whether a file may be handed on in a shared part is still its licence's.
- `homie-studio game remix` answers with a sentence that points to parts; `office launch --remixable` is ignored.

## Rooms of up to 32

Every room of a game has the seats its netplay manifest names: game.json's `netplay`
block (`maxPlayers`), or a `netplay.json` beside game.json or in the game's build
(`maxPlayers` or `players.max`), else game.json's `players.max`, else 8; at most 32.
Bots, a late joiner taking a bot's body and a new host after the old one leaves work
the same at 32 as at 4. One address may hold every seat plus four sockets, so a party
on one Wi-Fi (or strangers behind one carrier's address) fills a room with a TV beside it.

## A game's netplay manifest

game.json `"netplay"` says more than the room's size. All of it is optional, and `homie-studio build`
writes it to the catalogue for the site's rooms (`netplay/NETPLAY.md` sections 22 to 24):

| Field | What it does |
|---|---|
| `maxPlayers` | Seats in a room, up to 32. |
| `version` | The game's revision (a word or a number). Bump it when a change makes an already-open tab unable to play with a new one: a room then runs one build at a time, strangers are matched within the live build, and an old tab is told to reload at its round's break. |
| `stallMs` | How long a host may send no snapshot before the room is handed to another browser: 1500 (the default) to 10000. A heavy 3D game whose frames hitch on a slow phone raises it; the helper also sends a heartbeat for up to 4 s while a host's frames are stuck. |
| `params` | Names of the play page's query parameters to hand the game (`/<id>/play?seed=42`), beside `debug` and `q`, which always are. The game reads them as `net.params`. |

The game's frame is sandboxed without `allow-same-origin` (it must never read the site's storage or
the owner's session), so `localStorage` throws inside it: a setting or a personal best goes in
`net.prefs` (the play page keeps 16 KB a game), and progress that must last in saves, below.
`net.link` says whether the browser is in its room, reconnecting, or playing alone because the room
never answered; `guardGestures()` stops a long press on a phone from selecting text in a touch game.

## A game's rules on the server (an example, 0.33.0)

A game can be written as **rules plus view**: `src/rules.ts` and `src/move.ts` say what is true in the game and run
in the room's own server object on the studio's Cloudflare; `src/view.ts` draws what it is told and sends what the
player presses. No player's browser is the room's host, so a changed browser cannot change a score, a pickup or a
round. `homie-studio build` checks the rules first and refuses anything outside a short list of safe operations,
naming the line, then guards them so a rule that never ends is stopped while the room carries on
(`netplay/NETPLAY.md` section 29).

```sh
npx --no-install homie-studio game new coin-dash --from coin-dash   # the example
npx --no-install homie-studio dev                                   # its rules run in the local room object
```

`coin-dash` is an example, not yet a starter to build your own game on: a server-hosted room has no save in this
version, so a deploy of the site restarts its match. A game with no `src/rules.ts` is not touched by any of this and
runs in a player's browser exactly as before. So far this has run on a local Cloudflare runtime only.

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
  `public`: anyone, listed).
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
- **Clef thinks for the guides** (0.24.4): Workers AI's default for them is Cloudflare's decision model
  (`@cf/cloudflare/clef-flash`), which answers a decision as typed Choices (goal, values, line or none) and never
  writes text. On 64 recorded Ember Vale moments it answered 36 of 40 open asks itself (Llama 3.1 8B: none) and blind
  judges preferred it in 51 of 64, at about 9 neurons a decision (Llama: 4). `HOMIE_BRAIN_MODEL` still picks Llama or
  the 27B Clef; `agents try <game> --view <file> [--ask …] [--model …]` shows what the brain would decide in a moment.
- **Clef on your own computer** (0.24.4): with Ollama and `clef-flash` here, `dev` runs the guides, chat review and
  game decisions on it, free and with no Cloudflare, and `agents sit --brain local` (the MCP's `agent_sit { brain:
  "local" }`) seats a guide that thinks here. Nothing downloads it: `ollama pull clef-flash` is about 11 GB, the
  person's choice (doctor's "Clef on this computer" row says what is there).
- **A game's own decisions** (0.24.4, NETPLAY.md section 20): `net.decide(state, questions, { floor })` on the host,
  for a game whose game.json says `"decide": true`: tactics for its opponents, an NPC's reaction, a director's call,
  a turn's move, answered by Clef in the room in about a quarter of a second, per beat (never per frame), within the
  AI brains' day; the floor answers whenever it cannot. Ember Vale's slimes pick their tactics this way (opt-in).
- Everything is in the studio's own Worker and D1 (migration `0006_studio_servers.sql`). The site's side is in
  [site/SITE.md](site/SITE.md); the room's in [netplay/NETPLAY.md](netplay/NETPLAY.md) sections 17, 18 and 20.

## Room chat

Every game has room chat (0.23.0), with no game code: reactions that float up every screen in the room (players,
watchers, the big screen), the game's quick lines, and typing where the room's rules allow it. It is the Homie app's
live-room chat and homie.rocks's room chat in a studio's own game: the same five reactions in the same order, the
same message shapes, the same float on a television.

```sh
npx homie-studio chat rules night-rush --mode lines                    # emoji and quick lines only
npx homie-studio chat rules night-rush --who anyone --slow 5           # guests may type, one line every 5 s
npx homie-studio chat rules night-rush --server first-light --mode emoji
npx homie-studio chat                                                   # rules, every room's last minutes, reports
npx homie-studio chat remove night-rush pub-3 <line id>                 # take a line down on every screen
npx homie-studio chat words                                             # the built-in word list the floor holds
```

- **The play page:** a Chat pill beside the room button (the corner `screen.share` keeps clear of the HUD; a round
  icon on a phone), its sheet (the last minutes, the reactions, the quick lines, typing, Report), a short strip of
  new lines (game.json `screen.chat` puts it where the game has room, or keeps new lines in the sheet), and two
  switches each player keeps: "Show my messages over my character" and "Show chat on this screen". The big screen
  shows the lines in a corner; the watch page has a Chat button; homie.rocks shows a room's chat on its card.
- **Rules** per game (game.json `"chat"`) and per server, in the office or with `chat rules`: off, emoji, quick
  lines or typing; who may type and who may react (anyone, signed in with a passkey, members); slow mode, length,
  links, swears, the review, bubbles, watchers, homie.rocks. Default: emoji and quick lines for anyone, typing for
  signed-in players. A kids server and every beginner server keep chat to emoji and quick lines.
- **Moderation, in the studio's own Worker, before anyone sees a typed line:** a built-in word list and patterns
  (slurs, sexual words, self-harm, personal questions and contact details, links, swears, your own words), then
  Cloudflare's **Clef** decision model on the studio's own Workers AI (`@cf/cloudflare/clef-flash`, about 2.3
  neurons a message measured, 2,000 a day by default: inside the free allocation; under `dev`, Clef on this computer
  when Ollama has it, free). Emoji and quick lines are never reviewed.
- **The owner:** every live room's last minutes in the office with Remove, Mute and Kick (from a line, with their
  lines taken down), the same in the owner's own game, the reports players make, and Announce (a studio line).
- **Speech bubbles:** `net.on('say')` and the port kit's `createBubbles` / `paintBubbles`; Gem Rush, Ember Vale and
  Gem Rush 3D draw them over the speaker.
- **Nothing is stored** but a report (the one message, 30 days): the room keeps 15 minutes in memory. An owner may
  turn a room's `history` on (0.29.0, a number of days; off for every game, never on a kids server): then what was
  said (never a reaction) is kept in the studio's own D1 for that long, and people take their own lines down.
  [chat/CHAT.md](chat/CHAT.md) is the short version and why Clef; [chat/OWNERS.md](chat/OWNERS.md) a plain note for
  studio owners on chat and children's data; NETPLAY.md section 19 the wire.

## The Lounge: a room for the studio's community

`"lounge": true` in studio.json gives the studio a community room at `/lounge/` (0.29.0): room chat in a lasting room
of its own, on the studio's own Cloudflare like everything else. Reactions and quick lines for anyone, typing for
players signed in with a passkey (signing in is on the page), every typed line through the word list and the Clef
review first.

```sh
npx homie-studio lounge                                                 # its rules, play nights, moderators, lines, reports
npx homie-studio lounge night "Night Rush night" --at 2026-10-09T19:00:00-07:00 --game night-rush
npx homie-studio lounge history 14                                      # keep what is said for 14 days (asked: the owner confirms)
npx homie-studio lounge mod <player id>                                 # a moderator (asked)
```

- **Play nights** the owner sets in the office: everyone sees the time in their own zone, a countdown and Add to
  calendar. **Live rooms** with Watch and Join: the studio's, and with a directory the busiest across it.
- **Show what you made:** a signed-in person pastes a link to a Homie studio's game and it becomes a card with the
  game's own title, pitch and picture (read from that studio's manifest; its words pass the word list and the
  review). Typed links stay held.
- **Keeping it kind:** anyone reports a line or takes their own down; moderators the owner names Remove, Mute and
  Kick (an hour at most) and set slow mode from the page; the owner has all of it and the office. A kids Lounge
  keeps to emoji and quick lines and keeps nothing.
- **History is off** until the owner turns it on (1 to 90 days), and the page says what is kept.
- **homie.rocks** can show a Lounge live when its rules allow (`hub`): the visitor's browser opens the Lounge's own
  socket, as for a room's card; they react there and type here. [chat/LOUNGE.md](chat/LOUNGE.md) has the whole of it.

## Selling things: the shop

A studio sells items for its games (0.24.0; Stripe's own agent tools since 0.24.3) with **its own Stripe account**: the studio is the seller, money goes
straight from players to its Stripe, and homie.rocks never sees, holds or moves it (Homie takes no cut; no shared
currency; not a Connect platform). The studio chooses its prices, item kinds and optional spending and refund
settings, with no Homie ceiling. The default is open: guests can buy repeatedly without an age question,
from any page, with any wording. `protective` and `adults-only` are optional presets; neither scans content.
The studio chooses its settings in shop.json; [shop/SHOP.md](shop/SHOP.md) explains them.

```sh
npx homie-studio shop init --supporter        # shop.json with a US$5 Supporter pack, and SELLING.md (the owner's plain words)
npx homie-studio shop check                   # the studio settings and provider requirements; every build checks them too
npx homie-studio shop catalog [--have <file>] # the items as Products in Stripe: the read, then the exact writes (Stripe's MCP)
npx homie-studio shop connect                 # Stripe browser approval; reports any remaining Worker credential step
npx homie-studio shop                         # open (test or live) or what is missing
npx homie-studio shop refund ord_…            # an ASK: the owner taps once (or Refund in /_studio/office/shop)
```

Connect with `stripe_login` or `shop connect`: the owner approves Stripe's official browser page, sandbox first.
Where the CLI supplies a transferable legacy test key, the toolkit creates the webhook and installs both Worker
secrets privately. It reports the 90-day expiry; `shop connect --renew` obtains approval again. Current CLI OAuth
and live mode cannot export an independent Worker's key, so the result names that limitation. Only if the owner
chooses the fallback does `shop connect --manual` open the old local key page (`--manual --live` for live mode).
Never request a key in chat. Login is not a verified purchase; complete the test purchase, webhook and refund check.

Stripe's optional agent tools (`stripe agent setup`) provide MCP and skills for catalog work (`shop catalog`),
tax reads and sales questions. They are separate from the Worker's credentials. Never create a webhook through
MCP because its response contains a secret. From 2026-10-31 Stripe MCP accepts only OAuth or Agent-tagged keys;
that change does not affect the shop's ordinary restricted API key. [SHOP.md](shop/SHOP.md) describes the flow.

In a game: `createShop()` from `@homie-rocks/studio/shop` (`has`, `entitlements`, `on('change')`, `open`, `used`, `add`, `checkout`, `buy`); a
supporter's badge rides on their seat (`peer.badge`). Stripe Checkout (hosted), optional Stripe Tax, or Stripe Managed
Payments (Stripe as seller of record, 3.5% more) as one switch; a signed, idempotent webhook; refunds from the
office, per order or line; a dispute never touches the account; referral statements signed per referrer (homie.rocks is one more
referrer). The guide: `shop/SHOP.md`.

## Setup status

```sh
npx -y @homie-rocks/studio@0.18.2 setup status --connector yes   # before a studio exists
npx homie-studio setup status                                    # in a studio (also: homie-studio doctor)
```

One checklist of what this computer and the person's accounts have for a studio: Node.js, the Homie
connector (the AI says whether its Homie tools are there; the directory is reached), Cloudflare (signed in
with the studio's own Wrangler, and the account's email verified: a deploy that went through proves it, a
deploy refused for it is remembered), Chrome for the checks, ffmpeg, and the optional GitHub, ElevenLabs and
fal (and, in Claude Code, the status line); in a studio that sells (shop.json), a Stripe row: whether Stripe's own
agent plugin (its MCP server) is set up for this AI, with `stripe agent setup` as the fix (0.24.3); and in a studio, whether Clef is on this
computer (Ollama with `clef-flash`, optional, never downloaded without the person's yes) (0.24.4). Each row is green, missing or "do this now", says what it
unlocks, and gives the exact fix: a command the AI runs or a page the person taps. It only reads, answers in
seconds, and never prints a key, a token or an account's name or id. A studio the Claude app's setup card made
(`setup attach`) counts as connected to Cloudflare and GitHub there. `--json` gives the rows.

When a server's AI guides think with Workers AI (0.18.1), a **Workers AI** row checks that the model they use
(`HOMIE_BRAIN_MODEL` in wrangler.jsonc `vars`, else `@cf/meta/llama-3.1-8b-instruct-fp8-fast`) answers on the
studio's account: one tiny call through Cloudflare's API with the studio's own Wrangler login (a one-word prompt,
one token out: about 0.1 of the 10,000 free neurons a day; `lib/brain-probe.mjs`). A model Cloudflare moved to
Workers Paid (error 5035) or retired (5007) is named, with what to do: pick another model, or, the person's money,
Workers Paid. A spent daily allowance (3036) is said as that, not as a broken model.

A missing connector never blocks (0.30.2): a session that can run commands makes, deploys and lists a studio with
this toolkit alone (`new`, `deploy`, `publish`), and the connector row says so. With `--client codex` or
`--client grok` (in Codex the toolkit also reads the app from its environment) two things more:

- **The connector's name.** The Homie plugin's connector is the MCP server `homie`. When the app's own
  configuration (`config.toml` in its home folder, or `.codex/` or `.grok/` in this folder) already has another
  server of that name, the plugin's does not load. The row says so and gives the command that adds Homie's connector
  under its own name (`codex mcp add homie-rocks --url https://homie.rocks/mcp`). It reads only whether that entry is
  an address or a command; the command itself is never read out.
- **Homie's holds**: whether the plugin's hooks ran in this app in the last ten minutes, from the dated mark
  they leave in `.cache/homie-studio/holds/` of the home folder. Off means nothing is held: Codex runs no plugin's hooks
  until the person trusts them in `/hooks`, and Grok Build runs them once the plugin is trusted
  (`grok plugin install … --trust`); the row says which.

`homie-studio demo` answers without a network too (0.30.2): where it cannot reach the arcade it names the arcade's
standing first pick, with `reached: false`.

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
embedded, so it loads nothing but Google Fonts. CODEX.md is never among a static game's
served files.

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
card on a make or a port) and hand the work to a Claude Code session with a prefilled prompt. The session
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

## Running it here: `homie-studio dev`

```sh
npx homie-studio dev [--port 8787] [--timestamps]   # the whole site on this computer, until it is stopped
npx homie-studio dev --stop                         # this studio's dev server only
```

Every command needs Node.js 22 or newer and says so at once on an older one, before it does anything.

**Rooms here are always local.** A studio that is live on its own domain has routes in `wrangler.jsonc`, and Wrangler
serves a config with a route as that production hostname: games would be handed a room socket on the live site. So
`dev` runs Wrangler from a copy of the config without `routes` (in `.wrangler/`; `wrangler.jsonc` is never changed),
then reads one game's page back and checks that the room socket it hands out is this computer's own address, port
included. If it is not (a `dev.host` in the config, say), `dev` stops and says so. No wrapper script is needed for a
route-free preview.

**A game added while it runs** is picked up. `dev` serves what `build` wrote: a new game folder that is not built is
named with the command, and once it is built, a running site that still answers 404 for it is restarted by `dev`
itself, on the same address.

**Stopping, and stale state.** `dev --stop` stops exactly the processes this studio's dev server registered, and
nothing else. A server stopped another way (a closed terminal, a kill by process id or by port) leaves its
registration behind; `dev` and `dev --stop` both notice, remove it and say it was stale, stop a local runtime left on
the port when it runs from this studio's folder, and name anything else on the port without touching it. Never stop
a dev server with `pkill` or by port: another project's would go too.

The registration is one file, `<folder of wrangler.jsonc>/.wrangler/homie-dev.json`, and it is the whole contract:

```json
{ "pid": 4242, "child": 4243, "port": 8787, "at": "2026-10-06T12:00:00.000Z" }
```

`pid` is the process that owns the server, `child` the Wrangler it started (optional), `port` the local port, `at`
when it started. `dev --stop` and the MCP tools `preview_run` / `preview_stop` read only this. A process it names is
signalled only while it is still this studio's: alive, and its command line names the studio's folder, or its working
directory is inside it, or it is still the kind of program its key says (`pid`: homie-studio; `child`: wrangler or
workerd). So a studio's own wrapper script that writes this file, and is started from the studio's folder, is stopped
by `dev --stop` like the built-in one; it should delete the file when it ends.

**Room lines carry a time.** Wrangler prints a room socket opening (`GET /<game>/__net 101`) and a runtime error such
as `Network connection lost` with no time on them. `dev` puts this computer's clock in front of those lines (every
line with `--timestamps`), so they can be laid beside a check's own report. A connection-loss line is printed when a
browser or a host leaves abruptly, and also when a room operation really failed: the time is what tells them apart.

## The site's address, its routes, and what a deploy says

`deploy` keeps the `workers.dev` address in `.studio/local.json`, which git ignores: it
names the Cloudflare account, often after its owner. A custom domain goes in studio.json
as `cloudflare.domain` and is what the directory claim, `publish`, `check` and `stats` use.

**Routes.** `deploy` writes `wrangler.jsonc` again each time, and keeps the routes that are the studio's own exactly
as they were written: a custom domain (`{ "pattern": "play.example.com", "custom_domain": true }`) and an exact-host
route (`{ "pattern": "play.example.com/*", "zone_name": "example.com" }`). A zone's other routes are never
changed or removed. On a custom domain, `deploy` and `deploy --plan` read the domain's Worker routes first (two GETs
with the sign-in Wrangler already has) and warn, before anything is deployed, when another Worker's catch-all (`*/*`)
or wildcard (`*example.com/*`) covers the studio's hostname: that route answers the hostname before the studio does,
it belongs to another site on the domain, and it must not be edited or removed. The warning gives the one safe fix,
the studio's own exact-host route, as the exact line; `deploy --own-route` adds that line and nothing else, only when
the read showed it is needed. Routes that could not be read are said as unmeasured, never as fine; after the deploy,
a domain that answers as something else still gets the route to add. A wildcard or catch-all route (`*/*`) in the studio's own config would hand every
hostname of the zone to the studio's Worker, so `deploy` refuses it before it asks Cloudflare anything; a studio that
really owns the whole zone says so in studio.json (`"cloudflare": { "allowWildcardRoutes": true }`).

**One deploy at a time.** A second `deploy` of the same studio is refused while one runs (`.studio/deploy.lock` names
its process and start time); a lock left by a deploy that was killed is taken over by the next one.

**Which games changed.** Each deploy prints, per game, `changed`, `unchanged` or `new` against the last deploy from
this computer, and the game's **build hash**: the one `homie-studio build` printed for it, that
`site/dist/_site/build.json` keeps, that `perf` names a run's build by, and that the live site answers with in
`/.well-known/homie-studio.json` (`games[].build.hash`). There is one hash, so a local build is matched to what is
live by comparing two strings. `build` says changed "since the last build here"; `deploy` says changed "since the
last deploy from this computer", from its own record in `.studio/local.json`. A deploy from another computer, or the first one, has nothing to compare with and says so.

**The directory.** Going online lists nothing. For a studio this computer already listed with `publish`, the first
deploy after an older toolkit's (one that still offered a game's whole source) asks the directory to read the studio
again, once, so it does not keep that offer. `publish` says how many publishes are left today when the directory gives the number (the
beta has a daily cap), and before it sends, how many this computer has sent today; a refusal for the cap is said as
that, with when it ends.

**This computer's network.** When Node.js cannot look a public hostname up (a browser on the same computer may still
open it), the command says "network preflight failed", not that the site or a game is broken, and offers the local
dev site instead.

## A trailer: `homie-studio trailer`

```sh
npx homie-studio trailer crown-thief --url http://127.0.0.1:8787 --seconds 45 --length 20 --title "CROWN THIEF"
```

One command, into `videos/crown-thief-trailer/`: the game rendered frame by frame on a virtual clock (its
`requestAnimationFrame`, `performance.now`, `Date`, timers and CSS and Web animations all move 1/30 s a frame, so no
frame is held however heavy the game), its sound rebuilt from the game's own sound files and the log its sound player
keeps of what it played, the shots picked from that log, an end card, and 16:9, 1:1 and 9:16 files. The work is the
Homie plugin's video skill; this command finds its script and hands over (`--skills <folder>` when the plugin is not
beside the package). The skill's guide says what the virtual clock does not reach (the audio clock, media elements,
Web Workers, a live server) and what a game must do for its sound to be in the film.

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
(Chrome's TaskDuration), time to the first meaningful frame (`load.look`: the play page's arrival card), to the
game's first frame, to a seat and to playable (control-ready: seated, a body reported, the loading cover gone) and,
beside it, `load.ready` (when the game itself called `net.playable()`) with the arrival mode (`load.arrival`: `auto`,
`game`, or `seat` for an older helper; under `auto`, `lateMs` is how long after the cover lifted the game said it was
ready, which is a game that should declare `arrival: 'game'`), the game's files on the wire, the heap
after a garbage collection, and netplay messages and kilobytes a second each way. Two more are measurements of the
running game, not estimates from its files: `load.prePlay` (every request the browser really made up to playable,
with the bytes that had arrived of any still in flight; the metric is `load.prePlayKb`), which is first-play traffic
and not the shipped payload that `perf sizes` and `assets check` total from the built folder; and `render` (the
renderer's own draw calls and triangles while playing, metrics `render.calls` and `render.triangles`), read when the
game exposes them on its port probe (`exposePort(net, { extra: { drawCalls: () => renderer.info.render.calls,
triangles: () => renderer.info.render.triangles } })`, as the 3D starters do; `PortExtra` in the port kit types these
and the other names the playtest reads: `alive`, `mode`, `loadout`, `touchHeld`). A game that exposes neither has no
`render` numbers: the run says the cost was not measured, never zero. `--profile` adds a CPU profile per
browser in a window of its own (a `.cpuprofile` for Chrome DevTools) and its hottest functions, read through the
game's source map when the build kept one (`homie-studio build --maps` keeps it in `.studio/maps/<id>/`, never in
`site/dist`).

The computer is shared, so every run waits for the 1-minute load to fall under 0.8 per core (`--max-load`) and
records the load before and after; a run that started busy says `loaded` and `compare` leaves it out. A software
renderer (SwiftShader) makes the run `blocked`: nothing on it is judged. So does an address this computer's Node.js
cannot look up (Node and a browser do not look names up the same way): "network preflight failed", with the local
site as the way round it, never "the site is down". `compare` calls a metric better only when a
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

## Game parts: how games build on each other

Games build on each other by sharing **parts**: a piece of a game that its studio chooses to share, so somebody
making another game can use it. A creature from one game, a level from another, a bot brain from a third. Without
parts, a creator's AI has to come up with everything on its own. [`parts/PARTS.md`](parts/PARTS.md) is the design;
the plugin's `parts` skill is the method.

Creators work in chat and never type a command: "what parts are there for a chase camera?", "add the Pickup field
part from owls.example/pickup-field to my game", "make my creature a part", "share it under CC BY". Four tools do
it, named like the asset tools: `parts_find`, `part_add`, `part_new` and `part_share`.

- **A part is a piece of a game, never the whole game**, in whatever form suits it: code, assets, data, a JSON
  description, a tuned config, or a mix.
- **Agents look first.** `game_plan` and the game and plan skills tell an agent to check the `@homie-rocks/*`
  packages for the general mechanism and `parts_find` for pieces other studios shared, before writing from
  scratch, and to record in the game's CODEX (Built from) and its credits what came from where. `parts_find` reads
  the hub's catalogue and the studio's own parts; when the hub cannot be reached it says so and still answers with
  the studio's own, so an empty list never stands in for "could not look".
- **Packages are not parts.** `@homie-rocks/*` packages come from npm and are never in the catalogue. A part says
  which packages it builds on, and npm does the rest: `npm ls` says whether the studio has one, `npm install`
  installs what is missing after one line saying what and why, and npm's own output is relayed. There is no
  resolver, no version ranges and no lockfile of Homie's.
- **Use.** `part_add` fetches one exact version (the latest shared unless named), checks every file's SHA-256 and
  size before a byte is written, copies it into `parts/_vendor/<site>/<id>/` where the studio owns and tunes it,
  records where it came from (`parts/origins.json`), and credits it in the game's `credits.json` with its licence,
  who made it and the game it came from. The game imports it in one line,
  `import { createPickupField } from '@parts/owls.example/pickup-field'` (one of the studio's own is
  `@parts/<id>`). Adding it again brings the newer version: what changed is shown, `tuning.json` is kept, and a
  file the studio edited is never replaced without saying so.
- **Share.** `part_new` lifts a piece out of a game (the game still builds and plays the same) and records the
  game and studio it came from. A part is private until `part_share`, which needs an SPDX licence, an attribution
  when the licence asks for credit, and known rights to every file. It is live after the studio's next deploy.
- **What the site serves** is `sharedPartsOf(studio)` and nothing else: `/.well-known/homie-parts.json`, each
  shared version's content at `/parts/<id>/<version>/…` exactly as hashed (immutable, CORS open for GET), the
  studio's own pages `/parts/` and `/parts/<id>/`, and a **Parts from this game** band on a game's landing. A
  private part is never copied into the built site, and the Worker answers only what the built index names.
- **Publishing a game that uses parts**: `deploy --plan` shows each part's licence and attribution and says
  plainly when licences cannot be combined; `publish` (and `studio_publish`, also with `before: true`) says the
  same lines before the studio is listed. `parts add --no-install` brings a part in and installs nothing:
  `package.json` is left as it is, and a package the part builds on that the studio lacks is named NOT INSTALLED
  with the npm command that installs it.

## A game as an app of its own (`homie-studio standalone`)

`homie-studio standalone` turns a game into a desktop app for macOS, Windows and Linux (the kind of build Steam
accepts for upload) and a phone app for iOS and Android (the files the App Store and Google Play accept for
upload; each store's review, fees and rules are its own). It is the same web build of
the game in the thinnest shell each platform has (Electron on computers, Capacitor on phones), and nothing about
one game lives in a shell. Multiplayer still goes through your studio's own deployed site; with no connection the
game plays offline with its bots. [`standalone/STANDALONE.md`](standalone/STANDALONE.md) is the guide; the
plugin's `standalone` skill is the method, and in chat it is the `game_standalone` tool.

```sh
npx --no-install homie-studio standalone plan <id>     # what would be built and what is missing; changes nothing
npx --no-install homie-studio standalone build <id>    # every target this computer can make
npx --no-install homie-studio standalone run <id>      # the built desktop copy, here
npx --no-install homie-studio standalone steam <id>    # Steam's build file; uploads nothing
npx --no-install homie-studio standalone ci <id>       # a GitHub workflow that builds all five
```

The wrapper tools are installed at exact versions into `.studio/standalone/<id>/` on the first build, so this
package gains no dependency and a studio that never makes a standalone copy downloads none of them. A target
whose tool is missing on this computer is skipped with its fix, and the others still build. Signing reads
environment variables only, and nothing is ever uploaded to Steam or a store: the exact steps are printed. The
desktop build for the computer it is made on is started once, and the result says whether the game loaded;
every other target says "built, not started on this computer".

**What the standalone game does not have (v1):** player accounts and sign-in, cloud saves (saves stay on the
device and are lost when the app is uninstalled), the shop, room chat, watching and the big screen, servers
other than the public one, automatic updates, and a signed Windows build. For Quick play to find a room, a
studio must be on 0.32.0 or later **and deployed**; a room made or joined by its code works with an older site
too (seen against 0.31.0, not promised for every older version).

**On your own iPhone or iPad:** `standalone run <id> --for ios --device` builds the game for the one phone
plugged in, signs it for your Apple team, installs it over the cable, starts it and looks for it among the
phone's running programs. `--device` is your yes to what it changes: it adds the phone to your Apple team's list
of development devices.

**What has not been run:** the Windows and Linux builds have never been started; nothing has been started by
Steam (its overlay, which Electron apps often do not show, included); a Developer ID signature, notarization and
the iOS archive have never been made; nothing has run on a real Android phone, and Quick play has not been seen
online from a phone. The guide lists it all.

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
npx homie-studio assets use crown-thief old-tree unused  # what the game does with it now: cast, prop, environment, unused
npx homie-studio assets lineup crown-thief               # true scale, silhouettes, palette drift: .studio/art/<id>/
#   three lineups: the inventory (every recorded model), the cast (what is in play), the environment (the scenery)
npx homie-studio assets rights crown-thief               # games/<id>/assets/RIGHTS.md and the credits
npx homie-studio assets redo crown-thief lantern         # made again from its kept raw file, free
npx homie-studio assets remove crown-thief lantern       # the record and the copy the game ships
```

A game's look is a set of decisions (`games/<id>/codex/decisions.json`, private like the codex, drawn in its Art
direction tab): render style, palette, shape, proportions, materials, light, camera, fonts and effects; the cast, its
library family, scale and phone budgets; the skeleton standard and the clips each role needs. Each starts as an automatic pick with a
why. A person's nudge makes it steered, their lock freezes it, and the first asset built on an automatic one pins it.
Every asset records the revision of each decision it was made under, so changing one lists exactly what went stale and
what remaking it would cost; nothing is remade by itself. `games/<id>/style.json` (public) is the palette, fonts, light
and camera the game, its landing and its title cards draw with.

Every model, texture and sky a game ships has an entry in `games/<id>/assets/manifest.json`: its route (procedural,
library, generated, imported), each step that made it, its licence, its measurements. From it:
`RIGHTS.md`, the credits on the game's landing, `assets check` and the licence check `publish` makes. Models are refused when they load anything
from an address or are over the size caps; `assets add` makes them phone-sized (meshopt geometry, WebP pictures, the
pivot at the bottom centre, scaled to metres) with @gltf-transform, meshoptimizer and sharp; raw files stay in
`art/<slug>/raw/`, which git ignores.

`assets check` is an **inventory estimate**, and says so in everything it prints: the recorded files' own triangles,
draw calls and pictures, each times its declared `placements`. It never runs the game, so geometry the code builds,
copies the code draws beyond `placements`, effects, and shadow and post passes are not in it; a pass is not a measured
frame (the playtest and perf guides measure the running game). What it does measure:

- **Standalone textures and skies** (a `texture` or `sky` record's own pictures): there, the file recorded (SHA-256),
  decodable, within size (a note past 1,024 px, a problem past 2,048 px; a sky twice that), and their mipmapped memory
  added once per unique picture. A row with nothing measured prints `??` and why, never `ok`. Shipped pictures under
  `public/` that no record names are listed with their size, apart from pictures the folder keeps but never ships;
  neither is in the sum.
- **Maps the game does not draw.** A model's normal and roughness maps are counted unless the manifest says the game
  draws base colour only (`stylize()` with a toon, flat, pixel or hand-painted material model keeps nothing else):
  `"inGame": { "maps": "base" }` on a record, or once at the top of `assets/manifest.json` for every model
  (`"maps": "all"` on a record keeps its own). The check never guesses this from the code; without the declaration it
  says how many MB are such maps.
- **The game's own model budget.** game.json `"assets": { "budgets": { "triangles": 4000, "bytes": 600000 } }` (the key
  the loader's development warnings read) raises what a model may be in the check and in `assets add`, never past a
  hard cap and never lowering a hero's. One key, read once: the check, `assets add` and the build (for the loader)
  take the same numbers. A budget may also be set for one tier (`"hero": { "triangles": 12000 }`; tiers are hero,
  npc, prop, signature, kit); the loader knows no tiers, so it is given the loosest one, and a number past a hard cap
  is held to the cap by all three (the build says so).
- **Usage.** `assets use <game> <asset> unused` marks a file the game no longer draws: it stays in the inventory
  lineup, leaves the cast and environment lineups and the scene sums, and still counts in the shipped payload until
  `assets remove`. Unset, usage follows the asset's kind.
- **Shipped payload** (`totals.shippedPayloadMB`; `firstPlayMB` is its old name, kept for existing readers): every
  file of the last build, gzipped. A conservative gate on what the game ships, not a trace of what a browser fetched
  before the first round.

In a three.js game, `@homie-rocks/studio/assets` is the one loader:

```ts
import { createModels } from '@homie-rocks/studio/assets';
const models = createModels();
const fox = await models.instance('./models/fox.glb').catch(() => models.placeholder({ x: 0.6, y: 0.7, z: 0.9 }));
```

It checks every file before three.js parses it (no external URIs, no buffer over the cap, only extensions three.js
reads), decodes meshopt, clones skinned models properly, and says in development when a model is over its budget
(`stats()`, `window.__homieModels`). The budget is a small prop's (1,500 triangles, 300 KB) unless the game sets its
own once, in game.json: `"assets": { "budgets": { "triangles": 8000, "bytes": 1500000 } }` (per model). `game new <id> --from gem-rush-3d` is Gem Rush in 3D, dressed from the library.
The local MCP's `style_explore`, `decision_set`, `assets_plan`, `assets_find`, `asset_add`, `asset_make`,
`asset_check`, `asset_lineup` and `asset_rights` do the same with cards. Generated props (on the person's own fal
account, under a budget, receipted) are the Homie plugin's `models` skill.

## Characters, rigs and clips (`homie-studio cast`, `homie-studio anim`)

```sh
npx homie-studio assets find "knight" --kind character   # animated CC0 characters: KayKit, Kenney
npx homie-studio assets add heroes kaykit-adventurers/knight --as knight --height 1.45 \
  --keep "1H_Sword,Round_Shield,Knight_Helmet,Knight_Cape" --verbs idle,walk,run,jump,attack,hit,die
npx homie-studio assets add heroes --file ./hero.glb --kind character --rigged --license own --as hero
npx homie-studio cast heroes                               # proportions, palette, skeleton family, every character
npx homie-studio anim plan heroes                          # each character's clips against the verbs the game needs
npx homie-studio anim add heroes knight --verbs block,dodge # more, retargeted onto its skeleton (free)
npx homie-studio anim preview heroes --asset knight        # looping previews and a sheet: .studio/art/<id>/anim/
```

A rigged character comes in as two files: `public/models/<asset>.glb` (its joints renamed to the skeleton standard:
VRM 1.0 humanoid names, a mini family for one-piece limbs, a quadruped family; helper bones that move nothing removed;
every part and every held thing it keeps merged into one skinned mesh, one draw call; phone-sized) and its skeleton's
clip library `public/anims/<skeleton>.glb`, shared by every character with that skeleton. Clips are its own where it
has them, else retargeted at build time from the starter library's CC0 humanoid clips (KayKit's): every bone turns in
the world the way the source's turned from its rest, after the two rest poses are lined up bone by bone, so a T-pose
clip plays on an A-pose rig; a one-piece limb aims where the source's whole limb points. It is plain matrix math in
Node (no renderer), so it runs in CI and a cloud session too. One clip library a skeleton: a second one is refused
when it is recorded (it used to hide the first), unless its record says `"rig": { "supplemental": true }`, in which case
its verbs join the character's coverage and previews and the game loads both
(`loadCharacter(models, url, { anims: [base, extra] })`). `anim plan` and `anim preview` also show how fast each
character's walk and run move its feet over the ground on its own rig (kept as `rig.gait`): animate's default
`runSpeed` of 4.2 m/s is not measured on your rig, and a clip retargeted onto a taller character covers more ground,
so start `tune: { runSpeed }` from that number. It is a guide from the foot bones, not a verified foot contact.
Removing a starter character keeps its pack's credit while any clip retargeted from it remains. `assets check` holds characters to four influences a
vertex, the tier's bones, a clip library of 1 MB at 30 samples a second, every verb the game's `anim.clips` names,
and the skinning a room costs on a phone (players times the heaviest character: 60,000 vertices and 1,200 bones a
frame).

In the game, `@homie-rocks/studio/animate`:

```ts
import { crowd, loadCharacter, ANIM_TUNING } from '@homie-rocks/studio/animate';
const knight = await loadCharacter(models, './models/knight.glb', { tune: T });   // finds its clip library itself
scene.add(knight.root);
// each frame: knight.root.position.set(x, h, z); knight.face(yaw, dt); knight.move(speed); knight.air(onGround, vy); knight.update(dt);
// events: knight.jump(); knight.act('attack', { from: 0.15 }); knight.hit(dx, dz); knight.die(); knight.hold('win');
crowd(characters, camera);                                  // far and off-screen characters pose less often
```

Idle, walk and run blend by ground speed at the rate the feet need; an action while moving plays on the upper body;
a hit is an additive flinch with a hit-stop; jump, fall and land squash and stretch on springs; it leans into turns,
turns its head toward a point, swings tails and capes on springs and plants humanoid feet on slopes. Every number is
an `ANIM_TUNING` entry for the game's tunables.json, so the Game Lab tunes it New beside Today.
`game new <id> --from hero-rush-3d` is the arena with KayKit's animated heroes and skeletons: run, jump, swing, a
cheer for the winner. The local MCP's `cast_plan`, `anim_plan` (looping previews; Feel opens the Game Lab on the
move), `anim_add`, `anim_preview` and `character_make` do the same with cards. A generated, rigged character (a concept
in the locked style, then Meshy's mesh and auto-rig on the person's own fal account, about US$1.44, priced and
receipted) is the Homie plugin's `models` skill; rigs, clips and feel are its `animate` skill.

## A model you can stand on (`homie-studio collision`)

Importing a model records what it looks like. It does not say where a figure may walk on it, so the first playable
version of a generated landmark is one figures fall through.

```sh
npx homie-studio collision bake harbour-run lighthouse.glb --cell 0.25   # a height grid off its triangles, beside it
npx homie-studio collision check harbour-run                          # stale? proxies well formed? every route walked?
```

`bake` writes `lighthouse.collision.json` (the grid sampled off the model's outside surface at the cell size you give,
the SHA-256 of the file and a checksum of its triangles) and `lighthouse.collision.svg`, the plan at true scale (40 px to
the metre). Three things in the JSON are yours, and a re-bake keeps them: `"proxies"` (boxes, cylinders and ramps for
what a figure walks around), `"mover"` (the body that must fit: radius, height, step, and the arrival radius the
game's bots really use) and `"routes"` (ways a bot should be able to walk, as lists of points). `check` fails, with a
row for each thing wrong, when the model's surface changed since the bake, a proxy is malformed, or a body of the
mover's size cannot walk a route: it says where it fell or what was in the way, and marks the spot on the plan.

The game loads the JSON with `unpackBake` and `bakeField` from `@homie-rocks/heightfield/MeshBake.js`, and calls
`bakeStale` against the mesh it loaded. The command needs `@homie-rocks/heightfield` installed in the studio (it says
so when it is not). Buildings with rooms and roofs, zone marks on every level and staged capture positions are that
package's `Levels.js`, `Route.js`, `Markers.js` and `Pose.js`: its README has them.

## Bots that want different things (`@homie-rocks/studio/personas`)

```ts
import { PERSONAS, createPersonaBrain, botStats, seededRng } from '@homie-rocks/studio/personas';

const who = createPersonaBrain(PERSONAS.bully, { rng: seededRng(roomSeed + slot), arena: { solid } });
const target = who.choose(self, candidates, rivals);          // candidates: { x, y, kind, value, size? }
const push = who.steer(self, seek(self, target));             // turned off any wall ahead
```

One scorer (value against distance, with a target behind, a wall in the way, company near it and a bigger rival each
costing some of the score) and five rows of weights: `glutton`, `bully`, `racer`, `scavenger`, `sneak`.
`persona('sneak', { kinds: { beacon: 6 } })` extends one. `solid(x, y)` is the game's own wall test; line of sight
and wall avoidance use nothing else. `who.chooser(...)` is the `choose` the port kit's `BotBrain.think` takes, so the
room's skill dial still sets how late a bot reacts and how well it aims: a persona is what it wants.
`who.stats()` / `botStats([...])` count what each bot picked (kinds, mean value, distance, facing, company, picks
behind walls) and `personaSpread` is one number for how unlike each other they were: assert on those in the game's
own test, because weights that look different often play the same. The only randomness is the `rng` you pass. The
host owns the bots; nothing here is sent anywhere.

## Power-ups whose timers survive a host change (`@homie-rocks/studio/powerups`)

```ts
import { createPowerups, stepPowerups, collectPowerups, resolveHit, biteRadius, collides, packPowerups, unpackPowerups } from '@homie-rocks/studio/powerups';

let power = createPowerups(SPOTS.length, roomSeed);                    // host
({ state: power } = stepPowerups(power, dtMs));                        // host tick: timers, expiry, spawns
({ state: power, events } = collectPowerups(power, bodies, SPOTS));    // who touched what (lower slot on a tie)
snapshot.power = packPowerups(power);                                  // host: in the snapshot AND the checkpoint
power = unpackPowerups(snapshot.power);                                // replicas, and a new host, once
```

Everything is one plain object and pure functions over it, so the rules are unit-tested and nothing reads a clock.
The state holds how long each power-up has **left**, not a deadline, and the spawn sequence's seed: a browser that
becomes host mid-timer carries on from the last snapshot and spawns the same next pickup. Three kinds are built in:
Magnet (`biteRadius` is wider, `magnetPull` draws loose things toward the mouth), Phase (`collides(state, a, b)` is
false) and Shield (`resolveHit` blocks one hit and returns the velocity to bounce the attacker with). Add a kind by
adding a row to the rules, last (a kind travels as its index). `powerFlags` is a bitmask per body. It is the game's
own snapshot data: the netplay wire protocol is unchanged, and a tab on an older build drops kinds it does not know.
`powerDraws` fills instance matrices for three instanced meshes the game owns (gems, magnet rings, shield bubbles) and
`hudPills` says what the HUD shows; both are optional and import no renderer.

## Checks on a computer without a GPU

`check`, `port check` and `look` run Chrome headless. On a Mac they use its GPU. On Linux (a Claude Code cloud
session, GitHub Actions, a container) `npx homie-studio chrome install` puts Chrome for Testing in
the home folder's `.cache/homie-studio` (from storage.googleapis.com, which a cloud session's default network reaches), and WebGL
renders with SwiftShader. `check` reports how fast each browser drew the game and on what renderer; on SwiftShader
it says the frame rate is not a person's, and judges only seats, rooms and rounds.

`check` reports three things apart: **seated** (a room, a seat, a role), **ready** (`readiness`: the play page's
loading cover has lifted; the picture it calls `<browser>-playing.png` is taken only then, and a browser still
covered is saved as `<browser>-loading.png`), and **connected** (`connection`, `reconnects`, `uninterrupted`: a
round both browsers finished is `ok`, and whether one of them reconnected on the way is said beside it; a browser
seen `reconnecting`, `alone`, `offline` or `closed` (the helper's link) is listed as `cutOff` and the connection is
not called uninterrupted, whether or not a counter moved). `perf` leaves out a run whose browser ended its window cut
off from the room. A site this computer's Node.js cannot look up does not stop `check` or `shoot` (their browsers may
still open it); if the browsers cannot either, they report the same BLOCKED network preflight as `perf` and `port check`.
Nothing listening on this computer's own address stops all four at once: "does not answer: start the site".
`port check`'s big-screen row requires the join QR on an address a phone can reach and marks it not applicable on a
loopback preview, where the page hides the join card on purpose.

### Pictures on a stepped clock: `homie-studio shoot`

```sh
npx homie-studio shoot crown-thief --url http://127.0.0.1:8787 [--frames 60] [--fps 30] [--device computer|phone] [--hold KeyD] [--no-smoke] [--timeout 180]
```

For a 3D game where there is no GPU and the software renderer draws two frames a second. First a smoke check: two
clients (a computer and a phone) open the play page in one private room (`?room=shoot-…`) and must both get a seat
there, on different seats, with neither playing alone offline. Then the first client's clocks are frozen and stepped:
`requestAnimationFrame`, `performance.now`, `Date`, `setTimeout`, `setInterval` and CSS/Web animations move by
exactly 1/fps of a second per frame, in the page and in the game's frame, and each step is one picture
(`.studio/shoot/<id>/frame-0001.png` …, with `shoot.json`: each frame's time, and the round phase, position and
renderer counters when the game has a port probe). Not stepped, and said in the result: the room's socket and its
server clock (other players arrive in real time), Web Audio's clock, `<video>`, workers. The frames show what was
drawn; they are never a frame rate. Everything is bounded by `--timeout`; a run that hits it keeps the frames it has
and says `partial`.

`shoot <id> --preview` needs no site running: it serves the built game itself (the light server `preview <id>` uses:
no Wrangler, no rooms, the game alone and offline with its bots) and shoots that page. The smoke check is not run
there (it needs rooms: use `dev` and `--url`). The result names the build the frames are of, by the hash `build`
printed and the hashed bundle the page loaded.

## Another way to Cloudflare: Stripe Projects (a prototype, 0.24.3)

`npx wrangler login` stays the way. For a creator with no Cloudflare account (and no ElevenLabs), Stripe Projects
(Stripe's CLI plugin, docs.stripe.com/projects) can make or link both on the person's own Stripe sign-in, on free
plans, and hand the credentials to the studio folder:

```sh
npx homie-studio setup --via stripe-projects [--with elevenlabs] --dry-run   # what it would do; changes nothing
npx homie-studio setup --via stripe-projects [--with elevenlabs] --accept-tos  # after the person accepted the providers' terms
```

It stops with a `needs` step at each thing that is the person's (the Stripe CLI and its Projects plugin, Stripe's
sign-in, the providers' terms, Cloudflare's own approval page for an existing account); it never adds a paid plan or
a payment method. The Cloudflare account id goes in studio.json with `"auth": "stripe-projects"`; the token stays in
Projects' vault and the git-ignored `.env` it syncs, and every Wrangler run in the studio takes it from there
(`deploy`, `dev`, secrets, the office). It checks read-only what the token can do (Wrangler signed in, D1, Workers AI;
R2 is optional) and that `.gitignore` keeps `.env`, `.env.*`, `.projects/vault/` and `.projects/cache/` out of git.
With `--with elevenlabs` the music skill finds the ElevenLabs key there too (ElevenLabs' free plan has no commercial
licence). Unverified until a real run: the exact JSON of the Projects commands, and the Cloudflare token's permission
groups, which the checks measure instead of assuming.

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
| `lib/build.mjs`, `lib/stage.mjs` | `build`: games bundled with esbuild (ES modules with code splitting, the bundle named by its content) into `site/dist`, `games.json` and `_site/build.json` (each game's build hash and whether it changed). Built in a folder of its own and put in place only when all of it is there; a game that does not build fails the command and leaves `site/dist` as it was (`site/SITE.md`, "The build"). |
| `lib/typecheck.mjs` | `build --types`: the games' TypeScript checked with the studio's own `typescript` before anything is built. |
| `lib/preview.mjs` | `preview <id>`: one built game's files at an address on this computer, with no Wrangler and no rooms. |
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
| `worker/site.mjs`, `lib/site.mjs`, `lib/markdown.mjs`, `site/SITE.md` | The site: its sections, each game's landing, posts and their feeds, the look (theme tokens) and what the studio's `site/` folder overrides; the safe markdown posts are written in. `worker/pages.mjs`: the play page; `worker/arrival.mjs`: its arrival card. |
| `worker/stats.mjs`, `worker/stats-page.mjs`, `lib/stats.mjs` | The studio's own stats: what is counted and how, the owner-only `/api/stats` and `/_studio/stats`, and `homie-studio stats`. |
| `lib/media.mjs`, `media/MEDIA.md` | The `music/` and `videos/` manifests: which entries get a page, and where each file's bytes come from (the site itself up to 25 MiB a file, the studio's R2, or a link). `media list` shows it; `media move` puts the big ones in R2 and records each one's SHA-256; `media put` uploads a loose file to `/media/<key>`. |
| `netplay/` | The netplay contract (`NETPLAY.md`) and its game helper (`@homie-rocks/studio/netplay`). |
| `starters/gem-rush/` | The reference multiplayer starter. |

Versions are immutable: a published version never changes, so a studio that pinned one
never changes by surprise. A change ships as a new `version` on the npm registry as
`@homie-rocks/studio`, which is what `homie-studio new` pins (the exact version; package-lock.json keeps its
integrity). The registry is what Workers Builds and a Claude Code cloud session reach by default.

## Beta

This is a beta. Bugs, port requests and questions go to
<https://github.com/homie-rocks/homie/issues/new/choose>, or, from inside Claude or Codex, to the people who make
Homie as a short note you see and send yourself (`homie_feedback`, above).

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
