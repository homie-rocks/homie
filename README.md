# Homie

Make multiplayer web games with your AI, and run them on your own Cloudflare.

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
   Cloudflare once in your browser;
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

Then ask for a studio. The plugin adds four skills (`studio-setup`, `game`, `port`,
`publish`) and connects the Homie MCP server at `https://homie.rocks/mcp`, which has
creator tools only: set up a studio, make or remix a game, make an existing
single-player web game multiplayer, preview it, deploy it, and list it.
A studio needs Node.js 22 or later.

## What the studio deploys to your Cloudflare

`npm run deploy` in a studio runs Wrangler under **your** Cloudflare login and creates,
on your account:

| Resource | Name | What it does |
| --- | --- | --- |
| Worker | `<studio>` | The studio's pages, each game's page and play shell, the game files, `/api/games`, and `/.well-known/homie-studio.json` for the directory. |
| Durable Object `Table` | one per room | The netplay relay (`worker/room.mjs`): seats, host election, snapshots, keyed state, checkpoints. It runs no game code. |
| Durable Object `Lobby` | one per game | Puts strangers who press Play into the same public room, and opens the next room when one is full. |
| D1 database | `<studio>-db` | The directory claim and every finished round. |
| R2 bucket | `<studio>-media` | The studio's large media, when the account has R2. |

Both Durable Objects are SQLite-backed, which the Workers Free plan supports. Deploy
never uses a Worker, database or bucket that it did not create, and it records what it
created in `studio.json`. You pay Cloudflare directly, and homie.rocks never hosts your
games. `packages/studio/netplay/NETPLAY.md` (section 11) estimates what a busy room costs.

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

- **The directory** of studios and games (<https://homie.rocks/studios/>). It lists a
  studio's games after the studio's site serves the claim the directory gave it, so
  nobody can list games under someone else's site.
- **The Homie MCP server** the plugin connects to.
- **Protected names.** Homie's own games' names are protected: a studio that wants one
  asks with `studio_request_grant`, and only the name's owner can approve it.
- **Release tarballs.** Until `@homie-rocks/studio` is on the npm registry, a studio pins
  one release at `https://homie.rocks/npm/homie-studio-<version>.tgz`.

homie.rocks itself, the Homie app for TVs, phones and places, and Homie's own games (their
code, art, music and names) are not open source; the engine they are built on is.

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
