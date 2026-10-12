# Measuring a big room

Two tools, both for a trial on your own Cloudflare account. Neither is part of a studio: nothing in a studio's
Worker imports them.

- **From your computer** (`lib/crowd-load.mjs`): simulated players and two real Chrome players over your own
  connection. What a player at home sees, up to what one connection and one computer can carry.

  ```sh
  CHROME_PATH=/path/to/chrome node node_modules/@homie-rocks/studio/lib/crowd-load.mjs \
    --url https://<studio> --n 300 --seconds 150 --room home-300 --out reports/home-300
  ```

- **From inside Cloudflare** (this folder): what the room and its Gates can do, with no home connection in it.

`lib/crowd-diagnostics.mjs` records the room's own figures beside either (a row a second), and
`lib/crowd-summary.mjs <folder>` puts a run's steps in one table. Both players steer as the crowd-circuit
fixture does; for another game, change the input they send.

# The in-Cloudflare crowd probe

A Worker that plays simulated players against a studio from inside Cloudflare's network. It separates what a
studio's room and Gates can do from what one home connection and one busy computer can carry. It is a trial's
tool: no studio's Worker imports it, and it is deleted when the trial is over.

It proves the servers at a given number of players. It does not prove the last hop to a real player: its sockets
never leave Cloudflare, and they are not compressed.

## Deploy (in the account the studio is in, on a paid Workers plan)

```sh
cd node_modules/@homie-rocks/studio/lib/crowd-probe
KEY=$(openssl rand -hex 24)
npx wrangler deploy --var PROBE_KEY:$KEY
```

`wrangler` prints the probe's address (`https://homie-crowd-probe.<account>.workers.dev`). The probe answers
nothing without the key.

## Run one step

```sh
node node_modules/@homie-rocks/studio/lib/crowd-cloud.mjs \
  --probe https://homie-crowd-probe.<account>.workers.dev --key $KEY \
  --url https://<studio> --n 300 --seconds 150 --room cloud-300 --out reports/cloud-300
```

It opens one request to the probe for every five players, each held open for the step, adds up what they
measured, and writes `report.json` in the shape `crowd-load.mjs` writes, so `crowd-summary.mjs` reads both.

## Slow players among them

`--slow-every 10` makes every tenth player a slow one: it takes what it is sent at six frames a second, in order,
as a connection that carries no more does, and says which tick it holds. The report then has `healthy` (everybody
else) beside `slow`: what a slow player costs the players on the same Gate is the difference from the same step
without any. A Worker cannot slow a socket's reads, so this is a slow player and not a slow socket; for a socket
that stops reading, `crowd-load.mjs --slow-every 10` from a computer pauses every tenth player's socket for four
seconds in five.

## How fast Cloudflare runs, against your computer

```sh
node node_modules/@homie-rocks/studio/lib/crowd-cloud.mjs \
  --probe https://homie-crowd-probe.<account>.workers.dev --key $KEY --calibrate reports/calibration.json
```

A Worker's clock stands still while its code runs, so nothing timed on a computer says by itself what the same
work costs on Cloudflare, and a Worker cannot time it either. This runs one fixed piece of work
(`reference-work.mjs`) in the probe, ten rounds a request, with the stopwatch on your computer (a request that
does the work less one that does none, the quickest of several), and the same work on your computer, and writes
the ratio. `crowd-summary.mjs` prints it under a run's tables.

## A whole trial

`run-trial.sh` in this folder runs a plan of steps against a deployed studio: each from your computer and from
inside Cloudflare, the in-Cloudflare steps three times each, one with slow players, the room's own figures beside
every step, the calibration before and after, and one `summary.md`. It deploys nothing.

```sh
cd <your studio>
URL=https://<studio> WORKER=<its worker's name> PROBE_URL=https://homie-crowd-probe.<account>.workers.dev PROBE_KEY=$KEY \
  bash node_modules/@homie-rocks/studio/lib/crowd-probe/run-trial.sh
```

`PLAN=$'300 cloud 3\n600 cloud 3'` chooses the steps ("players mode runs"; the modes are in the script).

## What a room carries, and how to read a trial

One room's rules run in one object on one thread. With the crowd-circuit fixture (light rules, 20 ticks a second)
that was 300 players with margin on Cloudflare, 600 at the edge, and 800 to 1,000 only by luck: the same step gave
10 frames a second or 20, minutes apart. A game with heavier rules carries fewer.

- Run the size you want and twice that size, three times each, at a busy hour. A size is carried when every run
  is clean and twice the size is not falling apart. One clean run proves nothing: at its edge a room is clean or
  not by what else its machine is doing.
- Read **a Gate's round trip to the room** ("Gate rtt"), **the share of worlds over 200 ms old** and **"server
  late"** (inputs that reached the rules after their tick). They are measured from outside the room.
- Do not read the room's word about itself. On Cloudflare a Worker's clock stands still while its code runs and
  reads a timer's due time when the timer fires, so a room that is seconds behind counts no late ticks. For the
  same reason a probe that runs late reports rates that read high; the report's delivered frames a second are
  counted against the room's ticks, not a clock.
- Cloudflare's count of the room's processor time is not in a `wrangler tail` (it reads under 1% for a room that
  is out of time). It is in the GraphQL analytics API (`durableObjectsPeriodicGroups`), which needs an API token
  that may read account analytics.
- `node packages/studio/test/crowd-room-cost.mjs` in the Homie repository says what a tick of the room costs on a
  computer, divided into rules, input and worlds. With the calibration above it compares one game with another;
  it does not predict where a room falls.

## Remove

```sh
npx wrangler delete --name homie-crowd-probe
```

## What it needs of Cloudflare

- A paid plan: a request plays five players for minutes (the free plan's 10 ms of CPU a request is not enough).
- Six connections open at once per request, which is why a request plays five players.
- `global_fetch_strictly_public`, so its sockets reach the studio by its public address as a player's do.
