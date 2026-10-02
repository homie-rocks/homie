/**
 * @homie-rocks/studio 0.18.0: big media lives in the studio's own R2, by default, once the studio has storage.
 *   - `media move --dry-run` names what goes (over 1 MiB, or left out of git) and calls nothing;
 *   - `media move` uploads each file, reads it back and compares SHA-256, and only then records it on the manifest;
 *     a copy that comes back different is refused and nothing is recorded; the file on this computer stays;
 *   - a deploy moves what is due, and its build stops carrying a moved file in the site's static assets, while a
 *     local build (for `dev`, whose R2 is empty) still copies it; Workers Builds builds as a deploy;
 *   - the Worker serves a moved file at the SAME address, from R2: byte ranges (206), HEAD, ETag and If-None-Match
 *     (304), the site's own cache headers, and never a key the catalogue does not list;
 *   - a file changed after it moved goes up again; studio.json media.r2Over false moves nothing on its own;
 *   - a studio without storage is told what storage would do, and a deploy never asks R2 anything.
 * A stand-in Wrangler plays the Cloudflare account (its R2 is a folder). Run: node --test packages/studio/test/media-r2.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-media-r2-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const run = (args, cwd, env = {}) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8', env: { ...process.env, HOMIE_STUDIO_WARM: '0', ...env } });
const out = (r) => { try { return JSON.parse(r.stdout); } catch { throw new Error(`not JSON: ${r.stdout}${r.stderr}`); } };
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}

/**
 * A stand-in Wrangler for an account WITH R2: Workers, D1 and deploy answer as Cloudflare does, and R2 objects are
 * files under .fake-cf/r2/<bucket>/<key>. `corrupt` (a file in the state folder) makes `object get` return other
 * bytes than were put, as a damaged upload would.
 */
function r2Account(dir) {
  const bin = join(dir, 'node_modules', '.bin');
  const state = join(dir, '.fake-cf');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(state, 'r2'), { recursive: true });
  writeFileSync(join(bin, 'wrangler'), `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
const S = ${JSON.stringify(state)};
const a = process.argv.slice(2);
fs.appendFileSync(path.join(S, 'calls'), a.join(' ') + '\\n');
const opt = (n) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : null; };
const say = (t) => process.stdout.write(t + '\\n');
if (a[0] === 'whoami') say(JSON.stringify({ loggedIn: true, authType: 'OAuth Token', accounts: [{ id: 'acc1', name: 'Test' }] }));
else if (a[0] === 'versions') { process.stderr.write('This Worker does not exist on your account. [code: 10007]\\n'); process.exit(1); }
else if (a[0] === 'd1' && a[1] === 'list') say(fs.existsSync(path.join(S, 'db')) ? '[{"uuid":"22222222-2222-2222-2222-222222222222","name":"night-owls-db"}]' : '[]');
else if (a[0] === 'd1' && a[1] === 'create') { fs.writeFileSync(path.join(S, 'db'), ''); say('"database_id": "22222222-2222-2222-2222-222222222222"'); }
else if (a[0] === 'd1') say('ok');
else if (a[0] === 'deploy') say('Deployed test-studio triggers https://test-studio.acct.workers.dev');
else if (a[0] === 'r2' && a[1] === 'bucket' && a[2] === 'list') say('');
else if (a[0] === 'r2' && a[1] === 'bucket' && a[2] === 'create') say('Created bucket ' + a[3]);
else if (a[0] === 'r2' && a[1] === 'object' && a[2] === 'put') {
  if (!a.includes('--remote')) { process.stderr.write('local?\\n'); process.exit(3); }
  const f = path.join(S, 'r2', a[3]); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.copyFileSync(opt('file'), f);
  fs.writeFileSync(f + '.type', String(opt('content-type')));
  say('Upload complete.');
} else if (a[0] === 'r2' && a[1] === 'object' && a[2] === 'get') {
  const f = path.join(S, 'r2', a[3]);
  if (!fs.existsSync(f)) { process.stderr.write('The specified key does not exist.\\n'); process.exit(1); }
  let b = fs.readFileSync(f);
  if (fs.existsSync(path.join(S, 'corrupt'))) b = Buffer.concat([b, Buffer.from('!')]);
  process.stdout.write(b);
} else { process.stderr.write('unexpected: ' + a.join(' ') + '\\n'); process.exit(9); }
`);
  chmodSync(join(bin, 'wrangler'), 0o755);
  const calls = () => (existsSync(join(state, 'calls')) ? readFileSync(join(state, 'calls'), 'utf8').trim().split('\n') : []);
  return { state, calls, object: (key) => join(state, 'r2', 'night-owls-media', key), corrupt: (on) => (on ? writeFileSync(join(state, 'corrupt'), '') : rmSync(join(state, 'corrupt'), { force: true })) };
}

/** The studio Worker against its built site: ASSETS reads site/dist, MEDIA reads the stand-in account's R2 folder. */
async function siteOf(dir, account) {
  const { default: worker } = await import('../worker/index.mjs');
  const dist = join(dir, 'site', 'dist');
  const ASSETS = {
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, p);
      if (!f.startsWith(dist) || !existsSync(f) || !statSync(f).isFile()) return new Response('not found', { status: 404 });
      return new Response(readFileSync(f), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'cache-control': 'public, max-age=0, must-revalidate', etag: '"asset"' } });
    },
  };
  const reads = [];
  const objectOf = (key) => {
    const f = account.object(key);
    if (!existsSync(f)) return null;
    const all = readFileSync(f);
    const type = existsSync(`${f}.type`) ? readFileSync(`${f}.type`, 'utf8') : null;
    return { all, size: all.length, httpEtag: `"${sha(all).slice(0, 32)}"`, uploaded: new Date('2026-10-01T00:00:00Z'), writeHttpMetadata(h) { if (type) h.set('content-type', type); } };
  };
  const MEDIA = {
    async head(key) { reads.push(['head', key]); const o = objectOf(key); if (!o) return null; const { all, ...h } = o; return h; },
    async get(key, opts) {
      reads.push(['get', key]);
      const o = objectOf(key);
      if (!o) return null;
      return { ...o, body: opts?.range ? o.all.subarray(opts.range.offset, opts.range.offset + opts.range.length) : o.all };
    },
  };
  const LOBBY = { idFromName: () => 'x', get: () => ({ fetch: async () => new Response('{"rooms":[]}') }) };
  const fetchIt = (path, init) => worker.fetch(new Request(`https://owls.test${path}`, init), { ASSETS, MEDIA, LOBBY, STUDIO_NAME: 'Night Owls' });
  fetchIt.reads = reads;
  return fetchIt;
}

function withStorage(dir) {
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  s.cloudflare.r2 = 'night-owls-media';
  s.cloudflare.created = [...new Set([...(s.cloudflare.created ?? []), 'r2:night-owls-media'])];
  writeFileSync(join(dir, 'studio.json'), JSON.stringify(s, null, 2));
}

function media(dir) {
  mkdirSync(join(dir, 'videos/owl-trailer'), { recursive: true });
  mkdirSync(join(dir, 'music/theme'), { recursive: true });
  const trailer = randomBytes(2 * 1024 * 1024 + 17); // over 1 MiB: goes to R2
  const vertical = randomBytes(300 * 1024); // small, but *.mp4 under videos/ is left out of git: goes to R2 too
  const poster = randomBytes(40 * 1024); // small and committed: stays on the site
  const song = randomBytes(500 * 1024); // an .ogg loop: small and committed: stays
  writeFileSync(join(dir, 'videos/owl-trailer/owl-trailer.mp4'), trailer);
  writeFileSync(join(dir, 'videos/owl-trailer/owl-trailer-vertical.mp4'), vertical);
  writeFileSync(join(dir, 'videos/owl-trailer/poster.jpg'), poster);
  writeFileSync(join(dir, 'music/theme/theme-loop.ogg'), song);
  writeFileSync(join(dir, 'videos/manifest.json'), JSON.stringify({ v: 1, items: [
    { slug: 'owl-trailer', kind: 'trailer', title: 'Owl Rush trailer', published: true, files: [
      { role: 'video', path: 'videos/owl-trailer/owl-trailer.mp4', type: 'video/mp4' },
      { role: 'vertical', path: 'videos/owl-trailer/owl-trailer-vertical.mp4', type: 'video/mp4' },
      { role: 'poster', path: 'videos/owl-trailer/poster.jpg', type: 'image/jpeg' },
      { role: 'master', path: 'videos/owl-trailer/master.mov', public: false },
    ] },
    { slug: 'draft', title: 'Not yet', published: false, files: [{ role: 'video', path: 'videos/owl-trailer/owl-trailer.mp4' }] },
  ] }, null, 2));
  writeFileSync(join(dir, 'music/manifest.json'), JSON.stringify({ v: 1, items: [
    { slug: 'theme', kind: 'loop', title: 'Theme loop', published: true, files: [{ role: 'audio', path: 'music/theme/theme-loop.ogg', type: 'audio/ogg' }] },
  ] }, null, 2));
  return { trailer, vertical, poster, song };
}

test('media move: a dry run names what goes and calls nothing; a move uploads, reads back, checks SHA-256 and only then records; the file stays', () => {
  const dir = studio('move');
  const account = r2Account(dir);
  const bytes = media(dir);
  // No storage yet: the move says what storage would do, and calls nothing.
  const none = out(run(['media', 'move'], dir));
  assert.equal(none.ok, false);
  assert.equal(none.needs, 'storage');
  assert.match(none.why, /payment method/);
  assert.deepEqual(account.calls(), []);
  const listNo = out(run(['media', 'list'], dir));
  assert.match(listNo.storage, /no storage: these stay on the site/);
  assert.deepEqual(listNo.moves.map((m) => m.path).sort(), ['videos/owl-trailer/owl-trailer-vertical.mp4', 'videos/owl-trailer/owl-trailer.mp4']);

  withStorage(dir);
  const plan = out(run(['media', 'move', '--dry-run'], dir));
  assert.equal(plan.ok, true, JSON.stringify(plan));
  const state = Object.fromEntries(plan.rows.map((r) => [r.path, r]));
  assert.equal(state['videos/owl-trailer/owl-trailer.mp4'].state, 'move');
  assert.equal(state['videos/owl-trailer/owl-trailer.mp4'].reason, 'over 1 MiB');
  assert.equal(state['videos/owl-trailer/owl-trailer-vertical.mp4'].state, 'move');
  assert.equal(state['videos/owl-trailer/owl-trailer-vertical.mp4'].reason, 'git leaves it out of the repository');
  assert.equal(state['videos/owl-trailer/poster.jpg'].state, 'site');
  assert.equal(state['music/theme/theme-loop.ogg'].state, 'site');
  assert.ok(!state['videos/owl-trailer/master.mov'], 'a file marked public: false is never a candidate');
  assert.match(plan.cost, /10 GB-month/);
  assert.match(plan.cost, /no egress fees/);
  assert.deepEqual(account.calls(), [], 'a dry run calls nothing');

  // A damaged copy: refused, nothing recorded, the file stays on the site.
  account.corrupt(true);
  const bad = out(run(['media', 'move', 'videos/owl-trailer/owl-trailer-vertical.mp4'], dir));
  assert.equal(bad.ok, false);
  assert.match(bad.failed[0].why, /different SHA-256/);
  assert.match(bad.failed[0].why, /stays on the site/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'videos/manifest.json'), 'utf8')).items[0].files[1].r2, undefined, 'nothing recorded');
  account.corrupt(false);

  const moved = out(run(['media', 'move'], dir));
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.deepEqual(moved.moved.map((m) => [m.path, m.url]).sort(), [
    ['videos/owl-trailer/owl-trailer-vertical.mp4', '/videos/owl-trailer/owl-trailer-vertical.mp4'],
    ['videos/owl-trailer/owl-trailer.mp4', '/videos/owl-trailer/owl-trailer.mp4'],
  ]);
  const calls = account.calls();
  assert.ok(calls.includes(`r2 object put night-owls-media/videos/owl-trailer/owl-trailer.mp4 --file ${join(dir, 'videos/owl-trailer/owl-trailer.mp4')} --content-type video/mp4 --remote`), calls.join('\n'));
  assert.ok(calls.includes('r2 object get night-owls-media/videos/owl-trailer/owl-trailer.mp4 --remote --pipe'), 'read back from R2 to check it');
  const files = JSON.parse(readFileSync(join(dir, 'videos/manifest.json'), 'utf8')).items[0].files;
  assert.equal(files[0].r2.key, 'videos/owl-trailer/owl-trailer.mp4');
  assert.equal(files[0].r2.sha256, sha(bytes.trailer));
  assert.equal(files[0].r2.bytes, bytes.trailer.length);
  assert.equal(files[0].bytes, bytes.trailer.length);
  assert.equal(files[2].r2, undefined, 'the poster stays on the site');
  assert.deepEqual(readFileSync(join(dir, 'videos/owl-trailer/owl-trailer.mp4')), bytes.trailer, 'the file on this computer is never deleted or changed');
  assert.deepEqual(readFileSync(account.object('videos/owl-trailer/owl-trailer.mp4')), bytes.trailer);
  assert.equal(readFileSync(`${account.object('videos/owl-trailer/owl-trailer.mp4')}.type`, 'utf8'), 'video/mp4');

  // Again: nothing to do, nothing called.
  const before = account.calls().length;
  const again = out(run(['media', 'move'], dir));
  assert.deepEqual(again.moved, []);
  assert.equal(account.calls().length, before);
  // --verify reads every recorded file back and checks its hash again.
  const verified = out(run(['media', 'move', '--verify'], dir));
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.verified.map((v) => v.ok), [true, true]);
  account.corrupt(true);
  const verifyBad = out(run(['media', 'move', '--verify'], dir));
  assert.equal(verifyBad.ok, false);
  assert.ok(verifyBad.verified.every((v) => !v.ok && /different bytes/.test(v.why)));
  account.corrupt(false);
  assert.equal(out(run(['media', 'move', 'videos/nowhere.mp4'], dir)).rows.at(-1).state, 'unlisted');
});

test('deploy: big media goes to R2 first; the build stops carrying it; the Worker serves the same address from R2 with ranges, HEAD, 304 and the site\'s cache headers', async () => {
  const dir = studio('deploy');
  const account = r2Account(dir);
  const bytes = media(dir);
  withStorage(dir);
  const done = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.r2, 'night-owls-media');
  assert.deepEqual(done.media.moved.map((m) => m.path).sort(), ['videos/owl-trailer/owl-trailer-vertical.mp4', 'videos/owl-trailer/owl-trailer.mp4']);
  assert.ok(done.steps.some((s) => /moved videos\/owl-trailer\/owl-trailer\.mp4 .* checked it by SHA-256; the site serves it at the same address, \/videos\/owl-trailer\/owl-trailer\.mp4/.test(s.what)));
  assert.match(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8'), /"bucket_name": "night-owls-media"/);
  const dist = join(dir, 'site/dist');
  assert.equal(existsSync(join(dist, 'videos/owl-trailer/owl-trailer.mp4')), false, 'the deploy build no longer carries the moved file');
  assert.equal(existsSync(join(dist, 'videos/owl-trailer/owl-trailer-vertical.mp4')), false);
  assert.ok(existsSync(join(dist, 'videos/owl-trailer/poster.jpg')), 'a small committed file stays on the site');
  assert.ok(existsSync(join(dist, 'music/theme/theme-loop.ogg')));
  const cat = JSON.parse(readFileSync(join(dist, 'games.json'), 'utf8'));
  const vfiles = cat.videos[0].files;
  assert.deepEqual(vfiles.map((f) => [f.role, f.url, f.r2 ?? null]), [
    ['video', '/videos/owl-trailer/owl-trailer.mp4', 'videos/owl-trailer/owl-trailer.mp4'],
    ['vertical', '/videos/owl-trailer/owl-trailer-vertical.mp4', 'videos/owl-trailer/owl-trailer-vertical.mp4'],
    ['poster', '/videos/owl-trailer/poster.jpg', null],
  ], 'the same addresses as before; the catalogue names the R2 key of what the site does not carry');
  assert.doesNotMatch(JSON.stringify(cat), new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'no local path in the catalogue');

  const site = await siteOf(dir, account);
  const page = await (await site('/videos/owl-trailer/')).text();
  assert.match(page, /src="\/videos\/owl-trailer\/owl-trailer\.mp4"/, 'the page plays the same address');
  const whole = await site('/videos/owl-trailer/owl-trailer.mp4');
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('cache-control'), 'public, max-age=0, must-revalidate', 'the static files\' own cache headers');
  assert.equal(whole.headers.get('content-type'), 'video/mp4');
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal(Number(whole.headers.get('content-length')), bytes.trailer.length);
  assert.ok(whole.headers.get('etag'));
  assert.ok(whole.headers.get('last-modified'));
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), bytes.trailer);
  const part = await site('/videos/owl-trailer/owl-trailer.mp4', { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 100-199/${bytes.trailer.length}`);
  assert.equal(part.headers.get('content-length'), '100');
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.trailer.subarray(100, 200));
  const tail = await site('/videos/owl-trailer/owl-trailer.mp4', { headers: { range: 'bytes=-10' } });
  assert.equal(tail.status, 206);
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.trailer.subarray(bytes.trailer.length - 10));
  assert.equal((await site('/videos/owl-trailer/owl-trailer.mp4', { headers: { range: `bytes=${bytes.trailer.length + 5}-` } })).status, 416);
  const head = await site('/videos/owl-trailer/owl-trailer.mp4', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), bytes.trailer.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const etag = whole.headers.get('etag');
  const again = await site('/videos/owl-trailer/owl-trailer.mp4', { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304, 'a browser that has it is told so');
  assert.equal(again.headers.get('etag'), etag);
  // The poster is still a static file of the site; a key R2 has but the catalogue does not list is never served.
  const poster = await site('/videos/owl-trailer/poster.jpg');
  assert.equal(poster.status, 200);
  assert.equal(poster.headers.get('etag'), '"asset"');
  mkdirSync(dirname(account.object('videos/owl-trailer/secret.mp4')), { recursive: true });
  writeFileSync(account.object('videos/owl-trailer/secret.mp4'), 'not listed');
  assert.equal((await site('/videos/owl-trailer/secret.mp4')).status, 404, 'only files the catalogue lists come from R2');
  const wk = await (await site('/.well-known/homie-studio.json')).json();
  assert.equal(wk.videos[0].video, 'https://owls.test/videos/owl-trailer/owl-trailer.mp4', 'the directory reads the same address');

  // A local build (dev: wrangler dev's R2 is empty) still copies the file when it fits; Workers Builds builds as a deploy.
  assert.equal(out(run(['build'], dir)).ok, true);
  assert.ok(existsSync(join(dist, 'videos/owl-trailer/owl-trailer.mp4')), 'dev gets a local copy');
  assert.equal(out(run(['build'], dir, { WORKERS_CI: '1' })).ok, true);
  assert.equal(existsSync(join(dist, 'videos/owl-trailer/owl-trailer.mp4')), false, 'Workers Builds does not carry it');
  // A checkout without the media (another computer, Workers Builds): the manifest's record is enough.
  rmSync(join(dir, 'videos/owl-trailer/owl-trailer.mp4'));
  const ci = out(run(['build'], dir));
  assert.deepEqual(ci.videos, ['owl-trailer']);
  assert.equal(JSON.parse(readFileSync(join(dist, 'games.json'), 'utf8')).videos[0].files[0].r2, 'videos/owl-trailer/owl-trailer.mp4');
  writeFileSync(join(dir, 'videos/owl-trailer/owl-trailer.mp4'), bytes.trailer);

  // A re-cut at the same path: the next deploy uploads it again (checked), and the site keeps the address.
  const recut = randomBytes(1536 * 1024);
  writeFileSync(join(dir, 'videos/owl-trailer/owl-trailer.mp4'), recut);
  const plan = out(run(['media', 'move', '--dry-run'], dir));
  assert.equal(plan.rows.find((r) => r.path === 'videos/owl-trailer/owl-trailer.mp4').reason, 'changed since it went to R2');
  const redeploy = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.deepEqual(redeploy.media.moved.map((m) => m.path), ['videos/owl-trailer/owl-trailer.mp4']);
  assert.equal(JSON.parse(readFileSync(join(dir, 'videos/manifest.json'), 'utf8')).items[0].files[0].r2.sha256, sha(recut));
  assert.deepEqual(Buffer.from(await (await site('/videos/owl-trailer/owl-trailer.mp4')).arrayBuffer()), recut);
  // An upload that fails: the deploy goes on, says so, and the site carries the changed file (it fits).
  const recut2 = randomBytes(1200 * 1024);
  writeFileSync(join(dir, 'videos/owl-trailer/owl-trailer.mp4'), recut2);
  account.corrupt(true);
  const shaky = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  account.corrupt(false);
  assert.equal(shaky.ok, true);
  assert.match(shaky.media.failed[0].why, /stays on the site/);
  assert.ok(existsSync(join(dist, 'videos/owl-trailer/owl-trailer.mp4')), 'the changed file is carried by the site meanwhile');
  assert.ok(shaky.steps.some((s) => /changed since it went to R2/.test(s.what)));
});

test('studio.json media.r2Over: a size of its own, or false for nothing on its own (media move <file> still works); old /media/ keys are left alone', () => {
  const dir = studio('setting');
  const account = r2Account(dir);
  media(dir);
  withStorage(dir);
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  s.media = { r2Over: false };
  writeFileSync(join(dir, 'studio.json'), JSON.stringify(s, null, 2));
  const done = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.deepEqual(done.media.moved, []);
  assert.ok(!account.calls().some((c) => c.startsWith('r2 object')), 'nothing moved on its own');
  assert.ok(existsSync(join(dir, 'site/dist/videos/owl-trailer/owl-trailer.mp4')));
  const one = out(run(['media', 'move', 'videos/owl-trailer/poster.jpg'], dir));
  assert.deepEqual(one.moved.map((m) => m.path), ['videos/owl-trailer/poster.jpg'], 'a file named by hand moves');
  s.media = { r2Over: 100 * 1024 };
  writeFileSync(join(dir, 'studio.json'), JSON.stringify(s, null, 2));
  const plan = out(run(['media', 'move', '--dry-run'], dir));
  assert.equal(plan.rows.find((r) => r.path === 'music/theme/theme-loop.ogg').state, 'move', 'a 500 KB loop is over a 100 KB line');
  // A file from `media put` (before 0.18.0) keeps its /media/<key> address and is never moved again.
  const m = JSON.parse(readFileSync(join(dir, 'music/manifest.json'), 'utf8'));
  m.items[0].files[0].key = 'music/theme/theme-loop.ogg';
  writeFileSync(join(dir, 'music/manifest.json'), JSON.stringify(m, null, 2));
  assert.equal(out(run(['media', 'move', '--dry-run'], dir)).rows.find((r) => r.path === 'music/theme/theme-loop.ogg').state, 'media');
  assert.equal(out(run(['build'], dir)).ok, true);
  assert.equal(JSON.parse(readFileSync(join(dir, 'site/dist/games.json'), 'utf8')).songs[0].files[0].url, '/media/music/theme/theme-loop.ogg');
});

test('no storage: deploy asks R2 nothing, a file over 25 MiB is left out with the way to fix it, and upgrade says what storage would move', () => {
  const dir = studio('nostorage');
  const account = r2Account(dir);
  media(dir);
  writeFileSync(join(dir, 'videos/owl-trailer/owl-trailer.mp4'), Buffer.alloc(26 * 1024 * 1024, 7));
  const done = out(run(['deploy', '--homie', 'http://127.0.0.1:9'], dir));
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.media, undefined);
  assert.ok(!account.calls().some((c) => c.startsWith('r2')), 'no storage: R2 is never asked anything');
  const b = out(run(['build'], dir));
  const left = b.mediaSkipped.find((x) => x.file === 'videos/owl-trailer/owl-trailer.mp4');
  assert.match(left.why, /over the 25 MiB the site serves itself: give the studio storage/);
  assert.match(left.why, /media move/);
  const up = out(run(['upgrade'], dir));
  assert.ok(up.media, JSON.stringify(up).slice(0, 400));
  assert.equal(up.media.storage, null);
  assert.ok(up.media.big.some((x) => x.path === 'videos/owl-trailer/owl-trailer.mp4'));
  assert.match(up.media.next, /storage add/);
});
