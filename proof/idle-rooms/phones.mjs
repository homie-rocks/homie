/**
 * The phones of one room, as a child process: each is the toolkit's real client (rules/view.ts over
 * netplay/netplay.ts, bundled with the Gem Rush view) on a real WebSocket. A process of its own, so a page in the
 * background can be one (`document.hidden`) without hiding anybody else's.
 *
 *   fork('phones.mjs', [viewBundle, socketUrl, count, mode])   mode: idle | hidden | play
 *
 * The parent sends { cmd: 'facts' }, { cmd: 'wake' } (phone 0 drops its socket and comes back with its token, then
 * everybody plays) and { cmd: 'close' }; each answer is one message.
 */
import { pathToFileURL } from 'node:url';

const [bundle, url, countArg, mode] = process.argv.slice(2);
// A page in the background: document.hidden, and the visibilitychange the view and the client listen for.
const shown = new Set();
if (mode === 'hidden') globalThis.document = { hidden: true, addEventListener: (k, fn) => { if (k === 'visibilitychange') shown.add(fn); }, removeEventListener: (k, fn) => shown.delete(fn) };
const { openRoom } = await import(pathToFileURL(bundle).href);
const { snapshotDecoder } = await import(pathToFileURL(new URL('../../packages/studio/rules/interest.mjs', import.meta.url).pathname).href);

/** A WebSocket that also tells the phone what its own body is, from what the room sends it. */
function tap(phone) {
  return class extends WebSocket {
    constructor(u) {
      super(u);
      phone.socket = this;
      this.addEventListener('message', (ev) => {
        if (typeof ev.data !== 'string' || ev.data === 'homie-pong') return;
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') { phone.seat = m.seat; phone.resting = m.rest === true; phone.decoder = snapshotDecoder(); }
        else if (m.t === 'rest') phone.resting = m.on === true;
        else if (m.t === 'snap') {
          phone.snaps += 1;
          const snap = phone.decoder.decode(m);
          const me = snap?.d?.[1]?.find((row) => row[9] === phone.seat && row[10] !== 1);
          if (me) phone.pos = me[3];
        }
      });
    }
  };
}

const phones = [];
async function open(i, previous = null) {
  const phone = previous ?? { i, seat: null, pos: null, resting: false, snaps: 0, decoder: snapshotDecoder(), view: null, mode };
  phone.decoder = snapshotDecoder();
  phone.view = openRoom({ net: { config: { v: 1, url: `${url}&b=phone${i}`, room: 'r', device: 'phone', want: 'play', name: `Phone ${i}` }, WebSocketImpl: tap(phone), post: null } });
  for (let n = 0; n < 200 && phone.view.status !== 'playing'; n++) await new Promise((r) => setTimeout(r, 50));
  return phone;
}
for (let i = 0; i < Number(countArg); i++) phones.push(await open(i));
// Nobody touching anything: the stick at rest, as a page shows it before a thumb lands. A playing phone steers.
const steer = setInterval(() => { for (const p of phones) if (p.mode === 'play') { const t = Date.now() / 700; p.view.input({ ax: Math.round(127 * Math.sin(t + p.i)), ay: Math.round(127 * Math.cos(t)) }); } }, 100);
for (const p of phones) p.view.input({ ax: 0, ay: 0 });

const facts = () => phones.map((p) => ({ seat: p.seat, resting: p.resting, snaps: p.snaps, pos: p.pos, status: p.view.status }));
process.on('message', async (m) => {
  if (m.cmd === 'facts') process.send(facts());
  if (m.cmd === 'wake') {
    // A page in the background comes to the front. Phone 0's socket drops (a phone that slept) and its client
    // reconnects with its token. Then everybody holds the stick.
    if (globalThis.document) { globalThis.document.hidden = false; for (const fn of shown) fn(); }
    const p0 = phones[0], seat = p0.seat;
    p0.seat = null; p0.socket.close();
    for (let n = 0; n < 200 && p0.seat === null; n++) await new Promise((r) => setTimeout(r, 50));
    const before = phones.map((p) => p.pos);
    const at = Date.now(), snaps = phones.map((p) => p.snaps);
    for (const p of phones) { p.mode = 'held'; p.view.input({ ax: 127, ay: 0 }); }
    const hold = setInterval(() => { for (const p of phones) p.view.input({ ax: 127, ay: 0 }); }, 100);
    await new Promise((r) => setTimeout(r, 10_000));
    clearInterval(hold);
    process.send({
      seatKept: p0.seat === seat,
      snapshotsPerPhonePerSecond: Math.round(100 * phones.reduce((a, p, i) => a + p.snaps - snaps[i], 0) / phones.length / ((Date.now() - at) / 1000)) / 100,
      // How far each phone's own body moved on the server in ten seconds of holding the stick (from the room's snapshots).
      movedM: phones.map((p, i) => before[i] && p.pos ? Math.round(10 * Math.hypot(p.pos[0] - before[i][0], p.pos[1] - before[i][1])) / 10 : null),
      resting: phones.some((p) => p.resting),
    });
  }
  if (m.cmd === 'close') { clearInterval(steer); for (const p of phones) p.view.close(); process.send({ closed: true }); setTimeout(() => process.exit(0), 200); }
});
process.send({ ready: phones.map((p) => p.seat) });
