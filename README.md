# Homie

A studio in a box for your AI: make games, music and video, and publish them from a studio
that runs on your own Cloudflare, on the free plan.

> **Beta.** Homie for studios is in a friends beta. Bugs, port requests and questions go
> to [Issues](https://github.com/homie-rocks/homie/issues/new/choose); read
> [Known issues](#known-issues) first.

Homie is a plugin for Claude Code, Codex and Grok. Ask it to *"set up a game studio called
Night Owls and make a multiplayer game"* and it:

1. makes a **studio**: one folder you can see and open, a git repository with `games/`,
   `music/`, `videos/`, `posts/` and `site/`, and an `AGENTS.md` that tells your AI how
   everything in it works;
2. makes your **game**, built on the Gem Rush starter and the netplay contract: every browser
   renders the game itself, strangers who press Play meet in the same public room,
   bots fill empty seats, and rounds end and restart on their own;
3. **proves it**: two fresh browsers (a computer and a phone) press Play, and the check
   passes only when they share a room and finish a round;
4. **deploys** the studio's site to **your own Cloudflare account**, after you approve
   Cloudflare once in your browser (a free account, no payment method: it says what it
   will create and what it costs before it does). The site has the same sections as
   homie.rocks in your studio's own look (Home, Games, Music, Videos, Rooms, Posts), and
   every game gets a landing page of its own, in the game's own palette: a full-bleed hero
   from its footage or art, a big Play button into a public room, phone / computer / TV,
   live rooms, credits, and "Make a game like this". Play never opens on a blank screen:
   the game's title, art and a progress line show while its room connects and it loads.
   Search engines and AI agents read it correctly: schema.org data on every page (a full
   VideoGame on each landing), and a sitemap, robots.txt and llms.txt made from what is public;
5. **lists** the games in the [homie.rocks](https://homie.rocks/studios/) directory, so
   people can find them.

Your AI runs the commands. You approve what matters.

## Install

**Claude Code**

```
/plugin install homie --marketplace homie-rocks/homie
```

One line, inside a session (Claude Code 2.1.275 or later): it asks you to confirm the marketplace, then opens
the plugin's details, where you pick a scope. From a terminal it is two commands,
`claude plugin marketplace add homie-rocks/homie`, then `claude plugin install homie@homie` (the terminal's
`install` takes no `--marketplace`). Claude Code then says "9 userConfig options not yet set": those
are the Homie mod's nine switches, every one optional and already at its default, so nothing is left
to do (`/plugin configure homie@homie` changes one).

**Codex**

```
codex plugin marketplace add homie-rocks/homie
codex plugin add homie@homie
```

Or run `/plugins` in Codex and install Homie from the Homie marketplace. Start a new
session afterwards so the skills and tools load, and open `/hooks` to trust Homie's three hooks. They
hold an edit to a protected file, a deploy, a Cloudflare change, spending past the budget and a model
download until you answer `proceed <code>`, and they take secrets out of what Codex reads. Codex runs no
plugin's hooks until you trust them, and says nothing when it skips them: the setup status has a row,
"Homie's holds: on" or "off", and a first reply says so when they are off (the plugin README's "Homie's
holds in Codex" says what they cover).

If Codex already has another MCP server named `homie` (`codex mcp list`), that one keeps the name and the
plugin's connector does not load. The setup status says so, and `codex mcp add homie-rocks --url
https://homie.rocks/mcp` adds Homie's connector under its own name. A session makes a studio without the
connector either way, with the studio's own commands.

**Grok**

```
grok plugin install homie-rocks/homie#plugins/homie
```

Grok shows where the plugin comes from and asks whether to trust it (`--trust` on the same command says yes
ahead of time): its skills, its MCP server and its hooks load only once you do. Then start a new session and
ask for a studio. Checked on Grok Build 1.0.41, where `grok plugin validate` reads the manifest as valid
(the skills, the hooks and the MCP server). Homie is not in xAI's own plugin list, so it does not show up in
a search there: install it from this repository, as above.

The plugin is `plugins/homie` (`.grok-plugin/plugin.json`, the same skills and MCP server). **Homie's holds
do not run in Grok yet.** The plugin ships the same hooks for Grok (`hooks/grok.json`) as for Codex, but Grok
Build 1.0.41 runs no plugin's hooks: none are registered in its headless and agent sessions, from any plugin
(checked 2026-10-04). So nothing holds a deploy, a protected edit or a paid call there, and no secret is taken
out of what Grok reads. Homie's skill tells Grok to ask you before each of those itself, and the setup status
says "Homie's holds: off"; it turns on by itself with a Grok that runs them. There is no Cloudflare connector
in Grok: approving Cloudflare in the browser (`npx wrangler login` on a computer) is still your step.

Grok Bot (the desktop app) does not list Homie: tell it to read https://homie.rocks/install.md and install
Homie, then ask for a studio. In Grok chat the Homie connector is the same address, `https://homie.rocks/mcp`,
and a Grok Bot that has the studio folder checks the repository in with `npx --no-install homie-studio setup
attach <hs_…> --client grok`, which does not need Claude's GitHub app. We have not run these two end to end
ourselves.

Then ask for a studio. The plugin adds fourteen skills (`studio-setup`, `plan`, `parallel`, `game`, `office`,
`port`, `publish`, `sound`, `music`, `art`, `style`, `models`, `video`, `playtest`, `perf`, `lab`) and connects the Homie MCP server at
`https://homie.rocks/mcp`, which has creator tools only: set up a studio, make or remix a game, make an
existing single-player web game multiplayer, preview it, deploy it, and list it.
A studio needs Node.js 22 or later.

A new studio follows one checklist, and never jumps ahead:

0. **Setup status** (*"what do I need for my studio?"*): Node, the Homie connector, Cloudflare (signed in,
   email verified), Chrome, ffmpeg, and the optional GitHub, ElevenLabs and fal, each green, missing or
   "do this now", with what it unlocks and the exact fix; in Codex and Grok, whether Homie's holds are on.
   Optional ones never block, and neither does a missing connector: a session that can run commands makes
   the studio with the studio's own. The person's own steps (making a free Cloudflare account) can be done
   any time, even while waiting for something else.
1. **The studio**, by name.
2. **A working game**: a live one to try at once on Homie Arcade (`homie-studio demo`), with nothing copied
   into the studio. A new studio has no game (its home page says "First game coming soon"); a copy of a
   starter goes in only when the person asks for one.
3. **One small change**, from one sentence.
4. **The plan** (`plan`, *"let's plan my game"*): a short interview (game type and genre, style, devices,
   players and rooms, art and film, music and sound, scope) that becomes the game's **Game Codex**:
   `games/<id>/CODEX.md`, drawn as a page in the game's own palette, fonts and art, with cards for its
   characters, a controls table per device, milestones, open questions and the decisions as they are
   made. It is a Claude artifact where the app has artifacts, a page in the browser otherwise, and a
   private page on the studio's site. The AI keeps it true as decisions change.
5. **Build it** (`parallel`): one agent step by step, or several at once (game logic, levels, art, sound,
   the landing page), each in its own folders, then a merge, a check, a playtest and a blind review; the
   person chooses, knowing parallel is faster and uses more of their plan. Every build has a progress
   feed: the codex's **Build status** tab (a percentage, each step and check going green, how to try it,
   what was spent) and, in Claude Code, an optional status line under the prompt.
6. **Playtest, then online** on the studio's own Cloudflare, listed in the directory.

Three skills need no account and cost nothing:

- **`sound`** (*"make sound effects and a short theme for my game"*): effects from presets and
  synthesized scores from chords and patterns, rendered on your computer, with stems and seamless
  loops, measured (loudness, clipping, late starts, what a phone speaker loses), and wired into the
  game with a small player that starts on the first touch and changes music on bar lines.
- **`playtest`** (*"playtest my game and tell me what's weak"*): real browsers on a computer and a
  phone held both ways: the first ten seconds, the look while playing, how much of the screen the UI
  covers, the game's real sound, a round with one player trying and one idle, the owner control tests,
  and a brief for a blind review by a fresh reviewer.
- **`perf`** (*"make my game run faster on phones"*, *"find out why it stutters"*): a measured loop on real
  Chrome on your computer's GPU, a computer and an emulated phone, two browsers in a room (the host and a
  replica): frame times (median, p95, long frames), the game's JavaScript and the main thread per frame, time
  to the first meaningful frame and to playable, what it downloads, the heap and netplay messages a second, then a CPU
  profile that names the hot functions through the game's source map. It tries one small change at a time,
  measures it against the build to beat in alternating runs, and keeps it only when it is better beyond the
  noise, nothing guarded got worse and two browsers still finish a round; anything else is reverted. The
  report goes in the studio's `perf/` folder, with the numbers and the before and after.
- **`lab`** (*"iterate on the jump"*, *"make the hit feel punchier"*, *"tune the drift"*): a Game Lab for one
  mechanic, on your computer. One short take plays in New (your working tree) beside Today (the last commit) on one
  clock, with the same seed and presses: slowed to a tenth or a frame at a time, with a timeline of the move's named
  phases (hit-stop, launch, slide, settle), graphs of what it does New against Today, the game's own onion skin and
  arcs, a phone view, and sliders that write the values you keep into the game's `tunables.json`. Claude instruments
  the move and commits that first, so Today is the game as it is; proposes the change as phases and numbers; and
  keeps only what you like, with the numbers (and the frame cost, measured with `perf` when it costs any) and a
  side-by-side clip.

Music, art and generated video use the providers' own accounts, asked for only when the skill is
first used:

- **`music`** (*"make a 30-second theme song for my studio"*): ElevenLabs Music through its
  official CLI (`elevenlabs auth login`, a browser sign-in) or your own API key. It says your
  plan, the rights that plan gives and the credit cost before anything is rendered, renders
  only inside the budget you set, checks that every sung line is sung, masters it, cuts
  seamless loops for games, and publishes a song page.
- **`video`** (*"make a 15-second trailer of my game"*): trailers from your game's real
  gameplay (free: nothing generated), and music videos and cutscenes with fal on your own key,
  every call priced first, capped by your budget and receipted. 16:9 and 9:16 cuts, a sync
  check and a contact sheet, and a video page. It also records any page while a script drives it
  (*"record my game page: press Play and move around"*, a site walkthrough, a demo): clicks,
  taps, keys, typing and waits, in real time, every frame one the page drew. It never passes
  generated footage off as gameplay, and puts no real people or brands in a video. With storage,
  a studio's big videos and songs live in its own R2, at the same addresses.

- **`art`** (*"make a cover for my game"*): a cover from a real frame of the game (free), and
  painted covers, backdrops and textures with fal on your own key, priced, capped and receipted;
  checks that a texture tiles and that files are small enough for a phone.
- **`style`** (*"show me other looks"*, *"make it warmer"*, *"keep that palette"*): a game's look as
  decisions (render style, palette, light, camera, fonts, budgets), picked automatically from your
  words, drawn in the Game Codex; a style board of three directions drawn by the game engine itself
  (free); steer, lock, and the blast radius before a locked one changes.
- **`models`** (*"find free models for my game"*, *"make a lantern prop"*): free CC0 models from
  Homie's starter library (Kenney, KayKit, Poly Haven, ambientCG), your own models with their
  licence, and generated props (a concept in the locked style, then Tripo P1 image-to-3D) on your
  own fal key, priced, capped and receipted; every model checked for phones, licensed, credited
  and shown in a lineup at true scale. Characters too: free animated heroes from the library, or
  one generated and auto-rigged on your fal key (an A-pose concept, then Meshy image-to-3D).
- **`animate`** (*"give my game animated characters"*, *"the jump feels floaty"*): one skeleton
  standard, the library's CC0 clips (idle, run, jump, attack, hit, ...) retargeted onto every
  character, and one shared player with blends, IK feet, springs and look-at; an Animation card
  of looping previews, and "feel" opens the Game Lab on that move. Free.

All of them but `lab`, `style`, `models` and `animate` need ffmpeg; `video`, `art`, `style`, `models`, `animate`, `playtest`, `perf` and `lab` use Chrome.

## In the Claude desktop app: one chat

On a computer, **Homie for Claude Desktop** (a Desktop Extension, [`desktop/`](desktop/)) gives the plain Claude
app Homie's tools and cards in the same chat: no terminal, no second session. Install it once (download the
`.mcpb` from https://homie.rocks/studio/desktop/ and double-click it, or drag it into Claude's window), choose the
folder your studios live in, and ask:
*"set up a game studio called Night Owls"*. The chat makes the studio on your computer, plans your game with you,
builds it, runs the two-browser check, and puts it online on your own Cloudflare, with the setup, build progress,
studio and Game Codex cards in the conversation. Claude asks before it uses each Homie Studio tool: choose
**Always allow**, so a build runs without a click at every step, and if a step ever sits on a spinner with nothing
to click, a request is waiting out of sight (press ⌘ Return, or Ctrl+Enter on Windows, or scroll the chat).
Underneath it is `homie-studio mcp`, the toolkit as a local MCP server, which any MCP client can run.

## From the Claude app on a phone, with no terminal

In the Claude app (claude.ai, the desktop app or the phone),
[add Homie as a connector](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Homie&connectorUrl=https%3A%2F%2Fhomie.rocks%2Fmcp):
the link opens "Add custom connector" with Homie filled in, and you confirm. By hand it is Settings →
Connectors → Add custom connector → `https://homie.rocks/mcp`. Then ask for a
studio. Its cards do the rest, and every approval is one tap on the provider's own page:

1. **The setup card** has three buttons: *Make the studio on Cloudflare* (the Deploy to
   Cloudflare button below: your GitHub gets the studio's repository, your Cloudflare its
   Worker, database and rooms, and Workers Builds deploys every push), *Let Claude work in
   it* (Claude's GitHub app, for that one repository), and an optional media provider. It
   follows the studio as it comes up.
2. **"Build it" cards** on a new game, a port or a remix open a Claude Code session on the
   studio's repository with ONE short line, *"Continue building Night Owls: build hb_…"*. The
   session fetches the brief itself (`homie-studio handoff`, as the studio's `HANDOFF.md` says).
   The chat opens the build first, so its progress card (stages, checks going green, a picture,
   spend and Stop) is on screen before the session starts.
3. **The pull request card**: the change goes out as a pull request with its own Preview.
   *Publish* opens it in GitHub, where your merge is the approval; Workers Builds deploys
   it, and the card says when it is live.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/homie-rocks/homie/tree/main/template)

Claude Code cloud sessions need a Pro, Max, Team or Enterprise plan; on the Free plan the
cards work and your own computer does the building. A cloud session's default network reaches
homie.rocks. If the progress card ever stops updating in a cloud session, the session's network
may be blocking homie.rocks: the toolkit says so, and names the setting.

## What the studio deploys to your Cloudflare

`npm run deploy` in a studio runs Wrangler under **your** Cloudflare login and creates,
on your account, only what Cloudflare's free Workers plan gives a new account with **no
payment method** (`npx --no-install homie-studio deploy --plan` prints this for your
studio and changes nothing):

| Resource | Name | What it does |
| --- | --- | --- |
| Worker | `<studio>` | The studio's pages (Home, Games, Music, Videos, Rooms, Posts and their feeds), each game's landing and play shell, the game files, `/api/games`, `/api/rooms`, `/.well-known/homie-studio.json` for the directory, and `/robots.txt`, `/sitemap.xml`, `/llms.txt` for search engines and AI agents (`packages/studio/site/SITE.md`). |
| Durable Object `Table` | one per room | The netplay relay (`worker/room.mjs`): seats, host election, snapshots, keyed state, checkpoints. It runs no game code. |
| Durable Object `Lobby` | one per game | Puts strangers who press Play into the same public room, and opens the next room when one is full. |
| D1 database | `<studio>-db` | The directory claim and every finished round. |
| Workers AI binding | `AI` | Only when a game's players may type (room chat's review, Cloudflare's Clef decision model) or a server's AI guides think with it; within the free allocation (10,000 neurons a day) by default. |

From 0.10.0 the Worker's config (`wrangler.jsonc`) sits at the studio's root, so Cloudflare's
**Workers Builds** can deploy it from GitHub: `npm run build` and `npm run deploy` on the
production branch, and `npx wrangler preview` on every other branch, which gets a Preview
URL and its own rooms (a Durable Object namespace of its own). The live site claims itself
in the homie.rocks directory the first time the directory reads it.

Both Durable Objects are SQLite-backed, which the Workers Free plan supports. There is no
R2 bucket: a studio needs none to run. Deploy never uses a Worker, database or bucket that
it did not create, and it records what it created in `studio.json`. Cloudflare's free
plan has daily limits (100,000 Worker requests; D1 reads 5 million rows and writes 100,000);
past them, requests fail until 00:00 UTC and nothing is charged. Anything you choose to
pay Cloudflare for, you pay them directly, and homie.rocks never hosts your games.
`packages/studio/netplay/NETPLAY.md` (section 11) estimates what a busy room costs.

**Storage, later and only if you want it.** Songs, videos and big art go to the studio's
storage, not to git: `npx --no-install homie-studio storage add` makes an R2 bucket
(`<studio>-media`, bound as `MEDIA`, served at `/media/<key>`), then `deploy` binds it and
`homie-studio media put <file>` uploads. Cloudflare asks for a payment method before R2
works, even inside its free tier (10 GB-month), so `storage add` stops with the dashboard
link, and creates nothing, until you turn R2 on.

## The game engine

The packages Homie's own games are built on are here too, as `@homie-rocks/*` on npm
under the same license. Each is ESM with TypeScript types, built for a plain Vite game
(or any bundler), and there is no barrel file: a game imports the module it needs,
`@homie-rocks/<package>/<Module>.js`.

| Package | What it is |
| --- | --- |
| `@homie-rocks/arcade` | Seats and phone controllers, game-facing. |
| `@homie-rocks/input` | Controllers, keyboard, touch and the controls screen: what a stick reads. |
| `@homie-rocks/camera` | Analytic springs, the lens and the frame solver. |
| `@homie-rocks/render` | GPU-ready before the first frame: texture budget, materials, pipeline, shader pre-warm. |
| `@homie-rocks/postfx` | The frame clock, capture protocol and the grade (tone curve, aberration, vignette, grain). |
| `@homie-rocks/fx` | Pooled screen-space effects: trails, rings, plumes, shimmer, effect lights. |
| `@homie-rocks/audio` | The DSP substrate: an output chain that cannot clip, noise, reverb, envelopes, voices. |
| `@homie-rocks/ui` | Screen-space primitives with no renderer dependency. |
| `@homie-rocks/loop` | The frame loop: freeze gate, render-failure and resolution ladders, context restore. |
| `@homie-rocks/diagnostics` | Whether a frame has a picture in it, and the watchdog that acts when it does not. |
| `@homie-rocks/device` | What the hardware is (touch, handheld, panel size) and validated stored preferences. |
| `@homie-rocks/bus` | A typed, synchronous event bus. |
| `@homie-rocks/scores` | Scores and leaderboards. |
| `@homie-rocks/noise`, `geom`, `heightfield`, `scatter`, `props`, `brush`, `ui-world` | Procedural fields, geometry, terrain, placement, scenery, box worlds, world-to-panel maths. |
| `@homie-rocks/walk`, `film` | A body on two legs (contact, coyote time, jump buffer, slopes); shot timelines and deterministic capture. |

Every package's own README says what it does, what it needs, and how to import it.

**Pin exact versions.** `npm install --save-exact`, so a game rebuilt months later is the
same game; the packages pin each other exactly for the same reason. They share one copy
of `three` as a peer dependency (0.185.1); TypeScript games also add `@types/three` at
the same version. Two copies of three.js in one page are two `instanceof` worlds, and the
symptom is an object that renders as nothing with no error.

## What stays at homie.rocks

These parts are shared between studios. They run at homie.rocks and are not in this
repository:

- **The directory** of studios and games (<https://homie.rocks/studios/>), in beta. It
  lists a studio's games after the studio's site serves the claim the directory gave it,
  so nobody can list games under someone else's site. It stores the site's address, the
  studio's name, and each game's, song's and video's name, blurb, link and cover address;
  never code, media files or keys.
  Names and blurbs are plain text without links, a studio lists at most 12 games, the
  directory and the MCP server are rate limited per address and per studio, every listing
  has a Report link, and only the directory's owner (never an AI) can unlist or take down
  a listing.
- **The Homie MCP server** the plugin connects to.
- **Notes to Homie** (`homie_feedback`, the mod's `/feedback`): a short note a person saw word for word and said
  yes to, kept privately with the website's feedback. It holds the note's kind, words, step, the studio's and
  plugin's versions and the app, and a reply address only when typed; never files, logs or keys
  ([privacy](https://homie.rocks/privacy/)).
- **Protected names.** Homie's own games' names are protected: a studio that wants one
  asks with `studio_request_grant`, and only the name's owner can approve it.
- **Release tarballs.** homie.rocks serves every published `@homie-rocks/studio` version
  at `https://homie.rocks/npm/homie-studio-<version>.tgz`, the same bytes as the npm
  registry's. Studios made before 0.10.0 pin those; a new studio pins the registry's
  exact version, which Workers Builds and Claude Code cloud sessions reach by default.

homie.rocks itself, the Homie app for TVs, phones and places, and Homie's own games (their
code, art, music and names) are not open source; the engine they are built on is.

## Known issues

The friends beta, as of this version:

- **Music and video pages serve files up to 25 MiB each** from the site itself (the skills
  keep their deliveries under that). Bigger files need storage (`storage add`, then
  `media put`).
- **ElevenLabs' credit balance can lag a render by a minute.** The music skill counts the
  quote against your budget until the account shows the real number (`reconcile`).
- **fal spend is priced, not billed.** The video skill prices each call from fal's own
  pricing API before making it; what fal bills is in your fal dashboard.
- **A new Cloudflare account verifies its email address** before it can run a Worker;
  `deploy` says so (Cloudflare's error 10034) and waits for you.
- **Storage needs a payment method on the Cloudflare account** (Cloudflare's rule for R2).
  Games never need storage.
- **Every request to a studio's site runs its Worker**, so page loads and game files count
  toward the free plan's 100,000 requests a day. A busy studio can reach it.
- **The checks need Chrome.** `homie-studio check` and `port check` drive two headless
  Chrome browsers (set `CHROME_PATH` if it is not in the usual place, and on Windows); the iPhone row of
  `port check` needs Playwright's WebKit and is skipped without it.
- **Start a new session after installing** the plugin in Codex or Grok, so its skills and tools
  load. The approval and publish cards (MCP Apps) show only in apps that support them;
  elsewhere the same answer comes as text with a link.
- **Another MCP server named `homie`** in Codex's or Grok's own configuration keeps that name, and the
  plugin's connector then does not load. `homie-studio setup status --client codex` (or `grok`) says so
  and gives the command that adds Homie's connector under its own name; a studio is made without it meanwhile.
- **The Homie MCP server allows about 60 requests a minute per address**, and the
  directory about 10 writes a minute per address and per studio. An agent that loops
  gets "too many requests" and should wait a minute.
- **Protected names.** Homie's own games' names, their look-alikes and longer forms
  ("… Remix") are refused in the directory unless their owner grants them.

Something else? [Open an issue](https://github.com/homie-rocks/homie/issues/new/choose):
a bug, a port request or a question. Or tell Claude: it can send the people who make Homie a short note,
which you see word for word and send only with your yes.

## This repository

This is where Homie's open parts are developed: the plugin, `@homie-rocks/studio` and
the engine packages. Every change lands here as a pull request, and a `release-*` tag
publishes the packages to npm. Homie's own apps, homie.rocks and Homie's games use them
from npm, pinned exactly, like any studio.

| Path | What it is |
| --- | --- |
| `.claude-plugin/marketplace.json` | The plugin marketplace for Claude Code. |
| `.agents/plugins/marketplace.json` | The plugin marketplace for Codex. |
| `plugins/homie/` | The Homie plugin: its skills, its MCP server configuration and its tests. |
| `packages/studio/` | `@homie-rocks/studio`: the `homie-studio` CLI, the studio's site Worker, the netplay contract (`netplay/NETPLAY.md`), its game helper (`@homie-rocks/studio/netplay`), the relay (`worker/room.mjs`) and the Gem Rush starter. |
| `packages/<engine package>/` | The game engine packages above, one folder each. |
| `desktop/`, `scripts/desktop.mjs` | Homie for Claude Desktop: the Desktop Extension (`.mcpb`) around `homie-studio mcp`, its manifest, and how it is packed and checked (`node scripts/desktop.mjs --check`). |
| `CHANGELOG.md`, `scripts/changelog.mjs` | What changed in each `@homie-rocks/studio` version and the plugin beside it. npm ships a copy in the package, every GitHub release's notes are its version's section, and CI checks that a version bump comes with one. |
| `scripts/audit.mjs` | The leak audit CI runs on every pull request. |
| `scripts/publish.mjs`, `.github/workflows/publish.yml`, `scripts/first-publish.sh` | How the packages reach npm: trusted publishing on a `release-*` tag, with provenance. |
| `.github/workflows/ci.yml` | CI: every package's tests on Node 22 and 24, the plugin's tests and `claude plugin validate`, and the leak audit. |

## Develop

Node.js 22 or later. The media skills' tests need ffmpeg, and two of them Chrome.

```sh
npm ci                # every workspace: packages/studio and the engine packages
npm run build         # tsc --build: each engine package after the packages it references
npm test              # the build, then every package's tests and the repository's own
npm run test:plugin   # the plugin's skills, against stand-ins for their providers (no account, no money)
npm run validate      # claude plugin validate: the marketplace and the plugin
npm run leaks         # the leak audit of what your next commit would hold
npm run release:check # what a release would publish, and whether a package changed since its version shipped
```

**Workspaces.** `packages/studio` and every engine package are npm workspaces, so a
package imports another by its published name (`@homie-rocks/render/caps.js`) and gets
this checkout's copy, and a game or a studio you link to this checkout does too. The
packages pin each other exactly: when one changes, the packages that depend on it pin
its new version.

**Tests.** Each engine package's `test/` holds `package.test.mjs`, the contract every
package keeps (`scripts/test/engine-package.mjs`): its name and licence, its exports map,
every module built and loading in Node by the package's own name, and every import
declared and pinned. Behaviour tests go beside it as `packages/<name>/test/*.test.mjs`
(`node:test`). `packages/studio/test` runs the CLI, the site Worker, the relay and the
Lobby against stand-ins for Wrangler and Cloudflare. `plugins/homie/test` runs the media
skills against stand-ins for ElevenLabs and fal, and checks the plugin's manifests agree.

**The dev relay.** Public rooms run in the studio's own Worker: the `Table` Durable
Object is the netplay relay (`packages/studio/worker/room.mjs`) and the `Lobby` puts
strangers in the same room. `homie-studio dev` runs all of it on your computer with
Wrangler's local mode, with no Cloudflare account. To try a change to the studio, the
relay or the starter, point a scratch studio at this checkout:

```sh
node packages/studio/bin/homie-studio.mjs new ../scratch-studio --name "Scratch" --no-install
cd ../scratch-studio
npm install && npm install -D ../homie/packages/studio   # this checkout's @homie-rocks/studio, linked
npx homie-studio game new crown-thief --from gem-rush --name "Crown Thief"
npx homie-studio dev          # the site, the relay and the Lobby at http://127.0.0.1:8787
npx homie-studio check crown-thief --url http://127.0.0.1:8787   # two browsers share a room and finish a round
npx homie-studio dev --stop   # this studio's dev server only
```

(`../homie` is this checkout.) Open `http://127.0.0.1:8787/crown-thief/` in two browser
windows, or a computer and a phone on the same network, to play against yourself.
`packages/studio/netplay/NETPLAY.md` is the contract a game keeps.

**Releasing.** A published version never changes. Give each package you changed a new
`version` (and bump the exact pins of the packages that depend on it). A new
`@homie-rocks/studio` version gets its section at the top of [CHANGELOG.md](CHANGELOG.md),
written for the people who make studios (Added, Changed, Fixed, Upgrade notes), then
`node scripts/changelog.mjs --sync` copies it into the package; CI fails a pull request
that moves the version without one, and says what to write. Merge, then tag:

```sh
git tag release-YYYY-MM-DD && git push origin release-YYYY-MM-DD
```

`.github/workflows/publish.yml` builds, tests and audits the tagged commit, checks the
changelog, then publishes every package whose version is not on npm yet, with provenance;
it refuses a package that changed since its version was published. The tag's GitHub
release gets the version's CHANGELOG.md section as its notes, and Homie for Claude
Desktop's `.mcpb` attached. A package that is not on npm at all is published
once by a maintainer with `scripts/first-publish.sh`, because trusted publishing can only
add versions to a package that exists.

**The leak audit.** Nothing private goes into this repository: `scripts/audit.mjs` fails a
home path, an email address other than the security contact, a key or account id, the old
`@homie/` scope, a placeholder, and the maintainers' private terms (private projects,
paths and names, which live in a repository secret and are never printed). CI runs it on
every pull request, over the tree and every commit the pull request adds. It does not
check who made a commit: an author, a committer and the trailers that name a person
(`Signed-off-by`, `Co-authored-by` and the like) carry anybody's own name and address.

Contributions come in under Apache-2.0 with a DCO sign-off (`git commit -s`), and no
CLA, from people under their own names: [CONTRIBUTING.md](CONTRIBUTING.md) says how a
change gets in, how a maintainer merges it, and what the leak audit checks. To report a
vulnerability, see [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 1243116 B.C. Ltd.
