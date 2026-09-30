# Homie

A studio in a box for your AI: make games, music and video, and publish them from a studio
that runs on your own Cloudflare, on the free plan.

> **Beta.** Homie for studios is in a friends beta. Bugs, port requests and questions go
> to [Issues](https://github.com/homie-rocks/homie/issues/new/choose); read
> [Known issues](#known-issues) first.

Homie is a plugin for Claude Code and Codex. Ask it to *"set up a game studio called
Night Owls and make a multiplayer game"* and it:

1. makes a **studio**: one folder you can see and open, a git repository with `games/`,
   `music/`, `videos/`, `posts/` and `site/`, and an `AGENTS.md` that tells your AI how
   everything in it works;
2. makes a **game** from the Gem Rush starter on the netplay contract: every browser
   renders the game itself, strangers who press Play meet in the same public room,
   bots fill empty seats, and rounds end and restart on their own;
3. **proves it**: two fresh browsers (a computer and a phone) press Play, and the check
   passes only when they share a room and finish a round;
4. **deploys** the studio's site to **your own Cloudflare account**, after you approve
   Cloudflare once in your browser (a free account, no payment method: it says what it
   will create and what it costs before it does);
5. **lists** the games in the [homie.rocks](https://homie.rocks/studios/) directory, so
   people can find them.

Your AI runs the commands. You approve what matters.

## Install

**Claude Code**

```
/plugin marketplace add homie-rocks/homie
/plugin install homie@homie
```

From a terminal, the same is `claude plugin marketplace add homie-rocks/homie`, then
`claude plugin install homie@homie`.

**Codex**

```
codex plugin marketplace add homie-rocks/homie
codex plugin add homie@homie
```

Or run `/plugins` in Codex and install Homie from the Homie marketplace. Start a new
session afterwards so the skills and tools load.

Then ask for a studio. The plugin adds nine skills (`studio-setup`, `game`, `port`,
`publish`, `sound`, `music`, `art`, `video`, `playtest`) and connects the Homie MCP server at `https://homie.rocks/mcp`,
which has creator tools only: set up a studio, make or remix a game, make an existing
single-player web game multiplayer, preview it, deploy it, and list it.
A studio needs Node.js 22 or later.

Two skills need no account and cost nothing:

- **`sound`** (*"make sound effects and a short theme for my game"*): effects from presets and
  synthesized scores from chords and patterns, rendered on your computer, with stems and seamless
  loops, measured (loudness, clipping, late starts, what a phone speaker loses), and wired into the
  game with a small player that starts on the first touch and changes music on bar lines.
- **`playtest`** (*"playtest my game and tell me what's weak"*): real browsers on a computer and a
  phone held both ways: the first ten seconds, the look while playing, how much of the screen the UI
  covers, the game's real sound, a round with one player trying and one idle, the owner control tests,
  and a brief for a blind review by a fresh reviewer.

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
  check and a contact sheet, and a video page. It never passes generated footage off as
  gameplay, and puts no real people or brands in a video.

- **`art`** (*"make a cover for my game"*): a cover from a real frame of the game (free), and
  painted covers, backdrops and textures with fal on your own key, priced, capped and receipted;
  checks that a texture tiles and that files are small enough for a phone.

All of them need ffmpeg; `video`, `art` and `playtest` also use Chrome.

## What the studio deploys to your Cloudflare

`npm run deploy` in a studio runs Wrangler under **your** Cloudflare login and creates,
on your account, only what Cloudflare's free Workers plan gives a new account with **no
payment method** (`npx --no-install homie-studio deploy --plan` prints this for your
studio and changes nothing):

| Resource | Name | What it does |
| --- | --- | --- |
| Worker | `<studio>` | The studio's pages, each game's page and play shell, the game files, `/api/games`, and `/.well-known/homie-studio.json` for the directory. |
| Durable Object `Table` | one per room | The netplay relay (`worker/room.mjs`): seats, host election, snapshots, keyed state, checkpoints. It runs no game code. |
| Durable Object `Lobby` | one per game | Puts strangers who press Play into the same public room, and opens the next room when one is full. |
| D1 database | `<studio>-db` | The directory claim and every finished round. |

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
- **Protected names.** Homie's own games' names are protected: a studio that wants one
  asks with `studio_request_grant`, and only the name's owner can approve it.
- **Release tarballs.** Until `@homie-rocks/studio` is on the npm registry, a studio pins
  one release at `https://homie.rocks/npm/homie-studio-<version>.tgz`.

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
- **Start a new session after installing** the plugin in Codex, so its skills and tools
  load. The approval and publish cards (MCP Apps) show only in apps that support them;
  elsewhere the same answer comes as text with a link.
- **The Homie MCP server allows about 60 requests a minute per address**, and the
  directory about 10 writes a minute per address and per studio. An agent that loops
  gets "too many requests" and should wait a minute.
- **Protected names.** Homie's own games' names, their look-alikes and longer forms
  ("… Remix") are refused in the directory unless their owner grants them.

Something else? [Open an issue](https://github.com/homie-rocks/homie/issues/new/choose):
a bug, a port request or a question.

## This repository

| Path | What it is |
| --- | --- |
| `.claude-plugin/marketplace.json` | The plugin marketplace for Claude Code. |
| `.agents/plugins/marketplace.json` | The plugin marketplace for Codex. |
| `plugins/homie/` | The Homie plugin: its skills and its MCP server configuration. |
| `packages/studio/` | `@homie-rocks/studio`: the `homie-studio` CLI, the studio's site Worker, the netplay contract (`netplay/NETPLAY.md`), its game helper (`@homie-rocks/studio/netplay`), the relay (`worker/room.mjs`) and the Gem Rush starter. |
| `packages/<engine package>/` | The game engine packages above, one folder each. |
| `scripts/publish.mjs`, `.github/workflows/publish.yml` | How the packages reach npm: trusted publishing on a `release-*` tag, with provenance. |

To work on it:

```sh
npm install
npm run build         # every package, in dependency order (tsc --build)
npm test
npm run validate      # claude plugin validate, for the marketplace and the plugin
```

This repository is a one-way copy of the open parts of Homie's development repository.
Contributions come in under Apache-2.0 with a DCO sign-off (`git commit -s`), and no
CLA: [CONTRIBUTING.md](CONTRIBUTING.md) says how a change gets in. To report a
vulnerability, see [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 1243116 B.C. Ltd.
