#!/usr/bin/env node
/**
 * One line a step for a crowd run: what the players saw (the driver's report) beside what the server did (the
 * room's diagnostics, a row a second) and what this computer's connection could carry (the link probe).
 *
 *   node lib/crowd-summary.mjs <run-dir>     reads n<N>/report.json, n<N>/diagnostics.jsonl, n<N>/link.json;
 *                                            writes summary.json and summary.md there and prints the table
 *
 * A step is LINK-LIMITED when the bytes the driver's sockets read reached four fifths of what the probe measured
 * the connection carrying: its client-side latency then measures the connection, and the server's own columns
 * (ticks a second, input transit, frames a Gate wrote per player) are the ones to read.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sorted = (xs) => xs.filter(Number.isFinite).sort((a, b) => a - b);
const pick = (xs, p) => { const a = sorted(xs); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null; };
const round = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

/** `report`: the driver's report.json. `rows`: diagnostics.jsonl, parsed. `link`: { downMBps } or null. */
export function summarize(report, rows = [], link = null) {
  const from = Date.parse(report.measurementStarted ?? ''), to = Date.parse(report.ended ?? '');
  const during = rows.filter((r) => r.ok && r.ticks && (!Number.isFinite(from) || r.at >= from) && (!Number.isFinite(to) || r.at <= to));
  const gates = during.flatMap((r) => (r.gates ?? []).filter((g) => g.subscribed > 0));
  const seconds = report.measuredSeconds || 0;
  const wire = report.payload?.wireDownBytes || report.payload?.downBytes || 0;
  const wireMBps = seconds ? wire / seconds / 1e6 : null;
  const linkMBps = link?.downMBps ?? null;
  return {
    n: report.n, total: report.total, room: report.room, toolkit: report.toolkit ?? null, stopReason: report.stopReason ?? null,
    joined: report.joined, connectedAtEnd: report.connectedAtEnd, disconnects: report.disconnects,
    client: {
      inputAckMs: { p50: report.inputAckMs?.p50 ?? null, p95: report.inputAckMs?.p95 ?? null, p99: report.inputAckMs?.p99 ?? null },
      // A player's tick progression and the frames they received, a second: the median player, and the worst.
      tickHz: { median: round(report.tickHz?.median), min: round(report.tickHz?.min) },
      deliveredHz: { median: round(report.deliveredHz?.median), min: round(report.deliveredHz?.min) },
      receiveGapMs: { p95: report.receiveGapMs?.p95 ?? null, p99: report.receiveGapMs?.p99 ?? null },
      ackExpired: report.ackExpired ?? null,
      compressedSockets: report.payload?.compressedSockets ?? null,
      wireMBps: round(wireMBps), decodedMBps: round(seconds ? (report.payload?.downBytes ?? 0) / seconds / 1e6 : null),
      errors: (report.errors ?? []).reduce((a, e) => a + (e.count ?? 1), 0),
    },
    link: { downMBps: round(linkMBps), limited: linkMBps && wireMBps ? wireMBps >= linkMBps * 0.8 : null },
    server: {
      samples: during.length, failedPolls: rows.filter((r) => !r.ok).length,
      maxAgeMs: pick(during.map((r) => r.diagnostics?.ageMs), 1),
      // Ticks the rules ran a second, by the room's own clock.
      tickRate: { median: round(pick(during.map((r) => r.tickRate), 0.5)), min: round(pick(during.map((r) => r.tickRate), 0)) },
      // A Gate's stamp on a player's message to the room handling it.
      inputTransitMs: { p50: pick(during.map((r) => r.inputTransitMs?.p50), 0.5), p95: pick(during.map((r) => r.inputTransitMs?.p95), 0.5), max: pick(during.map((r) => r.inputTransitMs?.max), 1) },
      lateInputs: (() => { const ins = during.reduce((a, r) => a + (r.ticks.ins ?? 0), 0), late = during.reduce((a, r) => a + (r.ticks.lateEntries ?? 0), 0); return ins ? round(late / ins, 3) : null; })(),
      // Frames a Gate wrote to each of its players a second: the median Gate-second, and the worst.
      gateDeliveredHz: { median: round(pick(gates.map((g) => g.deliveredHz), 0.5)), min: round(pick(gates.map((g) => g.deliveredHz), 0)) },
      gateWorldHz: { median: round(pick(gates.map((g) => g.worldHz), 0.5)), min: round(pick(gates.map((g) => g.worldHz), 0)) },
      worldAgeMs: { p50: pick(gates.map((g) => g.worldAgeMs?.p50), 0.5), p95: pick(gates.map((g) => g.worldAgeMs?.p95), 0.95), max: pick(gates.map((g) => g.worldAgeMs?.max), 1) },
      roomLinkAckMs: { median: pick(gates.map((g) => g.ackMs), 0.5), max: pick(gates.map((g) => g.maxAckMs), 1) },
      gates: Math.max(0, ...during.map((r) => (r.gates ?? []).length)),
      playersPerGate: (() => { const last = during.at(-1)?.gates ?? []; const c = sorted(last.map((g) => g.subscribed)); return c.length ? { min: c[0], max: c.at(-1) } : null; })(),
      pacedPlayers: pick(during.map((r) => (r.gates ?? []).reduce((a, g) => a + (g.paced ?? 0), 0)), 1),
      clientLagTicks: { p95: pick(gates.map((g) => g.clientLagTicks?.p95), 0.95), max: pick(gates.map((g) => g.clientLagTicks?.max), 1) },
    },
  };
}

export function table(steps) {
  const cell = (v) => (v === null || v === undefined ? '—' : String(v));
  const head = ['N', 'joined/end/drops', 'ack p50/p95/p99 ms', 'client tick Hz', 'client delivered Hz', 'wire MB/s (link)', 'server tick Hz med/min', 'input transit p50/p95 ms', 'late inputs', 'Gate delivered Hz med/min', 'world age p95 ms', 'paced', 'diag ok/failed'];
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const s of steps) lines.push(`| ${[
    s.n, `${cell(s.joined)}/${cell(s.connectedAtEnd)}/${cell(s.disconnects)}`,
    `${cell(s.client.inputAckMs.p50)}/${cell(s.client.inputAckMs.p95)}/${cell(s.client.inputAckMs.p99)}`,
    cell(s.client.tickHz.median), cell(s.client.deliveredHz.median),
    `${cell(s.client.wireMBps)} (${cell(s.link.downMBps)}${s.link.limited ? ', LINK-LIMITED' : ''})`,
    `${cell(s.server.tickRate.median)}/${cell(s.server.tickRate.min)}`,
    `${cell(s.server.inputTransitMs.p50)}/${cell(s.server.inputTransitMs.p95)}`, cell(s.server.lateInputs),
    `${cell(s.server.gateDeliveredHz.median)}/${cell(s.server.gateDeliveredHz.min)}`, cell(s.server.worldAgeMs.p95), cell(s.server.pacedPlayers),
    `${s.server.samples}/${s.server.failedPolls}`,
  ].join(' | ')} |`);
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? '.');
  const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
  const steps = [];
  for (const name of readdirSync(dir).filter((n) => /^n\d+$/.test(n)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const report = read(join(dir, name, 'report.json'));
    if (!report) continue;
    const file = join(dir, name, 'diagnostics.jsonl');
    const rows = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }) : [];
    steps.push(summarize(report, rows, read(join(dir, name, 'link.json'))));
  }
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(steps, null, 2));
  writeFileSync(join(dir, 'summary.md'), `${table(steps)}\n`);
  console.log(table(steps));
}
