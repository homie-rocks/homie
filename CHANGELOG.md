# Changelog

What changed in each release of Homie's open parts, newest first:

- **`@homie-rocks/studio`**: the `homie-studio` command, your studio's site Worker, its multiplayer rooms (the
  netplay contract), the port kit and the starter games. Every version is on npm, and Homie for Claude Desktop
  (`homie-studio-<version>.mcpb` on each GitHub release) is built from it.
- **The Homie plugin** for Claude Code and Codex: its skills. It ships from this repository's marketplace with its
  own version number, given beside each studio version below.

Each version says what you can now do (**Added**), what works differently (**Changed**), what was broken and is
not any more (**Fixed**), and anything you have to do yourself (**Upgrade notes**). The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). While Homie is 0.x, a minor version (0.19.0) adds
things and a patch (0.19.1) fixes or polishes them.

To bring a studio up to date, tell Claude: "Upgrade my studio to the newest Homie." It runs
`npx -y @homie-rocks/studio@latest upgrade`, which shows what's new since the version your studio pins (from this
file) and what the upgrade would change, and changes nothing until you agree.

## [0.28.0] - 2026-10-03

**Plugin 0.29.0** · [#43](https://github.com/homie-rocks/homie/pull/43)

Tell Homie: when something confuses you or gets in your way, Claude can offer to send the people who make Homie a short note about it. You see the note word for word first, and nothing is sent without your yes.

### Added

- `homie_feedback`, a new tool on both Homie MCP servers (the remote one at homie.rocks, and the local `homie-studio mcp` in Homie for Claude Desktop), with the same name and inputs on each:
  - `draft` (the default) sends nothing. It answers with the note exactly as it would go: its kind (stuck, confusing, idea, praise or bug), the words, and what goes with them (the step or skill, the studio's and the plugin's versions, the app, and whether Claude offered it or you asked). Keys, tokens, private links, code, home folders, email addresses, network addresses and your Cloudflare account's name are taken out first, and the note says what was taken out.
  - `send` sends only the note you were shown. It names the draft, and a note whose words or details changed since then is refused.
  - `decline` records your no.
- A Tell Homie card in Claude Desktop and Claude on the web or a phone: the note as it would go, with **Send**, **Edit** (your own words, your kind, an optional reply address) and **Don't send**.
- In Claude Code, the Homie mod:
  - `/feedback <your words>` shows your note in a Tell Homie pane with Send and Don't send. `/feedback` alone opens the pane to write one, or puts an ask for Claude to draft one in your prompt box. The Studio pane has a **Tell Homie** button (`t`).
  - Every send from Claude waits for **Send** in Claude Code's own question, with the note's exact words. Once you have sent or declined a note in a session, Claude cannot offer another.
  - A note is drawn in the transcript as a framed note.
- In Codex, Homie's hooks hold every send until your own `proceed <code>`, with the note's exact words in the hold.
- Skills and the studio's `AGENTS.md` (a new "Telling Homie" section) tell Claude when to offer: after an error it could not fix, when you sound confused or frustrated, and at the end of your first studio setup or first publish. It offers at most once a session, never makes help wait on it, and takes no for an answer.

### Changed

- The studio-setup and publish skills, the plugin's README and both MCP servers' instructions describe Tell Homie.

### Upgrade notes

- Nothing to do. `homie-studio upgrade` adds the "Telling Homie" section to the studio's `AGENTS.md`. The tool is on the Homie MCP for every app; in Claude Code, update the plugin for `/feedback` and the send hold. Notes are private; homie.rocks/privacy says what is kept.

## [0.27.0] - 2026-10-03

**Plugin 0.28.0** · [#42](https://github.com/homie-rocks/homie/pull/42) · [release-2026-10-03-studio-0.27.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-03-studio-0.27.0)

Search engines and AI agents read a studio's site correctly: schema.org data on every page, a full VideoGame on every landing, and a sitemap, robots.txt and llms.txt made from what is public.

### Added

- Structured data (schema.org JSON-LD) on every generated page, from the studio's own files and nothing else:
  - Home: the studio as an `Organization` (its name, address, logo, share picture and tagline) and its `WebSite`.
  - Each game's landing: a `VideoGame` (co-typed `WebApplication`, as Google asks) with its description and pitch, pictures and screenshots, genre, players (fewest and most), play modes, platforms, the studio as author and publisher, the source's licence (linked to its SPDX page when it names one), what it is based on (a remix's original page, a port's original), its trailer as a `VideoObject`, when it came out and last changed, a Play action and a free-to-play offer.
  - Music: `MusicRecording` (the studio as the artist, its length, its audio file, its cover, its key and date) and a `MusicAlbum` when the music manifest names one. Videos: `VideoObject` (poster, upload date, length, the file itself). Posts: `BlogPosting` and the studio's `Blog`. Games and Rooms: an `ItemList` of the public games. Every page but Home: a `BreadcrumbList`.
- Never a rating or a review, and no price for anything the shop does not sell. While your shop really sells, each item sold in a game is an add-on of that game's free offer, in real money. The Rooms page's data names the games, never who is playing this minute.
- `/robots.txt`, `/sitemap.xml`, `/llms.txt` and `/llms-full.txt`, made from your public catalogue:
  - robots.txt lets crawlers read every public page, keeps them off your office, the APIs, accounts and each game's play, TV, watch and socket doors, and names the sitemap. A Preview asks not to be crawled.
  - The sitemap lists Home, Games and each landing, Music, Videos, Rooms, Posts and your own pages, with dates only where a real date says when each changed.
  - llms.txt tells an AI agent what your studio is: each game with its pitch, players, Play, Watch and big-screen links; which games are open to remix, with the licence, the source and the words to say to Claude Code or Codex with Homie; songs, videos, posts with their feeds, your own pages, and homie.rocks's llms.txt. llms-full.txt adds each game's whole description, how to play and credits, and every post's text.
  - A private or invite-only game is in none of them, and a game is offered for remixing only when its source is shared, your Remixable switch is on and its licence allows it.
- game.json takes `"genre"` (a word, or up to three), `"released"` (the day it came out) and `"schema"` (schema.org properties of your own on the game). studio.json takes `"site": { "schema": { … } }` for the studio, such as `"sameAs"` links to its other pages. Homie's own properties always win, and ratings, reviews and offers are refused (the build says so).
- Screenshots: pictures in `games/<id>/screenshots/` (or game.json `landing.screenshots`), at most eight, get a band on the landing and go into its VideoGame. A game's genre shows with its room facts.
- A video's or song's `"date"` in its manifest; without one, when it was made (`made.at`). Search engines show no video without an upload date, so the build says when a video has neither.
- `<!-- homie:schema -->` in the `<head>` of a page of your own (`site/pages`) puts there the structured data the generated page would carry.
- `lib/schema-check.mjs` checks every JSON-LD block of a page against schema.org's own vocabulary (types, properties, which type each property is for, value kinds, enumerations) and against what Google documents as required for VideoGame, VideoObject, BreadcrumbList, ItemList, BlogPosting, Organization and MusicRecording.

### Changed

- A landing's VideoGame was a short block with a price of 0 and no co-type; it is now the full record above, inside one `@graph` with the page's breadcrumbs.
- A private or invite-only game's landing, which only its owner and invitees see, answers `x-robots-tag: noindex`.

### Upgrade notes

- Nothing to do: `homie-studio upgrade` and a deploy bring all of it. Give each game a `"genre"`, put a few pictures of real play in `games/<id>/screenshots/`, give each video a `"date"` if it has no `made.at`, and add your studio's other pages to `studio.json` `"site": { "schema": { "sameAs": [...] } }`.
- A `robots.txt`, `sitemap.xml`, `llms.txt` or `llms-full.txt` you already keep in `site/public/` still wins over the made one. A landing or Home page of your own in `site/pages/` is left exactly as it is; add `<!-- homie:schema -->` to its `<head>` to give it the structured data.

## [0.26.1] - 2026-10-03

**Plugin 0.27.1** · [#41](https://github.com/homie-rocks/homie/pull/41) · [release-2026-10-03-studio-0.26.1](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-03-studio-0.26.1)

In Codex, Homie now holds what the Claude Code mod holds: protected files, deploys, Cloudflare changes, spending past the budget and model downloads wait for your own "proceed", and secrets come out of what Codex reads.

### Added

- Homie's hooks for Codex (`hooks/codex.json`, `hooks/codex.mjs`). They hold and refuse the same calls as the Claude Code mod, with the same words:
  - Held: an edit to a file `studio.json` `"protect"` lists (an `apply_patch`, with its diff), a production deploy, a change to the studio's Cloudflare account outside its deploy (Wrangler or Cloudflare's MCP servers), a paid fal, ElevenLabs or Tripo call past the budget or whose cost cannot be read first, and a Clef model download.
  - Refused: a change to a locked art decision, an unlicensed asset in a public game's deploy, a file over 5 MB under `games/` into git, and a Stripe write that would hand back a webhook's signing secret.
  - Secrets come out of every tool result before the model reads it.
- How you answer a hold in Codex. A Codex hook cannot ask you, so a held call is refused with a short code, and Codex shows you what it holds. Then:
  - Reply `proceed H7K2` to let exactly that call through once, or `cancel H7K2` to refuse it.
  - Only your own message counts; the model cannot answer for you.
  - In `codex exec`, `codex exec resume <session> "proceed H7K2"` answers a hold.
- `node hooks/codex.mjs check -- <command>` says what Homie would do with a command, and runs nothing.

### Changed

- The decisions behind every hold live in one module, `hooks/lib/holds.mjs`. The Claude Code mod and the Codex hooks both ask it, so the two cannot drift. The mod holds exactly what it held before, with the same words.
- The plugin's root `plugin.json` no longer declares the Agent Plugins `$schema`. Codex 0.156.1 to 0.160.0 read a root manifest only when it declares that schema, and then run none of the plugin's hooks. Codex now reads `.codex-plugin/plugin.json`, which names the hooks, the skills and the Homie MCP server.
- The studio-setup, publish, art, video, models, music, servers and shop skills say what Homie's hooks hold in Codex, and how a hold is answered there.

### Upgrade notes

- Codex runs a plugin's hooks only once you trust them. After updating the Homie plugin in Codex, open `/hooks` and trust Homie's three hooks. Until then nothing is held in Codex, and `codex exec` skips untrusted hooks without a word.
- The plugin README's "Homie's holds in Codex" compares what Claude Code and Codex cover. Not in Codex:
  - a question dialog;
  - redaction of the output on your own screen and in Codex's session file;
  - the mod's panes and commands.

## [0.26.0] - 2026-10-03

**Plugin 0.27.0** · [#40](https://github.com/homie-rocks/homie/pull/40) · [release-2026-10-03-studio-0.26.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-03-studio-0.26.0)

A game's first minute: Play never opens on a blank screen, a bright game gets a bright landing in its own palette, and in Hero Rush 3D a new player's first round is a race they are in.

### Added

- The arrival card. From the play page's first paint (and the big screen's), the game's own look covers its frame while the room connects and the game loads: its title and pitch, its key art (the landing's hero still, a trailer's poster or its cover, drifting slowly), a progress line that says what is happening ("Finding a room…", "Room 4 · 3 playing · 2 AI", "Loading the game…", "Joining Room 4…", the game's own "Loading the heroes… 60%"), and the controls for this device from `landing.controls`. It is drawn in the game's palette (style.json), else its landing's colours, else the studio's, and it fades the moment the game is playable. `?arrive=0` leaves it out.
- The netplay helper tells the play page when the game is playable (NETPLAY.md section 21): by itself once the browser is seated and has the room's state, or, for a game that keeps loading after that (models, textures, a baked world), at the game's own `net.playable()` (`createNetplay({ arrival: 'game' })`), with `net.loading(fraction, 'the heroes')` for the progress line. Nothing crosses the relay; the wire stays revision 8.
- `homie-studio perf` measures the time to the first meaningful frame (`load.look`: the arrival card on the screen), and its time to playable waits for the card to lift. The perf skill's goals include it ("it opens on a blank screen").

### Changed

- A game with its own palette (style.json) and no `landing.scheme` or `landing.theme` of its own gets its landing in that palette: its paper as the page, its ink as the words, its accents, light or dark as its paper is, when the ink reads on the paper (4.5:1). Its footage keeps its colour, and the words sit on a soft panel of its paper. A bright game is no longer shown on the studio's dark page. A scheme or colours the owner set, a page of the studio's own and `site/theme.css` still win; a game without a style.json keeps the studio's look.
- Hero Rush 3D: the bots never swamp a new player. In somebody's first round in the room, when nobody set the AI dial, the bots play a level easier. A bot far ahead of the best person in the room eases off (it walks, reacts later, swings less, then races for the coins near that person, or keeps near them, up their screen, without taking coins) and plays at its dial again once it is within its lead: Rookie −1, Steady 1, Fair 2, Strong 5, Maxed none. Scores stay honest (no score is ever changed, no coin given, taken or faked), and every bot is labelled, the phone's compact board too ("bot" or "AI" after the name). A casual player's first round at the default dial ended 61 coins behind the best bot before, and about 4 behind now; a player who chases the coins still wins clearly, and Maxed bots still beat a casual player.
- Hero Rush 3D on a phone held upright: the camera follows lower and closer (30 degrees, about 5.5 m across), so every hero reads as a character (a mage was the top of its hat), and your name chip says what you are ("You · Mage"). The game passes `arrival: 'game'`: the card lifts on your own hero in its real model, never a stand-in. Your own hero is asked for first, the moment your seat is known, then the other heroes, then the skeletons (on an emulated slow phone your real hero is drawn at about 1.4 s instead of 2.1 s, the same bytes), the in-game title card is gone (the arrival card has the title), the "×2" mark moves off your hero and the controls hint sits above the touch buttons.

### Upgrade notes

- Nothing to do: `homie-studio upgrade` brings the arrival card to every game, and a game built before 0.26.0 lifts it once it has a seat. A game whose world keeps loading after its first state can say when it is ready: `createNetplay({ …, arrival: 'game' })`, `net.loading(p, 'what')` while it loads, and `net.playable()` once its world and the player's own body are drawn. A game made from Hero Rush 3D before 0.26.0 keeps its own code: tell Claude "bring the starter's first-round bots and phone camera into my game" if you want them.

## [0.25.0] - 2026-10-03

**Plugin 0.26.0** · [#38](https://github.com/homie-rocks/homie/pull/38) · [release-2026-10-03-studio-0.25.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-03-studio-0.25.0)

Animated characters for 3D games: free CC0 heroes or one generated and auto-rigged on your fal account, on one skeleton standard with the library's clips retargeted onto it, and a shared player that runs, jumps and swings with IK feet and springs.

### Added

- A skeleton standard (`lib/rig.mjs`): a humanoid family with VRM 1.0 bone names, a mini family for one-piece limbs (Kenney's mini and blocky characters), a quadruped and a rigid "parts" family. A rig from Mixamo, KayKit, Blender, Unreal or Meshy is mapped onto it by name and by its hierarchy, and recorded with a skeleton id (`humanoid-3fa2c1`): characters with the same skeleton share one clip library.
- `homie-studio assets add` takes animated characters from the free library (KayKit's adventurers and skeletons, Kenney's mini and blocky characters, all CC0) and `--file <model> --kind character --rigged` for your own. The shipped character is phone-sized: joints renamed to the standard, helper bones dropped, skinned parts and the accessories you keep (`--keep sword,shield`) merged into one draw call, its clips moved out.
- Clip libraries: `public/anims/<skeleton>.glb` holds one clip per verb (idle, walk, run, jump, fall, land, attack, cast, hit, die, ...), 30 frames a second, compressed, with where each clip came from. Clips are retargeted at build time from the library's CC0 sources onto any humanoid or mini skeleton (rest-pose alignment per bone, hips scaled by leg height, loops kept in place).
- `homie-studio cast <id>`: the characters, with their proportions, silhouette, palette, skeleton family and clips. `homie-studio anim plan|add|preview <id>`: each character's clips against the verbs the game needs, more verbs retargeted on, and looping previews (animated WebP) with a sheet.
- `@homie-rocks/studio/animate`: one shared three.js `AnimationMixer` player. `loadCharacter` finds a character's clip library from the model; `createCharacter` blends idle, walk and run by speed, plays upper-body actions while running, an additive hit flinch and hit-stop, jump, fall and land with squash and stretch on a spring, lean into turns, look-at, springs and two-bone IK feet, and a cheaper crowd mode past a dozen characters. `ANIM_TUNING` is what the Game Lab tunes.
- A 3D starter with animated heroes, `hero-rush-3d`: knights, mages, rogues and barbarians race for coins in a clearing, jump, dodge and swing at each other, on a phone (Jump and Swing buttons) and a computer, multiplayer with skeleton bots in empty seats. Each round opens on a close-up of your own hero that pulls back to play, and the Game Lab has takes for the jump and the swing.
- Generated characters (paid, on your own fal account): the models skill's `character` command makes an A-pose concept in the game's style (`--like` a library character's thumbnail), then Meshy 7.1 image-to-3D with its auto-rig (about US$1.40 with textures and the rig), then free: made phone-sized, mapped to the standard and given the library's clips. Both calls have receipts under the budget.
- MCP tools and cards: `cast_plan` (the cast card), `character_make` (the lineup with a character beside the others), `anim_plan`, `anim_add` and `anim_preview` (an Animation card of looping clips: Add is free, Feel opens the Game Lab on that move, New against Today).
- An `animate` skill: the skeleton standard, retargeting, clip rights (KayKit and Kenney CC0; Quaternius's own licence since 2026-08-28 is not CC0 and is not used; text-to-motion models are not offered, because the ones available are non-commercial in effect).
- In Claude Code, `/cast` and `/clips`, and the Studio pane's Art tab shows the characters (skeleton, bones, clips) and the skinning cost on a phone.

### Changed

- `assets check` checks skinned meshes: more than four bone influences per vertex, a character without its clip library or missing a verb the game needs, clip libraries over 1 MB (3 MB is a problem) or over 30 frames a second, and the skinning cost of every player's character at once against a phone's budget (skinned vertices and bones), with crowd mode past twelve characters.
- A rigged model is measured by its skin (its joints' positions), so a character exported in centimetres is no longer 100 times too big, and it is centred by a wrapper node instead of moving its skeleton.
- The lineup poses rigged characters in their idle clip and draws their silhouettes from the posed skin.
- `style init` on a starter keeps what the starter already draws (its `style.json`: render, palette, materials, light, camera, fonts) as the automatic picks, and the clip decision lists the clips the game has.
- The fal price check adds a model page's add-ons (Meshy's textures and rig) and quotes the higher of fal's pricing API and the page.

### Upgrade notes

- Nothing to do: games without characters are unchanged. To animate a 3D game's characters, tell Claude: "Give my game animated characters."

## [0.24.5] - 2026-10-03

**Plugin 0.25.5** · [#39](https://github.com/homie-rocks/homie/pull/39) · [release-2026-10-03-studio-0.24.5](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-03-studio-0.24.5)

Room chat keeps off your game's HUD: on a phone the Chat pill is a round icon, as the room button is, and your game can say where the strip of new lines sits, or keep new lines in the Chat sheet, so a game with a busy HUD keeps typed chat.

### Added

- game.json `"screen": { "chat": … }` says where room chat's strip of new lines sits on each screen: `at` (a corner, `top-center` or `bottom-center`), `x` / `y` to move it in from its side and its edge, and `"lines": "sheet-only"` to keep new lines in the Chat sheet while the pill counts them. `desk`, `phone`, `sideways` and `tv` (the big screen's corner of lines) each take their own, changing only what they name. A game whose HUD or controls sit where the strip shows no longer has to keep chat to emoji to stay clear. `chat/CHAT.md` has every field; the template's AGENTS.md and the game skill say when to use it.
- `homie-studio build` warns about a wrong field in `screen.chat` (the play page uses the default there), and says so when a place or `"sheet-only"` is written in game.json `"chat"` (the room's rules) instead.

### Changed

- The Chat pill follows the room button: on a phone (either way up), and beside a room button your game keeps an icon (`screen.share` `"label": false`), it is a round icon with the count of new lines on its corner. On a computer it still says "Chat", unless the word would take the room button's band off the screen or into the middle third of its width, where games keep a clock or a title; then it stays the icon until the window changes size.

### Fixed

- On a phone, the Chat pill's word no longer covers the HUD beside the room button: the first digit of a clock, the last letter of a title.

### Upgrade notes

- Nothing to do: a game without `screen.chat` shows the strip where it did. If you kept a game's chat to emoji only so the strip stayed off its HUD, tell Claude: "Put room chat where my game has room, and let players type again." It places the strip with `screen.chat` and resets the game's chat rules (`homie-studio chat rules <game> --reset`).

## [0.24.4] - 2026-10-03

**Plugin 0.25.4** · [#37](https://github.com/homie-rocks/homie/pull/37) · [release-2026-10-03-studio-0.24.4](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-03-studio-0.24.4)

Your AI guides think with Cloudflare's Clef decision model, which does what a player asks; Clef runs on your own computer while you build; and your games can ask it for their own decisions (tactics, a director's call, a turn) in about a quarter of a second.

### Added

- **Clef thinks for your AI guides.** On a server whose guides use Workers AI, the default model is now `@cf/cloudflare/clef-flash`, Cloudflare's open-source decision model (Apache 2.0). It never writes text: each decision is asked as typed Choices of your `agents.json` (which goal, which quest or place or player, which line or none), and its answer is checked by the same rules as before. On 64 recorded Ember Vale moments it did what an open ask asked 36 times out of 40 by itself (the old Llama 3.1 8B: 0 of 40), and blind judges preferred its decisions in 51 of 64 (Llama's in none). In a live room it answered all 9 asks itself.
- `homie-studio agents try <game> --view <file.json> [--ask ask_help:quest=king-slime --from 0] [--model <id>]`: what your guides' brain would decide in one moment, with no seat taken: the decision, the brain's own pick before the fixed rules, how sure it was, how long it took and what it cost. Use it to test an `agents.json` or to compare a model before setting it.
- **Clef on your own computer.** With [Ollama](https://ollama.com) 0.35.1 or later and `clef-flash` on this computer, `homie-studio dev` runs the guides, chat review and your game's decisions on it: free, nothing sent to Cloudflare (`--no-local-ai` turns it off). `homie-studio agents sit <game> --brain local` (the MCP's `agent_sit { brain: "local" }`) seats a guide that thinks on your computer every few seconds. `setup status` has a "Clef on this computer" row. Nothing ever downloads the model by itself: `ollama pull clef-flash` is about 11 GB, and it is your call.
- **Your game's own decisions** (NETPLAY.md section 20): `net.decide(state, questions, { floor })` on the host, for a game whose `game.json` says `"decide": true`. Ask a Choice (2 to 26 options), a yes/no or a Score about your game's state; the room asks Clef and answers with option ids and numbers, within the same daily budget as the guides, at most one ask every 3 s per room. It always answers: with your own floor when there is no AI, no budget, or no answer in time. Measured: about a quarter of a second there and back, about 4 neurons for three questions. Ask per beat or per turn, never per frame.
- Ember Vale's slimes can think (opt-in: set `"decide": true` in its `game.json`): every 6 s the slimes' director picks how they hunt (rush, surround, gang up on the most hurt, regroup at the King), whether a wave comes and how hard to push, and every screen shows what the slimes are up to. On a kids server they never gang up on the most hurt and never push past steady.
- The office shows each room's game decisions (how many, who answered, the model's time, the neurons), and each guide decision's model, how sure it was and, when a rule overruled it, what the brain itself chose.

### Changed

- A player's ask is now answered with the values they asked for: a brain that picks the asked goal with another quest or place is overruled, like one that picks another goal.
- House guides remember the lines they said and who is new to them: they greet a newcomer once and otherwise stay quiet unless asked or something changes.
- Clef costs more neurons a decision than Llama (about 9 against 4: it reads its questions and answers, and writes nothing), so the default 8,000 a day is about 900 guide decisions. Set `HOMIE_BRAIN_MODEL` to `@cf/meta/llama-3.1-8b-instruct-fp8-fast` in `wrangler.jsonc` to keep the old model.
- The doctor's Workers AI check asks Clef one yes/no question (it does not take a chat message).

### Upgrade notes

- `npm run deploy` after upgrading: guides on Workers AI switch to Clef at their next decision. Nothing else to do.
- To try local Clef, install Ollama (0.35.1 or later), say yes to the download, and run `ollama pull clef-flash`; then `npm run dev`.

## [0.24.3] - 2026-10-03

**Plugin 0.25.3** · [#36](https://github.com/homie-rocks/homie/pull/36) · [release-2026-10-03-studio-0.24.3](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-03-studio-0.24.3)

Set up your shop with Stripe's own tools for AI: your AI makes the products, checks tax, makes the webhook and answers "how are sales?"; you make the account, approve Stripe's pages and paste one key.

### Added

- Stripe's agent plugin is how your AI works with your Stripe (`npm install -g @stripe/cli@latest && stripe agent setup`: Stripe's own MCP server and skills for Claude Code and Codex, or Stripe's connector in the Claude app). It is set up when your studio starts selling, never before: `setup status` shows a Stripe row once `shop.json` exists. You sign in once on Stripe's page and give it a sandbox first.
- `homie-studio shop catalog`: your items as Products in Stripe, made by your AI through Stripe's MCP. It names the one read to make, then (`--have <Stripe's answer>`) exactly the writes still needed: a Product per item with a tax code eligible for Managed Payments and a default Price of `shop.json`'s amount. A new price becomes a new default Price; an item you removed is archived, never deleted; products you made yourself are never touched. In sync, `shop.json` records `"catalog": ["test"]` and checkouts name each item's Product, so Stripe's Dashboard and reports see sales by product. `shop.json`'s price is still what is charged.
- `homie-studio shop connect` now makes the webhook itself: you paste one restricted key (with Webhook Endpoints: Write added to its permissions), the page makes the endpoint with it, and Stripe's signing secret goes straight to your Worker without anyone seeing it. An older endpoint the kit made for the same address is turned off, not deleted. A key without that permission still works with a webhook secret you made yourself.
- With Managed Payments chosen in test mode, the connect page tries one test checkout with it (expired at once) and tells you whether Stripe has it on for your account.
- A refund Stripe holds for approval (when the shop's key is an Agent key) is shown as held, not failed: approve it in Stripe and the item leaves the player's account when Stripe refunds. Refunds made in Stripe's Dashboard or through Stripe's MCP take the item back the same way.
- `homie-studio setup --via stripe-projects [--with elevenlabs]` (a prototype): for a creator with no Cloudflare account, Stripe Projects makes or links one (and ElevenLabs) on their own Stripe sign-in, on free plans. It stops at each step that is yours (Stripe's sign-in, the providers' terms, Cloudflare's approval page), puts the account id in `studio.json`, keeps the token in Projects' vault and its git-ignored `.env`, and every Wrangler run in the studio uses it. `npx wrangler login` stays the default.
- The plugin's shop skill now walks a creator with a fresh Stripe account through it: what you click, what to tell your AI, and what stays yours. The studio-setup skill has the Stripe Projects option.

### Changed

- The Homie mod refuses a write through Stripe's MCP that would make a webhook endpoint (or an event destination with its secret): Stripe answers the signing secret in that call, and it would land in the conversation. The connect page makes the webhook instead.
- The Homie mod now takes Stripe webhook signing secrets (`whsec_…`) out of tool output, as it does Stripe keys.
- `providers.json` lists Stripe: its agent plugin and MCP server for the shop skill, and Stripe Projects for studio-setup. The shop skill declares Stripe's MCP server for Codex. The Homie mod holds `stripe projects upgrade`, `billing add` / `billing update` and anything with `--confirm-paid-service` as paid calls whose cost cannot be read first.
- A new studio's `.gitignore` also keeps `.env.*`, `.projects/vault/` and `.projects/cache/` out of git; `upgrade` adds them to yours.

### Upgrade notes

- Stripe's MCP accepts only its sign-in page (OAuth) or keys tagged "Agent" from 2026-10-31. If you gave an AI a plain Stripe key for the MCP, replace it with an Agent key or sign in again. The shop's own key in your Worker is not affected, and must stay a plain restricted key.
- To have the connect page make your webhook, add Webhook Endpoints: Write to the shop's restricted key (or make a new key) and run `homie-studio shop connect` again. Afterwards you can set that permission back to None.

## [0.24.2] - 2026-10-03

**Plugin 0.25.2** · [#35](https://github.com/homie-rocks/homie/pull/35) · [release-2026-10-03-studio-0.24.2](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-03-studio-0.24.2)

Homie's skills work through each provider's own CLI, plugin and MCP server, declared so they load only when a skill needs them, and the Homie mod holds the paid calls and Cloudflare changes those tools can make.

### Added

- `providers.json` in the plugin: each provider's own CLI, plugin, MCP servers and skills, the skills that use them, and what stays Homie's (budgets and receipts, the kids rules, secrets never in the chat, the owner's one-tap asks, phone budgets, the rights notes). The plugin's `plugin.json` points at it (`extensions["rocks.homie"].providers`). Nothing installs by itself: a skill offers a provider's tool when the person wants what it unlocks, and the person approves the install and signs in on the provider's own page.
- Each skill that uses a provider names it in its own frontmatter (`metadata.providers`, and `compatibility` in words: the Agent Skills fields). The art, video, models, style, publish and servers skills declare their provider's MCP server for Codex in `agents/openai.yaml` (fal's MCP server; Cloudflare's docs server, which needs no sign-in), so Codex can wire it when the skill is used.
- The Homie mod holds a change to a studio's Cloudflare account made outside its deploy, inside the studio: Wrangler deleting something (a Worker, a D1 database, an R2 bucket or object, a KV namespace or key, a queue, a secret), a `secret put`, a version rolled out or back by hand, a migration or a writing query on the live database (`--remote`), and the same through Cloudflare's own MCP servers or a claude.ai Cloudflare connector (the API server's `execute` sending anything but a GET or a GraphQL read; a tool that deletes, updates or edits). The hold names the studio's own Worker, database or bucket when the change touches one. Creating something and reading are not held; `guardDeploys: false` turns it off.
- The mod's spending guard knows the providers' own CLIs and MCP servers: a generating command of `elevenlabs`, `fal api` or `fal run`, `genmedia run` and `tripo` is held as a call whose cost cannot be read first, and so is a run on fal's, ElevenLabs' or Tripo's MCP server. Their help, dry runs, sign-ins, prices, listings and ElevenLabs' `estimate_only` are free.

### Changed

- The art and video skills find models and read prices on fal's own MCP server at its sign-in address (`https://mcp.fal.ai/mcp-relay`: the person signs in on fal's page, no key), with the commands that connect it in Claude Code and in Codex. Paid runs still go through the skills' scripts (priced, capped, receipted, resumable), never the MCP's `run_model`.
- The publish skill points at Cloudflare's own tools for questions beyond the deploy (its docs MCP server; its plugin's skills and API server, from `cloudflare/skills` or Claude's plugin directory; `wrangler login --device` where no browser can open) and says the studio's own Worker, database, storage and secrets change only through its deploy. The servers skill reads Cloudflare's model catalogue (`wrangler ai models list --json`) rather than memory.
- The music skill names ElevenLabs' plugin for Codex too, their skills on their own (`npx skills add elevenlabs/skills`) and their hosted MCP server, which has no music tools, and prefers the CLI to a raw API call.
- The models skill keeps Tripo on fal: Tripo's own CLI and MCP server bill a separate Tripo account outside the skill's budget and receipts.

### Fixed

- The studio-setup and style skills' descriptions are plain YAML now. Each held a `: `, which a strict YAML reader refuses.

## [0.24.0] - 2026-10-03

**Plugin 0.25.0** · [#34](https://github.com/homie-rocks/homie/pull/34) · [release-2026-10-03-studio-0.24.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-03-studio-0.24.0)

Sell things in your games with your own Stripe account: a supporter pack, cosmetics, a pass, an unlock or a tip, in real money, with refunds from your office and the kids rules built in; Homie never sees the money.

### Added

- The shop: `shop.json` at your studio's root lists what you sell (`cosmetic`, `supporter`, `pass`, `unlock`, `tip`), each in real money with the entitlement keys your game reads. `homie-studio shop init --supporter` writes a US$5 Supporter pack (a badge on the player's profile and beside their name in rooms, for a year) and `SELLING.md`, plain words on what selling makes you responsible for (refunds, disputes, tax, kids; not legal advice).
- Checkout is Stripe's own hosted page, opened by your studio's Worker with your own restricted key, one item at a time. Stripe Tax is on by default; Stripe Managed Payments (Stripe as the seller of record: it registers, files and pays the tax and answers disputes, for 3.5% more) is one switch, `"till": "stripe-managed"`. Stripe's receipt email is the receipt.
- A signed webhook (`/api/shop/hook`: Stripe's signature, within five minutes, each event once) is the only thing that marks an order paid, refunded or disputed. What a player owns is tied to their passkey account and follows them to every device.
- `homie-studio shop connect`: a page on your own computer where you paste the restricted key and the webhook secret. It says exactly what to make in Stripe, offers Managed Payments in plain words, and puts both straight into your Worker's secrets: never the chat, a file or a log. Test keys only unless `--live`.
- In a game: `createShop()` from `@homie-rocks/studio/shop` gives `shop.has('skin:ember')`, `shop.entitlements()`, `shop.on('change')`, `shop.open(item)` and `shop.used(key)`. The play page has a store sheet (from the game, or Shop in the room sheet) that opens Stripe in a new tab while the game keeps running; on a television it shows only a code to buy on a phone.
- A supporter's badge rides on their seat in every room (`peer.badge`, set by your Worker from what the account owns; a hello can never claim one), and their account page lists their purchases and badges.
- Refunds: one tap in your office (`/_studio/office/shop`), and a player's own refund of an unused item within your refund window (at least 14 days). Your AI can only ask for a refund (`homie-studio shop refund <order>`), and you confirm it with one tap.
- The office's shop page: the last 30 days, every order with its Stripe page, disputes, and payouts, balance and tax as links to your own Stripe Dashboard, plus a CSV for your accountant with no names in it.
- Referrals: a `?via=` link from another site (another studio, or homie.rocks on the same terms) is remembered on a new player's first visit; a kept sale owes that referrer the rate in `shop.json`. `homie-studio shop statements` signs each referrer's monthly statement with your studio's key; the referrer checks it against your manifest and invoices you. Nothing moves through Homie.
- New D1 migration `0008_studio_shop.sql`: orders, entitlements, the age band, parent links, webhook events and referral books. No card, no address, no email.
- The kids and fairness rules are built in, not settings. No shop on a kids server, and none at all in a studio whose `studio.json` says `"audience": "kids"`.
- Spending is off on every account until one neutral question (the year you were born, no default) says adult; the answer is kept only as adult, teen or child. Under 13: nothing, ever. 13 to 17: a one-time link a parent opens on their own phone and pays in their own name.
- Nothing random for money, no gems or coins, no countdown offers, and nothing that changes play on a beginner server (`"advantage": true` items are not sold or counted there). `shop check` and every build refuse a `shop.json` that breaks these. A monthly cap per player (US$50 at most).
- A card dispute never locks or deletes an account: nothing changes while it is open, and a lost one takes back only that item.

### Changed

- Deleting a player account that owns things asks first, and keeps the orders without the player. A player's export includes their orders.
- The directory manifest says whether the shop is open and its till, and how this studio takes referral statements (with the public half of its statement key). Never a key or a sale.

### Upgrade notes

- `homie-studio upgrade --apply`, then `npm run deploy` applies migration 0008. Nothing is sold until you add `shop.json` and connect a key.
## [0.23.0] - 2026-10-03

**Plugin 0.24.0** · [#33](https://github.com/homie-rocks/homie/pull/33) · [release-2026-10-03-studio-0.23.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-03-studio-0.23.0)

Room chat in every game: reactions that float up every screen, quick lines, typing where the rules allow, speech bubbles over characters, rules per game and server, moderation in your own Worker, and the owner's tools.

### Added

- Room chat on every game's play page, with no game code: a Chat pill beside the room button (the corner `screen.share` keeps clear of the game's HUD) and its sheet: the room's last minutes, the five reactions (fire, clap, laugh, heart, wow, in homie.rocks's order, plus up to three of the game's own), the game's quick lines, typing where the rules allow it (and why not where they do not), and Report on a line. New lines show for a moment where the status chip sits (game.json `"screen": { "chat": … }` moves them).
- Reactions float up every screen in the room, as on the television: the players', the watchers' and the big screen's (at most six a second, eighteen at once). The big screen (`/<game>/tv`) shows the room's lines in a corner, and the watch page has a Chat button and panel. Measured in Chrome with four browsers in one room: a reaction is on the other screens within about 15 ms of the press locally.
- Speech bubbles over characters: the port kit's `createBubbles` and `paintBubbles` (beside `createLabels`), and the helper's `net.on('say')`. Gem Rush, Ember Vale and Gem Rush 3D draw what a player says over their name. Each player chooses "Show my messages over my character" and "Show chat on this screen".
- Rules per game and per server: game.json `"chat"` sets a game's defaults (off, emoji, quick lines or typing; who may type and who may react: anyone, signed in with a passkey, or members; slow mode, length, links, swears, the review, bubbles, watchers, homie.rocks), and the owner overrides them in the office or with `homie-studio chat rules`. A kids server and every beginner server keep chat to emoji and quick lines. By default emoji and quick lines are open to everyone and typing needs a signed-in player account.
- Moderation in the studio's own Worker before a typed line reaches anyone: a built-in word list and patterns (slurs, sexual words, self-harm, personal questions such as a player's age or where they live, contact details and other apps, links, swears) plus your own words, then a review on your own Workers AI with Cloudflare's Clef decision model (`@cf/cloudflare/clef-flash`), within a daily budget of 2,000 neurons (about 850 typed messages; inside the free allocation). Emoji and quick lines are never reviewed. When the review cannot answer, the word list decides alone. `chat/CHAT.md` says why Clef and what the alternatives cost.
- The owner's tools: every live room's last minutes in the office with Remove (from every screen), Mute and Kick from a line (a watcher too, their lines taken down with them), the same three in the owner's own game, players' reports with Dismiss, the review's day, and an announcement as a studio line in the chat. `homie-studio chat` (rules, rooms, reports), `chat rules`, `chat remove`, `chat budget` and `chat words`.
- A studio's `/api/rooms` says which rooms let homie.rocks show their chat (`chat: true`), so homie.rocks's room cards can show a room's chat and emoji live from the room's own socket (the hub's side ships with homie.rocks). Turn it off per game or server with the `hub` rule.
- `chat/OWNERS.md`: a plain note for studio owners on what the chat tooling does, what is stored and for how long, and children's data (not legal advice).
- Netplay revision 8 (NETPLAY.md section 19): `say` and `react` frames up, `line`, `react`, `lines`, `unline` and `held` down, `policy.chat`, and the owner's `unsay`; the helper's `net.say`, `net.sayLine`, `net.react`, `net.chatRules` and `on('chat' | 'say' | 'unchat' | 'held')`.

### Changed

- `homie-studio deploy` binds Workers AI when a game lets its players type (the review), not only when an AI guide thinks with it.
- `homie-studio dev --remote-ai` works again: Wrangler's `--local` turned every remote binding off.

### Upgrade notes

- `homie-studio upgrade --apply` (or the next deploy) adds migration `0007_studio_chat.sql`: the owner's chat rules and players' reports. The chat itself is never stored.
- Games get the chat panel, the float and the ticker as soon as the studio deploys this version. Rebuild a game to draw speech bubbles (its netplay helper is revision 8).
- Typing needs a signed-in player account by default. To let guests type, or to keep a game to emoji and quick lines, set game.json `"chat"` or use `homie-studio chat rules`.

## [0.22.0] - 2026-10-02

**Plugin 0.23.0** · [#32](https://github.com/homie-rocks/homie/pull/32) · [release-2026-10-03-studio-0.22.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-03-studio-0.22.0)

Your game's look as decisions you can steer and lock, a style board the engine draws for free, free CC0 3D models, props made on your own fal account, and every asset licensed and checked for phones.

### Added

- `homie-studio style`: your game's look as about thirty decisions (render style, palette, shape, proportions, materials, light, camera, fonts, effects; the cast, its library family, scale and phone budgets; rigs and animation for later). `style init <game> --prompt "…"` picks each from your words, the codex and the genre, with a one-line why, and the Game Codex's Art direction tab draws them. `style steer` nudges one in your words ("warmer", "closer", "golden hour"), `style lock` freezes one for you, and the first model built on an automatic decision pins it.
- `homie-studio style board <game>`: three coherent directions, each drawn by the game's own engine (its palette, light, camera, material model, fonts and proportions, with the starter library's pieces re-tinted into its palette). Free, in about 20 seconds. Pick one, mix rows from several, steer, lock. A painted mood image per direction is optional and paid, on your own fal account, and labelled a target.
- Changing a locked decision shows its blast radius first (`style blast`): every model made under it that would go stale, what remaking each would cost, and what a free palette re-tint fixes. Nothing is ever remade by itself.
- `homie-studio assets`: every model, texture and sky a game ships is recorded in `games/<id>/assets/manifest.json` with where it came from, each step that made it, its licence and what a remix gets. `assets rights` writes `RIGHTS.md` in plain words, credits go on the game's landing, and `assets remove` takes a model out with the copy the game ships.
- Homie's starter library: free CC0 models, materials and skies from Kenney, KayKit, Poly Haven and ambientCG, made phone-sized, with thumbnails and their licences. `assets find "pine tree"` searches it and `assets add <game> <item>` copies one into the game (never hot-linked). It is served from homie.rocks; `HOMIE_LIBRARY` points at another copy.
- `assets add <game> --file <model> --license <kind>`: your own models, checked first (a file that loads anything from an address, or is too big, is refused), made phone-sized (meshopt geometry, WebP pictures, the pivot at the bottom centre, scaled to metres) and recorded. The raw file stays in `art/<slug>/raw/`, which git ignores, and `assets redo <game> <asset>` makes it again from there for free. Unless the game's render style is `pbr`, models are made non-metal: metal with nothing to reflect draws black on a phone.
- `assets check <game>`: every model against phone budgets (triangles, draw calls, picture memory, the first-play download), the Khronos glTF-Validator, its licence, and whether a decision it was made under has changed. `assets lineup <game>` draws them side by side at true scale on a 1 m grid, with their silhouettes and how far their colours drift from the palette. The first-play download counts one file per sound (a browser fetches the .ogg or its .wav fallback, never both).
- `@homie-rocks/studio/assets`: one model loader for three.js games. It refuses unsafe or oversized files before three.js reads them, decodes meshopt, clones skinned models properly, and says in development when a model is over its budget. `stylize` draws a model in the game's material model and ink outline from `style.json`, the way the style board drew it.
- A starter in 3D: `game new <id> --from gem-rush-3d` is Gem Rush's rules drawn with three.js and dressed with models from the starter library. `game new` fetches them, checked by SHA-256 (the repository holds no model file), and a game you already planned keeps its decisions, its `style.json` and its own models. Its light, ground and materials follow the style board: faceted low-poly ground and grass in the palette's greens, every model drawn in the style's materials and outline, the gem in the palette's gold, the animals' colours pulled toward the palette, and the sun's real shadows on a computer (soft discs on a phone). The camera looks past the clearing into the woods; a phone held upright follows its player from closer and lower, so the action fills it. The game opens on a short title card with its name, and its HUD, results and name labels share one paper-and-ink look that reads in any palette. The meadow is a clearing with a campfire at its heart and a few solid rocks, bushes and a tree players move round; game.json `"scoring": "together"` turns the ranking into one total the room fills, for a cozy game. `assets lineup` draws each model at the height and in the colours the game gives it.
- A remix now arrives with its models: the original site serves `/games/<id>/assets.json`, and `game remix` fetches every model its licence lets a remix carry, checked by SHA-256, with a grey placeholder of the same size for the rest. It adds three.js when the game needs it, and no other package by itself.
- Homie for Claude Desktop: the tools `style_explore`, `style_board`, `decision_set`, `assets_plan`, `assets_find`, `asset_add`, `asset_make`, `asset_check`, `asset_lineup` and `asset_rights`, with style board, look decision, cast, lineup and rights cards.
- Plugin: the `style` skill (decisions, the board, locks and the blast radius) and the `models` skill (the starter library, your own models, and generated props: a concept in the locked style, then Tripo P1 image-to-3D, on your own fal account under a budget with a receipt per call, about US$0.54 a prop). The plan asks whether you want to steer the look and what art budget you have.
- Plugin: the Studio mod's Art tab and its commands `/look`, `/lock`, `/assets`, `/lineup` and `/rights`; it refuses a hand edit to a locked decision, a deploy that ships an unlicensed model, and a commit of a big binary under `games/`, and holds a paid prop past the budget.
- `games/<id>/style.json`: the palette, fonts, light and camera a game draws with. Its landing takes its accents from it, and the video skill's title cards (`card --game <id>`) wear its palette and font.

### Changed

- A game with an art direction gets its play page's buttons in its own paper and ink (from `style.json`), so they match its HUD.
- Gather games pick a low three-quarter camera: down among the players, the woods beyond the clearing in view.
- Local development never shows a phone an address it cannot open: the TV view drops its join card, the landing drops its code, and the room button's sheet says to deploy to share (every starter: the page is the studio's).
- `publish` refuses to list a studio while a public game ships a model with no licence record, or one whose licence forbids it.
- `check` refuses a game with a binary over 5 MB committed under `games/` (it belongs in R2).
- The remix source leaves out each game's `codex/` folder (its decisions and style board), like `CODEX.md`.
- `@homie-rocks/studio` now depends on three.js, @gltf-transform, meshoptimizer, sharp and the Khronos glTF-Validator (about 60 MB more in a studio's `node_modules`).

### Upgrade notes

- `homie-studio upgrade --apply` adds the art section to AGENTS.md and `.gitignore` lines for raw 3D files (`art/**/raw/`, `*.blend`, `*.fbx`). Commit no raw model file: move any already committed into `art/<slug>/raw/`.
- The starter library is served from homie.rocks once it is online; until then `assets find` says so, and `HOMIE_LIBRARY` can point at a local copy.

## [0.21.0] - 2026-10-02

**Plugin 0.22.0** · [#31](https://github.com/homie-rocks/homie/pull/31) · [release-2026-10-02-studio-0.21.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.21.0)

The Homie mod for Claude Code: your studio, its rooms and a real seat in a live game beside the chat, with a look
before protected files, deploys and spending, and keys kept out of what Claude reads.

### Added

- Plugin: the Homie mod (Claude Code 2.1.287 or later). Inside a studio, a one-row band above the prompt shows the
  studio, the game, the build step, ▶ Play and how many people are playing now. Outside a studio it adds nothing.
- Plugin: the Studio pane (`/studio`) opens by itself when a build starts, on a wide enough terminal. **Build** has the
  live Plan, Build, Checks, Deploy feed and the latest check frame, or a live Watch of a room of the game being built.
  **Rooms** lists who is playing and the AI players, with Watch and Join links; Announce, Mute and Kick go through
  the office, and Mute and Kick are only ever asked for, so you still confirm them with one tap. **Games** has
  launch states and the remix switch; **Stats** and **Codex** link to the rest. **Lab** shows each game's last Game
  Lab check (New's phases beside Today's, whether the replays match) and the lab's link while it runs.
- Plugin: the Arcade pane (`/arcade`). Take a real seat in a public room of a Homie game (Homie Arcade's, or your
  studio's own) and play it in the pane with w/a/s/d or the arrow keys while Claude works. It runs in one headless
  Chrome on your computer at the lowest priority, about 8 frames a second in a terminal, pauses while the pane is
  hidden and stops when you leave.
- Plugin: a Parts pane for the `parallel` skill: each part, its last step, and the merge waiting for all of them.
- Plugin: instant commands that answer without a Claude turn: `/play`, `/watch [room]`, `/rooms`, `/build`, `/codex`,
  `/deploy-status`, `/perf-numbers`, `/parts`, `/arcade`. They print links or open a pane; nothing opens a browser.
- Plugin: guards. An edit to a file matched by studio.json `"protect"` (globs, such as `"games/*/game.json"`) shows
  the diff and waits for Proceed or Cancel. So does a deploy (where it goes, what it creates, the commits and files
  since the last one, the checks) and a paid fal or ElevenLabs run that would pass studio.json `"budget"`.
- Plugin: Cloudflare tokens, provider keys, agent passes, office keys and one-time owner links are taken out of
  command output before Claude reads it.
- Plugin: setup status, check, playtest and deploy results are drawn as checklists and rows, with the live link.
- `homie-studio office mute <game> <room> <seat | name> [--minutes 10] [--off]`, asked for like `office kick`.
- A build's latest check frame is also kept as a small picture beside its progress feed, for the mod to draw.

### Upgrade notes

- Every part of the mod has its own switch (`/config`, or `pluginConfigs` in settings.json). Codex installs the plugin
  as before; it does not run plugin hooks, so there it is the skills and tools you had.
- `homie-studio upgrade --apply` adds `office mute` and the `protect` and `budget` lines to AGENTS.md.

## [0.20.0] - 2026-10-02

**Plugin 0.21.0** · [#30](https://github.com/homie-rocks/homie/pull/30) · [release-2026-10-02-studio-0.20.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.20.0)

A Game Lab: tune how one move of your game feels (a jump, a hit, a dash), your new version beside your last commit,
frame by frame.

### Added

- Plugin: the `lab` skill. Say "iterate on the jump", "make the hit feel punchier" or "tune the drift". Claude first
  teaches your game to tell the lab about that move (its phases, the numbers that shape it) without changing how it
  plays, and commits that. Then it proposes the change as named phases and numbers, shows it to you New beside Today,
  keeps only what you like, and can record a side-by-side clip to share.
- `homie-studio lab <game>`: the Game Lab, a page on your own computer. One short take of your game plays in New (your
  working copy, rebuilt every time a file is saved) beside Today (your last commit), on one clock, with the same
  presses on the same frames. Slow it to a quarter or a tenth, step a frame at a time, try 30, 15 or 12 frames a
  second, or switch to a phone-sized screen; the frames are the same frames at any speed.
- In the lab: a timeline that names each phase of the move, graphs of New against Today, captions, the game's own
  onion skin and arcs, and its views (close, the whole arena). Its numbers are sliders: move one and New plays it at
  once, and "Keep in code" writes the ones you like into the game's `tunables.json`. Press REC and play a move to make
  a new take; both versions get your presses.
- `homie-studio lab check <game>`: the same take with no window. How long each phase lasts in each version, the peaks
  of what the game tracks, whether a replay landed on exactly the same frames, a contact sheet and a still.
  `homie-studio lab set <game> name=value` writes a number into `tunables.json`; `homie-studio lab --stop` stops the lab.
- Homie for Claude Desktop (`homie-studio mcp`): `game_lab` opens the lab and answers with a card: a still of both
  versions at the move's busiest moment, their phases side by side, and Open.
- For your game's code, `@homie-rocks/studio/lab`: `lab.tunables`, `lab.phase`, `lab.track`, `lab.camera`,
  `lab.overlay`, `lab.stage` (a training dummy for one move) and `lab.random` (dice for sparks and shake). Every call
  does nothing outside the lab, so the calls stay in your game.
- Plugin: the perf skill's `try --measure` measures a change you keep for how it feels and says what it costs, without
  reverting it (`try` on its own reverts anything that is not faster).

### Changed

- Gem Rush's bump lands. The bumped body holds for 70 ms, white and squashed against the hit, then flies stretched
  along it, eases to a stop 185 px away at any frame rate (it used to slide a different distance at 12 and at 60
  frames a second, then creep), and wobbles as it settles. Sparks, and a small camera kick for whoever was in it.
- Ember Vale's strike lands. The slime freezes white when it is hit and its damage pops up, a swipe carries through,
  the slime is pushed back and wobbles like jelly, and a kill bursts. Your hero steps into each strike, so three
  strikes in a row still reach.
- Both starters come ready for the lab: their numbers in `tunables.json` and a take in `lab.json`, which
  `homie-studio game new` copies with the game. A new studio's AGENTS.md names both files and the lab command.

### Upgrade notes

- A game you made from a starter before 0.20.0 keeps its old feel: the new bump and strike come with a new copy
  (`homie-studio game new`). To tune a move of your own game, tell Claude "build a Game Lab for <the move>": it adds
  the lab's calls and a take, and commits that first.
- Today is your last commit, so commit (or stash) your work in progress before you open the lab. Its builds live in
  `.studio/lab/`, which git already ignores.

## [0.19.2] - 2026-10-02

**Plugin 0.20.2** · [#29](https://github.com/homie-rocks/homie/pull/29) · [release-2026-10-02-studio-0.19.2](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.19.2)

Release notes: this changelog, on every GitHub release, inside the npm package, and at the top of
`homie-studio upgrade`.

### Added

- `CHANGELOG.md`: every release since 0.1.0, written for the people who make studios. It ships inside
  `@homie-rocks/studio`, and each GitHub release's notes are now its version's section, with the Claude Desktop
  extension still attached.
- `homie-studio upgrade` starts with what's new between the version your studio pins and the one you are moving to,
  in the plan and again after `--apply`: one line per version, then the upgrade notes, anything you have to do
  yourself. It reads the new version's own `CHANGELOG.md`, so it needs no network beyond npm. `--json` carries it as
  `whatsNew`.
- The studio card (Homie for Claude Desktop, `homie-studio mcp`) says when a studio pins an older toolkit, what's new
  since, and what to say to see the upgrade.
- Plugin: the studio-setup and office skills tell you what's new when your studio is behind, and how to take it.

### Fixed

- In Claude Desktop, `studio_run ["upgrade"]` runs the extension's own newer toolkit when the studio is behind. It ran
  the studio's pinned copy, which knows nothing newer than itself, so it never offered an upgrade.
- When the plan moves the pin, its next step names the newer toolkit
  (`npx -y @homie-rocks/studio@<version> upgrade --apply`), not the studio's own older copy.

### Changed

- For contributors: a pull request that changes `@homie-rocks/studio`'s version must add that version's section to
  `CHANGELOG.md` (CI says exactly what to write), and a release stops before npm without one. A later edit to
  `CHANGELOG.md` alone never needs a new version.

## [0.19.1] - 2026-10-02

**Plugin 0.20.1** · [#28](https://github.com/homie-rocks/homie/pull/28) · [release-2026-10-02-studio-0.19.1](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.19.1)

The perf skill measures games whose studio Worker adds its own script to the game page, and reads whether code is
minified from the code itself.

### Added

- `HOMIE_PERF_SERVE_WAIT_MS`: how long the perf skill waits for a dev server to serve a new build (60 s by default).

### Fixed

- The perf skill can measure a game whose studio Worker adds a script to the game page (a small shim after
  `HOMIE_NET`, say). Its "is the site serving this build?" check never passed for such a game. Now the served page
  must hold the build's own scripts and markup exactly and in order; any other script is the site's, and BASELINE.md
  and the report list it. A Worker that changes in the middle of a loop stops the loop.
- `perf sizes` tells a minified script from source by reading its code (whitespace, comments, short names), not by
  how well it gzips. Minified three.js bundles were told to "ship minified"; they now read as minified, with how much
  of them is GLSL shader source in strings.

### Upgrade notes

- The minification hints need 0.19.1 in the studio; with an older pin the skill says nothing about minifying.

## [0.19.0] - 2026-10-02

**Plugin 0.20.0** · [#27](https://github.com/homie-rocks/homie/pull/27) · [release-2026-10-02-studio-0.19.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.19.0)

A perf skill that makes a game faster one measured change at a time, and `homie-studio perf` to measure it.

### Added

- Plugin: the `perf` skill. Say "make my game run faster on phones" or "find out why it stutters": it takes a
  baseline, profiles, tries one change at a time, and keeps a change only when it is faster beyond the noise and the
  game still passes its own check. Every try says whether the game should look and play the same, and the
  screenshots are compared. It ends with `perf/<id>/README.md`: the numbers, and the game before and after.
- `homie-studio perf`: two real Chromes (a host and a replica) in a room of their own, as a computer or an emulated
  phone, measuring frame times, JavaScript and main-thread time per frame, time to playable, downloads, memory and
  netplay traffic. Every run records how busy the computer was, and a software-rendered run is marked blocked
  instead of judged.
- `perf --profile` names the hottest functions by your own file and line (`build --maps` keeps the source map out of
  the site), `perf compare` judges a change against the noise (side-by-side runs as pairs), and `perf sizes` lists
  every built file, raw and gzipped.

### Upgrade notes

- `homie-studio upgrade --apply` adds the `perf/` row and the command to AGENTS.md, and `.perf/` to `.gitignore`.

## [0.18.2] - 2026-10-02

**Plugin 0.19.2** · [#26](https://github.com/homie-rocks/homie/pull/26) · [release-2026-10-02-studio-0.18.2](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.18.2)

`upgrade` reads the Homie Arcade studio's own sections right, and Ember Vale shows heroes' names and spreads out
their spawns.

### Fixed

- `homie-studio upgrade` no longer mistakes an untouched AGENTS.md section for one you edited when the template's
  own words name your studio (the Commands section's "on Homie Arcade", read by the Homie Arcade studio). That
  studio now takes the template's newer text like every other; words you changed are still kept.
- The port kit's `createRoom` gives a player who joins mid-round a free spawn spot instead of spot 0, so several
  heroes no longer appear on one spot. The spot is kept in the room's checkpoint.
- Ember Vale shows each hero's own name over the hero, in the night's ranking and on a watcher's panel (it showed
  the room's two-word handle). Names are one line of up to 20 characters, and on a kids server other players stay
  handles. Its first spawn spots are spread around the camp.
- The studio's timing tests run on virtual time, so a busy computer no longer fails them.

### Upgrade notes

- A game made from Ember Vale before 0.18.2 keeps its own copy of the starter: the spawn fix reaches it when it is
  rebuilt with 0.18.2 or later (it is in the port kit), but the names are the starter's own code, so copy them over
  or make the game again from the starter.

## [0.18.1] - 2026-10-02

**Plugin 0.19.1** · [#25](https://github.com/homie-rocks/homie/pull/25) · [release-2026-10-02-studio-0.18.1](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.18.1)

Games fill a phone held upright, players' names never pile up, and `doctor` checks the AI guides' Workers AI model.

### Added

- Port kit: `fitView` shows the whole world where it fits (a computer, a TV) and elsewhere fills the screen and
  follows the player, never past the world's edge; `createLabels` places players' names so yours is never covered
  and the others never overlap or flicker.
- `homie-studio doctor`: when a server's AI guides think with Workers AI, one tiny call checks the model on your
  account and says plainly when it needs Workers Paid, is gone, is private or wants its licence accepted, and what to
  do. It never prints a token or an account id.

### Fixed

- Ember Vale on a phone held upright fills the screen and follows your hero (the vale was a small band in the
  middle). Its ask panel sits right above STRIKE and keeps its buttons steady so a tap lands, guide bubbles never
  cover your hero, and the HUD is the right size on high-density screens.
- Gem Rush on a phone held upright fills the screen and stops at the arena's edge, and its names use `createLabels`.

### Upgrade notes

- Games made from the starters before 0.18.1 keep their own layout. `fitView` and `createLabels` are in the port kit
  for any game to use.

## [0.18.0] - 2026-10-02

**Plugin 0.19.0** · [#24](https://github.com/homie-rocks/homie/pull/24) · [release-2026-10-02-studio-0.18.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.18.0)

Big songs and videos live in the studio's own R2 once it has storage, at the same addresses, and the video skill
records a page while a script drives it.

### Added

- With storage, every published song or video file over 1 MiB (studio.json `media.r2Over`), or that git leaves out,
  moves into the studio's R2: `homie-studio media move [--dry-run] [--verify]`, and every `deploy` of a studio with
  storage does it first. Each file is uploaded, read back and checked by SHA-256 before the site stops carrying it.
  Your local file is never changed, and the addresses stay the same, with seeking, caching and HEAD.
- `media list` shows where each file is served from and what would move. A deploy from a checkout without the media
  (another computer, Workers Builds) keeps every file already moved.
- Plugin: the video skill records a page while a script drives it (`video.mjs record <slug> --steps steps.json`):
  clicks, taps, drags, keys, typing, scrolling and waits, on the page or inside the game, as a computer (16:9) or a
  phone (9:16), with captions at each step's second. Real time and honest frames: held frames are counted, never
  blended.

### Changed

- What R2 costs is said where you decide: no egress fees, 10 GB-month of storage free and then US$0.015 per
  GB-month, and Cloudflare asks for a payment method before R2 works. `media move` warns past 10 GB and refuses a
  file over 300 MiB.
- Plugin: the video skill's Chrome starts on Linux the way the studio's own checks do, as a Claude Code cloud session
  needs.

### Upgrade notes

- A studio without storage changes nothing: files up to 25 MiB a file are still served from the site. With storage,
  your next `deploy` moves the big files to R2; run `homie-studio media move --dry-run` first to see which. `upgrade`
  lists your big media and this step, and never moves a file itself.

## [0.17.0] - 2026-10-02

**Plugin 0.18.0** · [#23](https://github.com/homie-rocks/homie/pull/23) · [release-2026-10-02-studio-0.17.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.17.0)

AI guides that talk in your game's own words: on a beginner server they pick goals and lines from the game's
vocabulary, and your own Claude can take a guide's seat.

### Added

- `games/<id>/agents.json`, a game's vocabulary: goals, lines, and the asks a player taps ("Help me with King
  Slime", "No thanks"). The build checks it.
- An AI without the game client sees the game through `agent:view` and acts through `agent:do`. It may only say the
  vocabulary's lines, and only on a server whose AI may talk; the relay drops everything else, including a line a
  host tries to put in an AI's mouth (NETPLAY.md v1 revision 7, section 18).
- `@homie-rocks/studio/agents` (`useAgents`) for the host: views, a scripted floor, goals for your bot code, asks as
  buttons and lines rendered from the vocabulary.
- Guides on a beginner server decide on the room's own alarms with your studio's Workers AI, or your own Anthropic
  key (Claude Haiku 4.5), within a daily budget (8,000 neurons and $1 by default); otherwise they follow the script.
  Fixed rules sit outside the model: an ask is answered the way agents.json says, a guide says one line every 8 s
  at most, "no thanks" holds it off for 10 minutes, and no name, account or address goes into a prompt.
- Your own Claude in a guide's seat: the local MCP's `agent_sit`, `agent_look`, `agent_do` and `agent_stand` (and
  `homie-studio agents sit`) seat it as "Claude · AI".
- Ember Vale is the reference game for guides, and `agents/GUIDES.md` is a short path for an existing RPG.

### Upgrade notes

- Turning AI talk on the first time is an ask you confirm, and so is raising the cap on your own key. Deploy binds
  Workers AI only when a server's guides use it, never in a Preview, and `homie-studio dev` keeps guides scripted
  unless you pass `--remote-ai`. `homie-studio agents brain key` takes your key on a one-use page on your own
  computer; it is never printed or pasted into a chat.

## [0.16.1] - 2026-10-02

**Plugin 0.17.1** · [#22](https://github.com/homie-rocks/homie/pull/22) · [release-2026-10-02-studio-0.16.1](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.16.1)

Servers polish: an opaque vote card, the server pill beside the room button, and a New server form that explains
itself.

### Fixed

- The AI level vote card is fully opaque, so the game's own hints no longer show through it. The TV view never
  shows it.
- The server pill sits beside the room button, in the same band (on a phone held upright it is a dot from the
  start), so the play page covers no more of the game than before. A server room's button says "Room 2", not the
  server's internal id, and Gem Rush draws its scores under that band.
- The office's New server form groups its controls, explains each one in the words players see on the site, shows
  only what applies to the kind of server you picked, and keeps what you set while the office refreshes.

## [0.16.0] - 2026-10-02

**Plugin 0.17.0** · [#21](https://github.com/homie-rocks/homie/pull/21) · [release-2026-10-02-studio-0.16.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.16.0)

Servers and AI seats: named pools of rooms with their own rules, every AI seat labelled as AI, and a skill dial the
party votes on.

### Added

- Servers, a game's named and lasting pools of rooms, each with a policy: **open** (an AI with a pass may sit,
  always marked AI), **humans-only** (no AI of any kind), **hybrid** (the top seats of every room are AI companions)
  and **beginner** (new accounts, AI guides, quick lines only; with Kids on, handles only). Strangers are matched only
  inside one server. Every game's public rooms are its Quick play server, so old links and rooms keep working.
- Agent seats: an AI sits with a pass only your Worker can verify and is named "<label> · AI" everywhere. The relay
  labels every roster and round result, so a modified host cannot pass an AI off as a person, and AI never keep a
  room alive on their own.
- The skill dial: 1 Rookie to 5 Maxed (3, Fair, is how the port kit's bots always played). The party votes on a
  card, and the server's ceiling caps it.
- On the site: a Servers band on each landing, `/<game>/servers/` and a page per server; the play page's server
  pill, vote card and AI pills. The office manages servers, agent passes and AI levels, and anything that narrows a
  server is an ask you confirm with one tap.
- `homie-studio servers`, `agents pass|passes|revoke|brain` and `office invite --server`. Plugin: the `servers`
  skill.
- For game code: `net.policy`, `net.skill`, `net.vote()`, `net.agents()` and more in the netplay helper, all of it
  done by the port kit's `createRoom`, and a `skill` option for BotBrain (NETPLAY.md v1 revision 6, section 17).

### Upgrade notes

- D1 migration `0006_studio_servers.sql`: `upgrade`, `deploy` and `dev` add it.
- A game built before 0.16.0 still plays on any server, and the office marks it "predates servers". Rebuild it with
  0.16.0 or later for the dial and AI seats.

## [0.15.0] - 2026-10-01

**Plugin 0.16.0** · [#20](https://github.com/homie-rocks/homie/pull/20) · [release-2026-10-01-studio-0.15.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.15.0)

Watch any player: anyone can watch a live room from any player's view, on every studio, with nothing streamed.

### Added

- `/<game>/watch?room=<room>` shows a live room like a broadcast: a band above the game (live, the round's clock, how
  many are watching, Play into this room) and a dock below with each player, Auto and the whole room. Tap, or use
  keys 1 to 9, A, O, the arrows and F. It works on phones, computers and TV-sized screens; with no room given it
  finds the busiest public one.
- The watcher's own browser draws the game from the followed player's view, as a watcher that never takes a seat
  (NETPLAY.md v1 revision 5, section 16). Auto holds each player at least 3.5 s, then cuts to the newest spotlight (a
  game marks one when someone waves or lands a kill, say), and otherwise follows the leader.
- Watch buttons beside Join on every room row and on landings; `/api/rooms` rows carry `watch`; watches count in
  your stats, and the play page says how many are watching.
- game.json `"watch": "overview"` shows only the whole room (for hidden hands or roles), and `"watch": false` turns
  watching off. Private and invite-only games are watched only by people they let in, and a kick also keeps that
  browser from watching.
- For game code: `net.watching`, `net.viewSeat`, `net.follow()`, `net.spotlight()`, `on('view')` and `PALETTE`; the
  port kit adds `room.viewSeat()` and `room.viewBody()`. Gem Rush and Ember Vale follow a player.

### Fixed

- Auto cuts the moment the player shown has had their 3.5 s, not up to half a second later.

### Upgrade notes

- Every existing game can be watched as its overview straight away. To follow one player, read `net.viewSeat` (or
  listen for `view`) and draw that player's camera and HUD.

## [0.14.4] - 2026-10-01

**Plugin 0.15.4** · [#19](https://github.com/homie-rocks/homie/pull/19) · [release-2026-10-01-studio-0.14.4](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.4)

Remix credit and licence: a game's shared source says who made it and what its owner allows, and a remix credits
its original.

### Added

- game.json `"license"`: `"remix-with-credit"` (the default: a remix says "Remix of <game> by <studio>" with a link
  back), `"remix-freely"`, or `"no-remix"` (the source can be read, and the remix flow refuses it). An SPDX id such
  as `"MIT"` can be named too.
- A shared `source.json` carries `credit` and `license`, and a remix's game.json gets `remixOf`: the credit and the
  original's name, studio, page and licence (and its own original, for a remix of a remix).
- The site shows "Remix of <game> by <studio>" on a remix's landing and in its credits, names the source's licence on
  every landing, and offers "Open to remix" only when the owner's remix switch, the launch state and the licence all
  allow it. The directory manifest carries `license` and `remixOf`.

### Upgrade notes

- A shared source from before 0.14.4 reads as the default licence, remix with credit. Set `"license"` in a game's
  game.json for anything else.

## [0.14.3] - 2026-10-01

**Plugin 0.15.3** · [#18](https://github.com/homie-rocks/homie/pull/18) · [release-2026-10-01-studio-0.14.3](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.3)

Fixes from a first full run in Claude Desktop: links are yours to open, an earlier attempt can be folded in, log lines
cut cleanly, and every answer fits Claude Desktop's 1 MB limit.

### Added

- `studio_fold`: when a folder with your studio's name already exists and is not a studio, the AI asks you first,
  then copies its notes into `notes/earlier/<folder>/` for the plan to use; with a second yes it moves the old folder
  to the Trash (on a Mac). It never touches any other folder. If the name is taken in the studios folder, the new
  studio goes in `<name>-studio`.

### Fixed

- After `game_demo` and `preview_run`, the AI hands you the Play link or the card's button instead of opening a
  browser itself (a permission prompt once sat unanswered for minutes).
- The build card's log lines are cut at a word's end, so a step count is never lost mid-number.
- Every answer stays under Claude Desktop's 1 MB limit: a big picture from `file_read` comes back as a smaller JPEG
  copy (your file is never changed), and one guard trims pictures first, then text, and says what it left out.

## [0.14.2] - 2026-10-01

**Plugin 0.15.2** · [#17](https://github.com/homie-rocks/homie/pull/17) · [release-2026-10-01-studio-0.14.2](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.2)

Homie for Claude Desktop turns itself on as it installs.

### Fixed

- Claude Desktop installed the extension switched off, because its Studios folder setting was marked required. The
  setting is now optional, with a Studios folder in your home folder as its default, so the extension turns itself
  on.

### Changed

- Every local tool's description starts with "Homie Studio", and the server tells Claude it is not the separate
  Homie app, whose own MCP server may be listed on the same computer.

### Upgrade notes

- If Settings → Extensions shows Homie Studio switched off after an earlier install, switch it on, or install this
  version's `.mcpb`.

## [0.14.1] - 2026-10-01

**Plugin 0.15.1** · [#12](https://github.com/homie-rocks/homie/pull/12), [#13](https://github.com/homie-rocks/homie/pull/13), [#14](https://github.com/homie-rocks/homie/pull/14), [#15](https://github.com/homie-rocks/homie/pull/15), [#16](https://github.com/homie-rocks/homie/pull/16) · [release-2026-10-01-studio-0.14.1](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.1)

Rooms re-check a game's launch state as they open, the plugin gets a Codex manifest, and its skills read cleanly to
skill scanners.

Three changes landed without a version of their own (#12 to #14), and #15 gave them 0.14.1. The first publish run
for the 0.14.1 tag stopped before anything reached npm: #12 had also renamed a constant in `@homie-rocks/render`
without giving render a new version, and a release refuses that. #16 put render back exactly as published, the tag
was moved to that commit, and the run there published 0.14.1. The render rename did not ship; it waits for render's
next version.

### Added

- Plugin: a Codex plugin manifest (`.codex-plugin/plugin.json`) with an icon, and a plugin README and SECURITY.md,
  for plugin catalogs.

### Fixed

- A room that opens at the moment its game goes private or invite-only reads the launch state on its first
  heartbeat and re-gates itself after the current round, like every other room.
- Plugin: the office skill matches 0.13.0 (rooms finish their round when a game narrows; the say, chat and emote
  convention for mute; what a kick holds).
- Plugin: the skills avoid the characters and patterns skill scanners flag. Nothing behaves differently.

### Changed

- For contributors: CI and the publish workflow pin their GitHub Actions to commit SHAs.

## [0.14.0] - 2026-10-01

**Plugin 0.15.0** · [#11](https://github.com/homie-rocks/homie/pull/11) · [release-2026-10-01-studio-0.14.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.0)

One chat: a new studio starts with no game, the toolkit runs as a local MCP server, Homie for Claude Desktop, and a
one-line hand-off from a phone.

### Added

- Homie for Claude Desktop: the toolkit as a desktop extension, attached to every GitHub release from this one on.
  The chat that shows Homie's cards makes the studio, builds, checks and deploys, with no terminal. Long work
  (installs, checks, deploys) runs as background jobs, so no tool call holds the chat.
- `homie-studio mcp`: the same tools as a local MCP server (setup, studios, games, build, preview, check, playtest,
  deploy, progress, files that never leave the studio, and the plugin's guides), named and shaped like the remote
  Homie MCP's where they overlap. `studio_open` clones a studio made on a phone from GitHub with the computer's own
  sign-in.
- `homie-studio demo` (and `game_demo`) points at a live game on Homie Arcade to try first.
- `homie-studio codex new <id>` starts a game with only its Game Codex; `game new <id>` later makes the game around
  it.
- `HANDOFF.md` and `homie-studio handoff hb_…`: "Continue building <Studio>" in a Claude Code session takes the build
  the chat opened.

### Changed

- A new studio has no starter game. `new`, the Deploy to Cloudflare template and the Claude app's setup make a home
  that says "First game coming soon", and a starter (`gem-rush`, or `ember-vale`) is copied in only when you ask.
  `dev` and `deploy` work with no game.
- Plugin: studio-setup's checklist and the game and plan skills follow this (with no starter, step 3's one small
  change is to the studio's own home).

### Fixed

- `upgrade` keeps two new AGENTS.md sections in the template's order (it used to swap them).

### Upgrade notes

- Existing studios keep their games. `upgrade --apply` adds `HANDOFF.md` and the AGENTS.md section about continuing
  a build.
- The `.mcpb` is not signed yet, and Claude says so as it installs it.

## [0.13.0] - 2026-10-01

**Plugin 0.14.0** · [#10](https://github.com/homie-rocks/homie/pull/10) · [release-2026-10-01-studio-0.13.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.13.0)

The studio's back office: live rooms, kick, mute, announce, launch states and invites, and the owner recognised in
their own game.

### Added

- `/_studio/office`, the owner's private page: every live room of every game and who is in it, refreshed every 3 s.
  Kick (for as long as you choose), mute, announce to a room, a game or the whole studio, close a room, and per game:
  its launch state, remix switch, players per room and invites.
- Launch states per game: `private` (only you), `invite` (an invite-only beta with `XXXX-XXXX` codes and links) and
  `public` (the default). A game that is not public is in no list and refuses anyone without access. Narrowing never
  cuts a round short: each room finishes its round, then re-gates. game.json `"launch"` keeps a new game private from
  its first deploy.
- The owner in their own game: a small Owner button on your play page, with everyone in the room, Mute and Kick.
  Nobody else's page carries it. A game can open a player's card with `net.pickPlayer(seat)`.
- An office key for your AI (`homie-studio office key`): it can look, announce and invite, and a kick, mute, close
  or launch change becomes an ask you confirm with one tap. No key can confirm.
- `homie-studio office [link|key|announce|invite|launch|kick|close|revoke]`. Plugin: the `office` skill.
- Netplay revision 4 (NETPLAY.md section 15): the room verifies the owner's signed controls; new `announce` and
  `mute` frames, and `kicked` and `room-closed` refusals.

### Changed

- The owner's session cookie lives at `/` (the office carries an older `/_studio/` one over), and the owner's passkey
  account from 0.12.0 counts as the owner everywhere.

### Upgrade notes

- D1 migration `0005_studio_office.sql`: `upgrade`, `deploy` and `dev` add it.
- For mute to work in your game, send chat, quick lines and emotes as events whose kind starts with `say`, `chat` or
  `emote`.

## [0.12.1] - 2026-10-01

**Plugin 0.13.1** · [#9](https://github.com/homie-rocks/homie/pull/9) · [release-2026-10-01-studio-0.12.1](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.12.1)

The toolkit works through a proxy, as in a Claude Code cloud session, a failed request says what actually failed,
and the hand-off opens the studio's own repository.

### Added

- The studio's repository is read from `HOMIE_REPO`, studio.json `github` or the git remote, and `setup attach`
  refuses without one. `deploy` passes it to the Worker, which tells the directory (never in the public manifest), so
  a hand-off opens the session in your studio's repository.
- Plugin: the game skill checks that the session is in the repository the prompt names, and quotes the toolkit's
  message instead of guessing at a cause.

### Fixed

- With a proxy in the environment (`HTTPS_PROXY`, as a cloud session has), the CLI uses it. Node's `fetch()` went
  around it, failed to find homie.rocks, and the session wrongly blamed its network settings.
- A failed request says what happened: the server's status and message, or the connection error and whether the
  proxy was used. The network setting is named only when the proxy itself refuses.
- `setup status` no longer calls a failed request a missing connector.

## [0.12.0] - 2026-10-01

**Plugin 0.13.0** · [#8](https://github.com/homie-rocks/homie/pull/8), [#7](https://github.com/homie-rocks/homie/pull/7) · [release-2026-10-01-studio-0.12.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.12.0)

Player accounts and cloud saves: persistent games whose characters last for days and follow a player to every
device.

### Added

- Player accounts on the studio's own site, passkey first: no password, no email. Pressing Play needs nothing; the
  first save makes a guest, and a guest who makes a passkey keeps everything. Sign in on another device with the
  same passkey. Recovery is another passkey, or an email when the studio binds a mail sender.
- Cloud saves, `@homie-rocks/studio/saves` (also on `window.HomiePort`): per player and per game, versioned, so a
  stale copy is a conflict and never a silent overwrite, and offline-tolerant with a local outbox. Lifetime stats,
  and a hall of the fallen for hardcore games (`saves.fall()` writes a memorial and wipes the saves in one step).
- The Ember Vale starter, a persistent-character game on the same public rooms: `homie-studio game new <id> --from
  ember-vale`.
- `/account/`: your name, passkeys, recovery email, and download or delete everything. No IP address is stored and no
  third-party script or cookie is used; the owner sees counts (`homie-studio players`), never a passkey or an email.
- Plugin: the plan interview always asks whether progress must last across sessions or devices, and the game skill
  wires saves in when it does.

### Changed

- The docs say a Claude Code cloud session's default network reaches homie.rocks; changing it is a troubleshooting
  step, not a setup step ([#7](https://github.com/homie-rocks/homie/pull/7)).

### Upgrade notes

- D1 migration `0004_players.sql`: `deploy` and `dev` add it to an older studio, and so does `upgrade`. `account` is
  now a reserved game id and site path.
- A game opts in to saves with game.json `"saves": true`.

## [0.11.0] - 2026-10-01

**Plugin 0.12.0** · [#6](https://github.com/homie-rocks/homie/pull/6) · [release-2026-10-01-studio-0.11.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.11.0)

A new creator's first hour: setup status, a checklist that never jumps ahead, the Game Codex, parallel agents, and
the build's progress under your prompt.

### Added

- `homie-studio setup status` (also `doctor`): one checklist of Node, the Homie connector, Cloudflare (signed in,
  email verified), Chrome, ffmpeg, the optional GitHub, ElevenLabs and fal, and Claude Code's status line. Each row
  says what it unlocks and the exact fix; optional rows never block, and nothing private is printed.
- The Game Codex: `games/<id>/CODEX.md` in plain Markdown, and `homie-studio codex <id>`, which draws it as a page in
  the game's own look (cards, controls, milestones, decisions, open questions) with a live Build status tab.
  `--artifact` makes a self-contained copy; on the site it is owner-only, at `/_studio/codex/<id>/`.
- `homie-studio statusline`: Claude Code's status line shows the build's stage, a bar, its checks and spend.
  `statusline --install` writes it into `.claude/settings.local.json`, never over one you have, and `--project` is
  for when Claude Code started in the folder above the studio.
- Plugin: studio-setup shows one checklist and ticks it as it goes, asking before it copies a starter; the `plan`
  skill's short interview (two or three questions a message, each with a pick) becomes the Game Codex; the `parallel`
  skill offers one agent or several, with the trade-off said plainly.

### Fixed

- The codex's "Ready to try" link is drawn only for a web address, and `setup status --homie` falls back to
  homie.rocks when what it is given is not an address.

## [0.10.0] - 2026-10-01

**Plugin 0.11.0** · [#5](https://github.com/homie-rocks/homie/pull/5) · [release-2026-10-01-studio-0.10.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.10.0)

A studio from the Claude app with no terminal: Deploy to Cloudflare makes it, Workers Builds deploys every push with a
Preview per branch, and the site lists itself.

### Added

- `template/`: the public Deploy to Cloudflare template, made by `homie-studio new --template` and checked on every
  pull request.
- Previews: each branch's Preview gets its own rooms, binds no D1, counts nothing and never lists itself.
- In Workers Builds (`WORKERS_CI=1`, or `--ci`), `npm run deploy` only applies D1 migrations and deploys; it creates
  and writes nothing else.
- The site claims its own place in the directory the first time the directory reads it, so nobody runs
  `d1 execute`. It never claims from a Preview, or when studio.json says `homie.directory: false`.
- For a Claude Code session: `setup attach <hs_…>`, `progress attach <hb_…>`, `progress change` and
  `progress pr --url …`, so the chat's cards follow the build and say Live once the site lists the change.
- `homie-studio chrome install`: Chrome for Testing for the checks on a Linux machine with no GPU. `check` reports
  each browser's frame rate and renderer, and never judges a software frame rate.
- The manifest says what is deployed (commit, branch, when), and `HOMIE_DIRECTORY` points one build at another
  directory.

### Changed

- New studios keep `wrangler.jsonc` at the studio's root, where Workers Builds reads it, and pin the toolkit from
  registry.npmjs.org by exact version.
- Every studio Worker sets `global_fetch_strictly_public`, so a site whose directory is on the same zone can reach
  it.

### Fixed

- Chrome for Testing starts on Ubuntu 24.04, which forbids its sandbox: the checks turn the sandbox off only where
  the system requires it.

### Upgrade notes

- Studios made before keep `site/wrangler.jsonc`; every command finds either, and `upgrade` never moves it. A studio
  pinned to a homie.rocks tarball keeps that kind of pin when it upgrades.

## [0.9.0] - 2026-09-30

**Plugin 0.10.0** · [#4](https://github.com/homie-rocks/homie/pull/4) · [release-2026-09-30-studio-0.9.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.9.0)

`homie-studio upgrade`, which brings an older studio up to the newest template without touching what you changed,
and template polish from studios moving to 0.7.0.

### Added

- `homie-studio upgrade [--apply] [--diff]`: what this version's template adds to an existing studio (AGENTS.md
  sections, READMEs, `.gitignore` lines, D1 migrations, package.json scripts and the pin), as a plan with diffs. A file
  or section is replaced only when it is exactly an older template's text; anything you changed is kept, and
  `--diff` shows how it differs.
- game.json `screen.share` places the room button per device (`top-left`, `top-center`, `top-right`, `bottom-left`,
  `bottom-right`, with offsets, or as a small icon).
- game.json `landing.scheme: "light"`, for a white or cream game's landing.
- The site's root answers a game's `/__homie/*` check with `not-a-homie`, as each game's own path already did, so a
  studio no longer needs a wrapper Worker for it.
- For the homie.rocks hub: each game's week of plays in the manifest when the studio shares its stats, studio.json
  `"rooms": { "share": false }`, and `/api/rooms` cached for 15 s.
- Plugin: `capture-game.mjs --scale` renders a heavy game smaller and scales it up to the film's size.

### Changed

- Cards and the directory show a game's landing still (`hero/wide.jpg`, else a trailer's poster, else the cover). A
  song's cover falls back to the album's, then its game's landing still, then the studio's share picture.
- Every Chrome the toolkit and skills start may take up to 150 s, and `check` waits 90 s for pages and seats, for
  busy computers.

### Fixed

- `check` on a busy computer: a browser the relay dropped for being quiet no longer fails the round. A round counts
  when each browser has a seat in its results, and a failure says which seat was left out, whether a browser lost its
  connection, and how busy the computer was.
- `capture-game.mjs` advises half size or more, and says when the computer is too busy to capture well.

## [0.8.0] - 2026-09-30

**Plugin 0.9.0** · [#3](https://github.com/homie-rocks/homie/pull/3) · [release-2026-09-30-studio-0.8.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.8.0)

A build you can watch: the progress feed behind the Claude app's build card.

### Added

- A build of a game, song or video can keep a small progress feed (`.studio/progress/<build>.json`): its stages and
  checks, a picture and the address to play, spend against a budget, a song's waveform, a video's shots, the latest
  log lines, and a Stop button.
- `build`, `check`, `port check` and `deploy` report into an open feed by themselves. `check` reports its four steps
  live, with pictures, and a deploy with every check green ends the build with the live Play address.
- `homie-studio progress stage|check|spend|preview|shot|song|log|end|show` for what only the AI knows, and `--share`
  so the Claude app's card can show the feed for 24 hours. The write key stays on your computer and is never printed.
- Stop, from the terminal or the card, is heard before each stage and every 5 s while one runs. Nothing already
  built or deployed is undone.
- Plugin: the game skill opens a feed when you follow a build in the app.

### Changed

- Nothing, unless a feed is open: without one, every command behaves exactly as before.

## [0.7.0] - 2026-09-30

**Plugin 0.8.0** · [#2](https://github.com/homie-rocks/homie/pull/2), [#1](https://github.com/homie-rocks/homie/pull/1) · [release-2026-09-30-studio-0.7.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.7.0)

Studio sites get the same sections as homie.rocks, and every game gets an epic landing page.

### Added

- Sections like the homie.rocks hub, in your studio's own look: Home, Games, Music, Videos, Rooms (every public room
  playing now, with Join) and Posts. A section with nothing in it has no tab.
- A landing page for every game at `/<game>/`, made from its own files: footage or its cover in the hero, the pitch,
  a big Play button into a public room with who is playing, the devices and join codes, how to play, credits with
  licences, and "Make a game like this". game.json `landing` sets the words, footage, credits and an accent.
- Posts: `posts/*.md`, rendered with a safe Markdown subset, with Atom and JSON feeds.
- `site/` wins: `theme.json` (each new studio starts from one of eight palettes), `theme.css`, partials, whole pages
  and public files. A page can never take over the rooms, the game files or the API.
- `homie-studio look`: pictures of the site's pages on a computer, a phone and a phone turned sideways, with what is
  wrong on each.
- The play page keeps the room in its address, and a small room button opens Invite, Big screen and the room code. A
  player without a name gets a two-word handle ("Rusty Rocket").

### Changed

- Generated pages refuse to be framed by other sites, every HTML answer is `no-transform`, and the referrer policy
  shares only your site's address, never a path.
- For contributors: this repository is now where the open parts are developed, with CI, a leak audit and a contract
  test for every engine package ([#1](https://github.com/homie-rocks/homie/pull/1)).

### Fixed

- Gamepads work in WebKit 26 inside the game's frame.
- A `?room=` the relay cannot use is refused with a way into a public room, never silently swapped.
- A bundled game's cover in its `public/` folder is found, `look` judges Play only on Home and landings, a band
  partial that is its own `<section>` stands alone, and new studios keep `.checks/` screenshots out of git.

### Upgrade notes

- A studio on 0.6.0 moves by pinning 0.7.0; nothing in its `site/` changes.

## [0.6.0] - 2026-09-30

**Plugin 0.6.0, then 0.7.0** · [b1cef3d](https://github.com/homie-rocks/homie/commit/b1cef3d), [002ab27](https://github.com/homie-rocks/homie/commit/002ab27) · [release-2026-09-30-studio-0.6.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.6.0)

Rooms of up to 32, and the studio's own stats, read only by its owner.

### Added

- A room's size comes from the game's netplay manifest (game.json `netplay`, or `netplay.json`), up to 32 seats. One
  address may hold every seat plus four more, for a party on one Wi-Fi with a TV. The relay's caps double for rooms
  of 17 to 32 (NETPLAY.md revision 3).
- The netplay helper sends an unchanged input frame at most four times a second, which keeps an idle player's seat.
- Studio stats: page opens, Play presses by where they came from, rooms, rounds, peaks, and song and video starts,
  as daily counters in the studio's own D1. Only the owner reads them: `homie-studio stats`, a read key, or a
  one-time sign-in to `/_studio/stats`. Nothing follows a visitor.
- Plugin 0.6.0: the skills say how to read stats. Plugin 0.7.0 came out of the marketplace soon after, with no studio
  change: a `sound` skill (effects and synthesized scores made on your computer, measured, wired into the game), an
  `art` skill (covers from real frames, and fal images under a budget), a `playtest` skill (real browsers on a
  computer and a phone, then a blind review), and delivery checks for the video skill.

### Changed

- `deploy` keeps the workers.dev address, which names your Cloudflare account, in `.studio/local.json` (ignored by
  git) and never in studio.json.

### Fixed

- The stats sign-in keeps its origin, and the stats tables fit a phone.

### Upgrade notes

- A 0.5.0 studio's committed workers.dev address moves out of studio.json on its next deploy, which also adds
  `.studio/` to `.gitignore`. Stats need D1 migration `0002_studio_stats.sql`, which `deploy` and `dev` add.

## [0.5.0] - 2026-09-30

**Plugin 0.5.0** · [3b93106](https://github.com/homie-rocks/homie/commit/3b93106), [0304da8](https://github.com/homie-rocks/homie/commit/0304da8) · [release-2026-09-30-studio-0.5.0](https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.5.0)

Song and video pages on your studio's site, with no storage needed.

### Added

- `/music/<slug>/` (a player, words, loops and stems to download, and the rights line) and `/videos/<slug>/` (a
  player that plays the 9:16 cut on an upright phone, with poster, captions and credits), listed on Home, at
  `/music/` and `/videos/`, and for the directory. `media/MEDIA.md` is the manifest contract.
- `homie-studio media list` (what the site will show, and why anything is left out) and `media put` (a file in R2).
- Songs and videos are served with byte ranges, so phones can seek. A studio with songs or videos and no games can
  build, dev and deploy.
- Plugin: the `music` skill (songs, themes and game scores with ElevenLabs Music on your own account, within a credit
  cap you set, with receipts) and the `video` skill (gameplay trailers captured from your game, and music videos from
  fal under a budget).

### Changed

- The site serves a song's or video's files itself, up to 25 MiB a file; storage (R2) is only for bigger media.
- The first version released by this repository's publish workflow, with npm provenance.

### Upgrade notes

- `music`, `videos` and `posts` are reserved: they are page addresses, not game ids.

## [0.4.0] - 2026-09-30

**Plugin 0.4.0** · never on npm: served only as a tarball on homie.rocks, before this repository's releases.
Everything in it is also in 0.5.0.

A studio with no credit card: deploy creates only what Cloudflare's free Workers plan gives a new account.

### Added

- `deploy --plan` says what deploy creates and what it costs, and calls nothing. The first deploy says it again
  before it creates anything, and a new account's first deploy names its next step (verify the email, pick a
  workers.dev address).
- `homie-studio storage add`: R2 as its own later step, which stops with Cloudflare's dashboard link until the
  account has R2 turned on (Cloudflare asks for a payment method first).
- `homie-studio dev --stop` stops exactly this studio's dev server, and nothing else on the computer.

### Changed

- `deploy` creates one Worker, one D1 database and the SQLite-backed Table and Lobby Durable Objects, and never
  creates or binds R2.
- Plugin: the skills say what they will create and what it costs before they do it, stop only their own dev server,
  and point at GitHub Issues.

## [0.3.0] - 2026-09-30

**Plugin 0.3.0** · before this repository's pull requests: [3b93106](https://github.com/homie-rocks/homie/commit/3b93106) · [npm](https://www.npmjs.com/package/@homie-rocks/studio/v/0.3.0)

The port kit: make an existing single-player web game multiplayer.

### Added

- `@homie-rocks/studio/port` (and `window.HomiePort` for static games): `createRoom` with bots, join in progress,
  rounds, host migration and snapshots; a touch kit (a floating stick, buttons, key synthesis, swipes); camera rules;
  a HUD; and shims that make storage, cookies and gamepads work inside the game's sandboxed frame.
- `homie-studio port plan|import|check`: grade a game (easy, medium, hard, not a fit), import it, and prove the port
  with real keys and touches on Android Chrome and iPhone WebKit, two browsers finishing a round, a killed host, a
  late joiner and the big screen.
- `build` takes static and command-built games beside bundled ones, and the site gains `/<game>/tv`, a big screen
  with a QR code into its room.
- Plugin: the `port` skill.

### Changed

- The netplay helper is sturdier: input pacing, reconnecting after a flood, and a guard on the snapshot backlog.

## [0.2.0] - 2026-09-29

**Plugin 0.2.0** · this repository's first commit, [cfbd987](https://github.com/homie-rocks/homie/commit/cfbd987) · [npm](https://www.npmjs.com/package/@homie-rocks/studio/v/0.2.0)

`@homie-rocks/studio` on npm, open source under Apache-2.0, in this repository.

### Added

- The 22 `@homie-rocks` game engine packages (arcade, audio, brush, bus, camera, device, diagnostics, film, fx, geom,
  heightfield, input, loop, noise, postfx, props, render, scatter, scores, ui, ui-world and walk) were first
  published at 0.1.0 the same day, and none has needed a new version since.

### Changed

- The package is `@homie-rocks/studio`, under Apache-2.0 and on npm (0.1.0 had another name, in an npm scope Homie
  does not own). The plugin is Apache-2.0 too.
- `new` installs the pinned dependencies itself, and every command runs the studio's own copy (`npm run …`,
  `npx --no-install homie-studio`).
- The play page's chip sits bottom left and fades after 5 s (it covered a game's round clock).

### Fixed

- A deploy cut short resumes instead of refusing its own database as someone else's: each Cloudflare resource is
  recorded the moment it exists.
- `check` counts only a round that finishes after both browsers are seated and in its results, and exits even when
  Chrome's pipes outlive it.

### Upgrade notes

- A 0.1.0 studio pins the old package name: pin `@homie-rocks/studio` 0.2.0 instead.

## [0.1.0] - 2026-09-29

**Plugin 0.1.0** · before this repository, and never on npm: served only as a tarball on homie.rocks, under the old
package name, and withdrawn when 0.2.0 came out.

The first studio toolkit: a studio in one folder, a multiplayer starter, and deploys to your own Cloudflare.

### Added

- `homie-studio new`: a studio in a new or empty folder (AGENTS.md, games/, music/, videos/, posts/ and site/),
  listing every file it writes.
- The Gem Rush starter on the netplay contract; `build` (esbuild); `dev` (the site and its rooms on your computer);
  and `check` (two fresh Chromes must share a room and finish a round).
- The site Worker: the pages, the play page, the Table and Lobby Durable Objects that run rooms, and
  `/.well-known/homie-studio.json`.
- `deploy` through Wrangler on your own Cloudflare account, refusing any Worker, database or bucket it did not
  create, and `publish` to the homie.rocks directory.
- Plugin: the `studio-setup`, `game` and `publish` skills, and the remote Homie MCP.

[0.20.0]: https://github.com/homie-rocks/homie/pull/30
[0.19.2]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.19.2
[0.19.1]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.19.1
[0.19.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.19.0
[0.18.2]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.18.2
[0.18.1]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.18.1
[0.18.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.18.0
[0.17.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.17.0
[0.16.1]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.16.1
[0.16.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-02-studio-0.16.0
[0.15.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.15.0
[0.14.4]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.4
[0.14.3]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.3
[0.14.2]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.2
[0.14.1]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.1
[0.14.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.14.0
[0.13.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.13.0
[0.12.1]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.12.1
[0.12.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.12.0
[0.11.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.11.0
[0.10.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-10-01-studio-0.10.0
[0.9.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.9.0
[0.8.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.8.0
[0.7.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.7.0
[0.6.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.6.0
[0.5.0]: https://github.com/homie-rocks/homie/releases/tag/release-2026-09-30-studio-0.5.0
[0.3.0]: https://www.npmjs.com/package/@homie-rocks/studio/v/0.3.0
[0.2.0]: https://www.npmjs.com/package/@homie-rocks/studio/v/0.2.0
