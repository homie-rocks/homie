import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('public descriptions lead with engine and media capabilities, not retired selling points', () => {
  for (const path of ['../plugin.json', '../.claude-plugin/plugin.json', '../.codex-plugin/plugin.json', '../.grok-plugin/plugin.json', '../../../.claude-plugin/marketplace.json']) {
    const text = read(path);
    assert.match(text, /engine packages/);
    assert.match(text, /games and apps/);
    assert.match(text, /Stripe with one approval/);
    assert.doesNotMatch(text, /free plan|no payment method|up to 32|protected names?|name grants?|remix|short interview/);
  }
});

test('routine planning and dependencies are AI work, optional features do not assign keys or terminals', () => {
  assert.match(read('../skills/studio-setup/SKILL.md'), /Carry the request through without waiting/);
  assert.match(read('../skills/plan/SKILL.md'), /Never route engineering or design questions/);
  assert.match(read('../skills/parallel/SKILL.md'), /Use one agent by default/);
  assert.doesNotMatch(read('../skills/style/SKILL.md'), /the plan asks once/);
  for (const name of ['art', 'video']) assert.doesNotMatch(read(`../skills/${name}/SKILL.md`), /they create a key|set `FAL_KEY`/);
  assert.doesNotMatch(read('../skills/standalone/SKILL.md'), /they run it in their own terminal|environment variables the person sets themselves/);
  assert.match(read('../skills/publish/SKILL.md'), /homie-studio domain/);
  assert.match(read('../skills/playtest/SKILL.md'), /outside review is optional/);
});
