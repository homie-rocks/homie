import { prepareRuntimeFixture } from './rules-kit.mjs';
/**
 * Real wall time, real sockets, real Chrome. One browser; the same relay and host the Worker uses, in this process.
 * Every page is in a window of its own (a browser context): a tab opened beside the hosting page would hide it, and a
 * hidden host hands its room on, which is the second test's subject and must not happen in the first by accident.
 * Skipped, and said so, where no Chrome can be started.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { WebSocketServer } from 'ws';
import { findChrome, chromeArgs } from '../lib/chrome.mjs';
import { viewPlugin } from '../lib/rules-build.mjs';
import { NetRoom } from '../worker/room.mjs';
import { PKG, esbuildOf, loadGame, writeGame } from './rules-kit.mjs';
import { source } from './rules-feature-kit.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const within = (promise, ms) => Promise.race([promise, sleep(ms)]);

const extended = process.env.RULES_EXTENDED === '1';
const cases = [
  ...[20, 30, 60].map(hz => ({ name: `effects-${hz}`, hz })),
  ...[20, 60, 120].flatMap(late => [1, 2].map(players => ({ name: `late-${late}-${players}`, late, players }))),
  { name: 'five-asks', asks: true }, { name: 'twelve-joins', joins: true, players: 1 },
  { name: 'emotes', hz: 60, emotes: true, players: 8 },
];

async function chrome(t) {
  if (!findChrome()) { t.skip('Set CHROME_PATH to run real-time traffic.'); return null; }
  try { return await puppeteer.launch({ executablePath: findChrome(), headless: true, args: chromeArgs(), timeout: 20000 }); }
  catch (e) { t.skip(`Chrome cannot start: ${e.message.split('\n')[0]}`); return null; }
}

/**
 * One scenario's rooms: the game built for each hosting mode, a relay for each on one local port, and `open` for a
 * page in its own window. `relay.wire` is every socket of that room in the order they connected, with what the relay
 * took from it and sent to it.
 */
async function stage(browser, esbuild, scratch, scenario, modes) {
  const rooms = new Map(), bundles = new Map(), contexts = [], hosts = [];
  const server = createServer((req, res) => {
    res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(bundles.get(req.url) ?? '<script type="module">import {openRoom} from "./view.js"; window.openRoom=openRoom;</script>');
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (socket, req) => {
    const room = rooms.get(new URL(req.url, 'http://local').pathname.split('/')[1]);
    const log = { in: [], out: [], at: [] }; room.wire.push(log);
    const wire = room.attach({ send: (text) => { log.out.push(text); log.at.push(performance.now()); socket.send(text); }, close: (code, why) => socket.close(code, why), buffered: () => socket.bufferedAmount });
    socket.on('message', (text) => { log.in.push(String(text)); wire.onMessage(String(text)); }); socket.on('close', () => wire.onClose());
  });
  const beat = setInterval(() => { for (const room of rooms.values()) room.tick(); }, 250);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const close = async () => {
    // Nothing here may wait for ever: a page that will not close, or a connection the browser still holds.
    for (const context of contexts) await within(context.close().catch(() => {}), 5000);
    for (const host of hosts) host.stop();
    clearInterval(beat); for (const socket of sockets.clients) socket.terminate(); sockets.close();
    server.closeAllConnections(); await within(new Promise(resolve => server.close(resolve)), 5000);
  };
  try {
    for (const mode of modes) {
      const id = `${scenario.name}-${mode}`, hz = scenario.hz ?? 20;
      const rulesSource = source.replace('commands: { done: {}, ask: {} }', 'effects: { pulse: { tick: f.u32() } }, commands: { done: {}, ask: {} }')
        .replace('bots: { keep: 2 }', 'bots: { keep: 0 }')
        .replace('self.level = world.level;', "self.level = world.level; world.emit('pulse', self.pos, { tick: world.tick });")
        .replace("start(world) { world.ask('director', { danger: 1 }); }", 'start() {}')
        .replace('seconds: 3, breakSeconds: 1', scenario.late ? 'seconds: 2, breakSeconds: 0.2' : 'seconds: 120, breakSeconds: 1');
      const dir = writeGame(scratch, id, { rules: rulesSource }); mkdirSync(join(dir, 'map'));
      writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-100, -100], max: [100, 100] } }));
      const game = { id, dir, players: { max: 16 }, room: { host: mode, tickHz: hz } };
      const rules = await prepareRuntimeFixture(esbuild, scratch, game), L = await loadGame(scratch, dir, id);
      const compiled = L.R.compileRules(L.def, { map: L.R.compileMap(rules.map), settings: rules.settings, seats: 16 });
      const entry = join(scratch, `${id}.ts`), out = join(scratch, `${id}.js`);
      writeFileSync(entry, `export {openRoom} from ${JSON.stringify(join(PKG, 'rules/view.ts'))};`);
      await esbuild.build({ stdin: { contents: `import 'homie:game'; export {openRoom} from ${JSON.stringify(entry)};`, resolveDir: scratch }, bundle: true, format: 'esm', outfile: out, plugins: [viewPlugin(game, rules, entry)], logLevel: 'silent' });
      bundles.set(`/${mode}/view.js`, readFileSync(out, 'utf8'));
      const room = new NetRoom({ code: mode, rules: true, tickHz: hz, maxPlayers: 16, perIp: 32 }); rooms.set(mode, room);
      room.wire = []; room.pages = [];
      if (mode === 'server') {
        const host = L.H.createHost({ game: id, compiled, send: m => room.hostFrame(m), random: () => 0.37,
          clock: { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms + (scenario.late ?? 0)), clearTimer: clearTimeout } });
        hosts.push(host); room.setServerHost(host);
      }
      room.open = async (n, deferred = false) => {
        const context = await browser.createBrowserContext(); contexts.push(context);
        const page = await context.newPage();
        await page.evaluateOnNewDocument(late => {
          Math.random = () => 0.37;
          const timer = window.setTimeout.bind(window);
          window.setTimeout = (fn, ms, ...args) => timer(fn, ms > 0 && ms <= 50 ? ms + late : ms, ...args);
        }, mode === 'browser' ? scenario.late ?? 0 : 0);
        await page.goto(`${origin}/${mode}/`); await page.waitForFunction('window.openRoom');
        await page.evaluate(({ mode, n }) => {
          window.heard = { emotes: 0, pulses: [], rounds: [], snapshots: [] };
          window.connect = () => { window.room = openRoom({ net: { config: { v: 1, url: `${location.origin.replace('http', 'ws')}/${mode}/socket`, room: mode, name: `P${n}`, device: 'desk', want: 'play' }, post: null } });
          room.on('pulse', e => heard.pulses.push(e.tick));
          // Twenty seconds at sixty ticks: the two rooms' ticks overlap however long the other room's pages took to open.
          room.net.on('snapshot', s => { heard.snapshots.push([s.k, s.d]); if (heard.snapshots.length > 1200) heard.snapshots.shift(); });
          room.on('say', e => { if (e.kind === 'emote:wave') heard.emotes++; });
          room.on('round', e => { if (e.phase === 'over') heard.rounds.push(e.n); });
          };
        }, { mode, n });
        if (!deferred) { await page.evaluate(() => connect()); await page.waitForFunction('room.status === "playing"'); }
        return page;
      };
    }
  } catch (error) { await close(); throw error; }
  return { rooms, close };
}

test('Chrome: ordinary browser and server sessions have the same outcomes for thirty real seconds', { skip: !extended && 'long real-time traffic matrix: npm run test:rules:extended' }, async t => {
  const browser = await chrome(t);
  if (!browser) return;
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-traffic-')));
  try {
    const esbuild = await esbuildOf();
    for (const scenario of cases) await t.test(scenario.name, { timeout: 180_000 }, async () => {
      const { rooms, close } = await stage(browser, esbuild, scratch, scenario, ['server', 'browser']);
      try {
        for (const room of rooms.values()) {
          const group = [];
          for (let n = 0; n < (scenario.players ?? 2); n++) group.push(await room.open(n));
          const waiting = [];
          if (scenario.joins) for (let n = 1; n <= 12; n++) waiting.push(await room.open(n, true));
          room.proof = { group, waiting };
        }
        // Both modes are alive together for at least thirty seconds, with no virtual-time policy.
        const started = performance.now();
        for (const room of rooms.values()) {
          if (scenario.joins) for (const page of room.proof.waiting) { await page.evaluate(() => connect()); room.proof.group.push(page); await sleep(70); }
          if (scenario.asks) for (let n = 0; n < 5; n++) { await room.proof.group[1].evaluate(() => room.command('ask')); await sleep(200); }
          if (scenario.emotes) for (let batch = 1; batch <= 3; batch++) {
            await Promise.all(room.proof.group.slice(1).map(page => page.evaluate(() => {
              for (let i = 0; i < 10; i++) room.net.send('emote:wave', { text: 'Wave' });
            })));
            // Space batches from observed delivery, not a page's interval deadline: a delayed
            // socket flush must not compress two batches into the relay's one-second window.
            await room.proof.group[0].waitForFunction(expected => heard.emotes === expected,
              { timeout: 15000 }, (room.proof.group.length - 1) * 10 * batch);
            if (batch < 3) await sleep(1100);
          }
        }
        await sleep(Math.max(0, 30500 - (performance.now() - started)));
        const outcomes = [], snapshots = [];
        for (const relay of rooms.values()) {
          snapshots.push(new Map(await relay.proof.group[0].evaluate(() => heard.snapshots)));
          const observations = [];
          for (const page of relay.proof.group) observations.push(await page.evaluate(() => ({ status: room.status, link: room.net.link, answers: room.me.answered, emotes: heard.emotes, rounds: [...new Set(heard.rounds)], ticks: [...new Set(heard.pulses)] })));
          for (const o of observations) {
            assert.equal(o.status, 'playing'); assert.equal(o.link, 'online');
            assert.ok(o.ticks.length > 100);
            if (!scenario.late) for (let n = 1; n < o.ticks.length; n++) assert.equal(o.ticks[n], o.ticks[n - 1] + 1, 'every effect tick arrives in order');
            if (scenario.late) assert.ok(o.rounds.length >= 3, 'three complete rounds');
          }
          assert.equal(relay.stats.drops, 0, `the ${relay.code} relay dropped nothing`);
          // Two pages whose timers are equally late may change places once, when the relay has measured only the first.
          const elections = relay.stats.elections.map(e => e.why).filter(why => why !== 'first');
          assert.ok(elections.length <= (scenario.late && scenario.players === 2 ? 1 : 0) && elections.every(why => why === 'host-slow'), `${relay.code} elections: ${JSON.stringify(elections)}`);
          outcomes.push({ players: observations.length, answers: scenario.asks ? observations[1].answers : 0, emotes: observations[0].emotes, playing: observations.every(o => o.status === 'playing') });
        }
        assert.deepEqual(outcomes[0], outcomes[1]);
        const common = [...snapshots[0].keys()].filter(k => snapshots[1].has(k)).slice(-10);
        assert.ok(common.length >= 3, 'both hosts expose matching completed ticks');
        for (const tick of common) assert.deepEqual(snapshots[0].get(tick), snapshots[1].get(tick), `same observable state at tick ${tick}`);
        if (scenario.asks) assert.equal(outcomes[0].answers, 5);
        if (scenario.emotes) assert.equal(outcomes[0].emotes, 210);
        if (!scenario.late) {
          // A page beside the host is sent a snapshot a tick by either kind of host.
          const hz = scenario.hz ?? 20, end = performance.now(), rate = relay => relay.wire[1].out.filter((text, n) => relay.wire[1].at[n] > end - 20000 && text.startsWith('{"t":"snap"')).length / 20;
          // A shared runner may deliberately slip the host's wall clock. Throughput
          // is a measurement; rules-view's virtual-clock checks require exactly one
          // delivered snapshot per tick for both hosts at every supported rate.
          for (const relay of rooms.values()) if (relay.wire.length > 1) t.diagnostic(JSON.stringify({ scenario: scenario.name, host: relay.code, tickHz: hz, snapshotsPerSecond: Number(rate(relay).toFixed(1)) }));
        }
      } finally { await close(); }
    });
  } finally { await within(browser.close().catch(() => {}), 10000); rmSync(scratch, { recursive: true, force: true }); }
});

/** How far the snapshots a page was sent go back (0: every one is later than all before it). */
const rewind = (ticks) => { let max = -1, worst = 0; for (const k of ticks) { if (k <= max) worst = Math.max(worst, max - k + 1); max = Math.max(max, k); } return worst; };

test('Chrome: a host that hides, closes or yields hands on its last tick: no page goes back and no effect plays twice', async t => {
  const browser = await chrome(t);
  if (!browser) return;
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-handover-')));
  try {
    const esbuild = await esbuildOf();
    // Virtual-time rules-view tests own rate/seed/handover correctness. Only native
    // visibility and an actual socket close need these release-gate browser cases.
    for (const hz of extended ? [20, 30, 60] : [20]) for (const how of extended ? ['hides', 'closes', 'yields'] : ['hides', 'closes']) await t.test(`${hz} ticks, the host ${how}`, { timeout: 180_000 }, async () => {
      const results = [];
      // Each trial is a room of its own, so the moment within a tick and within the allowances differs.
      for (let trial = 0; trial < (extended ? 3 : 1); trial++) {
        const { rooms, close } = await stage(browser, esbuild, scratch, { name: `handover-${hz}-${how}-${trial}`, hz }, ['browser']);
        try {
          const relay = rooms.get('browser');
          const [a, b, c] = [await relay.open(0), await relay.open(1), await relay.open(2)];
          await sleep(2500 + (trial * 137) % 400);
          assert.equal(await a.evaluate(() => room.net.rulesHosting), true);
          const host = relay.wire[0], watcher = relay.wire[2], from = { in: host.in.length, out: watcher.out.length };
          if (how === 'hides') { const cover = await a.browserContext().newPage(); await cover.goto('about:blank'); await cover.bringToFront(); }
          else if (how === 'closes') await a.browserContext().close();
          else assert.equal(await a.evaluate(() => room.net.handOff()), true);
          await sleep(3000);
          // What the relay took from the old host: the frame just before its first yield or bye is its checkpoint.
          const last = host.in.slice(from.in).map(text => JSON.parse(text)).filter(m => ['ckpt', 'yield', 'bye'].includes(m.t)).map(m => m.t);
          const gave = last.findIndex(t => t !== 'ckpt'), said = gave < 0 ? last : last.slice(Math.max(0, gave - 1), gave + 1);
          const sent = watcher.out.map(text => JSON.parse(text));
          const ticks = sent.filter(m => m.t === 'snap').map(m => m.k), effects = new Map();
          for (const m of sent) if (m.t === 'ev' && m.k === 'fx') effects.set(m.d[0], (effects.get(m.d[0]) ?? 0) + 1);
          const fxTicks = [...effects.keys()];
          results.push({
            said: said.join(' then '), rewind: rewind(ticks), twice: [...effects.values()].filter(n => n > 1).length,
            missing: fxTicks.filter((k, n) => n && k !== fxTicks[n - 1] + 1).length, after: sent.slice(from.out).filter(m => m.t === 'snap').length,
            hosts: [await b.evaluate(() => room.net.rulesHosting), await c.evaluate(() => room.net.rulesHosting)].filter(Boolean).length, drops: relay.stats.drops,
          });
        } finally { await close(); }
      }
      t.diagnostic(`${hz} ticks, the host ${how}: rewind in ms ${JSON.stringify(results.map(r => Math.round(r.rewind * 1000 / hz)))}, effects twice ${JSON.stringify(results.map(r => r.twice))}`);
      for (const r of results) assert.deepEqual(r, { said: `ckpt then ${how === 'closes' ? 'bye' : 'yield'}`, rewind: 0, twice: 0, missing: 0, after: r.after, hosts: 1, drops: 0 });
      for (const r of results) assert.ok(r.after > hz * 2, 'the next host carries on');
    });
  } finally { await within(browser.close().catch(() => {}), 10000); rmSync(scratch, { recursive: true, force: true }); }
});
