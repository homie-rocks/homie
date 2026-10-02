/**
 * STILL PICTURES FROM THE ENGINE (free, on this computer): the style board's swatches, the lineup, the starter
 * library's thumbnails. assets/render-page.ts (three.js, GLTFLoader with meshopt) is bundled once by esbuild and run
 * in one headless Chrome on this computer's GPU (SwiftShader where there is none: slow, and fine for stills).
 *
 *   await withRenderer(async (r) => {
 *     const jpg = await r.swatch(tokens, models, { title })      // a data: URL
 *     const l = await r.lineup(models, tokens)                    // { front, quarter, silhouettes, rows }
 *     const t = await r.thumb({ id, glb })                        // { image, size }
 *   });
 *
 * Models go in as { id, glb: <base64>, label }. Nothing is fetched but Google Fonts (the swatch's title font).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeArgs, findChrome, noChrome } from './chrome.mjs';
import { PACKAGE_ROOT } from './studio.mjs';

let bundled = null;

/** The render page's script, bundled with three.js from wherever this package's dependencies are installed. */
export async function renderScript() {
  if (bundled) return bundled;
  let esbuild;
  try { esbuild = await import('esbuild'); } catch { throw new Error('esbuild is not installed (it comes with @homie-rocks/studio: npm install)'); }
  const res = await (esbuild.default ?? esbuild).build({
    entryPoints: [join(PACKAGE_ROOT, 'assets', 'render-page.ts')], bundle: true, format: 'iife', target: 'es2022', minify: true, write: false,
    absWorkingDir: PACKAGE_ROOT, logLevel: 'silent', platform: 'browser',
  }).catch((error) => { throw new Error(`the render page did not build: ${error.errors?.[0]?.text ?? error.message} (three.js comes with @homie-rocks/studio: npm install)`); });
  bundled = res.outputFiles[0].text;
  return bundled;
}

/** Model bytes as the page takes them. */
export const modelIn = (id, bytes, extra = {}) => ({ id, glb: Buffer.from(bytes).toString('base64'), ...extra });

/** A data: URL into bytes. */
export function dataUrlBytes(url) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(url));
  if (!m) throw new Error('not a base64 data: URL');
  return { type: m[1], bytes: Buffer.from(m[2], 'base64') };
}
export function saveDataUrl(url, file) { const { bytes } = dataUrlBytes(url); writeFileSync(file, bytes); return bytes.length; }

/**
 * Run `fn` with a renderer: { swatch, lineup, thumb, renderer: 'the WebGL renderer name' }. One Chrome for the whole
 * call, closed after. Throws in plain words when there is no Chrome or no WebGL.
 */
export async function withRenderer(fn, { log = () => {} } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error(noChrome());
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; } catch { throw new Error('puppeteer-core is not installed (it comes with @homie-rocks/studio: npm install)'); }
  const script = await renderScript();
  const profile = mkdtempSync(join(tmpdir(), 'homie-render-'));
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: profile, timeout: 150_000, protocolTimeout: 300_000, args: [...chromeArgs(), '--no-first-run', '--no-default-browser-check', '--hide-scrollbars'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e?.message ?? e).slice(0, 300)));
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block}</style></head><body></body></html>', { waitUntil: 'load' });
    await page.addScriptTag({ content: script });
    const ok = await page.waitForFunction(() => window.homieRender?.ready === true, { timeout: 60_000 }).then(() => true).catch(() => false);
    if (!ok) throw new Error(`the render page did not start${errors.length ? `: ${errors[0]}` : ''}`);
    const renderer = await page.evaluate(() => { try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return gl ? String(d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL'; } catch { return null; } });
    log(`rendering on ${renderer}`);
    const call = (name, ...args) => page.evaluate((n, a) => window.homieRender[n](...a), name, args).catch((e) => { throw new Error(`${name} failed: ${errors.at(-1) ?? e.message}`); });
    return await fn({
      renderer,
      swatch: (tokens, models = [], opts = {}) => call('swatch', tokens, models, opts),
      lineup: (models, tokens, opts = {}) => call('lineup', models, tokens, opts),
      thumb: (model, opts = {}) => call('thumb', model, opts),
    });
  } finally {
    await browser.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
}

