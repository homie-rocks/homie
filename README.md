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

Then ask for a studio. The plugin adds three skills (`studio-setup`, `game`, `publish`)
and connects the Homie MCP server at `https://homie.rocks/mcp`, which has creator tools
only: set up a studio, make or remix a game, preview it, deploy it, and list it.
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

homie.rocks itself, the Homie app for TVs, phones and places, and Homie's own games and
brands are not open source.

## This repository

| Path | What it is |
| --- | --- |
| `.claude-plugin/marketplace.json` | The plugin marketplace for Claude Code. |
| `.agents/plugins/marketplace.json` | The plugin marketplace for Codex. |
| `plugins/homie/` | The Homie plugin: its skills and its MCP server configuration. |
| `packages/studio/` | `@homie-rocks/studio`: the `homie-studio` CLI, the studio's site Worker, the netplay contract (`netplay/NETPLAY.md`), its game helper (`@homie-rocks/studio/netplay`), the relay (`worker/room.mjs`) and the Gem Rush starter. |

To work on it:

```sh
npm install
npm test
npm run validate      # claude plugin validate, for the marketplace and the plugin
```

This repository is a one-way copy of the open parts of Homie's development repository.
Contributions come in under Apache-2.0 with a DCO sign-off (`git commit -s`), and no
CLA: [CONTRIBUTING.md](CONTRIBUTING.md) says how a change gets in. To report a
vulnerability, see [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 1243116 B.C. Ltd.
