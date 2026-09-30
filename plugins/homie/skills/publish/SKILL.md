---
name: publish
description: Put a Homie studio's site and games online on the studio's OWN Cloudflare account (Worker, D1 and public-room Durable Objects, all on the free plan with no payment method; R2 storage only when added) and list them in the homie.rocks directory; ask an owner for a grant when a game uses a protected name. Use when someone asks to deploy, publish, go live, share a studio's games, or list them in the Homie directory.
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
applies migrations, deploys, and stores the homie.rocks directory claim. It never
creates R2. It refuses to use a Worker, database or bucket of the same name that this
studio did not create; then rename it in `studio.json` and `site/wrangler.jsonc`. Never
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

## List in the directory

Call the Homie MCP tool `studio_publish` with the live site (or run
`npx --no-install homie-studio publish`). It answers with each listed game's Play link. A game
refused for a protected name stays on the studio's site but is not listed. The directory
is in beta: at most 12 games per studio are listed, names and blurbs are checked (plain
text, no links), and its owner can unlist a listing. Anyone can report a listing; only
the directory's owner acts on reports, never an AI.

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
