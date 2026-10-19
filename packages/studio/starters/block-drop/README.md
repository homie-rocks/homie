# Block Drop

Start here for a falling-block puzzle. It already plays: preserve the working mechanic while adding the requested theme or features.

- `rules.ts`: each stationary player owns a 10×20 well. Immutable lists are copied, changed and assigned. Seven-piece bags use the room's saved random source. People and bots share one legal input path, but never one well. Room events alone end rounds.
- `pieces.ts`: shared immutable piece geometry and collision checks. The view's ghost uses the same cells as the rules.
- `move.ts`: an intentionally empty movement handler with maxSpeed 0. Movement probes are N/A; real keyboard/touch tests prove board controls.
- `view.ts`: player identity comes from `room.me.seat` and `room.roster`. The full well fits above the native touch buttons. Effects unlock audio on real input. No score is decided in the view.

Build and repair the exact diagnostic before adding more. A file write replaces its entire contents; use targeted edits for small repairs. After an interrupted edit, read the file before continuing.

Exercise left/right, rotation, soft and hard drop on keyboard and with real touchscreen taps. Play two independent wells, clear a row, top out, finish/restart a round and join a bot's seat. Inspect computer, phone and sideways-phone frames. A green movement probe or compiler alone does not prove a board game plays.

The room uses `rest: "quiet"`: gravity and the round clock keep running while a connected person watches. Do not use the movement starters' away-from-keyboard `idle` pause for this continuous falling-block game. Empty rooms still stop normally.
