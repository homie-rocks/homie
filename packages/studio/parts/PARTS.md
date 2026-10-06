# Game parts

Games build on each other by sharing **parts**: a piece of a game that its studio chooses to share, so somebody
making another game can use it. A creature from one game, a level from another, a bot brain from a third. That is
the whole idea. Without parts, a creator's AI has to come up with everything on its own.

Mashing up is not a command: it is making a game with parts from several games.

## The rules

1. **A part is a piece of a game, never the whole game.** Remix, which handed over an entire game, is retired;
   parts are what replaces it.
2. **A part can take any form** that suits the piece: code, assets, data, a JSON description, a tuned config, or a
   mix. Form is not restricted.
3. **Private until shared.** A studio shares a part on purpose, with a licence (an SPDX identifier) and an
   attribution. A part records the game and the studio it came from.
4. **Homie packages are not parts.** The `@homie-rocks/*` packages are general mechanisms (camera, input, audio,
   effects, netplay), installed from npm. They are never in the catalogue. A part may say which packages it builds
   on; npm installs and resolves them. There is no resolver, no version ranges, no lockfile and no registry of
   Homie's: nothing here rebuilds what already works.
5. **Creators work in chat.** A person never types a command. The tools are few and named like the asset tools:
   `parts_find`, `part_add`, `part_new` and `part_share` (sharing and un-sharing). Anything else is plumbing behind
   those.
6. **Agents look for parts first.** When planning or making a game, the agent checks the packages for general
   mechanisms and `parts_find` for pieces other studios shared, before writing from scratch; it records in the
   game's CODEX and its credits what came from where.

## In chat

- "What parts are there for a chase camera?" (`parts_find`)
- "Add the Pickup field part from owls.example/pickup-field to my game." (`part_add`)
- "Make the creature in my game a part." (`part_new`)
- "Share the creature part under CC BY." / "Stop sharing it." (`part_share`)

## How a part moves

**Share.** The creator asks. `part_new` lifts a piece out of one of their games into `parts/<id>/`: the files
move, each module's old path keeps a line that re-exports the part's, and the game still builds and plays the same.
A file that reaches into the rest of the game is refused by name (pass what it needs in as an argument first), and
so is the game's own entry, page or `game.json`: a part is never the whole game. `part_share` marks it shared with
its licence. It is **live after the studio's next deploy**, not before. The studio's site lists its shared parts at
`/.well-known/homie-parts.json` and serves their content; **a private part is never reachable**.

**Catalogue.** `https://homie.rocks/parts/` indexes the shared parts of studios that are already listed (it never
lists a studio), searchable by kind, tag, licence and what a part builds on; each part shows its game, studio,
licence, attribution and a preview. `/parts/index.json` there is what `parts_find` reads. When it cannot be
reached, `parts_find` says so plainly and still answers with the studio's own parts: an empty list never stands in
for "could not look".

**Use.** The creator asks for a piece. `part_add` fetches **one exact version** (the latest shared unless one is
named), checks its integrity (every file's SHA-256 and size, before a byte is written), copies it into the studio
at `parts/_vendor/<host>/<id>/` (theirs to tune from then on), records where it came from in `parts/origins.json`,
adds the credit to the game's `credits.json`, and lets npm install any packages it builds on. Adding it again
later brings the newer version: what changed is shown, local tuning (`tuning.json`) is kept, and a file the studio
edited is never replaced without saying so.

**Publishing a game that uses parts** shows their licences and attributions, and says plainly when licences cannot
be combined.

## A part on disk

`parts/<id>/part.json`, with the part's files beside it (`id`: lowercase letters, digits and hyphens; the folder is
named after it):

```json
{
  "id": "pickup-field",
  "name": "Pickup field",
  "kind": "mechanic",
  "version": "1.0.0",
  "summary": "Host-authoritative pickups on spawn spots.",
  "license": "CC-BY-4.0",
  "attribution": "Night Owls",
  "share": false,
  "tags": ["pickups", "netplay"],
  "from": { "game": "gem-cave", "studio": "Night Owls" },
  "entry": "src/index.ts",
  "files": [{ "path": "src/index.ts", "sha256": "…", "bytes": 1234 }],
  "preview": { "page": "preview/index.html", "image": "preview/cover.jpg" },
  "requires": { "packages": { "@homie-rocks/camera": "^0.2.0" }, "parts": ["other-studio.example/some-part"] },
  "physical": { "units": "metres", "scale": 1, "pivot": "feet", "collision": "collision.json" },
  "skeleton": { "rig": "humanoid-v1", "clips": ["idle", "run"] },
  "contract": { "inputs": {}, "state": {}, "netplay": "host-authoritative" },
  "cost": { "triangles": 0, "drawCalls": 0, "textureMB": 0, "bytes": 0, "measuredOn": "…" },
  "provenance": { "source": "original", "notes": "" }
}
```

| Field | What it is |
| --- | --- |
| `id`, `name`, `kind`, `version`, `summary` | `version` is three numbers; a shared version never changes, so a change is a new version. `summary` is one sentence. |
| `kind` | `character`, `rig`, `clips`, `environment`, `effect`, `sound`, `ui`, `mechanic`, `shader`, `level-generator`, `bot-brain`, `audio-pack`, `set-piece`. There is no kind for a whole game. |
| `license`, `attribution` | Needed to share: an SPDX identifier, and who a game using the part credits. |
| `share` | **Default `false`.** The part's own switch, and the only thing that decides whether it is shared. |
| `from` | The game and studio the part came out of. Written when a part is lifted out of a game. |
| `entry` | For a part with code: the module a game imports. A part of assets or data has none. |
| `files` | Every file with its SHA-256 and size, **written by the tool, never by hand**. A file may carry `"rights"` (below). |
| `preview` | `page`: a self-contained HTML page shown in a sandboxed frame. `image`: a still. |
| `requires.packages` | The npm packages it builds on, as `package.json` would name them. npm reads them; nothing else does. |
| `requires.parts` | Other parts it needs: a plain list of `"<host>/<id>"`. Named to the person, never solved. |
| `physical`, `skeleton`, `contract`, `cost` | Optional descriptions for whoever uses the piece: its scale, pivot and collision data; its rig and clips; its inputs, state and who decides in a room (`host-authoritative`, `replicated`, `local`); device costs that were measured (never guessed). |
| `provenance` | `source`: `original`, `generated` or `imported` (with `origin`). Needed to share. |

A field this file does not name is kept and ignored. A field whose name starts with `_` never leaves the studio.
`tuning.json` in a part holds its tunables: it ships as the author's defaults and is the one file a newer version
never overwrites (the new defaults arrive beside it as `tuning.upstream.json`).

**Sharing is refused**, in plain words, when: there is no SPDX licence; the licence asks for credit and nobody is
named; the part does not say where it came from; or the rights to a file are unknown. A file's rights are its own
`"rights"` (`{ "license": "<SPDX>" }` or `"unknown"`), else the record of a game asset with the same bytes
(`games/<id>/assets/manifest.json`: a store-licensed or bought file cannot be shared inside a part), else the
part's `provenance`.

**Licences that cannot be combined** (shown when a part is added and before a game goes online): two parts under
different share-alike licences in one game; a non-commercial part in a studio with a shop; a no-derivatives part
whose files were changed locally; a part with no licence; credit owed and missing from the game's credits. A
share-alike part is pointed out for the person's decision, and a licence the toolkit does not know is said to be
one to read.

## What a studio's site serves

`sharedPartsOf(studio)` (`lib/parts.mjs`) is the single answer to what a studio shares: its parts with
`share: true` that have a packed version. The build writes exactly that into the site, and the site, the
well-known file and through them the hub read nothing else.

- `GET /.well-known/homie-parts.json` → `{ "v": 1, "studio": { "name", "url" }, "parts": [ … ] }`. Each entry is the
  part's `part.json` (latest version), plus `"url": "/parts/<id>/<version>/"`, `"page": "/parts/<id>/"`,
  `"versions": [ … ]`, `"add": "<host>/<id>"`, and for a part from one of the studio's public games
  `"from": { "game", "name", "studio", "page", "play" }`, so a catalogue can show and group by game. CORS open for
  GET. No shared part: the same shape with `"parts": []`.
- `GET /parts/<id>/<version>/part.json` and `/parts/<id>/<version>/<file path>`: the content exactly as hashed,
  immutable (a year's cache), CORS open, GET and HEAD only. An HTML file among them (a preview) is served
  sandboxed, so it runs without the site's cookies or storage.
- `GET /parts/` and `/parts/<id>/`: the studio's own pages in its own look (each part's game, licence,
  attribution, preview, what it builds on and costs, and what to say in chat to add it), and a **Parts from this
  game** band on a game's landing page.

Sharing packs the part: the exact bytes of that version are kept in `parts/_packed/<id>/<version>/`, and every
packed version of a shared part is served, so "one exact version" stays true after a newer one ships.

## Using a part in a game

```ts
import { createPickupField } from '@parts/owls.example/pickup-field';   // a part brought in
import { chasePose } from '@parts/chase-camera';                        // one of the studio's own
import table from '@parts/owls.example/loot-table/table.json';          // any file of a part
```

The build resolves `@parts/<host>/<id>` to the part's `entry` in `parts/_vendor/<host>/<id>/`, and `@parts/<id>`
to `parts/<id>/`, and bundles it into the game. A game that imports a brought-in part is credited for it by the
build, whether or not the add named the game.

## For whoever works on the toolkit

- `lib/parts.mjs` the format, hashes, lifting, sharing checks, `sharedPartsOf`, licences; `lib/parts-store.mjs`
  find, add, share (one injectable `fetch`, one injectable npm runner: tests touch neither the network nor the
  registry); `lib/parts-build.mjs` the build's three call-outs; `lib/parts-tools.mjs` the four chat tools;
  `worker/parts.mjs` everything the site serves.
- Packages: `npm ls <name>@<spec>` says whether the studio has one; `npm install --save-exact <name>@<spec>`
  installs what is missing, after one line saying what and why; npm's output and errors are relayed as they are.
  A package the studio's own `package.json` already names at a version npm says does not fit is explained and left
  alone.
- The plumbing behind the tools is `homie-studio parts find | new | add | share | unshare | check`.
