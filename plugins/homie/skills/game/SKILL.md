---
name: game
description: Make or remix a multiplayer web game inside a Homie studio — every browser renders the game, strangers meet in public rooms, bots fill empty seats, rounds end and restart — prove it with two browsers finishing a round, and give it an epic landing page (a full-bleed hero from its own footage or art, the pitch, Play, phone / computer / TV, live rooms, how to play, credits). Use when someone in a Homie studio (a folder with studio.json) asks for a new game, a change to a game, a remix of a game from the Homie directory, or a better page for a game ("make my game's landing page epic").
---

# Make or remix a game

You are in a Homie studio when the folder (or one above it) has `studio.json`. If there
is none, use the `studio-setup` skill first.

## Start it

- **A new studio's first game** follows the `studio-setup` checklist: a working copy of a starter first,
  one small change, then the plan (the `plan` skill) before anything big. Never jump ahead of it.
- **A game with a Game Codex** (`games/<id>/CODEX.md`): read it first; it is the plan. Every decision that
  changes it goes into it in the same change, with a dated line under Latest, and the page is redrawn
  (`npx --no-install homie-studio codex <id>`). A big change to a game without one: plan it first.
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

## Progress that lasts: cloud saves

When the plan says progress persists across sessions or devices (the codex's "Progress that lasts", or the person
asks for a character, levels, unlocks, a collection, hardcore), wire in saves. Never keep it in the room: a room
forgets everything 60 s after its last player leaves.

- `game.json`: `"saves": true`. A new game of that kind can start from the starter:
  `npx --no-install homie-studio game new <id> --from ember-vale --name "<Name>"` (a hero that lasts, lifetime
  stats, a hardcore mode with a hall of the fallen, on the same rooms as any game).
- In the game: `import { createSaves } from '@homie-rocks/studio/saves'`; `const saves = createSaves({ game: '<id>' })`.
  Load on arrival (`await saves.get('hero')`), save when it changes (`saves.set('hero', hero)`, at most about once a
  second), and reload on `saves.on('player', …)` (the player signed in on this device). Keep one character in ONE
  key. Lifetime numbers: `saves.stats.add({ kills: 1 })`. Hardcore: `saves.fall({ character, summary, wipe: true })`.
- The host decides what happened and tells the player's own browser (a netplay event to its seat); only that
  browser changes and saves the player's progress.
- Show who is playing (`saves.player.name`, guest or signed in) and a small "Keep my progress" button that calls
  `saves.signIn()`; the play page shows its passkey sheet. Pressing Play never needs an account.
- Prove it: build, `npm run dev`, open `http://localhost:8787/<id>/play` (passkeys need `localhost`, not
  `127.0.0.1`), play, reload: the progress is still there. The whole guide is
  `node_modules/@homie-rocks/studio/saves/SAVES.md` (the limits, offline and conflicts, what is stored, privacy).

## Prove it

Open a progress feed for every build, titled with what it does (the codex's milestone); the codex
page's Build status tab and Claude Code's status line follow it by themselves. When the person is
following along in the Claude app (or anywhere they cannot see your terminal), share it and show it:

```sh
npx --no-install homie-studio progress start <id> --share --title "<what this build does>" [--budget <dollars>]
npx --no-install homie-studio progress stage plan done --note "<the plan in one line>"
```

It prints a build id: call the Homie MCP tool `build_progress` with it once, and the card
follows the build by itself (stages, each check going green, a preview, spend, Stop). The
commands below report into it. If a command answers `stopped`, the person pressed Stop:
end there and ask before starting again.

**Started from the Claude app** (a Claude Code session whose prompt came from a "Build it"
card, naming a build `hb_…` and maybe a setup `hs_…`): the chat already opened the build, so
take it instead of starting one, then work on a branch and publish as a pull request. The
prompt names the studio's repository: first check this session is in it
(`git remote get-url origin`). If it is in another one (`homie-rocks/homie` is Homie's
engine and template, never a studio), stop and say so; never attach from it.

```sh
npm install                                            # the studio's pinned toolkit, from registry.npmjs.org
npx --no-install homie-studio setup attach hs_…        # only when the prompt names a setup: once, first
npx --no-install homie-studio progress attach hb_…     # this session takes the chat's build (once)
npx --no-install homie-studio chrome install           # Linux without Chrome: Chrome for Testing, once
# … make the game, build, dev, check (below) …
npx --no-install homie-studio progress change "<what the change does, one line>"
git switch -c <short-branch> && git add -A && git commit -m "<what it does>" && git push -u origin HEAD
gh pr create --fill
npx --no-install homie-studio progress pr --url <the pull request's address>
```

The card's Publish button opens the pull request for the person; their merge in GitHub is
the approval. Workers Builds deploys the branch as a Preview (run `check --url <the Preview
URL>` when the pull request shows it, and pass it as `progress pr --preview`) and `main`
after the merge; the card says Live by itself. Never merge the pull request yourself. If an
attach fails, quote the toolkit's message as it is: it names the directory's status and its
own words, or the connection error and whether this machine's proxy was used. Never guess at
the cause. Only when it says the network proxy refused homie.rocks, pass on the setting it
names; then go on, since the build works with its local feed. On Linux without a GPU,
`check` measures seats, rooms and rounds; its frame rate is SwiftShader's, not a person's:
say so rather than calling the game slow.

```sh
npm run build                                          # fix every error it names
npm run dev                                            # in the background: http://127.0.0.1:8787/<id>/play
npx --no-install homie-studio check <id> --url http://127.0.0.1:8787 --shots ./.checks
```

`check` passes only when two fresh browsers (a computer and a phone) press Play, land
in the same room, and both see a round finish with both of them in the results. Look
at the screenshots it saves. Never say a game works without a passing `check`.
Start `npm run dev` as a background task your app keeps alive (Claude Code: the Bash
tool's `run_in_background`), and when you are done with it: stop it with `npx --no-install homie-studio dev --stop`, which stops exactly this studio's dev server (and its Wrangler) and nothing else. Never `pkill`, `killall` or `lsof … | xargs kill` by name or port: other projects on this machine may run their own `wrangler dev`, and a pattern stops theirs too.

Then make it good, not just working:

- **Sound**: the `sound` skill makes the game's effects and a synthesized theme for free and wires
  them in (`sound.play('coin')` where it happens, in every browser). A silent game is not finished.
- **Look**: the `art` skill makes the cover from a real frame and, with a budget, painted backdrops
  and textures.
- **Playtest**: the `playtest` skill plays it on a computer and a phone held both ways, measures the
  first ten seconds, the look, the UI, the real sound and a round, runs the owner tests, and hands a
  blind review to a fresh reviewer. Fix what it ranks first; run it again.

Then give it its landing (below), `npm run deploy` and `studio_publish` (see `publish`), and
check again on the live site.

## Its landing page: `/<id>/`

Every game gets a landing page from the studio template, made from the game's own files
(`node_modules/@homie-rocks/studio/site/SITE.md` has every field): a full-bleed hero, the pitch, a big
Play button that drops a visitor into a public room, how to play on a phone, a computer and a TV (with
the join code), the live rooms, how to play, credits and "Make a game like this" (the viral road: it
tells a stranger how to make their own with Homie). It is as good as what you give it. "Make the landing
page epic" means all of this, in this order:

1. **Footage in the hero.** The biggest single difference. Capture the game running with the `video`
   skill (`capture <slug> --game <id> --url http://127.0.0.1:8787 --seconds 30`), pick 8 to 12 s where a
   lot happens, and cut two silent loops into `games/<id>/hero/`: `wide.mp4` (16:9) and `tall.mp4`
   (9:16, the phone's). Under 3 MB each, so a phone starts it at once:

   ```sh
   C=videos/<slug>/work/capture/capture.mp4
   ffmpeg -y -ss <start> -t 10 -i $C -an -vf "scale=1600:-2,fps=30" -c:v libx264 -crf 27 -preset slow -pix_fmt yuv420p -movflags +faststart games/<id>/hero/wide.mp4
   ffmpeg -y -ss <start> -t 10 -i $C -an -vf "crop=ih*9/16:ih,scale=720:-2,fps=30" -c:v libx264 -crf 27 -preset slow -pix_fmt yuv420p -movflags +faststart games/<id>/hero/tall.mp4
   ffmpeg -y -ss <start+2> -i $C -frames:v 1 -q:v 3 games/<id>/hero/wide.jpg
   ```

   Look at them (`ffprobe`, and a frame or two): the game, not a menu, a QR code or a black frame. A
   finished trailer in `videos/` with `"for": { "game": "<id>" }` is used when there is no `hero/`.
   No footage at all: the cover (the `art` skill's `cover`, from a real frame) moves slowly instead.
2. **The words**, in game.json's `landing` block: `pitch` (one line a stranger gets at once), `about`
   (a short paragraph), `howToPlay` (three to five short lines), `controls` for `phone`, `computer`
   (and `tv` if it differs), `players` (what a player is called: `{ "one": "pilot", "many": "pilots" }`),
   `hero.alt` (what the footage shows, for a screen reader), `hero.focus` (`"50% 35%"` keeps the action
   in frame on a phone), `hero.tint` (0 to 80: more when the art is bright and the title hard to read).
   A game whose picture is white or cream (a light arena) takes `"scheme": "light"`: its landing is drawn
   light, where the studio's dark tint would turn the picture grey. `hero/wide.jpg` is also the game's
   picture on every card and in the directory, so pick a frame that reads small.
3. **Credits**: `landing.credits` names who made what (`[{ "role": "Music", "name": "…" }]`). A port
   keeps its `credits.json` (the original, its author and licence, every part inside); never drop one.
4. **The look**: the studio's `site/theme.json` colours; `landing.theme` gives this game its own
   `accent` and `glow` on its page, when two games of one studio should not look alike.
5. **A band of its own**, when the game has something to say that the template does not (a soundtrack, a
   mode, a season): `site/partials/game-<id>.html`, a short section in the page's own classes
   (`<p class="kicker">`, `<h2>`, `<p class="lead">`, `<a class="ghost">`).

**The play page's room button** (Invite, Big screen, the room code) sits top right. If the game draws a
score, a timer or a bar there, move it in game.json: `"screen": { "share": { "desk": "bottom-left",
"phone": { "at": "top-left", "y": 56 } } }` (a corner or `top-center`, per device: `desk`, `phone`,
`sideways`; `x` / `y` move it in, in pixels; `"label": false` keeps it a small icon). Look at
`/<id>/play` on a computer and a phone, both ways up, while a round is on.

Then `npm run build`, `npm run dev`, and look at `http://127.0.0.1:8787/<id>/` as a stranger would:
a computer (1440 wide) and a phone (390 wide, and turned sideways), from the top, scrolling to the end.
The `playtest` skill takes the screenshots. The hero reads at a glance, Play is above the fold on a phone,
nothing is cut off or runs off the side. Fix what you see; build again.

A whole landing of the studio's own (`site/pages/<id>/index.html`) replaces the generated one: only when
the person asks for a hand-made page, and start from the generated one's HTML so Play, the TV road and
"Made with Homie" stay.
