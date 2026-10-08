/**
 * Cloudflare's own figures for a studio's rooms (lib/cf-usage.mjs), against a stand-in for its analytics API: the
 * query it sends, the sums it reads, twenty socket messages billed as one request, and the comparison with what the
 * deploy plan says a server-hosted room uses (lib/cloudflare.mjs `hostedUse`). It has not been run against
 * Cloudflare itself: this holds its arithmetic and its refusals, not Cloudflare's field names.
 * Run: node --test packages/studio/test/rules-usage.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cfUsage, compareUse } from '../lib/cf-usage.mjs';
import { hostedUse } from '../lib/cloudflare.mjs';

test('what an hour of a full room uses of the free plan\'s allowances, as the deploy plan says it', () => {
  const eight = hostedUse({ seats: 8, inputHz: 20 });
  assert.equal(eight.requests, 29_520, 'eight players: 20 inputs a second and a ping every 2 s each, billed 20 to 1');
  assert.equal(eight.gbSeconds, 460.8, 'one object awake for an hour is billed as 128 MB');
  assert.deepEqual(eight.share, { requests: '29.5%', gbSeconds: '3.5%', rows: 'under 0.1%' });
  assert.equal(hostedUse({ seats: 32, inputHz: 20 }).requests, 118_080, 'a full 32-seat room passes the free plan\'s requests inside an hour');
  assert.equal(hostedUse({ seats: 8, inputHz: 10 }).requests, 15_120);
});

test('Cloudflare\'s figures for a room: the query, the sums, and the comparison with the plan', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ data: { viewer: { accounts: [{
      invocations: [{ sum: { requests: 40, errors: 0, responseBodySize: 0, wallTime: 0 } }, { sum: { requests: 2, errors: 1 } }],
      periodic: [{ sum: { activeTime: 3_600_000_000, cpuTime: 90_000_000, duration: 300, inboundWebsocketMsgCount: 400_000, outboundWebsocketMsgCount: 600_000, rowsRead: 5, rowsWritten: 10, exceededCpuErrors: 0 } }, { sum: { duration: 165, inboundWebsocketMsgCount: 190_000, rowsWritten: 2 } }],
    }] } } }), { status: 200 });
  };
  const use = await cfUsage({ accountId: 'acct', token: 'a-token', script: 'night-owls', objectId: 'room-1', since: '2026-10-07T10:00:00Z', until: '2026-10-07T11:00:00Z', fetchFn });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/graphql');
  assert.equal(calls[0].init.headers.authorization, 'Bearer a-token');
  assert.deepEqual(calls[0].body.variables, { account: 'acct', filter: { datetime_geq: '2026-10-07T10:00:00.000Z', datetime_leq: '2026-10-07T11:00:00.000Z', scriptName: 'night-owls', objectId: 'room-1' }, periodic: { datetime_geq: '2026-10-07T10:00:00.000Z', datetime_leq: '2026-10-07T11:00:00.000Z', scriptName: 'night-owls', objectId: 'room-1' } });
  assert.match(calls[0].body.query, /durableObjectsInvocationsAdaptiveGroups[\s\S]*durableObjectsPeriodicGroups/);
  assert.equal(use.ok, true);
  assert.equal(use.requests, 42);
  assert.equal(use.socketMessagesIn, 590_000);
  assert.equal(use.billedRequests, 42 + 29_500, 'twenty incoming socket messages are billed as one request');
  assert.equal(use.gbSeconds, 465);
  assert.deepEqual([use.cpuMs, use.activeMs, use.rowsWritten, use.errors], [90_000, 3_600_000, 12, 1]);
  assert.doesNotMatch(JSON.stringify(use), /a-token/, 'the token is in no result');
  const cmp = compareUse(use, { seats: 8, inputHz: 20 });
  assert.deepEqual(cmp.requests, { measured: 29_542, estimate: 29_520, off: 0.1 });
  assert.deepEqual(cmp.gbSeconds, { measured: 465, estimate: 460.8, off: 0.9 });
  assert.equal(cmp.within10, true);
  assert.equal(compareUse({ ...use, gbSeconds: 700 }, { seats: 8 }).within10, false);
  // Refusals: nothing is sent without the three things it needs, or without a stretch of time; an API error is said.
  assert.match((await cfUsage({ accountId: 'a', script: 's', since: 'x', until: 'y', fetchFn })).why, /needs the account id, an API token/);
  assert.match((await cfUsage({ accountId: 'a', token: 't', script: 's', since: '2026-10-07T11:00:00Z', until: '2026-10-07T10:00:00Z', fetchFn })).why, /needs a stretch of time/);
  assert.equal(calls.length, 1);
  const denied = await cfUsage({ accountId: 'a', token: 't', script: 's', since: '2026-10-07T10:00:00Z', until: '2026-10-07T11:00:00Z', fetchFn: async () => new Response(JSON.stringify({ errors: [{ message: 'not authorized for that account' }] }), { status: 403 }) });
  assert.deepEqual(denied, { ok: false, why: 'Cloudflare\'s analytics answered 403: not authorized for that account' });
  const down = await cfUsage({ accountId: 'a', token: 't', script: 's', since: '2026-10-07T10:00:00Z', until: '2026-10-07T11:00:00Z', fetchFn: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  assert.match(down.why, /could not be reached: getaddrinfo ENOTFOUND/);
});
