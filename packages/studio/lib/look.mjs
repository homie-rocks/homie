/**
 * `homie-studio look [<path>...] --url <site> [--shots <dir>]` — the studio's pages as a stranger sees them:
 * each page on a computer (1440 x 900), a phone held upright (390 x 844) and the phone turned sideways
 * (844 x 390), scrolled to the end so everything that rises into view has, then shot whole and above the fold.
 * Measured on every shot: the answer's status, anything wider than the screen, whether the Play button is on the
 * first screen (Home and a game's landing), pictures that did not load, footage that did not play, and script errors. Pictures go to
 * `--shots` (default .studio/look/), which git ignores. One Chrome, closed at the end; its visits are house QA
 * (the studio's stats leave them out).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROMES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

export const LOOK_DEVICES = {
  computer: { width: 1440, height: 900, deviceScaleFactor: 1 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  sideways: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nameOf = (path) => path.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home';

export async function look({ url, paths, shots, devices = Object.keys(LOOK_DEVICES), log = () => {} }) {
  if (!url) return { ok: false, command: 'look', why: 'give --url (the local dev address or the live site)' };
  const chrome = CHROMES.find((p) => existsSync(p));
  if (!chrome) return { ok: false, command: 'look', why: 'no Chrome found (set CHROME_PATH)' };
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; } catch { return { ok: false, command: 'look', why: 'puppeteer-core is not installed (it comes with @homie-rocks/studio; run npm install)' }; }
  const base = String(url).replace(/\/+$/, '');
  mkdirSync(shots, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'homie-studio-look-'));
  // 150 s for Chrome to start: on a loaded computer a cold start has taken over a minute.
  const browser = await puppeteer.launch({
    executablePath: chrome, headless: true, userDataDir: profile, timeout: 150_000, protocolTimeout: 180_000,
    args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check'],
  });
  const rows = [];
  try {
    for (const path of paths) {
      for (const device of devices) {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e?.message ?? e).slice(0, 200)));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
        await page.setViewport(LOOK_DEVICES[device]);
        await page.setUserAgent(`${await browser.userAgent()} homie-studio-check look`);
        const t0 = Date.now();
        const res = await page.goto(`${base}${path}`, { waitUntil: 'networkidle2', timeout: 90_000 }).catch((e) => { errors.push(`open: ${e.message}`); return null; });
        const ms = Date.now() - t0;
        await sleep(900);
        const fold = await page.evaluate(() => {
          // Home and a game's landing lead with Play; other pages (a post, the rooms) are not judged on it.
          if (!['home', 'landing'].includes(document.body?.dataset?.page ?? '')) return { play: null };
          const play = [...document.querySelectorAll('.play')].find((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
          const r = play?.getBoundingClientRect();
          return { play: r ? r.bottom <= innerHeight && r.top >= 0 : false };
        });
        const foldFile = join(shots, `${nameOf(path)}-${device}-fold.png`);
        await page.screenshot({ path: foldFile });
        await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(innerHeight * 0.7)) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 110)); } window.scrollTo({ top: 0, behavior: 'instant' }); });
        await sleep(900);
        const facts = await page.evaluate(() => ({
          title: document.title,
          wide: [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > innerWidth + 1 && !e.closest('[data-hero-media],.nav,pre,.hero-media'); }).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}${e.className ? `.${String(e.className).split(' ')[0]}` : ''}`),
          brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map((i) => i.getAttribute('src')).slice(0, 5),
          footage: [...document.querySelectorAll('[data-hero-media] video')].map((v) => ({ playing: !v.paused && v.readyState >= 2, src: (v.currentSrc || '').split('/').pop() })),
          height: document.documentElement.scrollHeight,
        }));
        const file = join(shots, `${nameOf(path)}-${device}.png`);
        await page.screenshot({ path: file, fullPage: true });
        const row = {
          path, device, status: res?.status() ?? null, ms, title: facts.title, height: facts.height, playAboveFold: fold.play,
          tooWide: facts.wide, brokenImages: facts.brokenImages, footage: facts.footage, errors, shot: file, fold: foldFile,
        };
        const bad = [];
        if (!row.status || row.status >= 400) bad.push(`answered ${row.status}`);
        if (row.tooWide.length) bad.push(`wider than the screen: ${row.tooWide.join(', ')}`);
        if (row.playAboveFold === false && device !== 'sideways') bad.push('Play is not on the first screen');
        if (row.brokenImages.length) bad.push(`pictures that did not load: ${row.brokenImages.join(', ')}`);
        if (row.footage.some((f) => !f.playing)) bad.push('the hero footage did not play');
        if (errors.length) bad.push(`${errors.length} script error(s): ${errors[0]}`);
        row.ok = bad.length === 0;
        row.problems = bad;
        rows.push(row);
        log(`${row.ok ? 'ok  ' : 'LOOK'} ${path} ${device}: ${row.status} in ${ms} ms${bad.length ? ` · ${bad.join(' · ')}` : ''}`);
        await page.close();
      }
    }
  } finally {
    await browser.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
  writeFileSync(join(shots, 'look.json'), `${JSON.stringify(rows, null, 2)}\n`);
  return { ok: rows.every((r) => r.ok), command: 'look', url: base, shots, rows };
}
