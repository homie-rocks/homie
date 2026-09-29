# @homie-rocks/scores

Leaderboards for games played together in one room. A game says what its number
means and which end is good; this package encodes it for the host's score service,
ranks with shared ties (1, 1, 3), splits the board into the people in the room and
everyone else, and renders it once, HTML-escaped, for a TV or a phone. It stores
nothing itself, never guesses a direction or a format, and never shows a refused
save as an empty board.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/scores@0.1.0
```

npm installs its one dependency, `@homie-rocks/ui`, with it.

## Use

```ts
import { timeDimension } from '@homie-rocks/scores/Dimension.js';
import { boxForThisPage } from '@homie-rocks/scores/Box.js';
import { RunBoard } from '@homie-rocks/scores/Run.js';
import { BoardOverlay } from '@homie-rocks/scores/Overlay.js';

const laps = timeDimension('lap-v1', 'Fastest lap', { capMs: 10 * 60_000 });
const box = boxForThisPage();
const run = new RunBoard(laps, box);
const overlay = new BoardOverlay({ box, screen: document.getElementById('app')! });

// When a run ends: record it for everybody at the table, then show the board.
await run.post([{ seat: 0, name: 'Player 1' }], 84213, null);
await overlay.show(run, { title: laps.title, note: null });
```

On a page served by a Homie host, `boxForThisPage()` posts to that host's
`/__homie/call` (`leaderboard.submit`, `leaderboard.top`, `people.list`). Anywhere
else every call is refused at once with a plain sentence, and the board says so.
Any object with `call(name, args)` is a `Box`, so another score service can stand
behind it.

## Modules

| module | what it does |
|---|---|
| `Dimension.js` | What a score means: `timeDimension`, `countDimension`, `placeDimension`. `encode` throws, never clamps. |
| `Box.js` | The seam to the host's score service: `boxForThisPage`, `homieBox`, `offBox`, `servedByBox`. |
| `Board.js` | `Board`: record one seat's score and read the board with competition ranking and shared ties. |
| `Run.js` | `RunBoard`: record one run for everybody at the table; `attributable` drops keyboard seats. |
| `Room.js` | `readSeats`, `roomBoard`: the here/away split; `ROOM_PALETTE` for seat colours. |
| `Panel.js` | `boardPanel`, `boardPanelCSS`, `text`: one escaped renderer for a TV and a phone. |
| `Overlay.js` | `BoardOverlay`: a fixed top-level board layer that shows the refusal when there is one. |
| `System.js` | `BoardSystem`: a base class wiring board, overlay and event subscription for a game. |
| `faults.js` | Deliberate faults for harnesses (`HOMIE_SCORES_FAULT`, `?scoresFault=`). |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
