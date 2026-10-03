/**
 * HOW SEARCH ENGINES AND AI AGENTS FIND A STUDIO (0.27.0): four plain files the site makes from its own catalogue,
 * so they are never out of date and never name what is not public.
 *
 *   /robots.txt      every public page may be crawled; the owner's pages (/_studio/), the APIs, accounts, the shop's
 *                    private steps and each game's play, TV, watch and socket doors may not; the sitemap's address.
 *                    A Preview (a branch under review) asks not to be crawled at all.
 *   /sitemap.xml     every public page (Home, Games and each landing, Music, Videos, Rooms, Posts, the studio's own
 *                    pages), with lastmod only where a real date says when it changed
 *   /llms.txt        the llms.txt convention (an H1, a > summary, then ## sections of links): what the studio is, each
 *                    public game with its pitch, players, Play, Watch, the big screen and whether and how it can be
 *                    remixed (the licence, the source, the words to say to Claude Code or Codex with Homie), songs,
 *                    videos, posts with their feeds, the studio's own pages, and a link to homie.rocks's llms.txt
 *   /llms-full.txt   the same, with each game's whole description, how to play, controls and credits, and every
 *                    post's text
 *
 * Only public games are ever named (a private or invite-only game is in none of them), and a game is offered for
 * remixing only when its owner's remix switch is on, its source is shared and its licence allows it. A file of the
 * studio's own in site/public (robots.txt, sitemap.xml, llms.txt, llms-full.txt) wins over the made one.
 */
import { licenseOf, LICENSE_KINDS, remixRow } from './license.mjs';

export const DISCOVERY_FILES = ['/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt'];

const studioName = (cat) => cat?.studio?.name ?? 'Studio';
const one = (v, n = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** Text for a markdown link's words: brackets escaped, one line. */
const label = (v) => one(v, 120).replace(/([[\]\\])/g, '\\$1');
const xml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const dateOf = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const newest = (list) => list.map(dateOf).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
const day = (v) => (dateOf(v) ? new Date(Date.parse(v)).toISOString().slice(0, 10) : null);
const clock = (s) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : null);
const KIND_WORD = { song: 'Song', score: 'Score', loop: 'Loop', stem: 'Stem', sfx: 'Sound', trailer: 'Trailer', 'music-video': 'Music video', cutscene: 'Cutscene', clip: 'Clip' };
const players = (g) => { const min = g.players?.min ?? 1; const max = g.players?.max ?? 8; return max <= 1 ? '1 player' : min === max ? `${max} players` : `${min}–${max} players`; };
const rounds = (s) => (Number.isFinite(s) && s > 0 ? (s % 60 ? `${s}-second rounds` : `${s / 60}-minute rounds`) : null);
const watchable = (g) => !(g.watch === false || g.watch === 'off');
const tv = (g) => g.landing?.tv !== false;
const gameDate = (g) => dateOf(g.dates?.modified) ?? dateOf(g.dates?.published);
const mediaDate = (e) => dateOf(e.date) ?? dateOf(e.made?.at);
const postDate = (p) => dateOf(p.updated) ?? dateOf(p.date);

/** The studio's own pages (site/pages) the sitemap and llms.txt name: not Home, not a game's landing, never the site's own places. */
function ownPages(cat, all) {
  const ids = new Set((all?.games ?? cat.games ?? []).map((g) => g.id));
  return (cat.site?.pages ?? []).filter((p) => typeof p === 'string' && /^\/[a-z0-9][a-z0-9/_-]*\/$/i.test(p) && p !== '/')
    .filter((p) => !ids.has(p.split('/')[1]) && !/^\/(?:games|music|videos|rooms|posts|account|shop|api|_studio|_homie|_site|media)\//.test(p));
}
const pageName = (p) => p.split('/').filter(Boolean).map((s) => s.replace(/[-_]+/g, ' ')).join(' · ').replace(/^./, (c) => c.toUpperCase());

/* ------------------------------------------------------------------ robots.txt */

export function robotsTxt(cat, origin, { preview = false } = {}) {
  if (preview) {
    return `# ${one(studioName(cat), 80)}: a Preview (a branch under review), not the studio's site. Nothing here is for search.\nUser-agent: *\nDisallow: /\n`;
  }
  const games = (cat.games ?? []).map((g) => g.id);
  const lines = [
    `# ${one(studioName(cat), 80)}, made with Homie (https://homie.rocks/studio/).`,
    '# Every public page may be crawled. The owner\'s pages, the APIs, accounts, the shop\'s private steps and each game\'s',
    '# play, TV, watch and socket doors may not (they open live rooms). AI agents: /llms.txt says what is here.',
    'User-agent: *',
    'Allow: /',
    'Disallow: /_studio/',
    'Disallow: /api/',
    'Disallow: /account/',
    'Disallow: /shop/thanks',
    'Disallow: /shop/parent/',
    'Disallow: /__homie',
    // The Lounge's socket and APIs (0.29.0); its page may be crawled.
    ...(cat.studio?.lounge ? ['Disallow: /lounge/api/', 'Disallow: /lounge/__'] : []),
    ...games.flatMap((id) => [`Disallow: /${id}/play`, `Disallow: /${id}/tv`, `Disallow: /${id}/watch`, `Disallow: /${id}/live`, `Disallow: /${id}/invite`, `Disallow: /${id}/api/`, `Disallow: /${id}/__`, `Disallow: /${id}/s/*/play`, `Disallow: /${id}/s/*/tv`, `Disallow: /${id}/s/*/home`]),
    '',
    `Sitemap: ${origin}/sitemap.xml`,
  ];
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ sitemap.xml */

/** [{ path, lastmod }] for every public page, Home first. */
export function sitemapEntries(cat, { all = null } = {}) {
  const games = cat.games ?? [];
  const songs = cat.songs ?? [];
  const videos = cat.videos ?? [];
  const posts = cat.posts ?? [];
  const out = [];
  const add = (path, lastmod = null) => { if (!out.some((x) => x.path === path)) out.push({ path, lastmod: dateOf(lastmod) }); };
  add('/', newest([...games.map(gameDate), ...songs.map(mediaDate), ...videos.map(mediaDate), ...posts.map(postDate)]));
  if (games.length) {
    add('/games/', newest(games.map(gameDate)));
    for (const g of games) {
      add(`/${g.id}/`, gameDate(g));
      if (g.landing?.credits?.texts) add(`/${g.id}/credits`, gameDate(g));
    }
    add('/rooms/');
  }
  if (songs.length) { add('/music/', newest(songs.map(mediaDate))); for (const e of songs) add(`/music/${e.slug}/`, mediaDate(e)); }
  if (videos.length) { add('/videos/', newest(videos.map(mediaDate))); for (const e of videos) add(`/videos/${e.slug}/`, mediaDate(e)); }
  if (posts.length) { add('/posts/', newest(posts.map(postDate))); for (const p of posts) add(`/posts/${p.slug}/`, postDate(p)); }
  // The Lounge (0.29.0), when studio.json turns it on: its page (what is said there is not in the page).
  if (cat.studio?.lounge) add('/lounge/');
  for (const p of ownPages(cat, all)) add(p);
  return out;
}

export function sitemapXml(cat, origin, opts = {}) {
  const urls = sitemapEntries(cat, opts).map((u) => `  <url><loc>${xml(`${origin}${u.path}`)}</loc>${u.lastmod ? `<lastmod>${xml(new Date(Date.parse(u.lastmod)).toISOString().replace(/\.\d{3}Z$/, 'Z'))}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/* ------------------------------------------------------------------ llms.txt */

const HOMIE_INSTALL = 'in Claude Code, `/plugin marketplace add homie-rocks/homie` and then `/plugin install homie@homie` (Codex takes the same marketplace)';

function licenceWords(g) {
  const l = licenseOf(g.license);
  const name = `${LICENSE_KINDS[l.kind]}${l.spdx ? `, ${l.spdx}` : ''}`;
  if (l.kind === 'remix-freely') return `${name}: a credit is welcome, not asked for`;
  return `${name}: a remix says "Remix of ${one(g.name, 80)} by ${one(g.studio, 80)}" with a link back`;
}

function summaryOf(cat, origin) {
  const name = studioName(cat);
  const tag = one(cat.studio?.tagline, 140);
  const games = (cat.games ?? []).length;
  // What it has, never what it might: a studio with no game says only what it publishes (a music studio makes no game).
  const has = [(cat.songs ?? []).length ? 'songs' : null, (cat.videos ?? []).length ? 'videos' : null, (cat.posts ?? []).length ? 'posts' : null].filter(Boolean);
  const kinds = has.length > 1 ? `${has.slice(0, -1).join(', ')} and ${has.at(-1)}` : has[0];
  const what = games
    ? 'It makes free multiplayer games that play in a web browser on a phone, a computer or a TV; press Play and you are in a live public room with whoever is playing, and bots hold the empty seats.'
    : has.length ? `It publishes ${kinds}.` : 'Its first game is coming soon.';
  return [
    `# ${one(name, 120)}`,
    '',
    `> ${one(name, 120)} is a studio made with Homie${tag ? ` (${tag})` : ''}. ${what} Its site is ${origin}/.`,
  ];
}

/** /llms.txt. `remixable(g)`: the owner's remix switch is on, the source is shared, and the licence allows it. */
export function llmsTxt(cat, origin, { remixable = () => false, directory = 'https://homie.rocks', full = false, posts = null, all = null } = {}) {
  const name = studioName(cat);
  const games = (cat.games ?? []).map((g) => ({ ...g, studio: name }));
  const songs = cat.songs ?? [];
  const videos = cat.videos ?? [];
  const list = cat.posts ?? [];
  const out = summaryOf(cat, origin);
  out.push('', full
    ? `Everything ${one(name, 120)} has published, in full: each game's whole description, how to play, controls and credits, every song and video, and every post's text. The short version with links only is ${origin}/llms.txt.`
    : `${games.length ? 'Every game below is free and needs no download or account. A game\'s page has its trailer, how to play and credits; its Play link puts a visitor straight into a live public room. ' : ''}Whole descriptions and every post's text: ${origin}/llms-full.txt.`);
  if (games.length) {
    out.push('', '## Games', '');
    for (const g of games) {
      const L = g.landing ?? {};
      const doors = [`Play: ${origin}/${g.id}/play`, ...(watchable(g) ? [`Watch a live room: ${origin}/${g.id}/watch`] : []), ...(tv(g) ? [`On a TV: ${origin}/${g.id}/tv`] : [])];
      const facts = [players(g), rounds(g.roundSeconds), ...(Array.isArray(g.genre) ? g.genre : g.genre ? [g.genre] : [])].filter(Boolean).join(', ');
      const lineage = remixRow(g.remixOf);
      const open = remixable(g);
      out.push(`- [${label(g.name)}](${origin}/${g.id}/): ${one(L.pitch || g.blurb, 240)}${/[.!?]$/.test(one(L.pitch || g.blurb)) ? '' : '.'} ${facts}.${lineage ? ` A remix of ${one(lineage.name, 80)}${lineage.studio ? ` by ${one(lineage.studio, 80)}` : ''}.` : ''} ${doors.join('. ')}. ${open ? `Open to remix (${LICENSE_KINDS[licenseOf(g.license).kind]}${licenseOf(g.license).spdx ? `, ${licenseOf(g.license).spdx}` : ''}): see Remix below.` : 'Not open to remix.'}`);
      if (full) {
        const C = L.credits ?? {};
        const lines = [];
        if (g.blurb && one(g.blurb) !== one(L.pitch)) lines.push(one(g.blurb, 600));
        if (L.about) lines.push(one(L.about, 1200));
        if ((L.how ?? []).length) lines.push(`How to play: ${L.how.map((x) => one(x, 240)).join(' ')}`);
        const ctl = ['phone', 'computer', 'tv'].filter((k) => L.controls?.[k]).map((k) => `${k === 'tv' ? 'TV' : k}: ${one(L.controls[k], 300)}`);
        if (ctl.length) lines.push(`Controls. ${ctl.join('. ')}.`);
        const credits = [`Made by ${one(name, 80)}`, ...(C.people ?? []).map((c) => `${c.role ? `${one(c.role, 60)}: ` : ''}${one(c.name, 80)}`)];
        if (C.original && !C.original.house && C.original.title) credits.push(`Based on ${one(C.original.title, 120)}${C.original.author ? ` by ${one(C.original.author, 120)}` : ''}${C.original.year ? ` (${one(C.original.year, 12)})` : ''}${C.original.licence ? `, ${one(C.original.licence, 60)} licence` : ''}${C.original.url ? ` (${C.original.url})` : ''}`);
        for (const p of C.parts ?? []) credits.push(`${one(p.what, 160)}${p.author ? `: ${one(p.author, 120)}` : ''}${p.licence ? `, ${one(p.licence, 60)}` : ''}`);
        lines.push(`Credits: ${credits.join('; ')}.`);
        if (C.texts) lines.push(`Licence texts: ${origin}/${g.id}/credits`);
        for (const l of lines) out.push(`  ${l}`);
      }
    }
    const open = games.filter((g) => remixable(g));
    if (open.length) {
      out.push('', '## Remix', '');
      out.push(`Homie is a plugin for Claude Code and Codex that makes multiplayer games in a studio of your own, on your own free Cloudflare account. To remix one of these games, ${HOMIE_INSTALL}, then say "Remix <game> from <its source address> into a game of my own in my Homie studio". The plugin's \`game_remix\` tool (or \`npx --no-install homie-studio game remix <source address> --id <new-id>\` in a studio's folder) copies it in and writes the credit its licence asks for.`, '');
      for (const g of open) out.push(`- [${label(g.name)} source](${origin}/games/${g.id}/source.json): ${licenceWords(g)}. Say: "Remix ${one(g.name, 80)} from ${origin}/games/${g.id}/source.json into a game of my own in my Homie studio".`);
    }
  }
  if (songs.length) {
    out.push('', '## Music', '');
    for (const e of songs) {
      out.push(`- [${label(e.title)}](${origin}/music/${e.slug}/): ${[KIND_WORD[e.kind] ?? 'Music', clock(e.duration), e.bpm ? `${e.bpm} BPM` : null, e.key, e.album ? `from ${one(e.album, 120)}` : null].filter(Boolean).join(', ')}.${e.blurb ? ` ${one(e.blurb, 300)}` : ''}`);
      if (full && e.credits) out.push(`  ${one(e.credits, 600)}`);
    }
  }
  if (videos.length) {
    out.push('', '## Videos', '');
    for (const e of videos) {
      out.push(`- [${label(e.title)}](${origin}/videos/${e.slug}/): ${[KIND_WORD[e.kind] ?? 'Video', clock(e.duration)].filter(Boolean).join(', ')}.${e.blurb ? ` ${one(e.blurb, 300)}` : ''}`);
      if (full && e.credits) out.push(`  ${one(e.credits, 600)}`);
    }
  }
  if (list.length) {
    out.push('', '## Posts', '');
    out.push(`- [Atom feed](${origin}/posts/feed.xml): every post, newest first, with its full text`);
    out.push(`- [JSON Feed](${origin}/posts/feed.json): the same, as JSON`);
    for (const p of list.slice(0, full ? 200 : 20)) out.push(`- [${label(p.title)}](${origin}/posts/${p.slug}/): ${day(p.date) ?? ''}${p.summary ? `. ${one(p.summary, 300)}` : ''}`);
    if (full && posts?.length) {
      for (const p of posts) {
        const textOf = p.record?.text;
        if (!textOf) continue;
        out.push('', `### ${one(p.title, 140)} (${day(p.date) ?? ''})`, '', `${origin}/posts/${p.slug}/`, '', String(textOf).trim().slice(0, 30000));
      }
    }
  }
  const pages = ownPages(cat, all);
  if (pages.length) {
    out.push('', '## Pages', '');
    for (const p of pages) out.push(`- [${label(pageName(p))}](${origin}${p})`);
  }
  out.push('', '## Optional', '');
  if (games.length) out.push(`- [Rooms](${origin}/rooms/): every public room playing now (${origin}/api/rooms is the same as JSON)`);
  if (cat.studio?.lounge) out.push(`- [${label(cat.studio.lounge.name ?? 'The Lounge')}](${origin}/lounge/): the studio's community room: play nights, live rooms and chat (${origin}/lounge/api/now is its play nights and rules as JSON; what people say there is not published)`);
  out.push(`- [Studio manifest](${origin}/.well-known/homie-studio.json): the games, songs, videos and posts as JSON`);
  out.push(`- [Sitemap](${origin}/sitemap.xml): every public page`);
  if (!full) out.push(`- [Everything, in full](${origin}/llms-full.txt): each game's whole description, how to play and credits, and every post's text`);
  const hub = /^https:\/\/[a-z0-9.-]+$/i.test(String(directory ?? '')) ? directory : 'https://homie.rocks';
  out.push(`- [Homie](${hub}/llms.txt): what Homie is, and how to make a studio like this one`);
  return `${out.join('\n')}\n`;
}

/** The plain-text answer every one of these files is sent with. */
export function discoveryResponse(body, type, { method = 'GET' } = {}) {
  return new Response(method === 'HEAD' ? null : body, {
    headers: {
      'content-type': `${type}; charset=utf-8`,
      // A game the owner makes private leaves these within five minutes.
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
    },
  });
}
