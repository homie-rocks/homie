---
name: playtest
description: Playtest a studio's game the way Homie holds its own games to a bar — real browsers on a computer and a phone held both ways, the first ten seconds timed, the look measured (black or flat frames, contrast, detail), how much of the screen the UI covers, the game's real sound captured and measured, a round played with one person trying and one doing nothing, the owner control tests and two strangers finishing a round — then a blind review by a fresh reviewer that never saw the code, and a ranked list of what is weak. Use when someone asks to playtest, test, review, critique or judge a game, asks what is weak or what to fix next, before calling a game finished or publishing it, and after every change that should make it better.
---

# Playtest a game

The question is never "does it run". It is: **would a stranger who pressed Play stay for a whole
round, and come back?** Instruments measure what can be measured; a fresh reviewer who never saw
the code answers the rest. A builder never grades its own work.

One script: `scripts/playtest.mjs` in this skill's folder (Claude Code:
`node "${CLAUDE_PLUGIN_ROOT}/skills/playtest/scripts/playtest.mjs" <command>`), run from inside the
studio. It needs Node 22, Chrome and the studio's `@homie-rocks/studio` (for puppeteer-core and its
checks). It opens at most two browsers at a time, all muted: nothing plays out loud.

## 1. Run the site and the instruments

Start the site as a background task that outlives the command (Claude Code: the Bash tool's
`run_in_background`), wait until the play page answers, then:

```sh
npm run dev                                     # background: http://127.0.0.1:8787 (another port: npx --no-install homie-studio dev --port <n>)
node <playtest.mjs> run <game id> --url http://127.0.0.1:8787
```

It takes five to ten minutes; poll its output, never end your turn while it runs, and do not rebuild
while it runs (a rebuild under `npm run dev` can stop the dev server). `--only first,look,ui,sound`
runs some rows; `--seconds 30` plays longer. The live site works too (`--url` the studio's address).
Stop the site afterwards with `npx --no-install homie-studio dev --stop`.

| row | what it does | fails when |
| --- | --- | --- |
| `first <device>` | opens the play page like a stranger on a computer, a phone, a phone on its side: time to a seat, to the first real picture, and from the first press to your own body moving; frames per second; the GPU | no seat or no picture in 10 s, a press that moves nothing within 1.5 s |
| `look <device>` | plays like a person (holds a direction most of a second, sometimes the action, changes its mind) and shoots the screen: brightness, contrast, colour, visible detail, black or one-colour frames, holes where nothing drew, frames that did not change | a black or one-colour frame, pure-black holes; WARN for dark, flat, featureless or still frames |
| `ui <phone>` | hides the world, paints the page black then white, and counts what stays: the share of the screen the UI covers and what is opaque in the middle third | over 12% covered, or anything opaque in the middle |
| `sound` | copies what the game sends to its speaker while it is played (no autoplay flag: the real first-touch rule); loudness overall and through a phone speaker, true peak, clipping, gaps, whether each action press answers with a sound, whether music started | silence, clipping; WARN for quiet, gaps, actions without sound, what a phone loses |
| `play` | a computer plays hard and a phone does nothing, in the same public room, for a round that starts after both are in: places, scores, round length against `game.json`, lead changes | no round finishes; WARN when doing nothing scores as well as playing, or everyone ties |
| `controls` | the owner tests from `homie-studio port check`: hold a direction 5 s (one straight line, the camera's yaw moves under 10°), alternate directions 10 s (every press goes the pressed way), real touch on Android Chrome (and iPhone WebKit when Playwright's WebKit is installed; otherwise that row says skip), a killed host, a late joiner, the big screen, audio unlock, errors | any of them (`port` skill: `references/CHECKS.md` says what each failure usually means) |
| `round` | `homie-studio check`: two fresh browsers press Play, meet in one room and both see a round finish with both of them in the results | they do not |
| `errors` | uncaught errors and failed requests seen along the way | any uncaught error |

**BLOCKED is never PASS.** A browser rendering at a few frames a second (a software renderer, a
machine under heavy load) makes any game look stuck: the rows say BLOCKED and judge nothing. Run
again on a quieter machine. "Could not test" and "tested and fine" must never sound the same.

The run writes `.playtest/<game>/<time>/` in the studio (added to `.gitignore`): `REPORT.md`,
`report.json`, contact sheets (`sheet-desk.png`, `sheet-phone.png`, `sheet-phone-landscape.png`),
every screenshot, `sound-capture.wav` and its spectrogram, and the owner-test receipts.
**Open the contact sheets and look at every picture before believing any number.**

## 2. The blind review

```sh
node <playtest.mjs> review .playtest/<game>/<time>
```

It writes `REVIEW.md` in that folder: a brief for a FRESH reviewer, with the pictures, the numbers and
a rubric. Hand its WHOLE TEXT, unchanged, to a reviewer that has not seen the code, the plan or your
summary (Claude Code: the Agent tool with the file's full contents as the prompt, never just its path
or your summary of it; Codex: a new session). Add nothing about what you built or changed. It plays the game itself, scores it
0-100 in eight parts, and returns gaps ranked by impact, each with evidence it saw and one concrete
fix. Its verdict outranks yours. Put it in the run folder as `VERDICT.json`.

Comparing against other games (the person's references, the studio's last version, a game they
admire): give the reviewer frames of each under shuffled labels, scored before the labels are revealed.
A reference is a bar ("is it as good as that"), never a template ("make it look like that").

## 3. Say what is weak

Lead with the numbers and the review, most important first: what fails, then what the reviewer would
fix first. Group findings by cause before proposing work (five complaints about flat shapes are one
missing lighting model, not five jobs). Name the one change that would matter most. Then, if the
person wants, fix it and run the same instruments again; a change that does not measure better than
the version before it is a regression, not progress.

`references/METHOD.md` has the method behind the rows: playing like a person, the five numbers a
round owes you, the scenarios, seats with different strategies, the do-nothing test, the ten-second
test, and the traps that make an instrument lie.

## Never

- Never call a game good, fixed or finished from the code, a build that passed, or your own look at it.
- Never let the builder grade the build: the reviewer is fresh, every time.
- Never script a player to make a number look good; the instruments play like a person on purpose.
- Never leave a room open on a live site: the playtest's browsers leave when it ends; do not start
  more than two browsers of your own beside it.
