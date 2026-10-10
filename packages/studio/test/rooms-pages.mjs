/** Real Chrome pages through local updates. Start one Preview dev server, then:
 * node packages/studio/test/rooms-pages.mjs http://127.0.0.1:8792 .wrangler/slice-2-studio
 * The standalone soak runs ten sequences of ten updates ten seconds apart, then thirty five seconds apart.
 * --release checks three acknowledged updates without real-time pacing or duration assertions.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { findChrome, chromeArgs } from '../lib/chrome.mjs';

const origin = process.argv[2]; const studio = resolve(process.argv[3]);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname));
const source = resolve(studio, 'games/coin-dash/src/rules.ts');
const original = readFileSync(source, 'utf8'); assert.ok(original.includes('self.score += 1;'));
const meta = () => JSON.parse(readFileSync(resolve(studio, 'site/dist/games.json'), 'utf8')).games.find(g => g.id === 'coin-dash').room;
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: chromeArgs(), timeout: 0 });
const release = process.argv.includes('--release');
const sequences = release ? [[3, 0]] : [...Array.from({ length: 10 }, () => [10, 10000]), [30, 5000]];
let edit = 1;
try {
  for (const [count, gap] of sequences) {
    const room = `updates-${Date.now().toString(36)}`; const clients = []; const errors = []; let sent = 0;
    try {
      for (const mode of ['play', 'play', 'watch']) {
        const context = await browser.createBrowserContext(); const page = await context.newPage();
        page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
        page.on('pageerror', e => errors.push(e.message));
        await page.evaluateOnNewDocument(() => {
          if (window === top) {
            window.roomProof = [];
            addEventListener('message', ev => { if (ev.source === document.querySelector('iframe.game')?.contentWindow && ev.data?.proof === 'room-snapshot') window.roomProof.push(ev.data.frame); });
          } else {
            const Socket = WebSocket;
            window.WebSocket = class extends Socket {
              constructor(...args) {
                super(...args);
                this.addEventListener('message', ev => {
                  let m; try { m = JSON.parse(ev.data); } catch { return; }
                  if (m.t === 'snap' || m.t === 'error') parent.postMessage({ proof: 'room-snapshot', frame: { t: m.t, code: m.code, e: m.e, k: m.k } }, '*');
                });
              }
            };
          }
        });
        const recovery = { epoch: null, firstEpoch: null, tick: null, samples: 0 };
        await page.goto(`${origin}/coin-dash/${mode}?room=${room}`);
        clients.push({ context, page, mode, recovery, seat: undefined, tick: 0, dead: 0, longest: 0, current: false });
      }
      const inspect = async (client, version) => {
        assert.equal(new URL(client.page.url()).searchParams.get('room'), room, 'the top page retains its room');
        for (const m of await client.page.evaluate(() => window.roomProof.splice(0))) {
          if (m.t === 'error' && m.code === 'room-over') errors.push('The room ended.');
          if (m.t !== 'snap' || !Number.isSafeInteger(m.e)) continue;
          const r = client.recovery;
          if (r.epoch !== null) {
            const changes = m.e - r.epoch;
            if (changes < 0 || m.e > r.firstEpoch + sent + 1) errors.push('The room epoch chain broke.');
            // One saved second per replacement, plus one snapshot of observation margin.
            if (m.k < r.tick - 20 * Math.max(0, changes) - 2) errors.push('Recovery replay exceeded its save interval.');
          }
          r.firstEpoch ??= m.e; r.epoch = m.e; r.tick = m.k; r.samples++;
        }
        let facts = null;
        for (const f of client.page.frames().filter(f => f !== client.page.mainFrame())) {
          facts = await f.evaluate(() => { const n = window.__homieNet; return n ? { link: n.link, seat: n.seat, version: n.version, tick: n.lastSnapshot?.k } : null; }).catch(() => null);
          if (facts) break;
        }
        client.current = facts?.link === 'online' && facts.version === version;
        if (!client.current) { client.dead ||= performance.now(); return; }
        if (client.dead) { client.longest = Math.max(client.longest, performance.now() - client.dead); client.dead = 0; }
        if (client.mode === 'play') {
          if (client.seat === undefined) { assert.equal(typeof facts.seat, 'number'); client.seat = facts.seat; }
          assert.equal(facts.seat, client.seat);
        }
        if (typeof facts.tick === 'number') client.tick = facts.tick;
      };

      do { for (const c of clients) await inspect(c, meta().build); if (clients.every(c => c.current)) break; await sleep(100); } while (true);
      assert.ok(clients.every(c => c.current), 'all pages initially online');
      let nextAt = performance.now() + (release ? 0 : 1000), awaitingBuild = null;
      while (true) {
        const now = performance.now();
        const version = meta().build;
        if (awaitingBuild !== null && version !== awaitingBuild) awaitingBuild = null;
        if (release) for (const c of clients) await inspect(c, version);
        if (sent < count && now >= nextAt && awaitingBuild === null && (!release || clients.every(c => c.current))) { writeFileSync(source, original.replace('self.score += 1;', `self.score += ${++edit};`)); sent++; awaitingBuild = version; nextAt = now + gap; }
        for (const c of clients) await inspect(c, version);
        assert.deepEqual(errors, []);
        if (sent === count && awaitingBuild === null && now >= nextAt && clients.every(c => c.current)) break;
        await sleep(100);
      }
      assert.equal(sent, count); assert.ok(clients.every(c => c.current), 'every page is on the current build');
      // Recovery may replay one second per update plus all time spent replacing the Worker.
      // Epoch continuity and the room URL prove identity without assuming machine speed.
      for (const c of clients) { assert.ok(c.recovery.samples > 0, 'socket snapshots were observed'); assert.ok(c.recovery.epoch > c.recovery.firstEpoch, 'the original epoch chain continued'); }
      console.log(JSON.stringify({ updates: count, gapMs: gap, roomKept: true, seatsKept: true, current: true, longestDeadMs: clients.map(c => Math.round(c.longest)) }));
    } finally { for (const c of clients) await c.context.close(); }
  }
} finally { writeFileSync(source, original); await browser.close(); }
