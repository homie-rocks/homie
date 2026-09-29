# @homie-rocks/studio

A game studio on its own Cloudflare. One repository (`AGENTS.md`, `games/`, `music/`,
`videos/`, `posts/`, `site/`), multiplayer games on the Homie netplay contract (every
browser renders, strangers meet in public rooms, bots fill seats, rounds restart), and a
site Worker with Table/Lobby Durable Objects, D1 and R2 that the studio deploys to its
own Cloudflare account with Wrangler. The homie.rocks directory lists the games.

Most people never run this by hand: the Homie plugin for Claude Code and Codex does,
and the person approves Cloudflare once in their browser.

```sh
npx -y --package=https://homie.rocks/npm/homie-studio-0.2.0.tgz homie-studio new ./night-owls --name "Night Owls"
cd night-owls && npm install
npx homie-studio game new crown-thief --from gem-rush --name "Crown Thief"
npx homie-studio dev                                   # the whole site locally
npx homie-studio check crown-thief --url http://127.0.0.1:8787
npx homie-studio deploy                                # the studio's own Cloudflare
npx homie-studio publish                               # the homie.rocks directory
```

| Path | What it is |
| --- | --- |
| `bin/homie-studio.mjs` | The CLI. |
| `lib/scaffold.mjs` | `new`: the studio monorepo, only into a new or empty folder, every file listed. |
| `lib/build.mjs` | `build`: games bundled with esbuild into `site/dist`, `games.json`, each game's shared `source.json`. |
| `lib/cloudflare.mjs` | `deploy`: Wrangler, D1, R2, migrations, the directory claim; refuses resources it did not create. |
| `lib/check.mjs` | `check`: two fresh Chrome processes (computer + phone) must share a room and finish a round. |
| `worker/index.mjs` | The site Worker and the `Table` (netplay relay, `room.mjs`) and `Lobby` Durable Objects. |
| `netplay/` | The netplay contract (`NETPLAY.md`) and its game helper (`@homie-rocks/studio/netplay`). |
| `starters/gem-rush/` | The reference multiplayer starter. |

Versions are immutable: a published version never changes, so a studio that pinned one
never changes by surprise. A change ships as a new `version`. Until the package is on the
npm registry, each version's tarball is served at
`https://homie.rocks/npm/homie-studio-<version>.tgz`.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
