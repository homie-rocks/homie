/*
 * Which file a request to the desktop shell names, and which bytes of it (standalone/STANDALONE.md). Nothing here
 * needs Electron, so a test runs it with hostile addresses: main.cjs serves exactly what these two say.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** The file an `app://game/…` address names inside `web`, or null: another host, a path that climbs out, or nothing there. */
function fileFor(web, address) {
  let url;
  try { url = new URL(address); } catch { return null; }
  if (url.protocol !== 'app:' || url.host !== 'game') return null;
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return null; }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  const abs = path.resolve(web, `.${path.posix.normalize(`/${rel}`)}`);
  if (abs !== web && !abs.startsWith(web + path.sep)) return null;
  for (const f of [abs, path.join(abs, 'index.html')]) {
    try {
      // A link inside web/ that points out of it is not a file of the game.
      const real = fs.realpathSync(f);
      if (fs.statSync(real).isFile() && (real === fs.realpathSync(web) || real.startsWith(fs.realpathSync(web) + path.sep))) return f;
    } catch { /* next */ }
  }
  return null;
}

/**
 * The part of a file of `size` bytes a Range header asks for: { start, end } (both inside the file), 'whole' when
 * there is no usable header (the whole file is the answer), or 'none' when the range lies outside the file (416).
 */
function rangeOf(header, size) {
  const m = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'whole';
  if (!(size > 0)) return 'none';
  if (m[1] === '') { const n = Number(m[2]); return n > 0 ? { start: Math.max(0, size - n), end: size - 1 } : 'none'; }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start > end || start >= size ? 'none' : { start, end };
}

/** Where a frame of the page may go: the app's own files; and for a frame inside the game, a blob or a srcdoc of its own. */
function mayNavigate(address, { main = true } = {}) {
  const url = String(address);
  if (url.startsWith('app://game/')) return true;
  return !main && (url === 'about:srcdoc' || url === 'about:blank' || url.startsWith('blob:app://game/'));
}

module.exports = { fileFor, rangeOf, mayNavigate };
