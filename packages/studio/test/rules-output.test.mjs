import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rulesOutput } from '../netplay/rules-output.mjs';
import { RULES_FRAMES, rulesRates, takeRulesToken } from '../worker/limits.mjs';
import { fakeClock } from './rules-kit.mjs';

for (const hz of [20, 30, 60]) test(`ordered output survives late timers at ${hz} Hz`, () => {
  const clock = fakeClock(), rates = rulesRates(hz, 16), buckets = new Map(), reliable = [], sent = [];
  const sender = rulesOutput({ rates, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, send(m) {
    assert.equal(takeRulesToken(buckets, m.t, rates[m.t], clock.now()), 0, m.t);
    sent.push(m);
  } });
  for (let tick = 0; tick < hz * 30; tick++) {
    sender.push({ t: 'snap', k: tick });
    for (const t of RULES_FRAMES.filter(t => t !== 'snap')) if (tick % hz === 0) {
      const count = t === 'roster' ? 12 : t === 'decide' ? 5 : t === 'ev' ? 160 : 4;
      for (let n = 0; n < count; n++) { const m = { t, seq: reliable.length }; reliable.push(m); sender.push(m); }
    }
    // A blocked timer wakes late with its tokens refilled, never bypassing the sender.
    if (tick % 17 === 0) clock.t += 120;
    clock.advance(1000 / hz);
  }
  clock.advance(10000);
  assert.deepEqual(sent.filter(m => m.t !== 'snap').map(({ rules, ...m }) => m), reliable);
  assert.equal(sent.filter(m => m.t === 'snap').at(-1).k, hz * 30 - 1);
  sender.stop();
});

test('terminal output waits behind reliable frames and stops the sender', () => {
  const clock = fakeClock(), sent = [], rates = rulesRates(60, 32);
  const sender = rulesOutput({ rates, send: m => sent.push(m.t), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  for (let i = 0; i < 20; i++) sender.push({ t: 'round', n: i });
  sender.finish({ t: 'rules-end' }); sender.push({ t: 'snap' });
  clock.advance(10000);
  assert.deepEqual(sent, [...Array(20).fill('round'), 'rules-end']);
});

for (const hz of [20, 30, 60]) test(`a reliable frame leaves with its own allowance and a yield follows its checkpoint at ${hz} Hz`, () => {
  // Two hundred moments a millisecond apart: wherever the snapshot's timer stands, the order on the wire is the same.
  for (let phase = 0; phase < 200; phase++) {
    const clock = fakeClock(), wire = [], rates = rulesRates(hz, 8);
    const sender = rulesOutput({ rates, send: m => wire.push({ ...m, at: clock.now() }), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const period = 1000 / hz, end = 2000 + phase;
    for (let tick = 0; tick * period < end; tick++) {
      clock.advance(tick * period - clock.now());
      sender.push({ t: 'ev', k: tick, made: clock.now() }); sender.push({ t: 'snap', k: tick });
    }
    clock.advance(end - clock.now());
    for (const m of wire.filter(m => m.t === 'ev')) assert.equal(m.at, m.made, 'an event is on the wire in the turn that made it');
    assert.ok(wire.filter(m => m.t === 'snap').length >= Math.floor(end / period) - 1, 'a snapshot a tick');
    const before = wire.length;
    sender.push({ t: 'ckpt', k: 'last' }); sender.handOver({});
    assert.deepEqual(wire.slice(before).map(m => m.t), ['ckpt', 'yield']);
    assert.equal(wire.at(-1).rules, undefined, 'a yield is the page\'s own frame');
    assert.equal(sender.handing, false);
    // What the rules make while the relay decides is held, and is never sent once the role has gone.
    sender.push({ t: 'ev', k: 'after' }); sender.push({ t: 'snap', k: 'after' });
    clock.advance(500);
    assert.equal(wire.at(-1).t, 'yield');
    sender.stop(); clock.advance(500);
    assert.equal(wire.at(-1).t, 'yield');
  }
});

test('a refused yield releases what was held, in order', () => {
  const clock = fakeClock(), wire = [];
  const sender = rulesOutput({ rates: rulesRates(60, 8), send: m => wire.push(m.t === 'ev' ? m.k : m.t), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  sender.push({ t: 'ckpt' }); sender.handOver({ slow: true });
  for (let k = 0; k < 5; k++) { sender.push({ t: 'ev', k }); sender.push({ t: 'snap', k }); clock.advance(16); }
  assert.deepEqual(wire, ['ckpt', 'yield']);
  sender.release();
  assert.deepEqual(wire, ['ckpt', 'yield', 0, 1, 2, 3, 4, 'snap']);
  sender.stop();
});

test('a yield waits behind a checkpoint that has no token, and the relay is not told of the hidden tab before it', () => {
  const clock = fakeClock(), wire = [];
  const sender = rulesOutput({ rates: rulesRates(60, 8), send: m => wire.push(m.t), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  for (let n = 0; n < 5; n++) sender.push({ t: 'ckpt' });
  sender.handOver({});
  assert.deepEqual(wire, Array(4).fill('ckpt'));
  assert.equal(sender.handing, true);
  clock.advance(1000);
  assert.deepEqual(wire, [...Array(5).fill('ckpt'), 'yield']);
  assert.equal(sender.handing, false);
  sender.stop();
});

test('a page that goes sends what its allowance permits, then its last checkpoint whatever the allowance', () => {
  const clock = fakeClock(), wire = [], rates = rulesRates(20, 8), relay = new Map();
  const sender = rulesOutput({ rates, send(m) { assert.equal(takeRulesToken(relay, m.t, rates[m.t], clock.now()), 0, `the relay takes ${m.t}`); wire.push(m.t === 'ckpt' ? `ckpt${m.k}` : m.t); }, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  for (let k = 0; k < 6; k++) sender.push({ t: 'ckpt', k });
  sender.push({ t: 'round' }); sender.push({ t: 'snap' });
  assert.deepEqual(wire, ['ckpt0', 'ckpt1', 'ckpt2', 'ckpt3', 'snap']);
  sender.leave();
  // The round has its own token; the older checkpoints are superseded by the last, which is not left behind them.
  assert.deepEqual(wire, ['ckpt0', 'ckpt1', 'ckpt2', 'ckpt3', 'snap', 'round', 'ckpt5']);
  // Nothing is left to send later, and the sender still works for a page that was only put away.
  clock.advance(5000);
  assert.equal(wire.length, 7);
  sender.push({ t: 'roster' });
  assert.equal(wire.at(-1), 'roster');
  sender.stop();
});
