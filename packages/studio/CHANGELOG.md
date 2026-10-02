# Changelog

What changed in each release of Homie's open parts, newest first:

- **`@homie-rocks/studio`**: the `homie-studio` command, your studio's site Worker, its multiplayer rooms (the
  netplay contract), the port kit and the starter games. Every version is on npm, and Homie for Claude Desktop
  (`homie-studio-<version>.mcpb` on each GitHub release) is built from it.
- **The Homie plugin** for Claude Code and Codex: its skills. It ships from this repository's marketplace with its
  own version number, given beside each studio version below.

Each version says what you can now do (**Added**), what works differently (**Changed**), what was broken and is
not any more (**Fixed**), and anything you have to do yourself (**Upgrade notes**). The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). While Homie is 0.x, a minor version (0.19.0) adds
things and a patch (0.19.1) fixes or polishes them.

To bring a studio up to date, tell Claude: "Upgrade my studio to the newest Homie." It runs
`npx -y @homie-rocks/studio@latest upgrade`, which shows what's new since the version your studio pins (from this
file) and what the upgrade would change, and changes nothing until you agree.

## [0.22.0] - 2026-10-02

**Plugin 0.23.0** · [#32](https://github.com/homie-rocks/homie/pull/32)

Your game's look as decisions you can steer and lock, a style board the engine draws for free, free CC0 3D models, props made on your own fal account, and every asset licensed and checked for phones.

### Added

- `homie-studio style`: your game's look as about thirty decisions (render style, palette, shape, proportions, materials, light, camera, fonts, effects; the cast, its library family, scale and phone budgets; rigs and animation for later). `style init <game> --prompt "…"` picks each from your words, the codex and the genre, with a one-line why, and the Game Codex's Art direction tab draws them. `style steer` nudges one in your words ("warmer", "closer", "golden hour"), `style lock` freezes one for you, and the first model built on an automatic decision pins it.
- `homie-studio style board <game>`: three coherent directions, each drawn by the game's own engine (its palette, light, camera, material model, fonts and proportions, with the starter library's pieces re-tinted into its palette). Free, in about 20 seconds. Pick one, mix rows from several, steer, lock. A painted mood image per direction is optional and paid, on your own fal account, and labelled a target.
- Changing a locked decision shows its blast radius first (`style blast`): every model made under it that would go stale, what remaking each would cost, and what a free palette re-tint fixes. Nothing is ever remade by itself.
- `homie-studio assets`: every model, texture and sky a game ships is recorded in `games/<id>/assets/manifest.json` with where it came from, each step that made it, its licence and what a remix gets. `assets rights` writes `RIGHTS.md` in plain words, credits go on the game's landing, and `assets remove` takes a model out with the copy the game ships.
- Homie's starter library: free CC0 models, materials and skies from Kenney, KayKit, Poly Haven and ambientCG, made phone-sized, with thumbnails and their licences. `assets find "pine tree"` searches it and `assets add <game> <item>` copies one into the game (never hot-linked). It is served from homie.rocks; `HOMIE_LIBRARY` points at another copy.
- `assets add <game> --file <model> --license <kind>`: your own models, checked first (a file that loads anything from an address, or is too big, is refused), made phone-sized (meshopt geometry, WebP pictures, the pivot at the bottom centre, scaled to metres) and recorded. The raw file stays in `art/<slug>/raw/`, which git ignores, and `assets redo <game> <asset>` makes it again from there for free. Unless the game's render style is `pbr`, models are made non-metal: metal with nothing to reflect draws black on a phone.
- `assets check <game>`: every model against phone budgets (triangles, draw calls, picture memory, the first-play download), the Khronos glTF-Validator, its licence, and whether a decision it was made under has changed. `assets lineup <game>` draws them side by side at true scale on a 1 m grid, with their silhouettes and how far their colours drift from the palette.
- `@homie-rocks/studio/assets`: one model loader for three.js games. It refuses unsafe or oversized files before three.js reads them, decodes meshopt, clones skinned models properly, and says in development when a model is over its budget.
- A starter in 3D: `game new <id> --from gem-rush-3d` is Gem Rush's rules drawn with three.js and dressed with models from the starter library. `game new` fetches them, checked by SHA-256 (the repository holds no model file), and a game you already planned keeps its decisions, its `style.json` and its own models. `assets lineup` draws each model at the height and in the colours the game gives it.
- A remix now arrives with its models: the original site serves `/games/<id>/assets.json`, and `game remix` fetches every model its licence lets a remix carry, checked by SHA-256, with a grey placeholder of the same size for the rest. It adds three.js when the game needs it, and no other package by itself.
- Homie for Claude Desktop: the tools `style_explore`, `style_board`, `decision_set`, `assets_plan`, `assets_find`, `asset_add`, `asset_make`, `asset_check`, `asset_lineup` and `asset_rights`, with style board, look decision, cast, lineup and rights cards.
- Plugin: the `style` skill (decisions, the board, locks and the blast radius) and the `models` skill (the starter library, your own models, and generated props: a concept in the locked style, then Tripo P1 image-to-3D, on your own fal account under a budget with a receipt per call, about US$0.54 a prop). The plan asks whether you want to steer the look and what art budget you have.
- Plugin: the Studio mod's Art tab and its commands `/look`, `/lock`, `/assets`, `/lineup` and `/rights`; it refuses a hand edit to a locked decision, a deploy that ships an unlicensed model, and a commit of a big binary under `games/`, and holds a paid prop past the budget.
- `games/<id>/style.json`: the palette, fonts, light and camera a game draws with. Its landing takes its accents from it, and the video skill's title cards (`card --game <id>`) wear its palette and font.

### Changed

- `publish` refuses to list a studio while a public game ships a model with no licence record, or one whose licence forbids it.
- `check` refuses a game with a binary over 5 MB committed under `games/` (it belongs in R2).
- The remix source leaves out each game's `codex/` folder (its decisions and style board), like `CODEX.md`.
- `@homie-rocks/studio` now depends on three.js, @gltf-transform, meshoptimizer, sharp and the Khronos glTF-Validator (about 60 MB more in a studio's `node_modules`).

### Upgrade notes

- `homie-studio upgrade --apply` adds the art section to AGENTS.md and `.gitignore` lines for raw 3D files (`art/**/raw/`, `*.blend`, `*.fbx`). Commit no raw model file: move any already committed into `art/<slug>/raw/`.
- The starter library is served from homie.rocks once it is online; until then `assets find` says so, and `HOMIE_LIBRARY` can point at a local copy.

## [0.21.0] - 2026-10-02

**Plugin 0.22.0** · [#31](https://github.com/homie-rocks/homie/pull/31) · [release-2026-10-02-studio-0.21.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.21.0)

The Homie mod for Claude Code: your studio, its rooms and a real seat in a live game beside the chat, with a look
before protected files, deploys and spending, and keys kept out of what Claude reads.

### Added

- Plugin: the Homie mod (Claude Code 2.1.287 or later). Inside a studio, a one-row band above the prompt shows the
  studio, the game, the build step, ▶ Play and how many people are playing now. Outside a studio it adds nothing.
- Plugin: the Studio pane (`/studio`) opens by itself when a build starts, on a wide enough terminal. **Build** has the
  live Plan, Build, Checks, Deploy feed and the latest check frame, or a live Watch of a room of the game being built.
  **Rooms** lists who is playing and the AI players, with Watch and Join links; Announce, Mute and Kick go through
  the office, and Mute and Kick are only ever asked for, so you still confirm them with one tap. **Games** has
  launch states and the remix switch; **Stats** and **Codex** link to the rest. **Lab** shows each game's last Game
  Lab check (New's phases beside Today's, whether the replays match) and the lab's link while it runs.
- Plugin: the Arcade pane (`/arcade`). Take a real seat in a public room of a Homie game (Homie Arcade's, or your
  studio's own) and play it in the pane with w/a/s/d or the arrow keys while Claude works. It runs in one headless
  Chrome on your computer at the lowest priority, about 8 frames a second in a terminal, pauses while the pane is
  hidden and stops when you leave.
- Plugin: a Parts pane for the `parallel` skill: each part, its last step, and the merge waiting for all of them.
- Plugin: instant commands that answer without a Claude turn: `/play`, `/watch [room]`, `/rooms`, `/build`, `/codex`,
  `/deploy-status`, `/perf-numbers`, `/parts`, `/arcade`. They print links or open a pane; nothing opens a browser.
- Plugin: guards. An edit to a file matched by studio.json `"protect"` (globs, such as `"games/*/game.json"`) shows
  the diff and waits for Proceed or Cancel. So does a deploy (where it goes, what it creates, the commits and files
  since the last one, the checks) and a paid fal or ElevenLabs run that would pass studio.json `"budget"`.
- Plugin: Cloudflare tokens, provider keys, agent passes, office keys and one-time owner links are taken out of
  command output before Claude reads it.
- Plugin: setup status, check, playtest and deploy results are drawn as checklists and rows, with the live link.
- `homie-studio office mute <game> <room> <seat | name> [--minutes 10] [--off]`, asked for like `office kick`.
- A build's latest check frame is also kept as a small picture beside its progress feed, for the mod to draw.

### Upgrade notes

- Every part of the mod has its own switch (`/config`, or `pluginConfigs` in settings.json). Codex installs the plugin
  as before; it does not run plugin hooks, so there it is the skills and tools you had.
- `homie-studio upgrade --apply` adds `office mute` and the `protect` and `budget` lines to AGENTS.md.

## [0.20.0] - 2026-10-02

**Plugin 0.21.0** · [#30](https://github.com/homie-rocks/homie/pull/30) · [release-2026-10-02-studio-0.20.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.20.0)

A Game Lab: tune how one move of your game feels (a jump, a hit, a dash), your new version beside your last commit,
frame by frame.

### Added

- Plugin: the `lab` skill. Say "iterate on the jump", "make the hit feel punchier" or "tune the drift". Claude first
  teaches your game to tell the lab about that move (its phases, the numbers that shape it) without changing how it
  plays, and commits that. Then it proposes the change as named phases and numbers, shows it to you New beside Today,
  keeps only what you like, and can record a side-by-side clip to share.
- `homie-studio lab <game>`: the Game Lab, a page on your own computer. One short take of your game plays in New (your
  working copy, rebuilt every time a file is saved) beside Today (your last commit), on one clock, with the same
  presses on the same frames. Slow it to a quarter or a tenth, step a frame at a time, try 30, 15 or 12 frames a
  second, or switch to a phone-sized screen; the frames are the same frames at any speed.
- In the lab: a timeline that names each phase of the move, graphs of New against Today, captions, the game's own
  onion skin and arcs, and its views (close, the whole arena). Its numbers are sliders: move one and New plays it at
  once, and "Keep in code" writes the ones you like into the game's `tunables.json`. Press REC and play a move to make
  a new take; both versions get your presses.
- `homie-studio lab check <game>`: the same take with no window. How long each phase lasts in each version, the peaks
  of what the game tracks, whether a replay landed on exactly the same frames, a contact sheet and a still.
  `homie-studio lab set <game> name=value` writes a number into `tunables.json`; `homie-studio lab --stop` stops the lab.
- Homie for Claude Desktop (`homie-studio mcp`): `game_lab` opens the lab and answers with a card: a still of both
  versions at the move's busiest moment, their phases side by side, and Open.
- For your game's code, `@homie-rocks/studio/lab`: `lab.tunables`, `lab.phase`, `lab.track`, `lab.camera`,
  `lab.overlay`, `lab.stage` (a training dummy for one move) and `lab.random` (dice for sparks and shake). Every call
  does nothing outside the lab, so the calls stay in your game.
- Plugin: the perf skill's `try --measure` measures a change you keep for how it feels and says what it costs, without
  reverting it (`try` on its own reverts anything that is not faster).

### Changed

- Gem Rush's bump lands. The bumped body holds for 70 ms, white and squashed against the hit, then flies stretched
  along it, eases to a stop 185 px away at any frame rate (it used to slide a different distance at 12 and at 60
  frames a second, then creep), and wobbles as it settles. Sparks, and a small camera kick for whoever was in it.
- Ember Vale's strike lands. The slime freezes white when it is hit and its damage pops up, a swipe carries through,
  the slime is pushed back and wobbles like jelly, and a kill bursts. Your hero steps into each strike, so three
  strikes in a row still reach.
- Both starters come ready for the lab: their numbers in `tunables.json` and a take in `lab.json`, which
  `homie-studio game new` copies with the game. A new studio's AGENTS.md names both files and the lab command.

### Upgrade notes

- A game you made from a starter before 0.20.0 keeps its old feel: the new bump and strike come with a new copy
  (`homie-studio game new`). To tune a move of your own game, tell Claude "build a Game Lab for <the move>": it adds
  the lab's calls and a take, and commits that first.
- Today is your last commit, so commit (or stash) your work in progress before you open the lab. Its builds live in
  `.studio/lab/`, which git already ignores.

## [0.19.2] - 2026-10-02

**Plugin 0.20.2** · [#29](https://github.com/homie-rocks/homie/pull/29) · [release-2026-10-02-studio-0.19.2](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.19.2)

Release notes: this changelog, on every GitHub release, inside the npm package, and at the top of
`homie-studio upgrade`.

### Added

- `CHANGELOG.md`: every release since 0.1.0, written for the people who make studios. It ships inside
  `@homie-rocks/studio`, and each GitHub release's notes are now its version's section, with the Claude Desktop
  extension still attached.
- `homie-studio upgrade` starts with what's new between the version your studio pins and the one you are moving to,
  in the plan and again after `--apply`: one line per version, then the upgrade notes, anything you have to do
  yourself. It reads the new version's own `CHANGELOG.md`, so it needs no network beyond npm. `--json` carries it as
  `whatsNew`.
- The studio card (Homie for Claude Desktop, `homie-studio mcp`) says when a studio pins an older toolkit, what's new
  since, and what to say to see the upgrade.
- Plugin: the studio-setup and office skills tell you what's new when your studio is behind, and how to take it.

### Fixed

- In Claude Desktop, `studio_run ["upgrade"]` runs the extension's own newer toolkit when the studio is behind. It ran
  the studio's pinned copy, which knows nothing newer than itself, so it never offered an upgrade.
- When the plan moves the pin, its next step names the newer toolkit
  (`npx -y @homie-rocks/studio@<version> upgrade --apply`), not the studio's own older copy.

### Changed

- For contributors: a pull request that changes `@homie-rocks/studio`'s version must add that version's section to
  `CHANGELOG.md` (CI says exactly what to write), and a release stops before npm without one. A later edit to
  `CHANGELOG.md` alone never needs a new version.

## [0.19.1] - 2026-10-02

**Plugin 0.20.1** · [#28](https://github.com/homie-rocks/homie/pull/28) · [release-2026-10-02-studio-0.19.1](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.19.1)

The perf skill measures games whose studio Worker adds its own script to the game page, and reads whether code is
minified from the code itself.

### Added

- `HOMIE_PERF_SERVE_WAIT_MS`: how long the perf skill waits for a dev server to serve a new build (60 s by default).

### Fixed

- The perf skill can measure a game whose studio Worker adds a script to the game page (a small shim after
  `HOMIE_NET`, say). Its "is the site serving this build?" check never passed for such a game. Now the served page
  must hold the build's own scripts and markup exactly and in order; any other script is the site's, and BASELINE.md
  and the report list it. A Worker that changes in the middle of a loop stops the loop.
- `perf sizes` tells a minified script from source by reading its code (whitespace, comments, short names), not by
  how well it gzips. Minified three.js bundles were told to "ship minified"; they now read as minified, with how much
  of them is GLSL shader source in strings.

### Upgrade notes

- The minification hints need 0.19.1 in the studio; with an older pin the skill says nothing about minifying.

## [0.19.0] - 2026-10-02

**Plugin 0.20.0** · [#27](https://github.com/homie-rocks/homie/pull/27) · [release-2026-10-02-studio-0.19.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.19.0)

A perf skill that makes a game faster one measured change at a time, and `homie-studio perf` to measure it.

### Added

- Plugin: the `perf` skill. Say "make my game run faster on phones" or "find out why it stutters": it takes a
  baseline, profiles, tries one change at a time, and keeps a change only when it is faster beyond the noise and the
  game still passes its own check. Every try says whether the game should look and play the same, and the
  screenshots are compared. It ends with `perf/<id>/README.md`: the numbers, and the game before and after.
- `homie-studio perf`: two real Chromes (a host and a replica) in a room of their own, as a computer or an emulated
  phone, measuring frame times, JavaScript and main-thread time per frame, time to playable, downloads, memory and
  netplay traffic. Every run records how busy the computer was, and a software-rendered run is marked blocked
  instead of judged.
- `perf --profile` names the hottest functions by your own file and line (`build --maps` keeps the source map out of
  the site), `perf compare` judges a change against the noise (side-by-side runs as pairs), and `perf sizes` lists
  every built file, raw and gzipped.

### Upgrade notes

- `homie-studio upgrade --apply` adds the `perf/` row and the command to AGENTS.md, and `.perf/` to `.gitignore`.

## [0.18.2] - 2026-10-02

**Plugin 0.19.2** · [#26](https://github.com/homie-rocks/homie/pull/26) · [release-2026-10-02-studio-0.18.2](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.18.2)

`upgrade` reads the Homie Arcade studio's own sections right, and Ember Vale shows heroes' names and spreads out
their spawns.

### Fixed

- `homie-studio upgrade` no longer mistakes an untouched AGENTS.md section for one you edited when the template's
  own words name your studio (the Commands section's "on Homie Arcade", read by the Homie Arcade studio). That
  studio now takes the template's newer text like every other; words you changed are still kept.
- The port kit's `createRoom` gives a player who joins mid-round a free spawn spot instead of spot 0, so several
  heroes no longer appear on one spot. The spot is kept in the room's checkpoint.
- Ember Vale shows each hero's own name over the hero, in the night's ranking and on a watcher's panel (it showed
  the room's two-word handle). Names are one line of up to 20 characters, and on a kids server other players stay
  handles. Its first spawn spots are spread around the camp.
- The studio's timing tests run on virtual time, so a busy computer no longer fails them.

### Upgrade notes

- A game made from Ember Vale before 0.18.2 keeps its own copy of the starter: the spawn fix reaches it when it is
  rebuilt with 0.18.2 or later (it is in the port kit), but the names are the starter's own code, so copy them over
  or make the game again from the starter.

## [0.18.1] - 2026-10-02

**Plugin 0.19.1** · [#25](https://github.com/homie-rocks/homie/pull/25) · [release-2026-10-02-studio-0.18.1](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.18.1)

Games fill a phone held upright, players' names never pile up, and `doctor` checks the AI guides' Workers AI model.

### Added

- Port kit: `fitView` shows the whole world where it fits (a computer, a TV) and elsewhere fills the screen and
  follows the player, never past the world's edge; `createLabels` places players' names so yours is never covered
  and the others never overlap or flicker.
- `homie-studio doctor`: when a server's AI guides think with Workers AI, one tiny call checks the model on your
  account and says plainly when it needs Workers Paid, is gone, is private or wants its licence accepted, and what to
  do. It never prints a token or an account id.

### Fixed

- Ember Vale on a phone held upright fills the screen and follows your hero (the vale was a small band in the
  middle). Its ask panel sits right above STRIKE and keeps its buttons steady so a tap lands, guide bubbles never
  cover your hero, and the HUD is the right size on high-density screens.
- Gem Rush on a phone held upright fills the screen and stops at the arena's edge, and its names use `createLabels`.

### Upgrade notes

- Games made from the starters before 0.18.1 keep their own layout. `fitView` and `createLabels` are in the port kit
  for any game to use.

## [0.18.0] - 2026-10-02

**Plugin 0.19.0** · [#24](https://github.com/homie-rocks/homie/pull/24) · [release-2026-10-02-studio-0.18.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.18.0)

Big songs and videos live in the studio's own R2 once it has storage, at the same addresses, and the video skill
records a page while a script drives it.

### Added

- With storage, every published song or video file over 1 MiB (studio.json `media.r2Over`), or that git leaves out,
  moves into the studio's R2: `homie-studio media move [--dry-run] [--verify]`, and every `deploy` of a studio with
  storage does it first. Each file is uploaded, read back and checked by SHA-256 before the site stops carrying it.
  Your local file is never changed, and the addresses stay the same, with seeking, caching and HEAD.
- `media list` shows where each file is served from and what would move. A deploy from a checkout without the media
  (another computer, Workers Builds) keeps every file already moved.
- Plugin: the video skill records a page while a script drives it (`video.mjs record <slug> --steps steps.json`):
  clicks, taps, drags, keys, typing, scrolling and waits, on the page or inside the game, as a computer (16:9) or a
  phone (9:16), with captions at each step's second. Real time and honest frames: held frames are counted, never
  blended.

### Changed

- What R2 costs is said where you decide: no egress fees, 10 GB-month of storage free and then US$0.015 per
  GB-month, and Cloudflare asks for a payment method before R2 works. `media move` warns past 10 GB and refuses a
  file over 300 MiB.
- Plugin: the video skill's Chrome starts on Linux the way the studio's own checks do, as a Claude Code cloud session
  needs.

### Upgrade notes

- A studio without storage changes nothing: files up to 25 MiB a file are still served from the site. With storage,
  your next `deploy` moves the big files to R2; run `homie-studio media move --dry-run` first to see which. `upgrade`
  lists your big media and this step, and never moves a file itself.

## [0.17.0] - 2026-10-02

**Plugin 0.18.0** · [#23](https://github.com/homie-rocks/homie/pull/23) · [release-2026-10-02-studio-0.17.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.17.0)

AI guides that talk in your game's own words: on a beginner server they pick goals and lines from the game's
vocabulary, and your own Claude can take a guide's seat.

### Added

- `games/<id>/agents.json`, a game's vocabulary: goals, lines, and the asks a player taps ("Help me with King
  Slime", "No thanks"). The build checks it.
- An AI without the game client sees the game through `agent:view` and acts through `agent:do`. It may only say the
  vocabulary's lines, and only on a server whose AI may talk; the relay drops everything else, including a line a
  host tries to put in an AI's mouth (NETPLAY.md v1 revision 7, section 18).
- `@homie-rocks/studio/agents` (`useAgents`) for the host: views, a scripted floor, goals for your bot code, asks as
  buttons and lines rendered from the vocabulary.
- Guides on a beginner server decide on the room's own alarms with your studio's Workers AI, or your own Anthropic
  key (Claude Haiku 4.5), within a daily budget (8,000 neurons and $1 by default); otherwise they follow the script.
  Fixed rules sit outside the model: an ask is answered the way agents.json says, a guide says one line every 8 s
  at most, "no thanks" holds it off for 10 minutes, and no name, account or address goes into a prompt.
- Your own Claude in a guide's seat: the local MCP's `agent_sit`, `agent_look`, `agent_do` and `agent_stand` (and
  `homie-studio agents sit`) seat it as "Claude · AI".
- Ember Vale is the reference game for guides, and `agents/GUIDES.md` is a short path for an existing RPG.

### Upgrade notes

- Turning AI talk on the first time is an ask you confirm, and so is raising the cap on your own key. Deploy binds
  Workers AI only when a server's guides use it, never in a Preview, and `homie-studio dev` keeps guides scripted
  unless you pass `--remote-ai`. `homie-studio agents brain key` takes your key on a one-use page on your own
  computer; it is never printed or pasted into a chat.

## [0.16.1] - 2026-10-02

**Plugin 0.17.1** · [#22](https://github.com/homie-rocks/homie/pull/22) · [release-2026-10-02-studio-0.16.1](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.16.1)

Servers polish: an opaque vote card, the server pill beside the room button, and a New server form that explains
itself.

### Fixed

- The AI level vote card is fully opaque, so the game's own hints no longer show through it. The TV view never
  shows it.
- The server pill sits beside the room button, in the same band (on a phone held upright it is a dot from the
  start), so the play page covers no more of the game than before. A server room's button says "Room 2", not the
  server's internal id, and Gem Rush draws its scores under that band.
- The office's New server form groups its controls, explains each one in the words players see on the site, shows
  only what applies to the kind of server you picked, and keeps what you set while the office refreshes.

## [0.16.0] - 2026-10-02

**Plugin 0.17.0** · [#21](https://github.com/homie-rocks/homie/pull/21) · [release-2026-10-02-studio-0.16.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.16.0)

Servers and AI seats: named pools of rooms with their own rules, every AI seat labelled as AI, and a skill dial the
party votes on.

### Added

- Servers, a game's named and lasting pools of rooms, each with a policy: **open** (an AI with a pass may sit,
  always marked AI), **humans-only** (no AI of any kind), **hybrid** (the top seats of every room are AI companions)
  and **beginner** (new accounts, AI guides, quick lines only; with Kids on, handles only). Strangers are matched only
  inside one server. Every game's public rooms are its Quick play server, so old links and rooms keep working.
- Agent seats: an AI sits with a pass only your Worker can verify and is named "<label> · AI" everywhere. The relay
  labels every roster and round result, so a modified host cannot pass an AI off as a person, and AI never keep a
  room alive on their own.
- The skill dial: 1 Rookie to 5 Maxed (3, Fair, is how the port kit's bots always played). The party votes on a
  card, and the server's ceiling caps it.
- On the site: a Servers band on each landing, `/<game>/servers/` and a page per server; the play page's server
  pill, vote card and AI pills. The office manages servers, agent passes and AI levels, and anything that narrows a
  server is an ask you confirm with one tap.
- `homie-studio servers`, `agents pass|passes|revoke|brain` and `office invite --server`. Plugin: the `servers`
  skill.
- For game code: `net.policy`, `net.skill`, `net.vote()`, `net.agents()` and more in the netplay helper, all of it
  done by the port kit's `createRoom`, and a `skill` option for BotBrain (NETPLAY.md v1 revision 6, section 17).

### Upgrade notes

- D1 migration `0006_studio_servers.sql`: `upgrade`, `deploy` and `dev` add it.
- A game built before 0.16.0 still plays on any server, and the office marks it "predates servers". Rebuild it with
  0.16.0 or later for the dial and AI seats.

## [0.15.0] - 2026-10-01

**Plugin 0.16.0** · [#20](https://github.com/homie-rocks/homie/pull/20) · [release-2026-10-01-studio-0.15.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.15.0)

Watch any player: anyone can watch a live room from any player's view, on every studio, with nothing streamed.

### Added

- `/<game>/watch?room=<room>` shows a live room like a broadcast: a band above the game (live, the round's clock, how
  many are watching, Play into this room) and a dock below with each player, Auto and the whole room. Tap, or use
  keys 1 to 9, A, O, the arrows and F. It works on phones, computers and TV-sized screens; with no room given it
  finds the busiest public one.
- The watcher's own browser draws the game from the followed player's view, as a watcher that never takes a seat
  (NETPLAY.md v1 revision 5, section 16). Auto holds each player at least 3.5 s, then cuts to the newest spotlight (a
  game marks one when someone waves or lands a kill, say), and otherwise follows the leader.
- Watch buttons beside Join on every room row and on landings; `/api/rooms` rows carry `watch`; watches count in
  your stats, and the play page says how many are watching.
- game.json `"watch": "overview"` shows only the whole room (for hidden hands or roles), and `"watch": false` turns
  watching off. Private and invite-only games are watched only by people they let in, and a kick also keeps that
  browser from watching.
- For game code: `net.watching`, `net.viewSeat`, `net.follow()`, `net.spotlight()`, `on('view')` and `PALETTE`; the
  port kit adds `room.viewSeat()` and `room.viewBody()`. Gem Rush and Ember Vale follow a player.

### Fixed

- Auto cuts the moment the player shown has had their 3.5 s, not up to half a second later.

### Upgrade notes

- Every existing game can be watched as its overview straight away. To follow one player, read `net.viewSeat` (or
  listen for `view`) and draw that player's camera and HUD.

## [0.14.4] - 2026-10-01

**Plugin 0.15.4** · [#19](https://github.com/homie-rocks/homie/pull/19) · [release-2026-10-01-studio-0.14.4](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.4)

Remix credit and licence: a game's shared source says who made it and what its owner allows, and a remix credits
its original.

### Added

- game.json `"license"`: `"remix-with-credit"` (the default: a remix says "Remix of <game> by <studio>" with a link
  back), `"remix-freely"`, or `"no-remix"` (the source can be read, and the remix flow refuses it). An SPDX id such
  as `"MIT"` can be named too.
- A shared `source.json` carries `credit` and `license`, and a remix's game.json gets `remixOf`: the credit and the
  original's name, studio, page and licence (and its own original, for a remix of a remix).
- The site shows "Remix of <game> by <studio>" on a remix's landing and in its credits, names the source's licence on
  every landing, and offers "Open to remix" only when the owner's remix switch, the launch state and the licence all
  allow it. The directory manifest carries `license` and `remixOf`.

### Upgrade notes

- A shared source from before 0.14.4 reads as the default licence, remix with credit. Set `"license"` in a game's
  game.json for anything else.

## [0.14.3] - 2026-10-01

**Plugin 0.15.3** · [#18](https://github.com/homie-rocks/homie/pull/18) · [release-2026-10-01-studio-0.14.3](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.3)

Fixes from a first full run in Claude Desktop: links are yours to open, an earlier attempt can be folded in, log lines
cut cleanly, and every answer fits Claude Desktop's 1 MB limit.

### Added

- `studio_fold`: when a folder with your studio's name already exists and is not a studio, the AI asks you first,
  then copies its notes into `notes/earlier/<folder>/` for the plan to use; with a second yes it moves the old folder
  to the Trash (on a Mac). It never touches any other folder. If the name is taken in the studios folder, the new
  studio goes in `<name>-studio`.

### Fixed

- After `game_demo` and `preview_run`, the AI hands you the Play link or the card's button instead of opening a
  browser itself (a permission prompt once sat unanswered for minutes).
- The build card's log lines are cut at a word's end, so a step count is never lost mid-number.
- Every answer stays under Claude Desktop's 1 MB limit: a big picture from `file_read` comes back as a smaller JPEG
  copy (your file is never changed), and one guard trims pictures first, then text, and says what it left out.

## [0.14.2] - 2026-10-01

**Plugin 0.15.2** · [#17](https://github.com/homie-rocks/homie/pull/17) · [release-2026-10-01-studio-0.14.2](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.2)

Homie for Claude Desktop turns itself on as it installs.

### Fixed

- Claude Desktop installed the extension switched off, because its Studios folder setting was marked required. The
  setting is now optional, with a Studios folder in your home folder as its default, so the extension turns itself
  on.

### Changed

- Every local tool's description starts with "Homie Studio", and the server tells Claude it is not the separate
  Homie app, whose own MCP server may be listed on the same computer.

### Upgrade notes

- If Settings → Extensions shows Homie Studio switched off after an earlier install, switch it on, or install this
  version's `.mcpb`.

## [0.14.1] - 2026-10-01

**Plugin 0.15.1** · [#12](https://github.com/homie-rocks/homie/pull/12), [#13](https://github.com/homie-rocks/homie/pull/13), [#14](https://github.com/homie-rocks/homie/pull/14), [#15](https://github.com/homie-rocks/homie/pull/15), [#16](https://github.com/homie-rocks/homie/pull/16) · [release-2026-10-01-studio-0.14.1](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.1)

Rooms re-check a game's launch state as they open, the plugin gets a Codex manifest, and its skills read cleanly to
skill scanners.

Three changes landed without a version of their own (#12 to #14), and #15 gave them 0.14.1. The first publish run
for the 0.14.1 tag stopped before anything reached npm: #12 had also renamed a constant in `@homie-rocks/render`
without giving render a new version, and a release refuses that. #16 put render back exactly as published, the tag
was moved to that commit, and the run there published 0.14.1. The render rename did not ship; it waits for render's
next version.

### Added

- Plugin: a Codex plugin manifest (`.codex-plugin/plugin.json`) with an icon, and a plugin README and SECURITY.md,
  for plugin catalogs.

### Fixed

- A room that opens at the moment its game goes private or invite-only reads the launch state on its first
  heartbeat and re-gates itself after the current round, like every other room.
- Plugin: the office skill matches 0.13.0 (rooms finish their round when a game narrows; the say, chat and emote
  convention for mute; what a kick holds).
- Plugin: the skills avoid the characters and patterns skill scanners flag. Nothing behaves differently.

### Changed

- For contributors: CI and the publish workflow pin their GitHub Actions to commit SHAs.

## [0.14.0] - 2026-10-01

**Plugin 0.15.0** · [#11](https://github.com/homie-rocks/homie/pull/11) · [release-2026-10-01-studio-0.14.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.0)

One chat: a new studio starts with no game, the toolkit runs as a local MCP server, Homie for Claude Desktop, and a
one-line hand-off from a phone.

### Added

- Homie for Claude Desktop: the toolkit as a desktop extension, attached to every GitHub release from this one on.
  The chat that shows Homie's cards makes the studio, builds, checks and deploys, with no terminal. Long work
  (installs, checks, deploys) runs as background jobs, so no tool call holds the chat.
- `homie-studio mcp`: the same tools as a local MCP server (setup, studios, games, build, preview, check, playtest,
  deploy, progress, files that never leave the studio, and the plugin's guides), named and shaped like the remote
  Homie MCP's where they overlap. `studio_open` clones a studio made on a phone from GitHub with the computer's own
  sign-in.
- `homie-studio demo` (and `game_demo`) points at a live game on Homie Arcade to try first.
- `homie-studio codex new <id>` starts a game with only its Game Codex; `game new <id>` later makes the game around
  it.
- `HANDOFF.md` and `homie-studio handoff hb_…`: "Continue building <Studio>" in a Claude Code session takes the build
  the chat opened.

### Changed

- A new studio has no starter game. `new`, the Deploy to Cloudflare template and the Claude app's setup make a home
  that says "First game coming soon", and a starter (`gem-rush`, or `ember-vale`) is copied in only when you ask.
  `dev` and `deploy` work with no game.
- Plugin: studio-setup's checklist and the game and plan skills follow this (with no starter, step 3's one small
  change is to the studio's own home).

### Fixed

- `upgrade` keeps two new AGENTS.md sections in the template's order (it used to swap them).

### Upgrade notes

- Existing studios keep their games. `upgrade --apply` adds `HANDOFF.md` and the AGENTS.md section about continuing
  a build.
- The `.mcpb` is not signed yet, and Claude says so as it installs it.

## [0.13.0] - 2026-10-01

**Plugin 0.14.0** · [#10](https://github.com/homie-rocks/homie/pull/10) · [release-2026-10-01-studio-0.13.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.13.0)

The studio's back office: live rooms, kick, mute, announce, launch states and invites, and the owner recognised in
their own game.

### Added

- `/_studio/office`, the owner's private page: every live room of every game and who is in it, refreshed every 3 s.
  Kick (for as long as you choose), mute, announce to a room, a game or the whole studio, close a room, and per game:
  its launch state, remix switch, players per room and invites.
- Launch states per game: `private` (only you), `invite` (an invite-only beta with `XXXX-XXXX` codes and links) and
  `public` (the default). A game that is not public is in no list and refuses anyone without access. Narrowing never
  cuts a round short: each room finishes its round, then re-gates. game.json `"launch"` keeps a new game private from
  its first deploy.
- The owner in their own game: a small Owner button on your play page, with everyone in the room, Mute and Kick.
  Nobody else's page carries it. A game can open a player's card with `net.pickPlayer(seat)`.
- An office key for your AI (`homie-studio office key`): it can look, announce and invite, and a kick, mute, close
  or launch change becomes an ask you confirm with one tap. No key can confirm.
- `homie-studio office [link|key|announce|invite|launch|kick|close|revoke]`. Plugin: the `office` skill.
- Netplay revision 4 (NETPLAY.md section 15): the room verifies the owner's signed controls; new `announce` and
  `mute` frames, and `kicked` and `room-closed` refusals.

### Changed

- The owner's session cookie lives at `/` (the office carries an older `/_studio/` one over), and the owner's passkey
  account from 0.12.0 counts as the owner everywhere.

### Upgrade notes

- D1 migration `0005_studio_office.sql`: `upgrade`, `deploy` and `dev` add it.
- For mute to work in your game, send chat, quick lines and emotes as events whose kind starts with `say`, `chat` or
  `emote`.

## [0.12.1] - 2026-10-01

**Plugin 0.13.1** · [#9](https://github.com/homie-rocks/homie/pull/9) · [release-2026-10-01-studio-0.12.1](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.12.1)

The toolkit works through a proxy, as in a Claude Code cloud session, a failed request says what actually failed,
and the hand-off opens the studio's own repository.

### Added

- The studio's repository is read from `HOMIE_REPO`, studio.json `github` or the git remote, and `setup attach`
  refuses without one. `deploy` passes it to the Worker, which tells the directory (never in the public manifest), so
  a hand-off opens the session in your studio's repository.
- Plugin: the game skill checks that the session is in the repository the prompt names, and quotes the toolkit's
  message instead of guessing at a cause.

### Fixed

- With a proxy in the environment (`HTTPS_PROXY`, as a cloud session has), the CLI uses it. Node's `fetch()` went
  around it, failed to find homie.rocks, and the session wrongly blamed its network settings.
- A failed request says what happened: the server's status and message, or the connection error and whether the
  proxy was used. The network setting is named only when the proxy itself refuses.
- `setup status` no longer calls a failed request a missing connector.

## [0.12.0] - 2026-10-01

**Plugin 0.13.0** · [#8](https://github.com/homie-rocks/homie/pull/8), [#7](https://github.com/homie-rocks/homie/pull/7) · [release-2026-10-01-studio-0.12.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.12.0)

Player accounts and cloud saves: persistent games whose characters last for days and follow a player to every
device.

### Added

- Player accounts on the studio's own site, passkey first: no password, no email. Pressing Play needs nothing; the
  first save makes a guest, and a guest who makes a passkey keeps everything. Sign in on another device with the
  same passkey. Recovery is another passkey, or an email when the studio binds a mail sender.
- Cloud saves, `@homie-rocks/studio/saves` (also on `window.HomiePort`): per player and per game, versioned, so a
  stale copy is a conflict and never a silent overwrite, and offline-tolerant with a local outbox. Lifetime stats,
  and a hall of the fallen for hardcore games (`saves.fall()` writes a memorial and wipes the saves in one step).
- The Ember Vale starter, a persistent-character game on the same public rooms: `homie-studio game new <id> --from
  ember-vale`.
- `/account/`: your name, passkeys, recovery email, and download or delete everything. No IP address is stored and no
  third-party script or cookie is used; the owner sees counts (`homie-studio players`), never a passkey or an email.
- Plugin: the plan interview always asks whether progress must last across sessions or devices, and the game skill
  wires saves in when it does.

### Changed

- The docs say a Claude Code cloud session's default network reaches homie.rocks; changing it is a troubleshooting
  step, not a setup step ([#7](https://github.com/homie-rocks/homie/pull/7)).

### Upgrade notes

- D1 migration `0004_players.sql`: `deploy` and `dev` add it to an older studio, and so does `upgrade`. `account` is
  now a reserved game id and site path.
- A game opts in to saves with game.json `"saves": true`.

## [0.11.0] - 2026-10-01

**Plugin 0.12.0** · [#6](https://github.com/homie-rocks/homie/pull/6) · [release-2026-10-01-studio-0.11.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.11.0)

A new creator's first hour: setup status, a checklist that never jumps ahead, the Game Codex, parallel agents, and
the build's progress under your prompt.

### Added

- `homie-studio setup status` (also `doctor`): one checklist of Node, the Homie connector, Cloudflare (signed in,
  email verified), Chrome, ffmpeg, the optional GitHub, ElevenLabs and fal, and Claude Code's status line. Each row
  says what it unlocks and the exact fix; optional rows never block, and nothing private is printed.
- The Game Codex: `games/<id>/CODEX.md` in plain Markdown, and `homie-studio codex <id>`, which draws it as a page in
  the game's own look (cards, controls, milestones, decisions, open questions) with a live Build status tab.
  `--artifact` makes a self-contained copy; on the site it is owner-only, at `/_studio/codex/<id>/`.
- `homie-studio statusline`: Claude Code's status line shows the build's stage, a bar, its checks and spend.
  `statusline --install` writes it into `.claude/settings.local.json`, never over one you have, and `--project` is
  for when Claude Code started in the folder above the studio.
- Plugin: studio-setup shows one checklist and ticks it as it goes, asking before it copies a starter; the `plan`
  skill's short interview (two or three questions a message, each with a pick) becomes the Game Codex; the `parallel`
  skill offers one agent or several, with the trade-off said plainly.

### Fixed

- The codex's "Ready to try" link is drawn only for a web address, and `setup status --homie` falls back to
  homie.rocks when what it is given is not an address.

## [0.10.0] - 2026-10-01

**Plugin 0.11.0** · [#5](https://github.com/homie-rocks/homie/pull/5) · [release-2026-10-01-studio-0.10.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.10.0)

A studio from the Claude app with no terminal: Deploy to Cloudflare makes it, Workers Builds deploys every push with a
Preview per branch, and the site lists itself.

### Added

- `template/`: the public Deploy to Cloudflare template, made by `homie-studio new --template` and checked on every
  pull request.
- Previews: each branch's Preview gets its own rooms, binds no D1, counts nothing and never lists itself.
- In Workers Builds (`WORKERS_CI=1`, or `--ci`), `npm run deploy` only applies D1 migrations and deploys; it creates
  and writes nothing else.
- The site claims its own place in the directory the first time the directory reads it, so nobody runs
  `d1 execute`. It never claims from a Preview, or when studio.json says `homie.directory: false`.
- For a Claude Code session: `setup attach <hs_…>`, `progress attach <hb_…>`, `progress change` and
  `progress pr --url …`, so the chat's cards follow the build and say Live once the site lists the change.
- `homie-studio chrome install`: Chrome for Testing for the checks on a Linux machine with no GPU. `check` reports
  each browser's frame rate and renderer, and never judges a software frame rate.
- The manifest says what is deployed (commit, branch, when), and `HOMIE_DIRECTORY` points one build at another
  directory.

### Changed

- New studios keep `wrangler.jsonc` at the studio's root, where Workers Builds reads it, and pin the toolkit from
  registry.npmjs.org by exact version.
- Every studio Worker sets `global_fetch_strictly_public`, so a site whose directory is on the same zone can reach
  it.

### Fixed

- Chrome for Testing starts on Ubuntu 24.04, which forbids its sandbox: the checks turn the sandbox off only where
  the system requires it.

### Upgrade notes

- Studios made before keep `site/wrangler.jsonc`; every command finds either, and `upgrade` never moves it. A studio
  pinned to a homie.rocks tarball keeps that kind of pin when it upgrades.

## [0.9.0] - 2026-09-30

**Plugin 0.10.0** · [#4](https://github.com/homie-rocks/homie/pull/4) · [release-2026-09-30-studio-0.9.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.9.0)

`homie-studio upgrade`, which brings an older studio up to the newest template without touching what you changed,
and template polish from studios moving to 0.7.0.

### Added

- `homie-studio upgrade [--apply] [--diff]`: what this version's template adds to an existing studio (AGENTS.md
  sections, READMEs, `.gitignore` lines, D1 migrations, package.json scripts and the pin), as a plan with diffs. A file
  or section is replaced only when it is exactly an older template's text; anything you changed is kept, and
  `--diff` shows how it differs.
- game.json `screen.share` places the room button per device (`top-left`, `top-center`, `top-right`, `bottom-left`,
  `bottom-right`, with offsets, or as a small icon).
- game.json `landing.scheme: "light"`, for a white or cream game's landing.
- The site's root answers a game's `/__homie/*` check with `not-a-homie`, as each game's own path already did, so a
  studio no longer needs a wrapper Worker for it.
- For the homie.rocks hub: each game's week of plays in the manifest when the studio shares its stats, studio.json
  `"rooms": { "share": false }`, and `/api/rooms` cached for 15 s.
- Plugin: `capture-game.mjs --scale` renders a heavy game smaller and scales it up to the film's size.

### Changed

- Cards and the directory show a game's landing still (`hero/wide.jpg`, else a trailer's poster, else the cover). A
  song's cover falls back to the album's, then its game's landing still, then the studio's share picture.
- Every Chrome the toolkit and skills start may take up to 150 s, and `check` waits 90 s for pages and seats, for
  busy computers.

### Fixed

- `check` on a busy computer: a browser the relay dropped for being quiet no longer fails the round. A round counts
  when each browser has a seat in its results, and a failure says which seat was left out, whether a browser lost its
  connection, and how busy the computer was.
- `capture-game.mjs` advises half size or more, and says when the computer is too busy to capture well.

## [0.8.0] - 2026-09-30

**Plugin 0.9.0** · [#3](https://github.com/homie-rocks/homie/pull/3) · [release-2026-09-30-studio-0.8.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.8.0)

A build you can watch: the progress feed behind the Claude app's build card.

### Added

- A build of a game, song or video can keep a small progress feed (`.studio/progress/<build>.json`): its stages and
  checks, a picture and the address to play, spend against a budget, a song's waveform, a video's shots, the latest
  log lines, and a Stop button.
- `build`, `check`, `port check` and `deploy` report into an open feed by themselves. `check` reports its four steps
  live, with pictures, and a deploy with every check green ends the build with the live Play address.
- `homie-studio progress stage|check|spend|preview|shot|song|log|end|show` for what only the AI knows, and `--share`
  so the Claude app's card can show the feed for 24 hours. The write key stays on your computer and is never printed.
- Stop, from the terminal or the card, is heard before each stage and every 5 s while one runs. Nothing already
  built or deployed is undone.
- Plugin: the game skill opens a feed when you follow a build in the app.

### Changed

- Nothing, unless a feed is open: without one, every command behaves exactly as before.

## [0.7.0] - 2026-09-30

**Plugin 0.8.0** · [#2](https://github.com/homie-rocks/homie/pull/2), [#1](https://github.com/homie-rocks/homie/pull/1) · [release-2026-09-30-studio-0.7.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.7.0)

Studio sites get the same sections as homie.rocks, and every game gets an epic landing page.

### Added

- Sections like the homie.rocks hub, in your studio's own look: Home, Games, Music, Videos, Rooms (every public room
  playing now, with Join) and Posts. A section with nothing in it has no tab.
- A landing page for every game at `/<game>/`, made from its own files: footage or its cover in the hero, the pitch,
  a big Play button into a public room with who is playing, the devices and join codes, how to play, credits with
  licences, and "Make a game like this". game.json `landing` sets the words, footage, credits and an accent.
- Posts: `posts/*.md`, rendered with a safe Markdown subset, with Atom and JSON feeds.
- `site/` wins: `theme.json` (each new studio starts from one of eight palettes), `theme.css`, partials, whole pages
  and public files. A page can never take over the rooms, the game files or the API.
- `homie-studio look`: pictures of the site's pages on a computer, a phone and a phone turned sideways, with what is
  wrong on each.
- The play page keeps the room in its address, and a small room button opens Invite, Big screen and the room code. A
  player without a name gets a two-word handle ("Rusty Rocket").

### Changed

- Generated pages refuse to be framed by other sites, every HTML answer is `no-transform`, and the referrer policy
  shares only your site's address, never a path.
- For contributors: this repository is now where the open parts are developed, with CI, a leak audit and a contract
  test for every engine package ([#1](https://github.com/homie-rocks/homie/pull/1)).

### Fixed

- Gamepads work in WebKit 26 inside the game's frame.
- A `?room=` the relay cannot use is refused with a way into a public room, never silently swapped.
- A bundled game's cover in its `public/` folder is found, `look` judges Play only on Home and landings, a band
  partial that is its own `<section>` stands alone, and new studios keep `.checks/` screenshots out of git.

### Upgrade notes

- A studio on 0.6.0 moves by pinning 0.7.0; nothing in its `site/` changes.

## [0.6.0] - 2026-09-30

**Plugin 0.6.0, then 0.7.0** · [b1cef3d](https://github.com/homie-rocks/homie/commit/b1cef3d), [002ab27](https://github.com/homie-rocks/homie/commit/002ab27) · [release-2026-09-30-studio-0.6.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.6.0)

Rooms of up to 32, and the studio's own stats, read only by its owner.

### Added

- A room's size comes from the game's netplay manifest (game.json `netplay`, or `netplay.json`), up to 32 seats. One
  address may hold every seat plus four more, for a party on one Wi-Fi with a TV. The relay's caps double for rooms
  of 17 to 32 (NETPLAY.md revision 3).
- The netplay helper sends an unchanged input frame at most four times a second, which keeps an idle player's seat.
- Studio stats: page opens, Play presses by where they came from, rooms, rounds, peaks, and song and video starts,
  as daily counters in the studio's own D1. Only the owner reads them: `homie-studio stats`, a read key, or a
  one-time sign-in to `/_studio/stats`. Nothing follows a visitor.
- Plugin 0.6.0: the skills say how to read stats. Plugin 0.7.0 came out of the marketplace soon after, with no studio
  change: a `sound` skill (effects and synthesized scores made on your computer, measured, wired into the game), an
  `art` skill (covers from real frames, and fal images under a budget), a `playtest` skill (real browsers on a
  computer and a phone, then a blind review), and delivery checks for the video skill.

### Changed

- `deploy` keeps the workers.dev address, which names your Cloudflare account, in `.studio/local.json` (ignored by
  git) and never in studio.json.

### Fixed

- The stats sign-in keeps its origin, and the stats tables fit a phone.

### Upgrade notes

- A 0.5.0 studio's committed workers.dev address moves out of studio.json on its next deploy, which also adds
  `.studio/` to `.gitignore`. Stats need D1 migration `0002_studio_stats.sql`, which `deploy` and `dev` add.

## [0.5.0] - 2026-09-30

**Plugin 0.5.0** · [3b93106](https://github.com/homie-rocks/homie/commit/3b93106), [0304da8](https://github.com/homie-rocks/homie/commit/0304da8) · [release-2026-09-30-studio-0.5.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.5.0)

Song and video pages on your studio's site, with no storage needed.

### Added

- `/music/<slug>/` (a player, words, loops and stems to download, and the rights line) and `/videos/<slug>/` (a
  player that plays the 9:16 cut on an upright phone, with poster, captions and credits), listed on Home, at
  `/music/` and `/videos/`, and for the directory. `media/MEDIA.md` is the manifest contract.
- `homie-studio media list` (what the site will show, and why anything is left out) and `media put` (a file in R2).
- Songs and videos are served with byte ranges, so phones can seek. A studio with songs or videos and no games can
  build, dev and deploy.
- Plugin: the `music` skill (songs, themes and game scores with ElevenLabs Music on your own account, within a credit
  cap you set, with receipts) and the `video` skill (gameplay trailers captured from your game, and music videos from
  fal under a budget).

### Changed

- The site serves a song's or video's files itself, up to 25 MiB a file; storage (R2) is only for bigger media.
- The first version released by this repository's publish workflow, with npm provenance.

### Upgrade notes

- `music`, `videos` and `posts` are reserved: they are page addresses, not game ids.

## [0.4.0] - 2026-09-30

**Plugin 0.4.0** · never on npm: served only as a tarball on homie.rocks, before this repository's releases.
Everything in it is also in 0.5.0.

A studio with no credit card: deploy creates only what Cloudflare's free Workers plan gives a new account.

### Added

- `deploy --plan` says what deploy creates and what it costs, and calls nothing. The first deploy says it again
  before it creates anything, and a new account's first deploy names its next step (verify the email, pick a
  workers.dev address).
- `homie-studio storage add`: R2 as its own later step, which stops with Cloudflare's dashboard link until the
  account has R2 turned on (Cloudflare asks for a payment method first).
- `homie-studio dev --stop` stops exactly this studio's dev server, and nothing else on the computer.

### Changed

- `deploy` creates one Worker, one D1 database and the SQLite-backed Table and Lobby Durable Objects, and never
  creates or binds R2.
- Plugin: the skills say what they will create and what it costs before they do it, stop only their own dev server,
  and point at GitHub Issues.

## [0.3.0] - 2026-09-30

**Plugin 0.3.0** · before this repository's pull requests: [3b93106](https://github.com/homie-rocks/homie/commit/3b93106) · [npm](https://www.npmjs.com/package/@homie-rocks/studio/v/0.3.0)

The port kit: make an existing single-player web game multiplayer.

### Added

- `@homie-rocks/studio/port` (and `window.HomiePort` for static games): `createRoom` with bots, join in progress,
  rounds, host migration and snapshots; a touch kit (a floating stick, buttons, key synthesis, swipes); camera rules;
  a HUD; and shims that make storage, cookies and gamepads work inside the game's sandboxed frame.
- `homie-studio port plan|import|check`: grade a game (easy, medium, hard, not a fit), import it, and prove the port
  with real keys and touches on Android Chrome and iPhone WebKit, two browsers finishing a round, a killed host, a
  late joiner and the big screen.
- `build` takes static and command-built games beside bundled ones, and the site gains `/<game>/tv`, a big screen
  with a QR code into its room.
- Plugin: the `port` skill.

### Changed

- The netplay helper is sturdier: input pacing, reconnecting after a flood, and a guard on the snapshot backlog.

## [0.2.0] - 2026-09-29

**Plugin 0.2.0** · this repository's first commit, [cfbd987](https://github.com/homie-rocks/homie/commit/cfbd987) · [npm](https://www.npmjs.com/package/@homie-rocks/studio/v/0.2.0)

`@homie-rocks/studio` on npm, open source under Apache-2.0, in this repository.

### Added

- The 22 `@homie-rocks` game engine packages (arcade, audio, brush, bus, camera, device, diagnostics, film, fx, geom,
  heightfield, input, loop, noise, postfx, props, render, scatter, scores, ui, ui-world and walk) were first
  published at 0.1.0 the same day, and none has needed a new version since.

### Changed

- The package is `@homie-rocks/studio`, under Apache-2.0 and on npm (0.1.0 had another name, in an npm scope Homie
  does not own). The plugin is Apache-2.0 too.
- `new` installs the pinned dependencies itself, and every command runs the studio's own copy (`npm run …`,
  `npx --no-install homie-studio`).
- The play page's chip sits bottom left and fades after 5 s (it covered a game's round clock).

### Fixed

- A deploy cut short resumes instead of refusing its own database as someone else's: each Cloudflare resource is
  recorded the moment it exists.
- `check` counts only a round that finishes after both browsers are seated and in its results, and exits even when
  Chrome's pipes outlive it.

### Upgrade notes

- A 0.1.0 studio pins the old package name: pin `@homie-rocks/studio` 0.2.0 instead.

## [0.1.0] - 2026-09-29

**Plugin 0.1.0** · before this repository, and never on npm: served only as a tarball on homie.rocks, under the old
package name, and withdrawn when 0.2.0 came out.

The first studio toolkit: a studio in one folder, a multiplayer starter, and deploys to your own Cloudflare.

### Added

- `homie-studio new`: a studio in a new or empty folder (AGENTS.md, games/, music/, videos/, posts/ and site/),
  listing every file it writes.
- The Gem Rush starter on the netplay contract; `build` (esbuild); `dev` (the site and its rooms on your computer);
  and `check` (two fresh Chromes must share a room and finish a round).
- The site Worker: the pages, the play page, the Table and Lobby Durable Objects that run rooms, and
  `/.well-known/homie-studio.json`.
- `deploy` through Wrangler on your own Cloudflare account, refusing any Worker, database or bucket it did not
  create, and `publish` to the homie.rocks directory.
- Plugin: the `studio-setup`, `game` and `publish` skills, and the remote Homie MCP.

[0.20.0]: https://github.com/homie-rocks/homie/pull/30
[0.19.2]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.19.2
[0.19.1]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.19.1
[0.19.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.19.0
[0.18.2]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.18.2
[0.18.1]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.18.1
[0.18.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.18.0
[0.17.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.17.0
[0.16.1]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.16.1
[0.16.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.16.0
[0.15.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.15.0
[0.14.4]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.4
[0.14.3]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.3
[0.14.2]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.2
[0.14.1]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.1
[0.14.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.0
[0.13.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.13.0
[0.12.1]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.12.1
[0.12.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.12.0
[0.11.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.11.0
[0.10.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.10.0
[0.9.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.9.0
[0.8.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.8.0
[0.7.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.7.0
[0.6.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.6.0
[0.5.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.5.0
[0.3.0]: https://www.npmjs.com/package/@homie-rocks/studio/v/0.3.0
[0.2.0]: https://www.npmjs.com/package/@homie-rocks/studio/v/0.2.0
