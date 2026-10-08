# The studio site

`npm run build` (`homie-studio build`) makes a studio's whole site from the studio's own folder, and the
studio's Worker serves it. Every studio site has the same sections as homie.rocks, in the studio's own look,
and every game gets a landing page. Anything the studio puts in `site/` wins.

## Sections

| Address | What it is | Shown when |
| --- | --- | --- |
| `/` | Home: the featured game as a full-bleed hero with Play, the live rooms, the games, the latest posts, videos and music | always |
| `/games/` | Every game, with its cover, pitch, players playing now, Play and About | the studio has a game |
| `/music/`, `/videos/` | Songs and videos (`media/MEDIA.md`) | the studio has one published |
| `/rooms/` | Every public room playing now across the studio's games, each with Join (`/api/rooms` is the same as JSON, cacheable for 15 s) | the studio has a game |
| `/posts/` | The studio's posts, newest first, with `/posts/feed.xml` (Atom) and `/posts/feed.json` (JSON Feed) | the studio has a post |
| `/lounge/` | The Lounge (0.29.0): the studio's community room, with play nights, live rooms and "show what you made" (`chat/LOUNGE.md`) | studio.json has `"lounge"` |

A section with nothing in it has no tab, and its address answers 404. Every page ends with a
"Made with Homie" link to https://homie.rocks/studio/. studio.json may add `"tagline"` (one line, on Home and in
the feeds), `"site": { "featured": "<game id>" }` (the game on Home; otherwise the first with its own footage) and
`"site": { "order": ["<game id>", "<game id>"] }`: **the order of the games** in every list (Home's cards, the
Games page, `/api/games`, `/sitemap.xml`, `/llms.txt` and `/.well-known/homie-studio.json`). The
games it names come first, as it names them; every other game follows by id, which is the order all of them had
before. An id that is not one of the studio's games is skipped, and the build says so. Without `featured`, Home's
hero is still the first game with footage, now looked for in that order.

Every card (Home, Games, Rooms, a post's), every live room's row and the directory's manifest show a game's
**landing still**: `hero/wide.jpg` (or `landing.hero.image`), else a trailer's poster, else game.json's `cover`.

## What the homie.rocks hub reads

`/.well-known/homie-studio.json` is the studio's manifest: its games (in the site's order, each with its landing still
as `cover`, and `build`: `{ "hash", "bundle" }`, the digest `homie-studio build` printed for the game that is live
and the address of the bundle its page loads; [The build](#the-build)),
songs (each with a `cover`), videos (each with a `poster`), the latest posts, and `rooms`, the address of
`/api/rooms`, so the hub's Rooms page lists this studio's public rooms. With studio.json `"stats": { "share": true }`
(`homie-studio stats share on`) it also says "played this week": `played` for the whole studio and each game's own
(`games[].played`, `{ "days": 7, "plays", "rounds" }`). To keep the studio's rooms off the hub, studio.json takes
`"rooms": { "share": false }`: the manifest then names no `rooms` (the studio's own pages still list them).
Each room in `/api/rooms` carries `play` and, unless its game says `"watch": false`, `watch` (its watch door), so
the hub offers Watch beside Join. From 0.23.0 a room whose chat is on and whose rules let homie.rocks show it
(`hub`, on by default) also says `chat: true`: the hub's room card then has Chat, which opens the room's own watch
socket from the visitor's browser and shows its lines and reactions live (NETPLAY.md section 19). A visitor there
sends what a watcher may send (reactions and quick lines when the room's `react` is `anyone`), never types.

## The Lounge: `/lounge/` (0.29.0)

With studio.json `"lounge": true` (or `{ "name", "tab", "blurb", "featured", "kids", "chat" }`), `/lounge/` is the
studio's community room (worker/lounge.mjs, lounge-page.mjs; chat/LOUNGE.md): room chat in a room of its own, in the
studio's look, one column on a phone ("Chat" and "What's on") and the talk beside a sidebar on a computer. Its script
is `/_homie/lounge.js`; its socket is `/lounge/__watch` (a page of this site carries its signed-in account; a page of
another site is a watcher that reacts, never types). `/lounge/api/now` is its public facts as JSON (rules, play
nights, live rooms; CORS open, cacheable for 30 s), and the manifest names it (`lounge: { name, page, now }`).
`/lounge/api/history`, `show`, `report`, `delete` and `mod` are this site's pages' only. The owner's tools are
`/_studio/api/lounge` and `/_studio/api/lounge/rules`, `night`, `mod`, `remove` and `hold`. A game called `lounge`
keeps its page, and the build says the Lounge is off.

## Room chat on the play, watch and TV pages

Every play page, big screen and watch page carries room chat (worker/chat-page.mjs; chat/CHAT.md): the Chat pill
and its sheet, the float, the ticker, the big screen's corner. Reports go to `POST /<id>/api/chat/report` (this
site's pages only); the owner's tools are `/_studio/api/chat`, `/_studio/api/chat/rules`, `/_studio/api/chat/remove`,
`/_studio/api/chat/report` (dismiss) and `/_studio/api/chat/budget`, and `mute`/`kick` take a chat line.

## A game's landing: `/<id>/`

Made from the game's own files, nothing invented:

- **The hero**, full-bleed: the game's footage when it has some, else its cover (or key art) moving slowly, tinted
  with the studio's colour so the words read. **In the game's own palette (0.26.0):** a game with a style.json (its
  art direction) and no `landing.scheme` or `landing.theme` of its own gets its whole landing in that palette, its
  paper as the page, its ink as the words, its accents, light or dark as its paper is, when the ink reads on the paper
  (4.5:1); its footage then keeps its colour (a third of the tint) and the words sit on a soft panel of its paper. A
  bright game is no longer shown on the studio's dark page. `landing.scheme`, `landing.theme`, a `site/pages/<id>/`
  page and `site/theme.css` are the owner's and always win; a palette whose ink does not read keeps its accents only,
  on the studio's scheme, as before. A game whose picture is white or cream (a light arena) takes
  `"scheme": "light"` in its `landing` block: its landing is drawn light, the hero tinted and shaded with a light
  background and the words dark, where a dark studio's tint would turn it grey (`"dark"` is the other way round,
  for a dark game in a light studio). `landing.theme` colours still win, and the rest of the site keeps its look. Footage is looked for in this order: `landing.hero` in game.json;
  `games/<id>/hero/` by the house brands' names (`wide.mp4` and `tall.mp4`, their AV1 cuts `wide.av1.mp4` and
  `tall.av1.mp4`, stills `wide.jpg` and `tall.jpg`); a trailer in `videos/manifest.json` whose `for.game` is the
  game (its 16:9 `video`, 9:16 `vertical` and `poster`). A loop of 8 to 15 s under 3 MB each, muted, plays best.

  **The files, exactly** (all in `games/<id>/hero/`, every one optional; `homie-studio build` names the first two
  when a landing has neither picture nor footage):

  | File | Shape | What it is |
  | --- | --- | --- |
  | `wide.jpg` | 16:9, 1280×720 or larger | The still a computer, a TV and every card show (also `.webp`, `.png`, `.avif`) |
  | `tall.jpg` | 9:16, 720×1280 | The still an upright phone shows; without it the wide one is cropped |
  | `wide.mp4` | 16:9, 1280×720 to 1600×900 | Footage over the still: silent, 8 to 15 s, under 3 MB (also `.webm`) |
  | `tall.mp4` | 9:16, 720×1280 | The same for an upright phone |
  | `wide.av1.mp4`, `tall.av1.mp4` | as above | AV1 cuts, offered first to a browser that plays them |

  The shapes are what fills the screen without waste, not a rule: any size is shown, cropped to fill
  (`landing.hero.focus` says which part to keep). One file is 25 MiB at most. In the built site they are served
  at `/games/<id>/_landing/<file>` (a static game's, which copies its whole folder, at `/games/<id>/hero/<file>`);
  `/api/games` says each exactly, as `games[].landing.hero` (`wide`, `tall`, `wideImage`, `tallImage`).
- **The pitch** (`landing.pitch`, else the blurb), a big **Play** button that drops into a public room at once,
  and the live line ("3 players playing right now", refreshed every 15 s from `/<id>/live`).
- **Phone, computer, TV**: the controls for each (`landing.controls`, else `credits.json` `controls`), a code a
  phone scans to play, and how to put the game on a TV (`/<id>/tv` shows the room with its own join code).
- **Live rooms**, each with Join. When studio.json shares its stats (`stats.share`), also "played this week".
- **How to play**: `landing.about`, `landing.howToPlay` (a few lines), the controls, the room facts.
- **Credits**: the studio and `landing.credits` (`[{ "role", "name", "url" }]`); for a game that was made from another
  studio's, "Based on <game> by <studio>" linked to the original's page (game.json `remixOf`; it is also
  under the game's name in the hero); for a port, the original, its author and licence and every part inside it
  (`credits.json`, as the port skill writes it), with the full licence texts on `/<id>/credits`; Homie's open
  engine; and the licence the game names for itself, when it names one.

A game's licence is game.json `"license"`: an SPDX identifier (`"MIT"`, `"CC-BY-4.0"`), as the word or as
`{ "spdx": "MIT" }`. It is a statement about the game, said in its credits, its structured data and `/llms.txt`; a
game that names none says nothing. It offers nobody the game's source: no game is handed over whole. Games build on
each other through parts, the pieces a studio chooses to share (`parts/PARTS.md`; a game with shared parts gets a
"Parts from this game" band, and the studio a `/parts/` page). Remix was retired: the settings it had (`"remix"`,
`"share"`, `landing.make`, the licence words `"remix-with-credit"`, `"remix-freely"` and `"no-remix"`) are ignored
with one build note, and `/games/<id>/source.json` answers 410.

game.json's `landing` block, every key optional:

```json
"landing": {
  "pitch": "Blast rocks, not friends.",
  "kicker": "A line above the title",
  "headline": "The How to play heading",
  "about": "A paragraph about the game.",
  "howToPlay": ["Steer with the stick", "Fire at the edge"],
  "controls": { "phone": "Stick left, FIRE right", "computer": "Arrows and Space", "tv": "Phones are the pads" },
  "players": { "one": "pilot", "many": "pilots" },
  "hero": { "video": "hero/wide.mp4", "tall": "hero/tall.mp4", "image": "hero/wide.jpg", "tallImage": "hero/tall.jpg",
            "alt": "What the footage shows", "focus": "50% 40%", "tint": 30 },
  "credits": [{ "role": "Music", "name": "Low Tide", "url": "https://example.com" }],
  "theme": { "accent": "#ff3bd4", "glow": "#00eaff" },
  "scheme": "light",
  "screenshots": ["shots/rocks.jpg", "shots/finish.jpg"],
  "tv": true
}
```

**Screenshots** (0.27.0): `landing.screenshots` (pictures in the game's folder), else every picture in
`games/<id>/screenshots/` by name, at most eight. The landing shows them in a band of their own, and its VideoGame
names them. Beside the `landing` block, game.json takes `"genre"` (a word, or up to three: `["Racing", "Party"]`,
shown with the room facts), `"released"` (the day it came out, else the commit that added its game.json) and
`"schema"` (structured data of the owner's own: [Search engines and AI agents](#search-engines-and-ai-agents)).

## Posts: `posts/*.md`

One markdown file each. The name is the address, `posts/2026-09-30-we-are-live.md` is `/posts/we-are-live/`, dated
by its prefix unless the frontmatter says `date:` (a day, or a day and a time, UTC).

```markdown
---
title: We are live
date: 2026-09-30
summary: One line for the cards and the feeds.
image: /games/crown-thief/cover.jpg
game: crown-thief
song: theme
video: trailer
author: The studio
draft: false
---

The body.
```

`game:`, `song:` and `video:` link one of the studio's own (a link to one the site does not have is left out,
and the build says so); the post shows each as a card with Play, Listen or Watch. `draft: true` keeps it off the
site. README.md and names starting with `_` or `.` are not posts.

The markdown is a safe subset, rendered once at build time: headings (`#` is the page's second level), paragraphs,
**bold**, *italic*, ~~struck~~, `code`, fenced code, links, images, lists, quotes and rules. Raw HTML is shown as
text, and a link or an image goes only to `https://…` or a path on the site.

Each post is also a record (`/posts/feed.json`, `_homie.record`): `{ "$type": "rocks.homie.studio.post", title,
text (the markdown), createdAt, summary, links: [{ kind, id }] }`, the shape it keeps when studios publish posts to
atproto later. `/.well-known/homie-studio.json` lists the latest posts for the homie.rocks directory.

## What `site/` overrides

| Put it in | What it does |
| --- | --- |
| `site/theme.json` | The tokens every page uses: `bg`, `fg`, `accent`, `glow`, `panel`, `accentInk` (colours: `#hex`, `rgb()`, `hsl()`, `oklch()`), `display`, `text`, `mono` (font lists), `fonts` (`[{ "family", "src": "/fonts/x.woff2", "weight": "400 800" }]`, files in `site/public`), `radius` (0 to 40), `mark` (a logo), `icon`, `social` (the share picture), `wordmark`, `uppercase: false`, `scheme: "light"`. Or `palette`: neon, dock, gold, acid, ember, orchid, tide, candy. A value that is not what it should be is dropped, with a warning. |
| `site/theme.css` | CSS after the site's own, on every generated page: restyle anything. |
| `site/partials/<name>.html` | A piece of every generated page: `head` (in `<head>`), `header` (the top line and its tabs), `footer` (the "Made with Homie" footer), `home` (a band on Home), `game` (a band on every landing), `game-<id>` (a band on one), `post` (after a post). `{{studio.name}}`, `{{game.name}}`, `{{game.id}}`, `{{game.play}}`, `{{year}}` are filled in. A band partial sits in one of the page's bands, unless it is its own `<section class="band">`. |
| `site/pages/<path>/index.html` (or `site/pages/<path>.html`) | A whole page at `/<path>/`, served as it is, instead of the generated one (`site/pages/index.html` is Home, `site/pages/<id>/index.html` a game's landing) or beside them (`/about/`). It may borrow the site's parts: `<!-- homie:style -->`, `<!-- homie:header -->`, `<!-- homie:footer -->`, `<!-- homie:script -->`, in its `<head>` `<!-- homie:schema -->` (the structured data the generated page there would carry: Home's, a landing's, else the studio's Organization), and `<!-- homie:home-hero -->` (Home's generated hero for the featured game: its footage or art, title, pitch, Play and the live line) or `<!-- homie:home-hero <id> -->` (the same for the game it names), so a Home of the studio's own never writes a hero by hand. The rooms, the game files, the API and the owner's pages are never a page's. |
| `site/public/` | Files served as they are at the same path: fonts, a logo, hero footage, a page's pictures. A `robots.txt`, `sitemap.xml`, `llms.txt` or `llms-full.txt` here replaces the one the site makes. |
| `site/src/worker.mjs` | The Worker. A studio that keeps a whole brand site of its own (with its own routes) wraps the template's Worker here, as the house brands do; everything it does not answer goes to the template. |

A studio with its own landing in `site/` keeps it: the template never replaces what the studio made.

**A Home of your own, with the generated hero.** `site/pages/index.html` replaces Home. To keep the hero the site
makes and change only what is under it (or only which game it shows), borrow it:

```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Night Owls</title><!-- homie:style --><!-- homie:schema --></head>
<body><!-- homie:header -->
<main><!-- homie:home-hero crown-thief -->
<section class="band"><div class="band-in"><h2>Whatever this studio wants here</h2></div></section></main>
<!-- homie:footer --><!-- homie:script --></body></html>
```

The marker needs `<!-- homie:style -->` (the hero's CSS) and `<!-- homie:script -->` (its live line refreshes).
A game that is private, invite-only or not this studio's leaves nothing there. A page that does want a game's
hero files by address reads them from `/api/games` (`games[].landing.hero`); for a bundled game they are
`/games/<id>/_landing/wide.jpg`, `tall.jpg`, `wide.mp4` and `tall.mp4`, as the table under
[A game's landing](#a-games-landing-id) says. On the generated Home, `"site": { "featured": "<id>" }` already
picks the hero's game.

## The build

`homie-studio build` (`npm run build`) makes `site/dist`, and `homie-studio build <id>` rebuilds one game in it.

- **All or nothing.** The site is built in a folder of its own (`.studio/build/`, git-ignored) and put in place
  only when all of it is there. A game that does not build fails the command (exit 1) and leaves `site/dist`
  exactly as it was: never a site without that game for the next deploy to ship. When it is put in place,
  `site/dist` and its folders are not removed and made again: a file that did not change is not touched, a file
  that did is renamed into place in one step, and what the new build no longer has is taken away last. A server
  or a script running from `site/dist` keeps its files across a build.
- **A bundle named by its content.** A game's code is `games/<id>/assets/main-<HASH>.js`, and the built
  `index.html` names it (write `./assets/main.js` in the game's own `index.html`, as always: the build points it at
  the hashed file). A browser or an edge that kept the last build's bundle is never asked for the new one under the
  old name. `assets/main.js` is still there, one line that imports the hashed bundle, for anything that knew the
  old address; `bundle.json` beside the page says the real file and its chunks.
- **Code that loads later.** The bundle is ES modules with code splitting: `const scene = await import('./level-2')`
  in a game becomes `assets/chunk-<HASH>.js`, fetched when the game asks for it, from beside the bundle, wherever
  the game is served (the site, its frame at `/<id>/__game/`, `dev`, `preview`, the Game Lab). A 3D game can draw
  its first screen before the rest of its code and three.js add-ons arrive. A game with no `import()` is one file.
- **What changed.** Each game's line says `new`, `changed` or `unchanged` against the build before, its **build
  hash** (sixteen characters over every file of the game, the same digest `homie-studio perf` names a build by).
  `site/dist/_site/build.json` keeps it for whatever runs next (`{ "v":
  1, "at", "commit", "games": { "<id>": { "hash", "bundle", "chunks", "changed" } } }`), and
  the live site says each game's `build.hash` in `/.well-known/homie-studio.json`: "is the live game the one I
  built?" is that against this, with no file to fetch and no edge cache to wait out.
- **`build --types`** checks the games' TypeScript first (the build itself only strips types, so a type error
  ships otherwise). It uses the studio's own `typescript` (a new studio's `package.json` asks for it;
  `npm install --save-dev typescript` in an older one; the toolkit does not depend on it), reads a game's own
  `tsconfig.json` when it has one, else checks its entry and what that imports the way the build reads them
  (ES2022, a browser, strict). A type error in a game's own files stops the build before anything is built;
  errors in a package the game imports as source are counted and said, never fatal.
- **`homie-studio preview <id> [--port 8788]`** serves one built game's files and nothing else (no Wrangler, no
  rooms, no database), on this computer only, for a capture, a screenshot or a perf script. It is the page as the
  build made it, with no room to join: the game plays offline with its bots. It prints its address first (one
  line of JSON with `--json`), reads each file when asked, so the next build is what the next reload gets, and
  stops with Ctrl-C.
- **A 3D game's model budgets.** `createModels()` (`@homie-rocks/studio/assets`) warns in development about any
  model over 1,500 triangles or 300 KB: a small prop's budget. A game whose models are bigger on purpose says so
  once, in game.json: `"assets": { "budgets": { "triangles": 8000, "bytes": 1500000 } }` (per model; `texturePx`
  and `materials` are taken too, and `createModels({ budget })` or a single `load(url, { budget })` still wins).
  The build writes it into the bundle. A game copied from a 3D starter has `"assets": "library"` there, a note that
  only mattered when it was copied: replace it with the object.

## The play page

**The arrival (0.26.0).** The play page and the big screen never open blank. From the first paint, an arrival
card covers the game's frame in the game's own look (worker/arrival.mjs): its title, its pitch (`landing.pitch`, else
the blurb's first sentence), its key art (the landing's hero still, a trailer's poster or its cover, drifting slowly;
`landing.hero.tallImage` on an upright phone when there is one), a progress line that says what is happening
("Finding a room…", "Room 4 · 3 playing · 2 AI", "Loading the game…", "Joining Room 4…", and the game's own
"Loading the heroes… 60%"), and the controls for this device (`landing.controls.phone`, `.computer`, `.tv`). Its
colours are the game's palette (style.json), else the landing's (`landing.theme`, `landing.scheme`), else the
studio's. It lifts when the game says it is playable (NETPLAY.md section 21): by itself once seated with the room's
state, or at the game's own `net.playable()`; a game built before 0.26.0 lifts it once it has a seat, and nothing
keeps a game behind it longer than 15 s after the game started (30 s after the page opened). `?arrive=0` leaves it
out. `homie-studio perf` reads its first frame as the time to the first meaningful frame (`load.look`).

`/<id>/play` puts the visitor in a public room at once and writes the room into the address, so a reload comes
back to it and a copied address brings a friend into it. A small room button at the edge (top right by default)
opens: **Invite** (the phone's share sheet, or the link copied), **Big screen** (`/<id>/tv` of this room, on
another screen) and the room's code. It must never cover the game's own HUD, so game.json's `screen.share` puts it
where the game has room, per device:

```json
"screen": {
  "share": {
    "desk": "bottom-left",
    "phone": { "at": "top-left", "y": 56 },
    "sideways": { "at": "top-center", "label": false }
  }
}
```

- A place is `top-left`, `top-center`, `top-right`, `bottom-left` or `bottom-right`; a plain string (`"share":
  "top-center"`) or an object with `at` is every device, and `desk` (a computer), `phone` (held upright) and
  `sideways` (a phone turned sideways; else as `phone`) each take their own.
- `x` and `y` move it in from its side and its edge, in CSS pixels (0 to 600): `"y": 56` puts it under a game's
  own top line. At `top-center`, `x` moves it right (or left, negative).
- It shows the room's name ("Room 7") for a few seconds, then shrinks to a round icon until it is touched;
  `"label": false` keeps it the icon always (the code is in its sheet), for a corner with little room.
- A button at the bottom left sends the "finding a room" chip to the bottom right.
- On a server, the server's pill sits beside the button, on its inner side in the same band, never under it: on a
  phone held upright it is one more dot; elsewhere its name shows for a few seconds, then it is a dot too.
- Room chat's Chat pill sits in the same band: a round icon on a phone (either way up) and beside a button kept an
  icon; on a computer it says "Chat" unless the word would take the band off the screen or into the middle third of
  its width, where games keep a clock or a title. Its strip of new lines (bottom left by default) moves with
  `"screen": { "chat": … }`, per device, or stays in the Chat sheet (`"lines": "sheet-only"`): chat/CHAT.md.

Look at the play page on a computer and a phone (both ways up) once a round is on: the button must not sit on a
score, a timer or a bar. A room code the relay cannot use (1 to 32 letters, digits, `-` or `_`) is refused
on the page, never swapped for a public room. A player who typed no name gets a two-word handle.

The game runs in a sandboxed frame with an opaque origin, which is why its allow list delegates with `*`
(`fullscreen *; autoplay *; gamepad *`): Safari refuses a bare `gamepad` there (`getGamepads()` throws a
SecurityError), so a controller would not work.

## The watch door: `/<id>/watch?room=<room>`

Anyone can watch a live room from any player's view (NETPLAY.md section 16). Every room row (Home, Rooms, a
game's landing) has a **Watch** button beside Join, and a landing offers "Watch a live room" while somebody plays.
The page is the game itself, drawn by the watcher's own browser as a watcher: a screen that never takes a seat.

- **The top bar:** LIVE, the game and the room, the round's clock, how many are watching, and **Play** (into
  this room). **The caption** says whose view this is ("Watching Velvet Comet", "Auto · following the action").
- **The strip** at the bottom: **Auto**, each player (their colour, name and live score when the game exposes
  `scores`; the leader's score lit), and **Whole room**. A tap switches; on a computer keys 1-9 pick the n-th
  player, A is Auto, O (or 0) the whole room, the arrows the next or previous player, F full screen. The address
  keeps the view (`&follow=<seat>|auto|overview`), so a copied link watches the same player.
- It fits a phone (the strip scrolls sideways), a computer, and a TV-sized screen (bigger type; `?hand=tv`). The
  bars fade after five seconds without a touch, a move or a key, and come back with one.
- With no `room`, it watches the busiest public room (`/<id>/api/watch`, which reserves nothing); with nobody
  playing it says so, offers Play, and finds a room the moment one starts. A room everyone left, a kick, a closed
  room and a full one are each said plainly, with the way on.
- **What a game decides.** A game that draws `net.viewSeat` lets the watcher switch; one that does not is watched
  as its overview, and the strip only names the players. game.json `"watch": "overview"` keeps watchers on the
  whole room (hidden hands or roles); `"watch": false` removes the door (the page says the game is played, not
  watched, and the socket is refused).
- **The same door as Play:** a private or invite-only game is watched only by those it lets in, with their
  ticket; a kick holds the browser out of watching that room too. A browser that holds a seat in a room watches
  that room as the whole room only, so a second tab is not a peek.
- Each opening counts as a `watch` in the studio's stats.

## Servers: `/<id>/servers/` and `/<id>/s/<server>/`

A game's **servers** are named, lasting pools of rooms with their own rules (`worker/servers.mjs`; NETPLAY.md
section 17 for the room's side). Strangers are matched only inside one server. The game's own public rooms are
its **Quick play** server (`public`), so every old link keeps working.

- **The landing's Servers band** shows when the game has a server besides Quick play: a card per server (its
  name, its policy's badge and one line, who is on it now: "9 playing · 4 AI · 41 members", Play and About),
  and "Quick play →" under it. `/<id>/servers/` lists them all (and every policy's line). A server that is
  closed, not listed, or has a door (an account or an invite) is left out of the Rooms lists and `/api/rooms`.
- **The badge and its line**, everywhere a server is shown: *Open* ("anyone can play. AI players are always
  marked AI."), *Humans only* ("every player here is a person. AI can't join."), *Hybrid · N* ("N seats in every
  room are AI companions, always marked AI. Your party sets their level."), *Beginner* ("for new players. AI guides
  help you learn. Chat is quick lines only."); a kids server adds "Players have handles, not names."
- **A server's page** (`/<id>/s/<server>/`): its name, blurb, badge and line; its live rooms (AI marked); how many
  belong to it; "☆ Make this my home" for a signed-in player (and Leave); and a big **Play**
  (`/<id>/s/<server>/play`). A player's home server is where a bare `/<id>/play` takes them; their account page
  lists their servers.
- **The door**, then the play page: *open* lets anyone in; *accounts* asks the visitor to sign in with a passkey
  ("Sign in to play on Night Shift"); *invite* shows the invite-code box (`homie-studio office invite <id> --server
  <server>` makes codes and links for one server); *beginner* lets in guests and accounts younger than its days
  (a veteran is told "First Light is for new players… try another server or Quick play"; a mentor gets in, with a
  Mentor badge). A server whose rooms are all full (its `rooms`) sends the visitor to its fullest room, where they
  wait for a seat ("First Light is full. You're next for a seat."). The owner always comes in. The watch door is
  the same door, except that watching a beginner room needs no new account.
- **When the owner hides Quick play** (`homie-studio servers close <id> public`), Play shows the servers to pick
  from, and a named `?room=` is off (except for the owner).
- **The play shell** on a server: a pill beside the room button, in the same band at the room button's place
  (`screen.share`), never under it ("First Light · Beginner", then a dot after a few seconds; on a phone held
  upright, the dot from the start; tap: the server's name, the policy's line, "AI level: Steady" with **Change**
  when the game's bots read the dial, and **Quiet AI**, which hides AI chat on this screen only). A server room's
  button says "Room 2", as Quick play's does. The chip says "First Light · 4 playing · 2 AI"; every AI row and result
  carries an AI pill. A game's HUD keeps that band clear (Gem Rush starts its scores under it).
- **The vote card** ("How strong should the AI be?", five levels, "the middle vote wins") opens by itself at a
  party's first round with AI seats, from the pill's Change, or from the game; a lone player's tap decides at once,
  every seated person's vote closes it early, else 15 s. Keys 1-5 on a computer; a bottom sheet on a phone. The card
  is opaque: nothing of the game shows through it. The
  result is a toast ("The party set the AI to Steady (3 votes)."). A game that draws its own card says game.json
  `"agents": { "vote": "game" }` (`false`: none).
- `/<id>/api/servers` is the servers with their live counts (cacheable 15 s). `/api/rooms` rows say their
  `server`, `policy` and `ai`.

**AI guides that talk** (0.17.0, `netplay/NETPLAY.md` section 18): a guide's line is the game's own text
(its `agents.json`), drawn by the game (Ember Vale: a bubble over the guide); **Quiet AI** hides it on that
screen. Asking a guide is buttons the game draws, never a text box. The page itself adds nothing for guides.
The office shows each server's brain, today's Workers AI neurons or dollars against the day's budget, and each
room's last guide decisions (seats and ids only).

**An AI's seat** (an agent pass from `homie-studio agents pass`): `POST /<id>/api/agent` with `Authorization:
Bearer <pass>` and `{ "server": "<id>" }` answers a room with people in it (never an empty one), a ticket, its
socket and (an AI that runs the game itself) the frame to load. A humans-only server answers 403 "This server is
for humans only", and so does its socket.

## Player accounts: `/account/`

A studio whose games keep saves (game.json `"saves": true`, [../saves/SAVES.md](../saves/SAVES.md)) has a player
account page at `/account/`, in the studio's look: make an account with a passkey, sign in on another device,
choose a name, add or remove passkeys, a recovery email (only with a mail sender), download everything, delete
everything. The play page of such a game carries the saves bridge and a "who is playing" row in its room sheet,
and shows a passkey sheet over the game when the game asks (`saves.signIn()`); its landing links the account page.
`/account/` belongs to the site: `site/pages/account/` and `site/public/account/` are refused.

## The shop: `/shop/` (0.24.0)

A studio with a `shop.json` ([../shop/SHOP.md](../shop/SHOP.md)) has `/shop/` (its items in real money, sign in, the
one neutral age question, Buy on Stripe's own page, or a link for a parent), `/shop/thanks`, `/shop/refunds/` (the
refund policy every seller publishes) and `/shop/parent/<link>` (what a parent opens). The account page lists the
player's purchases and badges, with the self-serve refund of an unused item. A play page whose game the studio
sells something for carries the store sheet (the game's `shop.open()`, and Shop in the room sheet); the protective shop policy hides it on kids servers and sends big-screen shoppers to a phone. The studio can edit these policies in shop.json. With a `shop.json`, `/shop/` belongs to the
shop (a `site/pages/shop/` is not served); without one it is the studio's own. The directory manifest says only
whether the shop is open and its till.

## The arcade knock

A game made with Homie's arcade controls asks its page's origin for a Homie box (`GET /__homie/call`), and a score
goes there as a POST. The site answers at its root and under every game with `{ "ok": false, "error":
"not-a-homie" }` (JSON, CORS-open, 200, a preflight answered), so the game stops asking and plays on its own; no
studio needs a Worker of its own for it.

## Search engines and AI agents

From 0.27.0 the site tells search engines and AI agents what it is, from its own files, and nothing more
(worker/schema.mjs, worker/discover.mjs).

**Structured data.** Every generated page carries one `<script type="application/ld+json">` in its `<head>`, a
schema.org `@graph`:

| Page | Types |
| --- | --- |
| Home | `Organization` (the studio: name, address, `site/theme.json` `mark` as its logo, `social` as its image, the tagline) and `WebSite` |
| `/games/`, `/rooms/` | `BreadcrumbList`, `ItemList` of the public games' landings (the Rooms page's data never carries a live count) |
| `/<id>/` | `BreadcrumbList`, `VideoGame` co-typed `WebApplication`: name, description, the pitch as `abstract`, its pictures and screenshots, `genre`, `numberOfPlayers` (min and max), `playMode`, `gamePlatform`, the studio as author and publisher, `license` (the licence the game names, linked to its SPDX page; left out when it names none), `isBasedOn` (a port's original), `trailer` (a `VideoObject`), `datePublished` and `dateModified`, a `PlayAction`, and one free-to-play `Offer` (price 0) |
| `/<id>/credits`, `/<id>/servers/`, a server's page | `BreadcrumbList` |
| `/music/`, `/music/<slug>/` | `MusicAlbum` (every song names one album) or an `ItemList`; `MusicRecording` (`byArtist` the studio, its duration, its `AudioObject`, its cover, `inAlbum`, `musicalKey`, its date) |
| `/videos/`, `/videos/<slug>/` | `ItemList`; `VideoObject` (`thumbnailUrl`, `uploadDate`, `duration`, `contentUrl`: the file at its own address, from R2 or the site) |
| `/posts/`, `/posts/<slug>/` | `Blog`; `BlogPosting` (headline, dates, the author it names or the studio, the publisher, its picture, the game it is about) |

Never: a rating or a review (the page shows none), a price for anything the shop does not sell, or a number that is
only true this minute. While the studio's shop really sells (shop/SHOP.md: shop.json checked, its key, webhook
secret and tables in place), each item sold in a game is an `addOn` of that game's free offer, in real money; a tip
has no price and is left out. A game that is not public yet (private, or an invite-only beta) offers nothing, and its
landing answers `x-robots-tag: noindex`.

A video's `uploadDate` is its manifest entry's `"date"`, else `made.at`; a video with neither is said by the build,
because search engines show no video without it. A song's date is the same, and a music manifest's `"album"` (or an
entry's own) makes the songs a `MusicAlbum`. A game's `datePublished` is game.json `"released"`, else the commit that
added its game.json; `dateModified` is the last commit that touched its folder (nothing from a shallow clone).

**The owner's own.** game.json `"schema"` adds schema.org properties to the game's `VideoGame`, and studio.json
`"site": { "schema": { … } }` to the studio's `Organization` (its `sameAs`, say):

```json
"site": { "schema": { "sameAs": ["https://github.com/night-owls", "https://www.youtube.com/@nightowls"], "foundingDate": "2026" } }
```

Homie's own properties always win; `aggregateRating`, `review` and `offers` are refused, and the build says so, with
any property schema.org does not put on that type. A whole block of the owner's own still goes in
`site/partials/head.html`.

**Files for crawlers and agents**, made from the public catalogue: a private or invite-only game is in none of them.

- `/robots.txt`: every public page may be crawled; `/_studio/`, `/api/`, `/account/`, the shop's private steps
  and each game's play, TV, watch, live, invite, API and socket doors may not; then the sitemap's address. A
  Preview answers `Disallow: /`.
- `/sitemap.xml`: Home, Games and each landing (and its credits), Rooms, Music, Videos, Posts and every page in
  `site/pages`, with `lastmod` only where a real date says when it changed.
- `/llms.txt`, following the llms.txt convention (an H1, a `>` summary, then `##` sections of links): what the
  studio is; each game with its pitch, players, rounds, Play, Watch and the big screen, the licence it names and
  the game it was based on (when it has either); songs; videos; posts with their Atom and
  JSON feeds; the studio's own pages (a changelog among them); and homie.rocks's own llms.txt.
- `/llms-full.txt`: the same, with each game's whole description, how to play, controls and credits, and every
  post's text.

They are cached for five minutes. A file of the studio's own in `site/public` wins.

## Headers

Every HTML answer is `no-transform` (a custom domain's edge injects nothing: Web Analytics' automatic beacon
posts to a `/cdn-cgi/rum` a Worker does not serve). Generated pages are never framed (`x-frame-options: DENY`,
`frame-ancestors 'none'`), load scripts only from the site, and send `referrer-policy:
strict-origin-when-cross-origin` (another studio's stats see which site sent a visitor, never the path). The
play page and the game may be framed by the site itself and by the https origins studio.json lists in
`"site": { "frameAncestors": ["https://…"] }`.
