---
name: publish
description: Put a Homie studio's site and games online on the studio's OWN Cloudflare account (Worker, D1 and public-room Durable Objects, all on the free plan with no payment method; R2 storage only when added), run its site (the hub's sections in the studio's own look, a landing for every game, news posts with feeds, and what the studio's site/ folder overrides), list them in the homie.rocks directory, and read the studio's own stats (visits, plays, rooms, rounds, players, songs, videos, where people came from); ask an owner for a grant when a game uses a protected name. Use when someone asks to deploy, publish, go live, share a studio's games, write a news post or announce a drop, change how the studio's site looks, list games in the Homie directory, or how their studio or a game is doing.
---

# Publish a studio

A studio's site runs on the studio's own Cloudflare account; homie.rocks only lists it.

## Cloudflare (checked only when you publish)

1. In the studio folder: `npx wrangler whoami`.
2. Not signed in: run `npx wrangler login`. Tell the person in one line that Cloudflare
   opened in their browser and they approve once (a free account works, no payment
   method). Wait, then
   `whoami` again. Never ask for, paste or store an API key.
3. Several accounts: ask the person which one, and put its id in `studio.json`
   (`cloudflare.accountId`).
4. The Cloudflare plugin for Claude Code / Codex (github.com/cloudflare/skills) is
   useful but optional; offer it only if the person wants Cloudflare help beyond this.

## Deploy

```sh
npm run deploy
npx --no-install homie-studio check <id> --url <the live site it printed>
```

Before the first deploy, tell the person what it creates and what it costs:
`npx --no-install homie-studio deploy --plan` prints it and changes nothing (one Worker,
one D1 database, two SQLite-backed Durable Objects; free on the Workers Free plan; no R2).

`deploy` builds every game, creates the Worker and D1 database named in `studio.json`,
applies migrations, deploys, and reads the live site once (the site then claims itself
in the homie.rocks directory; nothing is stored by hand). It never creates R2. It refuses
to use a Worker, database or bucket of the same name that this studio did not create;
then rename it in `studio.json` and `wrangler.jsonc` (an older studio's is
`site/wrangler.jsonc`). Never
delete, rename or redeploy anything the studio did not create. When it answers with a
`needs` step (a new account verifies its email address; an account with no workers.dev
address picks one), say that step to the person and wait.

Storage for large media (`npx --no-install homie-studio storage add`, an R2 bucket) is
separate and optional: Cloudflare asks for a payment method before R2 works, so only
when the person wants it, after saying so.

## Songs and videos

Published entries of `music/manifest.json` and `videos/manifest.json` become pages at
`/music/<slug>/` and `/videos/<slug>/` with every deploy (the `music` and `video` skills write
them and redeploy). The site serves each file itself, up to 25 MiB a file, with no storage;
only bigger media needs `storage add` (and `media put`), after the person agrees to R2's payment
method. `npx --no-install homie-studio media list` shows what the site will show and why anything
is left out. A studio with songs or videos and no games can still deploy.

## The site

Every deploy builds the studio's site from the studio (`node_modules/@homie-rocks/studio/site/SITE.md` has
all of it): Home, Games, Music, Videos, Rooms and Posts, each only when the studio has something in it (a
section with nothing has no tab and answers 404), and a landing for every game (the `game` skill's "Its
landing page" makes one epic). Every page ends with "Made with Homie"; restyle it, keep it.

- **A news post** ("give my studio a news post", "announce the new game"): write
  `posts/<YYYY-MM-DD>-<slug>.md` (`posts/README.md`): frontmatter `title:`, `summary:` (one line: the
  cards and the feeds), `image:` (a `/path` on the site, like a game's cover), and `game:`, `song:` or
  `video:` to link one of the studio's own; then the body in markdown. Say something real: what is new,
  why it is fun, how to play, what is next. Posts are at `/posts/`, on Home, in `/posts/feed.xml` (Atom)
  and `/posts/feed.json` (JSON Feed), and in the directory's copy of the studio.
- **The look**: `site/theme.json` (colours, fonts, corner radius, a logo in `site/public/`) and
  `site/theme.css` for anything more. `studio.json` `"tagline"` is the studio's line; `"site": { "featured":
  "<game id>" }` picks Home's game.
- **Anything of the studio's own wins**: a whole page in `site/pages/<path>/index.html` (an About page, or a
  hand-made landing at `site/pages/<id>/index.html`), a piece of every page in `site/partials/` (`footer`,
  `header`, `home`, `game`, `game-<id>`, `post`, `head`), files in `site/public/`. `site/README.md` in the
  studio lists them.
- **The play page** shares its room: the room is in the address, and a small button at the edge gives
  Invite, Big screen and the room code. Nothing to set up.
- Before and after a deploy, look: `npx --no-install homie-studio look --url <site>` (the local dev address,
  then the live one) shoots every page on a computer and a phone and names what is wrong.

## List in the directory

Call the Homie MCP tool `studio_publish` with the live site (or run
`npx --no-install homie-studio publish`). It answers with each listed game's Play link. A game
refused for a protected name stays on the studio's site but is not listed. The directory
is in beta: at most 12 games per studio are listed, names and blurbs are checked (plain
text, no links), and its owner can unlist a listing. Anyone can report a listing; only
the directory's owner acts on reports, never an AI.

## The site's address

`deploy` prints the live address. A `workers.dev` address names the person's Cloudflare
account (often after them), so `deploy` keeps it in `.studio/local.json`, which git ignores:
never copy it into a committed file (README, posts, manifests). When the studio has its own
domain, it goes in `studio.json` as `cloudflare.domain` (e.g. `"night-owls.example"`); deploy
never replaces it, and the directory claim, `publish`, `check` and `stats` use it.

## Stats (the owner's, and only the owner's)

Every studio counts, in its own Cloudflare (D1, free plan): pages opened, Play presses,
rooms opened, the most people playing at once and right now, rounds finished, songs played,
videos watched, and which site sent each visitor (homie.rocks, another studio, search, the
web, a `?via=` link). It counts and never tracks: no cookie on a visitor, no person
identified, nothing sent anywhere; prefetches, crawlers and house QA are not counted.

- "How is my studio doing?": run `npx --no-install homie-studio stats` (add `--range 30d`,
  or `--game <id>`, `--song <slug>`, `--video <slug>`) and say the numbers plainly.
- To read them through the Homie MCP (for example from an app without the studio folder
  open): `npx --no-install homie-studio stats key` gives a read key that ends in an hour;
  pass it to `studio_stats` { site, key, range }. The key only reads; never paste it
  anywhere else, and `stats revoke` ends every key.
- For the person's own browser: `npx --no-install homie-studio stats link` gives a one-time
  link (30 minutes) to the private page `/_studio/stats`. Give it to the person to open
  themselves; it keeps that browser signed in for 30 days. It is theirs: never post it.
- `npx --no-install homie-studio stats share on` (then `npm run deploy`) lets the directory
  show "played this week" (Play presses and rounds with people, over 7 days). Only when the
  person wants it; it is off by default.
- A studio made before 0.6.0 gets its counters on the next `npm run deploy` (D1 migration
  `0002_studio_stats.sql`); nothing before then was counted.

## Grants (protected names)

To publish under a protected name (one of the homie.rocks house games) call
`studio_request_grant` { site, game, reason }. It returns a link for the OWNER. Show it
to the person; the owner approves with one tap in their own browser after a one-time
sign-in link reaches the owner's address. You cannot approve it and must never try
(no tool can; the approval page needs the owner's own browser session). Check with
`studio_grant_status`, then `studio_publish` again once approved.

## Beta

Homie for studios is in beta. When something breaks, tell the person it can go to
https://github.com/homie-rocks/homie/issues/new/choose (bug, port request or question),
without keys, tokens or private addresses in it.
