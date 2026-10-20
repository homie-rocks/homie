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
