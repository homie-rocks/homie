import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PART_KINDS, checkPart, newPart } from '../lib/parts.mjs';

const base = { id: 'bookings-desk', name: 'Bookings desk', kind: 'agent', version: '1.0.0', summary: 'Answers booking questions.', license: 'CC-BY-4.0', attribution: 'Inlet', share: false, files: [] };
const refused = (part) => checkPart(part).problems.filter((p) => p.level === 'refuse' && p.field.startsWith('agent')).map((p) => p.field);

test('an agent part is a kind, and its agent block is checked', () => {
  assert.ok(PART_KINDS.includes('agent'));
  assert.deepEqual(refused({ ...base, agent: { name: 'Bookings', persona: 'Keeps the calendar.', instructions: 'Ask before changing.', tools: ['calendar_read'] } }), []);
  assert.deepEqual(refused(base), ['agent']);
  assert.deepEqual(refused({ ...base, agent: { name: '', persona: 'x'.repeat(401), instructions: 5, tools: ['ok', 'not ok!'] } }), ['agent.name', 'agent.persona', 'agent.instructions', 'agent.tools']);
});

test('parts new --kind agent starts an agent block named after the part', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-part-'));
  try {
    const made = newPart(root, 'bookings-desk', { kind: 'agent', name: 'Bookings desk' });
    assert.equal(made.ok, true, made.why);
    const part = JSON.parse(readFileSync(join(root, made.dir, 'part.json'), 'utf8'));
    assert.deepEqual(part.agent, { name: 'Bookings desk', persona: '', instructions: '' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
