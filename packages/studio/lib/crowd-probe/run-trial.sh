#!/usr/bin/env bash
# A crowd trial of one game of a deployed studio, on your own Cloudflare account: each step from your computer and
# from inside Cloudflare, the in-Cloudflare steps three times each (one run does not tell a limit from luck), a
# step with slow players among healthy ones, the room's own figures a second beside every step, how fast Cloudflare
# ran a fixed piece of work against this computer, and one summary.md at the end.
#
# It deploys nothing and changes nothing in the studio. It writes under reports/<game>/trial/<stamp>/ in the
# studio's folder, creates temporary office keys for the diagnostics and revokes them.
#
#   cd <your studio>                       # deployed, with this toolkit installed
#   (cd node_modules/@homie-rocks/studio/lib/crowd-probe && KEY=$(openssl rand -hex 24) && npx wrangler deploy --var PROBE_KEY:$KEY)
#   URL=https://<studio> WORKER=<its worker's name> PROBE_URL=https://homie-crowd-probe.<account>.workers.dev PROBE_KEY=$KEY \
#     bash node_modules/@homie-rocks/studio/lib/crowd-probe/run-trial.sh
#   npx wrangler delete --name homie-crowd-probe      # when the trial is over
#
# Without PROBE_URL only the steps from this computer run. The players steer as the crowd-circuit fixture does:
# for another game, change the input lib/crowd-probe/client.mjs and lib/crowd-worker.mjs send.
#
#   GAME=crowd-circuit                     the game's id
#   PLAN=$'300 home\n600 cloud 3'          a different plan: "players mode [runs]" a line (modes below)
#   LABEL=evening                          a word added to the report folder's name
#   SECONDS_PER_STEP=150                   steady measurement per step
#   EXPECTED_RUNTIME_SHA=<sha256>          stop unless the installed and the deployed toolkit are this build
#   CHROME_PATH=/path/to/chrome            for the two real Chrome players in a step from this computer
#
# Read docs/crowd-transport-0462.md first for what each column can and cannot say. In short: nothing an object
# measures about itself by its own clock is to be trusted on Cloudflare; a Gate's round trip to the room, the share
# of worlds over 200 ms old and the players' own loop are the figures that show a room out of time.
set -euo pipefail
[ -d node_modules/@homie-rocks/studio ] || { echo 'Run this in a studio folder with @homie-rocks/studio installed.'; exit 1; }
: "${URL:?URL=https://<your studio>}"
: "${WORKER:?WORKER=<the name of the studio Worker, as in wrangler.jsonc>}"
GAME="${GAME:-crowd-circuit}"
export WRANGLER_SEND_METRICS=false
# The probe inflates every frame, as a browser does; give zlib's pool room.
export UV_THREADPOOL_SIZE=16
TOOLKIT="$PWD/node_modules/@homie-rocks/studio"
SECONDS_PER_STEP="${SECONDS_PER_STEP:-150}"
PROBE_URL="${PROBE_URL:-}"
PROBE_KEY="${PROBE_KEY:-}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$PWD/reports/$GAME/trial/$STAMP${LABEL:+-$LABEL}"
mkdir -p "$OUT"

# 1. The deployed Worker is this toolkit, byte for byte.
node --input-type=module - "$URL" "$TOOLKIT" "$OUT" <<'JS'
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
const [url, toolkit, out] = process.argv.slice(2);
const { STUDIO_BUILD } = await import(pathToFileURL(`${toolkit}/worker/build-id.mjs`));
const expected = process.env.EXPECTED_RUNTIME_SHA;
if (expected && STUDIO_BUILD.sha256 !== expected) throw Error(`Installed toolkit's runtime is ${STUDIO_BUILD.sha256}, not this build's ${expected}: install that build first`);
const response = await fetch(`${url}/.well-known/homie-studio.json?verify=${Date.now()}`);
if (!response.ok) throw Error(`manifest HTTP ${response.status}`);
const manifest = await response.json();
await writeFile(`${out}/deployment.json`, JSON.stringify(manifest, null, 2));
if (manifest.toolkit?.sha256 !== STUDIO_BUILD.sha256 || manifest.toolkit?.version !== STUDIO_BUILD.version)
  throw Error(`Wrong deployed toolkit: expected ${JSON.stringify(STUDIO_BUILD)}, got ${JSON.stringify(manifest.toolkit)}`);
console.log('Verified deployed runtime', STUDIO_BUILD);
JS

# What this connection carries: twelve parallel downloads from Cloudflare for eight seconds, to nowhere.
probe_link() {
  local file="$1" tmp start end bytes pids=""
  tmp=$(mktemp -d)
  start=$(node -e 'console.log(Date.now())')
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    curl -s -o /dev/null -H 'Referer: https://speed.cloudflare.com/' -A 'Mozilla/5.0' --max-time 8 \
      -w '%{size_download}\n' 'https://speed.cloudflare.com/__down?bytes=100000000' > "$tmp/$i" 2>/dev/null &
    pids="$pids $!"
  done
  wait $pids
  end=$(node -e 'console.log(Date.now())')
  bytes=$(cat "$tmp"/* 2>/dev/null | awk '{s+=$1} END {print s+0}')
  rm -rf "$tmp"
  node -e '
    const [file, bytes, start, end] = process.argv.slice(1);
    const seconds = (end - start) / 1000, down = bytes > 0 && seconds > 0 ? bytes / seconds / 1e6 : null;
    require("fs").writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), streams: 12, seconds, bytes: Number(bytes), downMBps: down }, null, 2));
    console.log("Link before this step:", down === null ? "not measured" : down.toFixed(2) + " MB/s (" + (down * 8).toFixed(0) + " Mbit/s)");
  ' "$file" "$bytes" "$start" "$end"
}

TAIL_PID=
DIAG_PID=
cleanup() {
  if [ -n "$DIAG_PID" ]; then kill -TERM "$DIAG_PID" 2>/dev/null || true; wait "$DIAG_PID" 2>/dev/null || true; fi
  if [ -n "$TAIL_PID" ]; then kill -TERM "$TAIL_PID" 2>/dev/null || true; wait "$TAIL_PID" 2>/dev/null || true; fi
  # Whatever finished is summarised, even when a step failed.
  node "$TOOLKIT/lib/crowd-summary.mjs" "$OUT" || true
  printf 'All reports: %s\nSummary: %s\n' "$OUT" "$OUT/summary.md"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# The tail is sampled by Cloudflare under load and is not the record; diagnostics.jsonl is.
# Only failures are kept, so the sample is not spent on healthy requests.
./node_modules/.bin/wrangler tail "$WORKER" --format json --status error > "$OUT/worker-tail.jsonl" 2> "$OUT/worker-tail.stderr" &
TAIL_PID=$!
sleep 3
kill -0 "$TAIL_PID" 2>/dev/null || { printf 'Worker tail did not start (the run continues without it): %s\n' "$OUT/worker-tail.stderr"; TAIL_PID=; }
# One step: the diagnostics collector beside a driver. $1 the step's folder, $2 the room, the rest the driver's command.
run_step() {
  local STEP="$1" ROOM="$2"; shift 2
  mkdir -p "$STEP"
  # The collector keeps a failed poll as a row and carries on; it is stopped when the step ends.
  node "$TOOLKIT/lib/crowd-diagnostics.mjs" --root "$PWD" --url "$URL" \
    --game "$GAME" --room "$ROOM" --seconds $((SECONDS_PER_STEP + 600)) --out "$STEP/diagnostics.jsonl" \
    > "$STEP/diagnostics.log" 2>&1 &
  DIAG_PID=$!
  local READY=0 WAIT
  for WAIT in $(seq 1 60); do
    if [ -s "$STEP/diagnostics.jsonl" ]; then READY=1; break; fi
    kill -0 "$DIAG_PID" 2>/dev/null || break
    sleep 1
  done
  if [ "$READY" -ne 1 ]; then printf 'Diagnostics did not start for %s; the step runs without them:\n' "$ROOM"; cat "$STEP/diagnostics.log" || true; fi
  local STATUS=0
  "$@" > "$STEP.log" 2>&1 || STATUS=$?
  printf '%s\n' "$STATUS" > "$STEP/driver-exit-code.txt"
  kill -TERM "$DIAG_PID" 2>/dev/null || true
  local DIAG_STATUS=0
  wait "$DIAG_PID" 2>/dev/null || DIAG_STATUS=$?
  printf '%s\n' "$DIAG_STATUS" > "$STEP/diagnostics-exit-code.txt"
  DIAG_PID=
  local ROWS FAILED
  ROWS=$(wc -l < "$STEP/diagnostics.jsonl" 2>/dev/null | tr -d ' ' || echo 0)
  FAILED=$(grep -c '"ok":false' "$STEP/diagnostics.jsonl" 2>/dev/null || true)
  printf '%s finished (driver exit %s; diagnostics %s rows, %s failed polls): %s\n' "$ROOM" "$STATUS" "$ROWS" "${FAILED:-0}" "$STEP/report.json"
  if [ -n "$TAIL_PID" ] && ! kill -0 "$TAIL_PID" 2>/dev/null; then
    printf 'Worker tail stopped; inspect %s\n' "$OUT/worker-tail.stderr"; TAIL_PID=
  fi
  # A Gate gives its channel to the room back ten seconds after its last player leaves: the next step starts clean.
  sleep 15
}

if [ -n "$PROBE_URL" ]; then
  HELLO=$(curl -fsS -H "x-probe-key: $PROBE_KEY" "$PROBE_URL/hello" || true)
  case "$HELLO" in
    *'"probe":2'*) ;;
    '') printf 'The probe at %s did not answer with that key; running from this computer only.\n' "$PROBE_URL"; PROBE_URL= ;;
    *) printf 'The probe at %s is an older one (%s): deploy it again from the installed toolkit (lib/crowd-probe): it has the slow players and the calibration.\n' "$PROBE_URL" "$HELLO"; exit 1 ;;
  esac
fi

# How fast Cloudflare runs a fixed piece of work against this computer: $1 the file. Eight probe requests.
calibrate() {
  [ -n "$PROBE_URL" ] || return 0
  node "$TOOLKIT/lib/crowd-cloud.mjs" --probe "$PROBE_URL" --key "$PROBE_KEY" --calibrate "$1" || true
}
uptime > "$OUT/load-average-start.txt" || true
calibrate "$OUT/calibration-start.json"

# The plan: one step a line, "players mode [repeat]". Modes:
#   home           this computer, compression on (what one home connection carries)
#   home-slow      the same with every tenth player's socket not read for four seconds in five (a real slow socket)
#   home-plain     this computer, compression off
#   cloud          inside Cloudflare, compression off
#   cloud-deflate  inside Cloudflare, compression on
#   cloud-slow, cloud-deflate-slow   the same with every tenth player slow (it takes six frames a second)
# The cloud steps run three times each: one run of each was not enough to tell a limit from luck.
# From home: sizes one connection carries with room to spare. A thousand players on one connection measure the connection.
PLAN="${PLAN:-300 home
300 home-slow
600 home
800 cloud 3
800 cloud-deflate 3
900 cloud 3
900 cloud-deflate 3
1000 cloud 3
1000 cloud-deflate 3
1000 cloud-slow
1000 cloud-deflate-slow}"
printf '%s\n' "$PLAN" | while read -r N MODE REPEAT; do
  [ -n "$N" ] || continue
  for RUN in $(seq 1 "${REPEAT:-1}"); do
    SUFFIX=""; [ "$RUN" -gt 1 ] && SUFFIX="-r$RUN"
    case "$MODE" in
      home|home-plain|home-slow)
        STEP="$OUT/n$N"; COMPRESS=on; EXTRA=()
        if [ "$MODE" = home-plain ]; then STEP="$OUT/n$N-home-plain"; COMPRESS=off; fi
        if [ "$MODE" = home-slow ]; then STEP="$OUT/n$N-home-slow"; EXTRA=(--slow-every 10); fi
        STEP="$STEP$SUFFIX"
        mkdir -p "$STEP"
        uptime > "$STEP/load-average.txt" || true
        probe_link "$STEP/link.json" || true
        # A full room is 998 simulated and two Chrome players.
        SIZE=(--n "$N")
        if [ "$N" -ge 999 ]; then SIZE=(--total 1000); fi
        ROOM="h$(printf '%s' "$MODE" | cut -c6-7)$N-$RUN-$STAMP"
        run_step "$STEP" "$ROOM" node "$TOOLKIT/lib/crowd-load.mjs" --url "$URL" "${SIZE[@]}" \
          --workers 4 --seconds "$SECONDS_PER_STEP" --ramp-ms 50 --rss-mb 3072 --compress "$COMPRESS" ${EXTRA[@]+"${EXTRA[@]}"} --room "$ROOM" --out "$STEP" < /dev/null
        ;;
      cloud|cloud-deflate|cloud-slow|cloud-deflate-slow)
        if [ -z "$PROBE_URL" ]; then continue; fi
        STEP="$OUT/n$N-$MODE$SUFFIX"; COMPRESS=off; EXTRA=(); TAG=c
        case "$MODE" in cloud-deflate*) COMPRESS=on; TAG=cd ;; esac
        case "$MODE" in *-slow) EXTRA=(--slow-every 10); TAG="${TAG}s" ;; esac
        ROOM="$TAG$N-$RUN-$STAMP"
        run_step "$STEP" "$ROOM" node "$TOOLKIT/lib/crowd-cloud.mjs" --probe "$PROBE_URL" --key "$PROBE_KEY" \
          --url "$URL" --n "$N" --seconds "$SECONDS_PER_STEP" --ramp-ms 50 --compress "$COMPRESS" --game "$GAME" ${EXTRA[@]+"${EXTRA[@]}"} --room "$ROOM" --out "$STEP" < /dev/null
        ;;
    esac
  done
done
calibrate "$OUT/calibration-end.json"
uptime > "$OUT/load-average-end.txt" || true
