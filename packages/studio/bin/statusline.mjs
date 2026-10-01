#!/usr/bin/env node
/**
 * The Claude Code status line for a Homie studio (lib/statusline.mjs). Claude Code runs it with the session as
 * JSON on stdin and shows what it prints; it must be quick and must never fail loudly, so it reads only the
 * studio's own progress files and prints nothing at all when anything goes wrong.
 *
 *   echo '{"workspace":{"current_dir":"."}}' | node node_modules/@homie-rocks/studio/bin/statusline.mjs
 */
import { statusLine } from '../lib/statusline.mjs';

let input = '';
let printed = false;
function print() {
  if (printed) return;
  printed = true;
  let dirs = [process.cwd()];
  try {
    const session = JSON.parse(input || '{}');
    dirs = [session?.workspace?.current_dir, session?.workspace?.project_dir, session?.cwd, process.cwd()].filter((d) => typeof d === 'string' && d);
  } catch { /* no session: this folder */ }
  // `--studio <folder>`: set up in the folder above the studio, the setting names the studio.
  const named = process.argv.indexOf('--studio');
  if (named > 0 && process.argv[named + 1]) dirs.push(process.argv[named + 1]);
  try {
    const columns = Number(process.env.COLUMNS) || 100;
    const color = !process.env.NO_COLOR;
    for (const dir of dirs) {
      const line = statusLine({ dir, columns, color });
      if (line) { process.stdout.write(`${line}\n`); break; }
    }
  } catch { /* quiet: a status line never shows a stack */ }
  // A caller that never closes stdin must not keep this process alive.
  if (!process.stdin.isTTY) process.stdin.destroy();
}
if (process.stdin.isTTY) print();
else {
  const timer = setTimeout(print, 400);
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => { clearTimeout(timer); print(); });
  process.stdin.on('error', () => { clearTimeout(timer); print(); });
}
