# Homie for Claude Desktop

A Desktop Extension (`.mcpb`) that gives the plain Claude desktop app Homie's studio tools and cards **in the same
chat**: the chat that shows the setup, build progress, studio and Game Codex cards also makes the studio, its games,
the two-browser checks and the deploys, on this computer. No terminal, and no second session.

It is `@homie-rocks/studio`'s local MCP server (`homie-studio mcp`, stdio) with Homie's guides (the plugin's
skills), packed with Anthropic's own tool, [`@anthropic-ai/mcpb`](https://github.com/modelcontextprotocol/mcpb).

## Install it (one minute)

1. Get `homie-studio.mcpb` from https://homie.rocks/studio/desktop/ (it links the newest release here:
   https://github.com/homie-rocks/homie/releases/latest/download/homie-studio.mcpb), or build it in a checkout with
   `node scripts/desktop.mjs` (it writes `desktop/dist/homie-studio-<version>.mcpb`).
2. Double-click it, or drag it into the Claude window (or Settings → Extensions → Advanced settings →
   Install Extension…). Claude shows what it is; choose **Install**. The install screen says the extension is not
   signed (see Signing below): that is the one warning, and it is expected for now.
3. It has one setting, **Studios folder**: where your studios live (each studio is a folder in it; Homie only reads
   and writes inside it). It is optional: left as it is, it is `Studios` in your home folder. Change it there, or
   later in Settings → Extensions → Homie Studio.
4. It turns itself on as it installs. If Settings → Extensions shows **Homie Studio** switched off, switch it on.
5. In a new chat, ask: *"Set up a game studio called Night Owls."*

The studio needs Node.js 22 or newer on the computer (it installs its own pinned toolkit and Cloudflare's Wrangler
with npm). The setup card says so if it is missing, with the download page. Chrome is needed for the two-browser
check; Cloudflare only when the studio goes online (you approve once in your browser: a free account, no payment
method).

## The test: one minute, in your own Claude desktop app

1. Install it as above, with the Studios folder set to a new, empty folder (for example a folder called Studios Test
   in your home folder), so the test cannot touch a studio you already have. Check that Settings → Extensions shows
   Homie Studio switched on (it turns itself on; if it is off, switch it on).
2. New chat: **"Set up a game studio called Paper Comets."**
   - The **Studio setup** card appears in the chat: the new-studio checklist (step 1 ticked), this computer's rows
     (Node, Chrome, ffmpeg, Cloudflare, GitHub, ElevenLabs, fal), and "Installing the studio's toolkit…" until npm
     finishes (a minute or two).
   - The folder `Paper Comets`'s studio (`paper-comets`) exists in the Studios folder, with **no game in it**.
3. **"Show me a working game."** Claude gives a live game on Homie Arcade with its Play link; nothing is copied into
   the studio. The setup card's **Play a live game** opens it too.
4. **"Run the studio here."** Claude starts the site on this computer and gives `http://127.0.0.1:8787/`: the home
   page says **Paper Comets**, **First game coming soon**, and what is on the way.

Pass: the cards render in the chat, every step happened in that one chat, and no starter game was put in the studio.
Optional, a few more minutes: "Let's plan my game" (the Game Codex card), "make it" and "does it work?" (the build
card follows a real two-browser check, live).

Uninstall: Settings → Extensions → Homie Studio → Uninstall. The Studios folder stays.

## A studio that lives on GitHub

A studio made from a phone (Deploy to Cloudflare put it in the person's GitHub) opens here too: *"open my studio
octo/night-owls"*. `studio_open` with its repository clones it into the Studios folder with this computer's own
GitHub sign-in (the GitHub CLI's, or git's own credentials). If GitHub says no, `github_login` signs the computer in
with GitHub's device sign-in: a one-time code to type at github.com/login/device. No token is ever pasted anywhere.

## On a phone

The Claude app on a phone has no extensions. There the remote Homie connector (`https://homie.rocks/mcp`) shows the
same cards, and a build goes to a Claude Code session in the cloud with **one short line**, *"Continue building
Night Owls: build hb_…"*; the session fetches the brief itself (`homie-studio handoff`, the studio's `HANDOFF.md`).

## Notes

- **Signing.** It ships unsigned for now, so Claude's install screen says it is not signed; choose Install. It gets
  signed once signing works with Claude Desktop: `@anthropic-ai/mcpb` 2.1.2 (the newest on npm) writes signed bundles
  that Claude Desktop refuses (modelcontextprotocol/mcpb#278), and a self-signed certificate reads as unsigned anyway.
  An organisation that requires signed extensions (`isDesktopExtensionSignatureRequired`) cannot install it until
  then.
- **Not the Homie house app.** On a Mac with the Homie house app, Claude may also list that app's own MCP server
  (its room and TV tools). That is a different server: this one is **Homie Studio**, and every one of its tools says
  so in its description.
- **The 60-second rule.** Claude Desktop gives a local tool call 60 s. Long work (npm install, a check, a deploy) runs
  in the background: the tool answers at once with a card that follows it.
- **Where it runs.** Claude Desktop may run the server on its own built-in Node.js; the server then runs every studio
  command with the computer's Node.js (it never starts the app's own binary), found on the PATH or in the usual places
  (Homebrew, nvm, Volta, asdf, fnm, the Node.js installer).
- **The same tool names as the remote connector** where they overlap (`studio_scaffold`, `studio_card`, `game_make`,
  `game_remix`, `game_port`, `preview_run`, `studio_deploy`, `studio_publish`, `build_open`, `build_progress`,
  `build_stop`): the remote ones say what to run, these run it.
- Check a build of it: `node scripts/desktop.mjs --check` validates the manifest with `mcpb validate`, packs it,
  unpacks it, and drives the packed server the way the app does.
