/**
 * THE GAME CODEX: one game's plan, as a page in the game's own look that anyone can read and steer, coder or not.
 *
 *   games/<id>/CODEX.md                 the source of truth, in the studio's repository (plain Markdown)
 *   .studio/codex/<id>.html             the page on this computer (git-ignored); it redraws itself whenever the
 *                                       build's progress feed changes, and refreshes in the browser while it runs
 *   site/dist/_studio/codex/<id>/       the same page on the studio's site, for its owner only (the stats sign-in;
 *                                       `homie-studio codex link <id>`), never listed, never indexed
 *   `codex <id> --artifact`             a copy made to be published as a Claude artifact (one self-contained file)
 *
 * CODEX.md is ordinary Markdown with a small frontmatter for the look, and a few conventions that turn into cards:
 *
 *   ---
 *   eyebrow: The Ashen Reach            a small label over the title
 *   tagline: Outrun the fire.           one line under it
 *   cover: hero/wide.jpg                a picture from the game's folder, behind the title
 *   palette: { bg, panel, ink, accent, accent2, danger, good }   colours (#hex); missing ones come from the
 *                                       game's landing theme, then site/theme.json
 *   fonts: { display, body, mono }      a Google Fonts family name, or a font file in the game's folder
 *   pixel: true                         pictures keep hard pixel edges when scaled (pixel art)
 *   try: Arrows to run, Space to dash.  how to play it, for the build status "Ready to try" box
 *   ---
 *   # Game Name                          the title (else game.json's name); the paragraph after it is the pitch
 *   ## Section                           one tab each: Latest, Concept, World, Characters, Art direction, Controls,
 *                                        Rooms and players, Music and sound, Milestones, Open questions, or any other
 *   ### Name                             a card: its first picture is the card's art; a line of `code` chips is its
 *                                        id (`M-01`) and tags (`danger: Aggressive`, `good: Passive`, `gold: Rare`);
 *                                        an italic line is its subtitle; a list of `**Key:** value` is its stats
 *   | a | table |                        a table (controls per device: Phone, Computer, TV)
 *   - [x] done / - [ ] not yet           a checklist (milestones)
 *   - 2026-10-01: a decision             under Latest: the decision log, newest first
 *
 * Text is escaped (lib/markdown.mjs): a codex can never run a script. Pictures and fonts come only from inside the
 * studio's folder and are embedded in the page, so it is one file that works anywhere (a browser, an artifact, the
 * site) and never loads anything but Google Fonts.
 */
import { createHash } from 'node:crypto';
import { CODEX_SCRIPT } from '../worker/codex-script.mjs';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { latestFeedFor, summarize } from './feed-summary.mjs';
import { escapeHtml as esc, renderMarkdown } from './markdown.mjs';
import { readTheme } from './site.mjs';
import { GAME_ID, listGames, readStudio } from './studio.mjs';

export const CODEX_FILE = 'CODEX.md';
export const CODEX_DIR = join('.studio', 'codex');
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const FONT_TYPES = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
const LIMITS = Object.freeze({ image: 2.5 * 1024 * 1024, images: 10 * 1024 * 1024, font: 1024 * 1024, source: 512 * 1024 });
const COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\([0-9.,%\s/-]{3,60}\))$/;
const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$/;

/**
 * The sections a full plan has (the `plan` skill's interview fills them). A section counts under any of these
 * headings; `missing` lists the ones a codex does not have yet.
 */
export const SECTIONS = [
  { key: 'concept', title: 'Concept', match: /^(concept|the game|pitch|overview|core loop)\b/i },
  { key: 'world', title: 'World', match: /^(world|setting|story|lore|zones?|maps?|levels?)\b/i },
  { key: 'characters', title: 'Characters', match: /^(characters|cast|heroes|classes|creatures|monsters|enemies|units|pieces)\b/i },
  { key: 'art', title: 'Art direction', match: /^(art|look|style|visual)/i },
  { key: 'controls', title: 'Controls', match: /^(controls|devices|input)\b/i },
  { key: 'rooms', title: 'Rooms and players', match: /^(rooms|players|multiplayer|netplay)\b/i },
  { key: 'sound', title: 'Music and sound', match: /^(music|sound|audio)\b/i },
  { key: 'milestones', title: 'Milestones', match: /^(milestones?|plan|roadmap|scope|steps)\b/i },
  { key: 'questions', title: 'Open questions', match: /^(open questions|questions|undecided|to decide)\b/i },
];

/* ------------------------------------------------------------------ parsing */

/** A small YAML subset: `key: value`, quoted or bare, and one level of nested `key:` blocks or `{ a: b, c: d }`. */
export function parseFrontmatter(text) {
  const meta = {};
  let parent = null;
  const value = (raw) => {
    const t = String(raw).trim();
    const dq = /^"((?:[^"\\]|\\.)*)"/.exec(t);
    if (dq) { try { return JSON.parse(`"${dq[1]}"`); } catch { return dq[1]; } }
    const sq = /^'([^']*)'/.exec(t);
    if (sq) return sq[1];
    const v = t.replace(/\s+#.*$/, '').trim();
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  };
  for (const line of String(text).split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const nested = /^\s{2,}([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (nested && parent) { meta[parent][nested[1]] = value(nested[2]); continue; }
    const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!top) continue;
    const [, key, raw] = top;
    const inline = /^\{(.*)\}\s*$/.exec(raw.trim());
    if (inline) {
      meta[key] = {};
      for (const pair of inline[1].split(',')) { const m = /^\s*([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/.exec(pair); if (m) meta[key][m[1]] = value(m[2]); }
      parent = null;
    } else if (!raw.trim()) { meta[key] = {}; parent = key; }
    else { meta[key] = value(raw); parent = null; }
  }
  return meta;
}

/** CODEX.md as { meta, title, pitch (Markdown), sections: [{ title, id, body (lines) }] }. HTML comments are notes for the AI and are dropped. */
export function parseCodex(source) {
  let text = String(source ?? '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  let meta = {};
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) { meta = parseFrontmatter(fm[1]); text = text.slice(fm[0].length); }
  const lines = text.split('\n');
  let title = null;
  const pitch = [];
  const sections = [];
  let fence = false;
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    const h1 = !fence && /^#\s+(.+?)\s*#*\s*$/.exec(line);
    const h2 = !fence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h1 && title === null && !sections.length) { title = h1[1]; continue; }
    if (h2) { sections.push({ title: h2[1].trim(), body: [] }); continue; }
    if (sections.length) sections[sections.length - 1].body.push(line);
    else pitch.push(line);
  }
  const seen = new Set();
  for (const s of sections) {
    let id = s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    s.id = id;
    s.key = SECTIONS.find((k) => k.match.test(s.title))?.key ?? (/^latest|^decisions|^changelog|^news/i.test(s.title) ? 'latest' : null);
  }
  return { meta, title, pitch: pitch.join('\n').trim(), sections };
}

/** What a codex still lacks, for the AI's next questions: sections not there, or there with nothing in them. */
export function codexGaps(parsed) {
  const has = (key) => parsed.sections.some((s) => s.key === key && s.body.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim());
  const questions = parsed.sections.filter((s) => s.key === 'questions').flatMap((s) => s.body.filter((l) => /^\s*([-*+]|\d+[.)])\s+\S/.test(l)));
  return { missing: SECTIONS.filter((s) => s.key !== 'questions' && !has(s.key)).map((s) => s.title), openQuestions: questions.length };
}

/* ------------------------------------------------------------------ files from the studio */

/** A file a codex names, if it is inside the studio (the game's folder first, then the studio's root). */
function studioFile(root, gameDir, rel) {
  const clean = String(rel ?? '').trim();
  if (!clean || /^[a-z]+:/i.test(clean) || clean.includes('\0')) return null;
  let realRoot;
  try { realRoot = realpathSync(root); } catch { return null; }
  for (const base of [gameDir, root]) {
    const abs = resolve(base, clean.replace(/^\/+/, ''));
    if (!existsSync(abs)) continue;
    let real;
    try { real = realpathSync(abs); } catch { continue; }
    if ((real === realRoot || real.startsWith(realRoot + sep)) && statSync(real).isFile()) return real;
  }
  return null;
}

class Embedder {
  constructor(root, gameDir) { this.root = root; this.gameDir = gameDir; this.used = 0; this.cache = new Map(); this.warnings = []; }
  /** A picture as a data: URL, or null (with a warning) when it is missing, not a picture, or too big. */
  image(rel) {
    if (this.cache.has(rel)) return this.cache.get(rel);
    const file = studioFile(this.root, this.gameDir, rel);
    const type = IMAGE_TYPES[extname(String(rel)).toLowerCase()];
    let out = null;
    if (!file || !type) this.warnings.push(`picture ${rel}: ${!type ? 'not a .png, .jpg, .webp, .gif or .svg' : 'not found inside the studio'}`);
    else {
      const size = statSync(file).size;
      if (size > LIMITS.image) this.warnings.push(`picture ${rel}: ${Math.round(size / 1024)} KB is over ${Math.round(LIMITS.image / 1024)} KB; use a smaller copy`);
      else if (this.used + size > LIMITS.images) this.warnings.push(`picture ${rel}: the page already holds ${Math.round(LIMITS.images / 1024 / 1024)} MB of pictures`);
      else { this.used += size; out = `data:${type};base64,${readFileSync(file).toString('base64')}`; }
    }
    this.cache.set(rel, out);
    return out;
  }
  font(rel) {
    const file = studioFile(this.root, this.gameDir, rel);
    const type = FONT_TYPES[extname(String(rel)).toLowerCase()];
    if (!file || !type) { this.warnings.push(`font ${rel}: not a font file inside the studio`); return null; }
    if (statSync(file).size > LIMITS.font) { this.warnings.push(`font ${rel}: over ${LIMITS.font / 1024} KB`); return null; }
    return `data:${type};base64,${readFileSync(file).toString('base64')}`;
  }
}

/* ------------------------------------------------------------------ blocks */

const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/;
const CHIP_LINE = /^\s*(`[^`\n]+`[\s·,]*)+$/;
const TASK = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const STAT = /^\s*[-*+]\s+(?:\*\*([^*:]{1,32}):?\*\*:?|([A-Z][A-Za-z0-9 /'&-]{0,31}):)\s+(.+)$/;
const DATED = /^\s*[-*+]\s+(\d{4}-\d{2}-\d{2})\s*(?:[-–—:·]\s*)?(.+)$/;
const TONES = { good: /passive|friendly|ally|player|safe|heal|support|calm/i, danger: /aggress|hostile|boss|danger|enemy|deadly|hazard|trap|attack/i, gold: /rare|elite|legend|epic|unique|treasure|gold|boss/i };

function chip(raw) {
  const m = /^(good|danger|gold|info|dim):\s*(.+)$/i.exec(raw.trim());
  const text = m ? m[2] : raw.trim();
  const tone = m ? m[1].toLowerCase() : /^[A-Z]{1,4}-?\d{1,4}$/.test(text) ? 'id' : TONES.danger.test(text) ? 'danger' : TONES.gold.test(text) ? 'gold' : TONES.good.test(text) ? 'good' : 'plain';
  return `<span class="chip ${tone}">${esc(text)}</span>`;
}
const chipsOf = (line) => [...line.matchAll(/`([^`\n]+)`/g)].map((m) => chip(m[1])).join('');

function table(lines) {
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const head = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  const inline = (t) => renderMarkdown(t).html.replace(/^<p>|<\/p>$/g, '');
  return `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, i) => `<td>${inline(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function figure(emb, alt, src, caption, cls = '') {
  const data = emb.image(src);
  if (!data) return `<figure class="missing ${cls}"><span>${esc(alt || src)}</span></figure>`;
  return `<figure class="${cls}"><img src="${data}" alt="${esc(alt)}" loading="lazy" decoding="async">${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
}

/**
 * A run of lines into HTML: tables, checklists, picture runs (a gallery), dated decisions and stats lists are drawn
 * here; everything else goes through the posts' safe Markdown.
 */
function blocks(lines, emb, { dated = false } = {}) {
  const out = [];
  let prose = [];
  const flush = () => { const t = prose.join('\n').trim(); if (t) out.push(renderMarkdown(t).html); prose = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      flush();
      const t = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) t.push(lines[i]);
      i -= 1;
      out.push(table(t));
      continue;
    }
    if (TASK.test(line)) {
      flush();
      const items = [];
      for (; i < lines.length && TASK.test(lines[i]); i++) { const m = TASK.exec(lines[i]); items.push({ done: m[1] !== ' ', text: m[2] }); }
      i -= 1;
      out.push(`<ul class="checklist">${items.map((t) => `<li class="${t.done ? 'done' : ''}"><span class="tick">${t.done ? '✓' : ''}</span><span>${renderMarkdown(t.text).html.replace(/^<p>|<\/p>$/g, '')}</span></li>`).join('')}</ul>`);
      continue;
    }
    if (dated && DATED.test(line)) {
      flush();
      const items = [];
      for (; i < lines.length && (DATED.test(lines[i]) || /^\s{2,}\S/.test(lines[i])); i++) {
        const m = DATED.exec(lines[i]);
        if (m) items.push({ day: m[1], text: m[2] }); else if (items.length) items[items.length - 1].text += ` ${lines[i].trim()}`;
      }
      i -= 1;
      items.sort((a, b) => b.day.localeCompare(a.day));
      out.push(`<ol class="timeline">${items.map((t) => `<li><time>${esc(t.day)}</time><span>${renderMarkdown(t.text).html.replace(/^<p>|<\/p>$/g, '')}</span></li>`).join('')}</ol>`);
      continue;
    }
    if (IMAGE_LINE.test(line)) {
      flush();
      const pics = [];
      for (; i < lines.length && (IMAGE_LINE.test(lines[i]) || (!lines[i].trim() && IMAGE_LINE.test(lines[i + 1] ?? ''))); i++) {
        const m = IMAGE_LINE.exec(lines[i]);
        if (m) pics.push(m);
      }
      i -= 1;
      out.push(`<div class="${pics.length > 1 ? 'gallery' : 'single'}">${pics.map((m) => figure(emb, m[1], m[2], m[3] ?? (pics.length > 1 ? m[1] : ''))).join('')}</div>`);
      continue;
    }
    prose.push(line);
  }
  flush();
  return out.join('\n');
}

/** A `### Name` subsection as a card. */
function card(title, lines, emb, { pixel }) {
  let art = null;
  let chips = '';
  let subtitle = '';
  const stats = [];
  const rest = [];
  for (const line of lines) {
    const img = IMAGE_LINE.exec(line);
    if (img && !art) { art = img; continue; }
    if (!chips && CHIP_LINE.test(line)) { chips = chipsOf(line); continue; }
    if (!subtitle && /^\s*([*_])[^*_].*\1\s*$/.test(line) && !/^\s*[-*+]\s/.test(line)) { subtitle = line.trim().slice(1, -1); continue; }
    const st = STAT.exec(line);
    if (st) { stats.push([st[1] ?? st[2], st[3]]); continue; }
    rest.push(line);
  }
  const idChip = /<span class="chip id">[^<]*<\/span>/.exec(chips)?.[0] ?? '';
  const tags = chips.replace(idChip, '');
  const inline = (t) => renderMarkdown(t).html.replace(/^<p>|<\/p>$/g, '');
  const pic = art ? emb.image(art[2]) : null;
  // No picture yet: the card's initial, in the game's display font, holds its place (never a made-up picture).
  const initial = [...String(title).trim()][0]?.toUpperCase() ?? '';
  return `<article class="card${art ? ' has-art' : ''}">
<header>${art ? `<div class="art${pixel ? ' pixel' : ''}">${pic ? `<img src="${pic}" alt="${esc(art[1])}" loading="lazy" decoding="async">` : `<span>${esc(art[1] || '')}</span>`}</div>` : `<div class="art mono" aria-hidden="true"><span>${esc(initial)}</span></div>`}<div class="who"><div class="name"><h3>${esc(title)}</h3>${idChip}</div>${subtitle ? `<p class="meta">${inline(subtitle)}</p>` : ''}${tags ? `<p class="tags">${tags}</p>` : ''}</div></header>
${blocks(rest, emb)}
${stats.length ? `<dl class="stats">${stats.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${inline(v)}</dd>`).join('')}</dl>` : ''}
</article>`;
}

function sectionHtml(section, emb, ctx) {
  const intro = [];
  const cards = [];
  let current = null;
  let fence = false;
  for (const line of section.body) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    const h3 = !fence && /^###\s+(.+?)\s*#*\s*$/.exec(line);
    if (h3) { current = { title: h3[1], lines: [] }; cards.push(current); continue; }
    (current ? current.lines : intro).push(line);
  }
  const questions = section.key === 'questions';
  let body = blocks(intro, emb, { dated: section.key === 'latest' });
  if (questions) body = body.replace(/^<(ul|ol)>/, '<ol class="questions">').replace(/<\/(ul|ol)>$/, '</ol>');
  const empty = !body && !cards.length;
  return `<section class="tab" id="${esc(section.id)}" data-key="${esc(section.key ?? '')}">
<p class="eyebrow">${esc(ctx.eyebrow)}</p>
<h2>${esc(section.title)}</h2>
${body ? `<div class="prose">${body}</div>` : ''}${empty ? '<p class="empty">Not decided yet. Your AI asks about it in the plan, or tell it what you want here.</p>' : ''}
${cards.length ? `<div class="cards">${cards.map((c) => card(c.title, c.lines, emb, ctx)).join('\n')}</div>` : ''}
</section>`;
}

/* ------------------------------------------------------------------ the build status tab */

const STATE_MARK = { done: '✓', pass: '✓', skipped: '–', skip: '–', running: '◌', failed: '✗', fail: '✗', stopped: '■', pending: '' };

function statusHtml(s, ctx) {
  const ago = (iso) => esc(iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '');
  const intro = ctx.mode === 'site'
    ? 'As of the site\'s last deploy. Your AI updates the codex as the work moves along.'
    : ctx.mode === 'file' ? 'Updated by your AI as the work moves along. Leave this open; it refreshes by itself while a build runs.'
      : 'Updated by your AI as the work moves along.';
  if (!s) {
    return `<section class="tab status" id="build-status" data-key="status"><p class="eyebrow">${esc(ctx.eyebrow)}</p><h2>Build status</h2><p class="sub">${esc(intro)}</p>
<div class="panel"><p class="summary">No build has run for this game yet. When one runs, its steps, its checks going green, a picture of the game and what it spent show here.</p></div></section>`;
  }
  const summary = s.state === 'passed' ? `Done${s.preview ? `: ${s.preview}` : ''}.`
    : s.state === 'failed' ? `Stopped by a problem${s.stage ? ` in ${s.stage.label}` : ''}: ${s.error ?? s.last}`
      : s.state === 'stopped' ? 'Stopped, as asked.'
        : `${s.stage ? `${s.stage.label}${s.stage.note ? `: ${s.stage.note}` : (() => { const own = s.stages.find((x) => x.id === s.stage.id)?.checks ?? []; return own.length ? `: ${own.filter((c) => c.state === 'pass' || c.state === 'skip').length} of ${own.length} passed so far` : ''; })()}` : 'Starting'}${s.stopping ? ' (stopping at the next safe point)' : ''}`;
  const segs = s.stages.map((st) => {
    const own = st.checks;
    const fill = st.state === 'done' || st.state === 'skipped' ? 100 : st.state === 'running' ? (own.length ? Math.round(100 * own.filter((c) => c.state === 'pass' || c.state === 'skip').length / own.length) : 35) : 0;
    return `<span class="seg ${esc(st.state)}" title="${esc(st.label)}: ${esc(st.state)}"><i style="width:${fill}%"></i></span>`;
  }).join('');
  const steps = s.stages.map((st) => `<li class="${esc(st.state)}"><span class="tick">${STATE_MARK[st.state] ?? ''}</span><span><b>${esc(st.label)}</b>${st.note ? ` <em>${esc(st.note)}</em>` : ''}${st.checks.length ? `<ul>${st.checks.map((c) => `<li class="${esc(c.state)}"><span class="tick">${STATE_MARK[c.state] ?? ''}</span><span>${esc(c.label)}${c.note ? ` <em>${esc(c.note)}</em>` : ''}</span></li>`).join('')}</ul>` : ''}</span></li>`).join('');
  // Only a web address is a link (a feed is written by commands, but a page never links to anything else).
  if (s.preview && !/^https?:\/\//i.test(s.preview)) s = { ...s, preview: null };
  const local = s.preview && /^http:\/\/(127\.0\.0\.1|localhost)/.test(s.preview);
  const tryBox = s.preview ? `<div class="try"><p class="eyebrow">Ready to try</p><p>Open <a href="${esc(s.preview)}">${esc(s.preview)}</a>${local ? ' on this computer (the studio\'s dev site must be running)' : ''}. ${esc(ctx.try || 'Open it in a second tab, or on a phone, to see two players in the same room.')}</p></div>` : '';
  return `<section class="tab status" id="build-status" data-key="status" data-running="${s.state === 'running' ? '1' : '0'}">
<p class="eyebrow">${esc(ctx.eyebrow)}</p><h2>Build status</h2><p class="sub">${esc(intro)}</p>
<div class="panel big"><div class="pct">${s.percent}%</div><p class="upd"><span class="dot ${esc(s.state)}"></span><span data-ago="${esc(s.updatedAt ?? '')}">Updated ${ago(s.updatedAt)}</span> · ${esc(s.title)}</p>
<div class="segbar">${segs}</div><p class="summary">${esc(summary)}</p>${s.spend.text ? `<p class="spend">Spent ${esc(s.spend.text)}</p>` : ''}</div>
${tryBox}
<div class="panel"><h3>Steps</h3><ul class="steps">${steps}</ul></div>
${s.previewImage && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s.previewImage) ? `<figure class="shot"><img src="${s.previewImage}" alt="${esc(s.previewCaption || 'The game, as the last check saw it')}">${s.previewCaption ? `<figcaption>${esc(s.previewCaption)}</figcaption>` : ''}</figure>` : ''}
</section>`;
}

/* ------------------------------------------------------------------ the page */

/** The one script the page has (worker/codex-script.mjs); the site's CSP allows it by its hash. */
export { CODEX_SCRIPT };
export const CODEX_SCRIPT_HASH = `sha256-${createHash('sha256').update(CODEX_SCRIPT).digest('base64')}`;

function css(p, f, pixel) {
  return `:root{color-scheme:${p.scheme};--bg:${p.bg};--ink:${p.ink};--accent:${p.accent};--accent2:${p.accent2};--danger:${p.danger};--good:${p.good};--gold:${p.gold};
--panel:${p.panel ?? 'color-mix(in srgb, var(--bg) 90%, var(--ink))'};--line:color-mix(in srgb, var(--ink) 14%, transparent);--dim:color-mix(in srgb, var(--ink) 62%, var(--bg));
--display:${f.display};--body:${f.body};--mono:${f.mono}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--body)}
a{color:var(--accent2)}img{max-width:100%}
.hero{position:relative;padding:56px 0 28px;border-bottom:1px solid var(--line);overflow:hidden}
.hero .bgimg{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.32;${pixel ? 'image-rendering:pixelated;' : ''}}
.hero .bgimg:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 30%,transparent),var(--bg))}
.wrap{position:relative;max-width:1080px;margin:0 auto;padding:0 16px}
.kicker,.eyebrow{margin:0 0 6px;color:var(--accent2);font:600 12px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase}
h1{margin:0;font:400 clamp(28px,6vw,52px)/1.15 var(--display);color:var(--accent);letter-spacing:.01em;overflow-wrap:anywhere}
.tagline{margin:10px 0 0;font-size:18px;color:var(--ink)}.pitch{max-width:72ch;color:var(--dim)}
nav.tabs{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
nav.tabs .wrap{display:flex;gap:2px;overflow-x:auto;padding:0 6px;scrollbar-width:none}nav.tabs .wrap::-webkit-scrollbar{display:none}
nav.tabs a{flex:none;padding:12px 10px;color:var(--dim);text-decoration:none;font:600 14px/1 var(--body);border-bottom:2px solid transparent;white-space:nowrap}
nav.tabs a.on,nav.tabs a:hover{color:var(--ink);border-bottom-color:var(--accent)}
nav.tabs a.status{color:var(--accent2)}
main{max-width:1080px;margin:0 auto;padding:28px 16px 64px}
.tab{padding:8px 0 36px;scroll-margin-top:56px}.js .tab{display:none}.js .tab.on{display:block}
h2{margin:0 0 14px;font:400 clamp(24px,4.5vw,36px)/1.2 var(--display);color:var(--accent)}
h3{margin:0;font:400 18px/1.3 var(--display);color:var(--ink)}
.prose>p,.prose>ul,.prose>ol,.prose>blockquote,.prose>h2,.prose>h3,.prose>h4{max-width:76ch}.prose h2,.prose h3,.prose h4{font-family:var(--body);color:var(--ink)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr));gap:14px;margin-top:18px}
.card,.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.card header{display:flex;gap:14px;align-items:flex-start;margin-bottom:8px}
.card .art{flex:none;width:96px;height:96px;border-radius:10px;background:color-mix(in srgb,var(--bg) 70%,var(--panel));border:1px solid var(--line);display:grid;place-items:center;overflow:hidden}
.card .art img{width:100%;height:100%;object-fit:contain}.card .art.mono{background:radial-gradient(circle at 30% 25%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 70%),color-mix(in srgb,var(--bg) 70%,var(--panel))}.card .art.mono span{font:400 40px/1 var(--display);color:var(--accent)}.pixel img{image-rendering:pixelated}body.pixel figure img{background:color-mix(in srgb,var(--bg) 70%,var(--panel))}
.card .who{min-width:0}.card .name{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}.card .meta{margin:4px 0 0;color:var(--dim);font-size:14px}.card .tags{margin:8px 0 0;display:flex;flex-wrap:wrap;gap:6px}
.card p{margin:8px 0}
.chip{display:inline-block;padding:2px 8px;border-radius:999px;font:600 12px/1.6 var(--mono);border:1px solid var(--line);color:var(--dim)}
.chip.id{color:var(--ink);background:color-mix(in srgb,var(--ink) 8%,transparent)}
.chip.good{color:var(--good);border-color:color-mix(in srgb,var(--good) 45%,transparent);background:color-mix(in srgb,var(--good) 12%,transparent)}
.chip.danger{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 45%,transparent);background:color-mix(in srgb,var(--danger) 12%,transparent)}
.chip.gold{color:var(--gold);border-color:color-mix(in srgb,var(--gold) 45%,transparent);background:color-mix(in srgb,var(--gold) 12%,transparent)}
.chip.info{color:var(--accent2);border-color:color-mix(in srgb,var(--accent2) 45%,transparent)}
dl.stats{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:10px 0 0;font:13px/1.5 var(--mono)}dl.stats dt{color:var(--dim)}dl.stats dd{margin:0}
.scroll{overflow-x:auto;margin:14px 0;background:var(--panel);border:1px solid var(--line);border-radius:14px}table{border-collapse:collapse;min-width:100%;font-size:15px}tr:last-child td{border-bottom:0}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{font:600 12px/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--accent2)}
ul.checklist,ul.steps,ul.steps ul,ol.timeline{list-style:none;padding:0;margin:12px 0}
ul.checklist li,ul.steps li{display:flex;gap:10px;align-items:baseline;padding:6px 0}
.tick{flex:none;display:inline-grid;place-items:center;width:20px;height:20px;border-radius:6px;border:1px solid var(--line);font:700 13px/1 var(--mono);color:var(--good)}
li.done>.tick,li.pass>.tick{background:color-mix(in srgb,var(--good) 18%,transparent);border-color:color-mix(in srgb,var(--good) 50%,transparent)}
li.failed>.tick,li.fail>.tick{color:var(--danger);border-color:var(--danger)}li.running>.tick{color:var(--accent2)}
ul.steps ul{margin:4px 0 0}ul.steps em{color:var(--dim);font-style:normal}
ol.timeline li{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}ol.timeline time{font:600 13px/1.6 var(--mono);color:var(--accent2)}
ol.questions{counter-reset:q;list-style:none;padding:0;display:grid;gap:10px}ol.questions li{counter-increment:q;background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:12px;padding:12px 14px 12px 48px;position:relative}
ol.questions li:before{content:"?" counter(q);position:absolute;left:14px;top:12px;font:700 13px/1.6 var(--mono);color:var(--gold)}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:12px;margin:14px 0}
figure{margin:14px 0}figure img{display:block;width:100%;border-radius:12px;border:1px solid var(--line)}figcaption{margin-top:6px;color:var(--dim);font-size:14px}
figure.missing{display:grid;place-items:center;min-height:120px;border:1px dashed var(--line);border-radius:12px;color:var(--dim);font-size:14px}
blockquote{margin:14px 0;padding:10px 16px;border-left:3px solid var(--accent2);background:var(--panel);border-radius:0 12px 12px 0}
code{font-family:var(--mono);font-size:.92em}pre{overflow-x:auto;background:var(--panel);padding:12px;border-radius:12px}
.sub{color:var(--dim);margin:-6px 0 18px}.empty{color:var(--dim);font-style:italic}
.panel.big .pct{font:400 clamp(44px,10vw,72px)/1 var(--display);color:var(--accent)}
.upd{display:flex;align-items:center;gap:8px;color:var(--dim);font-size:14px;margin:10px 0}
.dot{width:9px;height:9px;border-radius:50%;background:var(--accent2)}.dot.running{animation:pulse 1.4s infinite}.dot.failed{background:var(--danger)}.dot.passed{background:var(--good)}.dot.stopped{background:var(--gold)}
@keyframes pulse{50%{opacity:.35}}@media (prefers-reduced-motion:reduce){.dot.running{animation:none}}
.segbar{display:flex;gap:6px;margin:14px 0}.seg{flex:1;height:12px;border-radius:4px;background:color-mix(in srgb,var(--ink) 10%,transparent);overflow:hidden}.seg i{display:block;height:100%;background:var(--good)}.seg.failed i{background:var(--danger);width:100%!important}.seg.skipped i{background:color-mix(in srgb,var(--good) 35%,transparent)}li.skipped>span>b{color:var(--dim)}
.summary{margin:6px 0 0}.spend{margin:6px 0 0;color:var(--dim);font:13px/1.5 var(--mono)}
.try{margin:16px 0;padding:14px 16px;border:1px solid var(--gold);border-radius:14px;background:color-mix(in srgb,var(--gold) 8%,transparent)}.try .eyebrow{color:var(--gold)}.try p{margin:0}
.panel h3{margin-bottom:6px}.status .panel{margin-top:14px}
footer{max-width:1080px;margin:0 auto;padding:18px 16px 40px;color:var(--dim);font-size:13px;border-top:1px solid var(--line)}
@media (max-width:560px){.card .art{width:72px;height:72px}ol.timeline li{grid-template-columns:1fr;gap:2px}}`;
}

/** The game's look: CODEX.md's palette and fonts, else the game's landing theme, else the studio's site/theme.json. */
function lookOf(root, game, meta, emb) {
  const theme = readTheme(root);
  const land = game.landing?.theme && typeof game.landing.theme === 'object' ? game.landing.theme : {};
  const mine = meta.palette && typeof meta.palette === 'object' ? meta.palette : {};
  const pick = (...vals) => vals.find((v) => typeof v === 'string' && COLOR.test(v.trim()))?.trim();
  const bg = pick(mine.bg, theme.bg, '#0b0c12');
  const lum = (() => { const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(bg); if (!m) return 0; const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]; const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; })();
  const scheme = meta.scheme === 'light' || (meta.scheme !== 'dark' && lum > 0.55) ? 'light' : 'dark';
  const palette = {
    scheme, bg,
    ink: pick(mine.ink, mine.fg, theme.fg, scheme === 'light' ? '#16161d' : '#f1f3f9'),
    accent: pick(mine.accent, land.accent, theme.accent, '#ffcf5a'),
    accent2: pick(mine.accent2, mine.glow, land.glow, theme.glow, '#7dffb0'),
    danger: pick(mine.danger, '#ff5d5d'), good: pick(mine.good, '#5fdc8b'), gold: pick(mine.gold, mine.accent, '#f2c14e'),
    panel: pick(mine.panel),
  };
  const fonts = meta.fonts && typeof meta.fonts === 'object' ? meta.fonts : {};
  const links = [];
  const faces = [];
  const stack = { display: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif', body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' };
  const fam = {};
  for (const role of ['display', 'body', 'mono']) {
    const v = typeof fonts[role] === 'string' ? fonts[role].trim() : '';
    if (v && FONT_TYPES[extname(v).toLowerCase()]) {
      const data = emb.font(v);
      if (data) { const name = `codex-${role}`; faces.push(`@font-face{font-family:"${name}";src:url(${data});font-display:swap}`); fam[role] = `"${name}", ${stack[role]}`; }
    } else if (v && FAMILY.test(v)) {
      links.push(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(v).replace(/%20/g, '+')}&display=swap`);
      fam[role] = `"${v}", ${stack[role]}`;
    }
  }
  if (!fam.display && theme.display) fam.display = theme.display;
  return { palette, fonts: { display: fam.display ?? stack.display, body: fam.body ?? stack.body, mono: fam.mono ?? stack.mono }, links: [...new Set(links)], faces };
}

/**
 * The page for one game. `mode`: 'file' (this computer; reloads while a build runs), 'artifact' (one file to publish
 * as a Claude artifact), 'site' (the studio site's private page). `feed`: a progress feed document, else the game's
 * newest one.
 */
export function renderCodex(root, id, { mode = 'file', feed, now = new Date() } = {}) {
  if (!GAME_ID.test(String(id ?? ''))) throw new Error(`no game id ${JSON.stringify(id)}`);
  const game = listGames(root).find((g) => g.id === id);
  if (!game) throw new Error(`no game "${id}" in games/`);
  const file = join(game.dir, CODEX_FILE);
  if (!existsSync(file)) throw new Error(`games/${id}/${CODEX_FILE} does not exist yet: npx --no-install homie-studio codex new ${id}`);
  if (statSync(file).size > LIMITS.source) throw new Error(`games/${id}/${CODEX_FILE} is over ${LIMITS.source / 1024} KB`);
  const parsed = parseCodex(readFileSync(file, 'utf8'));
  const { meta } = parsed;
  let studio = {};
  try { studio = readStudio(root); } catch { studio = {}; }
  const emb = new Embedder(root, game.dir);
  const look = lookOf(root, game, meta, emb);
  const title = parsed.title ?? game.name ?? id;
  const eyebrow = typeof meta.eyebrow === 'string' && meta.eyebrow.trim() ? meta.eyebrow.trim() : `${studio.name ?? 'Studio'} · ${title}`;
  const ctx = { eyebrow: String(eyebrow).slice(0, 80), pixel: meta.pixel === true, try: typeof meta.try === 'string' ? meta.try.slice(0, 300) : '', mode };
  const s = summarize(feed === undefined ? latestFeedFor(root, id) : feed);
  const sections = parsed.sections.filter((x) => x.body.join('\n').trim() || x.key);
  const tabs = sections.map((x) => `<a href="#${esc(x.id)}">${esc(x.title)}</a>`);
  // The build's tab comes right after Latest (or first), so it is never the one a narrow screen hides.
  const statusTab = `<a class="status" href="#build-status">${s?.state === 'running' ? `Build · ${s.percent}%` : 'Build status'}</a>`;
  tabs.splice(sections[0]?.key === 'latest' ? 1 : 0, 0, statusTab);
  const cover = typeof meta.cover === 'string' ? emb.image(meta.cover) : null;
  const pitch = parsed.pitch ? renderMarkdown(parsed.pitch).html : (game.blurb ? `<p>${esc(game.blurb)}</p>` : '');
  const body = sections.map((x) => sectionHtml(x, emb, ctx)).join('\n');
  const status = statusHtml(s, ctx);
  const start = s?.state === 'running' ? 'build-status' : (sections[0]?.id ?? 'build-status');
  const tagline = typeof meta.tagline === 'string' ? meta.tagline : '';
  const gaps = codexGaps(parsed);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Game Codex</title>
${look.links.map((href) => `<link rel="stylesheet" href="${esc(href)}">`).join('\n')}
<style>${look.faces.join('')}${css(look.palette, look.fonts, ctx.pixel)}</style>
</head>
<body data-mode="${esc(mode)}" data-start="${esc(start)}"${ctx.pixel ? ' class="pixel"' : ''}>
<header class="hero">${cover ? `<div class="bgimg" style="background-image:url(${cover})"></div>` : ''}<div class="wrap">
<p class="kicker">Game Codex · ${esc(studio.name ?? '')}</p>
<h1>${esc(title)}</h1>
${tagline ? `<p class="tagline">${esc(tagline)}</p>` : ''}
${pitch ? `<div class="pitch">${pitch}</div>` : ''}
</div></header>
<nav class="tabs" aria-label="Codex sections"><div class="wrap">${tabs.join('')}</div></nav>
<main>
${body}
${status}
</main>
<footer>Game Codex for ${esc(title)}: the plan your AI keeps true as decisions change. Source: games/${esc(id)}/${CODEX_FILE}. Drawn ${esc(now.toISOString().slice(0, 16).replace('T', ' '))} UTC. Made with Homie.</footer>
<script>${CODEX_SCRIPT}</script>
</body>
</html>
`;
  return { html, title, sections: sections.map((x) => ({ id: x.id, title: x.title, key: x.key })), missing: gaps.missing, openQuestions: gaps.openQuestions, warnings: emb.warnings, build: s ? { state: s.state, percent: s.percent } : null };
}

/** `homie-studio codex <id>`: the page on this computer (or the artifact copy). */
export function writeCodexPage(root, id, { mode = 'file' } = {}) {
  const r = renderCodex(root, id, { mode });
  const dir = join(root, CODEX_DIR);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, mode === 'artifact' ? `${id}.artifact.html` : `${id}.html`);
  writeFileSync(file, r.html);
  return { ok: true, command: 'codex', id, mode, file: relative(root, file), path: file, bytes: Buffer.byteLength(r.html), title: r.title, sections: r.sections, missing: r.missing, openQuestions: r.openQuestions, warnings: r.warnings, build: r.build };
}

/** Called whenever a progress feed changes: the local page redraws itself (only when it exists already). */
export function refreshCodexFile(root, id) {
  if (!id || !GAME_ID.test(String(id))) return;
  try {
    const page = join(root, CODEX_DIR, `${id}.html`);
    if (!existsSync(page)) return;
    writeFileSync(page, renderCodex(root, id, { mode: 'file' }).html);
  } catch { /* the page stays as it was */ }
}

/** Every game's codex, into the built site (lib/build.mjs): the owner-only pages at /_studio/codex/<id>/. */
export function buildCodexPages(root, dist, ids, { log = () => {} } = {}) {
  const done = [];
  for (const id of ids) {
    const game = listGames(root).find((g) => g.id === id);
    if (!game || !existsSync(join(game.dir, CODEX_FILE))) continue;
    try {
      const r = renderCodex(root, id, { mode: 'site' });
      const dir = join(dist, '_studio', 'codex', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.html'), r.html);
      for (const w of r.warnings) log(`codex ${id}: ${w}`);
      done.push(id);
    } catch (error) { log(`codex ${id}: not drawn (${error.message})`); }
  }
  return done;
}

/* ------------------------------------------------------------------ a new codex */

/** `homie-studio codex new <id>`: CODEX.md with every section, its look taken from the game and the studio. */
export function newCodex(root, id) {
  const game = listGames(root).find((g) => g.id === id);
  if (!game) return { ok: false, command: 'codex new', why: `no game "${id}" in games/ (make it first: npx --no-install homie-studio game new ${id} --from gem-rush)` };
  const file = join(game.dir, CODEX_FILE);
  if (existsSync(file)) return { ok: false, command: 'codex new', why: `games/${id}/${CODEX_FILE} exists already: change it, never replace it` };
  const theme = readTheme(root);
  const land = game.landing?.theme ?? {};
  const q = (v) => JSON.stringify(String(v));
  const cover = ['hero/wide.jpg', 'cover.jpg', 'cover.png', 'public/cover.jpg', 'public/cover.png'].find((p) => existsSync(join(game.dir, p)));
  const today = new Date().toISOString().slice(0, 10);
  const players = game.players ? `${game.players.min ?? 1} to ${game.players.max ?? 8}` : '1 to 8';
  const text = `---
tagline: ${q(game.blurb ?? '')}
${cover ? `cover: ${cover}\n` : ''}palette:
  bg: ${q(theme.bg ?? '#0b0c12')}
  ink: ${q(theme.fg ?? '#f1f3f9')}
  accent: ${q(land.accent ?? theme.accent ?? '#ffcf5a')}
  accent2: ${q(land.glow ?? theme.glow ?? '#7dffb0')}
  danger: "#ff5d5d"
fonts:
  display: ""
  body: ""
pixel: false
try: "Open it in a second tab, or on a phone, to see two players in the same room."
---

# ${game.name ?? id}

${game.blurb ?? ''}

## Latest

- ${today}: The codex starts. The game is a copy of the ${game.from?.starter ?? 'starter'} starter for now.

## Concept

<!-- Genre and type, the one-line pitch, and what a player does in the first ten seconds. Why is it fun with strangers? -->

## World

<!-- Where it happens: places, mood, a story in a few lines. Places as ### cards when there are several. -->

## Characters

<!-- One ### card each: a picture line, a chip line (\`C-01\` \`good: Player\`), a one-line description, then **Key:** value stats. -->

## Art direction

<!-- The style in words (pixel, painterly, low-poly, neon…), the palette, the fonts, two or three reference pictures from the game's folder. -->

## Controls

| Action | Phone | Computer | TV and phones |
| --- | --- | --- | --- |
| Move | drag from the lower left | WASD or arrow keys | each phone is a pad |

## Rooms and players

- **Players in a room:** ${players}
- **Round:** ${game.roundSeconds ? `${game.roundSeconds} s` : 'how long, and how it ends'}
- **Bots:** fill empty seats; a person who arrives takes a bot's place

## Music and sound

<!-- The theme's mood and tempo, the sounds that matter (pick-up, hit, win), and whether songs come from the free synth or ElevenLabs. -->

## Milestones

- [x] Step 1: a working copy of the starter plays in two browsers
- [ ] Step 2: one small change from one sentence
- [ ] Step 3: the plan (this codex)
- [ ] Step 4: the first playable version of the plan, checked with two browsers
- [ ] Step 5: art, sound and its landing page; online

## Open questions

-
`;
  writeFileSync(file, text);
  return { ok: true, command: 'codex new', id, file: relative(root, file), next: [`fill it from the plan interview, then: npx --no-install homie-studio codex ${id}`] };
}

/** A sign-in link that opens one game's codex on the live site (the stats page's one-time sign-in, then the codex). */
export function codexTarget(id) { return `/_studio/codex/${id}/`; }

export const _test = { studioFile, chip };
