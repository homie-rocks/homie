// A host may serve a studio to one viewer under a path of its own (worker/link-base.mjs): a private preview lets in
// only addresses under its pass path, so the shared links, the television's join code, the landing's phone code, the
// game frame and its room sockets start with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkBase, withLinkBase, LINK_BASE_HEADER } from '../worker/link-base.mjs';
import { playPage, watchPage } from '../worker/pages.mjs';
import { gameLanding } from '../worker/site.mjs';

const cat = { studio: { name: 'Party', theme: { bg: '#05070d', fg: '#dffcff', accent: '#ff3bd4', scheme: 'dark' } }, games: [] };
const game = { id: 'party', name: 'Party', blurb: 'Everyone plays.', players: { max: 8 } };
const req = (value) => new Request('https://preview-party.example/party/play', { headers: value === undefined ? {} : { [LINK_BASE_HEADER]: value } });
const BASE = '/__homie_preview/rtn1j52.b3iNLyyzN_PNs7h-VFmyg';

test('the host\'s base is read only as an absolute path, and put in front of an address\'s path', () => {
  assert.equal(linkBase(req(BASE)), BASE);
  for (const bad of [undefined, '', 'relative', '/a/../b', '/./x', '//evil.example', '/a b', '/' + 'x'.repeat(300), 'https://evil.example/x']) assert.equal(linkBase(req(bad)), '', String(bad));
  assert.equal(withLinkBase('https://h.example/party/play?room=ABCD', BASE), `https://h.example${BASE}/party/play?room=ABCD`);
  assert.equal(withLinkBase('/party/__game/?room=A', BASE), `${BASE}/party/__game/?room=A`);
  assert.equal(withLinkBase('https://h.example/party/play?room=ABCD', ''), 'https://h.example/party/play?room=ABCD', 'no base, no change');
});

test('the play and watch pages start their links, frame and sockets with the base; a studio with none is unchanged', async () => {
  const page = await playPage(cat, game, { origin: 'https://preview-party.example', linkBase: BASE }).text();
  assert.ok(page.includes(`"linkBase":"${BASE}"`));
  assert.match(page, /location\.origin \+ \(boot\.linkBase \|\| ''\) \+ '\/' \+ boot\.game/, 'the shared link');
  assert.match(page, /return \(boot\.linkBase \|\| ''\) \+ '\/' \+ boot\.game \+ '\/__game\/\?'/, 'the game frame');
  assert.match(page, /location\.host \+ \(boot\.linkBase \|\| ''\) \+ '\/' \+ boot\.game \+ '\/__watch/, 'the room socket');
  assert.ok((await watchPage(cat, game, { origin: 'https://preview-party.example', linkBase: BASE }).text()).includes(`"linkBase":"${BASE}"`));
  assert.doesNotMatch(await playPage(cat, game, { origin: 'https://party.example' }).text(), /"linkBase"/);
});

test('the landing\'s phone code starts with the base', async () => {
  const qr = (html) => html.match(/<svg[^>]*aria-label="Play Party on your phone"[\s\S]*?<\/svg>/)?.[0];
  const plain = qr(await gameLanding(cat, game, { origin: 'https://preview-party.example' }).text());
  const based = qr(await gameLanding(cat, game, { origin: 'https://preview-party.example', linkBase: BASE }).text());
  assert.ok(plain && based); assert.notEqual(plain, based);
});
