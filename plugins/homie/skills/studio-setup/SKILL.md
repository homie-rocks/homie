---
name: studio-setup
description: Set up a Homie game studio (one repository with games/, music/, videos/, posts/ and a site that runs on the studio's own Cloudflare), make its first multiplayer game, put it online and list it in the homie.rocks directory. Use when someone asks to set up, create or start a game studio, or says "set up a game studio called X and make a multiplayer game".
---

# Set up a game studio

A Homie studio is ONE folder the person can see and open: `AGENTS.md` (+ `CLAUDE.md`
importing it), `games/`, `music/`, `videos/`, `posts/`, and `site/` — a Cloudflare Worker
with D1, R2 and the Table/Lobby Durable Objects that serve the studio's pages and its
public game rooms from the studio's **own** Cloudflare account. The code comes from
`@homie-rocks/studio`, pinned in the studio's `package.json`. The person never types a
command: you run everything, and they approve what matters (Cloudflare, once, in
their browser).

Do the whole job in one go, then report the live links. Work in this order.

## 1. Make the studio

1. Call the Homie MCP tool `studio_scaffold` with the studio's name (and a folder if
   the person named one). It returns the exact pinned command.
2. Folder: the one the person named; otherwise a NEW folder named after the studio's
   slug inside the current directory (e.g. `./night-owls`). Never make a studio in a
   folder that already holds other files, never in the home folder, and never guess a
   folder outside the current directory.
3. Run the command it returned (it looks like
   `npx -y --package=https://homie.rocks/npm/homie-studio-<version>.tgz homie-studio new "<folder>" --name "<Name>" --homie https://homie.rocks`).
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
a 60 s round). Fix what it reports. Stop the dev server afterwards.

## 3. Put it online, on the studio's own Cloudflare

Cloudflare is checked only now (a studio that never deploys never needs it):

1. `npx wrangler whoami` in the studio folder.
2. If it says it is not signed in: run `npx wrangler login` and tell the person, in
   one line, that Cloudflare opened in their browser and they should approve it
   (a free Cloudflare account works). That is their only step. Wait for it to
   finish, then check `whoami` again. Never ask for or write an API key.
3. `npm run deploy`. It creates the Worker, the D1 database and (when the
   account has R2) the bucket named in `studio.json`, applies migrations, deploys, and
   stores the directory claim. It refuses to touch anything of the same name it did
   not create — if it refuses, rename in `studio.json` and `site/wrangler.jsonc`
   (never delete or overwrite the other resource).
4. `npx --no-install homie-studio check <id> --url <the live site>` — the same two-browser proof,
   on the live site.

## 4. List it in the directory

Call the Homie MCP tool `studio_publish` with the live site address. It reads the
site's `/.well-known/homie-studio.json` and lists the games with their Play links.

## 5. Tell the person

Three or four lines: the studio folder, the live site, each game's Play link, the
directory link, and that two browsers finished a round on the live site. Commit the
studio (`git add -A && git commit -m "…"` inside the studio folder — it is the
studio's own repository).

## Never

- Never put a key, token or password in the studio or in chat.
- Never touch Cloudflare resources the studio did not create.
- Never use `~/.homie`; the studio needs no Homie box.
- Never ask the person to type a command.
