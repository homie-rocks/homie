// A host may require a query on the studio's own links (worker/link-query.mjs): a private preview lets a phone in only
// with its pass, so the television's join code, the shared link and the landing's code carry it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkQuery, withLinkQuery, LINK_QUERY_HEADER } from '../worker/link-query.mjs';
import { playPage } from '../worker/pages.mjs';
import { gameLanding } from '../worker/site.mjs';

const cat = { studio: { name: 'Party', theme: { bg: '#05070d', fg: '#dffcff', accent: '#ff3bd4', scheme: 'dark' } }, games: [] };
const game = { id: 'party', name: 'Party', blurb: 'Everyone plays.', players: { max: 8 } };
const req = (value) => new Request('https://preview-party.example/party/play', { headers: value === undefined ? {} : { [LINK_QUERY_HEADER]: value } });

test('the host\'s query is read only in its one shape, and added to a link without disturbing its own query', () => {
  assert.equal(linkQuery(req('homie_preview=abc.DEF-1_x')), 'homie_preview=abc.DEF-1_x');
  for (const bad of [undefined, '', 'a=b&c=d', 'x=<script>', '=v', 'Name=v', 'n='+'x'.repeat(2000)]) assert.equal(linkQuery(req(bad)), '', String(bad));
  assert.equal(withLinkQuery('https://h.example/party/play?room=ABCD', 'homie_preview=p.q'), 'https://h.example/party/play?room=ABCD&homie_preview=p.q');
  assert.equal(withLinkQuery('https://h.example/party/play?room=ABCD', ''), 'https://h.example/party/play?room=ABCD', 'no host query, no change');
});

test('the play page shares links with the host\'s query; a studio with no host query is unchanged', async () => {
  const withPass = await playPage(cat, game, { origin: 'https://preview-party.example', linkQuery: 'homie_preview=p.q' }).text();
  assert.match(withPass, /"linkQuery":"homie_preview=p\.q"/);
  assert.match(withPass, /boot\.linkQuery \? '&' \+ boot\.linkQuery : ''/, 'the shared link appends it');
  assert.doesNotMatch(await playPage(cat, game, { origin: 'https://party.example' }).text(), /"linkQuery"/);
});

test("the landing's phone code carries the host's query", async () => {
  const plain = await gameLanding(cat, game, { origin: "https://preview-party.example" }).text();
  const passed = await gameLanding(cat, game, { origin: "https://preview-party.example", linkQuery: "homie_preview=p.q" }).text();
  const qr = (html) => html.match(/<svg[^>]*aria-label="Play Party on your phone"[\s\S]*?<\/svg>/)?.[0];
  assert.ok(qr(plain) && qr(passed)); assert.notEqual(qr(plain), qr(passed), 'a different code: the address it encodes carries the pass');
});
