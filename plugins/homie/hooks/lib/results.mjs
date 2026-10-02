/**
 * Homie's tool results, read back into data the mod draws natively: the setup status as a checklist, a check's rows,
 * a playtest's verdicts, a deploy's live links, and the cards the Homie MCP tools answer with (structuredContent
 * `kind` setup, build or studio). Each reader takes the text the command printed (the same formatter the studio's
 * CLI uses: test/mod-lib.test.mjs feeds them real output) and returns null when the text is not what it reads, so
 * the transcript then shows the tool's own output unchanged.
 */

const MARKS = { '✓': 'ok', '→': 'act', '✗': 'missing', '○': 'optional', '…': 'later', '?': 'unknown' };

/** The text of a tool's result: a Bash record's stdout, an MCP result's text blocks, or a string. */
export function textOf(output) {
  if (typeof output === 'string') return output;
  if (!output || typeof output !== 'object') return '';
  if (typeof output.stdout === 'string') return output.stdout;
  const blocks = Array.isArray(output) ? output : Array.isArray(output.content) ? output.content : null;
  if (blocks) return blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  return '';
}

/** An MCP result's structuredContent (the Homie MCP's cards carry `kind`), or null. */
export function structuredOf(output) {
  if (!output || typeof output !== 'object') return null;
  if (output.structuredContent && typeof output.structuredContent === 'object') return output.structuredContent;
  if (typeof output.kind === 'string') return output;
  return null;
}

/** `homie-studio setup status` (lib/doctor.mjs formatStatus): { title, rows, ready, next, note } or null. */
export function parseSetupStatus(text) {
  const lines = String(text ?? '').split('\n');
  const head = lines.findIndex((l) => /^Setup status( for .+| \(before the studio exists\))\s*$/.test(l));
  if (head < 0) return null;
  const title = lines[head].trim();
  const rows = [];
  let i = head + 1;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^Ready: /.test(l)) break;
    const row = /^ {2}([✓→✗○…?]) (\S.*?)(?: {2,}|$)(\((?:optional|recommended)\) )?(.*)$/.exec(l);
    if (row) { rows.push({ state: MARKS[row[1]], label: row[2].trim(), need: row[3] ? row[3].replace(/[() ]/g, '') : 'required', detail: row[4].trim(), unlocks: '', fix: '' }); continue; }
    const more = /^ {4,}(unlocks |fix: )?(.*)$/.exec(l);
    if (more && rows.length) {
      const last = rows[rows.length - 1];
      if (more[1] === 'unlocks ') last.unlocks = more[2].trim();
      else if (more[1] === 'fix: ') last.fix = more[2].trim();
      else if (more[2].trim()) last.fix = last.fix ? `${last.fix} ${more[2].trim()}` : more[2].trim();
    }
  }
  if (!rows.length) return null;
  const ready = [];
  const readyLine = lines.find((l) => /^Ready: /.test(l));
  if (readyLine) {
    for (const part of readyLine.slice(7).split(' · ')) {
      const m = /^(.*?)\s+([✓○…])$/.exec(part.trim());
      if (m) ready.push({ feature: m[1], state: m[2] === '✓' ? 'ready' : m[2] === '…' ? 'later' : 'optional' });
    }
  }
  const next = [];
  const now = lines.findIndex((l) => /^Do this now:/.test(l));
  if (now >= 0) for (let k = now + 1; k < lines.length && /^ {2}→ /.test(lines[k]); k++) next.push(lines[k].replace(/^ {2}→ /, '').trim());
  return { title, rows, ready, next };
}

/** `homie-studio check` (two browsers, one room, one round): { ok, summary, rows, why } or null. */
export function parseCheck(text, { known = false } = {}) {
  const t = String(text ?? '');
  const pass = /^PASS: two fresh browsers in room (\S+) finished round (\d+) \((\d+) humans?, (\d+) bots?\) in (\d+) s\.$/m.exec(t);
  if (pass) {
    const rows = [
      { state: 'pass', label: 'Two fresh browsers seated', note: '' },
      { state: 'pass', label: `Same room (${pass[1]})`, note: '' },
      { state: 'pass', label: `Round ${pass[2]} finished`, note: `${pass[3]} humans, ${pass[4]} bots` },
    ];
    for (const m of t.matchAll(/^ {2}(\w+): seat (\d+) \((\w+)\), seated in ([\d.]+) s$/gm)) rows.push({ state: 'pass', label: `${m[1]} seated`, note: `seat ${m[2]}, ${m[3]}, ${m[4]} s` });
    for (const m of t.matchAll(/^ {2}(\w+) drew (\S+) fps(?: on (.+))?$/gm)) rows.push({ state: 'info', label: `${m[1]} frame rate`, note: `${m[2]} fps${m[3] ? ` on ${m[3]}` : ''}` });
    return { ok: true, kind: 'check', summary: `Two browsers finished a round in ${pass[5]} s`, rows };
  }
  const fail = /^homie-studio: (.+)$/m.exec(t);
  if (fail && known) return { ok: false, kind: 'check', summary: 'The two-browser check did not pass', rows: [{ state: 'fail', label: 'Two-browser check', note: fail[1] }], why: fail[1] };
  return null;
}

/** `homie-studio port check`: { ok, summary, rows, receipt } or null. */
export function parsePortCheck(text) {
  const t = String(text ?? '');
  const head = /^(PASS|NOT YET): (\S+) at (\S+) \((\d+) s\)$/m.exec(t);
  if (!head) return null;
  const rows = [];
  for (const m of t.matchAll(/^ {2}(ok|FAIL|skip) {1,4}(.+)$/gm)) rows.push({ state: m[1] === 'ok' ? 'pass' : m[1] === 'FAIL' ? 'fail' : 'skip', label: m[2].trim(), note: '' });
  const receipt = /^Receipt and screenshots: (.+)$/m.exec(t)?.[1] ?? null;
  return { ok: head[1] === 'PASS', kind: 'port check', summary: `${head[1] === 'PASS' ? 'Passed' : 'Not yet'}: ${head[2]} (${head[4]} s)`, game: head[2], url: head[3], rows, receipt };
}

/** The playtest skill's `run` / `report` print: { ok, summary, rows, weak, report } or null. */
export function parsePlaytest(text) {
  const t = String(text ?? '');
  const block = /^rows:\n((?: {2}.*\n?)+)/m.exec(t);
  if (!block) return null;
  const rows = [];
  for (const l of block[1].split('\n')) {
    const m = /^ {2}(PASS|FAIL|WARN|BLOCKED)\s+(.+?)(?::\s+(.+))?$/.exec(l);
    if (m) rows.push({ state: m[1] === 'PASS' ? 'pass' : m[1] === 'FAIL' ? 'fail' : m[1] === 'WARN' ? 'warn' : 'blocked', label: m[2], note: m[3] ?? '' });
  }
  if (!rows.length) return null;
  const weak = /^weak:\n((?: {2}.*\n?)+)/m.exec(t)?.[1].split('\n').map((l) => l.trim()).filter(Boolean) ?? [];
  const game = /^game: (.+)$/m.exec(t)?.[1] ?? null;
  const report = /^report: (.+)$/m.exec(t)?.[1] ?? null;
  const fails = rows.filter((r) => r.state === 'fail').length;
  return { ok: fails === 0, kind: 'playtest', game, summary: `${rows.filter((r) => r.state === 'pass').length} pass · ${fails} fail · ${rows.filter((r) => r.state === 'warn').length} warn${rows.some((r) => r.state === 'blocked') ? ' · some could not be judged here' : ''}`, rows, weak, report };
}

/** `homie-studio deploy`: { ok, url, also, games: [{ id, play }], media, cloudflare, claim } or null. */
export function parseDeploy(text) {
  const t = String(text ?? '');
  const live = /^Live: (\S+)(?: \(commit ([0-9a-f]{7})(?: on (\S+))?\))?$/m.exec(t);
  if (!live) return null;
  const games = [];
  const media = [];
  for (const m of t.matchAll(/^ {2}([a-z0-9][a-z0-9-]*): (https?:\/\/\S+)$/gm)) games.push({ id: m[1], play: m[2] });
  for (const m of t.matchAll(/^ {2}(song|video) (\S+): (https?:\/\/\S+)$/gm)) media.push({ kind: m[1], slug: m[2], page: m[3] });
  const also = /^ {2}also at (\S+)$/m.exec(t)?.[1] ?? null;
  const cloudflare = /^Cloudflare: (.+)$/m.exec(t)?.[1] ?? null;
  return { ok: true, kind: 'deploy', url: live[1].replace(/[.,]$/, ''), commit: live[2] ?? null, branch: live[3] ?? null, also, games, media, cloudflare, claim: /claimed itself in the directory/.test(t) };
}

/** Which reader a result goes to, from what the tool call was (when the mod saw it) or from the text alone. */
export function readResult({ tool, call, output }) {
  const s = structuredOf(output);
  if (s && ['setup', 'build', 'studio'].includes(s.kind)) return { kind: `card:${s.kind}`, data: s };
  const text = textOf(output);
  if (!text) return null;
  const sub = call?.sub ?? null;
  if (sub === 'setup status' || sub === 'doctor' || /^Setup status/m.test(text)) { const d = parseSetupStatus(text); if (d) return { kind: 'setup', data: d }; }
  if (sub === 'port check' || /^(PASS|NOT YET): \S+ at \S+ \(\d+ s\)$/m.test(text)) { const d = parsePortCheck(text); if (d) return { kind: 'checks', data: d }; }
  if (sub === 'check' || /^PASS: two fresh browsers/m.test(text)) { const d = parseCheck(text, { known: sub === 'check' }); if (d) return { kind: 'checks', data: d }; }
  if (call?.playtest || /^rows:\n {2}(PASS|FAIL|WARN|BLOCKED)/m.test(text)) { const d = parsePlaytest(text); if (d) return { kind: 'checks', data: d }; }
  if (sub === 'deploy' || /^Live: https?:\/\//m.test(text)) { const d = parseDeploy(text); if (d) return { kind: 'deploy', data: d }; }
  if (tool && /__(?:setup_status|studio_scaffold|studio_open)$/.test(tool)) { const d = parseSetupStatus(text); if (d) return { kind: 'setup', data: d }; }
  return null;
}
