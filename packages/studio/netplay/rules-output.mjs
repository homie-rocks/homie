import { takeRulesToken } from '../worker/limits.mjs';

/**
 * The hosting page's one way out for what its rules make. Reliable frames keep one order and each leaves as soon as
 * its own kind has a token; only a snapshot may be superseded, and only a snapshot waits for the snapshot's token.
 * Giving the role up is part of the same order: `handOver` follows the checkpoint through the queue and holds what
 * is made after it until the relay answers, and `leave` sends the last checkpoint before the page goes.
 */
export function rulesOutput({ rates, send, now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const buckets = new Map();
  const queue = [];
  let snapshot = null, timer = null, stopped = false, finishing = false, held = false;
  function budget(m, force = false) {
    const rate = rates[m.t];
    if (!rate) throw new Error(`Unknown rules output: ${m.t}`);
    // The relay drops a surplus snapshot and nothing else, so snapshots spend its whole rate: an on-time tick's leaves
    // with the tick. Reliable kinds keep a fifth of theirs clear of transport jitter and late timers.
    const ms = m.t === 'snap' ? takeRulesToken(buckets, m.t, rate, now(), 2) : takeRulesToken(buckets, m.t, rate * 0.8, now(), rate);
    // The relay's bucket holds twice this one: a forced last checkpoint is inside it.
    if (ms && force) { buckets.get(m.t).tokens -= 1; return 0; }
    return ms;
  }
  function drain() {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (stopped || held) return;
    let wait = Infinity;
    while (queue.length) {
      const m = queue[0];
      if (m.rules !== true) { queue.shift(); held = true; send(m); return; }
      const ms = budget(m);
      if (ms) { wait = ms; break; }
      send(queue.shift());
    }
    if (snapshot) {
      const ms = budget(snapshot);
      if (ms) wait = Math.min(wait, ms);
      else { const m = snapshot; snapshot = null; send(m); }
    }
    if (finishing && !queue.length) { stopped = true; return; }
    if (wait !== Infinity) timer = setTimer(drain, Math.max(1, wait));
  }
  return {
    push(frame) {
      if (stopped || finishing) return;
      const m = { ...frame, rules: true };
      if (m.t === 'snap') snapshot = m; else queue.push(m);
      drain();
    },
    finish(frame) {
      if (stopped || finishing) return;
      finishing = true; held = false; snapshot = null; queue.push({ ...frame, rules: true });
      drain();
    },
    /** `yield`, in its place behind the checkpoint. What the rules make after it waits for the relay's answer. */
    handOver(frame) {
      if (stopped || finishing) return;
      queue.push({ ...frame, t: 'yield' });
      drain();
    },
    /** True from `handOver` until its `yield` is on the wire: the relay must hear nothing else that moves the role. */
    get handing() { return !stopped && queue.some((m) => m.rules !== true); },
    /** True while a yield is queued or unanswered. */
    get waiting() { return !stopped && (held || queue.some((m) => m.rules !== true)); },
    /** The relay kept this page as the host: what was held goes out, in order. */
    release() { if (held) { held = false; drain(); } },
    /**
     * The page is going (it closes, or its rules host is closed). Everything its allowance permits is sent, in order;
     * a frame that cannot be is covered by the checkpoint, which goes last and always goes.
     */
    leave() {
      if (stopped) return;
      if (timer !== null) { clearTimer(timer); timer = null; }
      let last = null, blocked = held;
      for (const m of queue) {
        if (m.t === 'ckpt') { last = m; continue; }
        if (m.rules !== true) { blocked = true; continue; }
        if (!blocked && !budget(m)) send(m); else blocked = true;
      }
      if (last) { budget(last, true); send(last); }
      held = false; queue.length = 0; snapshot = null;
    },
    /** The relay moved the role: it takes nothing more from this page as the host. */
    stop() { stopped = true; if (timer !== null) clearTimer(timer); timer = null; queue.length = 0; snapshot = null; },
  };
}
