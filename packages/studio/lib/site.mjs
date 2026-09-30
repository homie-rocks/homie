/**
 * The studio site's own parts, gathered at build time (site/SITE.md says all of it):
 *
 *   site/theme.json         the studio's look as tokens (colours, fonts, corner radius, its mark)
 *   site/theme.css          any CSS on top (restyle anything, the "Made with Homie" footer included)
 *   site/partials/<n>.html  a piece of every generated page: head, header, footer, home, game, game-<id>, post
 *   site/pages/.../*.html   a whole page of the studio's own, served instead of (or beside) the generated one
 *   site/public/...         files served as they are (fonts, a logo, hero footage), at the same path
 *   posts/*.md              the studio's news and drops (a title, a date, a body, links to a game, song or video)
 *   games/<id>/             each game's landing: game.json `landing`, credits.json, hero/ footage, its cover
 *
 * Nothing here runs on Cloudflare: it writes site/dist (the Worker reads games.json and site/dist/_site/).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { renderMarkdown } from './markdown.mjs';

/** One file the site serves itself may be at most 25 MiB (Workers static assets). */
const MAX_FILE = 25 * 1024 * 1024;
const MAX_PARTIAL = 64 * 1024;
const MAX_CSS = 256 * 1024;
const MAX_POST = 256 * 1024;

/* ------------------------------------------------------------------ theme */

/**
 * Curated looks a new studio starts from (picked from its slug, so two new studios rarely match). Each is dark,
 * like the house brands' landings, and passes contrast for text on the background and on the accent.
 */
export const PALETTES = {
  neon: { bg: '#05070d', fg: '#dffcff', accent: '#ff3bd4', glow: '#00eaff' },
  dock: { bg: '#070612', fg: '#eafcff', accent: '#ff8a3d', glow: '#7df0ff' },
  gold: { bg: '#0b0c12', fg: '#f1f3f9', accent: '#ffcf5a', glow: '#7dffb0' },
  acid: { bg: '#060905', fg: '#efffe6', accent: '#b6ff3b', glow: '#3bffd0' },
  ember: { bg: '#0d0706', fg: '#fff1ea', accent: '#ff5a36', glow: '#ffc36b' },
  orchid: { bg: '#0a0612', fg: '#f6ecff', accent: '#c77dff', glow: '#ff7dd8' },
  tide: { bg: '#041014', fg: '#e6fbff', accent: '#2ee6c9', glow: '#6fb8ff' },
  candy: { bg: '#120814', fg: '#fff0f7', accent: '#ff6fa8', glow: '#ffd36f' },
};
export const DEFAULT_THEME = { palette: 'gold', ...PALETTES.gold };

/** The palette a new studio gets: stable for its slug. */
export function paletteFor(slug) {
  const names = Object.keys(PALETTES);
  let h = 2166136261;
  for (const c of String(slug ?? '')) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return names[h % names.length];
}

const COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9a-z.,%\s/+-]{1,80}\))$/i;
const FAMILY = /^[A-Za-z0-9 ,"'_.-]{1,240}$/;
const ASSET = /^\/[A-Za-z0-9._~/-]{1,200}$/;
const httpsUrl = (v) => { try { const u = new URL(String(v)); return u.protocol === 'https:' && !/["'<>\s]/.test(u.href) ? u.href : null; } catch { return null; } };
const sitePath = (v) => (ASSET.test(String(v ?? '')) && !String(v).includes('..') ? String(v) : null);

/** Relative luminance of a #rgb/#rrggbb colour (0..1), or null for any other colour syntax. */
function luminance(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex));
  if (!m) return null;
  const full = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * site/theme.json as the tokens the pages use. Unknown keys and unsafe values are dropped (a warning each),
 * so a theme can never break out of the page's stylesheet.
 */
export function readTheme(root, { log = () => {} } = {}) {
  const file = join(root, 'site', 'theme.json');
  let raw = {};
  if (existsSync(file)) {
    try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { log(`warning: site/theme.json is not JSON (${error.message}); the default look is used`); raw = {}; }
  }
  const base = PALETTES[raw.palette] ?? (raw.palette ? (log(`warning: site/theme.json palette "${raw.palette}" is not one of ${Object.keys(PALETTES).join(', ')}`), DEFAULT_THEME) : DEFAULT_THEME);
  const theme = { palette: PALETTES[raw.palette] ? raw.palette : (existsSync(file) ? 'custom' : DEFAULT_THEME.palette) };
  for (const k of ['bg', 'fg', 'accent', 'glow', 'panel', 'accentInk']) {
    const v = raw[k] ?? (k === 'accent' ? raw.hot : undefined) ?? base[k];
    if (v === undefined) continue;
    if (COLOR.test(String(v))) theme[k] = String(v);
    else { log(`warning: site/theme.json ${k} "${String(v).slice(0, 40)}" is not a colour; left out`); if (base[k]) theme[k] = base[k]; }
  }
  if (!theme.accentInk) {
    const l = luminance(theme.accent);
    if (l !== null) theme.accentInk = l > 0.4 ? '#0b0b10' : '#ffffff';
  }
  const bgL = luminance(theme.bg);
  theme.scheme = raw.scheme === 'light' || (raw.scheme !== 'dark' && bgL !== null && bgL > 0.5) ? 'light' : 'dark';
  for (const k of ['display', 'text', 'mono']) {
    if (raw[k] === undefined) continue;
    if (FAMILY.test(String(raw[k]))) theme[k] = String(raw[k]);
    else log(`warning: site/theme.json ${k} is not a font list; left out`);
  }
  if (raw.radius !== undefined) {
    const r = Number(raw.radius);
    if (Number.isFinite(r) && r >= 0 && r <= 40) theme.radius = r; else log('warning: site/theme.json radius is a number from 0 to 40; left out');
  }
  if (Array.isArray(raw.fonts)) {
    theme.fonts = raw.fonts.slice(0, 6).map((f) => {
      const family = String(f?.family ?? '');
      const src = sitePath(f?.src) ?? httpsUrl(f?.src);
      if (!/^[A-Za-z0-9 _-]{1,60}$/.test(family) || !src) { log(`warning: site/theme.json fonts: "${family.slice(0, 30)}" needs a family (letters, digits, spaces) and a src (a /path in site/public, or https://); left out`); return null; }
      const weight = /^\d{3}( \d{3})?$/.test(String(f.weight ?? '')) ? String(f.weight) : '400';
      const style = f.style === 'italic' ? 'italic' : 'normal';
      return { family, src, weight, style };
    }).filter(Boolean);
    if (!theme.fonts.length) delete theme.fonts;
  }
  for (const k of ['mark', 'icon', 'social']) {
    if (raw[k] === undefined) continue;
    const v = sitePath(raw[k]) ?? httpsUrl(raw[k]);
    if (v) theme[k] = v; else log(`warning: site/theme.json ${k} is a /path in site/public or an https:// address; left out`);
  }
  if (typeof raw.wordmark === 'string') theme.wordmark = raw.wordmark.slice(0, 40);
  if (raw.uppercase === false) theme.uppercase = false;
  return theme;
}

/** What `homie-studio new` writes into site/theme.json: the studio's palette, spelled out so it can be changed. */
export function themeFile(slug) {
  const palette = paletteFor(slug);
  return `${JSON.stringify({ palette, ...PALETTES[palette], display: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', radius: 18 }, null, 2)}\n`;
}

/* ------------------------------------------------------------------ posts */

export const POST_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const slugOf = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/** `---` frontmatter: `key: value` lines (quotes optional); returns [fields, body]. */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return [{}, text];
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]{0,30})\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    if (v === 'true' || v === 'false') v = v === 'true';
    fields[kv[1].toLowerCase()] = v;
  }
  return [fields, text.slice(m[0].length)];
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
/** A post's date as an ISO timestamp (a bare day is midnight UTC), or null. */
export function isoDate(value) {
  const m = DAY.exec(String(value ?? '').trim());
  if (!m) return null;
  const t = Date.parse(m[4] ? String(value).trim().replace(' ', 'T') + (m[7] ? '' : 'Z') : `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * posts/*.md, newest first. The filename is the address (`posts/2026-09-30-we-are-live.md` is
 * `/posts/we-are-live/`, dated by its prefix unless the frontmatter says `date:`). A post links to at most one
 * game, one song and one video of this studio (frontmatter `game:`, `song:`, `video:`); `draft: true` keeps it
 * off the site. The record beside each (`record`) is the shape a post takes when it is published as an atproto
 * record later: nothing in it depends on this site's HTML.
 */
export function readPosts(root, { games = [], songs = [], videos = [], log = () => {} } = {}) {
  const dir = join(root, 'posts');
  const posts = [];
  const skipped = [];
  if (!existsSync(dir)) return { posts, skipped };
  const seen = new Set();
  for (const name of readdirSync(dir).sort()) {
    if (!/\.md$/i.test(name) || /^readme\.md$/i.test(name) || /^[._]/.test(name)) continue;
    const file = join(dir, name);
    if (!statSync(file).isFile()) continue;
    if (statSync(file).size > MAX_POST) { skipped.push({ post: name, why: 'over 256 KB: split it, and put pictures in site/public' }); continue; }
    const [fm, body] = frontmatter(readFileSync(file, 'utf8'));
    const stem = name.replace(/\.md$/i, '');
    const prefix = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(stem);
    const slug = fm.slug && POST_SLUG.test(String(fm.slug)) ? String(fm.slug) : slugOf(prefix ? prefix[2] : stem);
    if (!POST_SLUG.test(slug)) { skipped.push({ post: name, why: 'its name gives no address: name it like 2026-09-30-we-are-live.md' }); continue; }
    if (seen.has(slug)) { skipped.push({ post: name, why: `a second post with the address /posts/${slug}/` }); continue; }
    if (fm.draft === true) { skipped.push({ post: name, why: 'a draft (draft: true)' }); continue; }
    const date = isoDate(fm.date) ?? (prefix ? isoDate(prefix[1]) : null);
    if (!date) { skipped.push({ post: name, why: 'no date: add `date: 2026-09-30` to its frontmatter, or start its name with the day' }); continue; }
    const { html, text } = renderMarkdown(body);
    const heading = /^#\s+(.+)$/m.exec(body)?.[1];
    const title = String(fm.title ?? heading ?? '').trim().slice(0, 140);
    if (!title) { skipped.push({ post: name, why: 'no title: add `title:` to its frontmatter' }); continue; }
    const links = {};
    for (const [kind, list, key] of [['game', games, 'id'], ['song', songs, 'slug'], ['video', videos, 'slug']]) {
      const want = fm[kind];
      if (!want) continue;
      if (list.some((x) => x[key] === want)) links[kind] = String(want);
      else log(`warning: posts/${name} links ${kind} "${want}", which this studio's site does not have; the link is left out`);
    }
    const image = fm.image ? (sitePath(fm.image) ?? httpsUrl(fm.image)) : null;
    if (fm.image && !image) log(`warning: posts/${name} image is a /path on the site or an https:// address; left out`);
    const summary = String(fm.summary ?? '').trim().slice(0, 300) || (text.length > 220 ? `${text.slice(0, 217).replace(/\s+\S*$/, '')}…` : text);
    seen.add(slug);
    posts.push({
      slug, title, date, updated: isoDate(fm.updated) ?? null, summary, image, author: fm.author ? String(fm.author).slice(0, 80) : null, links, html,
      record: {
        $type: 'rocks.homie.studio.post',
        title, text: body.trim().slice(0, 30000), createdAt: date,
        ...(summary ? { summary } : {}),
        links: Object.entries(links).map(([kind, id]) => ({ kind, id })),
      },
    });
  }
  posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
  for (const s of skipped) log(`posts/${s.post}: ${s.why}`);
  return { posts, skipped };
}

/* ------------------------------------------------------------------ site/ overrides */

export const PARTIALS = ['head', 'header', 'footer', 'home', 'game', 'post'];
/** Paths a page of the studio's own can never take: the rooms, the game files, the API and the owner's pages. */
const RESERVED_PAGE = /^\/(?:api|_studio|_homie|_site|media|\.well-known|games\/[^/]+)\/|^\/[a-z0-9][a-z0-9-]{0,39}\/(?:play|tv|live|api|__[a-z]+)(?:\/|$)/;
/** Top-level names site/public must not take (the build's own output). */
const RESERVED_PUBLIC = new Set(['games', 'music', 'videos', 'games.json', '_site', '_homie', '_studio', 'api', 'media']);

function walk(dir, fn, rel = '') {
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, fn, r); else if (e.isFile()) fn(r);
  }
}

/**
 * site/public, site/pages, site/partials and site/theme.css into site/dist. Returns what the Worker needs:
 * the page paths (served from _site/pages), the partials' text, the extra CSS, and what was left out.
 */
export function buildSiteFiles(root, dist, { gameIds = [], log = () => {} } = {}) {
  const site = join(root, 'site');
  const res = { pages: [], partials: {}, css: null, public: [], skipped: [] };
  const skip = (what, why) => { res.skipped.push({ what, why }); log(`${what}: ${why}`); };

  const pub = join(site, 'public');
  if (existsSync(pub)) {
    walk(pub, (rel) => {
      const top = rel.split('/')[0];
      if (RESERVED_PUBLIC.has(top)) return skip(`site/public/${rel}`, `/${top}/ is the site's own; put it somewhere else`);
      const bytes = statSync(join(pub, rel)).size;
      if (bytes > MAX_FILE) return skip(`site/public/${rel}`, `${Math.round(bytes / 1048576)} MiB is over the 25 MiB a site serves itself`);
      mkdirSync(dirname(join(dist, rel)), { recursive: true });
      cpSync(join(pub, rel), join(dist, rel));
      res.public.push(`/${rel}`);
    });
  }

  const pages = join(site, 'pages');
  if (existsSync(pages)) {
    walk(pages, (rel) => {
      if (!/\.html$/.test(rel)) return skip(`site/pages/${rel}`, 'only .html pages go in site/pages (files go in site/public)');
      const path = `/${rel.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '/')}`;
      if (RESERVED_PAGE.test(path)) return skip(`site/pages/${rel}`, `${path} belongs to the site itself (rooms, game files, the API)`);
      if (!/^\/([a-z0-9][a-z0-9._-]*\/)*$/.test(path)) return skip(`site/pages/${rel}`, 'a page address is lowercase letters, digits, dots and hyphens');
      const bytes = statSync(join(pages, rel)).size;
      if (bytes > MAX_FILE) return skip(`site/pages/${rel}`, 'over 25 MiB');
      const dest = join(dist, '_site', 'pages', path, 'index.html');
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(pages, rel), dest);
      res.pages.push(path);
    });
  }

  const partials = join(site, 'partials');
  if (existsSync(partials)) {
    for (const name of readdirSync(partials).sort()) {
      if (!name.endsWith('.html') || name.startsWith('.')) continue;
      const key = name.slice(0, -5);
      const known = PARTIALS.includes(key) || (/^game-[a-z0-9][a-z0-9-]{0,39}$/.test(key) && gameIds.includes(key.slice(5)));
      if (!known) { skip(`site/partials/${name}`, `not a partial the pages use (${PARTIALS.join(', ')}, or game-<id> for one of this studio's games)`); continue; }
      const text = readFileSync(join(partials, name), 'utf8');
      if (text.length > MAX_PARTIAL) { skip(`site/partials/${name}`, 'over 64 KB'); continue; }
      res.partials[key] = text;
    }
  }

  const css = join(site, 'theme.css');
  if (existsSync(css)) {
    const text = readFileSync(css, 'utf8');
    if (text.length > MAX_CSS) skip('site/theme.css', 'over 256 KB');
    else res.css = text.replace(/<\/(style)/gi, '<\\/$1');
  }
  res.pages.sort();
  return res;
}

/* ------------------------------------------------------------------ a game's landing */

const inside = (base, rel) => {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || /^[a-z]+:/i.test(rel)) return null;
  const abs = resolve(base, normalize(rel));
  return abs.startsWith(`${resolve(base)}${sep}`) ? abs : null;
};
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const IMAGE = /\.(jpe?g|png|webp|avif|gif)$/i;
const VIDEO = /\.(mp4|webm|m4v|mov)$/i;

/** Hero footage by the house brands' names: hero/wide.mp4, hero/tall.mp4, their .av1.mp4 cuts, hero/wide.jpg, hero/tall.jpg. */
const HERO_NAMES = { wide: ['wide.mp4', 'wide.webm'], tall: ['tall.mp4', 'tall.webm'], wideAv1: ['wide.av1.mp4'], tallAv1: ['tall.av1.mp4'], wideImage: ['wide.jpg', 'wide.webp', 'wide.png', 'wide.avif'], tallImage: ['tall.jpg', 'tall.webp', 'tall.png', 'tall.avif'] };

/**
 * Everything a game's landing shows, from the game's own files: game.json (`landing` block, name, blurb, players,
 * round length, cover, share), credits.json, hero/ footage, and the studio's trailer and music for it. Files the
 * landing shows are copied into the game's built folder under _landing/ (the cover beside the build when the
 * build left it out), so the site serves them. Nothing is invented: a landing without footage uses the cover.
 */
export function landingOf(g, out, { videos = [], songs = [], log = () => {} } = {}) {
  const L = g.landing && typeof g.landing === 'object' ? g.landing : {};
  const credits = readJson(join(g.dir, 'credits.json')) ?? {};
  const landDir = join(out, '_landing');
  const copied = new Map();
  const serve = (abs, label) => {
    if (!abs || !existsSync(abs) || !statSync(abs).isFile()) return null;
    if (copied.has(abs)) return copied.get(abs);
    const bytes = statSync(abs).size;
    if (bytes > MAX_FILE) { log(`warning: games/${g.id}: ${label} is ${Math.round(bytes / 1048576)} MiB, over the 25 MiB a site serves itself; the landing leaves it out`); return null; }
    mkdirSync(landDir, { recursive: true });
    let name = basename(abs).replace(/[^A-Za-z0-9._-]/g, '-');
    if ([...copied.values()].some((u) => u.endsWith(`/${name}`))) name = `${copied.size}-${name}`;
    cpSync(abs, join(landDir, name));
    const url = `/games/${g.id}/_landing/${name}`;
    copied.set(abs, url);
    return url;
  };
  const pick = (explicit, names, label) => {
    if (explicit) {
      const abs = inside(g.dir, explicit);
      const url = abs ? serve(abs, label) : null;
      if (!url) log(`warning: games/${g.id}/game.json landing ${label} "${String(explicit).slice(0, 60)}" is not a file in the game's folder`);
      return url;
    }
    for (const n of names) { const url = serve(join(g.dir, 'hero', n), `hero/${n}`); if (url) return url; }
    return null;
  };
  const H = L.hero && typeof L.hero === 'object' ? L.hero : {};
  const hero = {
    wide: pick(H.video ?? H.wide, HERO_NAMES.wide, 'hero video'),
    tall: pick(H.tall, HERO_NAMES.tall, 'hero tall video'),
    wideAv1: H.video || H.wide ? null : pick(null, HERO_NAMES.wideAv1, 'hero AV1 video'),
    tallAv1: H.tall ? null : pick(null, HERO_NAMES.tallAv1, 'hero tall AV1 video'),
    wideImage: pick(H.image, HERO_NAMES.wideImage, 'hero image'),
    tallImage: pick(H.tallImage, HERO_NAMES.tallImage, 'hero tall image'),
  };
  // The cover: the game's card everywhere, and the hero still when there is no footage.
  let cover = null;
  if (g.cover) {
    const abs = inside(g.dir, g.cover);
    if (abs && existsSync(abs)) {
      const beside = join(out, relative(g.dir, abs));
      if (!existsSync(beside)) { mkdirSync(dirname(beside), { recursive: true }); cpSync(abs, beside); }
      cover = `/games/${g.id}/${relative(g.dir, abs).split(sep).map(encodeURIComponent).join('/')}`;
    } else log(`warning: games/${g.id}/game.json cover "${g.cover}" is not a file in the game's folder`);
  }
  // A trailer of this game from videos/manifest.json: the hero's footage when the game has none of its own.
  const forGame = (list) => list.filter((e) => e.for?.game === g.id);
  const trailers = forGame(videos).sort((a, b) => (a.kind === 'trailer' ? -1 : 0) - (b.kind === 'trailer' ? -1 : 0));
  const trailer = trailers[0] ?? null;
  const fileUrl = (e, role) => (e?.files ?? []).find((f) => f.role === role)?.url ?? null;
  if (trailer && !hero.wide && !hero.tall) {
    hero.wide = fileUrl(trailer, 'video');
    hero.tall = fileUrl(trailer, 'vertical');
    hero.fromTrailer = trailer.slug;
  }
  if (!hero.wideImage) hero.wideImage = (trailer && hero.fromTrailer ? fileUrl(trailer, 'poster') : null) ?? cover;
  for (const k of Object.keys(hero)) if (!hero[k]) delete hero[k];
  const focus = /^\d{1,3}% \d{1,3}%$/.test(String(H.focus ?? '')) ? String(H.focus) : null;
  const tint = Number.isFinite(Number(H.tint)) && H.tint !== null && H.tint !== '' ? Math.max(0, Math.min(80, Math.round(Number(H.tint)))) : null;
  const alt = str(H.alt, 300);

  // How to play: game.json landing.controls, else credits.json controls.
  const controls = {};
  for (const k of ['phone', 'computer', 'tv']) {
    const v = str(L.controls?.[k], 300) ?? str(credits.controls?.[k], 300);
    if (v) controls[k] = v;
  }
  const how = Array.isArray(L.howToPlay) ? L.howToPlay.map((s) => str(s, 240)).filter(Boolean).slice(0, 6) : [];

  // Credits: who made it (game.json landing.credits), the original it is based on and the parts inside it
  // (credits.json, as a port records them), with the licence texts on /<id>/credits.
  const people = (Array.isArray(L.credits) ? L.credits : Array.isArray(g.credits) ? g.credits : []).slice(0, 24).map((c) => ({
    role: str(c?.role, 60), name: str(c?.name, 80), url: httpsUrl(c?.url),
  })).filter((c) => c.name);
  const o = credits.original && typeof credits.original === 'object' ? credits.original : null;
  const original = o ? {
    title: str(o.title, 120), author: str(o.author, 120), year: str(String(o.year ?? ''), 12), url: httpsUrl(o.url),
    licence: str(o.licence, 60), house: o.house === true,
  } : null;
  const parts = (Array.isArray(credits.parts) ? credits.parts : []).slice(0, 40).map((p) => ({
    what: str(p?.what, 160), author: str(p?.author, 120), url: httpsUrl(p?.url), licence: str(p?.licence, 60), licenceUrl: httpsUrl(p?.licenceUrl), note: str(p?.note, 200),
  })).filter((p) => p.what);
  // The licence texts, for /<id>/credits: CREDITS.md and every licence file credits.json names.
  const texts = [];
  for (const f of ['CREDITS.md', o?.licenceFile, ...(credits.parts ?? []).map((p) => p?.licenceFile)]) {
    if (typeof f !== 'string' || texts.some((t) => t.file === f)) continue;
    const abs = inside(g.dir, f);
    if (!abs || !existsSync(abs) || statSync(abs).size > 256 * 1024) continue;
    const text = readFileSync(abs, 'utf8');
    if (text.includes('\u0000')) continue;
    texts.push({ file: f, text });
  }
  if (texts.length) { mkdirSync(landDir, { recursive: true }); writeFileSync(join(landDir, 'credits.json'), `${JSON.stringify({ v: 1, texts })}\n`); }

  const words = L.players && typeof L.players === 'object' ? { one: str(L.players.one, 24), many: str(L.players.many, 24) } : null;
  return {
    pitch: str(L.pitch, 240) ?? str(credits.tagline, 240),
    kicker: str(L.kicker, 120),
    about: str(L.about, 1200) ?? str(credits.about, 1200),
    controls, how,
    hero: { ...hero, ...(focus ? { focus } : {}), ...(alt ? { alt } : {}), ...(tint !== null ? { tint } : {}) },
    headline: str(L.headline, 120),
    cover,
    words: words && (words.one || words.many) ? words : null,
    credits: { people, original, parts, texts: texts.length },
    trailer: trailer ? trailer.slug : null,
    videos: trailers.map((e) => e.slug),
    music: forGame(songs).map((e) => e.slug),
    source: g.share?.source !== false,
    tv: g.screen?.tv !== false && L.tv !== false,
    theme: L.theme && typeof L.theme === 'object' ? Object.fromEntries(['accent', 'glow', 'bg', 'fg'].filter((k) => COLOR.test(String(L.theme[k] ?? ''))).map((k) => [k, L.theme[k]])) : null,
  };
}

