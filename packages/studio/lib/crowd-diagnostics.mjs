#!/usr/bin/env node
/** Authenticated, bounded capture, including named QA rooms absent from office lists. */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { withKey } from './office.mjs';
const opts = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith('--') || !process.argv[i + 1])
    throw Error('Use --key value');
  opts[process.argv[i].slice(2)] = process.argv[i + 1];
}
const room = opts.room,
  game = opts.game ?? 'crowd-circuit',
  seconds = Number(opts.seconds ?? 300),
  out = resolve(opts.out ?? 'diagnostics.jsonl');
if (
  !/^[A-Za-z0-9_-]{1,32}$/.test(room ?? '') ||
  !Number.isFinite(seconds) ||
  seconds < 1 ||
  seconds > 3600
)
  throw Error('--room is required; --seconds 1..3600');
await mkdir(dirname(out), { recursive: true });
let stopped = false;
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => (stopped = true));
const result = await withKey(
  resolve(opts.root ?? process.cwd()),
  opts.url,
  async (call) => {
    const end = Date.now() + seconds * 1000;
    while (!stopped && Date.now() < end) {
      const start = Date.now();
      let r;
      try {
        r = await call(
          `/_studio/api/room?game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}`
        );
      } catch (error) {
        r = { ok: false, error: String(error?.message ?? error) };
      }
      const f = r.facts;
      // The endpoint answers from the room's diagnostics object: a second's
      // facts from the room (tick rate, input transit) and from each Gate
      // (frames written per player, world age, pacing), with the copy's age.
      await appendFile(
        out,
        JSON.stringify({
          at: Date.now(),
          requestMs: Date.now() - start,
          status: r.status,
          ok: r.ok,
          toolkit: f?.toolkit,
          room: f?.room,
          counts: f?.counts,
          ticks: f?.ticks,
          tickRate: f?.tickRate,
          inputTransitMs: f?.inputTransitMs,
          transport: f?.transport,
          gates: f?.gates,
          durability: f?.durability,
          save: f?.save,
          diagnostics: f?.diagnostics,
          error: r.error
        }) + '\n'
      );
      // A failed poll is evidence, not the end of the capture. Authentication
      // errors are also retained; withKey renews and revokes its one key.
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { ok: true };
  }
);
console.log(JSON.stringify({ out, ...result }));
if (!result.ok) process.exitCode = 1;
