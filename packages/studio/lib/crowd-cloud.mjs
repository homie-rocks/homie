#!/usr/bin/env node
/**
 * One crowd step played from inside Cloudflare, through the in-Cloudflare probe (lib/crowd-probe/README.md).
 *
 *   node lib/crowd-cloud.mjs --probe <probe address> --key <PROBE_KEY> --url <studio> --n 300
 *        [--seconds 150] [--room <name>] [--out <dir>] [--ramp-ms 50] [--game crowd-circuit] [--compress on] [--slow-every 10]
 *   node lib/crowd-cloud.mjs --probe <probe address> --key <PROBE_KEY> --calibrate <file>
 *
 * It opens a request to the probe for every five players, holds them open for the step, and writes report.json in
 * the shape crowd-load.mjs writes (what applies: there is no browser and no home connection in this one).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tally } from './crowd-probe/client.mjs';
import { referenceWork } from './crowd-probe/reference-work.mjs';

const pick = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null);

/** Every probe request's last line, added up into one report. */
/**
 * How fast Cloudflare runs the reference work against this computer. A Worker cannot time its own work, so the
 * stopwatch is here: a request that does the work `rounds` times, less a request that does none, each the quickest
 * of several (the least delayed by the connection), divided by the rounds. This process times the same call.
 * `ratio` is Cloudflare's milliseconds over this computer's: what a millisecond of test/crowd-room-cost.mjs costs there.
 */
export async function calibrate({ probe, key, requests = 6, rounds = 10, fetchFn = fetch, now = () => performance.now() }) {
  referenceWork(4);
  const local = [];
  for (let i = 0; i < 5; i += 1) { const at = now(); referenceWork(); local.push(Math.round((now() - at) * 100) / 100); }
  const check = referenceWork(), mine = Math.min(...local);
  const ask = async (n) => { const at = now(); const answer = await (await fetchFn(`${probe}/calibrate?rounds=${n}&i=${Math.round(at)}`, { headers: { 'x-probe-key': key }, signal: AbortSignal.timeout(120000) })).json(); return { ms: Math.round((now() - at) * 100) / 100, ...answer }; };
  const empty = [], worked = [];
  for (let i = 0; i < requests; i += 1) {
    try { empty.push(await ask(0)); } catch { /* one reading fewer */ }
    try { const answer = await ask(rounds); if (answer.ok && answer.rounds === rounds) worked.push(answer); } catch { /* one reading fewer */ }
  }
  const base = Math.min(...empty.map((e) => e.ms)), each = worked.map((w) => Math.round((w.ms - base) / rounds * 100) / 100).sort((a, b) => a - b);
  const of = (ms) => (Number.isFinite(ms) && mine > 0 ? Math.round(ms / mine * 100) / 100 : null);
  return { at: new Date().toISOString(), rounds, localMs: local, emptyRequestMs: empty.map((e) => e.ms), workedRequestMs: worked.map((w) => w.ms), colos: [...new Set(worked.map((w) => w.colo).filter(Boolean))],
    // What the Worker's own clock said the same rounds took: next to the stopwatch's figure, what a clock inside is worth.
    workerOwnClockMs: worked.map((w) => w.own),
    cloudMsARound: { min: each[0] ?? null, median: pick(each, 0.5), max: each.at(-1) ?? null },
    ratio: each.length && Number.isFinite(base) ? { min: of(each[0]), median: of(pick(each, 0.5)), max: of(each.at(-1)) } : null,
    same: worked.every((w) => w.check === check) };
}

export function cloudReport({ origin, room, n, seconds, started, measureAt, endAt, finals, failures = [], toolkit = null, compress = false, lost = 0, roomHz = 20 }) {
  // A probe's clock is a Worker's: it reads a timer's due time and runs slow when the Worker runs late, so a rate
  // timed by it reads high (the fifth trial's rows of 25 to 32 "ticks a second" from a 20-tick room). Frames for
  // each tick the room advanced need no clock: times the room's rate, that is frames a second. (Not for a slow
  // player, whose ticks are the ones it has got to: its rate stays by the clock.)
  const players = finals.flatMap((f) => f.players).map((p) => (Number.isFinite(p.framesPerTick) && !p.slow ? { ...p, clockDeliveredHz: p.deliveredHz, deliveredHz: p.framesPerTick * roomHz } : p)), tallies = { ack: new Tally(), gaps: new Tally(), loops: new Tally() };
  for (const f of finals) for (const key of Object.keys(tallies)) tallies[key].merge(f.tallies?.[key]);
  const of = (key) => players.map((p) => p[key]).filter(Number.isFinite).sort((a, b) => a - b);
  const range = (key) => { const a = of(key); return { count: a.length, min: a[0] ?? null, median: pick(a, 0.5), p50: pick(a, 0.5), max: a.at(-1) ?? null }; };
  const sum = (key) => players.reduce((a, p) => a + (p[key] ?? 0), 0), leads = of('lead');
  const errors = new Map();
  for (const p of players) { for (const text of p.errors ?? []) errors.set(text, (errors.get(text) ?? 0) + 1); if (p.closed && p.closed[1] !== 'probe step complete') { const text = `close: ${p.closed[0]} ${p.closed[1]}`; errors.set(text, (errors.get(text) ?? 0) + 1); } }
  for (const text of failures) errors.set(text, (errors.get(text) ?? 0) + 1);
  const joined = players.filter((p) => p.firstStateMs !== null).length, measured = Math.max(0, (endAt - measureAt) / 1000);
  return {
    generator: 'cloudflare', colos: [...new Set(finals.map((f) => f.colo).filter(Boolean))],
    started: new Date(started).toISOString(), measurementStarted: new Date(measureAt).toISOString(), ended: new Date(endAt).toISOString(),
    origin, room, n, total: n, simulated: n, chromePlayers: 0, toolkit, requestedSeconds: seconds, measuredSeconds: measured, stopReason: finals.length ? null : 'no probe answered',
    joined, connectedAtEnd: players.filter((p) => p.firstStateMs !== null && (!p.closed || p.closed[1] === 'probe step complete')).length,
    disconnects: players.filter((p) => p.closed && p.closed[1] !== 'probe step complete').length,
    firstStateMs: (() => { const a = of('firstStateMs'); return { count: a.length, p50: pick(a, 0.5), p95: pick(a, 0.95), p99: pick(a, 0.99), max: a.at(-1) ?? null }; })(),
    inputAckMs: tallies.ack.json(), receiveGapMs: tallies.gaps.json(),
    // From the tick a player held when it stamped an input to the tick that input reached the rules.
    inputLoopMs: tallies.loops.json(),
    // `tickHz` is by the probe's own clock (see above): above the room's rate, it says the probe ran late.
    tickHz: range('tickHz'), tickHzClock: 'probe', deliveredHz: range('deliveredHz'), framesPerTick: range('framesPerTick'),
    payload: { upBytes: sum('upBytes'), downBytes: sum('downBytes'), inputFrames: sum('inputs'), downFrames: sum('frames'), wireDownBytes: 0, compressedSockets: players.filter((p) => p.compressed).length },
    // Sockets that never leave Cloudflare cross no home connection; with --compress on the studio's Gates compress
    // for them as for a browser (the bytes saved cannot be seen from inside a Worker).
    compression: { offered: Boolean(compress), sockets: players.filter((p) => p.compressed).length, of: players.length, ratio: null },
    // Probe requests whose last word never came: their players were in the room, and are counted from each
    // request's last thirty-second report where there was one.
    lostReports: lost, partialReports: finals.filter((f) => f.t === 'partial').length,
    // --slow-every K: every Kth player takes six frames a second. `healthy` is everybody else: what the slow
    // ones cost them is the difference from the same step without any.
    slowPlayers: players.filter((p) => p.slow).length,
    healthy: (() => {
      const a = players.filter((p) => !p.slow), list = (key) => a.map((p) => p[key]).filter(Number.isFinite).sort((x, y) => x - y);
      const hz = list('deliveredHz'), gap = list('maxStateGapMs');
      return { players: a.length, deliveredHz: { min: hz[0] ?? null, p05: pick(hz, 0.05), median: pick(hz, 0.5) }, maxStateGapMs: { median: pick(gap, 0.5), max: gap.at(-1) ?? null } };
    })(),
    slowInputAckMs: (() => { const t = new Tally(); for (const f of finals) t.merge(f.slowAck); return t.json(); })(),
    slow: (() => { const a = players.filter((p) => p.slow), hz = a.map((p) => p.deliveredHz).filter(Number.isFinite).sort((x, y) => x - y); return a.length ? { players: a.length, deliveredHz: { min: hz[0] ?? null, median: pick(hz, 0.5), max: hz.at(-1) ?? null } } : null; })(),
    inputLead: { ticksMedian: pick(leads, 0.5), ticksMax: leads.at(-1) ?? null, lateShare: sum('reports') ? Math.round(sum('late') / sum('reports') * 1000) / 1000 : null },
    driver: { requests: finals.length, failedRequests: failures.length, workerLoopP99Ms: [], peakTimerLagMs: finals.map((f) => f.worstTimerLagMs) },
    errors: [...errors].map(([text, count]) => ({ text, count })),
    players,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = {};
  for (let i = 2; i < process.argv.length; i += 2) { if (!process.argv[i].startsWith('--') || process.argv[i + 1] === undefined) throw Error('Use --key value'); opts[process.argv[i].slice(2)] = process.argv[i + 1]; }
  const probe = String(opts.probe ?? '').replace(/\/$/, ''), key = opts.key, origin = opts.url ? new URL(opts.url).origin : null, n = Number(opts.n ?? 50), seconds = Number(opts.seconds ?? 150);
  const compress = opts.compress === 'on', rampMs = Number(opts['ramp-ms'] ?? 50), game = opts.game ?? 'crowd-circuit', room = opts.room ?? `cloud-${n}-${Date.now().toString(36)}`, out = resolve(opts.out ?? `reports/crowd-circuit/${room}`);
  if (opts.calibrate) {
    // `--calibrate <file>`: only the reference work, here and in the probe; no players.
    const result = await calibrate({ probe, key });
    await writeFile(resolve(opts.calibrate), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ phase: 'calibrated', localMs: Math.min(...result.localMs), cloudMsARound: result.cloudMsARound, ratio: result.ratio, workerOwnClockMs: result.workerOwnClockMs }));
    process.exit(0);
  }
  const slowEvery = Math.max(0, Math.floor(Number(opts['slow-every'] ?? 0)) || 0);
  if (!probe || !key || !origin || !Number.isInteger(n) || n < 1 || n > 1000 || !(seconds >= 1 && seconds <= 600)) throw Error('--probe, --key, --url, --n 1..1000, --seconds 1..600');
  await mkdir(out, { recursive: true });
  const hello = await fetch(`${probe}/hello`, { headers: { 'x-probe-key': key }, signal: AbortSignal.timeout(15000) });
  if (!hello.ok) throw Error(`The probe did not answer (${hello.status}): is it deployed, and is the key its PROBE_KEY?`);
  let toolkit = null;
  try { toolkit = (await (await fetch(`${origin}/.well-known/homie-studio.json?probe=${Date.now()}`, { signal: AbortSignal.timeout(15000) })).json()).toolkit ?? null; } catch { /* reported as null */ }
  // Every request is told the same moments: when its players join (one every ramp-ms), when to start measuring
  // (fifteen seconds after the last has joined) and when to stop.
  const started = Date.now(), joinAt = started + 5000, measureAt = joinAt + n * rampMs + 15000, endAt = measureAt + seconds * 1000;
  console.log(JSON.stringify({ phase: 'start', generator: 'cloudflare', origin, room, n, seconds, requests: Math.ceil(n / 5), toolkit }));
  const finals = [], failures = []; let lastNote = 0, lost = 0; const progress = new Map();
  await Promise.all(Array.from({ length: Math.ceil(n / 5) }, async (_, r) => {
    const from = r * 5, count = Math.min(5, n - from); let partial = null;
    // Not all at once: a thousand players are two hundred requests.
    await new Promise((done) => setTimeout(done, r * 10));
    try {
      const res = await fetch(`${probe}/play?origin=${encodeURIComponent(origin)}&game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}&from=${from}&count=${count}&joinAt=${joinAt}&rampMs=${rampMs}&measureAt=${measureAt}&endAt=${endAt}${compress ? '&compress=1' : ''}${slowEvery ? `&slowEvery=${slowEvery}` : ''}`, { headers: { 'x-probe-key': key }, signal: AbortSignal.timeout(endAt - Date.now() + 30000) });
      if (!res.ok || !res.body) throw Error(`probe HTTP ${res.status}`);
      let text = '', final = null; partial = null;
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        text += chunk;
        for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n')) {
          const row = JSON.parse(text.slice(0, at)); text = text.slice(at + 1);
          if (row.t === 'final') final = row; else if (row.t === 'partial') partial = row; else if (row.t === 'failed') throw Error(row.error); else if (row.t === 'sample') progress.set(from, row);
        }
        if (Date.now() - lastNote > 10000) { lastNote = Date.now(); const rows = [...progress.values()]; console.log(JSON.stringify({ phase: rows.some((x) => x.measuring) ? 'steady' : 'ramp', joined: rows.reduce((a, x) => a + x.joined, 0), open: rows.reduce((a, x) => a + x.open, 0) })); }
      }
      if (!final) throw Error('the probe ended without its report');
      finals.push(final);
    } catch (error) { failures.push(`probe request ${from}: ${String(error?.message ?? error).slice(0, 160)}`); if (partial) finals.push(partial); else lost += 1; }
  }));
  const report = cloudReport({ origin, room, n, seconds, started, measureAt, endAt, finals, failures, toolkit, compress, lost });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ phase: 'done', out: `${out}/report.json`, joined: report.joined, connectedAtEnd: report.connectedAtEnd, ack: report.inputAckMs, loop: report.inputLoopMs, deliveredHz: report.deliveredHz, lead: report.inputLead, failedRequests: failures.length }));
  if (!finals.length) process.exitCode = 1;
}
