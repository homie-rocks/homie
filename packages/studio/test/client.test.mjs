/**
 * Which chat is building the studio. An unnamed session is "the chat", never a guess that it is Claude.
 * Run: node --test packages/studio/test/client.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { studioClient } from '../lib/client.mjs';

test('studioClient names only a chat the session named', () => {
  assert.equal(studioClient(null, {}).id, 'chat');
  assert.equal(studioClient('grok', {}).id, 'grok');
  assert.equal(studioClient('Grok-Bot', {}).card, "Grok's card");
  assert.equal(studioClient(null, { HOMIE_CLIENT: 'codex' }).id, 'codex');
  assert.equal(studioClient('claude-code', {}).id, 'claude');
  assert.equal(studioClient('someone-else', {}).id, 'chat');
  assert.equal(studioClient('grok', { HOMIE_CLIENT: 'claude' }).id, 'grok', '--client wins over the environment');
});
