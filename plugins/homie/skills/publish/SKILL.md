---
name: publish
description: Put a Homie studio's site and games online on the studio's OWN Cloudflare account (Worker, D1, R2, public-room Durable Objects) and list them in the homie.rocks directory; ask an owner for a grant when a game uses a protected name. Use when someone asks to deploy, publish, go live, share a studio's games, or list them in the Homie directory.
---

# Publish a studio

A studio's site runs on the studio's own Cloudflare account; homie.rocks only lists it.

## Cloudflare (checked only when you publish)

1. In the studio folder: `npx wrangler whoami`.
2. Not signed in: run `npx wrangler login`. Tell the person in one line that Cloudflare
   opened in their browser and they approve once (a free account works). Wait, then
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

`deploy` builds every game, creates the Worker, D1 database and R2 bucket named in
`studio.json` (R2 only when the account has it), applies migrations, deploys, and
stores the homie.rocks directory claim. It refuses to use a Worker, database or bucket
of the same name that this studio did not create; then rename it in `studio.json` and
`site/wrangler.jsonc`. Never delete, rename or redeploy anything the studio did not
create.

## List in the directory

Call the Homie MCP tool `studio_publish` with the live site (or run
`npx --no-install homie-studio publish`). It answers with each listed game's Play link. A game
refused for a protected name stays on the studio's site but is not listed.

## Grants (protected names)

To publish under a protected name (one of the homie.rocks house games) call
`studio_request_grant` { site, game, reason }. It returns a link for the OWNER. Show it
to the person; the owner approves with one tap in their own browser after a one-time
sign-in link reaches the owner's address. You cannot approve it and must never try
(no tool can; the approval page needs the owner's own browser session). Check with
`studio_grant_status`, then `studio_publish` again once approved.
