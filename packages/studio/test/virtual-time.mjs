/**
 * Virtual time for a test (not a test file itself): setTimeout, setInterval, Date and performance.now() run on a
 * clock the test moves, through node:test's mock timers (performance.now() is read from the mocked Date). What a test
 * proves about timing (frames a second, a hold of 3.5 s, a debounce) then never depends on how busy the machine is,
 * and a wait of seconds takes milliseconds.
 *
 *   const clock = virtualTime(t);   // first: before a room, a netplay helper or anything else reads the clock
 *   await clock.wait(250);          // 250 ms pass, a millisecond at a time; promises and microtasks settle between
 *
 * Anything that must run in real time (esbuild, a child process, a file read) goes before virtualTime(t). The mocks
 * are undone when the test ends.
 */
export function virtualTime(t, { now = 1_000_000 } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
  const real = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  Object.defineProperty(globalThis, 'performance', { configurable: true, enumerable: true, writable: true, value: { now: () => Date.now() - now, timeOrigin: now } });
  t.after(() => { if (real) Object.defineProperty(globalThis, 'performance', real); else delete globalThis.performance; });
  // setImmediate stays real: one turn of the event loop, so every promise and microtask a timer started settles.
  const settle = () => new Promise((r) => setImmediate(r));
  return {
    now: () => Date.now(),
    async wait(ms) {
      for (let left = Math.max(0, Math.round(ms)); left > 0; left -= 1) { t.mock.timers.tick(1); await settle(); }
      await settle();
    },
  };
}
