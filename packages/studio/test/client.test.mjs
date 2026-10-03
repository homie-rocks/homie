/**
 * Which chat is checking a studio in. Named only when the session says so.
 * Run: node --test packages/studio/test/client.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { studioClient } from '../lib/client.mjs';

test('a chat is named only when the session says so', () => {
  assert.equal(studioClient(null, {}).id, 'chat');
  assert.equal(studioClient(undefined, { HOMIE_CLIENT: 'grok' }).id, 'grok');
  assert.equal(studioClient('grok-bot', {}).id, 'grok');
  assert.equal(studioClient('claude-code', {}).connect, 'Connect to Claude');
  assert.equal(studioClient('banana', { HOMIE_CLIENT: 'grok' }).id, 'chat', 'an explicit unknown name is not a guess, and does not fall through to the environment');
  assert.equal(studioClient('grok', {}).card, "Grok's card");
});
