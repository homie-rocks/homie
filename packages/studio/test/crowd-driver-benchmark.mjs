/** Driver-only proof, not a workerd/Cloudflare capacity claim.
 * A separate thread offers 1,000 sockets 20 Hz chained state with 64 changed
 * remote bodies plus each controlled body. All clients decode every frame.
 */
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { Histogram } from '../lib/crowd-worker.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!isMainThread) {
  const server = createServer((req, res) =>
    res.end(
      `<script>window.HOMIE_NET=${JSON.stringify({ url: `ws://127.0.0.1:${server.address().port}/socket` })}</script>`
    )
  );
  const sockets = new WebSocketServer({ server });
  let k = 0;
  const entity = (id, seat, x) => [
    id,
    0,
    0,
    [x, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
    1,
    [0, 1],
    [],
    seat,
    0
  ];
  sockets.on('connection', (ws) => {
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.t === 'hello') {
        ws.seat = Number(m.name.split(' ')[1]);
        ws.ack = 0;
        ws.pending = [];
        ws.send(
          JSON.stringify({
            t: 'welcome',
            seat: ws.seat,
            token: 't',
            snap: {
              e: 1,
              k,
              d: [
                [1, 'live'],
                [
                  ...Array.from({ length: 64 }, (_, i) =>
                    entity('remote' + i, 2000 + i, k / 100)
                  ),
                  entity('own', ws.seat, k / 100)
                ]
              ],
              c: []
            }
          })
        );
      } else if (m.t === 'in') ws.pending.push(m.k);
      else if (m.t === 'ping')
        ws.send(JSON.stringify({ t: 'pong', c: m.c, st: Date.now() }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const timer = setInterval(() => {
    const base = k++;
    const changed = JSON.stringify(
      Array.from({ length: 64 }, (_, i) => [
        'remote' + i,
        8,
        [[k / 100, i / 100, 0]]
      ])
    );
    for (const ws of sockets.clients) {
      if (ws.seat === undefined || ws.readyState !== 1) continue;
      while (ws.pending[0] <= k) ws.ack = ws.pending.shift();
      ws.send(
        `{"t":"snap","e":1,"k":${k},"d":{"base":${base},"chain":true,"round":[1,"live"],"removed":[],"changed":${changed},"own":${JSON.stringify([entity('own', ws.seat, k / 100)])}},"c":[[${ws.seat},0,${ws.ack},0]]}`
      );
    }
  }, 50);
  parentPort.postMessage({ port: server.address().port });
  parentPort.on('message', () => {
    clearInterval(timer);
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
    server.close();
    parentPort.close();
  });
} else {
  const server = new Worker(new URL(import.meta.url)),
    port = await new Promise((r) => server.once('message', (m) => r(m.port))),
    workers = [];
  const call = (w, op, ...args) =>
    new Promise((resolve, reject) => {
      const id = ++w.seq,
        timer = setTimeout(() => reject(Error('worker timeout')), 120000);
      const listener = (m) => {
        if (m.id === id) {
          clearTimeout(timer);
          w.thread.off('message', listener);
          m.error ? reject(Error(m.error)) : resolve(m.value);
        }
      };
      w.thread.on('message', listener);
      w.thread.postMessage({ id, op, args });
    });
  try {
    for (let i = 0; i < 4; i++) {
      const thread = new Worker(
        new URL('../lib/crowd-worker.mjs', import.meta.url),
        {
          workerData: {
            origin: `http://127.0.0.1:${port}`,
            game: 'g',
            room: 'benchmark',
            index: i,
            workers: 4
          }
        }
      );
      workers.push({ thread, seq: 0 });
    }
    await Promise.all(workers.map((w) => call(w, 'ramp', 1000, 10)));
    await sleep(1000);
    assert.equal(
      (await Promise.all(workers.map((w) => call(w, 'summary')))).reduce(
        (n, s) => n + s.joined,
        0
      ),
      1000
    );
    await Promise.all(workers.map((w) => call(w, 'start')));
    const began = performance.now();
    await sleep(Number(process.env.CROWD_BENCH_SECONDS ?? 30) * 1000);
    const elapsed = (performance.now() - began) / 1000;
    const reports = await Promise.all(workers.map((w) => call(w, 'finish'))),
      players = reports.flatMap((r) => r.players),
      rates = players.map((p) => p.deliveredHz).sort((a, b) => a - b),
      ack = new Histogram();
    for (const r of reports) ack.merge(r.histograms.ack);
    const result = {
      kind: 'driver-only synthetic socket replay',
      clients: 1000,
      seconds: elapsed,
      connected: reports.reduce((n, r) => n + r.connected, 0),
      deliveredHz: { min: rates[0], median: rates[500] },
      inputAckMs: ack.json(),
      workerLoopP99Ms: reports.map((r) => r.loopP99Ms),
      driverLagMaxMs: reports.map((r) => r.peakTimerLagMs),
      rssMiB: process.memoryUsage().rss / 1048576,
      downBytes: reports.reduce((n, r) => n + r.downBytes, 0),
      errors: reports.flatMap((r) => r.errors)
    };
    console.log(JSON.stringify(result));
    assert.equal(result.connected, 1000);
    assert.ok(result.deliveredHz.median >= 19.5);
    assert.ok(result.workerLoopP99Ms.every((ms) => ms < 100));
    assert.equal(result.errors.length, 0);
  } finally {
    await Promise.all(workers.map((w) => w.thread.terminate()));
    server.postMessage('stop');
    await server.terminate();
  }
}
