/**
 * A stand-in for fal's pricing API, storage and queue, for tests: the same
 * paths and answer shapes the video skill uses. Media answers are made with
 * ffmpeg. `stats` counts submits, so a test can prove a resume never pays twice.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PRICES = {
  'fal-ai/flux/dev': { unit_price: 0.025, unit: 'megapixels' },
  'fal-ai/nano-banana-pro': { unit_price: 0.15, unit: 'images' },
  'bytedance/seedance-2.5/reference-to-video': { unit_price: 0.0214, unit: '1000 tokens' },
  'bytedance/seedance-2.5/image-to-video': { unit_price: 0.0214, unit: '1000 tokens' },
  'fal-ai/bytedance/seedream/v5/lite/text-to-image': { unit_price: 0.035, unit: 'images' },
  'fal-ai/bytedance/seedream/v5/lite/edit': { unit_price: 0.035, unit: 'images' },
  'tripo3d/p1/image-to-3d': { unit_price: 0.01, unit: 'credits' },
  // Meshy 7.1: the pricing API's figure is the base; the page's add-ons (textures, rigging) come from the registry.
  'meshy/v7.1/image-to-3d': { unit_price: 0.8, unit: 'generations' },
};

function media(kind, audioFile = null) {
  const f = join(tmpdir(), `fake-fal-${process.pid}-${Date.now()}.${kind === 'image' ? 'png' : 'mp4'}`);
  const args = kind === 'image'
    ? ['-f', 'lavfi', '-i', 'testsrc2=s=1024x576:d=1', '-frames:v', '1', f]
    : ['-f', 'lavfi', '-i', 'testsrc2=s=854x480:r=24:d=4', ...(audioFile ? ['-i', audioFile] : ['-f', 'lavfi', '-i', 'sine=f=440:d=4']), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '4', '-shortest', f];
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  const b = readFileSync(f); rmSync(f);
  return b;
}

/** A small textured-looking model for image-to-3D answers: a box, as the models skill's tests need. */
async function meshBytes() {
  const { placeholderGlb } = await import('../../../../packages/studio/lib/optimise.mjs');
  return Buffer.from(await placeholderGlb([1.2, 2.4, 1.2], { name: 'tripo-mesh' }));
}
/** A rigged character for a rigging answer: an A-pose humanoid under a centimetre armature, named as Meshy names it. */
async function riggedBytes() {
  const { humanoidGlb } = await import('../../../../packages/studio/test/rig-fixtures.mjs');
  return Buffer.from(await humanoidGlb({ scheme: 'meshy', cm: true, apose: true, clips: false }));
}

export async function startFakeFal({ key = 'test-key' } = {}) {
  const stats = { submits: 0, uploads: 0, lastInput: null };
  const uploads = new Map();
  const jobs = new Map();
  let base = '';
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', async () => {
      const u = new URL(req.url, 'http://x');
      const body = Buffer.concat(chunks);
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (u.pathname.startsWith('/put/')) { uploads.set(u.pathname.slice(5), body); res.writeHead(200); res.end(); return; }
      if (u.pathname.startsWith('/files/')) { res.writeHead(200); res.end(uploads.get(u.pathname.slice(7)) ?? ''); return; }
      if (u.pathname.startsWith('/media/')) { const j = jobs.get(u.pathname.slice(7)); res.writeHead(200); res.end(j?.bytes ?? ''); return; }
      if (req.headers.authorization !== `Key ${key}`) return json(401, { detail: 'bad key' });
      if (u.pathname === '/v1/models/pricing') {
        const id = u.searchParams.get('endpoint_id');
        if (!PRICES[id]) return json(404, { detail: 'unknown endpoint' });
        return json(200, { prices: [{ endpoint_id: id, ...PRICES[id], currency: 'USD' }], has_more: false });
      }
      if (u.pathname === '/storage/upload/initiate') {
        stats.uploads++;
        const id = `u${stats.uploads}`;
        return json(200, { upload_url: `${base}/put/${id}`, file_url: `${base}/files/${id}` });
      }
      if (u.pathname.startsWith('/requests/')) {
        const [, , id, what] = u.pathname.split('/');
        const j = jobs.get(id);
        if (!j) return json(404, {});
        if (what === 'status') { j.polls++; return json(200, { status: j.polls > 1 ? 'COMPLETED' : 'IN_PROGRESS' }); }
        if (j.kind === 'mesh' && j.rigged) return json(200, { model_glb: { url: `${base}/media/${id}-plain` }, rigged_character_glb: { url: `${base}/media/${id}`, file_name: 'rigged.glb' }, basic_animations: { walking_glb: { url: `${base}/media/${id}` } }, rig_task_id: 'r-1' });
        if (j.kind === 'mesh') return json(200, { model_mesh: { url: `${base}/media/${id}`, content_type: 'model/gltf-binary', file_name: 'model.glb' }, model_urls: { glb: { url: `${base}/media/${id}` } }, task_id: 't-1' });
        return json(200, j.kind === 'image' ? { images: [{ url: `${base}/media/${id}` }], seed: 7 } : { video: { url: `${base}/media/${id}` }, seed: 9 });
      }
      if (req.method === 'POST') {
        const model = u.pathname.slice(1);
        if (!PRICES[model]) return json(404, { detail: 'unknown model' });
        stats.submits++;
        const input = JSON.parse(body.toString('utf8'));
        stats.lastInput = input;
        const id = `req-${stats.submits}`;
        const kind = /video/.test(model) ? 'video' : /3d/.test(model) ? 'mesh' : 'image';
        let audio = null;
        if (kind === 'video' && Array.isArray(input.audio_urls) && input.audio_urls[0]) {
          // The generated clip "sings" the reference: its own sound is the reference, at 0 ms.
          const id2 = String(input.audio_urls[0]).split('/files/')[1];
          if (uploads.has(id2)) { audio = join(tmpdir(), `fake-fal-ref-${process.pid}.wav`); writeFileSync(audio, uploads.get(id2)); }
        }
        const rigged = kind === 'mesh' && input.enable_rigging === true;
        jobs.set(id, { kind, rigged, polls: 0, bytes: rigged ? await riggedBytes() : kind === 'mesh' ? await meshBytes() : media(kind, audio) });
        return json(200, { request_id: id, status_url: `${base}/requests/${id}/status`, response_url: `${base}/requests/${id}` });
      }
      json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, stats, close: () => new Promise((r) => server.close(r)) };
}

