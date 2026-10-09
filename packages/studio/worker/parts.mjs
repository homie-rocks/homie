/**
 * THE STUDIO'S SHARED GAME PARTS, AS ITS SITE SERVES THEM (parts/PARTS.md section 4).
 *
 *   /.well-known/homie-parts.json     what the hub and `parts add` read: the shared parts, each with the game it came from
 *   /parts/<id>/<version>/<file>      a packed version's files, exactly as hashed: immutable, CORS open for GET
 *   /parts/  and  /parts/<id>/        the studio's own pages, in its own look: the list, and one part with its preview
 *   a game's landing                  a "Parts from this game" band of its own (partsBand)
 *
 * A PRIVATE PART IS NEVER REACHABLE. Two things hold that: the build copies only shared parts into the site
 * (lib/parts-build.mjs), and nothing here answers a file the built index does not name, so a file that reached the
 * assets some other way is still not served from /parts/.
 */
import { esc, icon, layout, notFoundPage } from './site.mjs';

const PART_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/;
/** A packed part's files: framed by the part's own page and by the hub, so they keep their own frame rule (index.mjs finish). */
export const PART_FILES = /^\/parts\/[a-z0-9][a-z0-9-]{0,47}\/\d{1,6}\.\d{1,6}\.\d{1,6}[^/]*\//;
export const PARTS_WELL_KNOWN = '/.well-known/homie-parts.json';
export const isPartsPath = (path) => path === PARTS_WELL_KNOWN || path === '/parts' || path.startsWith('/parts/');

const CORS = { 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const TYPES = { html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', ts: 'text/plain; charset=utf-8', tsx: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8', css: 'text/css; charset=utf-8', md: 'text/plain; charset=utf-8', txt: 'text/plain; charset=utf-8', glsl: 'text/plain; charset=utf-8', wgsl: 'text/plain; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', woff2: 'font/woff2', ktx2: 'image/ktx2', hdr: 'application/octet-stream' };

/** The built index (site/dist/parts/index.json): only shared parts are ever in it. An older build has none. */
export async function partsIndex(env, origin) {
  try {
    const res = await env.ASSETS.fetch(new Request(`${origin}/parts/index.json`));
    if (!res.ok) return { v: 1, studio: {}, parts: [] };
    const body = await res.json();
    return body && Array.isArray(body.parts) ? body : { v: 1, studio: {}, parts: [] };
  } catch { return { v: 1, studio: {}, parts: [] }; }
}

/**
 * One index entry as the world sees it: how to add it, and the game it came out of with its page and Play address.
 * Only a PUBLIC game is named (a private or invite-only game's parts are still shared, without saying where from).
 */
function entryOf(p, cat, url) {
  const g = (p.from?.game ?? p.from?.app) ? (cat.games ?? []).find((x) => x.id === (p.from.game ?? p.from.app)) : null;
  const { from, ...rest } = p;
  return {
    ...rest,
    ...(!g && from && (from.music || from.video) ? { from: { ...(from.music ? { music: from.music } : { video: from.video }), name: from.name ?? null, studio: from.studio ?? null } } : {}),
    ...(g ? { from: { [g.kind === 'app' ? 'app' : 'game']: g.id, name: g.name ?? g.id, studio: cat.studio?.name ?? from.studio ?? null, page: `${url.origin}/${g.id}/`, [g.kind === 'app' ? 'open' : 'play']: `${url.origin}/${g.id}/${g.kind === 'app' ? 'open' : 'play'}` } } : {}),
    add: `${url.host}/${p.id}`,
  };
}

export async function partsRoutes(request, env, url, { catalogueOf }) {
  const path = url.pathname;
  const read = request.method === 'GET' || request.method === 'HEAD';
  if (path === PARTS_WELL_KNOWN) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, HEAD' } });
    if (!read) return json({ ok: false, error: 'method' }, 405, { allow: 'GET, HEAD', ...CORS });
    const [index, cat] = await Promise.all([partsIndex(env, url.origin), catalogueOf()]);
    return json({ v: 1, studio: { name: cat.studio?.name ?? index.studio?.name ?? null, url: url.origin }, parts: index.parts.map((p) => entryOf(p, cat, url)) }, 200, { ...CORS, 'cache-control': 'public, max-age=300' });
  }
  const segs = path.split('/').filter(Boolean);
  // /parts/<id>/<version>/<file…>: a packed file, only when the index names that part and that version.
  if (segs.length >= 4 && PART_ID.test(segs[1]) && VERSION.test(segs[2])) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, HEAD' } });
    if (!read) return new Response('GET only', { status: 405, headers: { allow: 'GET, HEAD', ...CORS } });
    const index = await partsIndex(env, url.origin);
    const part = index.parts.find((p) => p.id === segs[1]);
    let file;
    try { file = segs.slice(3).map(decodeURIComponent).join('/'); } catch { file = '..'; }
    const gone = () => new Response('not found', { status: 404, headers: { ...CORS, 'cache-control': 'no-store' } });
    if (!part || !(part.versions ?? []).includes(segs[2]) || file.split('/').some((s) => !s || s === '..' || s.startsWith('.'))) return gone();
    const res = await env.ASSETS.fetch(new Request(`${url.origin}/parts/${segs[1]}/${segs[2]}/${file.split('/').map(encodeURIComponent).join('/')}`));
    if (!res.ok) return gone();
    const ext = file.split('.').pop().toLowerCase();
    const html = ext === 'html' || ext === 'htm';
    return new Response(request.method === 'HEAD' ? null : res.body, {
      headers: {
        'content-type': TYPES[ext] ?? 'application/octet-stream',
        // A version's bytes never change (lib/parts.mjs packPart refuses), so a year and immutable is true.
        'cache-control': `public, max-age=31536000, immutable${html ? ', no-transform' : ''}`,
        ...CORS,
        // A preview page runs with no origin of its own: none of this site's cookies or storage, framable anywhere.
        ...(html ? { 'content-security-policy': 'sandbox allow-scripts allow-pointer-lock' } : {}),
      },
    });
  }
  if (!read) return null;
  const cat = await catalogueOf();
  // A game called "parts" keeps its own address; its studio's parts are still in the well-known file.
  if ((cat.games ?? []).some((g) => g.id === 'parts')) return null;
  if (path === '/parts') return Response.redirect(`${url.origin}/parts/`, 301);
  const index = await partsIndex(env, url.origin);
  const parts = index.parts.map((p) => entryOf(p, cat, url));
  if (path === '/parts/') return parts.length ? partsPage(cat, parts, url) : notFoundPage('This studio shares no game parts yet.', cat);
  if (segs.length === 2 && PART_ID.test(segs[1])) {
    const part = parts.find((p) => p.id === segs[1]);
    // The same answer for a private part and one that never existed: nothing says which.
    if (!part) return notFoundPage('There is no shared part at this address.', cat);
    if (!path.endsWith('/')) return Response.redirect(`${url.origin}/parts/${part.id}/`, 301);
    return partPage(cat, part, url);
  }
  return notFoundPage('There is no shared part at this address.', cat);
}

/* ------------------------------------------------------------------ the pages */

const KIND_WORDS = { character: 'Character', rig: 'Rig', clips: 'Animation clips', environment: 'Environment', effect: 'Effect', sound: 'Sound', ui: 'UI', mechanic: 'Mechanic', shader: 'Shader', 'level-generator': 'Level generator', 'bot-brain': 'Bot brain', 'audio-pack': 'Audio pack', 'set-piece': 'Set piece' };
const kindOf = (p) => KIND_WORDS[p.kind] ?? 'Part';
const CSS = `<style>
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;margin:8px 0 0;padding:0;list-style:none}
.pcard{display:flex;flex-direction:column;gap:8px;padding:18px;border:1px solid color-mix(in srgb,var(--fg) 14%,transparent);border-radius:16px;text-decoration:none;color:inherit;background:color-mix(in srgb,var(--fg) 3%,transparent)}
.pcard:hover{border-color:var(--fg)}
.pcard img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px}
.pcard h3{margin:0;font:800 19px/1.2 var(--display)}
.pcard p{margin:0;color:var(--dim);font-size:14px}
.ptag{font:600 11px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.pframe{display:block;width:100%;aspect-ratio:16/9;border:1px solid color-mix(in srgb,var(--fg) 14%,transparent);border-radius:16px;background:#000}
.pview{container-type:inline-size}
.pview .pframe{aspect-ratio:var(--pv,16/9)}
@container (max-width:599.98px){.pview .pframe{min-height:min(320px,70vh);min-height:min(320px,70svh)}.pview.pview-own .pframe{aspect-ratio:var(--pvn,var(--pv,16/9));min-height:0}}
.popen{display:inline-flex;align-items:center;gap:8px;min-height:44px;margin:8px 0 0;color:inherit;font-weight:600;text-decoration:underline;text-underline-offset:3px}
.popen svg{width:16px;height:16px}
.popen:focus-visible{outline:3px solid var(--fg);outline-offset:3px;border-radius:6px}
.pfacts{display:grid;grid-template-columns:max-content 1fr;gap:8px 20px;margin:0}
.pfacts dt{color:var(--dim);font-size:14px}.pfacts dd{margin:0;overflow-wrap:anywhere}
.pband{max-width:calc(1180px + 2 * var(--gutter));margin:0 auto;padding:clamp(40px,6vw,80px) var(--gutter)}
.pband h2{margin:6px 0 10px;font:800 clamp(28px,4vw,44px)/1.05 var(--display)}
.pband .plead,.plead{max-width:62ch;color:var(--dim);margin:0 0 18px}
.psay{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:18px 0;padding:14px 16px;border:1px solid color-mix(in srgb,var(--fg) 14%,transparent);border-radius:14px}
.psay code{display:block;margin-top:4px;font:500 15px/1.4 var(--mono);overflow-wrap:anywhere}
.pcopy{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 14px;border:1px solid color-mix(in srgb,var(--fg) 24%,transparent);border-radius:10px;background:none;color:inherit;font:600 14px/1 var(--body,inherit);cursor:pointer}
.pcopy svg{width:16px;height:16px}
</style>`;
const head = (kicker, title, lead, extra = '') => `<header class="head"><p class="kicker">${esc(kicker)}</p><h1>${esc(title)}</h1>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}${extra}</header>`;
const studioOf = (cat) => cat.studio?.name ?? 'Studio';
const fromLine = (p) => ((p.from?.game ?? p.from?.app) ? `From <a href="/${esc((p.from.game ?? p.from.app))}/">${esc(p.from.name ?? (p.from.game ?? p.from.app))}</a>` : '');
/** What a person says to their AI to get the part, in plain words with its name and reference: no command to type. */
const sayAdd = (p) => `Add the "${p.name}" part from ${p.add} to my game`;
const sayRow = (label, say) => `<div class="psay"><div><span class="ptag">${esc(label)}</span><code>${esc(say)}</code></div><button class="pcopy" type="button" data-copy="${esc(say)}">${icon('copy')}<span data-copy-word>Copy</span></button></div>`;

function card(p) {
  const img = p.preview?.image ? `<img src="${esc(`${p.url}${p.preview.image}`)}" alt="" loading="lazy">` : '';
  return `<li><a class="pcard" href="/parts/${esc(p.id)}/">${img}<span class="ptag">${esc(kindOf(p))} · ${esc(p.license ?? '')}</span><h3>${esc(p.name)}</h3><p>${esc(p.summary ?? '')}</p>${(p.from?.game ?? p.from?.app) ? `<p>From ${esc(p.from.name ?? (p.from.game ?? p.from.app))}</p>` : ''}</a></li>`;
}

export function partsPage(cat, parts, url) {
  const name = studioOf(cat);
  // Grouped by the game each came out of: a mashup starts from "the creature in that game".
  const groups = new Map();
  for (const p of parts) { const k = (p.from?.game ?? p.from?.app) ?? ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const body = [...groups].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))).map(([k, list]) => `<p class="sec"${k ? ` id="from-${esc(k)}"` : ''}>${k ? `From ${esc(list[0].from.name ?? k)}` : 'More parts'}</p><ul class="pgrid">${list.map(card).join('')}</ul>`).join('');
  return layout(cat, {
    title: `Game parts · ${name}`, description: `Pieces of ${name}'s games that other studios can use in their own: creatures, levels, mechanics, sounds. Each with its licence.`, origin: url.origin, path: '/parts/', page: 'parts', head: CSS,
    main: `${head('Game parts', 'Take a piece, make a game', `Pieces of ${name}'s games, shared one by one. Take the creature from one game, the level from another and the bot brain from a third, and make something new. Each part says its licence and who to credit.`)}
<div class="wrap">${body}</div>`,
  });
}

function requiresRows(p) {
  const r = p.requires ?? {};
  const rows = [];
  for (const [k, v] of Object.entries(r.packages && typeof r.packages === 'object' ? r.packages : {})) rows.push(`${esc(k)} ${esc(v)} (a package, from npm)`);
  for (const x of Array.isArray(r.parts) ? r.parts : []) rows.push(`${esc(x)} (another part)`);
  return rows;
}
function costLine(c) {
  if (!c || typeof c !== 'object') return '';
  const bits = [];
  if (Number.isFinite(c.bytes)) bits.push(`${c.bytes >= 1048576 ? `${(c.bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(c.bytes / 1024))} KB`} to download`);
  if (Number.isFinite(c.triangles)) bits.push(`${c.triangles.toLocaleString('en')} triangles`);
  if (Number.isFinite(c.drawCalls)) bits.push(`${c.drawCalls} draw calls`);
  if (Number.isFinite(c.textureMB)) bits.push(`${c.textureMB} MB of textures`);
  return `${bits.join(' · ')}${c.measuredOn ? ` (measured on ${String(c.measuredOn).slice(0, 80)})` : ''}`;
}

/**
 * A preview's declared shape ("4:3") as two whole numbers, or null. The same reading as previewAspect() in
 * lib/parts.mjs (a Worker cannot import that file: it reads the disk); test/parts.test.mjs holds the two together.
 * The page's CSS is built from these NUMBERS, never from the text in part.json, so nothing a part declares can
 * write CSS or HTML of its own.
 */
export function aspectOf(value) {
  const m = typeof value === 'string' ? /^([1-9]\d?):([1-9]\d?)$/.exec(value) : null;
  if (!m) return null;
  const w = Number(m[1]); const h = Number(m[2]);
  return w > 32 || h > 32 || w > 3 * h || h > 2 * w ? null : { w, h };
}

/**
 * The part's interactive preview: its frame in the shape the part declares, and a plain link out of the frame.
 *
 * THE SHAPE. `preview.aspect` (default 16:9), and `preview.phoneAspect` when the frame is under 600 px wide. With no
 * phone shape declared a narrow frame still gets a minimum height: 16:9 across a 390 px phone is about 197 px,
 * which hides whatever a preview draws under its heading and controls.
 *
 * THE LINK opens the same preview file in a tab of its own, at the size of the screen. That file is this studio's
 * own packed part on this studio's own address, and it is answered with `content-security-policy: sandbox
 * allow-scripts allow-pointer-lock` (above), so a tab of its own gives it nothing the frame did not: no origin, so
 * none of the site's cookies or storage, no forms, no pop-ups, no navigating the page that opened it (and
 * rel="noopener" gives it no handle on that page either). It is a link, so it needs no script and a keyboard reaches it.
 */
function previewOf(p) {
  const src = esc(`${p.url}${p.preview.page}`);
  const shape = aspectOf(p.preview.aspect) ?? { w: 16, h: 9 };
  const phone = aspectOf(p.preview.phoneAspect);
  const vars = `--pv:${Number(shape.w)}/${Number(shape.h)}${phone ? `;--pvn:${Number(phone.w)}/${Number(phone.h)}` : ''}`;
  return `<div class="pview${phone ? ' pview-own' : ''}" style="${vars}"><iframe class="pframe" title="${esc(p.name)}: try it" src="${src}" sandbox="allow-scripts allow-pointer-lock" loading="lazy" referrerpolicy="no-referrer"></iframe></div>
<a class="popen" href="${src}" target="_blank" rel="noopener noreferrer">${icon('arrow')}<span>Open the preview in its own tab</span></a>`;
}

export function partPage(cat, p, url) {
  const name = studioOf(cat);
  const preview = p.preview?.page
    ? previewOf(p)
    : p.preview?.image ? `<img class="pframe" src="${esc(`${p.url}${p.preview.image}`)}" alt="${esc(p.name)}">` : '';
  const facts = [
    ['Kind', esc(kindOf(p))],
    p.uses?.length ? ['For', esc(p.uses.join(', '))] : null,
    (p.from?.game ?? p.from?.app) ? [p.from.app ? 'From the app' : 'From the game', `<a href="/${esc((p.from.game ?? p.from.app))}/">${esc(p.from.name ?? (p.from.game ?? p.from.app))}</a> · <a href="/${esc((p.from.game ?? p.from.app))}/${p.from.app ? 'open' : 'play'}">${p.from.app ? 'Open it' : 'Play it'}</a>`] : null,
    ['Licence', `${esc(p.license ?? 'none named')}${p.license && !/^LicenseRef-/.test(p.license) ? ` · <a href="https://spdx.org/licenses/${esc(p.license)}.html" rel="noopener">what it allows</a>` : ''}`],
    p.attribution ? ['Credit', esc(p.attribution)] : null,
    ['Version', `${esc(p.version)}${(p.versions ?? []).length > 1 ? ` (also ${esc(p.versions.filter((v) => v !== p.version).join(', '))})` : ''}`],
    requiresRows(p).length ? ['Builds on', requiresRows(p).join('<br>')] : null,
    costLine(p.cost) ? ['Costs', esc(costLine(p.cost))] : null,
    p.physical ? ['Size', esc([p.physical.units ? `in ${p.physical.units}` : '', Number.isFinite(p.physical.scale) ? `scale ${p.physical.scale}` : '', p.physical.pivot ? `pivot at the ${p.physical.pivot}` : '', p.physical.collision ? 'with collision data' : ''].filter(Boolean).join(', '))] : null,
    p.skeleton?.rig ? ['Skeleton', esc(`${p.skeleton.rig}${(p.skeleton.clips ?? []).length ? `: ${p.skeleton.clips.join(', ')}` : ''}`)] : null,
    p.contract?.netplay ? ['In a room', esc({ 'host-authoritative': 'the host decides; everyone else is shown the result', replicated: 'every player runs it from shared state', local: 'each screen runs its own' }[p.contract.netplay] ?? p.contract.netplay)] : null,
    p.provenance?.source ? ['Made', esc({ original: `by ${name}`, generated: `generated on ${name}'s own account`, imported: `brought in by ${name}${p.provenance.origin ? ` from ${p.provenance.origin}` : ''}` }[p.provenance.source] ?? p.provenance.source)] : null,
    (p.tags ?? []).length ? ['Tags', esc(p.tags.join(', '))] : null,
  ].filter(Boolean);
  return layout(cat, {
    title: `${p.name} · a game part from ${name}`, description: `${p.summary ?? ''} A ${kindOf(p).toLowerCase()} from ${name}${p.from?.name ? `'s ${p.from.name}` : ''}, shared under ${p.license ?? 'its own terms'}.`.trim(), origin: url.origin, path: `/parts/${p.id}/`, page: 'part', head: CSS,
    image: p.preview?.image ? `${p.url}${p.preview.image}` : null,
    main: `${head(`${kindOf(p)} · shared part`, p.name, p.summary ?? '', `<div class="keys"><a class="ghost" href="/parts/">${icon('arrow')}<span>All parts</span></a>${(p.from?.game ?? p.from?.app) ? `<a class="ghost" href="/${esc((p.from.game ?? p.from.app))}/${p.from.app ? 'open' : 'play'}">${icon('games')}<span>${p.from.app ? 'Open' : 'Play'} ${esc(p.from.name ?? (p.from.game ?? p.from.app))}</span></a>` : ''}</div>`)}
<div class="wrap">
${preview ? `<p class="sec">Try it</p>${preview}` : ''}
<p class="sec">Use it in your game</p>
<p class="plead">In a chat with your Homie studio open, ask for it by name:</p>
${sayRow('Say', sayAdd(p))}
<p class="plead">Your AI fetches the files, checks every one, copies them into your studio and credits ${esc(name)} in your game. They are yours to tune from there.</p>
<p class="sec">About this part</p>
<dl class="pfacts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
</div>`,
  });
}

/* ------------------------------------------------------------------ a game's landing: "Parts from this game" */

/**
 * A band of its own on a game's landing: the SHARED parts that came out of this game, and what to ask an AI for to
 * build something new from them. Empty when the game shared none. It stands by itself: its own markup and styles.
 */
export function partsBand(g, parts, host) {
  const mine = parts.filter((p) => (p.from?.game ?? p.from?.app) === g.id);
  if (!mine.length) return '';
  const say = mine.length === 1 ? sayAdd({ ...mine[0], add: `${host}/${mine[0].id}` }) : `Make a new game in my Homie studio with these parts of ${g.name}: ${mine.slice(0, 4).map((p) => `${host}/${p.id}`).join(', ')}`;
  return `${CSS}<section class="pband" aria-labelledby="parts-title" data-parts-band>
  <p class="ptag">Take a piece</p>
  <h2 id="parts-title">Parts from this game</h2>
  <p class="plead">Pieces of ${esc(g.name)} you can put in a game of your own, each with its licence. Mix them with parts from other games: a creature from here, a level from there.</p>
  <ul class="pgrid">${mine.map(card).join('')}</ul>
  ${sayRow('In a chat with your Homie studio open, say', say)}
  <div class="keys"><a class="btn" href="/parts/#from-${esc(g.id)}">${icon('spark')}<span>See the parts</span></a></div>
</section>`;
}

/** A game's landing with its parts band, when it has shared parts (worker/index.mjs calls this on the landing it built). */
export async function withPartsBand(res, env, url, g) {
  try {
    if (!res || res.status !== 200 || !/text\/html/i.test(res.headers.get('content-type') ?? '')) return res;
    const index = await partsIndex(env, url.origin);
    const band = partsBand(g, index.parts.map((p) => ({ ...p, from: (p.from?.game ?? p.from?.app) === g.id ? { ...p.from, name: g.name } : p.from })), url.host);
    if (!band) return res;
    const html = await res.text();
    const at = html.lastIndexOf('</main>');
    return new Response(at < 0 ? html : `${html.slice(0, at)}${band}\n${html.slice(at)}`, { status: res.status, headers: res.headers });
  } catch { return res; }
}
