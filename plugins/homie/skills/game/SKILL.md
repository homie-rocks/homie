---
name: game
description: Make or remix a multiplayer web game inside a Homie studio — every browser renders the game, strangers meet in public rooms, bots fill empty seats, rounds end and restart — and prove it with two browsers finishing a round. Use when someone in a Homie studio (a folder with studio.json) asks for a new game, a change to a game, or a remix of a game from the Homie directory.
---

# Make or remix a game

You are in a Homie studio when the folder (or one above it) has `studio.json`. If there
is none, use the `studio-setup` skill first.

## Start it

- **New game:** call the Homie MCP tool `game_make` (id, name) for the exact command
  and rules, then run `npx --no-install homie-studio game new <id> --from gem-rush --name "<Name>"`.
  The id becomes the game's address (`/<id>/`); lowercase, digits, hyphens.
- **Make an existing single-player web game multiplayer:** use the `port` skill (it
  grades the port, brings the game in, and proves it with the owner tests).
- **Remix a directory game:** `directory_search`, then `game_remix` returns
  `npx --no-install homie-studio game remix <source.json> --id <new id>`.
- Some names are protected (the homie.rocks house games): `game_make` and
  `studio_publish` refuse them. Pick your own name, or ask the name's owner
  with `studio_request_grant` (only the owner can approve, in their browser).

## Change it

The game is `games/<id>/`: `game.json` (name, blurb, players, round length),
`index.html`, `src/main.ts`. The starter (Gem Rush) is a complete netplay game in one
readable file: rules, bots, snapshots, rendering on a canvas, keys and touch.

Make it the game the person asked for, in small steps:

- Keep `createNetplay` from `@homie-rocks/studio/netplay` and its shape (host runs the rules
  and bots; replicas move their own body and render snapshots; checkpoint everything a
  promoted host needs). The contract is `node_modules/@homie-rocks/studio/netplay/NETPLAY.md`.
- Keep rounds: they start the moment the first visitor arrives (bots in empty seats),
  arrivals take a bot's place mid-round, the host calls the round over with results,
  and a new round starts by itself. Keep the round length in `game.json`
  (`roundSeconds`) and the code in agreement.
- Phones get touch (the drag from the lower left), computers get keys; keep the centre
  of the screen clear during play; names people type are drawn as text only.
- Update `game.json` `name` and `blurb`, and the `<title>`.

## Prove it

```sh
npm run build                                          # fix every error it names
npm run dev                                            # in the background: http://127.0.0.1:8787/<id>/play
npx --no-install homie-studio check <id> --url http://127.0.0.1:8787 --shots ./.checks
```

`check` passes only when two fresh browsers (a computer and a phone) press Play, land
in the same room, and both see a round finish with both of them in the results. Look
at the screenshots it saves. Never say a game works without a passing `check`.

Then `npm run deploy` and `studio_publish` (see `publish`), and check again
on the live site.
