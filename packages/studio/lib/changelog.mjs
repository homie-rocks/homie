/**
 * CHANGELOG.md: what changed in each @homie-rocks/studio version, and the Homie plugin's version beside it.
 *
 * The repository keeps it at its root; the package carries an identical copy (packages/studio/CHANGELOG.md, in
 * `files`, kept the same by `node scripts/changelog.mjs --sync`), so an installed toolkit knows its own history with
 * no network. Read by:
 *   - `homie-studio upgrade`: "What's new since <the pinned version>", from the NEW version's own copy (the one
 *     `npx -y @homie-rocks/studio@<new> upgrade` runs);
 *   - the studio card (lib/mcp-tools.mjs), when a studio pins an older toolkit than the one answering;
 *   - scripts/changelog.mjs: CI's check, and the GitHub release notes the publish workflow writes.
 *
 * The shape (Keep a Changelog, https://keepachangelog.com/en/1.1.0/), newest first:
 *
 *   ## [0.19.2] - 2026-10-02                              one section per studio version
 *
 *   **Plugin 0.20.2** · [#29](…) · [release-…](…)          the meta line: the plugin's version (", then 0.20.3" when
 *                                                          the plugin had a release of its own after it), the pull
 *                                                          requests and the tag
 *   One sentence: what this version is.                    the summary "What's new" prints
 *
 *   ### Added | ### Changed | ### Fixed | ### Upgrade notes   bullets ("- " and lines indented under them)
 *
 *   [0.19.2]: https://…                                    link definitions, at the end of the file
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CHANGELOG_FILE = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url));
export const GROUPS = Object.freeze(['Added', 'Changed', 'Fixed', 'Upgrade notes']);
export const REPO_URL = 'https://github.com/homie-rocks/homie';

const VERSION = /^\d+\.\d+\.\d+$/;
const HEADING = /^## \[?(\d+\.\d+\.\d+)\]?(?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/;
const LINK_DEF = /^\[[^\]]+\]:\s+\S+/;

/** -1, 0 or 1, as a sorts before, with or after b (x.y.z only; anything else sorts first). */
export function compareVersions(a, b) {
  const x = VERSION.test(String(a)) ? String(a).split('.').map(Number) : [-1, -1, -1];
  const y = VERSION.test(String(b)) ? String(b).split('.').map(Number) : [-1, -1, -1];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** Markdown as one line of plain words: links keep their text, code and bold lose their marks. */
export function plain(markdown) {
  return String(markdown ?? '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The paragraphs and bullets of a run of lines: paragraphs split on blank lines, a bullet takes the lines indented under it. */
function blocks(lines) {
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (!line.trim()) { cur = null; continue; }
    if (/^- /.test(line)) { cur = { kind: 'bullet', text: line.slice(2).trim() }; out.push(cur); continue; }
    if (cur && (cur.kind === 'paragraph' || /^\s+\S/.test(line))) { cur.text += ` ${line.trim()}`; continue; }
    cur = { kind: 'paragraph', text: line.trim() }; out.push(cur);
  }
  return out;
}

/**
 * The file as its sections. Each: { version, date, plugin, plugins, meta, summary, notes, groups, body, line }.
 * `body` is the section's own Markdown (no heading, no link definitions), what a release's notes are made of.
 * `problems` lists what does not follow the shape (CI fails on them); a heading that is not a version (an
 * "Unreleased" one, say) ends the section before it and is otherwise left alone.
 */
export function parseChangelog(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const versions = [];
  const problems = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    while (cur.lines.length && !cur.lines[cur.lines.length - 1].trim()) cur.lines.pop();
    const { lines: own, ...section } = cur;
    section.body = own.join('\n').replace(/^\n+/, '');
    // Before the first ### heading: the meta line, the summary and any notes; then the groups.
    const groups = {};
    let head = [];
    let group = null;
    for (const line of own) {
      const g = /^### (.+?)\s*$/.exec(line);
      if (g) { group = g[1]; groups[group] = []; continue; }
      if (group === null) head.push(line); else groups[group].push(line);
    }
    const paras = blocks(head).map((b) => b.text);
    const metaAt = paras.findIndex((p) => /^\*\*Plugin /.test(p));
    section.meta = metaAt >= 0 ? paras[metaAt] : null;
    const rest = paras.filter((_, i) => i !== metaAt);
    section.summary = rest[0] ?? null;
    section.notes = rest.slice(1);
    section.plugins = section.meta ? [...(/^\*\*Plugin ([^*]+)\*\*/.exec(section.meta)?.[1] ?? '').matchAll(/\d+\.\d+\.\d+/g)].map((m) => m[0]) : [];
    section.plugin = section.plugins.at(-1) ?? null;
    section.groups = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, blocks(v).filter((b) => b.kind === 'bullet').map((b) => b.text)]));
    const where = `CHANGELOG.md line ${section.line} (## [${section.version}])`;
    if (!section.date) problems.push(`${where}: the heading has no date; write it as "## [${section.version}] - YYYY-MM-DD"`);
    if (!section.meta) problems.push(`${where}: no "**Plugin x.y.z** · …" line under the heading`);
    else if (!section.plugin) problems.push(`${where}: the Plugin line names no version`);
    if (!section.summary) problems.push(`${where}: no one-sentence summary under the Plugin line`);
    for (const k of Object.keys(section.groups)) if (!GROUPS.includes(k)) problems.push(`${where}: "### ${k}" is not one of ${GROUPS.map((g) => `"### ${g}"`).join(', ')}`);
    if (!Object.values(section.groups).some((b) => b.length)) problems.push(`${where}: no "- " entries under ${GROUPS.map((g) => `"### ${g}"`).join(', ')}`);
    versions.push(section);
    cur = null;
  };
  lines.forEach((line, i) => {
    if (/^## /.test(line)) {
      close();
      const m = HEADING.exec(line);
      if (m) cur = { version: m[1], date: m[2] ?? null, heading: line, line: i + 1, lines: [] };
      return;
    }
    if (cur && LINK_DEF.test(line)) { close(); return; }
    if (cur) cur.lines.push(line);
  });
  close();
  for (let i = 1; i < versions.length; i++) {
    if (compareVersions(versions[i - 1].version, versions[i].version) <= 0) problems.push(`CHANGELOG.md line ${versions[i].line}: ${versions[i].version} comes after ${versions[i - 1].version}; newest first, each version once`);
  }
  return { versions, problems };
}

/** The package's own CHANGELOG.md, parsed; null when it is missing (a checkout from before 0.19.2) or unreadable. */
export function readChangelog(file = CHANGELOG_FILE) {
  try { return { file, ...parseChangelog(readFileSync(file, 'utf8')) }; } catch { return null; }
}

/** One version's section, or null. */
export function sectionOf(changelog, version) {
  return changelog?.versions?.find((s) => s.version === version) ?? null;
}

/**
 * What changed after `from` up to and including `to`, newest first: each version's summary and its upgrade notes
 * (what the person may have to do). null when there is nothing to say (no pin known, no changelog, or not older).
 */
export function whatsNew(from, to, { changelog = readChangelog() } = {}) {
  if (!VERSION.test(String(from ?? '')) || !VERSION.test(String(to ?? '')) || compareVersions(from, to) >= 0 || !changelog) return null;
  const versions = changelog.versions
    .filter((s) => compareVersions(s.version, from) > 0 && compareVersions(s.version, to) <= 0)
    .map((s) => ({ version: s.version, date: s.date, plugin: s.plugin, summary: plain(s.summary), upgrade: (s.groups['Upgrade notes'] ?? []).map(plain) }));
  return versions.length ? { from, to, versions } : null;
}

/**
 * whatsNew as a few lines for a terminal or a card's text: one line per version (the newest `maxVersions`), then the
 * upgrade notes of every version in the range (the first `maxNotes`), each cut to `width`.
 */
export function whatsNewLines(news, { width = 110, maxVersions = 8, maxNotes = 8, source = null } = {}) {
  if (!news?.versions?.length) return [];
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
  const shown = news.versions.slice(0, maxVersions);
  const pad = Math.max(...news.versions.map((v) => v.version.length));
  const lines = [`What's new since ${news.from}${source ? ` (${source})` : ''}:`];
  for (const v of shown) lines.push(`  ${v.version.padEnd(pad)}  ${cut(v.summary ?? '', width - pad - 4)}`);
  const more = news.versions.length - shown.length;
  if (more) lines.push(`  … and ${more} earlier version${more === 1 ? '' : 's'} (CHANGELOG.md has every one)`);
  const notes = news.versions.flatMap((v) => v.upgrade.map((u) => [v.version, u]));
  if (notes.length) {
    lines.push('Upgrade notes (anything to do yourself):');
    for (const [v, u] of notes.slice(0, maxNotes)) lines.push(`  ${v.padEnd(pad)}  ${cut(u, width - pad - 4)}`);
    if (notes.length > maxNotes) lines.push(`  … and ${notes.length - maxNotes} more (--json has every one)`);
  }
  return lines;
}

/**
 * Markdown with each paragraph and each "- " entry on one line. CHANGELOG.md wraps them at 120 columns, which a
 * file ignores; GitHub's release notes render every line end as a break, so a wrapped entry would break mid-sentence.
 */
export function unwrap(markdown) {
  const out = [];
  for (const line of String(markdown ?? '').split('\n')) {
    const prev = out.length ? out[out.length - 1] : '';
    const starts = !line.trim() || /^(#{1,6} |- |\* |\d+\. |---\s*$|\|)/.test(line.trim()) && !/^\s+/.test(line);
    const continues = prev.trim() && !/^(#{1,6} |---\s*$|\|)/.test(prev.trim());
    if (!starts && continues) out[out.length - 1] = `${prev.replace(/\s+$/, '')} ${line.trim()}`;
    else out.push(line);
  }
  return out.join('\n');
}

/**
 * A GitHub release's notes: the version's section as it is in CHANGELOG.md (each paragraph and entry on one line),
 * then the Desktop extension's line (its .mcpb is attached to the release) and where every version is.
 */
export function releaseNotes(changelog, version, { tag = null, repo = REPO_URL } = {}) {
  const s = sectionOf(changelog, version);
  if (!s) return null;
  return [
    unwrap(s.body),
    '',
    '---',
    '',
    `Homie for Claude Desktop ${version}: [desktop/README.md](${repo}/blob/${tag ?? 'main'}/desktop/README.md) says how to install it (\`homie-studio-${version}.mcpb\` below).`,
    `Every version: [CHANGELOG.md](${repo}/blob/main/CHANGELOG.md).`,
    '',
  ].join('\n');
}
