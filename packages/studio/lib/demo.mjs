/**
 * `homie-studio demo` — "see a working game" with nothing copied into the studio: a live multiplayer game on Homie
 * Arcade (arcade.homie.rocks), the house's own studio of small public games, made with this same toolkit. Press Play
 * and you are in a live public room with whoever is playing, bots in the empty seats; open it in two tabs (or a
 * phone and a computer) and you are two players in the same room.
 *
 * A new studio starts with no game (its home page says "First game coming soon"). A starter is copied INTO the
 * studio only when the person asks for one: `homie-studio game new <id> --from gem-rush`.
 *
 * It reads the arcade's own public manifest (/.well-known/homie-studio.json) and its live rooms (/api/rooms), so the
 * links are the ones live right now; when the arcade does not answer, it names its usual first pick. Read-only.
 */
import { STUDIO_VERSION } from './version.mjs';

export const DEMO_STUDIO = 'https://arcade.homie.rocks';
/** The arcade's games that show a stranger the most in a minute, in order. */
export const DEMO_PICKS = ['asteroids-arena', 'bone-burglar', 'tiny-platformer', '2048-race', 'octree-arena'];
export const DEMO_FALLBACK = Object.freeze({
  id: 'asteroids-arena', name: 'Asteroids Arena', blurb: 'Up to six ships on one wrap-around rock field. Top score in two minutes wins.',
  page: `${DEMO_STUDIO}/asteroids-arena/`, play: `${DEMO_STUDIO}/asteroids-arena/play`, cover: null, players: { min: 1, max: 6 },
});

const HOW = 'Open Play in two browser tabs, or on a phone and a computer: you are two players in the same live public room, and bots fill the empty seats. Keys on a computer, touch on a phone.';
const COPY = 'Want a working game inside your own studio instead? Only when you ask: `npx --no-install homie-studio game new <id> --from gem-rush` copies the Gem Rush starter (an arena: rounds, bots, one readable file), or `--from ember-vale` the Ember Vale starter (a hero who lasts for days, with cloud saves), into games/<id>/.';

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const onSite = (url, site) => (typeof url === 'string' && url.startsWith(`${site}/`) ? url : null);

async function getJson(fetchFn, url, ms) {
  const res = await fetchFn(url, { headers: { accept: 'application/json', 'user-agent': `homie-studio/${STUDIO_VERSION} (demo)` }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

export async function demoGames({ fetchFn = globalThis.fetch, studio = DEMO_STUDIO, timeoutMs = 6000 } = {}) {
  const site = String(studio).replace(/\/+$/, '');
  let manifest = null; let rooms = null; let why = null;
  try {
    [manifest, rooms] = await Promise.all([
      getJson(fetchFn, `${site}/.well-known/homie-studio.json`, timeoutMs),
      getJson(fetchFn, `${site}/api/rooms`, timeoutMs).catch(() => null),
    ]);
  } catch (error) { why = error?.message ?? String(error); }
  const live = new Map();
  for (const r of Array.isArray(rooms?.rooms) ? rooms.rooms : []) {
    const id = text(r?.game, 40);
    if (id) live.set(id, (live.get(id) ?? 0) + (Number(r?.players) || 0));
  }
  const listed = (Array.isArray(manifest?.games) ? manifest.games : [])
    .map((g) => ({
      id: text(g?.id, 40), name: text(g?.name, 60), blurb: text(g?.blurb, 200),
      page: onSite(g?.page, site), play: onSite(g?.play, site), cover: onSite(g?.cover, site),
      players: g?.players && Number.isFinite(g.players.max) ? { min: Number(g.players.min) || 1, max: Number(g.players.max) } : null,
    }))
    .filter((g) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(g.id) && g.play);
  const rank = (g) => { const i = DEMO_PICKS.indexOf(g.id); return i < 0 ? DEMO_PICKS.length : i; };
  // A game people are playing right now goes first: that is the best demo of all.
  const games = listed.map((g) => ({ ...g, playingNow: live.get(g.id) ?? 0 }))
    .sort((a, b) => (b.playingNow > 0) - (a.playingNow > 0) || rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, 5);
  const pick = games[0] ?? { ...DEMO_FALLBACK, playingNow: 0 };
  return {
    ok: true, command: 'demo',
    studio: { name: text(manifest?.name, 60) || 'Homie Arcade', site },
    pick, games: games.length ? games : [pick],
    ...(why ? { note: `the arcade did not answer just now (${why}); this is its usual first pick` } : {}),
    how: HOW, copy: COPY,
  };
}

/** The demo as a person reads it in a terminal. */
export function formatDemo(r) {
  const p = r.pick;
  return [
    `See a working game: ${p.name} on ${r.studio.name}${p.playingNow ? ` (${p.playingNow} playing right now)` : ''}`,
    `  Play: ${p.play}`,
    ...(p.blurb ? [`  ${p.blurb}`] : []),
    '',
    r.how,
    ...(r.games.length > 1 ? ['', 'More to try:', ...r.games.slice(1).map((g) => `  ${g.name}: ${g.play}`)] : []),
    ...(r.note ? ['', `(${r.note})`] : []),
    '',
    r.copy,
  ].join('\n');
}
