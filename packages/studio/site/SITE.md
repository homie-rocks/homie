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

A section with nothing in it has no tab, and its address answers 404. Every page ends with a
"Made with Homie" link to https://homie.rocks/studio/. studio.json may add `"tagline"` (one line, on Home and in
the feeds) and `"site": { "featured": "<game id>" }` (the game on Home; otherwise the first with its own footage).

Every card (Home, Games, Rooms, a post's), every live room's row and the directory's manifest show a game's
**landing still**: `hero/wide.jpg` (or `landing.hero.image`), else a trailer's poster, else game.json's `cover`.

## What the homie.rocks hub reads

`/.well-known/homie-studio.json` is the studio's manifest: its games (each with its landing still as `cover`),
songs (each with a `cover`), videos (each with a `poster`), the latest posts, and `rooms`, the address of
`/api/rooms`, so the hub's Rooms page lists this studio's public rooms. With studio.json `"stats": { "share": true }`
(`homie-studio stats share on`) it also says "played this week": `played` for the whole studio and each game's own
(`games[].played`, `{ "days": 7, "plays", "rounds" }`). To keep the studio's rooms off the hub, studio.json takes
`"rooms": { "share": false }`: the manifest then names no `rooms` (the studio's own pages still list them).

## A game's landing: `/<id>/`

Made from the game's own files, nothing invented:

- **The hero**, full-bleed: the game's footage when it has some, else its cover (or key art) moving slowly, tinted
  with the studio's colour so the words read. A game whose picture is white or cream (a light arena) takes
  `"scheme": "light"` in its `landing` block: its landing is drawn light, the hero tinted and shaded with a light
  background and the words dark, where a dark studio's tint would turn it grey (`"dark"` is the other way round,
  for a dark game in a light studio). `landing.theme` colours still win, and the rest of the site keeps its look. Footage is looked for in this order: `landing.hero` in game.json;
  `games/<id>/hero/` by the house brands' names (`wide.mp4` and `tall.mp4`, their AV1 cuts `wide.av1.mp4` and
  `tall.av1.mp4`, stills `wide.jpg` and `tall.jpg`); a trailer in `videos/manifest.json` whose `for.game` is the
  game (its 16:9 `video`, 9:16 `vertical` and `poster`). A loop of 8 to 15 s under 3 MB each, muted, plays best.
- **The pitch** (`landing.pitch`, else the blurb), a big **Play** button that drops into a public room at once,
  and the live line ("3 players playing right now", refreshed every 15 s from `/<id>/live`).
- **Phone, computer, TV**: the controls for each (`landing.controls`, else `credits.json` `controls`), a code a
  phone scans to play, and how to put the game on a TV (`/<id>/tv` shows the room with its own join code).
- **Live rooms**, each with Join. When studio.json shares its stats (`stats.share`), also "played this week".
- **How to play**: `landing.about`, `landing.howToPlay` (a few lines), the controls, the room facts.
- **Credits**: the studio and `landing.credits` (`[{ "role", "name", "url" }]`); for a remix, "Remix of
  <game> by <studio>" linked to the original's page (game.json `remixOf`, which `game remix` writes; it is also
  under the game's name in the hero); for a port, the original, its author and licence and every part inside it
  (`credits.json`, as the port skill writes it), with the full licence texts on `/<id>/credits`; Homie's open
  engine; and the source's licence.
- **Make a game like this**: the two commands that install the Homie plugin and the words to say. When the game
  shares its source (the default; `"share": { "source": false }` keeps it closed, and the owner's Remixable
  switch withdraws it) and its licence allows remixing, the words remix it from `/games/<id>/source.json`, and
  the button goes to `https://homie.rocks/studio/?remix=<that address>`.

A game's licence is game.json `"license"`, the owner's pick: `"remix-with-credit"` (the default: a remix says
"Remix of <game> by <studio>" with a link back), `"remix-freely"` (the credit is welcome, not asked for) or
`"no-remix"` (the source can be read; `game remix` refuses it), and `{ "kind": "<one of those>", "spdx": "MIT" }`
names a licence too. The source.json carries it, with `credit`: the studio's name, the game's name and its page.

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
  "tv": true
}
```

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
| `site/pages/<path>/index.html` (or `site/pages/<path>.html`) | A whole page at `/<path>/`, served as it is, instead of the generated one (`site/pages/index.html` is Home, `site/pages/<id>/index.html` a game's landing) or beside them (`/about/`). It may borrow the site's parts: `<!-- homie:style -->`, `<!-- homie:header -->`, `<!-- homie:footer -->`, `<!-- homie:script -->`. The rooms, the game files, the API and the owner's pages are never a page's. |
| `site/public/` | Files served as they are at the same path: fonts, a logo, hero footage, a page's pictures. |
| `site/src/worker.mjs` | The Worker. A studio that keeps a whole brand site of its own (with its own routes) wraps the template's Worker here, as the house brands do; everything it does not answer goes to the template. |

A studio with its own landing in `site/` keeps it: the template never replaces what the studio made.

## The play page

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

Look at the play page on a computer and a phone (both ways up) once a round is on: the button must not sit on a
score, a timer or a bar. A room code the relay cannot use (1 to 32 letters, digits, `-` or `_`) is refused
on the page, never swapped for a public room. A player who typed no name gets a two-word handle.

The game runs in a sandboxed frame with an opaque origin, which is why its allow list delegates with `*`
(`fullscreen *; autoplay *; gamepad *`): Safari refuses a bare `gamepad` there (`getGamepads()` throws a
SecurityError), so a controller would not work.

## Player accounts: `/account/`

A studio whose games keep saves (game.json `"saves": true`, [../saves/SAVES.md](../saves/SAVES.md)) has a player
account page at `/account/`, in the studio's look: make an account with a passkey, sign in on another device,
choose a name, add or remove passkeys, a recovery email (only with a mail sender), download everything, delete
everything. The play page of such a game carries the saves bridge and a "who is playing" row in its room sheet,
and shows a passkey sheet over the game when the game asks (`saves.signIn()`); its landing links the account page.
`/account/` belongs to the site: `site/pages/account/` and `site/public/account/` are refused.

## The arcade knock

A game made with Homie's arcade controls asks its page's origin for a Homie box (`GET /__homie/call`), and a score
goes there as a POST. The site answers at its root and under every game with `{ "ok": false, "error":
"not-a-homie" }` (JSON, CORS-open, 200, a preflight answered), so the game stops asking and plays on its own; no
studio needs a Worker of its own for it.

## Headers

Every HTML answer is `no-transform` (a custom domain's edge injects nothing: Web Analytics' automatic beacon
posts to a `/cdn-cgi/rum` a Worker does not serve). Generated pages are never framed (`x-frame-options: DENY`,
`frame-ancestors 'none'`), load scripts only from the site, and send `referrer-policy:
strict-origin-when-cross-origin` (another studio's stats see which site sent a visitor, never the path). The
play page and the game may be framed by the site itself and by the https origins studio.json lists in
`"site": { "frameAncestors": ["https://…"] }`.
