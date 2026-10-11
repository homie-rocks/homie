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

## Remove

```sh
npx wrangler delete --name homie-crowd-probe
```

## What it needs of Cloudflare

- A paid plan: a request plays five players for minutes (the free plan's 10 ms of CPU a request is not enough).
- Six connections open at once per request, which is why a request plays five players.
- `global_fetch_strictly_public`, so its sockets reach the studio by its public address as a player's do.
