/**
 * THE STUDIO'S FILES, FOR THE LOCAL MCP SERVER (lib/mcp.mjs). The Claude desktop app's chat has no file tools of its
 * own, so the server gives it these, and only inside ONE studio folder: list, read, write, edit and search. A path
 * is relative to the studio; nothing outside it is ever read or written (a symbolic link that leads out is refused
 * too). Secrets never pass: .env and .dev.vars files and the progress feeds' write keys are neither read nor
 * written, and git's own folder and node_modules are never written.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { PICTURE_MAX, PICTURE_TYPES, pictureFor } from './pictures.mjs';

// A picture is at most PICTURE_MAX raw in an answer (lib/pictures.mjs): a bigger one goes as a smaller JPEG copy.
export const FILE_LIMITS = Object.freeze({ write: 2 * 1024 * 1024, read: 400 * 1024, image: PICTURE_MAX, lines: 2000, list: 600, matches: 200, edits: 100 });
const IMAGES = PICTURE_TYPES;
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', '.studio', 'dist']);

const inside = (base, p) => p === base || p.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);

function secret(rel) {
  const parts = rel.split(/[\\/]/);
  const name = parts[parts.length - 1];
  return /^\.env(\..*)?$/.test(name) || name === '.dev.vars' || /\.key$/.test(name) && parts.includes('progress');
}

/** A path in the studio, checked: { abs, rel }. `write`: also refuse git's folder and node_modules. */
export function studioPath(root, path, { write = false } = {}) {
  const raw = String(path ?? '').trim() || '.';
  if (raw.includes('\0')) throw new Error('that path has a NUL in it');
  const base = realpathSync(root);
  const abs = resolve(base, raw);
  if (!inside(base, abs)) throw new Error(`${raw} is outside the studio (${base}); only the studio's own files are reachable`);
  // The nearest existing folder on the way must also be inside (a symbolic link must not lead out).
  let at = abs;
  while (!existsSync(at)) at = dirname(at);
  const real = realpathSync(at);
  if (!inside(base, real)) throw new Error(`${raw} leads outside the studio through a link`);
  const rel = relative(base, abs) || '.';
  if (secret(rel)) throw new Error(`${rel} holds a secret: it is never read or written here`);
  if (write) {
    const top = rel.split(/[\\/]/)[0];
    if (top === '.git' || rel.split(/[\\/]/).includes('node_modules')) throw new Error(`${rel} is git's or npm's own: never written by hand`);
    if (rel === '.') throw new Error('name a file');
  }
  return { abs, rel, base };
}

export function listFiles(root, path = '.', { depth = 2 } = {}) {
  const { abs, rel } = studioPath(root, path);
  if (!existsSync(abs)) throw new Error(`${rel} does not exist`);
  if (!statSync(abs).isDirectory()) throw new Error(`${rel} is a file (file_read reads it)`);
  const out = [];
  const walk = (dir, d) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= FILE_LIMITS.list) return;
      if (e.name === '.DS_Store') continue;
      const p = join(dir, e.name);
      const r = relative(realpathSync(root), p);
      if (secret(r)) continue;
      if (e.isDirectory()) {
        out.push({ path: `${r}/`, type: 'dir' });
        if (d < depth && !SKIP_DIRS.has(e.name)) walk(p, d + 1);
      } else {
        let size = null;
        try { size = lstatSync(p).size; } catch { /* gone */ }
        out.push({ path: r, type: e.isSymbolicLink() ? 'link' : 'file', size });
      }
    }
  };
  walk(abs, 1);
  return { path: rel, entries: out, truncated: out.length >= FILE_LIMITS.list };
}

/** Text (with line numbers from `offset`), or a picture as MCP image content. */
export function readStudioFile(root, path, { offset = 1, limit = FILE_LIMITS.lines } = {}) {
  const { abs, rel } = studioPath(root, path);
  if (!existsSync(abs)) throw new Error(`${rel} does not exist`);
  const st = statSync(abs);
  if (st.isDirectory()) throw new Error(`${rel} is a folder (file_list lists it)`);
  const mime = IMAGES[extname(abs).toLowerCase()];
  if (mime) {
    // Small enough for one answer (the Claude desktop app refuses one over 1 MB): a big picture goes as a smaller copy.
    const pic = pictureFor(abs, { label: rel });
    return { rel, image: { mimeType: pic.mimeType, data: pic.data }, bytes: pic.bytes, shrunk: pic.shrunk, from: pic.from ?? st.size };
  }
  if (st.size > FILE_LIMITS.read * 8) throw new Error(`${rel} is ${Math.round(st.size / 1024)} KB: too big to read here`);
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${rel} is not a text file`);
  const lines = buf.toString('utf8').split('\n');
  const from = Math.max(1, Number(offset) || 1);
  const n = Math.min(Math.max(1, Number(limit) || FILE_LIMITS.lines), FILE_LIMITS.lines);
  let text = '';
  let shown = 0;
  for (let i = from - 1; i < lines.length && shown < n; i++, shown++) {
    const line = `${String(i + 1).padStart(5)}\t${lines[i]}\n`;
    if (text.length + line.length > FILE_LIMITS.read) break;
    text += line;
  }
  return { rel, text, from, to: from + shown - 1, lines: lines.length, more: from + shown - 1 < lines.length };
}

export function writeStudioFile(root, path, content) {
  const { abs, rel } = studioPath(root, path, { write: true });
  const text = String(content ?? '');
  if (Buffer.byteLength(text) > FILE_LIMITS.write) throw new Error(`at most ${FILE_LIMITS.write / 1024 / 1024} MB a file`);
  if (existsSync(abs) && statSync(abs).isDirectory()) throw new Error(`${rel} is a folder`);
  const existed = existsSync(abs);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  return { rel, bytes: Buffer.byteLength(text), created: !existed };
}

/**
 * Replace exact text in a file. One change (`oldText`, `newText`, `all`), or several in one call (`edits`: a list of
 * { old, new, all? }), applied in order to the text in memory and written once: all of them, or none. A change that
 * does not match says which one it was, and the file is left as it was.
 */
export function editStudioFile(root, path, oldText, newText, { all = false, edits = null } = {}) {
  const { abs, rel } = studioPath(root, path, { write: true });
  if (!existsSync(abs)) throw new Error(`${rel} does not exist (file_write makes a new file)`);
  const list = Array.isArray(edits) && edits.length ? edits : [{ old: oldText, new: newText, all }];
  if (list.length > FILE_LIMITS.edits) throw new Error(`at most ${FILE_LIMITS.edits} edits in one call`);
  const many = list.length > 1;
  let next = readFileSync(abs, 'utf8');
  let replaced = 0;
  list.forEach((e, i) => {
    const from = String(e?.old ?? '');
    const which = many ? `edit ${i + 1} of ${list.length} (${JSON.stringify(from.slice(0, 60))}${from.length > 60 ? '…' : ''}): ` : '';
    const none = many ? '; nothing was changed' : '';
    if (!from) throw new Error(`${which}old is the exact text to replace (it cannot be empty)${none}`);
    const count = next.split(from).length - 1;
    if (!count) throw new Error(`${which}the text to replace is not in ${rel} (it must match exactly, spaces and line breaks too${many ? '; an earlier edit in this call may have changed it' : ''})${none}`);
    if (count > 1 && e.all !== true) throw new Error(`${which}the text to replace is in ${rel} ${count} times: give more of it so it is unique, or all: true${none}`);
    next = e.all === true ? next.split(from).join(String(e.new ?? '')) : next.replace(from, () => String(e.new ?? ''));
    replaced += e.all === true ? count : 1;
  });
  if (Buffer.byteLength(next) > FILE_LIMITS.write) throw new Error(`at most ${FILE_LIMITS.write / 1024 / 1024} MB a file`);
  writeFileSync(abs, next);
  return { rel, replaced, edits: list.length };
}

/** Lines matching a regular expression, in the studio's text files (never node_modules, git, builds or .studio). */
export function searchStudio(root, pattern, { path = '.', ignoreCase = false } = {}) {
  let re;
  try { re = new RegExp(String(pattern ?? ''), ignoreCase ? 'i' : ''); } catch (error) { throw new Error(`not a regular expression: ${error.message}`); }
  const { abs } = studioPath(root, path);
  const base = realpathSync(root);
  const matches = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (matches.length >= FILE_LIMITS.matches) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
      if (!e.isFile() || IMAGES[extname(e.name).toLowerCase()]) continue;
      const r = relative(base, p);
      if (secret(r)) continue;
      let buf;
      try { if (statSync(p).size > 1024 * 1024) continue; buf = readFileSync(p); } catch { continue; }
      if (buf.subarray(0, 8000).includes(0)) continue;
      const lines = buf.toString('utf8').split('\n');
      for (let i = 0; i < lines.length && matches.length < FILE_LIMITS.matches; i++) if (re.test(lines[i])) matches.push({ path: r, line: i + 1, text: lines[i].slice(0, 300) });
    }
  };
  if (statSync(abs).isDirectory()) walk(abs);
  else walk(dirname(abs));
  return { pattern: String(pattern), matches, truncated: matches.length >= FILE_LIMITS.matches };
}
