---
name: studio-setup
description: Set up a Homie studio (one repository with games/, music/, videos/, posts/ and a site that runs on the studio's own Cloudflare, free plan, no payment method, with the same sections as homie.rocks in the studio's own look and an epic landing page for every game), make its first multiplayer game, put it online and list it in the homie.rocks directory. Use when someone asks to set up, create or start a studio or a game studio, or says "set up a game studio called X and make a multiplayer game".
---

# Set up a studio

A Homie studio is ONE folder the person can see and open: `AGENTS.md` (+ `CLAUDE.md`
importing it), `games/`, `music/`, `videos/`, `posts/`, and `site/`: a Cloudflare Worker
with a D1 database and the Table/Lobby Durable Objects that serve the studio's pages and
its public game rooms from the studio's **own** Cloudflare account, on Cloudflare's free
Workers plan. The code comes from `@homie-rocks/studio`, pinned in the studio's
`package.json`. The person never types a command: you run everything, and they approve
what matters (Cloudflare, once, in their browser).

Homie for studios is in **beta**. Do the whole job in one go, then report the live
links. Work in this order.

## 0. Say what will happen, before you do it

Your FIRST message, before any tool call, tells the person in a few lines what you are
about to do (then go on without waiting for an answer; their Cloudflare approval later
is the consent that matters):

- You will make the studio folder and a first multiplayer game, and prove it locally
  with two browsers.
- Then Cloudflare opens in their browser **once** to approve. A free Cloudflare account
  works and **no payment method is needed**. On their account you create: one Worker (the
  studio's site and rooms), one D1 database, and two SQLite-backed Durable Objects
  (Table, Lobby). Cost: **free** on the Workers Free plan (100,000 requests a day; past
  its daily limits requests fail until 00:00 UTC, nothing is charged). No R2 bucket:
  storage for large media is a later, optional step.
- The homie.rocks directory then lists the games. It stores only the site's address and
  a claim token, the studio's name, and each game's name, blurb and Play link: never
  code, media, keys or accounts.
- The studio's site counts its own visits, plays, rooms, rounds and songs in its own D1,
  for them only (`homie-studio stats`): counts, never people, and nothing sent anywhere.

`npx --no-install homie-studio deploy --plan` (once the studio exists) prints exactly
this for the studio, from `studio.json`, and changes nothing.

## 1. Make the studio

1. Call the Homie MCP tool `studio_scaffold` with the studio's name (and a folder if
   the person named one). It returns the exact pinned command.
2. Folder: the one the person named; otherwise a NEW folder named after the studio's
   slug inside the current directory (e.g. `./night-owls`). Never make a studio in a
   folder that already holds other files, never in the home folder, and never guess a
   folder outside the current directory.
3. Run the command it returned (it looks like
   `npx -y @homie-rocks/studio@<version> new "<folder>" --name "<Name>" --homie https://homie.rocks`).
   It lists every file it writes and installs the pinned `@homie-rocks/studio` and `wrangler`
   (about 20 s). Then `cd` into the studio.
4. From here on run the studio's own copy: `npm run <script>` or
   `npx --no-install homie-studio <command>` (`--no-install` never fetches a package by
   that bare name from the registry).

If the MCP tool is unavailable, tell the person the Homie connector is not connected
and stop; do not invent the package address.

## 2. Make the first game

Follow the `game` skill: `npx --no-install homie-studio game new <id> --from gem-rush --name "<Name>"`,
then turn the starter into the game the person asked for. If they gave no idea, make
a small, fun, readable twist of your own — a new name, a new objective or hazard, its
own colours — and keep it multiplayer. Keep every netplay rule (public rooms, bots,
rounds that end and restart).

Prove it before going online:

```sh
npm run dev                     # run in the background; the site at http://127.0.0.1:8787
npx --no-install homie-studio check <id> --url http://127.0.0.1:8787
```

`check` opens two fresh headless browsers (a computer and a phone), presses Play in
both, and passes only when they share a room and see a round finish (about 70 s for
a 60 s round). Fix what it reports. Start `npm run dev` as a background task your app
keeps alive (Claude Code: the Bash tool's `run_in_background`), and afterwards: stop it with `npx --no-install homie-studio dev --stop`, which stops exactly this studio's dev server (and its Wrangler) and nothing else. Never `pkill`, `killall` or `lsof … | xargs kill` by name or port: other projects on this machine may run their own `wrangler dev`, and a pattern stops theirs too.

## 2b. Give the studio its site

The site is made from the studio (`node_modules/@homie-rocks/studio/site/SITE.md`): Home (the featured
game, live rooms, the latest posts), Games, Music, Videos, Rooms and Posts, each only once the studio has
something in it, in the studio's own look, with "Made with Homie" at the foot of every page (keep it: it is
how other people find their way to making a studio). Before going online:

1. **Its look.** `site/theme.json` starts with a palette picked for the studio; make it the studio's own:
   colours that belong to its name and its first game (`bg`, `fg`, `accent`, `glow`; or `palette`: neon,
   dock, gold, acid, ember, orchid, tide, candy). Put a one-line `"tagline"` in `studio.json`.
2. **The game's landing** (`/<id>/`): follow "Its landing page" in the `game` skill. At least the words
   (game.json `landing`: `pitch`, `about`, `howToPlay`, `controls`) and a cover from a real frame (the `art`
   skill's free `frame` and `cover`); footage in the hero when there is time.
3. **A first post**: `posts/<today>-<game id>-is-live.md` saying what the game is and how to play it, with
   `title:`, `summary:` and `game: <id>` (the post shows the game with its Play button). `posts/README.md`
   has the format.
4. **Look at it**: `npm run build`, `npm run dev` (background), then
   `npx --no-install homie-studio look --url http://127.0.0.1:8787` shoots Home, every landing, Games, Rooms
   and Posts on a computer and a phone (upright and sideways) and says what is wrong (anything wider than
   the screen, Play below the fold, a picture that did not load). Open the pictures and look; fix; again.

## 3. Put it online, on the studio's own Cloudflare

Cloudflare is checked only now (a studio that never deploys never needs it):

1. `npx wrangler whoami` in the studio folder.
2. If it says it is not signed in: run `npx wrangler login` and tell the person, in
   one line, that Cloudflare opened in their browser and they should approve it
   (a free Cloudflare account works, no payment method). That is their only step. Wait
   for it to finish, then check `whoami` again. Never ask for or write an API key.
3. Before the first deploy, run `npx --no-install homie-studio deploy --plan` and tell the
   person its gist in two or three lines, in your own words: which Cloudflare resources
   (one Worker, one D1 database, two Durable Objects; no R2), the cost (free, no payment
   method), and what the directory will store (the site's address, the studio's name, each
   game's name, blurb and Play link). Then go on; do not wait.
4. `npm run deploy`. It creates the Worker and the D1 database named in `studio.json`
   (the Durable Objects come with the Worker), applies migrations, deploys, and stores
   reads the live site once, which makes the site claim itself in the directory. It never
   creates or binds R2. It refuses to touch anything of the same name it did not create —
   if it refuses, rename in `studio.json` and `wrangler.jsonc` (an older studio's is
   `site/wrangler.jsonc`; never delete or overwrite the other resource).
   If it answers with a `needs` step, say that step to the person in one line and wait:
   `cloudflare-verify-email` (a new account verifies its email address first),
   `workers-dev-subdomain` (pick a free workers.dev address once, on the link it gives).
5. `npx --no-install homie-studio check <id> --url <the live site>` — the same two-browser proof,
   on the live site.

The live address `deploy` prints is on `workers.dev`, which names the person's Cloudflare
account; `deploy` keeps it in `.studio/local.json` (git-ignored). Never write it into a
committed file. A custom domain, once the studio has one, goes in `studio.json` as
`cloudflare.domain`.

## 4. List it in the directory

Call the Homie MCP tool `studio_publish` with the live site address. It reads the
site's `/.well-known/homie-studio.json` and lists the games with their Play links.
The directory is in beta: it lists at most 12 games per studio, and its owner can
unlist a listing that breaks its rules.

## 5. Tell the person

Three to five lines: the studio folder, the live site, each game's landing (`/<id>/`) and Play link,
the directory link, that two browsers finished a round on the live site, and what now runs
on their Cloudflare and what it costs (free). Say in one line that the studio keeps its
own stats for them (`npx --no-install homie-studio stats`, or ask for the private page:
`stats link`). Add one line:
Homie for studios is in beta; bugs, port requests and questions go to
https://github.com/homie-rocks/homie/issues/new/choose. Commit the studio
(`git add -A && git commit -m "…"` inside the studio folder — it is the studio's own
repository).

## Storage, later and only when asked

Songs, videos and other large media go to the studio's storage (an R2 bucket), not git.
A studio that makes games never needs it. When the person wants it:
`npx --no-install homie-studio storage add`. Cloudflare asks for a payment method on the
account before R2 works (its first 10 GB a month are free), so say that first and let
the person decide; if R2 is not turned on, the command gives the dashboard link and
creates nothing. Then `npm run deploy` binds it and `homie-studio media put <file>`
uploads.

## Never

- Never put a key, token or password in the studio or in chat.
- Never touch Cloudflare resources the studio did not create.
- Never add a payment method, buy anything or turn on a paid plan for the person.
- Never use `~/.homie`; the studio needs no Homie box.
- Never ask the person to type a command.
