/**
 * @homie-rocks/studio 0.21.0: what Claude Code's Homie mod (the plugin's hooks/homie.mjs) reads from a studio.
 *
 *   - a build's preview is also kept small as raw RGB beside its feed (`<build>.preview.<w>x<h>.rgb`), because a mod
 *     has no image decoder: from a PNG screenshot (`png`) or a .png file (`image`), one file per build, never in the
 *     feed or its shared copy;
 *   - lib/thumb.mjs decodes Chrome's PNGs (every row filter) and averages them down;
 *   - `office mute` exists beside `office kick`, and is asked for the same way (its usage, and the CLI's wiring).
 *
 * Run: node --test packages/studio/test/mod-support.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { officeMute } from '../lib/office.mjs';
import { Feed, readFeed, startProgress } from '../lib/progress.mjs';
import { decodePng, rgbThumb, thumbName } from '../lib/thumb.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A PNG of `w` x `h` (RGB, or RGBA with `alpha`), each row with filter `y % 5` (none, sub, up, average, Paeth). */
function png(w, h, at, { alpha = false } = {}) {
  const bpp = alpha ? 4 : 3;
  const stride = w * bpp;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = at(x, y); for (let k = 0; k < bpp; k++) px[y * stride + x * bpp + k] = k < 3 ? c[k] : 255; }
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const f = y % 5;
    raw[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x++) {
      const v = px[y * stride + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let pred = 0;
      if (f === 1) pred = a; else if (f === 2) pred = b; else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[y * (stride + 1) + 1 + x] = (v - pred + 256) & 255;
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let x = 0xffffffff; for (const v of buf) x = crcT[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const gradient = (x, y) => [(x * 13) & 255, (y * 29) & 255, ((x + y) * 7) & 255];

test('thumb: every PNG row filter decodes back to the pixels, RGB and RGBA', () => {
  for (const alpha of [false, true]) {
    const img = decodePng(png(17, 11, gradient, { alpha }));
    assert.deepEqual([img.w, img.h], [17, 11]);
    for (const [x, y] of [[0, 0], [16, 10], [5, 7], [9, 4]]) {
      const i = (y * 17 + x) * 4;
      assert.deepEqual([...img.rgba.subarray(i, i + 3)], gradient(x, y), `${alpha ? 'RGBA' : 'RGB'} pixel ${x},${y}`);
    }
  }
  assert.throws(() => decodePng(Buffer.from('not a png at all, really not at all')), /not a PNG/);
});

test('thumb: a picture averaged down to at most 160 wide keeps its shape and its colours', () => {
  const half = png(320, 200, (x) => (x < 160 ? [255, 0, 0] : [0, 0, 255]));
  const t = rgbThumb(half, 160);
  assert.deepEqual([t.w, t.h], [160, 100]);
  assert.equal(t.rgb.length, 160 * 100 * 3);
  assert.deepEqual([...t.rgb.subarray(0, 3)], [255, 0, 0]);
  assert.deepEqual([...t.rgb.subarray((160 * 100 - 1) * 3)], [0, 0, 255]);
  assert.equal(thumbName('b1', 160, 100), 'b1.preview.160x100.rgb');
});

test('a feed\'s preview keeps one raw RGB copy beside the feed for the mod, and never puts it in the feed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'homie-mod-support-'));
  try {
    writeFileSync(join(root, 'studio.json'), JSON.stringify({ name: 'Night Owls', cloudflare: {} }));
    const r = await startProgress(root, { what: 'game', id: 'owl-rush', title: 'Owl Rush' });
    assert.equal(r.ok, true);
    const feed = new Feed(root, r.build);
    const dir = join(root, '.studio', 'progress');
    const rgbs = () => readdirSync(dir).filter((f) => f.endsWith('.rgb'));
    feed.preview({ url: 'http://127.0.0.1:8787/owl-rush/play', image: 'data:image/jpeg;base64,/9j/4AAQ', caption: 'no PNG' });
    assert.deepEqual(rgbs(), [], 'a JPEG alone makes no raw copy');
    feed.preview({ url: 'http://127.0.0.1:8787/owl-rush/play', png: png(480, 300, gradient), caption: 'round 1' });
    assert.deepEqual(rgbs(), [`${r.build}.preview.160x100.rgb`]);
    const file = join(root, 'shot.png');
    writeFileSync(file, png(200, 200, gradient));
    feed.preview({ image: file, caption: 'round 2' });
    assert.deepEqual(rgbs(), [`${r.build}.preview.160x160.rgb`], 'the newest one replaces the last');
    assert.equal(readFileSync(join(dir, `${r.build}.preview.160x160.rgb`)).length, 160 * 160 * 3);
    const doc = readFeed(root, r.build);
    assert.equal(doc.preview.caption, 'round 2');
    assert.ok(!JSON.stringify(doc).includes('.rgb'), 'the feed (and its shared copy) never names the raw file');
    feed.preview({ png: Buffer.from('broken'), caption: 'still a feed' });
    assert.equal(readFeed(root, r.build).preview.caption, 'still a feed', 'a picture that will not decode leaves the feed working');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('office mute: its usage, and the CLI wires it and asks like a kick', async () => {
  const r = await officeMute('/nowhere', 'owl-rush', 'pub-1', undefined);
  assert.equal(r.ok, false);
  assert.match(r.why, /^usage: homie-studio office mute <game> <room> <seat number \| name> \[--minutes 10\] \[--off\]$/);
  const bin = readFileSync(join(PKG, 'bin', 'homie-studio.mjs'), 'utf8');
  assert.ok(bin.includes("if (sub === 'mute') return officeMute(root, positional[2], positional[3], positional.slice(4).join(' ') || undefined, { url, minutes: flags.get('minutes'), off: flags.has('off') });"));
  assert.ok(/case 'office kick':\s*case 'office mute':/.test(bin), 'printed as an ask, like a kick');
  const lib = readFileSync(join(PKG, 'lib', 'office.mjs'), 'utf8');
  assert.ok(lib.includes("call('/_studio/api/mute', { game, room: p.room.room, id: p.client.id"), 'through the office API, which only asks for it with an office key');
});
