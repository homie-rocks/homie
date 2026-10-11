#!/usr/bin/env node
/**
 * One crowd step played from inside Cloudflare, through the in-Cloudflare probe (lib/crowd-probe/README.md).
 *
 *   node lib/crowd-cloud.mjs --probe <probe address> --key <PROBE_KEY> --url <studio> --n 300
 *        [--seconds 150] [--room <name>] [--out <dir>] [--ramp-ms 50] [--game crowd-circuit]
 *
 * It opens a request to the probe for every five players, holds them open for the step, and writes report.json in
 * the shape crowd-load.mjs writes (what applies: there is no browser and no home connection in this one).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tally } from './crowd-probe/client.mjs';

const pick = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null);

/** Every probe request's last line, added up into one report. */
export function cloudReport({ origin, room, n, seconds, started, measureAt, endAt, finals, failures = [], toolkit = null }) {
  const players = finals.flatMap((f) => f.players), tallies = { ack: new Tally(), gaps: new Tally(), loops: new Tally() };
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
    tickHz: range('tickHz'), deliveredHz: range('deliveredHz'),
    payload: { upBytes: sum('upBytes'), downBytes: sum('downBytes'), inputFrames: sum('inputs'), downFrames: sum('frames'), wireDownBytes: 0, compressedSockets: 0 },
    // Sockets that never leave Cloudflare are not compressed and cross no home connection.
    compression: { offered: false, sockets: 0, of: players.length, ratio: null },
    inputLead: { ticksMedian: pick(leads, 0.5), ticksMax: leads.at(-1) ?? null, lateShare: sum('reports') ? Math.round(sum('late') / sum('reports') * 1000) / 1000 : null },
    driver: { requests: finals.length, failedRequests: failures.length, workerLoopP99Ms: [], peakTimerLagMs: finals.map((f) => f.worstTimerLagMs) },
    errors: [...errors].map(([text, count]) => ({ text, count })),
    players,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = {};
  for (let i = 2; i < process.argv.length; i += 2) { if (!process.argv[i].startsWith('--') || process.argv[i + 1] === undefined) throw Error('Use --key value'); opts[process.argv[i].slice(2)] = process.argv[i + 1]; }
  const probe = String(opts.probe ?? '').replace(/\/$/, ''), key = opts.key, origin = new URL(opts.url).origin, n = Number(opts.n ?? 50), seconds = Number(opts.seconds ?? 150);
  const rampMs = Number(opts['ramp-ms'] ?? 50), game = opts.game ?? 'crowd-circuit', room = opts.room ?? `cloud-${n}-${Date.now().toString(36)}`, out = resolve(opts.out ?? `reports/crowd-circuit/${room}`);
  if (!probe || !key || !Number.isInteger(n) || n < 1 || n > 1000 || !(seconds >= 1 && seconds <= 600)) throw Error('--probe, --key, --url, --n 1..1000, --seconds 1..600');
  await mkdir(out, { recursive: true });
  const hello = await fetch(`${probe}/hello`, { headers: { 'x-probe-key': key }, signal: AbortSignal.timeout(15000) });
  if (!hello.ok) throw Error(`The probe did not answer (${hello.status}): is it deployed, and is the key its PROBE_KEY?`);
  let toolkit = null;
  try { toolkit = (await (await fetch(`${origin}/.well-known/homie-studio.json?probe=${Date.now()}`, { signal: AbortSignal.timeout(15000) })).json()).toolkit ?? null; } catch { /* reported as null */ }
  // Every request is told the same moments: when its players join (one every ramp-ms), when to start measuring
  // (fifteen seconds after the last has joined) and when to stop.
  const started = Date.now(), joinAt = started + 5000, measureAt = joinAt + n * rampMs + 15000, endAt = measureAt + seconds * 1000;
  console.log(JSON.stringify({ phase: 'start', generator: 'cloudflare', origin, room, n, seconds, requests: Math.ceil(n / 5), toolkit }));
  const finals = [], failures = []; let lastNote = 0; const progress = new Map();
  await Promise.all(Array.from({ length: Math.ceil(n / 5) }, async (_, r) => {
    const from = r * 5, count = Math.min(5, n - from);
    try {
      const res = await fetch(`${probe}/play?origin=${encodeURIComponent(origin)}&game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}&from=${from}&count=${count}&joinAt=${joinAt}&rampMs=${rampMs}&measureAt=${measureAt}&endAt=${endAt}`, { headers: { 'x-probe-key': key }, signal: AbortSignal.timeout(endAt - Date.now() + 60000) });
      if (!res.ok || !res.body) throw Error(`probe HTTP ${res.status}`);
      let text = '', final = null;
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        text += chunk;
        for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n')) {
          const row = JSON.parse(text.slice(0, at)); text = text.slice(at + 1);
          if (row.t === 'final') final = row; else if (row.t === 'failed') throw Error(row.error); else if (row.t === 'sample') progress.set(from, row);
        }
        if (Date.now() - lastNote > 10000) { lastNote = Date.now(); const rows = [...progress.values()]; console.log(JSON.stringify({ phase: rows.some((x) => x.measuring) ? 'steady' : 'ramp', joined: rows.reduce((a, x) => a + x.joined, 0), open: rows.reduce((a, x) => a + x.open, 0) })); }
      }
      if (!final) throw Error('the probe ended without its report');
      finals.push(final);
    } catch (error) { failures.push(`probe request ${from}: ${String(error?.message ?? error).slice(0, 160)}`); }
  }));
  const report = cloudReport({ origin, room, n, seconds, started, measureAt, endAt, finals, failures, toolkit });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ phase: 'done', out: `${out}/report.json`, joined: report.joined, connectedAtEnd: report.connectedAtEnd, ack: report.inputAckMs, loop: report.inputLoopMs, deliveredHz: report.deliveredHz, lead: report.inputLead, failedRequests: failures.length }));
  if (!finals.length) process.exitCode = 1;
}
