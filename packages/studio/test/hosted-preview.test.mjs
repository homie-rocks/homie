/**
 * A host that runs the toolkit away from the person's screen (Homie Managed's studio workspace) names where its
 * studio's private preview is reachable: HOMIE_PREVIEW_URL. With a preview target in studio.json, "here" is that
 * preview; without either, the site runs on this computer as it always has.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hostedPreview } from '../lib/mcp-tools.mjs';

const db = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', previewDb = '1f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
function studio(cloudflare) {
  const root = mkdtempSync(join(tmpdir(), 'hosted-preview-'));
  writeFileSync(join(root, 'studio.json'), JSON.stringify({ name: 'Hosted', slug: 'hosted', cloudflare }));
  return root;
}
const target = { dispatchNamespace: 'studios', worker: 'hosted', d1Id: db, domain: 'hosted.example.com', preview: { worker: 'hosted-preview', d1Id: previewDb, domain: 'preview-hosted.example.com' } };
const PASS = 'https://preview-hosted.example.com/__homie_preview/abc123/';

test('a host\'s preview address is "here" only for a studio with a preview target, and only an https address', () => {
  const hosted = studio(target);
  assert.equal(hostedPreview(hosted, { HOMIE_PREVIEW_URL: PASS }), 'https://preview-hosted.example.com/__homie_preview/abc123');
  assert.equal(hostedPreview(hosted, {}), null, 'no address named: the site runs on this computer');
  for (const bad of ['http://preview-hosted.example.com/', 'not a url', 'https://user:pw@preview-hosted.example.com/', 'https://preview-hosted.example.com/?x=1']) assert.equal(hostedPreview(hosted, { HOMIE_PREVIEW_URL: bad }), null, bad);
  assert.equal(hostedPreview(studio({ worker: 'own-account' }), { HOMIE_PREVIEW_URL: PASS }), null, 'a studio on its own account keeps its local preview');
  assert.equal(hostedPreview(studio({ ...target, preview: undefined }), { HOMIE_PREVIEW_URL: PASS }), null, 'a platform target without a preview pair');
});

test('in a hosted workspace the host-bound tools are not offered and the instructions say whose they are', async () => {
  const { spawn } = await import('node:child_process');
  const { HOSTED_OFF } = await import('../lib/mcp-tools.mjs');
  const { hostedInstructions, INSTRUCTIONS } = await import('../lib/mcp.mjs');
  const cwd = studio(target), cli = new URL('../bin/homie-studio.mjs', import.meta.url).pathname;
  const ask = (env) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'mcp', '--no-install'], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = ''; const got = {};
    child.stdout.on('data', (d) => { buf += d; for (const line of buf.split('\n').slice(0, -1)) { const m = JSON.parse(line); got[m.id] = m.result; } buf = buf.slice(buf.lastIndexOf('\n') + 1); if (got[1] && got[2]) { child.stdin.end(); resolve(got); } });
    setTimeout(() => reject(new Error('no answer')), 30000);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  });
  const here = await ask({ HOMIE_PREVIEW_URL: '' }), hosted = await ask({ HOMIE_PREVIEW_URL: PASS });
  for (const name of HOSTED_OFF) assert.ok(here[2].tools.some((t) => t.name === name), name + ' is a tool on the person\'s computer');
  for (const name of HOSTED_OFF) assert.ok(!hosted[2].tools.some((t) => t.name === name), name + ' is not offered in a hosted workspace');
  for (const name of ['build', 'check', 'playtest', 'preview_run', 'studio_deploy', 'file_read']) assert.ok(hosted[2].tools.some((t) => t.name === name), name);
  assert.equal(here[1].instructions, INSTRUCTIONS);
  assert.equal(hosted[1].instructions, hostedInstructions());
  assert.match(hosted[1].instructions, /workspace the studio's host made for it/);
  assert.doesNotMatch(hosted[1].instructions, /setup_status|cloudflare_login|studio_open|game_lab|game_standalone|studio_domain|asset_make|own fal account|Open provider authorization/);
});
