import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import worker from '../worker/index.mjs';
import { hostRules } from '../worker/hosted.mjs';
import { RULES_WIRING_MESSAGE } from '../worker/rules-wiring.mjs';
import { registersRules } from '../lib/rules-wiring.mjs';
import { check } from '../lib/check.mjs';

test('comments and unused functions cannot claim rules registration; imported aliases work', () => {
  const imports = "import { hostRules as register } from '@homie-rocks/studio/worker'; import table from './rules/index.mjs';";
  assert.equal(registersRules(imports + ' register(table);'), true);
  assert.equal(registersRules(imports + ' // register(table);'), false);
  assert.equal(registersRules(imports + ' function unused(){ register(table); }'), false);
});

test('live check reports the same missing hostRules fix before launching browsers', async t => {
  hostRules({});
  const cat = { studio: { name: 'Scratch', slug: 'scratch' }, games: [{ id: 'test', name: 'Test', players: { max: 4 }, room: { host: 'server' } }] };
  const env = { ASSETS: { fetch: async () => Response.json(cat) }, LOBBY: { idFromName: x => x, get: () => ({ fetch: async () => Response.json({ players: 0, rooms: [] }) }) } };
  const response = await worker.fetch(new Request('http://localhost/api/games'), env, { waitUntil() {} });
  const data = await response.json();
  assert.equal(data.games[0].rulesError, RULES_WIRING_MESSAGE);
  const server = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await check({ url: `http://127.0.0.1:${server.address().port}`, game: 'test' });
  assert.equal(result.ok, false); assert.equal(result.why, RULES_WIRING_MESSAGE);
});
