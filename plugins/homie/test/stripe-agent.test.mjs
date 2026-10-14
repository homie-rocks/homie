/**
 * Stripe's own agent tools beside the shop (plugin 0.25.3):
 * - the Homie mod refuses a write through Stripe's MCP whose answer would carry a webhook's signing secret into the
 *   conversation (a new webhook endpoint, an event destination with its secret included), whatever the MCP server is
 *   called and however the call names the method; reads, updates of an existing endpoint and the catalog pass;
 * - a webhook signing secret (whsec_ with no live/test part) is taken out of tool output, as Stripe keys are;
 * Nothing here reaches Stripe, Cloudflare or ElevenLabs: every value is made up.
 *
 * Run: node --test plugins/homie/test/stripe-agent.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { stripeSecretWriteOf } from '../hooks/lib/commands.mjs';
import { redact, redactText } from '../hooks/lib/redact.mjs';

// Built here so no key-shaped string sits in this file.
const j = (...parts) => parts.join('');

test('Stripe\'s MCP: a write that would hand back a webhook secret is refused; everything else passes', () => {
  const names = ['mcp__codex_apps__stripe_stripe_api_write', 'mcp__plugin_stripe_stripe__stripe_api_write', 'mcp__stripe__stripe_api_write', 'mcp__claude_ai_Stripe__stripe_api_write'];
  for (const tool of names) {
    const why = stripeSecretWriteOf(tool, { method: 'POST', path: '/v1/webhook_endpoints', params: { url: 'https://owls.example/api/shop/hook', enabled_events: ['checkout.session.completed'] } });
    assert.match(why, /signing secret/);
    assert.match(why, /homie-studio shop webhook/, 'it says what to do instead');
  }
  const tool = names[0];
  assert.ok(stripeSecretWriteOf(tool, { operation: 'PostWebhookEndpoints', body: {} }), 'an operation name, not a path');
  assert.ok(stripeSecretWriteOf(tool, { path: '/v2/core/event_destinations', body: { type: 'webhook_endpoint', include: ['webhook_endpoint.signing_secret'] } }));
  assert.equal(stripeSecretWriteOf(tool, { path: '/v2/core/event_destinations', body: { type: 'webhook_endpoint' } }), null, 'no secret asked for: no secret answered');
  assert.equal(stripeSecretWriteOf(tool, { method: 'POST', path: '/v1/webhook_endpoints/we_1AbCdEfGh', params: { disabled: true } }), null, 'turning an endpoint off carries no secret');
  assert.equal(stripeSecretWriteOf(tool, { method: 'POST', path: '/v1/products', params: { id: 'homie_owls_supporter', name: 'Supporter' } }), null);
  assert.equal(stripeSecretWriteOf('mcp__plugin_stripe_stripe__stripe_api_read', { path: '/v1/webhook_endpoints' }), null, 'a read is never refused');
  assert.equal(stripeSecretWriteOf('Bash', { command: 'curl https://api.stripe.com/v1/webhook_endpoints' }), null);
});

test('secrets: a webhook signing secret and Stripe keys come out of tool output', () => {
  const whsec = j('whs', 'ec_', 'Ab3dEf6hIj9kLm2nOp5qRs8t');
  const rk = j('rk_', 'test_', 'Zy1'.repeat(10));
  const r = redactText(`{"id":"we_123","secret":"${whsec}","key":"${rk}"}`);
  assert.ok(r.hits.includes('Stripe webhook secret'));
  assert.ok(r.hits.includes('Stripe key'));
  assert.doesNotMatch(r.text, /Ab3dEf6h|Zy1Zy1/);
  const deep = redact({ content: [{ type: 'text', text: `made ${whsec}` }] });
  assert.doesNotMatch(JSON.stringify(deep.value), /Ab3dEf6h/, 'an MCP result is walked too');
  assert.equal(redactText('the secret starts with whsec_ (paste it on the page)').text, 'the secret starts with whsec_ (paste it on the page)', 'naming the prefix is not a secret');
});
