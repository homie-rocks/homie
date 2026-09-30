# A gameplay trailer (15 to 60 seconds)

Real footage of the studio's own game, cut on the beat of the studio's own music. Free: no
provider, no model, nothing generated.

## 1. The music

The bed is a song from the `music` skill (`--song <slug>` everywhere below): its plan gives the
exact tempo and its bar lines. The best trailer bed has a clear beat and a lift in its first few
bars; `--bed-from-bar <k>` starts the trailer at a later bar (a chorus). With no song, the
trailer runs on the game's own sound and cuts every two seconds.

## 2. The capture

```sh
npm run dev      # as a background task: the studio's site at http://127.0.0.1:8787
node <video.mjs> capture <slug> --game <id> --url http://127.0.0.1:8787 --seconds 60
```

- If another site already holds port 8787, start this one with
  `npx --no-install homie-studio dev --port <free port>`, and check the address answers with
  this studio's name before capturing.
- Stop it afterwards with `npx --no-install homie-studio dev --stop` (this studio's server and
  nothing else).
- It opens the game's big screen (`/<id>/tv`): a spectator in a live public room. The room starts
  at once with bots in empty seats, so there is always a round to film. Nothing is pressed.
- The picture is Chrome's own frame stream with the time each frame was shown; it is laid onto
  30 fps, and a frame the page did not paint in time is held and counted (`heldFrames`). The
  sound is copied off the game's WebAudio output on the audio clock, which is fitted to the page
  clock, so a hit and its sound stay on the same frame.
- Capture two or three times the trailer's length: the edit picks the best moments.
- `--view play` films a seat instead of the big screen, but that seat is taken by the capture and
  stands still (its avatar is idle, and the room counts it). Prefer the big screen. Never script a
  player to look good for the camera: what is filmed is the game as it plays.
- A 3D game on a laptop: check `sourceFps` in `capture.json`; under 30, capture again with fewer
  other programs running, or a smaller `--width`/`--height`.

## 3. Cards

```sh
node <video.mjs> card <slug> --name title --text "GAME NAME" --sub "a one-line promise"
node <video.mjs> card <slug> --name end --text "Play free" --sub "<the play link>" --small "Real gameplay. Empty seats are filled by bots."
```

Cards are drawn in Chrome at 1920x1080 and 1080x1920 (no font setup needed). Keep the title to a
word or three; the end card is where people go next.

## 4. The edit

```sh
node <video.mjs> edl <slug> --length 30 --song <music slug> --title "GAME NAME"
```

`work/edl.json`: a title card of one bar, shots of one bar (two beats when a bar is longer than
2.6 s), the end card on what is left (at least 2.5 s). Shots are the busiest non-overlapping
windows of the capture, measured as motion, that do not look like a shot already picked, shown in
the order they happened. Each shot pushes in slowly (to 1.25x by default, `--push 1` for none)
toward where the picture changes most: a camera move on the real footage, nothing added. Every
cut is on a bar line. Edit it by hand: swap a shot for a better moment (`in` is seconds into the capture),
make one shot two bars long (and shorten another), move the song's start. Keep the total.

## 5. Cut, check, look

```sh
node <video.mjs> cut <slug>
node <video.mjs> sync <slug>
node <video.mjs> sheet <slug> --in videos/<slug>/<slug>.mp4 --every 0.5
node <video.mjs> sheet <slug> --in videos/<slug>/<slug>-vertical.mp4
```

- 16:9 is 1920x1080; 9:16 is 1080x1920 with the whole game frame across the middle over a
  blurred, darkened fill of itself (a crop would hide the action at the edges).
- Sound: the song, with the game's own sound 8 dB under it where the game made any, both
  deliveries at -14 LUFS and -1.5 dBTP; H.264 High, BT.709 tagged, faststart.
- `sync` must pass (every cut within a frame of its beat), and the contact sheets must show the
  game, readable, at every cell. A beat with no onset right on it (a rest, a pickup note just
  before the bar) is listed, not judged: never move a cut off its bar to make the check pass.
- A fixed camera on a whole arena reads small on a phone: prefer moments where players are close
  together, or a bigger push (`--push 1.5`).

## 6. Publish

```sh
node <video.mjs> add <slug> --title "GAME NAME trailer" --kind trailer --for-game <id> --for-song <music slug> --publish
node <video.mjs> publish <slug>
```

The page gets a Play button for the game and the capture's honesty line ("recorded from the
game running in a live public room; seats without a person are the game's own bots").
