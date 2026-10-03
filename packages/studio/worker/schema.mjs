/**
 * STRUCTURED DATA (0.27.0): what each of a studio site's generated pages says about itself to search engines, as
 * schema.org JSON-LD, one `<script type="application/ld+json">` with an `@graph` in the page's <head>. Only what the
 * page shows and the studio's own files say: nothing is invented.
 *
 *   Home                 Organization (the studio: name, url, logo, image, description, the owner's sameAs) and WebSite
 *   /games/, /rooms/     ItemList of the public games' landings (the Rooms list never carries a live count)
 *   /<game>/             VideoGame (co-typed WebApplication: it runs in a browser) with its pictures and screenshots,
 *                        genre, players, play modes, platforms, the studio as author and publisher, the source's
 *                        licence, isBasedOn (a remix's original, a port's original), a trailer (VideoObject), dates,
 *                        and one free-to-play Offer whose addOn lists what the studio's shop really sells in it
 *   /music/, /music/<s>/ MusicAlbum (when the manifest names one) or ItemList; MusicRecording (byArtist: the studio)
 *   /videos/, /<v>/      ItemList; VideoObject (thumbnailUrl, uploadDate, duration, contentUrl)
 *   /posts/, /<post>/    Blog; BlogPosting (author, publisher, dates, image, the game it is about)
 *   every page but Home  BreadcrumbList
 *
 * Never: a rating or a review (Homie shows none on the page), a price for anything the shop does not sell, or a
 * live number that a cache would keep stale.
 *
 * The owner adds their own: game.json `"schema": { … }` (properties on the game's VideoGame) and studio.json
 * `"site": { "schema": { … } }` (properties on the studio's Organization, such as `sameAs`). Homie's own properties
 * win, and `aggregateRating`, `review` and `offers` are refused (lib/build.mjs warns). A page of the studio's own
 * (site/pages) takes `<!-- homie:schema -->` where it wants these blocks.
 */
import { licenseOf, LICENSE_KINDS, remixRow } from './license.mjs';

const CONTEXT = 'https://schema.org';

/** Properties an owner's extras may never set: ratings Homie cannot show, and prices that are not the shop's. */
export const SCHEMA_REFUSED = Object.freeze(['aggregateRating', 'review', 'reviews', 'offers']);

/** JSON in a <script> data block: `<` is escaped, so no value can end the block. */
export const jsonScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

/** The <script> block for a page's nodes (none: nothing). */
export function ldScript(nodes) {
  const list = (nodes ?? []).filter(Boolean);
  if (!list.length) return '';
  return `<script type="application/ld+json">${jsonScript({ '@context': CONTEXT, '@graph': list })}</script>`;
}

/** An address on the site made absolute (a /path), an https:// one kept, anything else null. */
export const absUrl = (origin, u) => {
  if (typeof u !== 'string' || !u) return null;
  if (/^https:\/\//i.test(u)) return u;
  if (u.startsWith('/') && !u.startsWith('//')) return `${origin}${u}`;
  return null;
};

/** Seconds as an ISO 8601 duration: 75 is PT1M15S. */
export function isoDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  const whole = Math.round(s);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const r = whole % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${r || (!h && !m) ? `${r}S` : ''}`;
}

/** An ISO date-time (or day) as it may go out: parsed and kept as it was, else null. */
const when = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && Number.isFinite(Date.parse(v)) ? v : null);
const uniq = (list) => [...new Set(list.filter(Boolean))];
const text = (v, n = 5000) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, n) : null);
const studioName = (cat) => cat?.studio?.name ?? 'Studio';
const KIND_WORD = { song: 'Song', score: 'Score', loop: 'Loop', stem: 'Stem', sfx: 'Sound', trailer: 'Trailer', 'music-video': 'Music video', cutscene: 'Cutscene', clip: 'Clip' };
const fileOf = (e, role) => (e?.files ?? []).find((f) => f.role === role) ?? null;

/**
 * The owner's extra properties (game.json `schema`, studio.json `site.schema`), on top of Homie's: a key Homie set
 * stays Homie's, a refused key and anything that is not a property name is left out.
 */
export function withExtras(node, extras) {
  if (!extras || typeof extras !== 'object' || Array.isArray(extras)) return node;
  const out = { ...node };
  for (const [k, v] of Object.entries(extras)) {
    if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(k) || SCHEMA_REFUSED.includes(k) || Object.hasOwn(out, k) || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ the studio and its site */

export const studioId = (origin) => `${origin}/#studio`;
export const siteId = (origin) => `${origin}/#website`;

/** The studio as an Organization: in full on Home, else a short reference with its name and address. */
export function studioNode(cat, origin, { full = false } = {}) {
  const node = { '@type': 'Organization', '@id': studioId(origin), name: studioName(cat), url: `${origin}/` };
  if (!full) return node;
  const t = cat?.studio?.theme ?? {};
  const logo = absUrl(origin, t.mark) ?? absUrl(origin, t.icon);
  const image = absUrl(origin, t.social);
  return withExtras({
    ...node,
    ...(logo ? { logo } : {}),
    ...(image ? { image } : {}),
    ...(text(cat?.studio?.tagline) ? { description: text(cat.studio.tagline) } : {}),
  }, cat?.studio?.schema);
}

/** The site itself (Home): its name, address and publisher. There is no site search, so no SearchAction. */
export function websiteNode(cat, origin) {
  return { '@type': 'WebSite', '@id': siteId(origin), name: studioName(cat), url: `${origin}/`, inLanguage: 'en', publisher: { '@id': studioId(origin) } };
}

/** A BreadcrumbList from [name, path] pairs (Home first). */
export function breadcrumbs(origin, trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name: String(name), item: absUrl(origin, path) })),
  };
}

/** An ItemList of pages: [{ name, path }] in the page's order. */
export function itemList(origin, id, name, items) {
  return {
    '@type': 'ItemList', '@id': `${origin}${id}`, name, numberOfItems: items.length,
    itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: absUrl(origin, x.path), name: x.name })),
  };
}

/* ------------------------------------------------------------------ a game */

/** "Remix with credit (MIT)" as a licence: a CreativeWork, linked to the SPDX page when the owner named one. */
export function licenseNode(value) {
  const l = licenseOf(value);
  return { '@type': 'CreativeWork', name: `${LICENSE_KINDS[l.kind]}${l.spdx ? ` (${l.spdx})` : ''}`, ...(l.spdx ? { url: `https://spdx.org/licenses/${encodeURIComponent(l.spdx)}.html` } : {}) };
}

const PLAY_MODE = (mode) => `https://schema.org/${mode}`;

/** The shop's items for a game as Offers (only fixed real-money prices; a tip has none). */
export function shopOffers(shop, g, origin) {
  if (!shop || !Array.isArray(shop.items)) return [];
  const currency = String(shop.currency ?? '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return [];
  const now = Date.now();
  return shop.items
    .filter((i) => (!i.game || i.game === g.id) && Number.isInteger(i.price) && i.price > 0)
    .filter((i) => !(i.ends && Date.parse(i.ends) < now))
    .map((i) => ({
      '@type': 'Offer',
      name: String(i.name ?? i.id),
      ...(text(i.blurb, 300) ? { description: text(i.blurb, 300) } : {}),
      category: String(i.kind ?? 'item'),
      price: Number((i.price / 100).toFixed(2)),
      priceCurrency: currency,
      url: `${origin}/shop/?game=${encodeURIComponent(g.id)}&item=${encodeURIComponent(i.id)}`,
      availability: 'https://schema.org/OnlineOnly',
      ...(when(i.starts) ? { validFrom: i.starts } : {}),
      ...(when(i.ends) ? { validThrough: i.ends } : {}),
    }));
}

/**
 * A game's VideoGame. `listed`: the game is public (a private or invite-only game's landing, which only its owner
 * and invitees see, carries no offer). `shop`: the studio's shop when it is really selling (the Worker's readiness),
 * else null: its items for this game become the free offer's add-ons.
 */
export function gameNode(cat, g, origin, { listed = true, shop = null } = {}) {
  const L = g.landing ?? {};
  const h = L.hero ?? {};
  const page = `${origin}/${g.id}/`;
  const play = `${origin}/${g.id}/play`;
  const min = Number(g.players?.min) || 1;
  const max = Number(g.players?.max) || 8;
  const modes = [...(min <= 1 ? ['SinglePlayer'] : []), ...(max > 1 ? ['MultiPlayer'] : [])];
  const images = uniq([absUrl(origin, h.wideImage), absUrl(origin, h.tallImage), absUrl(origin, L.cover)]);
  const shots = uniq((L.screenshots ?? []).map((u) => absUrl(origin, u)));
  const trailer = L.trailer ? (cat.videos ?? []).find((v) => v.slug === L.trailer) : null;
  const lineage = remixRow(g.remixOf);
  const o = L.credits?.original;
  const based = [
    lineage ? { '@type': 'VideoGame', name: lineage.name, ...(lineage.page ? { url: lineage.page } : {}), ...(lineage.studio ? { creditText: `${lineage.name} by ${lineage.studio}` } : {}) } : null,
    o && !o.house && o.title ? { '@type': 'VideoGame', name: o.title, ...(o.url ? { url: o.url } : {}), ...(o.author ? { creditText: `${o.title} by ${o.author}${o.year ? ` (${o.year})` : ''}${o.licence ? `, ${o.licence} licence` : ''}` } : {}) } : null,
  ].filter(Boolean);
  // The studio by name and address, not only its @id: a page is read on its own, and Home is where it is in full.
  const studio = studioNode(cat, origin);
  const addOn = listed ? shopOffers(shop, g, origin) : [];
  const genre = (Array.isArray(g.genre) ? g.genre : g.genre ? [g.genre] : []).map((x) => text(x, 40)).filter(Boolean);
  const node = {
    '@type': ['VideoGame', 'WebApplication'],
    '@id': `${page}#game`,
    name: g.name,
    ...(text(g.blurb ?? L.pitch) ? { description: text(g.blurb || L.pitch) } : {}),
    ...(text(L.pitch) && text(L.pitch) !== text(g.blurb) ? { abstract: text(L.pitch) } : {}),
    url: page,
    ...(images.length ? { image: images.length === 1 ? images[0] : images } : {}),
    ...(shots.length ? { screenshot: shots } : {}),
    ...(genre.length ? { genre: genre.length === 1 ? genre[0] : genre } : {}),
    playMode: modes.map(PLAY_MODE),
    numberOfPlayers: { '@type': 'QuantitativeValue', minValue: min, maxValue: max },
    gamePlatform: ['Web browser', 'Phone', 'Computer', ...(L.tv !== false ? ['TV'] : [])],
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any',
    browserRequirements: 'A modern web browser with JavaScript',
    isAccessibleForFree: true,
    author: studio,
    publisher: studio,
    license: licenseNode(g.license),
    ...(based.length ? { isBasedOn: based.length === 1 ? based[0] : based } : {}),
    ...(trailer ? { trailer: videoNode(cat, trailer, origin, { nested: true }) } : {}),
    ...(when(g.dates?.published) ? { datePublished: g.dates.published } : {}),
    ...(when(g.dates?.modified) ? { dateModified: g.dates.modified } : {}),
    potentialAction: { '@type': 'PlayAction', target: play },
    ...(listed ? { offers: { '@type': 'Offer', price: 0, priceCurrency: /^[A-Z]{3}$/.test(String(shop?.currency ?? '').toUpperCase()) ? String(shop.currency).toUpperCase() : 'USD', availability: 'https://schema.org/OnlineOnly', url: play, ...(addOn.length ? { addOn } : {}) } } : {}),
  };
  return withExtras(node, g.schema);
}

/* ------------------------------------------------------------------ music and videos */

/** A song's MusicRecording: the studio is its artist; its audio file, duration, cover, album and date. */
export function songNode(cat, e, origin, { art = null } = {}) {
  const page = `${origin}/music/${e.slug}/`;
  const audio = fileOf(e, 'audio');
  const name = studioName(cat);
  const artist = { '@type': 'MusicGroup', name, url: `${origin}/` };
  const duration = isoDuration(e.duration);
  const image = absUrl(origin, art);
  const date = when(e.date) ?? when(e.made?.at);
  return {
    '@type': 'MusicRecording',
    '@id': `${page}#recording`,
    name: e.title,
    url: page,
    ...(text(e.blurb) ? { description: text(e.blurb) } : {}),
    byArtist: artist,
    publisher: studioNode(cat, origin),
    ...(duration ? { duration } : {}),
    ...(image ? { image } : {}),
    ...(audio?.url ? { audio: { '@type': 'AudioObject', contentUrl: absUrl(origin, audio.url), ...(audio.type ? { encodingFormat: audio.type } : {}), ...(duration ? { duration } : {}) } } : {}),
    ...(date ? { datePublished: date } : {}),
    ...(text(e.album, 120) ? { inAlbum: { '@type': 'MusicAlbum', name: text(e.album, 120), byArtist: artist } } : {}),
    ...(text(e.key, 40) ? { recordingOf: { '@type': 'MusicComposition', name: e.title, musicalKey: text(e.key, 40) } } : {}),
    ...(text(e.credits, 600) ? { creditText: text(e.credits, 600) } : {}),
  };
}

/** A video's VideoObject: what Google asks for (name, thumbnailUrl, uploadDate) and the file itself (contentUrl). */
export function videoNode(cat, e, origin, { art = null, nested = false } = {}) {
  const page = `${origin}/videos/${e.slug}/`;
  const video = fileOf(e, 'video');
  const duration = isoDuration(e.duration);
  const poster = absUrl(origin, art ?? fileOf(e, 'poster')?.url);
  const date = when(e.date) ?? when(e.made?.at);
  const game = e.for?.game ? (cat.games ?? []).find((g) => g.id === e.for.game) : null;
  return {
    '@type': 'VideoObject',
    '@id': `${page}#video`,
    name: e.title,
    description: text(e.blurb) ?? `${KIND_WORD[e.kind] ?? 'Video'} from ${studioName(cat)}.`,
    url: page,
    ...(poster ? { thumbnailUrl: [poster] } : {}),
    ...(date ? { uploadDate: date } : {}),
    ...(duration ? { duration } : {}),
    ...(video?.url ? { contentUrl: absUrl(origin, video.url), ...(video.type ? { encodingFormat: video.type } : {}) } : {}),
    ...(nested ? {} : { publisher: studioNode(cat, origin) }),
    creator: { '@type': 'Organization', name: studioName(cat), url: `${origin}/` },
    ...(game && !nested ? { about: { '@type': 'VideoGame', '@id': `${origin}/${game.id}/#game`, name: game.name, url: `${origin}/${game.id}/` } } : {}),
  };
}

/** /music/: a MusicAlbum when every song names the same album, else an ItemList of the songs' pages. */
export function musicIndexNode(cat, origin, songs, { art = () => null } = {}) {
  const album = songs.length && songs.every((e) => text(e.album, 120) && text(e.album, 120) === text(songs[0].album, 120)) ? text(songs[0].album, 120) : null;
  if (!album) return itemList(origin, '/music/#list', `Music from ${studioName(cat)}`, songs.map((e) => ({ name: e.title, path: `/music/${e.slug}/` })));
  const cover = absUrl(origin, art(songs[0]));
  return {
    '@type': 'MusicAlbum', '@id': `${origin}/music/#album`, name: album, url: `${origin}/music/`,
    byArtist: { '@type': 'MusicGroup', name: studioName(cat), url: `${origin}/` },
    ...(cover ? { image: cover } : {}),
    numTracks: songs.length,
    track: songs.map((e) => ({ '@type': 'MusicRecording', name: e.title, url: `${origin}/music/${e.slug}/`, ...(isoDuration(e.duration) ? { duration: isoDuration(e.duration) } : {}) })),
  };
}

/* ------------------------------------------------------------------ posts */

const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** A post's author: a person it names (frontmatter `author:`), else the studio. */
function authorOf(cat, p, origin) {
  return p.author && !sameName(p.author, studioName(cat)) ? { '@type': 'Person', name: String(p.author) } : studioNode(cat, origin);
}

export function postNode(cat, p, origin, { image = null } = {}) {
  const page = `${origin}/posts/${p.slug}/`;
  const game = p.links?.game ? (cat.games ?? []).find((g) => g.id === p.links.game) : null;
  const img = absUrl(origin, image ?? p.image);
  return {
    '@type': 'BlogPosting',
    '@id': `${page}#post`,
    headline: String(p.title).slice(0, 110),
    ...(text(p.summary) ? { description: text(p.summary) } : {}),
    url: page,
    mainEntityOfPage: page,
    ...(img ? { image: [img] } : {}),
    ...(when(p.date) ? { datePublished: p.date } : {}),
    ...(when(p.updated ?? p.date) ? { dateModified: p.updated ?? p.date } : {}),
    author: authorOf(cat, p, origin),
    publisher: studioNode(cat, origin),
    isPartOf: { '@type': 'Blog', '@id': `${origin}/posts/#blog` },
    ...(game ? { about: { '@type': 'VideoGame', '@id': `${origin}/${game.id}/#game`, name: game.name, url: `${origin}/${game.id}/` } } : {}),
  };
}

/** /posts/: the studio's Blog, with each post's headline, address and dates. */
export function blogNode(cat, origin, posts) {
  return {
    '@type': 'Blog', '@id': `${origin}/posts/#blog`, name: `${studioName(cat)}: posts`, url: `${origin}/posts/`,
    publisher: studioNode(cat, origin),
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting', headline: String(p.title).slice(0, 110), url: `${origin}/posts/${p.slug}/`,
      ...(when(p.date) ? { datePublished: p.date } : {}), ...(when(p.updated ?? p.date) ? { dateModified: p.updated ?? p.date } : {}),
      author: authorOf(cat, p, origin),
    })),
  };
}
