/**
 * The runtime's one save and restore (rules/core.ts, rules/host.ts, rules/pack.ts), by property.
 *
 * Whatever a room is handed, by a player's frame or by its own rules, what it stores is a value its save carries
 * exactly: a room rebuilt from its save saves the same bytes again, and plays the same as the room that kept running.
 * What a declared type cannot hold is stored as the zero of the type or cut to size, in a live room without a word
 * and without an error; a room that was given `noted` is told each one by the field's name.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { COIN_MAP, hostRig, loadGame, writeGame } from './rules-kit.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-rules-save-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const MOVE = `import { defineMove } from '@homie-rocks/studio/rules';
export const move = defineMove({ pawn(body, input, ctx) {
  body.vel = { x: (input.ax / 127) * 4 + body.motion.m * 0, y: body.vel.y * -0.5, z: 0 };
  ctx.map.sweep(body, ctx.math.scale(body.vel, ctx.dt));
} });`;
const RULES = `import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
const cell = f.struct({ n: f.fix(), tag: f.text(12), at: f.vec3(), way: f.dir(), on: f.bit(), who: f.ref(), small: f.i8(), list: f.list(f.i16(), 6), deep: f.map(f.struct({ a: f.u8(), b: f.list(f.fix(), 3) }), 5) });
export default defineRules({ contract: 2, space: { dims: 2 }, move,
  shared: { a: f.fix(), b: f.i32(), c: f.u32(), text: f.text(16), cells: f.map(cell, 6), order: f.list(f.text(8), 8), v: f.vec3(), signs: f.i32() },
  shapes: { events: { carry: { cell, n: f.fix(), key: f.text(8) } }, commands: { set: { cell, a: f.fix(), b: f.i32(), key: f.text(8), wait: f.u8() }, bad: { which: f.u8() } }, effects: { spark: { n: f.fix(), cell } } },
  entities: {
    pawn: { player: true, fields: { score: f.i16({ score: true }), cell, keep: f.map(f.fix(), 4), half: f.fix(), sign: f.i8() }, motion: { m: f.fix(), mv: f.vec3() },
      input: { ax: f.i8(), go: f.press() }, body: { shape: 'circle', radius: 0.4, maxSpeed: 4 },
      tick(world, self) {
        // Arithmetic that tells one zero from the other, and one order of keys from another: a save that changed either shows here.
        self.half = self.half * -0.5;
        self.sign = 1 / self.half < 0 ? -1 : 1;
        self.vel = { x: self.cell.n * -0, y: self.input.ax * 0, z: 0 };
        self.motion.m = self.vel.x;
        const keys = Object.keys(self.keep);
        self.score = (1 / self.motion.m < 0 ? -100 : 100) + (1 / self.cell.n < 0 ? -10 : 10) + keys.length + (keys[0] === '10' ? 1000 : 0) + (1 / self.cell.small < 0 ? -2000 : 0);
      },
      commands: {
        set(world, self, e) {
          self.cell = e.cell; self.half = e.a;
          if (Object.keys(self.keep).length >= 4) self.keep = {};
          self.keep[e.key] = e.a;
          self.motion.mv = e.cell.at;
          world.sendRoom('carry', { cell: e.cell, n: e.a, key: e.key });
          world.after(e.wait + 2, 'carry', { cell: self.cell, n: e.b, key: e.key });
          world.emit('spark', self.pos, { n: e.a, cell: e.cell });
        },
        bad(world, self, e) {
          const none: number[] = [];
          if (e.which === 0) self.half = 0 / 0;
          if (e.which === 1) self.half = 1 / 0;
          if (e.which === 2) self.cell = { ...self.cell, list: [1, 2, 3, 4, 5, 6, 7] };
          if (e.which === 3) self.cell = { ...self.cell, tag: 'thirteen-long' };
          if (e.which === 4) self.keep = { a: 1, b: 2, c: 3, d: 4, e: 5 };
          if (e.which === 5) self.vel = { x: 0, y: -1 / 0, z: 0 };
          if (e.which === 6) self.cell = { ...self.cell, deep: { k: { a: 1, b: [1, 0 / 0] } } };
          if (e.which === 7) world.sendRoom('carry', { cell: self.cell, n: 0 / 0, key: 'k' });
          if (e.which === 8) self.keep = { 'a-key-that-is-longer-than-thirty-two-characters': 1 };
          const any = (v: unknown) => v as never;
          if (e.which === 12) self.keep = any(new Map([['a', 1]]));
          if (e.which === 13) self.cell = { ...self.cell, list: any(new Set([1, 2])) };
          if (e.which === 14) self.cell = any('a text');
          if (e.which === 15) { for (const key of ['a', 'b', 'c', 'd', 'e']) self.keep[key] = 1; self.cell.small = 7; }   // changed in place: one too many keys, and a legal change beside it
          if (e.which === 9) self.half = none[3];     // absent: the zero of the type, not a refusal
          if (e.which === 10) self.half = -0;         // one zero
          if (e.which === 11) self.cell = { ...self.cell, small: -0.3 };   // rounds to the other zero
        },
      },
    },
  },
  room: {
    join(ctx, player) { return { kind: 'pawn', at: { x: player.seat - 2, y: 0, z: 0 } }; },
    on: {
      carry(world, e) {
        if (Object.keys(world.shared.cells).length >= 6) world.shared.cells = {};
        world.shared.cells[e.key] = e.cell;
        world.shared.a = e.n; world.shared.b = e.cell.small; world.shared.v = e.cell.at;
        world.shared.text = e.cell.tag;
        world.shared.order = Object.keys(world.shared.cells);
        world.shared.signs = (1 / world.shared.a < 0 ? -1 : 1) + (1 / world.shared.v.x < 0 ? -10 : 10) + (1 / e.cell.n < 0 ? -100 : 100);
      },
    },
  },
});`;

let loaded = null;
const game = async () => (loaded ??= loadGame(scratch, writeGame(scratch, 'saves', { rules: RULES, move: MOVE }), 'saves').then((L) => ({ L, c: L.R.compileRules(L.def, { map: L.R.compileMap(COIN_MAP), seats: 4 }) })));

/** A small generator of its own, so a failing seed is a failing seed everywhere. */
const dice = (seed) => { let s = seed >>> 0; const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; next.pick = (list) => list[Math.floor(next() * list.length)]; return next; };
const NUMBERS = [0, -0, 1, -1, 0.5, -0.5, 1e-7, -1e-7, 1e-46, -1e-46, -5e-324, 4096.00012, 127, 128, -128, -129, 255, 256, 32767, 32768, 2 ** 31, -(2 ** 31), 2 ** 32, 2 ** 53, 1e38, 3.5e38, 1e308, Infinity, -Infinity, NaN];
const KEYS = ['a', 'b', '10', '2', '007', '1e3', '-5', '4.5', ' 8', 'z', 'é', 'Z', '_x', 'constructor', 'toString', '__proto__', 'x'.repeat(32), 'y'.repeat(33)];
const TEXTS = ['', 'x', 'twelve chars', 'thirteen long', 'é\u{1F600}', '\ud800', 'line\nbreak', '"quoted"', '10'];
/** Anything at all: what a careless or a hostile caller might hand a field. */
function anything(r, depth = 0) {
  const kind = r();
  if (kind < 0.45) return r.pick(NUMBERS);
  if (kind < 0.6) return r.pick(TEXTS);
  if (kind < 0.7) return r.pick([true, false, null, undefined]);
  if (depth > 2) return r.pick(NUMBERS);
  if (kind < 0.85) { const list = []; const n = Math.floor(r() * 9); for (let i = 0; i < n; i += 1) { if (r() < 0.15) list.length += 1; else list.push(anything(r, depth + 1)); } return list; }
  const o = r() < 0.5 ? {} : Object.create(null);
  for (let i = Math.floor(r() * 7); i > 0; i -= 1) Object.defineProperty(o, r.pick(KEYS), { value: anything(r, depth + 1), enumerable: true, writable: true, configurable: true });
  return o;
}
/** A value of roughly the declared shape, with anything at all in some of its places. */
function shaped(r, fd, depth = 0) {
  if (r() < 0.12) return anything(r, depth);
  switch (fd.t) {
    case 'bit': case 'press': return r.pick([true, false, 1, 0]);
    case 'text': case 'ref': return r.pick(TEXTS);
    case 'vec3': case 'dir': return { x: r.pick(NUMBERS), y: r.pick(NUMBERS), z: r.pick(NUMBERS) };
    case 'list': { const list = []; for (let i = Math.floor(r() * (fd.max + 3)); i > 0; i -= 1) { if (r() < 0.1) list.length += 1; else list.push(shaped(r, fd.of, depth + 1)); } return list; }
    case 'map': { const o = {}; for (let i = Math.floor(r() * (fd.max + 3)); i > 0; i -= 1) Object.defineProperty(o, r.pick(KEYS), { value: shaped(r, fd.of, depth + 1), enumerable: true, writable: true, configurable: true }); return o; }
    case 'struct': { const o = {}; for (const [name, sub] of Object.entries(fd.fields)) if (r() > 0.08) o[name] = shaped(r, sub, depth + 1); if (r() < 0.2) o.extra = anything(r, depth + 1); return o; }
    default: return r.pick(NUMBERS);
  }
}
/** Every number in a value, wherever it is: none may be one a JSON number cannot carry. */
function numbers(v, found = []) {
  if (typeof v === 'number') found.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) numbers(x, found);
  return found;
}
const bytesEqual = (a, b, what) => assert.ok(Buffer.compare(a, b) === 0, `${what}\n${new TextDecoder().decode(a).slice(0, 600)}\n${new TextDecoder().decode(b).slice(0, 600)}`);

test('a value held to its declared type packs, travels as JSON and unpacks to itself, whatever was handed in', async () => {
  const { L, c } = await game();
  const fields = [...c.shared, ...c.kindOf.pawn.fields, ...c.kindOf.pawn.motion, ...c.commands.set, ...c.events.carry];
  for (let seed = 1; seed <= 40; seed += 1) {
    const r = dice(seed);
    for (const [name, fd] of fields) for (let i = 0; i < 12; i += 1) {
      const raw = r() < 0.3 ? anything(r) : shaped(r, fd);
      const held = L.P.coerce(fd, raw, c.dims);
      assert.ok(numbers(held).every((n) => Number.isFinite(n) && !Object.is(n, -0)), `seed ${seed} ${name}: a number the save cannot carry was stored`);
      const wire = JSON.stringify(L.P.pack(fd, held, c.dims));
      const back = L.P.unpack(fd, JSON.parse(wire), c.dims);
      assert.deepStrictEqual(back, held, `seed ${seed} ${name}`);
      assert.equal(JSON.stringify(L.P.pack(fd, back, c.dims)), wire, `seed ${seed} ${name}: the same again, keys in the same order`);
      assert.equal(JSON.stringify(L.P.pack(fd, L.P.coerce(fd, held, c.dims), c.dims)), wire, `seed ${seed} ${name}: held twice is held once`);
    }
  }
});

test('a room handed anything saves, rebuilds from its save to the same bytes, and the rebuilt room plays the next 200 ticks the same', async () => {
  const { L, c } = await game();
  const cmd = Object.fromEntries(c.commands.set);
  for (let seed = 1; seed <= 12; seed += 1) {
    const r = dice(seed * 7919);
    const live = hostRig(L, c);
    for (let seat = 0; seat < 3; seat += 1) live.join(seat);
    live.ticks(2);
    let rebuilt = null;
    for (let step = 0; step < 60; step += 1) {
      for (let seat = 0; seat < 3; seat += 1) if (r() < 0.7) { const m = { t: 'ev', from: seat, k: 'cmd', d: ['set', Object.fromEntries(Object.entries(cmd).map(([name, fd]) => [name, shaped(r, fd)]))] }; live.host.frame(m); rebuilt?.host.frame(m); }
      live.ticks(1);
      assert.equal(live.host.core.stats.errors, 0, `seed ${seed}: ${live.host.core.stats.lastError}`);
      assert.ok(numbers(live.host.core.save()).every((n) => Number.isFinite(n) && !Object.is(n, -0)), `seed ${seed}: the live room holds a number its save cannot carry`);
      const bytes = live.host.save();
      // The room rebuilt before this tick was handed the same and has ticked beside it: the same bytes.
      if (rebuilt) { rebuilt.host.tickNow(); bytesEqual(bytes, rebuilt.host.save(), `seed ${seed}, tick ${live.host.tick}: the room rebuilt a tick ago plays differently`); rebuilt.host.stop(); }
      rebuilt = hostRig(L, c, { clock: live.clock, host: { restore: bytes } });
      bytesEqual(bytes, rebuilt.host.save(), `seed ${seed}, tick ${live.host.tick}: the rebuilt room does not save the same again`);
    }
    // The next 200 ticks, beside the room that was never stopped: the same frames to both, the same bytes from both.
    for (let step = 0; step < 200; step += 1) {
      const frames = [];
      for (let seat = 0; seat < 3; seat += 1) {
        frames.push({ t: 'in', from: seat, e: live.host.epoch, k: live.host.tick + 1, r: 0, s: [[0, r.pick([-128, 0, 127]), r() < 0.2 ? 1 : 0]] });
        if (r() < 0.2) frames.push({ t: 'ev', from: seat, k: 'cmd', d: ['set', Object.fromEntries(Object.entries(cmd).map(([name, fd]) => [name, shaped(r, fd)]))] });
      }
      for (const m of frames) { live.host.frame(m); rebuilt.host.frame(m); }
      live.clock.t += 1000 / c.settings.tickHz;
      live.host.tickNow(); rebuilt.host.tickNow();
      bytesEqual(live.host.save(), rebuilt.host.save(), `seed ${seed}: the rebuilt room differs ${step + 1} ticks after it was rebuilt`);
    }
    assert.equal(live.host.core.stats.errors, 0, live.host.core.stats.lastError);
    live.host.stop(); rebuilt.host.stop();
  }
});

test('what a declared type cannot hold is stored as it always was, with no error, and said by name to whoever asks; absent is zero; there is one zero', async () => {
  const { L, c } = await game();
  const adjusted = [
    [0, 'nan', 'pawn.fields.half', 'NaN', (e) => e[17][3] === 0],
    [1, 'infinite', 'pawn.fields.half', 'Infinity', (e) => e[17][3] === 0],
    [2, 'list', 'pawn.fields.cell.list', '7 entries for a size of 6', (e) => e[17][1][7].length === 6],
    [3, 'text', 'pawn.fields.cell.tag', '13 characters for a size of 12', (e) => e[17][1][1] === 'thirteen-lon'],
    [4, 'map', 'pawn.fields.keep', '5 keys for a size of 4', (e) => e[17][2].length === 4],
    [5, 'infinite', 'pawn.vel.y', '-Infinity', (e) => e[8][1] === 0],
    [6, 'nan', 'pawn.fields.cell.deep.k.b[1]', 'NaN', (e) => e[17][1][8][0][1][1][1] === 0],
    [7, 'nan', 'carry.n', 'NaN', () => true],
    [8, 'key', 'pawn.fields.keep', 'a-key-that-is-longer-than-thirty-two-cha', (e) => e[17][2].length === 0],
    [12, 'kind', 'pawn.fields.keep', 'a Map', (e) => e[17][2].length === 0],
    [13, 'kind', 'pawn.fields.cell.list', 'a Set', (e) => e[17][1][7].length === 0],
    [14, 'kind', 'pawn.fields.cell', 'a text', (e) => e[17][1][1] === ''],
    // Changed in place, a collection is held to its type when the handler ends; what else the handler changed is stored.
    [15, 'map in place', 'pawn.fields.keep', '5 keys for a size of 4', (e) => e[17][2].length === 4 && e[17][1][6] === 7],
  ];
  for (const [which, what, at, written, stored] of adjusted) {
    const notes = [];
    const rig = hostRig(L, c, { host: { noted: (kind, handler, ...rest) => { if (handler === 'commands.bad') notes.push([kind, ...rest]); } } }); rig.join(0); rig.ticks(2);
    const quiet = hostRig(L, c); quiet.join(0); quiet.ticks(2);
    for (const room of [rig, quiet]) { room.host.frame({ t: 'ev', from: 0, k: 'cmd', d: ['bad', { which }] }); room.ticks(1); }
    // A live room neither throws nor counts an error: the value is stored as the zero of its type, or cut to its size.
    assert.equal(quiet.host.core.stats.errors, 0, `case ${which}: ${quiet.host.core.stats.lastError}`);
    assert.ok(stored(quiet.host.core.save().ents[0]), `case ${which}: ${JSON.stringify(quiet.host.core.save().ents[0])}`);
    // Being asked changes nothing: the room that was watched holds the same bytes, and was charged the same.
    bytesEqual(rig.host.save(), quiet.host.save(), `case ${which}`);
    assert.equal(rig.host.core.stats.maxUnits, quiet.host.core.stats.maxUnits, `case ${which}`);
    assert.deepEqual(notes[0], ['pawn', what, at, written], `case ${which}: ${JSON.stringify(notes)}`);
    rig.host.stop(); quiet.host.stop();
  }
  for (const which of [9, 10, 11]) {
    const rig = hostRig(L, c); rig.join(0); rig.ticks(2);
    rig.host.frame({ t: 'ev', from: 0, k: 'cmd', d: ['bad', { which }] }); rig.ticks(1);
    assert.equal(rig.host.core.stats.errors, 0, rig.host.core.stats.lastError);
    const saved = rig.host.core.save().ents[0];
    assert.ok(numbers(saved).every((n) => !Object.is(n, -0)), `case ${which}: one zero`);
    const back = hostRig(L, c, { host: { restore: rig.host.save() } });
    rig.ticks(3); back.ticks(3);
    bytesEqual(rig.host.save(), back.host.save(), `case ${which}`);
    rig.host.stop(); back.host.stop();
  }
  // The same values from outside the rules (a player's frame, a save): the zero of the type, or cut to size.
  assert.equal(L.P.coerce({ t: 'fix' }, NaN, 2), 0);
  assert.equal(L.P.coerce({ t: 'u8' }, Infinity, 2), 255);
  assert.deepEqual(L.P.coerce({ t: 'list', max: 2, of: { t: 'u8' } }, [1, 2, 3], 2), [1, 2]);
  assert.equal(L.P.coerce({ t: 'text', max: 3 }, 'four', 2), 'fou');
});

test('a save of another revision is refused as one, and the revision is part of the state hash', async () => {
  const { L, c } = await game();
  const { stateHash } = await import('../lib/rules-build.mjs');
  const rig = hostRig(L, c); rig.join(0); rig.ticks(3);
  const saved = L.P.fromBytes(rig.host.save());
  assert.equal(saved.core.v, L.R.SAVE_REVISION);
  assert.equal(c.save, L.R.SAVE_REVISION);
  assert.throws(() => hostRig(L, c, { host: { restore: L.P.toBytes({ ...saved, core: { ...saved.core, v: L.R.SAVE_REVISION - 1 } }) } }), /this save was written by another version of the runtime/);
  assert.notEqual(stateHash(c), stateHash({ ...c, save: c.save + 1 }));
  rig.host.stop();
});
