# A Homie studio

This repository is a game studio made with [Homie](https://homie.rocks): its games, music, videos and posts,
and a site with public multiplayer rooms that runs on **your own Cloudflare account**, on the free plan.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/homie-rocks/homie/tree/main/template)

The button copies this studio into your GitHub, creates its Worker, database and rooms on your Cloudflare, and
deploys it with Workers Builds: every push to `main` goes live, and every other branch gets its own Preview.
The site goes live at once with its own home page ("first game coming soon"); the games come next.

Then open the site and tap **Connect this chat**, or ask Claude, Codex or Grok (with the Homie connector,
https://homie.rocks/mcp) to set up your studio: it makes games, songs and videos here, in a pull request you merge
with one tap. Grok has no Cloudflare connector. Approving Cloudflare in the browser is still your step.

`AGENTS.md` says how everything here works.
