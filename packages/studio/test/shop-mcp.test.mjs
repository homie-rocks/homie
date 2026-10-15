import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('the existing Stripe connect tool owns App approval; link planning and slot sync are gone', () => {
  const tools = readFileSync(new URL('../lib/mcp-tools.mjs', import.meta.url), 'utf8');
  assert.match(tools, /name: 'stripe_login'/);
  assert.match(tools, /official Homie Stripe App/);
  assert.doesNotMatch(tools, /name:\s*['"]stripe_(shop_plan|webhook|bookings_sync)['"]/);
});
