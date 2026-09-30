/**
 * WHICH CHROME THE CHECKS RUN, AND HOW (check, port check, look).
 *
 * On a Mac: that Mac's Chrome, on its GPU (`--use-angle=metal`). A software renderer runs a 3D game at a
 * few frames a second and makes it look stuck, so a Mac never falls back to one.
 *
 * On Linux (a Claude Code cloud session, GitHub Actions, a container) there is usually no GPU and often no
 * Chrome. `homie-studio chrome install` puts Chrome for Testing in this user's cache (from
 * storage.googleapis.com, which a Claude Code cloud session's default "Trusted" network reaches), and the
 * checks render WebGL with SwiftShader (`--enable-unsafe-swiftshader`, needed since Chrome 137), headless,
 * without the setuid sandbox when they run as root (as a container does). What they measure there is seats,
 * rooms and rounds on the room's own clock; a frame rate on SwiftShader is not a person's, so the checks
 * report it with the renderer's name and never judge it.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where `homie-studio chrome install` keeps Chrome for Testing (one copy per user, shared by every studio). */
export const CHROME_CACHE = join(homedir(), '.cache', 'homie-studio', 'chrome');

/** The newest build of `browser` in a @puppeteer/browsers or Playwright cache, or null. */
function newestIn(dir, rel) {
  if (!existsSync(dir)) return null;
  const builds = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  for (const b of builds) {
    for (const r of rel) {
      const path = join(dir, b, ...r);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

/** Chrome for this machine: CHROME_PATH, an installed Chrome, or one in a known cache. */
export function findChrome() {
  const fixed = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome',
  ].filter(Boolean);
  const found = fixed.find((p) => existsSync(p));
  if (found) return found;
  const home = homedir();
  return newestIn(join(CHROME_CACHE, 'chrome'), [['chrome-linux64', 'chrome'], ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'], ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing']])
    ?? newestIn(join(home, '.cache', 'puppeteer', 'chrome'), [['chrome-linux64', 'chrome']])
    ?? newestIn(join(home, '.cache', 'ms-playwright'), [['chrome-linux', 'chrome'], ['chrome-linux64', 'chrome']]);
}

/** Linux without a GPU renders with SwiftShader: say so with every number measured there. */
export const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software/i;

/** The launch flags for this machine (the GPU on a Mac; SwiftShader, headless and container-safe on Linux). */
export function chromeArgs() {
  if (process.platform === 'darwin') return ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'];
  return [
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage',
    ...(typeof process.getuid === 'function' && process.getuid() === 0 ? ['--no-sandbox'] : []),
  ];
}

/** Why there is no Chrome, and the one command that fixes it on this machine. */
export function noChrome() {
  return process.platform === 'linux'
    ? 'no Chrome on this machine: run `npx --no-install homie-studio chrome install` (Chrome for Testing into .cache/homie-studio in the home folder, from storage.googleapis.com), or set CHROME_PATH'
    : 'no Chrome found: install Google Chrome, or set CHROME_PATH';
}

/**
 * `homie-studio chrome install`: Chrome for Testing (stable) into CHROME_CACHE, through @puppeteer/browsers (it comes
 * with puppeteer-core). About 170 MB, once per user; a second run finds it and downloads nothing.
 */
export async function installChrome({ log = () => {} } = {}) {
  const existing = findChrome();
  if (existing) return { ok: true, command: 'chrome install', chrome: existing, already: true };
  let browsers;
  try { browsers = await import('@puppeteer/browsers'); } catch { return { ok: false, command: 'chrome install', why: '@puppeteer/browsers is missing (it comes with @homie-rocks/studio: npm install)' }; }
  const platform = browsers.detectBrowserPlatform();
  if (!platform) return { ok: false, command: 'chrome install', why: `Chrome for Testing has no build for ${process.platform} ${process.arch}` };
  const buildId = await browsers.resolveBuildId(browsers.Browser.CHROME, platform, 'stable');
  log(`downloading Chrome for Testing ${buildId} (${platform}) into ${CHROME_CACHE}`);
  const got = await browsers.install({ browser: browsers.Browser.CHROME, buildId, cacheDir: CHROME_CACHE });
  return { ok: true, command: 'chrome install', chrome: got.executablePath, buildId, platform };
}

/**
 * The frame rate a page's game frame draws at, over `ms` (requestAnimationFrame in the game's own frame, or the
 * page's), and the renderer WebGL reports there. Never throws: { fps: null } when it cannot tell.
 */
export async function measureFrames(page, ms = 2000) {
  const frame = page.frames().find((f) => /\/__game\//.test(f.url())) ?? page.mainFrame();
  // Runs inside the frame (puppeteer sends the function itself, so a game's CSP never blocks it).
  const probe = (span) => new Promise((resolve) => {
    let renderer = null;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
      renderer = gl ? String(d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL';
    } catch { renderer = null; }
    let n = 0;
    const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < span) requestAnimationFrame(tick); else resolve({ fps: Math.round((n * 1000) / (performance.now() - t0)), renderer }); };
    requestAnimationFrame(tick);
  });
  try {
    return await Promise.race([
      frame.evaluate(probe, ms),
      new Promise((r) => setTimeout(() => r({ fps: null, renderer: null }), ms + 5000)),
    ]);
  } catch { return { fps: null, renderer: null }; }
}
