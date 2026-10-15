// CI-only preload: observe the actual child, including failures before Puppeteer
// returns a Browser. Keep the existing transport, flags and launch deadline.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync, mkdirSync, statfsSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = process.env.HOMIE_CHROME_EVIDENCE;
if (directory) {
  mkdirSync(directory, { recursive: true });
  const output = resolve(directory, `chrome-${process.pid}.jsonl`);
  const original = childProcess.spawn;
  const resources = () => {
    let shm = null;
    try { const s = statfsSync('/dev/shm'); shm = { bytes: s.blocks * s.bsize, available: s.bavail * s.bsize }; } catch { /* Not Linux. */ }
    const ps = childProcess.spawnSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 2000 });
    const chrome = (ps.stdout ?? '').split('\n').filter(line => /chrome|chromium/i.test(line)).map(line => line.trim());
    return { shm, chrome, psStatus: ps.status };
  };
  const record = row => appendFileSync(output, JSON.stringify({ at: new Date().toISOString(), observer: process.pid, ...row }) + '\n');
  childProcess.spawn = function (executable, args, options) {
    if (!/chrome|chromium/i.test(String(executable))) return original.apply(this, arguments);
    const start = performance.now();
    const child = original.apply(this, arguments);
    record({ event: 'launch', pid: child.pid, executable: String(executable), pipe: args?.includes('--remote-debugging-pipe'), resources: resources() });
    let stderrBytes = 0;
    child.stderr?.on('data', chunk => {
      // Bound each launch's log while continuing to drain the stream.
      if (stderrBytes < 128 * 1024) record({ event: 'stderr', pid: child.pid, text: String(chunk).slice(0, 128 * 1024 - stderrBytes) });
      stderrBytes += chunk.length;
    });
    child.once('error', error => record({ event: 'error', pid: child.pid, message: error.message }));
    child.once('exit', (code, signal) => record({ event: 'exit', pid: child.pid, code, signal, elapsedMs: performance.now() - start, stderrBytes, resources: resources() }));
    return child;
  };
  syncBuiltinESMExports();
}
