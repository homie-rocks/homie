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
    // Where the players were: this computer and its connection ('home'), or inside Cloudflare's network.
    from: report.generator === 'cloudflare' ? 'cloudflare' : 'home',
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
      // Did the server agree to compress these sockets, and what it saved (decoded bytes over wire bytes).
      compression: report.compression ?? null,
      // Whole ticks ahead the median player stamped its input, and the share of the room's reports that said late.
      inputLead: report.inputLead ?? null,
      // From the tick a player held when it stamped an input to the tick that input reached the rules: the room,
      // the Gate and the connection both ways, whatever lead the player keeps.
      inputLoopMs: report.inputLoopMs ? { p50: report.inputLoopMs.p50, p95: report.inputLoopMs.p95, p99: report.inputLoopMs.p99 } : null,
      // The driver's own health: a number above this is the driver's, not the server's.
      driverLoopP99Ms: Math.max(0, ...(report.driver?.workerLoopP99Ms ?? [])) || null, driverPeakLagMs: Math.max(0, ...(report.driver?.peakTimerLagMs ?? []).filter(Number.isFinite)) || null,
      driverLimited: Math.max(0, ...(report.driver?.peakTimerLagMs ?? []).filter(Number.isFinite)) > 250 || Math.max(0, ...(report.driver?.workerLoopP99Ms ?? [])) > 30,
      wireKBsPerPlayer: round(seconds && report.joined && wire ? wire / seconds / report.joined / 1000 : null),
      wireMBps: round(wireMBps || null), decodedMBps: round(seconds ? (report.payload?.downBytes ?? 0) / seconds / 1e6 : null),
      errors: (report.errors ?? []).reduce((a, e) => a + (e.count ?? 1), 0),
    },
    link: { downMBps: round(linkMBps), limited: report.generator !== 'cloudflare' && linkMBps && wireMBps ? wireMBps >= linkMBps * 0.8 : null },
    server: {
      samples: during.length, failedPolls: rows.filter((r) => !r.ok).length,
      maxAgeMs: pick(during.map((r) => r.diagnostics?.ageMs), 1),
      // Ticks the rules ran a second, by the room's own clock.
      tickRate: { median: round(pick(during.map((r) => r.tickRate), 0.5)), min: round(pick(during.map((r) => r.tickRate), 0)) },
      // A Gate's stamp on a player's message to the room handling it.
      inputTransitMs: { p50: pick(during.map((r) => r.inputTransitMs?.p50), 0.5), p95: pick(during.map((r) => r.inputTransitMs?.p95), 0.5), max: pick(during.map((r) => r.inputTransitMs?.max), 1) },
      // Inputs that reached the rules after the tick they were stamped for (they apply on the next one).
      lateInputs: (() => { const ins = during.reduce((a, r) => a + (r.ticks.ins ?? 0), 0), late = during.reduce((a, r) => a + (r.ticks.lateEntries ?? 0), 0); return ins ? round(late / ins, 3) : null; })(),
      // Frames a Gate wrote to each of its players a second: the median Gate-second, and the worst.
      gateDeliveredHz: { median: round(pick(gates.map((g) => g.deliveredHz), 0.5)), p05: round(pick(gates.map((g) => g.deliveredHz), 0.05)), min: round(pick(gates.map((g) => g.deliveredHz), 0)) },
      gateWorldHz: { median: round(pick(gates.map((g) => g.worldHz), 0.5)), min: round(pick(gates.map((g) => g.worldHz), 0)) },
      worldAgeMs: { p50: pick(gates.map((g) => g.worldAgeMs?.p50), 0.5), p95: pick(gates.map((g) => g.worldAgeMs?.p95), 0.95), max: pick(gates.map((g) => g.worldAgeMs?.max), 1) },
      roomLinkAckMs: { median: pick(gates.map((g) => g.ackMs), 0.5), max: pick(gates.map((g) => g.maxAckMs), 1) },
      gates: Math.max(0, ...during.map((r) => (r.gates ?? []).length)),
      playersPerGate: (() => { const last = during.at(-1)?.gates ?? []; const c = sorted(last.map((g) => g.subscribed)); return c.length ? { min: c[0], max: c.at(-1) } : null; })(),
      pacedPlayers: pick(during.map((r) => (r.gates ?? []).reduce((a, g) => a + (g.paced ?? 0), 0)), 1),
      coastingPlayers: pick(during.map((r) => (r.gates ?? []).reduce((a, g) => a + (g.coasting ?? 0), 0)), 1),
      // A Gate's own round trip to the room (its event loop's wait is in it): the median Gate-second and the worst.
      // Ticks the room's worlds advanced a second by each Gate's own clock, and the longest a Gate went without one.
      roomTickHzAtGates: { median: round(pick(gates.map((g) => g.roomTickHz), 0.5)), p05: round(pick(gates.map((g) => g.roomTickHz), 0.05)) }, worldGapMsMax: pick(gates.map((g) => g.worldGapMs), 1),
      // The room's clock less a Gate's (median Gate), and how long the room says it held a Gate's frame.
      roomClockOffsetMs: pick(gates.map((g) => g.roomClock?.offsetMs), 0.5), channelDelayMs: pick(gates.map((g) => g.roomClock?.delayMs), 0.5),
      gateRttMs: { median: round(pick(gates.map((g) => g.rttMs), 0.5), 0), p95: round(pick(gates.map((g) => g.rttMs), 0.95), 0) },
      inputOffsetMs: pick(gates.map((g) => g.inputOffsetMs), 0.5),
      clientLagTicks: { p95: pick(gates.map((g) => g.clientLagTicks?.p95), 0.95), max: pick(gates.map((g) => g.clientLagTicks?.max), 1) },
    },
  };
}

/**
 * The columns, in order. Some are easy to misread:
 *   - "from": where the players were. `home` is this computer and its connection, what a real player at home
 *     sees. `cloudflare` is the in-Cloudflare probe: what the servers can do, with no home connection in it.
 *   - "ack": from sending an input to the snapshot that acknowledges its tick. It is never less than the lead.
 *   - "loop": from the tick a player held when it stamped an input to the tick it reached the rules: the room, the
 *     Gate and the connection both ways. This is the latency the system adds, whatever lead the player keeps.
 *   - "lead (late)": whole ticks ahead the median player stamps its input, and the share the room called late.
 *   - "room Hz at Gates": ticks the room's worlds advanced a second by the GATES' clocks. The room's own count of
 *     its ticks cannot see the room run late.
 *   - "world age": a Gate's clock when it wrote a world, less the room's stamp, corrected by the offset between
 *     the two clocks that the Gate measures on its channel.
 *   - "driver": the load driver's worst timer lag. Marked DRIVER when it was over a quarter of a second: that
 *     step's client-side numbers are then the driver's.
 */
export function table(steps) {
  const cell = (v) => (v === null || v === undefined ? '—' : String(v));
  const head = ['N', 'from', 'joined/end/drops', 'ack p50/p95/p99 ms', 'loop p50/p95 ms', 'lead (late)', 'client tick Hz', 'client delivered Hz', 'wire MB/s (link)', 'KB/s a player', 'compressed (ratio)', 'driver lag ms', 'server late', 'Gates', 'room Hz at Gates med/p05', 'Gate delivered Hz med/p05', 'Gate rtt med/p95 ms', 'world age p50/p95 ms', 'paced', 'diag ok/failed'];
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const s of steps) lines.push(`| ${[
    s.n, s.from, `${cell(s.joined)}/${cell(s.connectedAtEnd)}/${cell(s.disconnects)}`,
    `${cell(s.client.inputAckMs.p50)}/${cell(s.client.inputAckMs.p95)}/${cell(s.client.inputAckMs.p99)}`,
    `${cell(s.client.inputLoopMs?.p50)}/${cell(s.client.inputLoopMs?.p95)}`,
    `${cell(s.client.inputLead?.ticksMedian)} (${cell(s.client.inputLead?.lateShare)})`,
    cell(s.client.tickHz.median), cell(s.client.deliveredHz.median),
    `${cell(s.client.wireMBps)} (${cell(s.link.downMBps)}${s.link.limited ? ', LINK-LIMITED' : ''})`,
    cell(s.client.wireKBsPerPlayer),
    s.client.compression ? `${s.client.compression.sockets}/${s.client.compression.of} (${cell(s.client.compression.ratio)})` : cell(s.client.compressedSockets),
    `${cell(s.client.driverPeakLagMs === null ? null : Math.round(s.client.driverPeakLagMs))}${s.client.driverLimited ? ' DRIVER' : ''}`,
    cell(s.server.lateInputs), cell(s.server.gates || null),
    `${cell(s.server.roomTickHzAtGates.median)}/${cell(s.server.roomTickHzAtGates.p05)}`,
    `${cell(s.server.gateDeliveredHz.median)}/${cell(s.server.gateDeliveredHz.p05)}`, `${cell(s.server.gateRttMs.median)}/${cell(s.server.gateRttMs.p95)}`,
    `${cell(s.server.worldAgeMs.p50)}/${cell(s.server.worldAgeMs.p95)}`, cell(s.server.pacedPlayers),
    `${s.server.samples}/${s.server.failedPolls}`,
  ].join(' | ')} |`);
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? '.');
  const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
  const steps = [];
  for (const name of readdirSync(dir).filter((n) => /^n\d+(-cloud)?$/.test(n)).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10) || a.length - b.length)) {
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
