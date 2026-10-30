import test from 'node:test';
import assert from 'node:assert/strict';
import { ANNOTATIONS, builtins } from '../worker/mcp-tools.mjs';

test('every built-in studio tool carries accurate MCP annotations', () => {
  const tools = builtins({}, { games: [], posts: [], studio: {} }, 'https://example.test').filter(t => t.kind !== 'prompt');
  const missing = tools.filter(t => !t.annotations).map(t => t.name);
  assert.deepEqual(missing, []);
  for (const name of ['studio_info', 'studio_stats', 'app_schema', 'studio_office_read', 'studio_events_read']) assert.equal(ANNOTATIONS[name].readOnlyHint, true, name);
  for (const name of ['app_records', 'studio_office_action', 'room_close', 'studio_events_clear']) {
    assert.equal(ANNOTATIONS[name].readOnlyHint, false, name); assert.equal(ANNOTATIONS[name].destructiveHint, true, name);
  }
});
