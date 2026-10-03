# Homie plugin

The Homie plugin for Claude Code and Codex: a studio in a box for your AI. It makes games,
music and video, and publishes them from a studio that runs on your own Cloudflare account,
on the free plan.

- **Skills** (`skills/`): `studio-setup`, `plan`, `parallel`, `game`, `port`, `publish`,
  `office`, `servers`, `shop`, `sound`, `music`, `art`, `style`, `models`, `video`, `playtest`, `perf` and `lab`.
- **MCP server** (`.mcp.json`): the Homie MCP server at `https://homie.rocks/mcp`, which has
  creator tools only. Nothing in this folder runs a command on install.
- **The Homie mod** (`hooks/`, `mod/`): a Claude Code mod (Claude Code 2.1.287 or later, the CLI and
  the desktop app's Code tab). Below: what it adds, and everything it does.
- **Manifests:** `.claude-plugin/plugin.json` (Claude Code), `.codex-plugin/plugin.json`
  (Codex), and `plugin.json` (the agent-plugins standard). They say the same thing, and
  `test/manifests.test.mjs` checks that they do. Codex reads the skills and the MCP server and
  ignores the mod.

Install it, and read what a studio is and what it costs, in the
[repository's README](https://github.com/homie-rocks/homie#readme). Report a vulnerability
as [SECURITY.md](SECURITY.md) says.

## The Homie mod

Inside a studio (a folder with `studio.json` at or above where Claude Code runs):

- **The band above the prompt:** `◆ Night Owls · Owl Rush · Checks ▰▰▰▰▱▱ 62% · 4/5 checks ·
  3 playing now · ▶ Play`. One row; parts drop from the end on a narrow terminal. Nothing outside
  a studio.
- **The Studio pane** (`/studio`). It opens by itself when a build starts, where the terminal is
  wide enough for a pane nobody asked for (Claude Code places one from 144 columns, 110 once you
  have opened it yourself); otherwise a toast says `/studio` shows it.
  - **Build:** the build's progress feed: Plan → Build → Checks → Deploy, each check going
    green, the latest check frame (coloured cells in the terminal, a picture on the desktop),
    ▶ Play and ◉ Watch links, Stop the build, and **Watch it live**, a live view of a room of the
    game being built, drawn in the tab.
  - **Rooms:** every live room on the live site and on this computer's dev site, with players and
    AI, Watch and Join links, and **Watch in the pane**. The owner view (`o`) lists who is in each
    room, with **Mute**, **Kick** and **Announce** through the studio's own back office
    (`homie-studio office`). A kick or a mute is only *asked for*: the office answers with a
    one-time link, the pane shows it under "Waiting for your tap", and nothing happens until you
    confirm in your own browser. The mod cannot confirm an ask; no key or command can.
  - **Games:** each game's launch state (private, invite-only beta, public) and remix switch,
    changed the same asked-for way.
  - **Stats:** the studio's own counts (visits, plays, rounds, peak players, where people came
    from), read on request.
  - **Codex:** each Game Codex at a glance (sections filled, open questions, milestones, latest
    lines) and a private link to its page.
  - **Lab:** the Game Lab (the `lab` skill, studio 0.20.0 and later): whether its page is running
    on this computer, with its link, and each game's last lab check: the take, New's phases beside
    Today's, whether each build replays the same frames, and the game's JavaScript per frame in
    both. Read from `.studio/lab/`; nothing is run.
  - **Parts:** see below.
  - **Art:** art direction (the `style` and `models` skills), per game, newest first: the phase
    strip (`Style ✓ → Cast 3/7 → Rigs → Animations → In game`), the look line, the style
    decisions with their state (`·` auto, `~` steered, `●` pinned by use, `■` locked) and who set
    them, a palette's colours, the cast (route, licence, state, cost, **STALE** when made under an
    older decision), the scene budgets as bars (draw calls, triangles, picture memory, first-play
    download; red when over), the spend against the art budget, and licence problems with their
    fix. **Lock** on a decision is your word (`homie-studio style lock`); **Unlock** first asks,
    with what goes stale and what remaking it costs (`style blast`), and unlocks only on Proceed.
    Read from `.studio/art/<game>/latest.json`, which the studio's toolkit writes after every
    `style` and `assets` command; the tab rereads it while it is open.
- **The parts pane** (`/parts`): when Claude builds in parallel (the `parallel` skill), each agent
  with its time, tool calls, files changed and last step, and the build feed's checks for each
  part. It opens by itself when two agents run at once.
- **The arcade** (`/arcade [game]`): play a real Homie game while Claude works, in a public room
  with strangers and bots: Homie Arcade's games, or your studio's own. Click the pad line, then
  the arrow keys or WASD; space acts; Esc gives the keys back to Claude. See "The game bridge".
- **Instant commands** (no Claude turn; they print links or open a pane, and never open a
  browser): `/studio [tab]`, `/play [game]`, `/watch [room|game]`, `/rooms`, `/build`,
  `/codex [game]`, `/deploy-status`, `/perf-numbers [game]` (the perf skill owns `/perf`),
  `/parts`, `/arcade [game]`, and for art direction `/look [game]` (the look and the style
  decisions; it opens the Art tab, since the style skill owns `/style`), `/lock <decision> [game]`
  (your typed words lock it), `/assets [game]` (the cast, the spend, licence problems),
  `/lineup [game]` (the last lineup's flags and where its pictures are; it never renders one) and
  `/rights [game]` (licence problems with their fixes, and the game's `RIGHTS.md`).
- **Guards:** a call is held in Claude Code's own question dialog (Proceed or Cancel), with what
  would change drawn above it and in full in the Hold pane:
  - an edit (Edit, Write, MultiEdit, NotebookEdit) to a file `studio.json` `"protect"` lists, with
    its diff;
  - a production deploy (`homie-studio deploy`, `npm run deploy`, `wrangler deploy`,
    `studio_deploy`, a song or video `publish`), with where it goes, what it creates, the commits
    and files since the last deploy, uncommitted changes, new games, the last checks and who is
    playing;
  - a paid media call (fal, ElevenLabs: the skills' `gen`, `render` and `stems` with `--yes`, the
    models skill's `prop` and `mood` with `--yes`, a request straight at their APIs, a
    connector's generating tool) that would pass `studio.json` `"budget"`, the build's budget or
    the job's cap (a game's models share `art/<game>-models/budget.json`), or whose cost cannot be
    read first, with the estimate from the skill's own `--dry-run`.
  Cancel, a dismissed question, and a run with nobody to ask (`claude -p`) all refuse the call,
  with a reason Claude can act on. The guards hold even in bypass-permissions mode.
- **Refused outright** (nobody is asked; the reason says what to do instead):
  - an Edit, Write or MultiEdit to `games/<id>/codex/decisions.json` that changes the value or the
    state of a decision the person locked, or leaves the file unreadable while one is locked: a
    locked decision changes only through `homie-studio style set … --unlock --reason`, after the
    person saw what goes stale (`style blast`);
  - a production deploy while a public game (not private or invite-only, its source not closed)
    ships an asset whose `assets/manifest.json` entry has no licence, a kind the studio does not
    know, TurboSquid's licence, CC BY without an attribution line, or a licence that forbids
    handing the file on (Quaternius, Mixamo, a EULA, a bought asset, "other") with a remix other
    than `none` or `reference`. When every asset is licensed, the deploy's hold says so;
  - a `git add` or `git commit` that would put a file over 5 MB under `games/` into git (what is
    staged is read from git itself), naming each file and its size: big files go to the studio's
    R2, raw models stay in `art/<slug>/raw/`.
- **Secrets out of tool output:** before Claude reads any tool's result, keys and tokens come
  out: office and stats keys (`hsk_`), progress keys (`hbk_`), agent passes (`hap_…`, whose public
  id stays), Cloudflare tokens and keys, fal, ElevenLabs, Anthropic, OpenAI, GitHub, npm, Stripe,
  AWS and Google keys, bearer tokens, private keys, and any `NAME=value` whose name says key,
  token or secret and whose value looks like one. A one-time owner link goes to the person in
  the Studio pane (Rooms, "Links for you"); Claude reads that it is there.
- **Homie's results, drawn:** the setup status as a checklist with what to do now, a check's and
  a port check's rows, a playtest's verdicts with the weakest first, a deploy with its live link
  and each game's Play, and the Homie MCP's cards; each Homie command's row says what it is in
  words, with the command beside it.

### Studio settings it reads

```json
{
  "protect": ["games/*/game.json", "site/theme.json"],
  "budget": { "usd": 10, "credits": 2000 }
}
```

- `protect`: globs, relative to the studio (`*` within a folder, `**` across folders, a folder
  for everything under it).
- `budget`: the most the studio's media jobs spend in all, per unit: dollars (fal) and credits
  (ElevenLabs), counted from every job's `budget.json`. Each job's own cap still applies; the
  skills refuse past it.

### Its own settings (`/config`, or `pluginConfigs` in settings.json)

| Option | Default | What it turns on |
| --- | --- | --- |
| `paneAutoOpen` | on | The Studio pane when a build starts, the parts pane for two agents |
| `band` | on | The band above the prompt |
| `guardFiles` | on | Holding edits to protected files; refusing changes to locked art decisions and files over 5 MB under `games/` into git |
| `guardDeploys` | on | Holding production deploys; refusing one that ships an asset with no allowed licence |
| `guardSpend` | on | Holding paid media calls past the budget (the models skill's too) |
| `redactSecrets` | on | Taking secrets out of tool output |
| `renderResults` | on | Homie's results and command rows drawn natively |
| `arcade` | on | `/arcade` and the live Watch views |
| `pictures` | `blocks` | `blocks`: frames as coloured cells (any truecolor terminal); `image`: real pixels where the terminal draws images (kitty, Ghostty, iTerm2, WezTerm) |

### Where it draws

| Where | What you get |
| --- | --- |
| `claude` in a terminal | Everything. Pictures are coloured cells (`▀`, two pixels a cell), or real pixels with `pictures: image` |
| The desktop app's Code tab | Everything; pictures are drawn as images (`Svg`), refreshed up to four times a second |
| VS Code's chat panel, `claude -p`, the Agent SDK, cloud sessions | The guards and secret redaction run; nothing draws. The commands print text instead of opening panes, and a held call is refused when nobody can be asked |

## What the Homie mod does

`claude plugin validate plugins/homie` lists what Claude Code reads from the mod (Claude Code
2.1.287):

```text
❯ ./homie.mjs hooks: session.start, session.end, command.run{command=studio}, command.run{command=build},
  command.run{command=rooms}, command.run{command=play}, command.run{command=watch}, command.run{command=codex},
  command.run{command=deploy-status}, command.run{command=perf-numbers}, command.run{command=parts},
  command.run{command=arcade}, command.run{command=look}, command.run{command=lock}, command.run{command=assets},
  command.run{command=lineup}, command.run{command=rights}, tool.call, tool.call{tool=Edit|Write|MultiEdit|NotebookEdit}, tool.call{tool=Bash},
  tool.call{tool=/"^mcp__.+__studio_deploy$"/}, tool.call{tool=/"^mcp__.*(?:fal|eleven).*__"/i}, turn.complete,
  ui.render{component=AbovePrompt}, ui.render{component=Pane}, ui.render{component=AskUserQuestion},
  ui.render{component=ToolUse}, ui.render{component=ToolResult}, ui.render{component=ToolGroup}, ui.message, ui.close
❯ ./homie.mjs calls: $.agent.list, $.clock.every, $.command.register, $.fs.exists, $.fs.list, $.fs.read, $.fs.stat,
  $.http.fetch, $.process.run, $.process.spawn, $.session.cwd, $.session.surfaces, $.store.get, $.store.set,
  $.ui.ask, $.ui.blit, $.ui.close, $.ui.invalidate, $.ui.log, $.ui.open, $.ui.panes, $.ui.resolve, $.ui.toast
❯ ./homie.mjs surface modules: hooks/lib/arcade-pad.mjs
```

**The events it handles:**

- `session.start` / `session.end`: find the studio, register the commands, start a 2-second
  timer that rereads the studio's files; end any game bridge.
- `command.run` (its fifteen commands only).
- `tool.call` (every tool): after the tool ran, take secrets out of its result; note which Homie
  command ran (for drawing it) and which agent ran what (for the parts). It never changes a tool's
  input.
- `tool.call` on Edit, Write, MultiEdit, NotebookEdit (protected files, locked art decisions); on
  Bash (big files into git, deploys and their licences, paid calls); on `studio_deploy` (a deploy
  and its licences); on fal and ElevenLabs connector tools (paid calls): the guards. They hold or
  refuse; they never approve. The mod has no `tool.check` hook, so it cannot approve a call a
  permission rule would ask about or deny.
- `turn.complete`: a part (a subagent) ended; reread the build after a turn.
- `ui.render` on the band, its panes, the question dialog (only for its own holds), and the rows
  and results of Homie commands. Every other site is left to Claude Code.
- `ui.message`: the arcade pad's keys. `ui.close`: a pane closed, so its game bridge ends.

**Its calls, and what each reaches:**

| Call | What for | What it reaches |
| --- | --- | --- |
| `$.fs.exists`, `$.fs.list`, `$.fs.read`, `$.fs.stat` | The studio's own files | `studio.json`, `.studio/` (the build feed, `local.json`, the Game Lab's `server.json` and last checks, art direction's `art/<game>/latest.json`), `games/*/game.json`, `CODEX.md`, `codex/decisions.json` (an edit to it), `assets/manifest.json` (before a deploy) and whether `assets/RIGHTS.md` exists, media jobs' `budget.json`, `.perf/`, `.wrangler/homie-dev.json`, the file a held edit names, and the size of a file a `git add` or `git commit` would stage. Never a key file, the keychain or the environment. It writes no file (no `$.fs.write`) |
| `$.http.fetch` | Live rooms, games and the arcade's list; whether the Game Lab answers; the game bridge | Only the studio's own live site, this computer's dev site and Game Lab (`127.0.0.1`), `*.homie.rocks`, and the bridge's private Unix socket. Any other address is refused in the code |
| `$.process.run` | The back office, stats and codex links; Lock and Unlock (and Unlock's blast radius); deploy summaries; what a commit would stage; prices | Only `node` with the studio's own pinned `homie-studio` (`--json`), `git -C <studio or a folder in it>` (read-only: `rev-parse`, `log`, `status`, `diff`, `diff --cached`), and a media skill's own `--dry-run` (free; it asks the provider's price list). No shell |
| `$.process.spawn` | The game bridge (`mod/bridge.mjs`), only while the arcade or a live Watch is open | One headless Chrome on this computer (below) |
| `$.store.get`, `$.store.set` | The commit of the last deploy, per studio | Claude Code's own store for this plugin, nothing else |
| `$.agent.list` | The parts | The session's subagents (names and states) |
| `$.session.cwd`, `$.session.surfaces` | Which studio; whether anything draws | |
| `$.ui.*` | Its band, panes, toasts, dim transcript lines, holds | |
| `$.clock.every`, `$.command.register` | Its timer and commands | |

It never calls a model (`$.model`), submits a prompt, messages another session, reads settings or
environment variables (`$.settings`, `$.env`), or approves a permission. A test
(`test/mod-lib.test.mjs`) fails if the hooks module calls anything this README does not name.

### The game bridge

A mod has no sockets and no browser, so a pane cannot sit in a netplay room by itself.
`mod/bridge.mjs` does it the way a person's browser does: it starts one headless Chrome on this
computer, opens the game's own page (`/<game>/play`, or `/<game>/watch?room=<id>`), and the game
runs there for real: a seat in a public room with strangers and bots, hosting the room when nobody
else can. The bridge sends the mod what Chrome shows (a screenshot a frame, scaled down) and takes
the keys you press. It needs Node 22 and Google Chrome (or `CHROME_PATH`), and nothing else.

- **Cost, measured on an Apple M4:** about a quarter of one core while you play (Chrome, at the
  lowest priority the computer gives, `nice 15`), and none while the pane is hidden: the page is
  frozen (no JavaScript, no frames). It ends when you leave, when the pane closes, when the mod
  stops pinging it for 45 s, or when Claude Code goes away.
- **Frame rate:** 8 frames a second in the terminal, 4 on the desktop (Claude Code redraws a
  pane up to ten times a second, thirty in the terminal for the shown pane). The picture is
  as many cells as the pane has, two pixels a cell: a 90-column pane is 90×110 pixels.
- **Keys:** a terminal sends no key-up, so a press holds the key for a moment and the terminal's
  own repeat keeps it held.
- **Network:** the bridge talks to Chrome on this computer; Chrome talks to the game's site.

### Limits and what mods cannot do (Claude Code 2.1.287)

- The question dialog takes at most 12 rows of a mod's drawing above it, and counts a row as
  about 38 cells whatever the terminal's width, so a hold's panel there is short; the Hold pane
  has the whole story, and in a terminal too narrow for a pane nobody asked for, dim transcript
  lines do.
- A pane Claude Code opens for a build or a hold, unasked, appears only from 144 columns (110
  once you have opened it yourself).
- The guards read shell text: `$(...)`, aliases, `eval`, `bash -c "..."` and scripts that run a
  deploy or a paid call are not seen. They are a net, not a sandbox; use permission rules for a
  hard block. A shell command that writes a protected file or a locked decision (`sed -i`, `>`)
  is not held, and a big file staged by a script is not seen.
- A mod cannot draw in claude.ai or the Claude app's Chat tab; the Homie MCP's cards (MCP Apps)
  stay the way there.
- Secret patterns are patterns: a key in a format they do not know passes, and a long random
  value after a name like `SOMETHING_KEY=` is hidden even when it is not a secret.

Tested with Claude Code 2.1.287: `claude plugin test plugins/homie` (the mod's tests, every hook,
command and drawing on the terminal and the desktop surface) and
`node --test plugins/homie/test/mod-lib.test.mjs`.

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
