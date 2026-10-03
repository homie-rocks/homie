/**
 * CODEX'S EDITS. Codex changes files with `apply_patch`, one patch for any number of files:
 *
 *   *** Begin Patch
 *   *** Add File: games/owl-rush/notes.md        every line after it starts with "+"
 *   *** Update File: games/owl-rush/game.json    then optionally "*** Move to: <path>"
 *   @@ optional line to find first
 *    a context line
 *   -a removed line
 *   +an added line
 *   *** End of File                              (optional: the chunk ends the file)
 *   *** Delete File: old.txt
 *   *** End Patch
 *
 * `parsePatch` reads one into files; `applyChunks` gives a file's text after its chunks (null when they do not apply:
 * Codex refuses that patch itself), matching lines as Codex does (exactly, then without trailing spaces, then trimmed).
 * Plain functions: no I/O.
 */

/** The patch text inside a call's input: the whole input, or a heredoc a shell command hands to apply_patch. */
export function patchTextOf(input) {
  const text = typeof input === 'string' ? input : '';
  const at = text.indexOf('*** Begin Patch');
  if (at < 0) return null;
  const end = text.indexOf('*** End Patch', at);
  return text.slice(at, end < 0 ? text.length : end + '*** End Patch'.length);
}

/**
 * A patch's files: [{ op: 'add'|'update'|'delete', path, to (a move's new path) | null, lines (add), chunks (update) }],
 * paths as written (relative to the folder Codex runs in, or absolute). null when it is not a patch.
 */
export function parsePatch(text) {
  const src = patchTextOf(text);
  if (!src) return null;
  const lines = src.split('\n');
  const files = [];
  let cur = null;
  let chunk = null;
  const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (line.startsWith('*** End Patch')) break;
    const h = header.exec(line);
    if (h) {
      cur = { op: h[1].toLowerCase(), path: h[2].trim(), to: null, lines: [], chunks: [] };
      chunk = null;
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (cur.op === 'add') { if (line.startsWith('+')) cur.lines.push(line.slice(1)); continue; }
    if (cur.op !== 'update') continue;
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (move) { cur.to = move[1].trim(); continue; }
    if (line === '*** End of File') { if (chunk) chunk.eof = true; continue; }
    if (line.startsWith('@@')) {
      chunk = { at: line.slice(2).trim() || null, old: [], next: [], eof: false };
      cur.chunks.push(chunk);
      continue;
    }
    const op = line[0];
    if (op !== ' ' && op !== '-' && op !== '+' && line !== '') continue;
    if (!chunk) { chunk = { at: null, old: [], next: [], eof: false }; cur.chunks.push(chunk); }
    const body = line === '' ? '' : line.slice(1);
    if (op === '-' ) chunk.old.push(body);
    else if (op === '+') chunk.next.push(body);
    else { chunk.old.push(body); chunk.next.push(body); }
  }
  return files;
}

const SAME = [(a, b) => a === b, (a, b) => a.trimEnd() === b.trimEnd(), (a, b) => a.trim() === b.trim()];

/** Where `want` (lines) first appears in `have` from `from` on (at the end when `eof`), or -1. */
function seek(have, want, from, eof) {
  for (const same of SAME) {
    if (eof) {
      const at = have.length - want.length;
      if (at >= from && want.every((w, k) => same(have[at + k], w))) return at;
    }
    for (let at = from; at + want.length <= have.length; at++) if (want.every((w, k) => same(have[at + k], w))) return at;
  }
  return -1;
}

/** A file's text after an update's chunks, or null when one does not apply. */
export function applyChunks(before, chunks) {
  const trailing = String(before).endsWith('\n');
  const have = String(before).split('\n');
  if (trailing) have.pop();
  let at = 0;
  for (const c of chunks) {
    if (c.at) {
      const found = seek(have, [c.at], at, false);
      if (found < 0) return null;
      at = found + 1;
    }
    if (!c.old.length) { have.splice(have.length, 0, ...c.next); at = have.length; continue; }
    const found = seek(have, c.old, at, c.eof);
    if (found < 0) return null;
    have.splice(found, c.old.length, ...c.next);
    at = found + c.next.length;
  }
  return `${have.join('\n')}${have.length ? '\n' : ''}`;
}

/**
 * A patch as the change list lib/holds.mjs `editDecision` reads: each file it adds, updates, deletes or moves, with
 * its text after (`apply`). A move is a delete of the old path and an add at the new one, whose text before is the old
 * path's (`from`).
 */
export function patchChanges(text, cwd) {
  const files = parsePatch(text);
  if (!files) return null;
  const abs = (p) => (p.startsWith('/') ? p : `${String(cwd ?? '').replace(/\/+$/, '')}/${p}`);
  const changes = [];
  for (const f of files) {
    if (f.op === 'add') changes.push({ path: abs(f.path), apply: () => `${f.lines.join('\n')}${f.lines.length ? '\n' : ''}`, op: 'add' });
    else if (f.op === 'delete') changes.push({ path: abs(f.path), apply: () => '', op: 'delete' });
    else {
      changes.push({ path: abs(f.path), apply: (before) => (f.to ? '' : applyChunks(before, f.chunks)), op: f.to ? 'move' : 'update' });
      if (f.to) changes.push({ path: abs(f.to), from: abs(f.path), apply: (before) => applyChunks(before, f.chunks), op: 'move-to' });
    }
  }
  return changes;
}
