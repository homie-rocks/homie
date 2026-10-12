/**
 * A fixed piece of work, the same everywhere it runs: what a room's thread spends its time on, in miniature (parsing
 * players' small messages, building and reading plain objects, arithmetic on floats, writing a block of text).
 *
 * A Worker cannot time a piece of its own work (its clock stands still while its code runs, and reads a timer's due
 * time when the timer fires), so nothing measured on a laptop says by itself what a room costs on Cloudflare. This
 * runs on both: the probe does it inside Cloudflare while `crowd-cloud.mjs --calibrate` holds the stopwatch on the
 * request, and the same call is timed on the computer that asked. The ratio turns `test/crowd-room-cost.mjs`'s
 * milliseconds into Cloudflare's.
 *
 * It returns a number that depends on every step, so no engine may skip the work, and the same number everywhere.
 */
export function referenceWork(rounds = 40) {
  let check = 0, seed = 20261011;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let round = 0; round < rounds; round += 1) {
    // A tick's inputs: five hundred small messages parsed, held to numbers, queued by seat.
    const queues = new Map();
    for (let i = 0; i < 500; i += 1) {
      const text = JSON.stringify({ t: 'in', e: 3914181188, k: 3000 + round, s: [[0, i % 2 ? 127 : -127, Math.round(random() * 70 - 35)]], r: i & 7, g: 2997 + round });
      const m = JSON.parse(text), seat = i * 2;
      const entry = { at: m.k >>> 0, values: { ax: Math.max(-127, Math.min(127, m.s[0][1] | 0)), ay: Math.max(-127, Math.min(127, m.s[0][2] | 0)) } };
      let q = queues.get(seat); if (!q) { q = []; queues.set(seat, q); }
      q.push(entry); check = (check + entry.values.ax + entry.values.ay + text.length) | 0;
    }
    // A tick of a thousand bodies: frozen vectors made and read, a little float arithmetic each.
    const bodies = [];
    for (let i = 0; i < 1000; i += 1) {
      const q = queues.get(i), held = q ? q[q.length - 1].values : { ax: 0, ay: 0 };
      const vel = Object.freeze({ x: Math.fround(held.ax / 127 * 6), y: Math.fround(held.ay / 127 * 6), z: 0 });
      const pos = Object.freeze({ x: Math.fround(random() * 16 - 8 + vel.x * 0.05), y: Math.fround(random() * 120 - 60 + vel.y * 0.05), z: 0 });
      const speed = Math.hypot(vel.x, vel.y);
      bodies.push([`r${i}`, 0, round & 0xffff, [pos.x, pos.y], [vel.x, vel.y], [speed > 0 ? vel.x / speed : 1, speed > 0 ? vel.y / speed : 0], 0, [round, pos.x > 0], [], i, 0]);
      check = (check + Math.round(pos.x * 100) + Math.round(pos.y * 100)) | 0;
    }
    // The world as it leaves: a block of numbers, and the room's checkpoint as text.
    const block = new Float32Array(bodies.length * 6);
    for (const [i, b] of bodies.entries()) block.set([b[3][0], b[3][1], b[4][0], b[4][1], b[5][0], b[5][1]], i * 6);
    const bytes = new Uint8Array(block.buffer); let sum = 0;
    for (let i = 0; i < bytes.length; i += 97) sum += bytes[i];
    const text = JSON.stringify(bodies);
    check = (check + sum + text.length + JSON.parse(text).length) | 0;
  }
  return check;
}
