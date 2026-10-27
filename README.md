# Homie

Homie is a set of open-source tools that let an AI build and run a **studio**: a website
with games, apps, music and video, deployed to the owner's own Cloudflare account. You ask
your AI for what you want in plain words; it uses Homie to make it, check it in real
browsers and put it online.

It starts with games. The longer-term direction is commerce between AIs, where a
customer's AI and a business's AI (or two businesses' AIs) can find each other's studios
and do business through the same tools.

## Install

Homie works as a plugin for AI coding apps, or as an MCP server for any MCP client. Your AI
can run these commands for you.

**Claude Code**

```
/plugin install homie --marketplace homie-rocks/homie
```

From a terminal: `claude plugin marketplace add homie-rocks/homie`, then
`claude plugin install homie@homie`.

**Codex**

```
codex plugin marketplace add homie-rocks/homie
codex plugin add homie@homie
```

Start a new session afterwards, and open `/hooks` to trust Homie's hooks (Codex skips a
plugin's hooks until you do).

**Grok**

```
grok plugin install homie-rocks/homie#plugins/homie
```

Trust the plugin when asked, then start a new session.

**Any MCP client** (Claude app, Grok chat and others): add a custom connector with the
address `https://homie.rocks/mcp`.

**Claude desktop app:** the Homie Desktop Extension (`desktop/`) runs the toolkit locally.
Download it from <https://homie.rocks/make/studio/desktop/>.

**Command line:** make a studio and open it locally:

```sh
npx -y @homie-rocks/studio@0.58.20 new ./my-studio --name "My Studio"
cd my-studio && npm run dev
```

The site opens at http://127.0.0.1:8787/. `npx -y @homie-rocks/studio@0.58.20 --help`
lists every command; inside a studio, run them as `npx --no-install homie-studio <command>`.
`homie-studio mcp` runs the same toolkit as a local MCP server over stdio.

Then ask for something, for example *"Make a game for my pub and put it online."*
Cloudflare asks for your approval before anything goes live.

## Core concepts

- **Studio:** a folder with a `studio.json`, and the site it deploys to your Cloudflare
  account (a Worker, a D1 database and Durable Objects for live rooms). You own it and pay
  Cloudflare directly, if at all; the free plan is enough to start.
- **Parts:** reusable pieces that studios share or sell, such as a creature, a level
  generator, a chase camera or an audio pack. Each part has its own licence and
  attribution. Browse them at <https://homie.rocks/parts/>.
- **Tools:** the plugin's skills and MCP tools, plus the `homie-studio` CLI. Your AI uses
  them to set up a studio, build, check, preview, deploy and list its work. The engine
  packages (`@homie-rocks/*` on npm) are what the games are built on.

The core stays small and general. Anything specific to one kind of business belongs in a
part, not in the toolkit.

## Docs

- Getting started: <https://homie.rocks/make/studio/> and <https://homie.rocks/install.md>
- Help: <https://homie.rocks/help/>
- Release notes: <https://homie.rocks/make/studio/changelog/> and [CHANGELOG.md](CHANGELOG.md)
- Parts catalog: <https://homie.rocks/parts/>
- Studio directory: <https://homie.rocks/studios/>
- In this repository: [plugin](plugins/homie/README.md), [studio toolkit](packages/studio/),
  [netplay contract](packages/studio/netplay/NETPLAY.md), [parts rules](packages/studio/parts/PARTS.md),
  and each engine package's own README under [`packages/`](packages/).

## Repository layout

| Path | What it is |
| --- | --- |
| `plugins/homie/` | The plugin: skills, MCP server configuration, hooks and tests. |
| `packages/studio/` | `@homie-rocks/studio`: the `homie-studio` CLI, the studio site Worker, netplay and the starters. |
| `packages/<name>/` | The engine packages (`@homie-rocks/render`, `audio`, `physics` and others). |
| `template/` | The starting studio. |
| `desktop/` | The Desktop Extension for the Claude desktop app. |
| `.claude-plugin/`, `.agents/plugins/` | Plugin marketplaces for Claude Code and Codex. |

## Develop

Node.js 22 or later. The heavy set needs Chrome for its browser checks and ffmpeg for
some media tests; the default set needs neither.

```sh
npm ci
npm run build          # tsc --build
npm test               # build, then the fast tests (*.test.mjs)
npm run test:heavy     # opt-in: adds the heavy and browser tests (*.heavy.mjs)
npm run test:plugin    # the plugin's skills, against stand-ins (no accounts, no money)
npm run release:check  # what a release would publish
```

Releases go to npm from the `release-*` tag through GitHub Actions
([publish.yml](.github/workflows/publish.yml)), with trusted publishing and provenance.

## Contributing

Issues and pull requests are welcome here on GitHub. This repository is a mirror: the
source of truth is a Cloudflare Artifacts repository, and a maintainer lands accepted
changes there, keeping you as the author. Sign off your commits (`git commit -s`);
[CONTRIBUTING.md](CONTRIBUTING.md) has the details. Report security problems privately as
[SECURITY.md](SECURITY.md) describes.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The names "Homie" and
"homie.rocks" are not covered by the licence. Copyright 2026 1243116 B.C. Ltd.
