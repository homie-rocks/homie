/** Local media preparation and completed-output import tests. No provider clients or credentials. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..');
const ART = join(PLUGIN, 'skills', 'art', 'scripts', 'art.mjs');
const STUDIO_PKG = join(PLUGIN, '..', '..', 'packages', 'studio');
const REPO_NM = join(PLUGIN, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-art-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function studio(name) {
  const dir = join(scratch, name);
  const r = spawnSync(process.execPath, [join(STUDIO_PKG, 'bin', 'homie-studio.mjs'), 'new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(STUDIO_PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'puppeteer-core'), join(dir, 'node_modules', 'puppeteer-core'));
  const g = spawnSync(process.execPath, [join(STUDIO_PKG, 'bin', 'homie-studio.mjs'), 'game', 'new', 'gem', '--from', 'gem-rush', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(g.status, 0, g.stdout + g.stderr);
  return dir;
}
const ffmpeg = (...args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };



test('art: a cover cropped into the game and named in game.json; tiling, fitting and a contact sheet', () => {
  const dir = studio('free');
  const run = (args) => { const r = spawnSync(process.execPath, [ART, ...args, '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); return JSON.parse(r.stdout); };
  mkdirSync(join(dir, 'art', 'frames'), { recursive: true });
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=2400x1200:d=1', '-frames:v', '1', join(dir, 'art', 'frames', 'wide.png'));
  const c = run(['cover', 'gem', '--from', 'art/frames/wide.png', '--focus', '0.3,0.5']);
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.cover, 'games/gem/public/cover.jpg');
  assert.equal(JSON.parse(readFileSync(join(dir, 'games', 'gem', 'game.json'), 'utf8')).cover, 'cover.jpg');
  mkdirSync(join(dir, 'apps', 'welcome'), { recursive: true });
  writeFileSync(join(dir, 'apps', 'welcome', 'app.json'), JSON.stringify({ id: 'welcome', name: 'Welcome' }));
  const appCover = run(['cover', 'welcome', '--from', 'art/frames/wide.png']);
  assert.equal(appCover.ok, true, JSON.stringify(appCover));
  assert.equal(appCover.cover, 'apps/welcome/public/cover.jpg');
  assert.equal(JSON.parse(readFileSync(join(dir, 'apps/welcome/app.json'))).cover, 'cover.jpg');
  assert.equal(existsSync(join(dir, 'games/welcome')), false);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(dir, 'games', 'gem', 'public', 'cover.jpg')], { encoding: 'utf8' }).stdout.trim();
  assert.equal(probe, '1600,900');
  assert.ok(statSync(join(dir, 'games', 'gem', 'public', 'cover.jpg')).size <= 400 * 1024);
  // A texture of whole sine periods tiles; a gradient does not.
  ffmpeg('-f', 'lavfi', '-i', 'color=c=black:s=512x512:d=1', '-vf', "geq=lum='128+100*sin(2*PI*X/64)*cos(2*PI*Y/128)':cb=128:cr=128", '-frames:v', '1', join(dir, 'art', 'frames', 'tiles.png'));
  ffmpeg('-f', 'lavfi', '-i', 'color=c=black:s=512x512:d=1', '-vf', "geq=lum='X/2':cb=128:cr=128", '-frames:v', '1', join(dir, 'art', 'frames', 'ramp.png'));
  const good = run(['tile', join(dir, 'art', 'frames', 'tiles.png')]);
  const bad = run(['tile', join(dir, 'art', 'frames', 'ramp.png')]);
  assert.equal(good.tiles, true, JSON.stringify(good));
  assert.equal(bad.tiles, false, JSON.stringify(bad));
  assert.ok(existsSync(good.preview));
  const f = run(['fit', join(dir, 'art', 'frames', 'wide.png'), '--out', join(dir, 'games', 'gem', 'public', 'art', 'bg.jpg'), '--width', '800', '--max-kb', '120']);
  assert.equal(f.ok, true, JSON.stringify(f));
  assert.ok(f.kb <= 120);
  assert.equal(f.size, '800x400');
  const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
  if (chrome) {
    const s = run(['sheet', join(dir, 'art', 'frames')]);
    assert.equal(s.ok, true, JSON.stringify(s));
    assert.ok(existsSync(s.sheet));
  }
});
