# Crowd Circuit

## Latest
- 2026-10-10: Local proof: N=50 and N=150 repeat completed 180 seconds with two visible Chrome players each. First N=150 ramp overran and is preserved in TOOLKIT-GAPS.md. Measured medians 19.92/19.90 Hz; each successful step had one clock slip. Desktop/touch scoring and reload passed through 75 ms each-way TCP delay. Landing stills are real frames from the 150-player repeat.
- 2026-10-10: Phase A is local only: no commit, no deploy. 1000-seat server room at 20 Hz; 12 m visibility, 1 cm remote precision, 4 m near range and 5 Hz far updates, from the installed guide example.

## Concept and world
A shared 40 × 120 metre shuttle arena. Run between x=8 and x=-8, scoring at alternating lines. Sixty-second rounds and five-second breaks. Constant independent work per runner, no all-pairs contact. Arrivals spread across 1000 spots; leave despawns the body. Two fill bots make an empty local preview playable.

## Characters and art direction
Colourful circular runners on a navy track, amber and mint lines, white own-player outline. A local camera follows the selected player; overview for watchers. Visible entities drawn afresh so spatial exits retain no meshes. Compact top-left HUD, bottom-right shell, chat in its sheet.

## Controls
Computer: arrows/WASD. Phone: drag. Predicted shared movement, normalized diagonals, boundary sweep/slide. No player collisions.

## Rooms and progress
1000 maximum including real browser seats. No persistent progression or saves. Round ranking uses server scores. N in load reports means simulated clients, plus two Chrome players; 1000 simulated + 2 cannot fit and the driver must report this honestly.

## Music and sound
Original short Web Audio checkpoint tone, unlocked on interaction and triggered only by an authoritative score increase. No background music for this measurement game.

## Built from
Homie 0.45.0 coin-dash movement, rules/view framework, palette and gesture guard. Inspected installed @homie-rocks packages; parts catalogue search `crowd` returned no match (14 catalogue parts). Original linear checkpoint mechanic and immediate-mode canvas view; no additional subsystem needed. No external art assets.

## Milestones
Build/types, two-browser check, three-minute local load steps at N=50 and 150 with two visible Chrome windows, then stop all owned processes. Later phase: deployed measurements, churn and redeploy.

## Open questions
Real Cloudflare capacity and cost are unmeasured. Missing packaged docs/rooms-milestone-2-notes.md is tracked in TOOLKIT-GAPS.md.
