import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.mjs') ? [join(dir, entry.name)] : []);
}
test('Worker modules have no near-duplicate implementation', () => {
  const modules = sources(new URL('../worker', import.meta.url).pathname).map((path) => {
    const tokens = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').match(/[A-Za-z_$][\w$]*|\d+|[^\s]/g) ?? [];
    const chunks = new Set();
    for (let i = 0; i + 40 <= tokens.length; i++) chunks.add(tokens.slice(i, i + 40).join(' '));
    return { path, chunks };
  }).filter((m) => m.chunks.size > 300);
  for (let i = 0; i < modules.length; i++) for (const b of modules.slice(i + 1)) {
    const a = modules[i];
    const overlap = [...a.chunks].filter((chunk) => b.chunks.has(chunk)).length;
    assert.ok(overlap / Math.min(a.chunks.size, b.chunks.size) < 0.7, `Near-duplicate modules: ${a.path} and ${b.path}`);
  }
});
test('Paid uploads follow successful deployment and use a private binding', () => {
  const deploy = readFileSync(new URL('../lib/cloudflare.mjs', import.meta.url), 'utf8');
  const call = deploy.indexOf('await uploadPaidParts(');
  assert.ok(call > deploy.indexOf("if (dep.code !== 0) return refuse"));
  assert.ok(call > deploy.indexOf("if (migrate.code !== 0) return refuse"));
  assert.match(deploy.slice(call, call + 100), /bucket: purchaseBucket/);
  const resource = readFileSync(new URL('../worker/parts-resource.mjs', import.meta.url), 'utf8');
  assert.match(resource, /env.PURCHASE_MEDIA/);
  assert.doesNotMatch(resource, /env\.MEDIA\b/);
});
