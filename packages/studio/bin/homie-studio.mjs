#!/usr/bin/env node
/**
 * homie-studio — make a studio (games, music, videos, posts), make its games,
 * put its site on the studio's own Cloudflare (free plan, no payment method), and
 * list its games in the homie.rocks directory.
 *
 *   homie-studio new <folder> --name "<Studio Name>" [--homie <directory url>] [--no-install] [--template]
 *                                         (--template: the public "Deploy to Cloudflare" template, with a Connect band;
 *                                          a new studio has no game: its home says "First game coming soon")
 *   homie-studio starters
 *   homie-studio demo                     a live multiplayer game to try now (Homie Arcade), nothing copied into the studio
 *   homie-studio mcp [--studios <folder>] [--skills <folder>]
 *                                         this toolkit as a local MCP server (stdio): the Claude desktop app's Homie
 *                                          extension, Claude Code or any MCP client builds in the same chat that shows
 *                                          the cards (lib/mcp.mjs); --studios: the folder the studios live in
 *   homie-studio app new <id> [--name "<App Name>"]
 *   homie-studio app role <id> <role> [--player <account>] [--revoke] [--url <site>]
 *   homie-studio game new <id> [--from gem-rush] [--name "<Game Name>"]
 *   homie-studio games
 *   homie-studio build [<id>] [--maps] [--types] [--long-check]   (--maps: also keep each bundle's source map and
 *                                          module sizes in .studio/maps/<id>/, never in site/dist: what `perf` reads a
 *                                          CPU profile through; --types: check the games' TypeScript first, with the
 *                                          studio's own `typescript`; a type error stops the build; --long-check: play
 *                                          each rules game eight times as long before it is written (a rules game is
 *                                          always type-checked and played; this is more of the same play, for a
 *                                          release or a CI run). The site is built in a folder of
 *                                          its own and put in place only when all of it is there: a game that does not
 *                                          build fails the command and leaves site/dist as it was. Each game's line says
 *                                          changed or unchanged, its build hash, and whether its source is shared)
 *   homie-studio preview <id> [--port 8788]   (one built game's files at an address on this computer, nothing else: no
 *                                          Wrangler, no rooms, no database; for a capture, a screenshot or a perf script.
 *                                          The game plays offline with its bots. Stop it with Ctrl-C)
 *   homie-studio dev [--lan] [--port 8787] [--remote-ai] [--no-local-ai] [--timestamps]   (--stop: stop exactly this studio's dev server,
 *                                         nothing else, and clear a stale record; rooms here are always local: production
 *                                         routes in wrangler.jsonc are left out; a game built while it runs is picked up;
 *                                         --timestamps: a time on every line of Wrangler's, not only the room and error ones;
 *                                         AI guides, chat review and game decisions think with Clef on this computer
 *                                         when Ollama has clef-flash (free; dev never downloads it), else scripted;
 *                                         --remote-ai: the real Workers AI, billed)
 *   homie-studio check <id> [--url <site>] [--shots <dir>]
 *   homie-studio shoot <id> [--url <site> | --preview] [--frames 60] [--fps 30] [--device computer|phone]
 *                      [--out <dir>] [--hold <key code>] [--no-smoke] [--timeout 180]
 *                                         pictures of the game on a clock this command steps (one frame = 1/fps s
 *                                         of the game's own time, however slow the renderer: for a 3D game on a
 *                                         machine with no GPU), after a two-client seat smoke check in a private
 *                                         room. Frames and shoot.json go to --out (default .studio/shoot/<id>/).
 *                                         --preview: no site needed; it serves the built game itself (as
 *                                         `preview` does: alone, offline) and shoots that, with no smoke check,
 *                                         and says which build (its hash and bundle) the frames are of.
 *   homie-studio perf <id> [--url <site>] [--device computer,phone] [--runs 1] [--seconds 15] [--warm 3] [--profile]
 *                     [--cpu 4] [--out <dir>] [--max-load 0.8] [--pair <label>]
 *                                         (how fast it runs: per device, two browsers in a fresh room, the host and a replica,
 *                                          playing: frame times (median, p95, p99, long frames), the game's JavaScript per frame,
 *                                          the main thread per frame, time to playable and what it downloaded, the heap, netplay
 *                                          messages a second; the computer's load with every run. --profile: a CPU profile of
 *                                          each browser and its hottest functions. Files under .perf/<id>/<time>/; the phone is
 *                                          emulated (a --cpu times slower CPU, 4G) on this computer's GPU. The plugin's perf
 *                                          skill runs the whole measure, change, compare, keep-or-revert loop)
 *   homie-studio trailer <id> [--url <site>] [--seconds 40] [--length 20] [--title "…"] [--end "…"] [--skills <folder>]
 *                                         (a trailer in one command, by the plugin's video skill: the game rendered frame by
 *                                          frame on a virtual clock, its sound rebuilt from its own files and what it played,
 *                                          the highlights picked, an end card, 16:9, 1:1 and 9:16 in videos/<id>-trailer/)
 *   homie-studio perf sizes <id>          (what a player downloads: every built file, raw and gzipped, the biggest first; with
 *                                          build --maps, which modules make up the bundle; each big script read for whether it
 *                                          is minified, from its code, and how much of it is GLSL shader source in strings)
 *   homie-studio perf compare <before dir> <after dir> [--goal phone.host.frame.p95] [--min 3] [--guards a,b] [--also c,d]
 *                                         (better, worse or the same within the noise: medians, a 95% interval, a rank test,
 *                                          and the guards that must not get worse; runs taken side by side with the same
 *                                          --pair label on both sides are judged as pairs, so a computer's drift cancels)
 *   homie-studio lab <id> [--port 8790] [--today HEAD|<ref>] [--take <name>]
 *                                         (the Game Lab, on this computer, until --stop: one take of the game (games/<id>/lab.json)
 *                                          played in New, the working tree, rebuilt on every save, beside Today, built from git's
 *                                          checkout of the ref, on one clock with the same seed and presses: slowed to a tenth or
 *                                          a frame at a time, at 60, 30, 15 or 12 fps, on a computer or a phone; a timeline of the
 *                                          phases the game names, graphs New against Today, the game's own overlays and views,
 *                                          sliders that write kept values into games/<id>/tunables.json, and REC for a new take.
 *                                          The game calls @homie-rocks/studio/lab; the plugin's lab skill has the method)
 *   homie-studio lab check <id> [--take <name>] [--today <ref>] [--device desk|phone] [--fps 60] [--frames 6] [--out <dir>]
 *                                         (the same take headless, twice per build: every phase, each tracked value's peak, the
 *                                          game's JavaScript per frame, whether a replay lands on the same frames, a contact sheet
 *                                          and a still; .studio/lab/<id>/check-<time>/)
 *   homie-studio lab set <id> <name>=<value> ...   (values into games/<id>/tunables.json, one tunable a line)
 *   homie-studio lab --stop               (this studio's Game Lab only, and the checkouts Today was built from)
 *   homie-studio chrome [install] [--fresh]  (which Chrome the checks use; on Linux, `install` fetches Chrome for Testing;
 *                                          --fresh fetches it even when the machine has a Chrome)
 *   homie-studio look [<path>...] [--url <site>] [--shots <dir>] [--only computer,phone,sideways]
 *                                         (the site's pages on a computer and a phone, as pictures, with what is wrong)
 *   homie-studio port plan <game folder>
 *   homie-studio port import <game folder> --id <id> [--name "<Name>"] [--mode static|bundle|command]
 *   homie-studio port check <id> [--url <site>] [--only owner-desk,owner-phone,owner-iphone,round,life,tv] [--shots <dir>]
 *   homie-studio deploy [--plan]          (--plan: what it will create on Cloudflare and what it costs; changes nothing)
 *                                         One deploy of a studio at a time (a lock in .studio/); it says which games changed
 *                                         with each one's content hash, keeps the studio's own custom-domain and exact-host
 *                                         routes in wrangler.jsonc, and never deploys a wildcard or catch-all route.
 *                                         On a custom domain, the plan and the deploy read the domain's Worker routes and
 *                                         warn when another site's catch-all or wildcard covers the studio's hostname
 *                                         (never edit or remove that route). --own-route adds the studio's own
 *                                         exact-host route, the one safe fix, when that read shows it is needed.
 *                                         In Cloudflare's Workers Builds (WORKERS_CI=1, or --ci) it only applies the D1
 *                                         migrations and deploys: the Worker and database are the Deploy button's.
 *   homie-studio publish [--before]       (the directory's beta has a daily cap: it says how many publishes are left)
 *                                         --before publishes NOTHING: it asks the directory (a read) whether the site
 *                                         is listed and how many publishes are left today, and says the parts' licences.
 *                                         A command that changes something outside this computer (deploy, publish,
 *                                         storage add, the office, …) stops at a flag it does not know: nothing is sent.
 *   homie-studio storage add              (large media only: an R2 bucket; needs R2 turned on for the account)
 *   homie-studio media list               (every song and video page, where each file is served from, what moves to R2)
 *   homie-studio media move [<file>...] [--dry-run] [--verify]
 *                                         (with storage: the big files of published songs and videos into R2, each
 *                                          read back and checked by SHA-256 before the site stops carrying it; the
 *                                          address stays the same and the file stays in this folder. With no file:
 *                                          everything over studio.json media.r2Over, 1 MiB unless set, or left out of
 *                                          git. Every deploy does it too. --verify re-checks what R2 holds)
 *   homie-studio media put <file> [--as <key>]   (a loose file at /media/<key>; for a song or video, media move)
 *   homie-studio status
 *   homie-studio upgrade [--apply] [--diff]
 *                                         (what this version's template adds to an existing studio: AGENTS.md
 *                                          sections, READMEs, .gitignore lines, the pin; changes nothing until
 *                                          --apply, and never a file or section the studio changed. It starts
 *                                          with what's new since the studio's version, from this package's
 *                                          CHANGELOG.md)
 *   homie-studio stats [--range 1d|7d|30d|90d] [--game <id> | --song <slug> | --video <slug>] [--url <site>]
 *   homie-studio stats key [--hours 1]    (a read key for the Homie MCP tool studio_stats)
 *   homie-studio stats link               (a one-time link to the private stats page, for the owner's browser)
 *   homie-studio stats revoke             (every stats key and page session ends)
 *   homie-studio stats share on|off       (tell the homie.rocks directory "played this week", or stop)
 *   homie-studio players                  (player accounts and guests with saves: counts, never a passkey or an email)
 *   homie-studio players owner [--revoke] (a one-time link that marks the owner's own player account as the owner's)
 *
 *   homie-studio office [--url <site>]    the back office: every live room of every game and who is in it, now
 *   homie-studio office link [--to <path>]   a one-time link that signs the owner's browser in (the office; or
 *                                          --to /<game>/play: a private game on the owner's own phone)
 *   homie-studio office key [--hours 1]   a key for the Homie MCP's owner tools (studio_office, room_kick, ...)
 *   homie-studio office announce "<text>" [--game <id>] [--room <code>] [--seconds 30]
 *   homie-studio office invite <game> [--label "<who>"] [--uses 1|<n>|any] [--count 1] [--days <n>] [--server <id>]
 *   homie-studio office launch <game> private|invite|public [--max <n>|game]
 *   homie-studio office kick <game> <room> <seat number | name> [--minutes 10]
 *   homie-studio office mute <game> <room> <seat number | name> [--minutes 10] [--off]
 *   homie-studio office close <game> <room> [--minutes 10] [--reopen]
 *                                         (kick, mute, close and launch are ASKED for: the owner confirms each with one
 *                                          tap in their own browser, from the link this prints)
 *   homie-studio office revoke            (every office key, play ticket and pending ask ends)
 *
 *   homie-studio chat [--game <id>]       room chat (NETPLAY.md section 19): each game's rules, every live room's last
 *                                          minutes, players' reports, the review's day; chat rules <game> [--server <id>]
 *                                          --mode off|emoji|lines|text --who anyone|signed-in|members … | --reset;
 *                                          chat remove <game> <room> <line id>; chat budget <neurons>; chat words
 *   homie-studio lounge                   the studio's Lounge (studio.json "lounge", chat/LOUNGE.md): its rules, play
 *                                          nights, moderators, last lines and reports; lounge night "<title>" --at <time>
 *                                          [--minutes 120] [--game <id>]; lounge night remove <id>; lounge history <days>;
 *                                          lounge rules [--slow <s>] [--who …] | --reset; lounge mod <player> [--remove];
 *                                          lounge remove <line id> | --all
 *   homie-studio servers [--game <id>]    every server of every game (worker/servers.mjs): its policy, door, the AI's
 *                                          level, live rooms and AI, members, and builds that predate servers
 *   homie-studio servers new <game> "<Name>" --policy open|humans-only|hybrid|beginner [--ai <n>] [--guides <n>]
 *                                        [--kids] [--door open|accounts|invite] [--level 1-5] [--level-max 1-5]
 *                                        [--speech game|lines|off] [--bots fill|off] [--rooms <n>] [--listed on|off]
 *   homie-studio function new <name> [--event order.paid]
 *   homie-studio function fire <event> [--input <JSON>] [--id <event-id>] [--url <local-site>]
 *   homie-studio tool new <name> [--app <id>]
 *   homie-studio tool call <name> --input <JSON> [--url <site>] [--public]
 *   homie-studio servers set <game> <server> [the same flags]
 *   homie-studio servers close <game> <server> [--reopen]
 *   homie-studio servers level <game> <room> <1-5>   (the AI's level in one room: Rookie, Steady, Fair, Strong, Maxed)
 *   homie-studio servers member <game> <server> <player> --role member|mentor|mod | --remove
 *   homie-studio agents pass <game|any> --label "<Name>" [--server <id>] [--hands self|host] [--days 7]
 *                                         (an AI's way into a seat, always marked AI; the pass is shown once)
 *   homie-studio agents passes [<game>]   homie-studio agents revoke <pass id>
 *   homie-studio agents brain <game> <server> off|script|workers-ai|owner-key [--budget <n>]
 *                                         (a narrowing change, closing a server, removing a member and the first
 *                                          time AI guides may talk are ASKED for, like office kick; --budget is
 *                                          Workers AI neurons a day, or dollars a day for the owner's key)
 *   homie-studio agents brain key [--remove]   (the owner's AI key, typed into a page on this computer only)
 *   homie-studio agents sit <game> [--server <id>] [--brain local]   (a guide's seat from this terminal; --brain local:
 *                                          Clef on this computer decides every few seconds, free; never downloads it)
 *   homie-studio agents try <game> --view <file.json> [--ask <ask>[:<arg>=<value>] --from <seat>] [--model <id>]
 *                                         (what the guides' brain would decide in that moment, with no seat taken;
 *                                          spent from the guides' day; --model compares a model before setting it)
 *   homie-studio shop                     is the studio's shop selling (its own Stripe), and if not, what is missing
 *   homie-studio shop init [--supporter] [--currency usd] [--price 500] [--managed]   shop.json and SELLING.md
 *   homie-studio shop check               shop.json against studio settings and provider requirements
 *   homie-studio shop connect [--live] [--renew] [--manual]   sync Payment Links and webhook through Stripe browser approval; --manual chooses the local page for the studio's
 *                                         restricted Stripe key; with it this makes the webhook (0.24.3), and the key
 *                                         and the webhook's secret go straight to the Worker secrets, never a chat or a
 *                                         file (test keys only unless --live)
 *   homie-studio shop catalog [--have <file>|-] [--mode test|live]   the items as Products in the studio's Stripe,
 *                                         made by the AI through Stripe's own MCP: the read first, then (with what it
 *                                         answered) the exact writes; in sync, shop.json "catalog" records the mode
 *   homie-studio shop disconnect          both secrets gone: the shop closes
 *   homie-studio shop orders              the latest orders (never a card or an email)
 *   homie-studio shop refund <order> [--reason …] [--note "<why>"]   ASKS the owner (a one-tap link)
 *   homie-studio shop statements [--period YYYY-MM] [--send]   signed referral statements this studio owes
 *   homie-studio agents sit <game> [--server <id>] [--pass hap_…] [--label Claude]
 *                                         (an AI guide's seat from this terminal: then lines of `do <goal> {args}`,
 *                                          `say <line> {args}`, `look`, `stand`)
 *
 *   homie-studio progress start [<id>] [--what game|song|video] [--title "<what this build does>"]
 *                                        [--budget <dollars>] [--unit usd|credits] [--share]
 *                                         (a progress feed for one build; --share shows it in the Claude app
 *                                          through the Homie MCP's build_progress widget, which can press Stop)
 *   homie-studio progress stage <stage> running|done|failed|skipped [--note "<one line>"]
 *   homie-studio progress check <id> pending|running|pass|fail|skip [--label "<words>"] [--note "<one line>"]
 *   homie-studio progress preview [--url <address>] [--image <small .jpg/.png>] [--caption "<words>"]
 *   homie-studio progress spend <amount> --what "<what it bought>" [--receipt <file>]
 *   homie-studio progress shot <id> pending|running|pass|fail [--label "<words>"] [--image <small .jpg>]
 *   homie-studio progress song [--peaks <peaks.json>] [--lyric "<line>" --sung yes|no]
 *   homie-studio progress log "<one line>"
 *   homie-studio progress stop            (ask the running build to stop at its next safe point)
 *   homie-studio progress end passed|failed|stopped [--note "<one line>"]
 *   homie-studio progress attach <hb_…>   (the build the Claude app opened with build_open: this session takes it, once)
 *   homie-studio progress change "<what the change does>"   (its mark in changes/, committed with the change)
 *   homie-studio progress pr --url <pull request> [--state open|merged|closed] [--files n --additions n --deletions n]
 *                                         [--preview <Preview URL>]   (the card's Publish opens it for the person's merge)
 *   homie-studio progress show [<build>]
 *                                         While a feed is open, build, check, port check and deploy report
 *                                         into it (stage, each check going green, a preview picture) and stop
 *                                         when asked. Without one, nothing changes.
 *
 *   homie-studio handoff <hb_…> [--client claude|codex|grok]
 *                                          (a session started from the chat with one line, "Continue building
 *                                          <Studio>: build hb_…": fetch the person's brief, check in for a new studio, take
 *                                          the build so the chat's card follows it, and print the steps; HANDOFF.md)
 *   homie-studio setup attach <hs_…> [--client claude|codex|grok]
 *                                          (this repository is the studio the chat's setup card is making: say so, once,
 *                                          learn its live address, and give a template copy its real name)
 *   homie-studio setup --via stripe-projects [--with elevenlabs] [--accept-tos] [--dry-run]
 *                                         (a prototype, 0.24.3: Cloudflare, and ElevenLabs with --with, made or linked
 *                                          through Stripe Projects on their free plans; the person accepts the providers'
 *                                          terms (then --accept-tos) and signs in on Stripe's and the provider's own
 *                                          pages; the account id goes into studio.json, the token stays in Projects'
 *                                          vault and its git-ignored .env, and Wrangler runs with it here. The usual
 *                                          way, npx wrangler login, stays the default. lib/projects.mjs)
 *   homie-studio domain <hostname>                  AI configures DNS/TLS for the next deploy
 *   homie-studio setup prepare                     AI installs a private Node/npm if missing
 *   homie-studio setup status [--connector yes|no] [--client claude|codex|grok]   (also: homie-studio doctor)
 *                                         what this computer and the person's accounts have for a studio: Node, the Homie
 *                                         connector, Cloudflare (signed in, email verified), Chrome, ffmpeg, GitHub,
 *                                         ElevenLabs, fal; green, missing or "do this now", what each unlocks and its
 *                                         exact fix. Read-only and safe any time, inside a studio or before one exists.
 *                                         A missing connector never blocks: a session with a shell makes a studio with
 *                                         `new`. In Codex and Grok Build (--client, or the app's own environment) it
 *                                         also says whether Homie's holds are on (the plugin's hooks ran just now), and
 *                                         when another MCP server named homie has taken the connector's name there.
 *
 *   homie-studio codex new <id> [--name "<Name>"]
 *                                         games/<id>/CODEX.md: the Game Codex, every section, in the game's colours (a game
 *                                          is planned before it is made: with no game <id> yet, it starts its folder)
 *   homie-studio codex <id> [--artifact] [--open]
 *                                         the codex as a page in the game's own look (.studio/codex/<id>.html; it redraws
 *                                         itself as the build's progress changes); --artifact: a copy to publish as a
 *                                         Claude artifact; --open: open it in this computer's browser
 *   homie-studio codex link <id>          a one-time link to the codex on the live site (a private page for the owner)
 *
 *   homie-studio style init <id> [--prompt "<the person's words>"] [--hands-on] [--budget <usd>]
 *                                         art direction as decisions (games/<id>/codex/decisions.json): render style,
 *                                          palette, shape, proportions, materials, light, camera, fonts, effects; the cast,
 *                                          its routes, library family, scale and budgets; rigs, animation, in-game budgets.
 *                                          Each starts as an automatic pick with a why; the first asset built on one pins it
 *   homie-studio style [show] <id> [--phase style]   the decisions (· auto, ~ steered, ● pinned by use, ■ locked)
 *   homie-studio style set|steer|lock|unlock <id> <decision> …   change one ("warmer"), lock it for the person (--words
 *                                          "<what they said>"); a locked one changes only with --unlock --reason, and
 *                                          --confirm after the person saw what goes stale (style blast)
 *   homie-studio style board <id>         three directions drawn by the engine (free): swatches in codex/board/
 *   homie-studio style pick <id> <a|b|c> [--mix style.palette=b]   the person's pick (or a mix) from the board
 *   homie-studio style mood|golden|blast|prompt <id> …   a paid mood image's record, golden images, the blast radius
 *                                          of a change, the derived style prompt every generation starts from
 *   homie-studio assets [list] <id>       every asset: route, licence, measurements, spend (games/<id>/assets/manifest.json)
 *   homie-studio assets find "<words>" [--kind prop] [--family kenney]   the free CC0 starter library (HOMIE_LIBRARY: a copy)
 *   homie-studio assets add <id> <library item> [--height <m>] | --file <model> --license <kind> [--attribution "…"]
 *                                          copied in, checked (no external URIs, no oversized files), made phone-sized,
 *                                          recorded with its licence; RIGHTS.md and credits.json follow
 *   homie-studio assets redo <id> <asset>   made again from its kept raw file, free (today's budgets and style)
 *   homie-studio assets optimise <in> --out <file> [--triangles 1500] [--texture 512] [--height <m>]
 *   homie-studio assets check <id>        phone budgets (triangles, draw calls, picture memory, download), the
 *                                          glTF-Validator, licences, stale assets, big files in git
 *   homie-studio assets lineup|review|rights|stale|remove <id> …   the lineup (true scale, silhouettes, palette drift),
 *                                          a reviewer's score, RIGHTS.md, what a changed decision made stale
 *   homie-studio cast <id>                the characters: proportions, silhouette, palette, skeleton family, clips
 *   homie-studio anim [plan] <id>         each character's clips against the verbs the game needs (idle, run, jump,
 *                                          attack, hit, die, ...) and where each comes from
 *   homie-studio anim add <id> <asset> --verbs jump,attack [--from <library item>]   more verbs, retargeted onto its
 *                                          skeleton at build time into its clip library (public/anims/<skeleton>.glb)
 *   homie-studio anim preview <id> [--asset <asset>]   looping previews of every clip (animated WebP) and a sheet
 *   homie-studio collision bake <id> <model.glb> [--cell 0.25]   a height grid off a model's triangles, beside it, with
 *                                          a checksum of the mesh and a true-scale plan (lib/collision.mjs)
 *   homie-studio collision check <id>     every collision file: stale against its model, its proxies, its routes walked
 *
 *   homie-studio parts find|new|add|share|unshare|check …
 *                                         game parts (parts/PARTS.md): pieces of games a studio shares, and brings into
 *                                          its own games from other studios. The plumbing behind the chat tools
 *                                          parts_find, part_add, part_new and part_share; nobody is asked to type it
 *
 *   homie-studio standalone plan|build|run|steam|ci <game> [--for mac,windows,linux,ios,android] [--release]
 *                                        [--site <address>] [--build <n>]
 *                                         the game as an app of its own (standalone/STANDALONE.md): the same web build in
 *                                          Electron for macOS, Windows and Linux and Capacitor for iOS and Android (the
 *                                          files Steam and the stores accept for upload; their review is theirs), finding
 *                                          its rooms on the studio's own site and playing offline with its bots when it
 *                                          cannot. plan: what would be built, what each target needs on this computer,
 *                                          and what a standalone copy does not have (no accounts, cloud saves, shop or
 *                                          chat); build: every target this computer can make, in
 *                                          .studio/standalone/<game>/out/<target>/<debug|release>/ (a missing
 *                                          prerequisite skips that target with its fix; this computer's own desktop
 *                                          build is started once and the result says whether the game loaded;
 *                                          --release: signed from the environment only, game.json must name the app's
 *                                          id, and an unsigned release is said as UNSIGNED and is not a success); run:
 *                                          the built copy, here; steam: Steam's build file; ci: a GitHub workflow that
 *                                          builds all five. Nothing is ever uploaded to Steam or a store
 *   homie-studio standalone run <game> --for ios --device
 *                                         the game on the ONE iPhone or iPad plugged in to this Mac: built, signed for
 *                                          your Apple team (HOMIE_APPLE_TEAM, else the keychain's only one), installed
 *                                          over the cable, started, and then looked for among the phone's running
 *                                          programs. --device is your yes to what it changes outside this computer: it
 *                                          adds the phone to your Apple team's list of development devices. A phone with
 *                                          Developer Mode off, locked, or not trusting this Mac is said with its fix
 *
 *   homie-studio statusline               the current build in one line (what Claude Code's status line shows)
 *   homie-studio statusline --install [--project <folder>]
 *                                         turn it on in Claude Code for this studio (.claude/settings.local.json);
 *                                         --project: the folder Claude Code was started in, when that is above the
 *                                         studio; --remove turns it off; --replace when another status line is set
 *
 * Every command prints a few lines for a person; --json prints the result.
 */
// FIRST, before any other file of the toolkit is evaluated: a Node.js that is too old ends here, with the reason.
import '../lib/node-version.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { build } from '../lib/build.mjs';
import { PREVIEW_PORT, previewServer } from '../lib/preview.mjs';
import { check } from '../lib/check.mjs';
import { ciDeploy, deploy, deployPlan, mediaMove, storageAdd, whoami, wranglerBin, zonePlan } from '../lib/cloudflare.mjs';
import { studioDomain } from '../lib/domain.mjs';
import { prepareNode } from '../lib/prepare.mjs';
import { setupAttach } from '../lib/setup.mjs';
import { chromeArgs, findChrome, installChrome, noChrome } from '../lib/chrome.mjs';
import { deployWords } from '../lib/deploy-state.mjs';
import { publish, publishBefore } from '../lib/directory.mjs';
import { look } from '../lib/look.mjs';
import { importPort, planPort } from '../lib/port.mjs';
import { portCheck } from '../lib/port-check.mjs';
import { perfCompare, perfRun, perfSizes } from '../lib/perf.mjs';
import { LAB_PORT, labServe, labSet, labStop } from '../lib/lab.mjs';
import { R2_COST, lineOf, mediaPlan, r2OverOf, recordUpload, resolveMedia, sizeOf, typeOf } from '../lib/media.mjs';
import { newStudio } from '../lib/scaffold.mjs';
import { lineDiff, upgradeApply, upgradePlan } from '../lib/upgrade.mjs';
import { whatsNewLines } from '../lib/changelog.mjs';
import { listGames, newGame, newApp, readStudio, requireStudio, siteUrl, starters, workerDir } from '../lib/studio.mjs';
import { STUDIO_VERSION } from '../lib/version.mjs';
import { statsKey, statsLink, statsRevoke, statsShare, statsShow } from '../lib/stats.mjs';
import { playersOwner, playersShow } from '../lib/players.mjs';
import { officeAnnounce, officeClose, officeInvite, officeKey, officeKick, officeLaunch, officeLines, officeLink, officeMute, officeRevoke, officeShow } from '../lib/office.mjs';
import { chatBudget, chatLines, chatRemove, chatRulesSet, chatShow, chatWords } from '../lib/chat-cli.mjs';
import { loungeLines, loungeMod, loungeNight, loungeRemove, loungeRulesSet, loungeShow } from '../lib/lounge-cli.mjs';
import { detectLocalAi } from '../lib/local-ai.mjs';
import { dev, stopDev } from '../lib/dev.mjs';
import { agentsBrain, agentsBrainKey, agentsPass, agentsPasses, agentsRevoke, agentsTry, serversClose, serversLevel, serversLines, serversList, serversMember, serversNew, serversSet } from '../lib/servers.mjs';
import { AgentSeat } from '../lib/agent-seat.mjs';
import { shopCheck, shopConnect, shopDisconnect, shopInit, shopLines, shopOrders, shopRefund, shopStatements, shopStatus } from '../lib/shop.mjs';
import { catalogLines, catalogPlan } from '../lib/shop-catalog.mjs';
import { projectsLines, setupViaProjects } from '../lib/projects.mjs';
import { projectsCloudflareEnv } from '../lib/projects-env.mjs';
import { Feed, currentFeed, currentId, flushProgress, publicFeed, readFeed, recordChange, startProgress } from '../lib/progress.mjs';
import { formatStatus, setupStatus } from '../lib/doctor.mjs';
import { codexTarget, newCodex, writeCodexPage } from '../lib/codex.mjs';
import { installStatusLine, statusLine } from '../lib/statusline.mjs';
import { restartWithProxy } from '../lib/net.mjs';
import { demoGames, formatDemo } from '../lib/demo.mjs';
import { serveMcp } from '../lib/mcp.mjs';
import { animCommand, artLines, assetsCommand, castView, styleCommand } from '../lib/art-cli.mjs';
import { collisionCommand } from '../lib/collision.mjs';
import { formatHandoff, handoff } from '../lib/handoff.mjs';
// GAME PARTS (parts/PARTS.md): `parts …` is lib/parts-cli.mjs; the deploy plan shows brought-in parts' licences.
import { partsCommand, partsLines } from '../lib/parts-cli.mjs';
import { partsPlanLines, partsPublishReport } from '../lib/parts-build.mjs';
import { trailerCommand, trailerLines } from '../lib/trailer.mjs';
// STANDALONE COPIES (standalone/STANDALONE.md): `standalone …` is lib/standalone-cli.mjs; a deploy says what it means for them.
import { standaloneCommand, standaloneLines } from '../lib/standalone-cli.mjs';
import { standaloneDeployNotes } from '../lib/standalone.mjs';

const argv = process.argv.slice(2);
const flags = new Map();
const BOOL_FLAGS = ['public', 'lan', 'off', 'revoke', 'json', 'yes', 'detach', 'no-install', 'plan', 'stop', 'share', 'apply', 'diff', 'template', 'ci', 'fresh', 'install', 'remove', 'replace', 'artifact', 'open', 'reopen', 'kids', 'remote-ai', 'dry-run', 'verify', 'maps', 'profile', 'hands-on', 'automatic', 'unlock', 'confirm', 'no-library', 'no-validate', 'rigged', 'no-rig', 'supporter', 'managed', 'live', 'manual', 'renew', 'send', 'accept-tos', 'quiet', 'no-local-ai', 'timestamps', 'overwrite', 'own-route', 'before', 'release', 'device'];
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split(/=(.*)/s, 2);
    if (v !== undefined) flags.set(k, v);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && !BOOL_FLAGS.includes(k)) flags.set(k, argv[++i]);
    else flags.set(k, true);
  } else positional.push(a);
}
const asJson = flags.has('json');
const log = asJson ? () => {} : (line) => process.stderr.write(`${line}\n`);

function print(result) {
  if (asJson) { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return; }
  // A standalone plan or build says every target, built or not, and what a standalone copy does not have.
  if (/^standalone( |$)/.test(String(result.command ?? ''))) { process.stdout.write(`${standaloneLines(result).join('\n')}\n`); return; }
  // A check that found problems still prints them (its rows say what to fix), never a bare "failed".
  if (result.ok === false && result.command !== 'port check' && !(result.command === 'look' && result.rows) && !(result.command === 'assets check' && result.rows) && !(result.command === 'parts check' && result.rows) && !(result.command === 'shoot' && result.frames !== undefined)) { process.stdout.write(`homie-studio: ${result.why ?? 'failed'}${result.instead ? `\n${result.instead}` : ''}\n`); return; }
  if (result.ok === false && result.command === 'port check' && !result.rows) { process.stdout.write(`homie-studio: ${result.why ?? 'failed'}\n`); return; }
  const lines = [];
  if (/^parts /.test(String(result.command ?? ''))) { process.stdout.write(`${partsLines(result).join('\n')}\n`); return; }
  if (/^(style|assets|cast|anim)( |$)/.test(String(result.command ?? ''))) { process.stdout.write(`${artLines(result).join('\n')}\n`); return; }
  if (/^collision /.test(String(result.command ?? '')) && result.lines) { process.stdout.write(`${result.lines.join('\n')}\n`); return; }
  switch (result.command) {
    case 'new':
      lines.push(`${result.name} is a studio now: ${result.dir}`, '', 'Wrote:', ...result.wrote.map((f) => `  ${f}`), '', `Dependencies: ${result.installed}`, '', 'Next:', ...result.next.map((n) => `  ${n}`), '', result.online);
      break;
    case 'game new':
      lines.push(`games/${result.id} is a new game from the ${result.from} starter. Change it in games/${result.id}/src/, then: npx homie-studio dev`);
      if (result.installNeeded) lines.push(`It needs ${result.needsAdded.map((n) => `${n.name} ${n.version}`).join(', ')}, now in the studio's package.json: run npm install first.`);
      for (const h of result.needsHeld ?? []) lines.push(`It was written against ${h.name} ${h.want}; this studio pins ${h.have}, which stays.`);
      if (result.models) {
        const m = result.models;
        lines.push(`Models: ${m.fetched} from the starter library (${m.from}) into games/${result.id}/public/models/, each checked by SHA-256.`);
        if (m.missing.length) lines.push(`  ${m.missing.length} not here${m.why ? ` (${m.why})` : `: ${m.missing.map((x) => `${x.asset} (${x.why})`).join(', ')}`}. The game draws stand-ins for them; once the library is reachable, homie-studio assets add ${result.id} <item> --as <asset> brings each in (assets/manifest.json names them).`);
      }
      break;
    case 'dev stop':
      lines.push(result.stopped.length ? `Stopped this studio's dev server (${result.stopped.join(', ')}).${result.why ? ` Note: ${result.why}.` : ''}` : `Nothing to stop: ${result.why ?? 'no dev server of this studio is running'}.`);
      break;
    case 'build':
      lines.push(`Built ${result.games.map((g) => `${g.id} (${Math.round(g.bytes / 1024)} KB)`).join(', ') || 'no games'} into ${relative(process.cwd(), result.dist) || result.dist}`);
      // Per game: did it change since the build before, which build it is (the hash the live site's manifest says once
      // deployed), and what loads later.
      for (const g of result.games) lines.push(`  ${g.id}: ${g.changed ?? 'new'}, build ${g.hash ?? '?'}${g.bundle ? ` (${g.bundle}${g.chunks ? ` + ${g.chunks} additional ${g.chunks === 1 ? 'chunk' : 'chunks'}` : ''})` : ''}`);
      if (result.retired) lines.push(`Note: ${result.retired}`);
      if (result.types) lines.push(`Types: ${result.types.games.filter((g) => g.checked).map((g) => g.id).join(', ') || 'no game has TypeScript to check'}${result.types.games.some((g) => g.checked) ? ` checked with TypeScript ${result.types.typescript ?? '?'}, no errors` : ''}`);
      if (result.songs?.length || result.videos?.length) lines.push(`Media pages: ${[...result.songs.map((x) => `/music/${x}/`), ...result.videos.map((x) => `/videos/${x}/`)].join(', ')}`);
      for (const l of result.landings ?? []) {
        lines.push(`Landing /${l.id}/: hero from ${l.hero === 'footage' ? 'its footage' : l.hero === 'art' ? 'its art (moving)' : 'the studio\'s colours (it has no picture or footage yet)'}${l.credits ? ', credits' : ''}`);
        // Which files, and what shape: the names the landing looks for (lib/site.mjs HERO_NAMES). Any size is shown,
        // cropped to fill; these are the sizes that fill a computer and an upright phone without waste.
        if (l.hero === 'colours') lines.push(`  give it one: games/${l.id}/hero/wide.jpg (16:9, 1280×720 or larger) and games/${l.id}/hero/tall.jpg (9:16, 720×1280, for an upright phone); footage beside them as hero/wide.mp4 and hero/tall.mp4 (the same shapes, a silent loop of 8 to 15 s, under 3 MB each); or "cover" in its game.json`);
      }
      if (result.posts?.length) lines.push(`Posts: ${result.posts.map((x) => `/posts/${x}/`).join(', ')} (feeds: /posts/feed.xml, /posts/feed.json)`);
      if (result.pages?.length || result.partials?.length) lines.push(`The studio's own: ${[...(result.pages ?? []).map((x) => `page ${x}`), ...(result.partials ?? []).map((x) => `partial ${x}`)].join(', ')}`);
      for (const m of result.mediaSkipped ?? []) lines.push(`  left out: ${m.kind}/${m.item}${m.file ? ` ${m.file}` : ''}: ${m.why}`);
      for (const m of result.postsSkipped ?? []) lines.push(`  left out: posts/${m.post}: ${m.why}`);
      for (const m of result.siteSkipped ?? []) lines.push(`  left out: ${m.what}: ${m.why}`);
      if (result.codexes?.length) lines.push(`Game Codex (the owner's private pages; codex link <id> opens one): ${result.codexes.map((x) => `/_studio/codex/${x}/`).join(', ')}`);
      break;
    case 'lab':
      lines.push(result.already ? `The Game Lab is running: ${result.url}` : `The Game Lab stopped (it was at ${result.url}).`);
      break;
    case 'lab stop':
      lines.push(result.stopped.length ? 'Stopped this studio\'s Game Lab.' : 'No Game Lab of this studio was running.', ...(result.removed.length ? [`Removed the checkouts Today was built from: ${result.removed.join(', ')}`] : []));
      break;
    case 'lab set':
      lines.push(result.changed.length ? `${result.file}: ${result.changed.map((c) => `${c.name} ${c.from} -> ${c.to}`).join(', ')}` : `${result.file}: nothing changed`);
      break;
    case 'lab check': {
      const det = (x) => (x === null ? 'same frames' : `DIFFERED from frame ${x}`);
      lines.push(`${result.game}: take "${result.take ?? '(none)'}", ${result.frames} frames at ${result.fps} fps`,
        `  New:   ${result.phases.new.join(' · ') || 'no phases'}; JavaScript ${result.cost.new?.mean} ms a frame (p95 ${result.cost.new?.p95}); replay: ${det(result.deterministic.new)}`,
        result.phases.today ? `  Today (${result.today}): ${result.phases.today.join(' · ') || 'no phases'}; JavaScript ${result.cost.today?.mean} ms a frame (p95 ${result.cost.today?.p95}); replay: ${det(result.deterministic.today)}` : `  Today: ${result.todayNote ?? 'none'}`,
        ...(result.software ? [`  Note: a software renderer (${result.renderer}): pictures are right, the JavaScript numbers are slow`] : []),
        ...result.errors.map((e) => `  error: ${e}`),
        `Report: ${result.report}`, `Pictures: ${result.sheet}, ${result.still}`);
      break;
    }
    case 'media list':
      for (const kind of ['music', 'videos']) {
        lines.push(`${kind}/manifest.json: ${result[kind].pages.length} page(s)`);
        for (const e of result[kind].pages) lines.push(`  /${kind}/${e.slug}/  ${e.title}  (${e.files.map((f) => `${f.role} from ${f.from === 'r2' ? 'R2' : f.from}`).join(', ')})`);
        for (const m of result[kind].skipped) lines.push(`  left out: ${m.item}${m.file ? ` ${m.file}` : ''}: ${m.why}`);
        for (const m of result[kind].notes ?? []) lines.push(`  note: ${m.item} ${m.file}: ${m.why}`);
      }
      if (result.moves.length) {
        lines.push('', `Big media${result.r2 ? ' for R2' : ''} (over ${result.over === null ? '(off)' : lineOf(result.over)}, or left out of git):`);
        for (const m of result.moves) lines.push(`  ${m.path}  ${m.bytes ? sizeOf(m.bytes) : ''}  ${m.state === 'too-big' ? m.why : m.reason ?? ''}`);
      }
      if (result.storage) lines.push('', result.storage);
      if (result.r2) lines.push(`R2 holds about ${sizeOf(result.inR2)} of this studio's media once these are in. ${result.cost}`);
      break;
    case 'media move': {
      const verb = result.dryRun ? 'Would move' : 'Moved';
      if (result.ok === false && result.needs === 'storage') { lines.push(result.why); break; }
      if (result.off) { lines.push(result.why); break; }
      const todo = result.rows.filter((r) => r.state === 'move');
      if (result.dryRun) lines.push(todo.length ? `${verb} ${todo.length} file(s) to R2 ${result.bucket}:` : 'Nothing to move: every big file is in R2 already, or none is published.', ...todo.map((r) => `  ${r.path}  ${sizeOf(r.bytes)}  (${r.reason})`));
      else lines.push(result.moved.length ? `${verb} ${result.moved.length} file(s) to R2 ${result.bucket}, each read back and checked by SHA-256:` : 'Nothing moved.', ...result.moved.map((m) => `  ${m.path}  ${sizeOf(m.bytes)}  -> served at ${m.url} (the same address)`));
      for (const f of result.failed ?? []) lines.push(`  NOT moved: ${f.path}: ${f.why}`);
      for (const v of result.verified ?? []) lines.push(`  ${v.ok ? 'verified' : 'MISMATCH'}: ${v.path}${v.why ? `: ${v.why}` : ''}`);
      for (const r of result.rows.filter((x) => x.state === 'too-big' || x.state === 'unlisted' || x.state === 'missing')) lines.push(`  ${r.state}: ${r.path}: ${r.why}`);
      if (result.next) lines.push('', result.next);
      lines.push(`R2 holds about ${sizeOf(result.inR2)} of this studio's media. ${result.cost}`, ...(result.warning ? [`Warning: ${result.warning}`] : []));
      break;
    }
    case 'function new':
    case 'tool new':
      lines.push(result.file, result.next);
      break;
    case 'function fire':
    case 'tool call':
    case 'tool list':
      lines.push(JSON.stringify(result.result, null, 2));
      break;
    case 'deploy':
      if (result.mcp) lines.push(`Connect your AI: ${result.mcp} (approve in your studio's browser page; no key)`);
      if (result.ci) {
        lines.push(`Live: ${result.url ?? '(Wrangler printed no address)'}${result.commit ? ` (commit ${result.commit.slice(0, 7)}${result.branch ? ` on ${result.branch}` : ''})` : ''}`, ...result.steps.map((x) => `  ${x.what}`), ...result.games.map((g) => `  ${g.id}: ${g.play}${g.hash ? `  [${deployWords(g)}]` : ''}`));
        break;
      }
      lines.push(`Live: ${result.url}`, ...(result.workersDev && result.workersDev !== result.url ? [`  also at ${result.workersDev}`] : []),
        ...(result.local ? [`  (the workers.dev address names your Cloudflare account, so it is kept in ${result.local} on this computer, never in studio.json)`] : []),
        // Which games this deploy changed since the last deploy from here, and each one's build hash
        // (lib/deploy-state.mjs): the hash `build` printed and the one the live site's manifest answers with.
        ...result.games.map((g) => `  ${g.id}: ${g.play}${g.hash ? `  [${deployWords(g)}]` : ''}`), ...(result.removed?.length ? [`  no longer on the site: ${result.removed.join(', ')}`] : []), ...(result.notes ?? []).map((n) => `  Note: ${n}`), ...(result.songs ?? []).map((m) => `  song ${m.slug}: ${m.page}`), ...(result.videos ?? []).map((m) => `  video ${m.slug}: ${m.page}`),
        ...(result.media?.moved ?? []).map((m) => `  moved to R2 (checked by SHA-256): ${m.path}, still at ${m.url}`), ...(result.media?.failed ?? []).map((m) => `  not moved to R2: ${m.path}: ${m.why}`), '', `Cloudflare: Worker ${result.worker}, D1 ${result.d1}, Durable Objects Table + Lobby${result.r2 ? `, R2 ${result.r2}` : ' (no storage: none needed; `homie-studio storage add` adds it for large media)'}. All on the free Workers plan${result.r2 ? ' plus R2' : ''}.`,
        result.claim ? 'The site claimed itself in the directory: list the games with the Homie MCP tool studio_publish, or: npx --no-install homie-studio publish' : 'No directory claim yet (the site claims itself when the directory first reads it; publish does).',
        ...(result.standalone?.length ? ['', ...result.standalone] : []));
      break;
    case 'deploy plan':
      lines.push(`What \`npm run deploy\` does for ${result.studio}, on the Cloudflare account the person approves:`, '',
        ...result.cloudflare.map((r) => `  ${r.kind}${r.name ? ` ${r.name}` : ''}: ${r.what} [${r.state}${r.plan ? `; ${r.plan}` : ''}]`), '',
        `Cost: ${result.cost}`, `Sign-in: ${result.login}`, `Address: ${result.address}`,
        `The directory (${result.directory.site}) stores: ${result.directory.stores}`, result.never,
        ...(result.zone?.warning ? ['', `Warning: ${result.zone.warning}`] : result.zone?.why ? ['', result.zone.why] : []),
        ...(result.parts && partsPlanLines(result.parts).length ? ['', ...partsPlanLines(result.parts)] : []),
        ...(result.standalone?.length ? ['', ...result.standalone] : []));
      break;
    case 'storage add':
      lines.push(result.already ? `Storage is already added: R2 bucket ${result.bucket}.` : `Storage added: R2 bucket ${result.bucket}.`, 'Next:', ...result.next.map((n) => `  ${n}`));
      break;
    case 'publish before':
      lines.push(...result.lines);
      break;
    case 'publish':
      lines.push(`Listed in the directory: ${result.studioPage ?? result.directory}`, ...(result.games ?? []).map((g) => `  ${g.name}: ${g.play}`), ...(result.publishes?.line ? [result.publishes.line] : []),
        // The parts in what was listed, in the deploy plan's own lines (lib/parts-build.mjs).
        ...(result.parts && partsPlanLines(result.parts, { at: 'publish' }).length ? ['', ...partsPlanLines(result.parts, { at: 'publish' })] : []));
      break;
    case 'port plan': {
      const f = result.facts;
      lines.push(`Port plan for ${result.folder}`, '', `Difficulty: ${result.grade.toUpperCase()}`, ...result.reasons.map((r) => `  - ${r}`), '',
        `What it is: ${f.engine.join(', ')}; ${f.loc} lines of game code in ${f.files} files (${Math.round(f.bytes / 1024)} KB); ${f.turnBased ? 'turn-based / moves on input' : 'real time'}${f.physics.length ? `; physics: ${f.physics.join(', ')}` : ''}.`,
        `Input: keys ${f.input.keys}, mouse ${f.input.mouse}, touch ${f.input.touch}, pointer ${f.input.pointer}${f.input.pointerLock ? ', pointer lock' : ''}.`,
        `Recommended: movement "${result.recommend.movement}", check view "${result.recommend.view}", build "${result.recommend.build}".`,
        `Licence: ${result.licence.kind}${result.licence.file ? ` (${result.licence.file})` : ''}.`, '', 'Risks:', ...(result.risks.length ? result.risks.map((r) => `  - ${r}`) : ['  - none found by reading; the checks will say']));
      break;
    }
    case 'port import':
      lines.push(`games/${result.id} is a port of ${result.from} (${result.files} files, build "${result.mode}", draft grade ${result.plan.grade}).`, ...result.edits.map((e) => `  ${e}`), '', 'Next:', ...result.next.map((n) => `  - ${n}`));
      break;
    case 'port check':
      lines.push(`${result.ok ? 'PASS' : 'NOT YET'}: ${result.game} at ${result.url} (${Math.round(result.totalMs / 1000)} s)`,
        ...result.passed.map((p) => `  ok    ${p}`), ...result.failed.map((f) => `  FAIL  ${f}`), ...result.skipped.map((f) => `  skip  ${f}`), '', `Receipt and screenshots: ${result.out}`);
      break;
    case 'stats': {
      const t = result.totals;
      const n = (x) => Number(x || 0).toLocaleString('en-US');
      lines.push(`${result.studio ?? 'Studio'}: ${result.range.from} to ${result.range.to} (UTC)${result.only ? `, ${result.only.kind} ${result.only.id}` : ''}`,
        `  ${n(t.visits)} visits · ${n(t.plays)} Play presses · ${n(t.rooms)} rooms opened · ${n(t.rounds)} rounds finished (${n(t.roundsWithPeople)} with people, ${n(t.peopleInRounds)} people in them)`,
        `  most playing at once: ${n(t.peakPlayers)} (${n(t.peakInOneRoom)} in one room) · playing now: ${n(t.playingNow)} · songs played: ${n(t.songPlays)} · videos watched: ${n(t.videoViews)}`,
        `  came from homie.rocks: ${n(result.crossings.fromHub)} · other studios: ${n(result.crossings.fromStudios)} · search: ${n(result.crossings.fromSearch)} · the web: ${n(result.crossings.fromWeb)} · ?via= links: ${n(result.crossings.fromLinks)}`);
      for (const g of result.games) lines.push(`  game ${g.id}: ${n(g.visits)} visits, ${n(g.plays)} plays, ${n(g.rooms)} rooms, ${n(g.rounds)} rounds, peak ${n(g.peakPlayers)}, now ${n(g.playingNow)}`);
      for (const e of result.songs) lines.push(`  song ${e.slug}: ${n(e.visits)} page visits, played ${n(e.plays)}`);
      for (const e of result.videos) lines.push(`  video ${e.slug}: ${n(e.visits)} page visits, watched ${n(e.views)}`);
      for (const r of result.referrers.slice(0, 10)) lines.push(`  from ${r.from} (${r.kind}): ${n(r.visits)} visits, ${n(r.plays)} plays`);
      if (result.players) lines.push(`  players: ${n(result.players.accounts)} accounts (${n(result.players.newAccounts7d)} new this week), ${n(result.players.guests)} guests with saves, ${n(result.players.active7d)} played this week`);
      break;
    }
    case 'players': {
      const p = result.players;
      lines.push(`${p.accounts} player accounts (${p.newAccounts7d} new this week), ${p.guests} guests with saves, ${p.active7d} played this week.`, result.note);
      break;
    }
    case 'players owner':
      lines.push(result.revoked ? result.message : `One-time link (until ${result.expiresAt}): ${result.link}`, ...(result.revoked ? [] : [result.use]));
      break;
    case 'stats key':
      lines.push(`Read key (until ${result.expiresAt}): ${result.key}`, result.use);
      break;
    case 'stats link':
      lines.push(`One-time link (until ${result.expiresAt}): ${result.link}`, result.use);
      break;
    case 'stats revoke':
    case 'stats share':
      lines.push(result.message);
      break;
    case 'office':
      lines.push(...officeLines(result));
      break;
    case 'office link':
      lines.push(`One-time link (until ${result.expiresAt}): ${result.link}`, result.use);
      break;
    case 'office key':
      lines.push(`Office key (until ${result.expiresAt}): ${result.key}`, result.use);
      break;
    case 'office announce':
    case 'office revoke':
      lines.push(result.message);
      break;
    case 'office invite':
      for (const i of result.invites) lines.push(`Invite ${i.code}${i.label ? ` (${i.label})` : ''}, ${i.maxUses ? `${i.maxUses} use${i.maxUses === 1 ? '' : 's'}` : 'any number of uses'}: ${i.link}`);
      if (result.note) lines.push(result.note);
      break;
    case 'servers':
      lines.push(...serversLines(result));
      break;
    case 'chat':
      lines.push(...chatLines(result));
      break;
    case 'chat words':
      for (const [k, v] of Object.entries(result.groups)) lines.push(`${k}: ${v.join(', ')}`);
      lines.push(result.note);
      break;
    case 'chat remove':
    case 'lounge night':
    case 'lounge remove':
      lines.push(result.message);
      break;
    case 'lounge':
      lines.push(...loungeLines(result));
      break;
    case 'shop':
    case 'shop orders':
    case 'shop check':
    case 'shop init':
    case 'shop statements':
    case 'shop connect':
    case 'shop disconnect':
      lines.push(...shopLines(result));
      break;
    case 'shop catalog':
      lines.push(...catalogLines(result));
      break;
    case 'setup':
      lines.push(...projectsLines(result));
      break;
    case 'chat rules':
    case 'chat budget':
    case 'lounge rules':
    case 'lounge mod':
    case 'shop refund':
      lines.push(result.asked ? `Asked: ${result.what}` : result.message, ...(result.asked ? [`Owner's one-tap link (until the ask ends, 15 min): ${result.link}`, result.use] : []));
      break;
    case 'servers new':
      lines.push(result.message, ...(result.notes ?? []).map((n) => `  ${n}`));
      break;
    case 'servers level':
    case 'agents revoke':
    case 'agents brain key':
      lines.push(result.message);
      break;
    case 'agents sit':
      lines.push(`Left ${result.room}.`);
      break;
    case 'agents pass':
      lines.push(`${result.pass.name} (pass ${result.pass.id}, ${result.pass.role}, hands ${result.pass.hands}${result.pass.server ? `, ${result.pass.server} only` : ''}):`, `  ${result.secret}`, result.use);
      break;
    case 'agents passes':
      for (const p of result.passes) lines.push(`${p.id}  ${p.name}  ${p.role}, hands ${p.hands}${p.game ? `, ${p.game}` : ''}${p.server ? `/${p.server}` : ''}${p.live ? '' : p.revoked ? '  (revoked)' : '  (ended)'}`);
      if (!result.passes.length) lines.push('No agent passes yet: homie-studio agents pass <game> --label "<Name>"');
      break;
    case 'servers set':
    case 'servers close':
    case 'servers member':
    case 'agents brain':
    case 'office launch':
    case 'office kick':
    case 'office mute':
    case 'office close':
      lines.push(result.asked ? `Asked: ${result.what}` : result.message, ...(result.asked ? [`Owner's one-tap link (until the ask ends, 15 min): ${result.link}`, result.use] : []));
      break;
    case 'setup status':
      lines.push(formatStatus(result));
      break;
    case 'demo':
      lines.push(formatDemo(result));
      break;
    case 'handoff':
      lines.push(formatHandoff(result));
      break;
    case 'codex':
      lines.push(`The Game Codex for ${result.title}: ${result.file}${result.opened ? ' (opened in the browser)' : ''}`,
        `  tabs: ${result.sections.map((x) => x.title).join(' · ')} · Build status${result.build ? ` (${result.build.state}, ${result.build.percent}%)` : ''}`,
        ...(result.missing.length ? [`  not decided yet: ${result.missing.join(', ')}`] : ['  every section has something in it']),
        `  open questions: ${result.openQuestions}`,
        ...result.warnings.map((w) => `  warning: ${w}`),
        result.mode === 'artifact' ? '  publish this file as an artifact where your app can (Claude: the Artifact tool); it is one self-contained page' : '  on the site, for the owner only, after the next deploy: npx --no-install homie-studio codex link ' + result.id);
      break;
    case 'codex new':
      lines.push(`Wrote ${result.file}.`, ...result.next.map((n) => `  next: ${n}`));
      break;
    case 'codex link':
      lines.push(`One-time link (until ${result.expiresAt}): ${result.link}`, result.use);
      break;
    case 'statusline install':
    case 'statusline remove':
      lines.push(result.message);
      break;
    case 'setup attach':
      lines.push(result.message, ...(result.site ? [`  live site: ${result.site}`] : []), ...(result.renamed?.length ? ['  changed (commit these on a branch):', ...result.renamed.map((f) => `    ${f}`)] : []), ...(result.next ?? []).map((n) => `  next: ${n}`));
      break;
    case 'progress attach':
    case 'progress start':
      lines.push(`Build ${result.build}: ${result.title} (${result.stages.join(' → ')})${result.budget !== null ? `, budget ${result.unit === 'usd' ? `$${result.budget.toFixed(2)}` : `${result.budget} credits`}` : ''}`,
        `  feed: ${result.file}`,
        ...(result.shared ? [`  shared for the Claude app until ${result.shared.expiresAt ?? 'tomorrow'}: ${result.widget}`] : []),
        ...(result.sharedWhy ? [`  ${result.sharedWhy}`] : []),
        '  build, check, port check and deploy now report into it; mark the plan done with: npx --no-install homie-studio progress stage plan done --note "<the plan in one line>"');
      break;
    case 'progress':
      lines.push(result.message ?? `${result.feed?.title}: ${result.feed?.state}${result.feed?.stage ? ` (${result.feed.stage})` : ''}`);
      break;
    case 'progress show': {
      const f = result.feed;
      const mark = { done: 'ok  ', pass: 'ok  ', running: '... ', failed: 'FAIL', fail: 'FAIL', skipped: 'skip', skip: 'skip', stopped: 'stop', pending: '    ' };
      lines.push(`${f.title} [${f.state}] build ${f.build}${f.shared ? ` (shared as ${f.shared.build})` : ''}`,
        ...f.stages.map((s) => `  ${mark[s.state] ?? s.state} ${s.label}${s.note ? `: ${s.note}` : ''}`),
        ...f.checks.map((c) => `      ${mark[c.state] ?? c.state} ${c.label}${c.note ? `: ${c.note}` : ''}`),
        ...(f.preview?.url ? [`  preview: ${f.preview.url}`] : []),
        `  spent ${f.spend.unit === 'usd' ? `$${f.spend.used.toFixed(2)}` : `${f.spend.used} credits`}${f.spend.budget !== null ? ` of ${f.spend.unit === 'usd' ? `$${f.spend.budget.toFixed(2)}` : `${f.spend.budget} credits`}` : ''}`,
        ...(f.stop?.requested ? [`  stop asked (${f.stop.by}) at ${f.stop.at}`] : []));
      break;
    }
    case 'look':
      lines.push(`${result.ok ? 'Looks right' : 'Look again'}: ${result.rows.length} views of ${result.url}`, ...result.rows.map((r) => `  ${r.ok ? 'ok  ' : 'FIX '} ${r.path} on ${({ computer: 'a computer', phone: 'a phone', sideways: 'a phone turned sideways' })[r.device] ?? r.device}${r.problems.length ? `: ${r.problems.join('; ')}` : ''}`), '', `Pictures (open them and look): ${result.shots}`);
      break;
    case 'upgrade': {
      const show = (text, n = 14) => { const l = String(text ?? '').replace(/\n+$/, '').split('\n'); return [...l.slice(0, n).map((x) => `      ${x}`), ...(l.length > n ? [`      … (${l.length - n} more lines; --json has all of it)`] : [])]; };
      const mark = { 'add-file': '+', 'add-section': '+', 'add-lines': '+', scripts: '+', 'update-file': '~', 'update-section': '~', pin: '~', version: '~' };
      const list = result.applied ? result.done : result.changes;
      lines.push(result.applied
        ? `${result.studio} is on the @homie-rocks/studio ${result.to} template now (${list.length} change${list.length === 1 ? '' : 's'}).`
        : list.length ? `${result.studio}: what the @homie-rocks/studio ${result.to} template adds (from ${result.from ?? 'an older version'}). Nothing is changed until --apply.` : `${result.studio} has everything the @homie-rocks/studio ${result.to} template writes.`);
      // What the versions since the studio's own brought, from this package's CHANGELOG.md (also after --apply).
      if (result.whatsNew) lines.push('', ...whatsNewLines(result.whatsNew, { source: `@homie-rocks/studio ${result.to}'s CHANGELOG.md` }));
      if (list.length) lines.push('', result.applied ? 'Done:' : 'The changes:');
      for (const c of list) {
        lines.push(`  ${mark[c.kind] ?? '·'} ${c.file.padEnd(18)} ${c.what}${c.kind === 'add-section' && (c.after || c.before) ? ` (${c.after ? `after "${c.after}"` : `before "${c.before}"`})` : ''}`);
        if (result.applied) continue;
        if (c.kind === 'add-section' || (c.kind === 'add-file' && c.file.endsWith('.md'))) lines.push(...show(c.text));
        if (c.kind === 'update-section' || c.kind === 'update-file') lines.push(...lineDiff(c.from, c.text).map((x) => `      ${x}`));
      }
      for (const c of result.skipped ?? []) lines.push(`  ! ${c.file.padEnd(18)} not applied: ${c.why}`);
      if (result.kept?.length) {
        lines.push('', 'Kept as this studio wrote them (never changed by upgrade; the template\'s text differs):');
        for (const k of result.kept) {
          lines.push(`  = ${k.file.padEnd(18)} ${k.what}`);
          if (flags.has('diff') && k.mine !== undefined) lines.push(...lineDiff(k.mine, k.template).map((x) => `      ${x}`));
        }
        if (!flags.has('diff')) lines.push('  (--diff shows how each differs from the template: "-" this studio\'s lines, "+" the template\'s)');
      }
      if (result.uncommitted && !result.applied && result.changes.length) lines.push('', `Note: ${result.uncommitted} file(s) have uncommitted changes; commit them first so the upgrade is a change of its own.`);
      if (result.media) {
        lines.push('', `Big media (songs and videos over ${result.media.over === null ? '(off)' : lineOf(result.media.over)}, or left out of git):`);
        for (const r of result.media.inR2) lines.push(`  = ${r.path}  in R2`);
        for (const r of result.media.big) lines.push(`  > ${r.path}  ${r.bytes ? sizeOf(r.bytes) : ''}  ${r.state === 'too-big' ? r.why : r.reason ?? ''}`);
        if (result.media.next) lines.push(`  ${result.media.next}`);
      }
      if (result.next?.length) lines.push('', 'Next:', ...result.next.map((n) => `  ${n}`));
      break;
    }
    case 'chrome':
    case 'chrome install':
      lines.push(result.already || result.command === 'chrome' ? `Chrome: ${result.chrome}` : `Installed Chrome for Testing ${result.buildId}: ${result.chrome}`);
      break;
    case 'perf':
      lines.push(`Measured ${result.game}: ${result.runs.length} run(s), in ${result.out}`, ...result.headline.map((l) => `  ${l}`),
        ...(result.blocked ? [`  ${result.blocked}`] : []), ...(result.loaded ? [`  ${result.loaded}`] : []),
        `Each run: ${result.out}/<device>-<n>.json (and its screenshots); medians: ${result.summary}${result.sizes ? `; sizes: ${result.sizes}` : ''}`,
        ...(result.profiles?.length ? [`CPU profiles (Chrome DevTools opens them; the hottest functions are in each run's JSON): ${result.profiles.join(', ')}`] : []));
      break;
    case 'perf sizes': {
      const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
      lines.push(`${result.game}: ${result.total.files} files, ${kb(result.total.bytes)} (${kb(result.total.gzip)} gzipped); JavaScript ${kb(result.js.bytes)} (${kb(result.js.gzip)} gzipped)`,
        'Biggest:', ...result.biggest.slice(0, 8).map((f) => `  ${kb(f.bytes).padStart(10)}  ${f.path}${f.gzip !== f.bytes ? `  (${kb(f.gzip)} gzipped)` : ''}${f.code ? `  ${f.code.minified ? `minified${f.code.shaderPct >= 5 ? `, ${f.code.shaderPct}% GLSL shader source in strings` : ''}` : 'NOT minified'}` : ''}`),
        ...(result.modules ? ['Bundle modules:', ...result.modules.top.slice(0, 8).map((m) => `  ${kb(m.bytes).padStart(10)}  ${m.module}`)] : []),
        ...(result.apart ? [`Not loaded by the game: ${result.apart.files} file(s), ${kb(result.apart.bytes)} (${result.apart.note})`] : []));
      break;
    }
    case 'perf compare':
      lines.push(`${result.verdict.toUpperCase()}: ${result.why}`,
        ...result.guards.filter((g) => g.verdict !== 'same').map((g) => `  ${g.verdict} ${g.metric}: ${g.why}`),
        ...(result.left.before + result.left.after ? [`  left out: ${result.left.before} run(s) before, ${result.left.after} after (blocked or started on a busy computer)`] : []),
        `Written: ${result.file}`);
      break;
    case 'check':
      lines.push(`PASS: two fresh browsers in room ${result.room} finished round ${result.round.n} (${result.round.humans} humans, ${result.round.bots} bots) in ${Math.round(result.totalMs / 1000)} s.`,
        ...result.seats.map((s) => `  ${s.browser}: seat ${s.seat} (${s.role}), seated in ${(s.seatedMs / 1000).toFixed(1)} s`),
        ...(result.frames ?? []).map((f) => `  ${f.browser} drew ${f.fps ?? '?'} fps${f.renderer ? ` on ${f.renderer}` : ''}`),
        // Seated, ready and connected are three things: each gets its own line beside the verdict.
        ...(result.readiness ?? []).map((r) => `  ${r.browser} ${r.ready === true ? `ready: the loading cover lifted${r.liftedMs !== null ? ` at ${(r.liftedMs / 1000).toFixed(1)} s` : ''}${r.by ? ` (by the ${r.by})` : ''}` : r.ready === false ? `NOT READY: ${r.why}` : `readiness unknown: ${r.why}`}`),
        `  Connection: ${result.uninterrupted === true ? 'uninterrupted' : result.uninterrupted === false ? 'INTERRUPTED' : 'unknown'} (${result.note ?? 'not reported'})`,
        ...(result.software ? [`  ${result.software}`] : []));
      break;
    case 'shoot':
      lines.push(`Shot ${result.frames} of ${result.asked} frames of ${result.game} at ${result.fps} a second of the game's own clock (${result.virtualSeconds} s of game time in ${result.realSeconds} s) into ${result.out}`,
        `  Smoke (two clients, one private room): ${result.smoke.verdict}${result.smoke.why ? `: ${result.smoke.why}` : ''}${result.smoke.note ? ` (${result.smoke.note})` : ''}`,
        ...(result.build ? [`  Build: ${result.build.hash} (${result.build.bundle}${result.build.loaded === true ? ', loaded by the page' : result.build.loaded === false ? ', NOT loaded by the page' : ''})`] : []),
        `  Ready: ${result.ready.ready === true ? 'the loading cover had lifted' : result.ready.ready === false ? `NO: ${result.ready.why}` : `unknown: ${result.ready.why}`}`,
        `  Renderer: ${result.renderer ?? 'unknown'}${result.software ? ' (software: these frames are still one step of the clock each, but slow to make)' : ''}`,
        ...(result.partial ? [`  PARTIAL: ${result.partial}`] : []), ...(result.note ? [`  ${result.note}`] : []),
        `  ${result.limits}`, `  Every frame's time, round and position: ${result.out}/shoot.json`);
      break;
    case 'trailer':
      lines.push(...trailerLines(result));
      break;
    default:
      lines.push(JSON.stringify(result, null, 2));
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

/*
 * A COMMAND THAT CHANGES SOMETHING OUTSIDE THIS COMPUTER NEVER RUNS WITH A FLAG IT DOES NOT KNOW. The parser above
 * keeps every `--word`, and a command reads the ones it knows: `publish --before` (a flag the MCP tool had and this
 * command did not) was read as plain `publish`, and listed the studio while its caller believed it was a preflight.
 * So each command below names every flag it takes, and anything else stops it before anything is sent: a typo, a
 * flag of another command, or one from a newer toolkit's notes. The key is the command and its sub-command, else
 * the command alone. Commands that only read, or only change files in this folder, are not in this table.
 */
const OUTWARD_FLAGS = {
  publish: ['homie', 'site', 'before'],
  deploy: ['plan', 'ci', 'homie', 'own-route'],
  'storage add': [],
  'media put': ['as'],
  'media move': ['dry-run', 'plan', 'verify'],
  'setup attach': ['homie', 'client'],
  handoff: ['homie', 'client'],
  'players owner': ['url', 'revoke'],
  'stats key': ['url', 'hours'], 'stats link': ['url'], 'stats revoke': ['url'], 'stats share': [],
  'office link': ['url', 'to'], 'office key': ['url', 'hours'], 'office announce': ['url', 'game', 'room', 'seconds'],
  'office invite': ['url', 'label', 'uses', 'count', 'days', 'server'], 'office launch': ['url', 'max'],
  'office kick': ['url', 'minutes'], 'office mute': ['url', 'minutes', 'off'], 'office close': ['url', 'minutes', 'reopen'], 'office revoke': ['url'],
  'lounge mod': ['url', 'remove'], 'lounge remove': ['url', 'all'],
  'chat remove': ['url', 'all'], 'chat budget': ['url'],
  'servers close': ['url', 'reopen'], 'servers level': ['url'], 'servers member': ['url', 'role', 'remove'],
  'parts reissue': ['claim-hash', 'receipt-verified', 'buyer'], 'parts retire': [], 'parts keys': [], 'parts refund': ['game'],
  'shop connect': ['url', 'managed', 'live', 'manual', 'renew', 'from-clipboard'], 'shop disconnect': ['url'], 'shop refund': ['url', 'reason', 'note', 'manual-transaction'], 'shop statements': ['url', 'period', 'send', 'cursor'],
  'agents pass': ['url', 'label', 'server', 'hands', 'role', 'days'], 'agents revoke': ['url'], 'agents brain': ['url', 'budget', 'remove'],
  'agents sit': ['url', 'server', 'pass', 'label', 'brain'],
  'function new': ['event'], 'function fire': ['url','input','id'],
  'tool new': ['app'], 'tool call': ['url', 'input', 'public'], 'tool list': ['url', 'public'],
  // With --device it adds a phone to the person's Apple team and installs on it: a flag it does not know stops it.
  'standalone run': ['for', 'device', 'site'],
};
/** Every command takes these: how it answers, never what it does. */
const ANY_COMMAND = ['json', 'help', 'version'];

/** The refusal for a flag an outward-writing command does not take, or null. Nothing has run when this is asked. */
function unknownFlags(words, given) {
  const [cmd, sub] = words;
  const key = sub !== undefined && OUTWARD_FLAGS[`${cmd} ${sub}`] ? `${cmd} ${sub}` : OUTWARD_FLAGS[cmd] ? cmd : null;
  if (!key) return null;
  const takes = OUTWARD_FLAGS[key];
  const strange = [...given.keys()].filter((k) => !takes.includes(k) && !ANY_COMMAND.includes(k));
  if (!strange.length) return null;
  const named = strange.map((k) => `--${k}`).join(', ');
  return {
    ok: false, command: key, needs: 'flag', flags: strange, takes: takes.map((k) => `--${k}`),
    why: `homie-studio ${key} does not take ${named}, so it did not run: nothing was sent or changed. It changes something outside this computer, and a flag it does not know is never guessed at. It takes: ${takes.length ? takes.map((k) => `--${k}`).join(', ') : 'no flags of its own'} (and --json).`,
  };
}

async function main() {
  const [cmd, sub] = positional;
  if (!cmd || cmd === 'help' || flags.has('help')) {
    const text = readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].split('\n').slice(1).map((l) => l.replace(/^ \* ?/, '')).join('\n');
    process.stdout.write(`homie-studio ${STUDIO_VERSION}\n${text}\n`);
    return { ok: true, command: 'help' };
  }
  if (cmd === 'version' || flags.has('version')) return { ok: true, command: 'version', version: STUDIO_VERSION };
  const strange = unknownFlags(positional, flags);
  if (strange) return strange;
  if (cmd === 'new') return newStudio(positional[1], { name: flags.get('name'), homie: flags.get('homie'), slug: flags.get('slug'), install: !flags.has('no-install'), template: flags.has('template') });
  if (cmd === 'starters') return { ok: true, command: 'starters', starters: starters() };
  // The floor's built-in words need no studio: anyone can read what a studio's chat always holds.
  if (cmd === 'chat' && sub === 'words') return chatWords();
  if (cmd === 'demo') return demoGames();
  if (cmd === 'mcp') {
    // stdout carries MCP messages only from here on (lib/mcp.mjs); every word for a person goes to stderr.
    await serveMcp({ studios: flags.get('studios') ?? process.env.HOMIE_STUDIOS ?? null, skills: flags.get('skills') ?? process.env.HOMIE_SKILLS ?? null, install: !flags.has('no-install'), directory: flags.get('homie') ?? null });
    return { ok: true, command: 'help' };
  }

  if (cmd === 'port' && sub === 'plan') return planPort(positional[2] ?? '.');
  if (cmd === 'chrome' && sub === 'install') return installChrome({ log, fresh: flags.has('fresh') });
  if (cmd === 'chrome') { const chrome = findChrome(); return chrome ? { ok: true, command: 'chrome', chrome, args: chromeArgs() } : { ok: false, command: 'chrome', why: noChrome() }; }
  if (cmd === 'setup' && sub === 'prepare') return prepareNode();
  if ((cmd === 'setup' && sub === 'status') || cmd === 'doctor') return setupStatus({ connector: flags.get('connector') ?? null, homie: flags.get('homie') ?? null, client: flags.get('client') ?? null });
  if (cmd === 'statusline' && !flags.has('install') && !flags.has('remove')) {
    const line = statusLine({ columns: Number(process.env.COLUMNS) || 100, color: !process.env.NO_COLOR && !asJson && process.stdout.isTTY });
    if (asJson) return { ok: true, command: 'statusline', line };
    if (line) process.stdout.write(`${line}\n`);
    return { ok: true, command: 'help' };
  }
  if (cmd === 'perf' && sub === 'compare') {
    if (!positional[2] || !positional[3]) return { ok: false, command: 'perf compare', why: 'usage: homie-studio perf compare <before dir> <after dir> [--goal <metric>] [--min 3]' };
    return perfCompare(positional[2], positional[3], { goal: flags.has('goal') ? String(flags.get('goal')) : null, min: flags.has('min') ? Number(flags.get('min')) / 100 : 0.03, guards: flags.get('guards') ? String(flags.get('guards')).split(',').map((x) => x.trim()).filter(Boolean) : null, also: flags.get('also') ? String(flags.get('also')).split(',').map((x) => x.trim()).filter(Boolean) : [] });
  }
  // The starter library and the optimiser work anywhere; the rest of style and assets inside a studio (lib/art-cli.mjs).
  if (cmd === 'assets' && ['find', 'optimise', 'optimize'].includes(sub)) return assetsCommand(null, sub, positional, flags, { log });
  const root = requireStudio();
  if (cmd === 'function') return (await import('../lib/functions-cli.mjs')).functionCommand(root, sub, positional, flags, { log });
  if (cmd === 'tool') return (await import('../lib/tools-cli.mjs')).toolCommand(root, sub, positional, flags, { log });
  // A trailer is the plugin's video skill; this hands the words after the id over to it (lib/trailer.mjs).
  if (cmd === 'trailer') return trailerCommand(root, sub, argv.slice(argv.indexOf(sub) + 1), { skills: flags.get('skills') ?? null, slug: flags.get('slug') ?? null });
  if (cmd === 'style') return styleCommand(root, sub, positional, flags, { log });
  if (cmd === 'assets') return assetsCommand(root, sub, positional, flags, { log });
  if (cmd === 'anim') return animCommand(root, sub, positional, flags, { log });
  if (cmd === 'collision') return collisionCommand(root, sub, positional, flags);
  if (cmd === 'parts') return partsCommand(root, sub, positional, flags, { log });
  // A build takes minutes: its lines go to stderr even under --json (the result alone is on stdout), so a chat tool
  // that runs it as a job has last lines to show; and into the progress feed, when one is open.
  if (cmd === 'standalone') { const feed = currentFeed(root); return standaloneCommand(root, sub, positional, flags, { log: (line) => { process.stderr.write(`${line}\n`); try { feed?.log(String(line).slice(0, 200)); } catch { /* the feed is extra */ } } }); }
  if (cmd === 'cast') { const games = listGames(root); const id = sub ?? (games.length === 1 ? games[0].id : null); if (!id) return { ok: false, command: 'cast', why: `name the game: homie-studio cast <id>${games.length ? ` (${games.map((g) => g.id).join(', ')})` : ''}` }; return castView(root, id); }
  if (cmd === 'statusline') return installStatusLine(root, { remove: flags.has('remove'), replace: flags.has('replace'), project: flags.get('project') ?? null });
  if (cmd === 'codex') return codexCommand(root, sub);
  if (cmd === 'progress') return progressCommand(root, sub);
  if (cmd === 'domain') return studioDomain(root, sub);
  if (cmd === 'setup' && sub === 'attach') return setupAttach(root, positional[2], { homie: flags.get('homie'), client: flags.get('client') });
  if (cmd === 'setup' && flags.has('via')) {
    if (flags.get('via') !== 'stripe-projects') return { ok: false, command: 'setup', why: '--via stripe-projects is the one other way this version knows (the default is npx wrangler login)' };
    const extra = String(flags.get('with') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (extra.some((x) => x !== 'elevenlabs')) return { ok: false, command: 'setup', why: '--with takes elevenlabs (Cloudflare is always set up)' };
    return setupViaProjects(root, { withElevenlabs: extra.includes('elevenlabs'), acceptTos: flags.has('accept-tos'), dryRun: flags.has('dry-run'), log });
  }
  if (cmd === 'handoff') return handoff(root, sub, { homie: flags.get('homie'), client: flags.get('client') });
  if (cmd === 'port' && sub === 'import') return importPort(root, positional[2], flags.get('id'), { name: flags.get('name'), mode: flags.get('mode') });
  if (cmd === 'port' && sub === 'check') {
    const game = positional[2] ?? listGames(root)[0]?.id;
    const url = flags.get('url') ?? siteUrl(root);
    if (!url) return { ok: false, command: 'port check', why: 'give --url (the local dev address or the live site)' };
    return tracked(root, 'checks', (report) => portCheck({ url, game, root, only: flags.get('only') ?? null, shots: flags.get('shots') ? resolve(flags.get('shots')) : null, log, report }), 'port check');
  }
  if (cmd === 'app' && sub === 'role') {
    const { withKey } = await import('../lib/office.mjs');
    const id = positional[2]; const role = positional[3];
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id ?? '') || !/^[a-z][a-z0-9-]{0,39}$/.test(role ?? '')) throw new Error('app role <id> <role> [--player <account>] [--revoke] [--url <site>]');
    return withKey(root, flags.get('url'), (call) => call(`/${id}/api/app/roles`, { role, ...(flags.get('player') ? { player: flags.get('player') } : {}), revoke: flags.has('revoke') }));
  }
  if (cmd === 'app' && sub === 'new') return newApp(root, positional[2], { name: flags.get('name') });
  if (cmd === 'game' && sub === 'new') return newGame(root, positional[2], { from: flags.get('from') ?? 'gem-rush', name: flags.get('name') });
  // Remix was retired (a game is never handed over whole): the command is refused in a sentence that says where to
  // go, so an old note, an old card or an agent's memory of the toolkit does not end at "unknown command".
  if (cmd === 'game' && sub === 'remix') return { ok: false, command: 'game remix', why: 'remix was retired: a game is no longer handed over whole, and no studio serves one. Games build on each other through parts, the pieces of a game its studio chose to share: find one with `homie-studio parts find <words>` and bring it in with `homie-studio parts add` (in chat: parts_find, part_add; parts/PARTS.md)' };
  if (cmd === 'games') return { ok: true, command: 'games', games: listGames(root).map(({ dir, ...g }) => ({ ...g, dir: relative(root, dir) })) };
  if (cmd === 'build') return tracked(root, 'build', () => build(root, { only: positional[1] ?? null, log, maps: flags.has('maps'), types: flags.has('types'), longCheck: flags.has('long-check') }), 'build');
  if (cmd === 'preview') return preview(root, positional[1] ?? (listGames(root).length === 1 ? listGames(root)[0].id : null));
  if (cmd === 'perf' && sub === 'sizes') return perfSizes(root, positional[2] ?? listGames(root)[0]?.id);
  if (cmd === 'lab') return labCommand(root, sub);
  if (cmd === 'perf') {
    const game = sub ?? listGames(root)[0]?.id;
    const url = flags.get('url') ?? siteUrl(root);
    if (!url) return { ok: false, command: 'perf', why: 'give --url (the local dev address or the live site)' };
    const devices = String(flags.get('device') ?? 'computer,phone').split(',').map((d) => d.trim()).filter(Boolean);
    const num = (k, d, lo, hi) => Math.max(lo, Math.min(hi, Number(flags.get(k) ?? d) || d));
    return perfRun({ root, url, game, devices, runs: num('runs', 1, 1, 50), seconds: num('seconds', 15, 3, 300), warm: num('warm', 3, 0, 60), profile: flags.has('profile'), out: flags.get('out') ? resolve(String(flags.get('out'))) : null, maxLoad: num('max-load', 0.8, 0.05, 50), cpu: num('cpu', 4, 1, 20), pair: flags.get('pair') ? String(flags.get('pair')) : null, log });
  }
  if (cmd === 'status') {
    const studio = readStudio(root);
    return { ok: true, command: 'status', root, studio, site: siteUrl(root, studio), games: listGames(root).map((g) => g.id), cloudflareSignedIn: Boolean(wranglerBin(root) && whoami(root)) };
  }
  if (cmd === 'upgrade') {
    const plan = upgradePlan(root);
    return flags.has('apply') || flags.has('yes') ? upgradeApply(root, plan) : plan;
  }
  // lib/dev.mjs: the dev server, its registration file, and what `--stop` will and will not signal.
  if (cmd === 'dev' && flags.has('stop')) return stopDev(root);
  if (cmd === 'dev') return dev(root, { lan: flags.has('lan'), port: flags.get('port') ?? 8787, remoteAi: flags.has('remote-ai'), localAi: !flags.has('no-local-ai'), timestamps: flags.has('timestamps'), log });
  if (cmd === 'check') {
    const game = positional[1] ?? listGames(root)[0]?.id;
    const url = flags.get('url') ?? siteUrl(root);
    if (!url) return { ok: false, command: 'check', why: 'give --url (the local dev address or the live site)' };
    // A big binary committed under games/ fails the check before any browser starts: it belongs in R2, never in git.
    const { bigCommittedFiles } = await import('../lib/asset-check.mjs');
    const big = bigCommittedFiles(root).filter((f) => f.path.startsWith(`games/${game}/`));
    if (big.length) return { ok: false, command: 'check', why: `committed files over 5 MB under games/${game}: ${big.map((f) => `${f.path} (${(f.bytes / 1024 / 1024).toFixed(1)} MB)`).join(', ')}. Big media goes to the studio's R2 (homie-studio storage add, then media move); raw models stay in art/<slug>/raw/ (git-ignored); a shipped model is made phone-sized with homie-studio assets optimise. Take it out of git (git rm --cached), then check again.` };
    return tracked(root, 'checks', (report) => check({ url, game, shots: flags.get('shots') ? resolve(flags.get('shots')) : null, log, report }), 'check');
  }
  if (cmd === 'shoot') {
    const game = positional[1] ?? listGames(root)[0]?.id;
    // --preview: the frames half from the light preview server this command starts itself (no Wrangler, no rooms).
    const preview = flags.has('preview');
    const url = preview ? null : flags.get('url') ?? siteUrl(root);
    if (!url && !preview) return { ok: false, command: 'shoot', why: 'give --url (the local dev address or the live site), or --preview to shoot the built game by itself with no site running' };
    const { shoot } = await import('../lib/shoot.mjs');
    const num = (k, d) => (flags.get(k) === undefined || flags.get(k) === true ? d : Number(flags.get(k)));
    return shoot({
      url, preview, root, game, frames: num('frames', 60), fps: num('fps', 30), device: String(flags.get('device') ?? 'computer'),
      out: flags.get('out') && flags.get('out') !== true ? resolve(flags.get('out')) : join(root, '.studio', 'shoot', String(game)),
      smoke: !flags.has('no-smoke'), hold: typeof flags.get('hold') === 'string' ? flags.get('hold') : null, timeoutMs: Math.max(20, num('timeout', 180)) * 1000, log,
    });
  }
  if (cmd === 'look') {
    const url = flags.get('url') ?? siteUrl(root);
    if (!url) return { ok: false, command: 'look', why: 'give --url (the local dev address or the live site)' };
    let paths = positional.slice(1).map((p) => (p.startsWith('/') ? p : `/${p}`));
    if (!paths.length) {
      let cat = null;
      try { cat = JSON.parse(readFileSync(join(root, 'site', 'dist', 'games.json'), 'utf8')); } catch { /* not built */ }
      const games = cat?.games?.map((g) => g.id) ?? listGames(root).map((g) => g.id);
      paths = ['/', ...games.map((id) => `/${id}/`), ...(games.length ? ['/games/', '/rooms/'] : []), ...(cat?.posts?.length ? ['/posts/', `/posts/${cat.posts[0].slug}/`] : [])];
    }
    const only = flags.get('only') ? String(flags.get('only')).split(',').filter((d) => ['computer', 'phone', 'sideways'].includes(d)) : undefined;
    return look({ url, paths, shots: flags.get('shots') ? resolve(flags.get('shots')) : join(root, '.studio', 'look'), devices: only, log });
  }
  if (cmd === 'deploy' && flags.has('plan')) {
    // On a custom domain the plan also reads the domain's Worker routes (lib/routes.mjs): a read, nothing changes.
    const zone = await zonePlan(root);
    return { ...deployPlan(root), parts: partsPublishReport(root), ...(zone ? { zone } : {}), standalone: standaloneDeployNotes(root) };
  }
  // Cloudflare's Workers Builds runs `npm run deploy` with WORKERS_CI=1 (and its own token for this one account).
  if (cmd === 'deploy' && (process.env.WORKERS_CI === '1' || flags.has('ci'))) return tracked(root, 'deploy', () => ciDeploy(root, { log }), 'deploy');
  // What the deploy means for standalone copies already made (a changed netplay version), read before it runs.
  if (cmd === 'deploy') { const copies = standaloneDeployNotes(root); return tracked(root, 'deploy', async () => { const r = await deploy(root, { log, homie: flags.get('homie'), ownRoute: flags.has('own-route') }); return r?.ok ? { ...r, standalone: copies } : r; }, 'deploy'); }
  if (cmd === 'storage' && sub === 'add') return storageAdd(root, { log });
  if (cmd === 'storage') {
    const cf = readStudio(root).cloudflare ?? {};
    const has = Boolean(cf.r2 && (cf.created ?? []).includes(`r2:${cf.r2}`));
    return { ok: true, command: 'storage', storage: has ? { kind: 'r2', bucket: cf.r2 } : null, why: has ? undefined : 'no storage yet: the studio runs without it; `homie-studio storage add` adds an R2 bucket for large media (Cloudflare asks for a payment method before R2 works)' };
  }
  if (cmd === 'publish' && flags.has('before')) return publishBefore(root, { homie: flags.get('homie'), site: flags.get('site'), log: () => {} });
  if (cmd === 'publish') return publish(root, { homie: flags.get('homie'), site: flags.get('site'), log });
  if (cmd === 'players' && sub === 'owner') return playersOwner(root, { url: flags.get('url'), revoke: flags.has('revoke') });
  if (cmd === 'players' && !sub) return playersShow(root, { url: flags.get('url') });
  if (cmd === 'stats' && sub === 'key') return statsKey(root, { url: flags.get('url'), hours: flags.get('hours') });
  if (cmd === 'stats' && sub === 'link') return statsLink(root, { url: flags.get('url') });
  if (cmd === 'stats' && sub === 'revoke') return statsRevoke(root, { url: flags.get('url') });
  if (cmd === 'stats' && sub === 'share') return statsShare(root, positional[2]);
  if (cmd === 'stats' && !sub) return statsShow(root, { url: flags.get('url'), range: flags.get('range'), game: flags.get('game'), song: flags.get('song'), video: flags.get('video') });
  if (cmd === 'office') {
    const url = flags.get('url');
    if (!sub) return officeShow(root, { url });
    if (sub === 'link') return officeLink(root, { url, to: flags.get('to') });
    if (sub === 'key') return officeKey(root, { url, hours: flags.get('hours') });
    if (sub === 'announce') return officeAnnounce(root, positional.slice(2).join(' '), { url, game: flags.get('game'), room: flags.get('room'), seconds: flags.get('seconds') });
    if (sub === 'invite') return officeInvite(root, positional[2], { url, label: flags.get('label'), uses: flags.get('uses'), count: flags.get('count'), days: flags.get('days'), server: flags.get('server') });
    if (sub === 'launch') return officeLaunch(root, positional[2], positional[3], { url, max: flags.get('max') });
    if (sub === 'kick') return officeKick(root, positional[2], positional[3], positional.slice(4).join(' ') || undefined, { url, minutes: flags.get('minutes') });
    if (sub === 'mute') return officeMute(root, positional[2], positional[3], positional.slice(4).join(' ') || undefined, { url, minutes: flags.get('minutes'), off: flags.has('off') });
    if (sub === 'close') return officeClose(root, positional[2], positional[3], { url, minutes: flags.get('minutes'), reopen: flags.has('reopen') });
    if (sub === 'revoke') return officeRevoke(root, { url });
  }
  if (cmd === 'lounge') {
    // The Lounge (0.29.0, chat/LOUNGE.md): its rules and history, play nights, moderators, lines.
    const url = flags.get('url');
    if (!sub) return loungeShow(root, { url });
    if (sub === 'night') return loungeNight(root, positional.slice(2), flags, { url });
    if (sub === 'history') return loungeRulesSet(root, flags, { url, history: positional[2] });
    if (sub === 'rules') return loungeRulesSet(root, flags, { url });
    if (sub === 'mod') return loungeMod(root, positional[2], { url, remove: flags.has('remove') });
    if (sub === 'remove') return loungeRemove(root, positional[2], { url, all: flags.has('all') });
    return { ok: false, command: 'lounge', why: `unknown: lounge ${sub} (night, history, rules, mod, remove)` };
  }
  if (cmd === 'chat') {
    // Room chat (0.23.0, NETPLAY.md section 19): rules, the room's last minutes, reports, the review's budget.
    const url = flags.get('url');
    if (sub === 'words') return chatWords();
    if (!sub) return chatShow(root, { url, game: flags.get('game') });
    if (sub === 'rules') return chatRulesSet(root, positional[2], flags, { url });
    if (sub === 'remove') return chatRemove(root, positional[2], positional[3], positional[4], { url, all: flags.has('all') });
    if (sub === 'budget') return chatBudget(root, positional[2], { url });
    return { ok: false, command: 'chat', why: `unknown: chat ${sub} (rules, remove, budget, words)` };
  }
  if (cmd === 'servers') {
    const url = flags.get('url');
    if (!sub || sub === 'list') return serversList(root, { url, game: flags.get('game') });
    if (sub === 'new') return serversNew(root, positional[2], positional.slice(3).join(' ') || flags.get('name'), flags, { url });
    if (sub === 'set') return serversSet(root, positional[2], positional[3], flags, { url });
    if (sub === 'close') return serversClose(root, positional[2], positional[3], { url, reopen: flags.has('reopen') });
    if (sub === 'level') return serversLevel(root, positional[2], positional[3], positional[4], { url });
    if (sub === 'member') return serversMember(root, positional[2], positional[3], positional[4], { url, role: flags.get('role'), remove: flags.has('remove') });
    return { ok: false, command: 'servers', why: `unknown: servers ${sub} (list, new, set, close, level, member)` };
  }
  if (cmd === 'shop') {
    const url = flags.get('url');
    if (!sub) return shopStatus(root, { url });
    if (sub === 'init') return shopInit(root, { supporter: flags.has('supporter'), currency: flags.get('currency') ?? 'usd', price: flags.get('price') ?? 500, managed: flags.has('managed') });
    if (sub === 'check') return shopCheck(root);
    if (sub === 'connect') return shopConnect(root, { managed: flags.has('managed') ? true : null, live: flags.has('live'), manual: flags.has('manual'), fromClipboard: flags.has('from-clipboard'), renew: flags.has('renew'), log: (line) => process.stderr.write(`${line}\n`) });
    if (sub === 'disconnect') return shopDisconnect(root);
    if (sub === 'catalog') {
      const from = flags.get('have');
      let have = null;
      if (from === '-' || from === true) have = readFileSync(0, 'utf8');
      else if (typeof from === 'string') {
        if (!existsSync(from)) return { ok: false, command: 'shop catalog', why: `no such file: ${from}` };
        have = readFileSync(from, 'utf8');
      }
      const mode = flags.get('mode');
      if (mode !== undefined && mode !== 'test' && mode !== 'live') return { ok: false, command: 'shop catalog', why: '--mode is test or live' };
      return catalogPlan(root, { have, mode: mode ?? null });
    }
    if (sub === 'orders') return shopOrders(root, { url });
    if (sub === 'refund') return shopRefund(root, positional[2], { url, reason: flags.get('reason'), note: flags.get('note'), manualTransaction: flags.get('manual-transaction') });
    if (sub === 'statements') return shopStatements(root, { url, period: flags.get('period'), cursor: flags.get('cursor') ?? '', send: flags.has('send') });
    return { ok: false, command: 'shop', why: `unknown: shop ${sub} (init, check, connect, disconnect, catalog, orders, refund, statements)` };
  }
  if (cmd === 'agents') {
    const url = flags.get('url');
    if (sub === 'pass') return agentsPass(root, positional[2], { url, label: flags.get('label'), server: flags.get('server'), hands: flags.get('hands'), role: flags.get('role'), days: flags.get('days') });
    if (sub === 'passes') return agentsPasses(root, positional[2], { url });
    if (sub === 'revoke') return agentsRevoke(root, positional[2], { url });
    if (sub === 'brain' && positional[2] === 'key') return agentsBrainKey(root, { remove: flags.has('remove'), log });
    if (sub === 'brain') return agentsBrain(root, positional[2], positional[3], positional[4], { url, budget: flags.get('budget') });
    if (sub === 'sit') return agentsSit(root, positional[2], { url, server: flags.get('server'), pass: flags.get('pass'), label: flags.get('label'), brain: flags.get('brain') });
    if (sub === 'try') return agentsTry(root, positional[2], { url, view: flags.get('view'), ask: flags.get('ask'), from: flags.get('from'), model: flags.get('model'), mode: flags.get('mode'), quiet: flags.has('quiet'), avoid: flags.get('avoid'), players: flags.get('players'), readFile: (f) => readFileSync(resolve(f), 'utf8') });
    return { ok: false, command: 'agents', why: `unknown: agents ${sub ?? ''} (pass, passes, revoke, brain, brain key, sit, try)` };
  }
  if (cmd === 'media' && sub === 'put') return mediaPut(root, positional[2], flags.get('as'));
  if (cmd === 'media' && sub === 'move') return mediaMove(root, { paths: positional.slice(2), dryRun: flags.has('dry-run') || flags.has('plan'), verify: flags.has('verify'), log });
  if (cmd === 'media' && sub === 'list') {
    const studio = readStudio(root);
    const r2 = Boolean(studio.cloudflare?.r2 && (studio.cloudflare?.created ?? []).includes(`r2:${studio.cloudflare.r2}`));
    // What a deploy would serve (deploy: true), so "from r2" means the site no longer carries the file.
    const view = (kind) => { const r = resolveMedia(root, kind, { r2, deploy: true }); return { pages: r.entries.map((e) => ({ slug: e.slug, title: e.title, kind: e.kind, files: e.files.map(({ abs, rel, ...f }) => f) })), skipped: r.skipped, notes: r.notes }; };
    const over = r2OverOf(studio);
    const plan = mediaPlan(root, { over });
    const moves = plan.filter((x) => x.state === 'move' || x.state === 'too-big').map(({ abs, held, ...x }) => x);
    const inR2 = plan.filter((x) => x.state === 'r2' || x.state === 'move').reduce((n, x) => n + (x.bytes ?? 0), 0);
    return {
      ok: true, command: 'media list', r2, site: siteUrl(root, studio), music: view('music'), videos: view('videos'), over, moves, inR2,
      storage: r2 ? (moves.length ? 'the next deploy (or media move now) puts these in R2, checked by SHA-256; their addresses stay the same' : 'every big file is in R2') : (moves.length ? 'no storage: these stay on the site (files up to 25 MiB each), and a deploy from another computer or Workers Builds leaves out any file git does not keep. homie-studio storage add (a payment method on the Cloudflare account, asked first) fixes both' : null),
      cost: R2_COST,
    };
  }
  return { ok: false, command: cmd, why: `unknown command "${[cmd, sub].filter(Boolean).join(' ')}" (homie-studio help)` };
}

/** `homie-studio lab …` (lib/lab.mjs, lib/lab-check.mjs): the Game Lab of one game. */
async function labCommand(root, sub) {
  if (flags.has('stop') || sub === 'stop') return labStop(root);
  if (sub === 'set') return labSet(root, positional[2], positional.slice(3));
  if (sub === 'check') {
    const { labCheck } = await import('../lib/lab-check.mjs');
    const num = (k, d) => (flags.has(k) ? Number(flags.get(k)) : d);
    return labCheck(root, positional[2] ?? null, {
      take: flags.get('take') ?? null, today: String(flags.get('today') ?? 'HEAD'), device: flags.get('device') ?? null, fps: num('fps', null),
      out: flags.get('out') ? resolve(String(flags.get('out'))) : null, still: flags.get('still') ? resolve(String(flags.get('still'))) : null, frames: num('frames', 6), log,
    });
  }
  return labServe(root, sub ?? null, { port: Number(flags.get('port') ?? LAB_PORT), today: String(flags.get('today') ?? 'HEAD'), take: flags.get('take') ?? null, log });
}

/** `homie-studio codex …` (lib/codex.mjs): the Game Codex of one game. */
function codexCommand(root, sub) {
  const games = listGames(root);
  if (sub === 'new') return newCodex(root, positional[2] ?? (games.length === 1 ? games[0].id : undefined), { name: flags.get('name') ?? null });
  if (sub === 'link') {
    const id = positional[2] ?? (games.length === 1 ? games[0].id : null);
    if (!id || !games.some((g) => g.id === id)) return { ok: false, command: 'codex link', why: 'name the game: homie-studio codex link <id>' };
    const r = statsLink(root, { url: flags.get('url') });
    if (!r.ok) return { ...r, command: 'codex link' };
    return { ...r, command: 'codex link', link: `${r.link}&to=${encodeURIComponent(codexTarget(id))}`, use: 'Give this link to the studio\'s owner to open in their own browser: it works once, within 30 minutes, opens the codex, and keeps that browser signed in to the studio\'s private pages (the codex and the stats) for 30 days. Do not post it anywhere.' };
  }
  const id = sub ?? (games.length === 1 ? games[0].id : null);
  if (!id) return { ok: false, command: 'codex', why: `name the game: homie-studio codex <id> (${games.map((g) => g.id).join(', ') || 'no games yet'})` };
  let r;
  try { r = writeCodexPage(root, id, { mode: flags.has('artifact') ? 'artifact' : 'file' }); } catch (error) { return { ok: false, command: 'codex', why: error.message }; }
  if (flags.has('open')) {
    const opener = process.platform === 'darwin' ? ['open', [r.path]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', r.path]] : ['xdg-open', [r.path]];
    r.opened = spawnSync(opener[0], opener[1], { stdio: 'ignore', timeout: 10_000 }).status === 0;
  }
  return r;
}

/*
 * THE PROGRESS FEED (lib/progress.mjs). A command that is a stage of the open build (build, check, port check,
 * deploy) says so: the stage runs, then is done or failed with one line; a check's steps go green as they pass; a
 * stop asked in the Claude app (or by `progress stop`) ends it at the next safe point. With no open feed, or a
 * feed whose build has no such stage (a song has no deploy), the command runs exactly as it did before.
 */
async function tracked(root, stage, run, command) {
  const feed = currentFeed(root);
  if (!feed || !feed.doc.stages.some((s) => s.id === stage)) return run(null);
  await feed.sync();
  if (feed.stopRequested()) {
    feed.stage(stage, 'stopped', 'stopped by the person before it started');
    feed.end('stopped', 'Stopped by the person.');
    return { ok: false, command, stopped: true, why: 'stopped by the person (in the Claude app, or `progress stop`): the build is over; ask them before starting again' };
  }
  if (stage === 'checks') feed.resetChecks('checks');
  feed.stage(stage, 'running');
  const report = {
    check: (id, state, opts) => feed.check(id, state, { ...opts, stage }),
    preview: (p) => feed.preview(p),
    stopped: () => feed.stopRequested(),
    state: (id) => feed.doc?.checks.find((c) => c.id === id)?.state,
  };
  let result;
  try { result = await run(report); } catch (error) { feed.stage(stage, 'failed', error instanceof Error ? error.message : String(error)); throw error; }
  if (result?.stopped || feed.stopRequested()) {
    feed.stage(stage, 'stopped', 'stopped by the person');
    feed.end('stopped', 'Stopped by the person.');
    return { ...result, ok: false, stopped: true, why: result?.why ?? 'stopped by the person' };
  }
  if (!result?.ok) { feed.stage(stage, 'failed', result?.why ?? 'failed'); return result; }
  const note = stage === 'build' ? `Built ${(result.games ?? []).map((g) => `${g.id} (${Math.round(g.bytes / 1024)} KB)`).join(', ') || 'the site'}`
    : stage === 'deploy' ? `Live: ${result.url ?? 'deployed'}`
      : result.command === 'port check' ? `${result.passed.length} passed${result.skipped.length ? `, ${result.skipped.length} skipped` : ''} in ${Math.round(result.totalMs / 1000)} s`
        : `Room ${result.room}: round ${result.round?.n} finished with ${result.round?.humans} people in ${Math.round(result.totalMs / 1000)} s`;
  feed.stage(stage, 'done', note);
  if (stage === 'deploy') {
    const doc = feed.doc;
    const game = (result.games ?? []).find((g) => g.id === doc.id) ?? (result.games ?? [])[0];
    if (game?.play) feed.preview({ url: game.play });
    // Deployed, and every check that ran passed: the build is done.
    if (doc.checks.every((c) => ['pass', 'skip'].includes(c.state))) feed.end('passed', `Live: ${game?.play ?? result.url}`);
  }
  return result;
}

async function progressCommand(root, sub) {
  const arg = positional[2];
  if (sub === 'start') {
    return startProgress(root, {
      what: flags.get('what') ?? 'game', id: arg ?? flags.get('id') ?? null, title: flags.get('title'),
      budget: flags.get('budget'), unit: flags.get('unit'), share: flags.has('share'), directory: flags.get('homie'),
    });
  }
  if (sub === 'attach') {
    return startProgress(root, {
      attach: arg ?? null, what: flags.get('what') ?? 'game', id: flags.get('id') ?? null, title: flags.get('title'),
      budget: flags.get('budget'), unit: flags.get('unit'), directory: flags.get('homie'),
    });
  }
  if (sub === 'show') {
    const id = arg ?? currentId(root) ?? flags.get('build');
    const doc = readFeed(root, id);
    return doc ? { ok: true, command: 'progress show', feed: publicFeed(doc) } : { ok: false, command: 'progress show', why: id ? `no feed ${id} in .studio/progress/` : 'no build is open (homie-studio progress start)' };
  }
  const id = flags.get('build') ?? currentId(root);
  if (!id || !readFeed(root, id)) return { ok: false, command: 'progress', why: 'no build is open: start one with `homie-studio progress start <id> --share`' };
  const feed = new Feed(root, id);
  const done = (message) => ({ ok: true, command: 'progress', build: id, message, feed: publicFeed(feed.doc) });
  const note = flags.has('note') ? String(flags.get('note')) : undefined;
  try {
    switch (sub) {
      case 'stage': feed.stage(arg, positional[3], note); return done(`${arg}: ${positional[3]}`);
      case 'check': feed.check(arg, positional[3], { label: flags.get('label'), note }); return done(`check ${arg}: ${positional[3]}`);
      case 'preview': feed.preview({ url: flags.get('url'), image: flags.get('image') ? resolve(String(flags.get('image'))) : undefined, caption: flags.get('caption') }); return done('preview updated');
      case 'spend': feed.spend(arg, flags.get('what'), { receipt: flags.get('receipt'), unit: flags.get('unit') }); {
        const s = feed.doc.spend;
        return done(`spent ${s.unit === 'usd' ? `$${s.used.toFixed(2)}` : `${s.used} credits`}${s.budget !== null ? ` of ${s.unit === 'usd' ? `$${s.budget.toFixed(2)}` : `${s.budget} credits`}` : ''}`);
      }
      case 'shot': feed.shot(arg, positional[3], { label: flags.get('label'), image: flags.get('image') ? resolve(String(flags.get('image'))) : undefined }); return done(`shot ${arg}: ${positional[3]}`);
      case 'song': {
        const peaks = flags.get('peaks') ? JSON.parse(readFileSync(resolve(String(flags.get('peaks'))), 'utf8')) : undefined;
        const sung = flags.get('sung') === 'yes' ? true : flags.get('sung') === 'no' ? false : null;
        feed.song({ peaks: Array.isArray(peaks) ? peaks : peaks?.peaks, lyric: flags.get('lyric'), sung });
        return done('song updated');
      }
      case 'log': feed.log(positional.slice(2).join(' ')); return done('logged');
      case 'stop': feed.stop('local'); return done('stop asked: the running command stops at its next safe point');
      case 'change': { const c = recordChange(root, id, positional.slice(2).join(' ') || flags.get('title')); return { ...done(`change recorded: commit ${c.file} with the change`), file: c.file, mark: c.mark }; }
      case 'pr': feed.pr({ url: flags.get('url'), state: flags.get('state') ?? 'open', title: flags.get('title'), branch: flags.get('branch'), files: flags.get('files'), additions: flags.get('additions'), deletions: flags.get('deletions'), preview: flags.get('preview'), site: siteUrl(root) }); return done(`pull request on the card: ${feed.doc.change.url}`);
      case 'end': feed.end(arg, note); return done(`ended: ${arg}`);
      default: return { ok: false, command: 'progress', why: `unknown: progress ${sub ?? ''} (start, attach, stage, check, preview, spend, shot, song, log, change, pr, stop, end, show)` };
    }
  } catch (error) { return { ok: false, command: 'progress', why: error instanceof Error ? error.message : String(error) }; }
}

/**
 * One built game's files at an address on this computer (lib/preview.mjs), until the process is stopped. Its address
 * is the first thing on stdout (a line of JSON with --json), so a script that starts it reads where to go.
 */
async function preview(root, id) {
  const p = await previewServer(root, id, { port: flags.get('port') ?? PREVIEW_PORT, strict: flags.has('port') });
  if (!p.ok) return p;
  const { server, dir, ...said } = p;
  process.stdout.write(asJson ? `${JSON.stringify({ ...said, dir: relative(root, dir) })}\n` : `Preview of ${id}: ${p.url}   (its built files only, from ${relative(process.cwd(), dir) || dir}: no rooms, it plays offline with its bots; a new build shows on the next reload. Ctrl-C stops it)\n`);
  await new Promise((done) => {
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => server.close(done));
    server.on('close', done);
  });
  server.closeAllConnections?.();
  return { ok: true, command: 'help' };
}

/** `agents sit`: an AI guide's seat from this terminal, for a demo or a test of a vocabulary. Lines on stdin act. */
async function agentsSit(root, game, { url, server, pass, label, brain }) {
  const site = url ?? siteUrl(root);
  // --brain local: Clef on this computer decides (lib/local-ai.mjs); never a download, only what one would cost.
  let local = null;
  if (brain === 'local') {
    local = await detectLocalAi();
    if (!local.ok) return { ok: false, command: 'agents sit', why: local.say };
    log(`This seat thinks with ${local.model} on this computer (Ollama ${local.version}) every few seconds. Type stand to leave.`);
  } else if (brain !== undefined) return { ok: false, command: 'agents sit', why: '--brain is local (Clef on this computer), or leave it out to choose yourself' };
  const seat = new AgentSeat({ site, game, server: server ?? null, pass: pass ?? null, label: label ?? (local ? 'Clef' : 'Claude'), root, brain: local ? 'local' : null, local });
  const r = await seat.sit();
  if (!r.ok) return { ok: false, command: 'agents sit', why: r.why };
  log(`Seated as ${r.name} in ${r.room} (seat ${r.seat}). Type: look | do <goal> {"arg":…} | say <line> {"arg":…} with a goal | stand`);
  log(JSON.stringify({ view: r.view, asks: r.asks, choices: r.choices }, null, 1));
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin });
  let goal = null;
  for await (const line of rl) {
    const [word, id, ...rest] = line.trim().split(/\s+/);
    let args = {};
    try { args = rest.length ? JSON.parse(rest.join(' ')) : {}; } catch { log('arguments are JSON, e.g. {"place":"camp"}'); continue; }
    if (word === 'look') log(JSON.stringify(seat.look(), null, 1));
    else if (word === 'do') { goal = { goal: id, args }; const d = await seat.do(goal); log(d.ok ? `done: ${JSON.stringify(d.sent)}` : `refused: ${d.why}`); }
    else if (word === 'say') { const d = await seat.do({ ...(goal ?? { goal: Object.keys(seat.vocab.goals)[0], args: {} }), say: id, sayArgs: args }); log(d.ok ? `said: ${d.text}` : `refused: ${d.why}`); }
    else if (word === 'stand') break;
  }
  rl.close();
  await seat.stand();
  return { ok: true, command: 'agents sit', stood: true, room: r.room };
}

/** A big file into the studio's R2, and its key on the music/ or videos/ manifest entry that names it. */
function mediaPut(root, file, as) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) return { ok: false, command: 'media put', why: 'usage: homie-studio media put <file> [--as <key>]' };
  const studio = readStudio(root);
  const r2 = studio.cloudflare?.r2;
  if (!r2 || !(studio.cloudflare?.created ?? []).includes(`r2:${r2}`)) return { ok: false, command: 'media put', needs: 'storage', why: 'this studio has no storage yet. `npx --no-install homie-studio storage add` adds an R2 bucket; Cloudflare asks for a payment method on the account before R2 works (10 GB-month free), so ask the person first. Games never need it.' };
  const rel = relative(root, resolve(file));
  const folder = rel.startsWith('videos/') ? 'videos' : 'music';
  // A file already in music/ or videos/ keeps its repository path as its key (two songs may share a file name).
  const key = as ?? (/^(music|videos)\//.test(rel) && !rel.includes('..') ? rel : `${folder}/${basename(file)}`);
  const bin = wranglerBin(root);
  return new Promise((done) => {
    const p = spawn(bin, ['r2', 'object', 'put', `${r2}/${key}`, '--file', resolve(file), '--content-type', typeOf(file), '--remote'], { cwd: workerDir(root), env: { ...process.env, ...projectsCloudflareEnv(root), CI: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('close', (code) => {
      if (code !== 0) return done({ ok: false, command: 'media put', why: 'wrangler r2 object put failed' });
      // The manifest is committed: it names the file by its path on the site, never the workers.dev address.
      const rec = recordUpload(root, rel, key, statSync(file).size);
      const site = siteUrl(root, studio);
      done({ ok: true, command: 'media put', key, manifest: rec.manifest, entry: rec.entry, url: site ? `${site}/media/${key}` : null });
    });
  });
}

/*
 * A machine whose web traffic goes through a proxy (a Claude Code cloud session: HTTPS_PROXY) runs this command once
 * more with Node's own proxy support on, so the toolkit's requests go the way curl's and npm's do (lib/net.mjs).
 */
const proxied = await restartWithProxy();
if (proxied !== null) process.exit(proxied);

try {
  const result = await main();
  // A shared progress feed sends its last word before the command exits.
  await flushProgress();
  if (result && result.command !== 'help') print(result);
  if (result?.ok === false) process.exitCode = 1;
  // Chrome's pipes can outlive browser.close(); a finished check must not hang its caller.
  if (['check', 'port check', 'look', 'perf', 'shoot', 'lab check'].includes(result?.command)) process.exit(process.exitCode ?? 0);
} catch (error) {
  await flushProgress().catch(() => {});
  print({ ok: false, why: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
