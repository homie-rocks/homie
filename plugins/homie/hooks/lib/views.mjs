/**
 * What the Homie mod draws: the band above the prompt, the Studio pane's tabs, the parts pane, the arcade, the guard
 * panels above Claude Code's question dialog, and Homie's tool results. Every function takes the surface's element
 * table (`t`, from `$.ui.resolve(e)`) and plain data, and returns a tree; none calls the mods API. Callbacks
 * (`on.*`) come from the hooks module, which owns every `$` call.
 *
 * Drawn for the terminal and the Claude desktop app's Code tab alike: pictures are a `Raster` (or an `Image`) in the
 * terminal and an `Svg` on the desktop; everything else is Box, Text, Button, Link, Code, Select and Input.
 */
import { ago, bar, markOf } from './feed.mjs';

export const ACCENT = '#ffcf5a';
const DIM = { dimColor: true };

/** One line of text: a string or inline parts, with Text styles. */
export function line(t, parts, style = {}) {
  return t.Text({ ...style, children: (Array.isArray(parts) ? parts : [parts]).filter((p) => p !== null && p !== undefined && p !== false).map((p) => (typeof p === 'string' || typeof p === 'number' ? String(p) : p)) });
}
const span = (t, text, style = {}) => t.Text({ ...style, children: [String(text)] });
const col = (t, children, props = {}) => t.Box({ flexDirection: 'column', ...props, children: children.filter(Boolean) });
const row = (t, children, props = {}) => t.Box({ flexDirection: 'row', columnGap: 1, ...props, children: children.filter(Boolean) });

/** A link the person opens (`https:` or this computer's dev site); plain text where the address is not one. */
export function link(t, href, label) {
  const h = linkable(href);
  let ok = typeof h === 'string' && (/^https:\/\/[^\s@]+$/.test(h) || /^http:\/\/localhost(?::\d+)?(?:\/[^\s@]*)?$/.test(h));
  let norm = null;
  try { norm = ok ? new URL(h).href : null; } catch { ok = false; }
  return ok && norm.length <= 2048 ? t.Link({ href: norm, label: label ?? href }) : span(t, label ? `${label} ${href ?? ''}` : String(href ?? ''), DIM);
}

/** A localhost URL as Claude Code's Link takes it (`http://localhost`), for this computer's dev site at 127.0.0.1. */
export const linkable = (url) => (typeof url === 'string' ? url.replace(/^http:\/\/127\.0\.0\.1(?=[:/]|$)/, 'http://localhost') : url);

const fit = (text, n) => { const s = String(text ?? ''); return s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}…`; };

/* ------------------------------------------------------------------ the band */

/**
 * The band above the prompt: studio · game · build step or % · ▶ Play · N playing now. Parts drop from the end to fit
 * `columns`. Returns null outside a studio.
 */
export function band(t, s, columns) {
  if (!s || !s.name) return null;
  // One row, always: inline parts in one Text, dropped from the end to fit, and cut at the edge if still too long.
  // A link counts its address too (a terminal draws the URL after the label).
  const parts = [];
  parts.push({ w: s.name.length + 2, el: span(t, `◆ ${s.name}`, { bold: true, color: ACCENT }) });
  if (s.game) parts.push({ w: s.game.length, el: span(t, s.game) });
  if (s.build) {
    const b = s.build;
    if (b.state === 'running') {
      const bars = bar(b.percent, 8);
      const label = b.stopping ? 'stopping…' : b.stage ?? 'Starting';
      parts.push({ w: label.length + 14, el: line(t, [span(t, label, { color: 'cyan' }), ' ', span(t, bars.done, { color: 'green' }), span(t, bars.left, DIM), ` ${b.percent}%`]) });
      if (b.checks) parts.push({ w: b.checks.length, el: span(t, b.checks, b.failing ? { color: 'red' } : DIM) });
    } else if (b.state === 'passed') parts.push({ w: 8, el: span(t, '✓ built', { color: 'green' }) });
    else if (b.state === 'failed') parts.push({ w: 10 + (b.stage?.length ?? 0), el: span(t, `✗ failed${b.stage ? ` at ${b.stage}` : ''}`, { color: 'red' }) });
    else if (b.state === 'stopped') parts.push({ w: 9, el: span(t, '■ stopped', { color: 'yellow' }) });
  }
  if (s.playing !== null && s.playing !== undefined) parts.push({ w: 16, el: span(t, s.playing ? `${s.playing} playing now` : 'nobody playing', s.playing ? { color: 'green' } : DIM) });
  if (s.play) parts.push({ w: 8 + String(s.play).length, el: link(t, s.play, '▶ Play') });
  const width = Math.max(20, (columns ?? 80) - 4);
  let used = 0;
  const shown = [];
  for (const p of parts) {
    if (shown.length >= 1 && used + p.w + 3 > width) continue;
    used += p.w + 3;
    shown.push(p.el);
  }
  const kids = [' '];
  shown.forEach((el, i) => { if (i) kids.push(span(t, ' · ', DIM)); kids.push(el); });
  return t.Text({ wrap: 'truncate-end', children: kids });
}

/* ------------------------------------------------------------------ the pane's frame */

export const TABS = [['build', 'Build', '1'], ['rooms', 'Rooms', '2'], ['games', 'Games', '3'], ['stats', 'Stats', '4'], ['codex', 'Codex', '5'], ['lab', 'Lab', '6'], ['parts', 'Parts', '7']];

export function paneFrame(t, { s, tab, onTab, body, columns }) {
  const site = s.live ? ['live', s.live] : s.dev ? ['here', s.dev] : null;
  const head = row(t, [
    span(t, `◆ ${s.name}`, { bold: true, color: ACCENT }),
    site ? span(t, '·', DIM) : null,
    site ? link(t, linkable(site[1]), site[0] === 'live' ? 'live' : 'this computer') : span(t, '· not online yet', DIM),
  ]);
  const tabs = t.Box({
    flexDirection: 'row', columnGap: 2, flexWrap: 'wrap',
    children: TABS.map(([id, label, key]) => t.Button({ key: `tab-${id}`, label, hotkey: key, plain: true, ...(id === tab ? {} : { dimColor: true }), onPress: () => onTab(id) })),
  });
  return col(t, [head, tabs, span(t, '─'.repeat(Math.max(10, Math.min(columns, 200))), DIM), body]);
}

/* ------------------------------------------------------------------ Build */

function stagesRow(t, stages) {
  const kids = [];
  stages.forEach((st, i) => {
    const m = markOf(st.state);
    if (i) kids.push(span(t, '→', DIM));
    kids.push(span(t, `${m.mark} ${st.label}`, { ...(m.color ? { color: m.color } : {}), ...(m.dim ? DIM : {}), ...(st.state === 'running' ? { bold: true } : {}) }));
  });
  return t.Box({ flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', children: kids });
}

export function checkRows(t, checks, width) {
  return checks.map((c) => {
    const m = c.state === 'info' ? { mark: '·', dim: true } : c.state === 'warn' ? { mark: '!', color: 'yellow' } : c.state === 'blocked' ? { mark: '?', color: 'yellow' } : markOf(c.state);
    const note = [c.ms ? `${(c.ms / 1000).toFixed(1)} s` : '', c.note ?? ''].filter(Boolean).join(' · ');
    return line(t, [span(t, ` ${m.mark} `, { ...(m.color ? { color: m.color } : {}), ...(m.dim ? DIM : {}) }), span(t, fit(c.label, 34)), note ? span(t, `  ${fit(note, Math.max(10, width - 40))}`, DIM) : null], { wrap: 'truncate-end' });
  });
}

/** The picture of a build or a game: a Raster or an Image in the terminal, an Svg on the desktop, words where none. */
export function picture(t, surface, pic, { alt, onWatch } = {}) {
  if (!pic) return null;
  if (surface === 'terminal' && pic.cells && t.Raster) return t.Raster({ key: pic.key ?? 'frame', columns: pic.columns, rows: pic.rows, cells: pic.cells });
  if (surface === 'terminal' && pic.image && t.Image) return t.Image({ key: pic.key ?? 'frame', source: pic.image, columns: pic.columns, rows: pic.rows, alt: alt ?? 'the latest frame' });
  if (pic.svg && t.Svg) return t.Svg({ source: pic.svg, alt: alt ?? 'the latest frame', ...(pic.width ? { width: pic.width } : {}), ...(pic.height ? { height: pic.height } : {}) });
  return span(t, `[${alt ?? 'picture'}]`, DIM);
}

export function buildTab(t, { surface, s, b, last, columns, pic, watch, now, on }) {
  if (!b) {
    return col(t, [
      span(t, 'No build is running.', { bold: true }),
      last ? line(t, [span(t, `${markOf(last.state).mark} `, { color: markOf(last.state).color ?? undefined }), `${last.title} ${last.state} ${ago(last.endedAt ?? last.updatedAt, now)}`], DIM) : null,
      span(t, 'Ask Claude to build a game and this tab follows it: plan, build, checks, deploy, with the latest frame.', DIM),
      s.games.length ? line(t, ['Games here: ', s.games.map((g) => g.name ?? g.id).join(', ')], DIM) : null,
    ]);
  }
  const bars = bar(b.percent, Math.max(8, Math.min(20, Math.floor(columns / 6))));
  const title = row(t, [
    span(t, fit(b.title, Math.max(12, columns - 40)), { bold: true }),
    span(t, b.state === 'running' ? (b.stopping ? 'stopping…' : b.stage?.label ?? '') : b.state, { color: b.state === 'running' ? 'cyan' : markOf(b.state).color ?? 'white' }),
    line(t, [span(t, bars.done, { color: b.state === 'failed' ? 'red' : 'green' }), span(t, bars.left, DIM), ` ${b.percent}%`]),
  ]);
  const meta = line(t, [`started ${ago(b.startedAt, now)}`, b.spend.text ? ` · ${b.spend.text}` : '', b.counts.total ? ` · ${b.counts.pass}/${b.counts.total} checks` : ''], DIM);
  const checks = b.checks.length ? col(t, checkRows(t, b.checks.slice(-10), columns)) : null;
  const links = row(t, [
    b.preview ? link(t, linkable(b.preview), '▶ Play') : null,
    watch?.url ? link(t, linkable(watch.url), '◉ Watch') : null,
    b.change?.url ? link(t, b.change.url, `PR #${b.change.number ?? ''}`) : null,
  ], { columnGap: 3 });
  const live = watch?.live
    ? col(t, [
        line(t, [span(t, '● live', { color: 'red', bold: true }), ` ${watch.label ?? ''}`, watch.fps ? `  ${watch.fps} fps` : ''], DIM),
        picture(t, surface, watch.pic, { alt: 'the live room' }),
      ])
    : pic ? col(t, [picture(t, surface, pic, { alt: b.previewCaption || 'the latest check frame' }), line(t, [b.previewCaption || 'latest check frame', b.previewAt ? ` · ${ago(b.previewAt, now)}` : ''], DIM)]) : null;
  const buttons = row(t, [
    watch?.room && !watch.live ? t.Button({ key: 'watch-live', label: 'Watch it live', hotkey: 'w', plain: true, onPress: on.watch }) : null,
    watch?.live ? t.Button({ key: 'watch-stop', label: 'Stop watching', hotkey: 'w', plain: true, onPress: on.unwatch }) : null,
    b.state === 'running' && !b.stopping ? t.Button({ key: 'stop-build', label: 'Stop the build', hotkey: 'x', plain: true, onPress: on.stop }) : null,
  ], { columnGap: 3 });
  return col(t, [
    title, meta, stagesRow(t, b.stages),
    b.error ? span(t, `✗ ${fit(b.error, columns * 2)}`, { color: 'red' }) : null,
    checks, links, live, buttons,
    b.log.length ? col(t, b.log.slice(-3).map((l) => span(t, fit(l, columns), DIM))) : null,
  ], { rowGap: 0 });
}

/* ------------------------------------------------------------------ Rooms */

export function roomsTab(t, { s, rooms, office, asks, forYou, columns, now, busy, why, on }) {
  const groups = [];
  const all = [...(rooms.live?.rooms ?? []).map((r) => ({ ...r, where: 'live', base: s.live })), ...(rooms.dev?.rooms ?? []).map((r) => ({ ...r, where: 'here', base: s.dev }))];
  const playing = (rooms.live?.playing ?? 0) + (rooms.dev?.playing ?? 0);
  groups.push(row(t, [
    span(t, all.length ? `${playing} playing in ${all.length} room${all.length === 1 ? '' : 's'}` : 'No live rooms right now', { bold: true }),
    rooms.at ? span(t, `· ${ago(new Date(rooms.at).toISOString(), now)}`, DIM) : null,
    t.Button({ key: 'rooms-refresh', label: 'Refresh', hotkey: 'r', plain: true, onPress: on.refresh }),
    s.toolkit ? t.Button({ key: 'rooms-owner', label: office?.data ? 'Owner view: on' : 'Owner view', hotkey: 'o', plain: true, onPress: on.owner }) : null,
  ], { columnGap: 2 }));
  if (busy) groups.push(span(t, `… ${busy}`, { color: 'cyan' }));
  if (why) groups.push(span(t, fit(why, columns * 3), { color: 'yellow' }));
  for (const r of all) {
    const owner = office?.data?.games?.find((g) => g.id === r.game)?.rooms?.find((x) => x.room === r.room) ?? null;
    const pips = '●'.repeat(Math.min(r.players, 16)) + '○'.repeat(Math.max(0, Math.min(r.max, 16) - Math.min(r.players, 16)));
    groups.push(col(t, [
      row(t, [
        span(t, fit(`${r.name} · ${r.server ? `${r.server.name} · ` : ''}${r.label}`, Math.max(16, columns - 30)), { bold: true }),
        span(t, `${r.players}/${r.max}`, { color: r.players ? 'green' : undefined }),
        span(t, pips, { color: 'green' }),
        r.ai ? span(t, `${r.ai} AI`, { color: 'magenta' }) : null,
        r.where === 'here' ? span(t, 'this computer', DIM) : null,
      ]),
      row(t, [
        r.watch && r.base ? link(t, linkable(new URL(r.watch, r.base).href), '◉ Watch') : null,
        r.base ? link(t, linkable(new URL(r.play, r.base).href), '▶ Join') : null,
        r.watch && r.base ? t.Button({ key: `watch-here-${r.where}-${r.game}-${r.room}`, label: 'Watch in the pane', plain: true, onPress: () => on.watchHere(r) }) : null,
      ], { columnGap: 3, paddingLeft: 2 }),
      ...(owner ? owner.clients.map((c) => row(t, [
        span(t, c.seat !== null && c.seat !== undefined ? `seat ${c.seat + 1}` : 'watching', DIM),
        span(t, fit(String(c.name ?? 'someone'), 22)),
        span(t, `${c.device ?? ''}${c.role === 'host' ? ' · host' : ''}${c.muted ? ' · muted' : ''}`, DIM),
        c.seat !== null && c.seat !== undefined && (r.where === 'live' || !s.live) ? t.Button({ key: `mute-${r.game}-${r.room}-${c.seat}`, label: c.muted ? 'Unmute' : 'Mute', onPress: () => on.mute(r, c) }) : null,
        c.seat !== null && c.seat !== undefined && (r.where === 'live' || !s.live) ? t.Button({ key: `kick-${r.game}-${r.room}-${c.seat}`, label: 'Kick', onPress: () => on.kick(r, c) }) : null,
      ], { paddingLeft: 2 })) : []),
      owner ? t.Input({ key: `announce-${r.where}-${r.game}-${r.room}`, label: '  Announce', placeholder: 'a line every player in this room sees', value: '', submitLabel: 'announce', onSubmit: (text) => on.announce(r, text) }) : null,
    ], { marginTop: 1 }));
  }
  if (office?.data && !all.length) groups.push(span(t, 'The owner view lists who is in each room once someone plays.', DIM));
  if (asks.length) {
    groups.push(col(t, [
      span(t, 'Waiting for your tap (the office asks; nothing happens until you confirm in your own browser):', { color: ACCENT, bold: true }),
      ...asks.slice(-4).map((a) => row(t, [span(t, fit(a.what, Math.max(20, columns - 16))), a.link ? link(t, a.link, 'Open ↗') : null], { paddingLeft: 2 })),
    ], { marginTop: 1 }));
  }
  if (forYou.length) {
    groups.push(col(t, [
      span(t, 'Links for you (kept out of Claude\'s view):', { color: ACCENT, bold: true }),
      ...forYou.slice(-4).map((a) => row(t, [span(t, `${a.at ? new Date(a.at).toTimeString().slice(0, 5) : ''}`, DIM), link(t, a.link, 'one-time owner link ↗')], { paddingLeft: 2 })),
    ], { marginTop: 1 }));
  }
  if (!s.live && !s.dev) groups.push(span(t, 'This studio is not online yet: deploy it, or run its dev site, and its rooms show here.', DIM));
  return col(t, groups);
}

/* ------------------------------------------------------------------ Games */

export function gamesTab(t, { s, rooms, office, columns, on }) {
  if (!s.games.length) return col(t, [span(t, 'No games yet.', { bold: true }), span(t, 'Ask Claude to plan one: its Game Codex comes first, then the build.', DIM)]);
  const live = new Map((rooms.games ?? []).map((g) => [g.id, g]));
  return col(t, s.games.map((g) => {
    const o = office?.data?.games?.find((x) => x.id === g.id) ?? null;
    const launch = o?.launch ?? g.launch ?? 'public';
    const remix = o ? o.remix : g.remix !== false;
    const base = s.live ?? s.dev;
    const playing = (rooms.live?.rooms ?? []).filter((r) => r.game === g.id).reduce((n, r) => n + r.players, 0);
    return col(t, [
      row(t, [
        span(t, fit(g.name ?? g.id, Math.max(10, columns - 40)), { bold: true }),
        span(t, g.id, DIM),
        span(t, launch, { color: launch === 'public' ? 'green' : launch === 'invite' ? 'yellow' : 'magenta' }),
        span(t, remix ? 'remixable' : 'source closed', DIM),
        s.live ? span(t, live.has(g.id) || playing ? 'live' : 'not live yet', live.has(g.id) || playing ? { color: 'green' } : DIM) : null,
        playing ? span(t, `${playing} playing`, { color: 'green' }) : null,
      ]),
      g.blurb ? span(t, fit(g.blurb, columns * 2), DIM) : null,
      row(t, [
        base ? link(t, linkable(`${base}/${g.id}/play`), '▶ Play') : null,
        base ? link(t, linkable(`${base}/${g.id}/`), 'Page') : null,
        s.toolkit && (s.live || s.dev) ? t.Select({ key: `launch-${g.id}`, label: 'Launch', value: launch, options: [{ value: 'private', label: 'private' }, { value: 'invite', label: 'invite-only beta' }, { value: 'public', label: 'public' }], onSelect: (v) => on.launch(g, v) }) : null,
        s.toolkit && (s.live || s.dev) ? t.Button({ key: `remix-${g.id}`, label: remix ? 'Remix: on' : 'Remix: off', onPress: () => on.remix(g, !remix) }) : null,
      ], { columnGap: 3, paddingLeft: 2 }),
    ], { marginBottom: 1 });
  }).concat([s.toolkit && (s.live || s.dev) ? span(t, `Launch and remix changes are asked for: you confirm each with one tap in your own browser (Rooms shows the link)${s.live ? '' : '. Not online yet: this computer\'s dev site keeps its own settings'}.`, DIM) : span(t, 'Launch states and the remix switch need the studio\'s site (live, or its dev site here) and its toolkit (npm install).', DIM)]));
}

/* ------------------------------------------------------------------ Stats */

const SPARK = '▁▂▃▄▅▆▇█';
export function spark(values) {
  const top = Math.max(1, ...values);
  return values.map((v) => SPARK[Math.min(7, Math.floor((v / top) * 7.999))]).join('');
}

export function statsTab(t, { s, stats, columns, now, busy, why, on }) {
  const head = row(t, [
    span(t, 'Last 7 days', { bold: true }),
    stats?.at ? span(t, `· read ${ago(new Date(stats.at).toISOString(), now)}`, DIM) : null,
    s.toolkit && (s.live || s.dev) ? t.Button({ key: 'stats-refresh', label: stats?.data ? 'Refresh' : 'Read the numbers', hotkey: 'r', plain: true, onPress: on.refresh }) : null,
  ], { columnGap: 2 });
  if (!stats?.data) {
    return col(t, [head, busy ? span(t, `… ${busy}`, { color: 'cyan' }) : null, why ? span(t, fit(why, columns * 3), { color: 'yellow' }) : null,
      span(t, s.live || s.dev ? `The studio's own counts (never tracking): visits, plays, rounds, peak players, where people came from${s.live ? '. Reading them mints a 10-minute key with the studio\'s own Cloudflare login, and drops it' : ', from this computer\'s dev site until the studio is online'}.` : 'Stats come from the studio\'s site: deploy it, or run its dev site.', DIM)]);
  }
  const d = stats.data;
  const n = (x) => Number(x || 0).toLocaleString('en-US');
  const tt = d.totals ?? {};
  const days = Array.isArray(d.days) ? d.days : [];
  const tiles = [['visits', tt.visits], ['plays', tt.plays], ['rounds', tt.rounds], ['peak', tt.peakPlayers], ['now', tt.playingNow]];
  return col(t, [
    head,
    busy ? span(t, `… ${busy}`, { color: 'cyan' }) : null,
    t.Box({ flexDirection: 'row', columnGap: 3, flexWrap: 'wrap', children: tiles.map(([k, v]) => col(t, [span(t, n(v), { bold: true, color: ACCENT }), span(t, k, DIM)])) }),
    days.length ? line(t, ['plays  ', span(t, spark(days.map((x) => x.plays ?? 0)), { color: 'green' }), '   visits  ', span(t, spark(days.map((x) => x.visits ?? 0)), { color: 'cyan' })]) : null,
    ...(d.games ?? []).slice(0, 8).map((g) => line(t, [span(t, fit(g.id, 18)), `  ${n(g.plays)} plays · ${n(g.rounds)} rounds · peak ${n(g.peakPlayers)} · now ${n(g.playingNow)}`], { wrap: 'truncate-end' })),
    d.crossings ? line(t, [`from homie.rocks ${n(d.crossings.fromHub)} · other studios ${n(d.crossings.fromStudios)} · search ${n(d.crossings.fromSearch)} · the web ${n(d.crossings.fromWeb)}`], DIM) : null,
    ...(d.referrers ?? []).slice(0, 4).map((r) => span(t, `  ${fit(r.from, 30)}  ${n(r.visits)} visits, ${n(r.plays)} plays`, DIM)),
    d.players ? span(t, `players: ${n(d.players.accounts)} accounts, ${n(d.players.active7d)} played this week`, DIM) : null,
  ]);
}

/* ------------------------------------------------------------------ Codex */

export function codexTab(t, { s, codexes, links, columns, busy, on }) {
  if (!codexes.length) return col(t, [span(t, 'No Game Codex yet.', { bold: true }), span(t, 'Ask Claude to plan your game: a short interview becomes games/<id>/CODEX.md, a page in the game\'s own look.', DIM)]);
  return col(t, codexes.map((c) => col(t, [
    row(t, [span(t, fit(c.title ?? c.id, columns - 20), { bold: true, color: ACCENT }), span(t, `games/${c.id}/CODEX.md`, DIM)]),
    c.pitch ? span(t, fit(c.pitch, columns * 3)) : null,
    t.Box({ flexDirection: 'row', columnGap: 2, flexWrap: 'wrap', children: c.sections.filter((x) => x.key && x.key !== 'latest').map((x) => span(t, `${x.filled ? '✓' : '○'} ${x.title}`, x.filled ? { color: 'green' } : DIM)) }),
    c.missing.length ? span(t, `not decided yet: ${c.missing.join(', ')}`, { color: 'yellow' }) : null,
    c.openQuestions ? col(t, [span(t, `${c.openQuestions} open question${c.openQuestions === 1 ? '' : 's'}:`, DIM), ...c.questions.slice(0, 3).map((q) => span(t, `  ? ${fit(q, columns - 6)}`))]) : null,
    c.milestones.length ? span(t, `milestones ${c.milestones.filter((m) => m.done).length}/${c.milestones.length}: ${c.milestones.map((m) => (m.done ? '■' : '□')).join('')}`, DIM) : null,
    ...c.latest.map((l) => span(t, `  · ${fit(l, columns - 6)}`, DIM)),
    row(t, [
      links[c.id] ? link(t, links[c.id], 'Open the codex ↗') : s.toolkit && (s.live || s.dev) ? t.Button({ key: `codex-link-${c.id}`, label: 'Get a private link to the codex page', plain: true, onPress: () => on.link(c) }) : span(t, `the page: .studio/codex/${c.id}.html (homie-studio codex ${c.id})`, DIM),
    ], { paddingLeft: 2 }),
  ], { marginBottom: 1 })).concat([busy ? span(t, `… ${busy}`, { color: 'cyan' }) : null]));
}

/* ------------------------------------------------------------------ Lab */

/** A take's phases in one line, as the lab names them: "windup 6f → rise 14f → land 4f". */
const phasesOf = (ps) => (ps ?? []).map((p) => `${p.name} ${Math.max(0, p.to - p.from + 1)}f`).join(' → ');

/**
 * The Game Lab (`homie-studio lab`, studio 0.20.0 and later): whether its page is running on this computer, and each
 * game's last lab check (.studio/lab/<game>/latest.json): the take, New's phases beside Today's, whether a replay
 * landed on the same frames, and the game's JavaScript per frame in both builds. Read from files; nothing is run.
 */
export function labTab(t, { lab, games, columns, now }) {
  const name = (id) => games.find((g) => g.id === id)?.name ?? id;
  const head = lab.url
    ? row(t, [span(t, '● The Game Lab is running', { color: 'green', bold: true }), link(t, `${lab.url}/`, 'Open the lab ↗')])
    : span(t, 'The Game Lab is not running. Ask Claude to tune how a move feels ("iterate on the jump"): it opens the lab, New beside Today.', DIM);
  if (!lab.checks.length) return col(t, [head, span(t, 'No lab check yet. A check plays the take in New and in Today, headless, and compares them frame by frame.', DIM)]);
  const replay = (which, n) => (n === null ? span(t, `✓ ${which} replays the same frames`, { color: 'green' }) : span(t, `✗ ${which} drifts from frame ${n}`, { color: 'red' }));
  return col(t, [head, ...lab.checks.map((c) => col(t, [
    row(t, [span(t, fit(name(c.game), Math.max(12, columns - 34)), { bold: true, color: ACCENT }), span(t, c.take ? `take "${fit(c.take, 24)}"` : 'no take yet', DIM), span(t, ago(c.at, now), DIM)]),
    span(t, `${c.frames} frames at ${c.fps} fps${c.device ? ` · ${c.device}` : ''}${c.today ? ` · Today is ${c.today}` : ''}`, DIM),
    line(t, [span(t, 'New    ', { bold: true }), fit(phasesOf(c.timeline.new) || 'no phases', columns - 8)]),
    c.timeline.today ? line(t, [span(t, 'Today  ', { bold: true }), fit(phasesOf(c.timeline.today) || 'no phases', columns - 8)]) : span(t, 'Today  not built', DIM),
    row(t, [c.cost.new ? replay('New', c.deterministic.new) : null, c.cost.today ? replay('Today', c.deterministic.today) : null], { columnGap: 3, flexWrap: 'wrap' }),
    c.cost.new ? span(t, `JavaScript per frame: New ${c.cost.new} ms${c.cost.today ? ` · Today ${c.cost.today} ms` : ''} (a hint, not a frame rate)`, DIM) : null,
    c.report ? span(t, fit(c.report, columns), DIM) : null,
    lab.url ? link(t, `${lab.url}/${c.game}/`, `Open ${name(c.game)} in the lab ↗`) : null,
  ], { marginBottom: 1 }))]);
}

/* ------------------------------------------------------------------ Parts */

export function partsView(t, { parts, checks, columns, now }) {
  if (!parts.length) {
    return col(t, [span(t, 'No parts yet.', { bold: true }), span(t, 'When Claude builds in parallel (the parallel skill: game logic, art, sound, the landing page), each agent shows here with what it is doing.', DIM)]);
  }
  const running = parts.filter((l) => l.status === 'running').length;
  const done = parts.filter((l) => l.status === 'completed').length;
  const secs = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`; };
  return col(t, [
    line(t, [span(t, `${running} running`, { color: running ? 'cyan' : undefined, bold: true }), ` · ${done} done${parts.length - running - done ? ` · ${parts.length - running - done} stopped` : ''}`, running ? span(t, '  · the merge waits for every part', DIM) : null]),
    ...parts.map((l) => {
      const m = l.status === 'running' ? markOf('running') : l.status === 'completed' ? markOf('done') : markOf('failed');
      const elapsed = (l.endedAt ?? now) - (l.startedAt ?? now);
      return col(t, [
        row(t, [span(t, m.mark, { color: m.color }), span(t, fit(l.description || l.type || l.id, Math.max(14, columns - 34)), { bold: true }), span(t, secs(elapsed), DIM), span(t, `${l.tools} tool${l.tools === 1 ? '' : 's'}`, DIM), l.edits ? span(t, `${l.edits} file${l.edits === 1 ? '' : 's'}`, { color: 'green' }) : null]),
        l.last ? span(t, `   ${fit(l.last, columns - 4)}`, DIM) : null,
      ]);
    }),
    checks.length ? line(t, ['feed: ', ...checks.flatMap((c, i) => [i ? '  ' : '', span(t, `${markOf(c.state).mark} ${c.label}`, { color: markOf(c.state).color })])], { wrap: 'truncate-end' }) : null,
  ]);
}

/* ------------------------------------------------------------------ the arcade */

export function arcadeView(t, { surface, a, games, columns, on }) {
  const st = a.status ?? {};
  const playing = a.state === 'playing' || a.state === 'watching';
  const head = row(t, [
    span(t, `◆ ${a.game?.studio ?? 'Homie Arcade'}`, { bold: true, color: ACCENT }),
    a.game ? span(t, fit(a.game.name, 24), { bold: true }) : null,
    st.room ? span(t, `room ${String(st.room).replace(/^pub-/, '')}`, DIM) : null,
    st.seat !== null && st.seat !== undefined ? span(t, `seat ${st.seat + 1}${st.role === 'host' ? ' · host' : ''}`, { color: 'green' }) : a.state === 'watching' ? span(t, 'watching', { color: 'cyan' }) : null,
    st.players !== null && st.players !== undefined ? span(t, `${st.players} ${st.players === 1 ? 'person' : 'people'}${st.bots ? ` + ${st.bots} bots` : ''}${st.ai ? ` · ${st.ai} AI` : ''}`, DIM) : null,
    a.fps ? span(t, `${a.fps} fps`, DIM) : null,
  ]);
  const kids = [head];
  if (a.state === 'idle' || a.state === 'ended') {
    kids.push(span(t, 'Play a real Homie game with strangers while Claude works: a public room on a live studio, rendered here.', DIM));
    if (a.why) kids.push(span(t, fit(a.why, columns * 2), { color: 'yellow' }));
    kids.push(row(t, [
      games.length ? t.Select({ key: 'arcade-game', label: 'Game', value: a.pick ?? games[0].key, options: games.map((g) => ({ value: g.key, label: fit(`${g.name} · ${g.studio}`, 40) })), onSelect: on.pick }) : span(t, 'Looking for games…', DIM),
      games.length ? t.Button({ key: 'arcade-play', label: 'Play', hotkey: 'p', plain: true, autoFocus: true, onPress: on.play }) : null,
    ], { columnGap: 3 }));
    kids.push(span(t, 'One headless Chrome on this computer runs the game for you (lowest priority, paused whenever this pane is hidden).', DIM));
    return col(t, kids);
  }
  if (a.state === 'starting') kids.push(span(t, `Opening ${a.game?.name ?? 'the game'}… (a real browser seat; the first frame takes a few seconds)`, { color: 'cyan' }));
  if (a.pic) kids.push(picture(t, surface, a.pic, { alt: `${a.game?.name ?? 'the game'}, live` }));
  if (playing || a.state === 'starting') {
    if (a.state !== 'watching') {
      kids.push(t.Client({ key: 'pad', module: './arcade-pad.mjs', props: { focused: Boolean(a.padFocused), hint: a.game?.hint ?? '' }, width: Math.max(20, Math.min(columns, 70)), height: 1 }));
      kids.push(row(t, [
        t.Button({ key: 'k-w', label: '↑', hotkey: 'w', plain: true, onPress: () => on.key('up') }),
        t.Button({ key: 'k-a', label: '←', hotkey: 'a', plain: true, onPress: () => on.key('left') }),
        t.Button({ key: 'k-s', label: '↓', hotkey: 's', plain: true, onPress: () => on.key('down') }),
        t.Button({ key: 'k-d', label: '→', hotkey: 'd', plain: true, onPress: () => on.key('right') }),
        t.Button({ key: 'k-e', label: 'action', hotkey: 'e', plain: true, onPress: () => on.key('space') }),
        t.Button({ key: 'arcade-leave', label: 'Leave', hotkey: 'x', plain: true, onPress: on.leave }),
      ], { columnGap: 2 }));
    } else {
      kids.push(row(t, [t.Button({ key: 'arcade-leave', label: 'Stop watching', hotkey: 'x', plain: true, onPress: on.leave })]));
    }
  }
  if (a.why) kids.push(span(t, fit(a.why, columns * 2), { color: 'yellow' }));
  return col(t, kids);
}

/* ------------------------------------------------------------------ guards, above Claude Code's question dialog */

/**
 * A held call's panel, drawn above Claude Code's question dialog. That site takes at most 12 rows around the dialog,
 * and Claude Code counts a row as about 38 cells whatever the terminal's width, so the panel is short and narrow: a
 * title, a few facts and the first lines of the diff, each cut at 34 cells. Everything else is in the Hold pane.
 */
export const GUARD_ROWS = 11;
export const GUARD_WIDTH = 34;
export function guardPanel(t, g, { maxRows = GUARD_ROWS, width = GUARD_WIDTH } = {}) {
  const one = { wrap: 'truncate-end' };
  let room = maxRows - 2 - 1;
  const kids = [span(t, fit(`⚠ ${g.title}`, width), { bold: true, color: 'yellow', ...one })];
  for (const l of (g.lines ?? []).slice(0, Math.max(0, room - (g.diff?.source ? 3 : 0)))) {
    const k = `${l.k} `;
    kids.push(line(t, [span(t, k, DIM), span(t, fit(l.v, Math.max(6, width - k.length)), l.style ?? {})], one));
    room--;
  }
  if (g.diff?.source && room >= (g.diff.rows ?? 3)) {
    // The diff here was cut to fit by the hooks module (complete hunks, short lines); its "@@" line is a row too.
    kids.push(t.Code({ format: 'diff', source: g.diff.source, wrap: 'truncate-end' }));
    room -= g.diff.rows ?? 0;
  }
  if (g.more && room >= 1) { kids.push(span(t, fit(g.more, width), { ...DIM, ...one })); room--; }
  return t.Box({ flexDirection: 'column', borderStyle: 'round', borderColor: 'yellow', paddingX: 1, children: kids });
}

/** The whole held change, in the Hold pane: every fact in full, and the whole diff. */
export function holdPane(t, g) {
  if (!g) return span(t, 'Nothing is held.', DIM);
  const d = g.detail ?? {};
  return col(t, [
    span(t, `⚠ ${g.title}`, { bold: true, color: 'yellow' }),
    ...(d.lines ?? []).map((l) => (typeof l === 'string' ? span(t, l) : line(t, [span(t, `${l.k}  `, DIM), span(t, l.v, l.style ?? {})]))),
    d.full?.source ? t.Code({ format: 'diff', source: d.full.source }) : null,
    d.full && d.full.total > d.full.shown ? span(t, `… ${d.full.total - d.full.shown} more lines`, DIM) : null,
    span(t, 'Answer in the dialog under the prompt: Proceed or Cancel.', DIM),
  ]);
}

/* ------------------------------------------------------------------ Homie's tool results, drawn natively */

const HEAD = (t, text, ok) => span(t, `${ok === false ? '✗' : ok === true ? '✓' : '◆'} ${text}`, { bold: true, color: ok === false ? 'red' : ok === true ? 'green' : ACCENT });

export function setupCard(t, d, columns) {
  const markStyle = { ok: ['✓', 'green'], act: ['→', 'yellow'], missing: ['✗', 'red'], optional: ['○', undefined], later: ['…', undefined], unknown: ['?', undefined] };
  return col(t, [
    HEAD(t, d.title),
    ...d.rows.map((r) => {
      const [m, c] = markStyle[r.state] ?? ['?', undefined];
      return col(t, [
        line(t, [span(t, ` ${m} `, { ...(c ? { color: c } : DIM) }), span(t, r.label, { bold: r.state === 'act' || r.state === 'missing' }), r.need !== 'required' ? span(t, ` (${r.need})`, DIM) : null, span(t, `  ${fit(r.detail, Math.max(10, columns - r.label.length - 18))}`, DIM)], { wrap: 'truncate-end' }),
        r.fix && r.state !== 'ok' ? span(t, `     → ${fit(r.fix, columns - 7)}`, { color: 'yellow', wrap: 'truncate-end' }) : null,
      ]);
    }),
    d.ready.length ? t.Box({ flexDirection: 'row', columnGap: 2, flexWrap: 'wrap', children: [span(t, 'Ready:', DIM), ...d.ready.map((f) => span(t, `${f.state === 'ready' ? '✓' : f.state === 'later' ? '…' : '○'} ${f.feature}`, f.state === 'ready' ? { color: 'green' } : DIM))] }) : null,
    d.next.length ? col(t, [span(t, 'Do this now:', { bold: true }), ...d.next.slice(0, 4).map((n) => span(t, `  → ${fit(n, columns * 2)}`, { color: 'yellow' }))]) : null,
  ]);
}

export function checksCard(t, d, columns) {
  return col(t, [
    HEAD(t, d.summary, d.ok),
    ...checkRows(t, d.rows, columns),
    ...(d.weak ?? []).slice(0, 4).map((w) => span(t, `  weakest: ${fit(w, columns - 12)}`, { color: 'yellow' })),
    d.report ? span(t, `report: ${d.report}`, DIM) : d.receipt ? span(t, `receipt: ${d.receipt}`, DIM) : null,
  ]);
}

export function deployCard(t, d, columns) {
  return col(t, [
    line(t, [span(t, '✓ Live at ', { bold: true, color: 'green' }), link(t, d.url)]),
    d.also ? line(t, ['  also at ', link(t, d.also)], DIM) : null,
    ...d.games.map((g) => line(t, [span(t, `  ▶ ${g.id}  `), link(t, g.play, fit(g.play, columns - g.id.length - 8))])),
    ...d.media.map((m) => line(t, [span(t, `  ♪ ${m.kind} ${m.slug}  `), link(t, m.page)])),
    d.cloudflare ? span(t, `  ${fit(d.cloudflare, columns * 2)}`, DIM) : null,
    d.claim ? span(t, '  claimed in the homie.rocks directory', DIM) : null,
  ]);
}

export function buildCard(t, b, columns) {
  if (!b) return null;
  const bars = bar(b.percent, 12);
  return col(t, [
    line(t, [HEAD(t, b.title, b.state === 'passed' ? true : b.state === 'failed' ? false : undefined), '  ', span(t, bars.done, { color: 'green' }), span(t, bars.left, DIM), ` ${b.percent}%`]),
    stagesRow(t, b.stages),
    ...checkRows(t, b.checks.slice(-8), columns),
    b.preview ? line(t, ['  ', link(t, linkable(b.preview), '▶ Play')]) : null,
  ]);
}

export function studioCard(t, d, columns) {
  return col(t, [
    HEAD(t, `${d.name}${d.tagline ? ` · ${d.tagline}` : ''}`),
    ...(d.games ?? []).map((g) => line(t, [span(t, `  ${g.live ? '●' : '○'} ${fit(g.name, 24)}  `, g.live ? { color: 'green' } : {}), g.play?.live ? link(t, g.play.live, '▶ Play') : g.play?.dev ? link(t, linkable(g.play.dev), '▶ Play here') : span(t, 'not deployed yet', DIM)])),
    d.site ? line(t, ['  live: ', link(t, d.site)], DIM) : span(t, '  not online yet', DIM),
    ...(d.rooms ?? []).slice(0, 4).map((r) => span(t, `  room ${r.room} of ${r.game}: ${r.players} playing`, { color: 'green' })),
  ]);
}

/** The ToolUse row of a Homie command: what it is in words, and the command itself, dim, so nothing is hidden. */
export function toolUseRow(t, { label, command, state }) {
  const m = state === 'running' ? ['◌', 'cyan'] : state === 'error' ? ['✗', 'red'] : ['⏺', ACCENT];
  return line(t, [span(t, `${m[0]} `, { color: m[1] }), span(t, 'Homie', { bold: true, color: ACCENT }), span(t, ` · ${label}  `, { bold: true }), span(t, command, DIM)], { wrap: 'truncate-end' });
}
