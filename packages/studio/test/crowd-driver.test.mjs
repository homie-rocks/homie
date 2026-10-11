import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createLoad, Histogram } from '../lib/crowd-worker.mjs';
import { STUDIO_BUILD } from '../worker/build-id.mjs';
import { stageTimings } from '../rules/timing.mjs';
import { runtimeIdentity } from '../lib/build-identity.mjs';

test('room build identity fingerprints the actual runtime sources', () =>
  assert.deepEqual(STUDIO_BUILD, runtimeIdentity()));
test('thread histograms merge samples, not percentiles', () => {
  const a = new Histogram(),
    b = new Histogram();
  for (let i = 0; i < 100; i++) a.add(10);
  b.add(1000);
  a.merge(b);
  assert.deepEqual(a.json(), {
    count: 101,
    p50: 10,
    p95: 10,
    p99: 10,
    max: 1000
  });
});
test('load probe decodes chained snapshots and distinguishes frames from tick progression', async () => {
  const server = createServer((req, res) => {
    res.end(
      `<script>window.HOMIE_NET=${JSON.stringify({ url: `ws://127.0.0.1:${server.address().port}/socket` })}</script>`
    );
  });
  const sockets = new WebSocketServer({ server });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  let socket;
  const messages = [];
  sockets.on('connection', (ws) => {
    socket = ws;
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      messages.push(m);
      if (m.t === 'hello')
        ws.send(
          JSON.stringify({
            t: 'welcome',
            seat: 0,
            snap: {
              e: 1,
              k: 1,
              d: [
                [1, 'live'],
                [
                  [
                    'body',
                    0,
                    0,
                    [0, 0, 0],
                    [0, 0, 0],
                    [1, 0, 0],
                    1,
                    [0, 1],
                    [],
                    0,
                    0
                  ]
                ]
              ],
              c: []
            }
          })
        );
    });
  });
  const load = createLoad({
    origin: `http://127.0.0.1:${server.address().port}`,
    game: 'g',
    room: 'r'
  });
  try {
    await load.connect(0);
    for (let i = 0; i < 100 && load.summary().joined !== 1; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(load.summary().joined, 1);
    load.start();
    for (const k of [2, 4, 6]) {
      socket.send(
        JSON.stringify({
          t: 'snap',
          e: 1,
          k,
          d: {
            base: k === 2 ? 1 : k - 2,
            chain: true,
            round: [1, 'live'],
            changed: [],
            removed: [],
            own: [
              [
                'body',
                0,
                0,
                [k, 0, 0],
                [0, 0, 0],
                [1, 0, 0],
                1,
                [0, 1],
                [],
                0,
                0
              ]
            ]
          },
          c: []
        })
      );
      await new Promise((r) => setTimeout(r, 60));
    }
    const report = await load.finish();
    assert.equal(report.players[0].frames, 3);
    assert.equal(report.players[0].epoch, 1);
    assert.equal(report.players[0].decodeMiss, 0);
    assert.ok(report.players[0].tickHz > report.players[0].deliveredHz * 1.9);
    assert.ok(messages.some((m) => m.t === 'in'));
    assert.equal(report.disconnects, 0);
  } finally {
    await load.finish();
    for (const ws of sockets.clients) ws.terminate();
    await new Promise((r) => sockets.close(r));
    await new Promise((r) => server.close(r));
  }
});

test('stage timing rings retain only the last bounded samples', () => {
  let now = 0;
  const timing = stageTimings(() => now, 3);
  for (const duration of [100, 5, 6, 7]) {
    const start = now;
    now += duration;
    timing.record('send', start);
  }
  assert.deepEqual(timing.facts().ms.send, {
    samples: 3,
    p50: 6,
    p95: 7,
    max: 7
  });
});
