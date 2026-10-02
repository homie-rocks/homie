/**
 * WHERE A GAME'S TIME GOES: a Chrome CPU profile (`homie-studio perf --profile`, the .cpuprofile DevTools opens)
 * summed per function, and the game's minified bundle read back through its source map, so the summary names
 * `draw (src/main.ts:620)` rather than `Xe (main.js:1:48213)`.
 *
 * Self time is the time a function itself was on the stack's top (what to make cheaper); total time includes what it
 * called (where a frame's time is spent overall). Idle, the garbage collector and Chrome's own work ("(program)") are
 * kept apart, so a game that is mostly idle reads as idle, not as a list of tiny hot spots.
 */

const B64 = new Map([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));

/** A source map's `mappings` as one array of segments per generated line: [column, source, line, column, name?]. */
export function decodeMappings(mappings) {
  const lines = [];
  let src = 0;
  let line = 0;
  let col = 0;
  let name = 0;
  for (const text of String(mappings ?? '').split(';')) {
    const segs = [];
    let gen = 0;
    for (const seg of text.split(',')) {
      if (!seg) continue;
      const v = [];
      let value = 0;
      let shift = 0;
      for (const ch of seg) {
        const d = B64.get(ch);
        if (d === undefined) break;
        value += (d & 31) << shift;
        if (d & 32) { shift += 5; continue; }
        v.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0;
        shift = 0;
      }
      gen += v[0] ?? 0;
      if (v.length >= 4) {
        src += v[1]; line += v[2]; col += v[3];
        if (v.length >= 5) { name += v[4]; segs.push([gen, src, line, col, name]); } else segs.push([gen, src, line, col]);
      }
    }
    lines.push(segs);
  }
  return lines;
}

/**
 * A lookup for one source map: (0-based line, column) in the generated file → { source, line (1-based), column, name },
 * the nearest mapping at or before that column on that line; null outside the map.
 */
export function sourceMapLookup(map) {
  const lines = decodeMappings(map?.mappings);
  const sources = (map?.sources ?? []).map((s) => String(s).replace(/^(\.\.\/)+/, '').replace(/^webpack:\/\/\//, ''));
  const names = map?.names ?? [];
  const content = map?.sourcesContent ?? [];
  return (line, column) => {
    const segs = lines[line];
    if (!segs?.length) return null;
    let lo = 0;
    let hi = segs.length - 1;
    let best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid][0] <= column) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    if (best < 0) return null;
    // A function's own position often lands on its name token; prefer a named segment within a few columns.
    let seg = segs[best];
    for (let k = best; k >= 0 && column - segs[k][0] <= 12; k--) if (segs[k][4] !== undefined) { seg = segs[k]; break; }
    const source = sources[seg[1]] ?? null;
    const named = seg[4] !== undefined ? names[seg[4]] ?? null : null;
    const text = typeof content[seg[1]] === 'string' ? content[seg[1]].split('\n')[seg[2]] ?? '' : '';
    // What the line defines wins over a segment's name: at an arrow function V8 points at its first parameter, whose
    // segment names the parameter, not the function.
    return { source, line: seg[2] + 1, column: seg[3], name: nameFromLine(text, seg[3]) ?? named };
  };
}

/**
 * The function a line of source defines, when the line says: `function draw(`, `const step = (`, `draw(…) {` (a method),
 * `step: (dt) =>`. The whole line first (a line usually defines one function), then from the mapped column on.
 */
function nameFromLine(text, column) {
  const tries = [
    /function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
    /^\s*(?:(?:public|private|protected|static|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/,
    /([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>)/,
  ];
  for (const re of tries) { const m = re.exec(text); if (m && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1])) return m[1]; }
  void column;
  return null;
}

const SPECIAL = new Set(['(root)', '(program)', '(idle)', '(garbage collector)']);

/**
 * A CPU profile summed per function. `maps`: [{ match: (url) => boolean, lookup }] (sourceMapLookup), for scripts
 * shipped minified. `game`: (url) => boolean, the game's own scripts (the rest is the play page and the browser).
 * Returns milliseconds and shares of the busy (not idle) time, the hottest functions first.
 */
export function summarizeProfile(profile, { maps = [], game = () => true, top = 15 } = {}) {
  const nodes = new Map((profile?.nodes ?? []).map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of nodes.values()) for (const c of n.children ?? []) parent.set(c, n.id);
  const samples = profile?.samples ?? [];
  const deltas = profile?.timeDeltas ?? [];
  // Each sample stands for the time until the next one (the last: the average step).
  const span = (i) => (i + 1 < deltas.length ? deltas[i + 1] : (deltas.length ? deltas.reduce((s, x) => s + x, 0) / deltas.length : 0));
  const keyOf = (cf) => `${cf.functionName || '(anonymous)'}|${cf.url}|${cf.lineNumber}|${cf.columnNumber}`;
  const fns = new Map();
  const fnOf = (n) => {
    const cf = n.callFrame;
    const k = keyOf(cf);
    let f = fns.get(k);
    if (!f) { f = { key: k, cf, self: 0, total: 0 }; fns.set(k, f); }
    return f;
  };
  let all = 0;
  let idle = 0;
  let gc = 0;
  let program = 0;
  const scripts = new Map();
  for (let i = 0; i < samples.length; i++) {
    const n = nodes.get(samples[i]);
    if (!n) continue;
    const us = span(i);
    all += us;
    const name = n.callFrame.functionName;
    if (name === '(idle)') { idle += us; continue; }
    if (name === '(garbage collector)') gc += us;
    if (name === '(program)') program += us;
    fnOf(n).self += us;
    const script = n.callFrame.url ? scriptName(n.callFrame.url) : SPECIAL.has(name) ? name : '(native)';
    scripts.set(script, (scripts.get(script) ?? 0) + us);
    // Total: once per function per sample, however deep the recursion.
    const seen = new Set();
    for (let id = n.id; id !== undefined; id = parent.get(id)) {
      const p = nodes.get(id);
      if (!p || p.callFrame.functionName === '(root)') break;
      const f = fnOf(p);
      if (seen.has(f)) continue;
      seen.add(f);
      f.total += us;
    }
  }
  const busy = all - idle;
  const ms = (us) => Math.round(us / 100) / 10;
  const pct = (us) => (busy ? Math.round((us / busy) * 1000) / 10 : 0);
  const place = (cf) => {
    if (!cf.url) return null;
    const map = maps.find((m) => m.match(cf.url));
    const hit = map ? map.lookup(cf.lineNumber, cf.columnNumber) : null;
    if (hit?.source) return { name: hit.name ?? null, where: `${hit.source}:${hit.line}`, mapped: true };
    return { name: null, where: `${scriptName(cf.url)}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`, mapped: false };
  };
  const rows = [...fns.values()].filter((f) => !SPECIAL.has(f.cf.functionName)).sort((a, b) => b.self - a.self).slice(0, top).map((f) => {
    const at = place(f.cf);
    const minified = f.cf.functionName || '(anonymous)';
    // V8 names a function from where it was declared or assigned; one it calls anonymous (a callback) stays so, and
    // `where` says which line it is on.
    return { name: f.cf.functionName ? at?.name ?? minified : '(anonymous)', ...(at?.mapped && at.name && at.name !== minified ? { minified } : {}), where: at?.where ?? '(native)', game: Boolean(f.cf.url && game(f.cf.url)), selfMs: ms(f.self), selfPct: pct(f.self), totalPct: pct(f.total) };
  });
  const byScript = [...scripts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([script, us]) => ({ script, ms: ms(us), pct: pct(us) }));
  let gameUs = 0;
  for (const f of fns.values()) if (f.cf.url && game(f.cf.url)) gameUs += f.self;
  return { ms: ms(all), busyMs: ms(busy), idlePct: all ? Math.round((idle / all) * 1000) / 10 : 0, gcPct: pct(gc), programPct: pct(program), gamePct: pct(gameUs), top: rows, scripts: byScript };
}

/** A script's address without the site: `/gem-rush/__game/assets/main.js`, `/_homie/site.js`. */
export function scriptName(url) {
  try { const u = new URL(url); return u.pathname || url; } catch { return String(url).slice(0, 120); }
}
