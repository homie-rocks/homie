/**
 * What an edit would change, as unified-diff hunks for the `Code` element (`format: 'diff'`): the file's text before
 * and after, compared line by line, three lines of context, bounded so a dialog stays readable.
 */

const MAX_LINES = 1500;

function lines(text) {
  if (!text) return [];
  const l = String(text).split('\n');
  if (l.length > 1 && l[l.length - 1] === '') l.pop();
  return l;
}

/** Line operations: [{ op: ' ' | '-' | '+', t, a, b }] with 1-based line numbers in the old (a) and new (b) text. */
export function lineOps(before, after) {
  let a = lines(before);
  let b = lines(after);
  // Common head and tail first: an edit in a long file compares only the part that changed.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const ops = [];
  for (let i = 0; i < head; i++) ops.push({ op: ' ', t: a[i], a: i + 1, b: i + 1 });
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  if (am.length > MAX_LINES || bm.length > MAX_LINES || am.length * bm.length > 2_000_000) {
    am.forEach((t, k) => ops.push({ op: '-', t, a: head + k + 1, b: null }));
    bm.forEach((t, k) => ops.push({ op: '+', t, a: null, b: head + k + 1 }));
  } else {
    const n = am.length; const m = bm.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0; let j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) { ops.push({ op: ' ', t: am[i], a: head + i + 1, b: head + j + 1 }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: '-', t: am[i], a: head + i + 1, b: null }); i++; }
      else { ops.push({ op: '+', t: bm[j], a: null, b: head + j + 1 }); j++; }
    }
    while (i < n) { ops.push({ op: '-', t: am[i], a: head + i + 1, b: null }); i++; }
    while (j < m) { ops.push({ op: '+', t: bm[j], a: null, b: head + j + 1 }); j++; }
  }
  for (let k = 0; k < tail; k++) ops.push({ op: ' ', t: a[a.length - tail + k], a: a.length - tail + k + 1, b: b.length - tail + k + 1 });
  return ops;
}

/**
 * Unified-diff hunks of `before` → `after`: { source, added, removed, shown, total, rows }. `maxLines` bounds the lines
 * drawn (a hunk cut short gets the counts of the lines it keeps, so it still parses), `lineWidth` cuts long lines,
 * `maxChars` bounds the text (the Code element takes at most 10,000). `rows` counts what a dialog draws, headers too.
 */
export function unifiedDiff(before, after, { context = 3, maxLines = 40, maxChars = 7000, lineWidth = 300 } = {}) {
  const ops = lineOps(before, after);
  const added = ops.filter((o) => o.op === '+').length;
  const removed = ops.filter((o) => o.op === '-').length;
  const keep = ops.map((o, k) => o.op !== ' ' || ops.slice(Math.max(0, k - context), k + context + 1).some((x) => x.op !== ' '));
  const hunks = [];
  let cur = null;
  ops.forEach((o, k) => {
    if (!keep[k]) { cur = null; return; }
    if (!cur) { cur = { ops: [] }; hunks.push(cur); }
    cur.ops.push(o);
  });
  const total = hunks.reduce((n, h) => n + h.ops.length, 0);
  const cut = (text) => { const t = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ''); return t.length > lineWidth ? `${t.slice(0, Math.max(1, lineWidth - 1))}…` : t; };
  const out = [];
  let shown = 0;
  let rows = 0;
  for (const h of hunks) {
    if (shown >= maxLines) break;
    const room = maxLines - shown;
    // A hunk that does not fit starts at its first change (its leading context is what goes), and never ends on
    // context alone.
    const first = h.ops.findIndex((o) => o.op !== ' ');
    const part = h.ops.length <= room ? h.ops.slice() : h.ops.slice(Math.min(first, Math.max(0, h.ops.length - room)), Math.min(first, Math.max(0, h.ops.length - room)) + room);
    while (part.length && part[part.length - 1].op === ' ' && part.length < h.ops.length) part.pop();
    if (!part.length || !part.some((o) => o.op !== ' ')) break;
    const firstA = part.find((o) => o.a !== null)?.a ?? null;
    const firstB = part.find((o) => o.b !== null)?.b ?? null;
    const aLen = part.filter((o) => o.op !== '+').length;
    const bLen = part.filter((o) => o.op !== '-').length;
    const aAt = aLen ? firstA : Math.max(0, (firstB ?? 1) - 1);
    const bAt = bLen ? firstB : Math.max(0, (firstA ?? 1) - 1);
    const lines = [`@@ -${aAt},${aLen} +${bAt},${bLen} @@`, ...part.map((o) => `${o.op}${cut(o.t)}`)];
    if ([...out, ...lines].join('\n').length > maxChars) break;
    out.push(...lines);
    shown += part.length;
    rows += lines.length;
  }
  const shownChanges = out.filter((l) => (l[0] === '+' || l[0] === '-') && !l.startsWith('@@')).length;
  return { source: out.join('\n'), added, removed, shown, total, rows, shownChanges, hunks: hunks.length };
}

/** The file's text after an Edit, MultiEdit or Write (null when the edit cannot apply: the tool will refuse it). */
export function applyEdit(tool, before, input) {
  if (tool === 'Write') return String(input.content ?? '');
  const edits = tool === 'MultiEdit' ? (Array.isArray(input.edits) ? input.edits : []) : [{ old_string: input.old_string, new_string: input.new_string, replace_all: input.replace_all }];
  let text = String(before ?? '');
  for (const e of edits) {
    const old = String(e.old_string ?? '');
    const next = String(e.new_string ?? '');
    if (!old) { if (!text) { text = next; continue; } return null; }
    const at = text.indexOf(old);
    if (at < 0) return null;
    text = e.replace_all ? text.split(old).join(next) : text.slice(0, at) + next + text.slice(at + old.length);
  }
  return text;
}
