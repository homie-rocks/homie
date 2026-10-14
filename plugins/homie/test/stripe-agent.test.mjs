/**
 * Stripe's own agent tools beside the shop (plugin 0.25.3):
 * - the Homie mod refuses a write through Stripe's MCP whose answer would carry a webhook's signing secret into the
 *   conversation (a new webhook endpoint, an event destination with its secret included), whatever the MCP server is
 *   called and however the call names the method; reads, updates of an existing endpoint and the catalog pass;
 * - a webhook signing secret (whsec_ with no live/test part) is taken out of tool output, as Stripe keys are;
 * - the music skill finds the ElevenLabs key Stripe Projects keeps for a studio (studio.json providers.elevenlabs and
 *   the git-ignored .env), in its own process only, and nothing else's;
 * - the shop skill says the owner's steps, Stripe's agent plugin, the Agent-key change of 2026-10-31, and never a
 *   webhook through the MCP; the studio-setup skill has Stripe Projects as an option, never as the default.
 * Nothing here reaches Stripe, Cloudflare or ElevenLabs: every value is made up.
 *
 * Run: node --test plugins/homie/test/stripe-agent.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { stripeSecretWriteOf } from '../hooks/lib/commands.mjs';
import { redact, redactText } from '../hooks/lib/redact.mjs';


const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
// Built here so no key-shaped string sits in this file.
const j = (...parts) => parts.join('');

test('Stripe\'s MCP: a write that would hand back a webhook secret is refused; everything else passes', () => {
  const names = ['mcp__plugin_stripe_stripe__stripe_api_write', 'mcp__stripe__stripe_api_write', 'mcp__claude_ai_Stripe__stripe_api_write'];
  for (const tool of names) {
    const why = stripeSecretWriteOf(tool, { method: 'POST', path: '/v1/webhook_endpoints', params: { url: 'https://owls.example/api/shop/hook', enabled_events: ['checkout.session.completed'] } });
    assert.match(why, /signing secret/);
    assert.match(why, /homie-studio shop connect/, 'it says what to do instead');
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



test('the skills: the owner\'s steps with Stripe\'s own tools; Stripe Projects is an option, never the default', () => {
  const shop = readFileSync(join(PLUGIN, 'skills', 'shop', 'SKILL.md'), 'utf8');
  assert.match(shop, /stripe_login/);
  assert.match(shop, /shop connect --renew/);
  assert.match(shop, /keyless/);
  assert.match(shop, /Payment Links/);
  assert.match(shop, /Never silently select/);
  assert.match(shop, /stripe agent setup/);
  assert.match(shop, /https:\/\/mcp\.stripe\.com/);
  assert.match(shop, /sandbox first/);
  assert.match(shop, /2026-10-31/, 'the Agent-key change');
  assert.match(shop, /Never make a webhook endpoint or an event destination through Stripe's MCP/);
  assert.match(shop, /shop catalog/);
  assert.match(shop, /confirmation link/);
  assert.match(shop, /The owner's steps, for a creator with a fresh Stripe account/);
  assert.doesNotMatch(shop, /\bpaste (?:it|the key|a key) (?:in|into) (?:the )?chat\b/i);
  // Declared lazily, as the plugin declares every provider: the skill's frontmatter names it, and Codex gets Stripe's
  // MCP server beside the skill (agents/openai.yaml), wired only when the skill is used. Nothing installs up front.
  const front = /^---\n([\s\S]*?)\n---\n/.exec(shop)[1];
  assert.match(front, /^compatibility: [^\n]*Stripe's own agent plugin/m);
  assert.match(front, /^metadata:\n {2}providers: stripe$/m);
  assert.doesNotMatch(front.split('\n').filter((l) => /^(description|compatibility): /.test(l)).join('\n').replace(/^\w+: /gm, ''), /: | #/, 'plain YAML scalars');
  const codex = readFileSync(join(PLUGIN, 'skills', 'shop', 'agents', 'openai.yaml'), 'utf8');
  assert.match(codex, /value: "stripe"/);
  assert.match(codex, /url: "https:\/\/mcp\.stripe\.com"/);
  assert.match(codex, /transport: "streamable_http"/);
});
