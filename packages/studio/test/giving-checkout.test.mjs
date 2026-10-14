import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { findChrome, chromeArgs } from '../lib/chrome.mjs';

test('giving phone opens the selected monthly Checkout; disconnected shop is a disabled preview', { skip: !process.env.CHROME_PATH }, async t => {
 const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: chromeArgs() });
 t.after(() => browser.close());
 const entry = new URL('../app-starters/giving/src/view.ts', import.meta.url).pathname;
 const bundled = await build({ entryPoints: [entry], bundle: true, write: false, plugins: [{ name: 'shell-fixture', setup(b) {
  b.onResolve({ filter: /^@homie-rocks\/studio\/(shop|rules\/view)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('/shop') ? `export const createShop=()=>({catalog:async()=>window.fixture, buy:async(...args)=>{window.bought=args;return true},open:()=>{},on:()=>{}})` : `export const openRoom=()=>({net:{params:{role:'customer'},link:'online',playable(){}}})` }));
 } }] });
 const page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 });
 const html = readFileSync(new URL('../app-starters/giving/index.html', import.meta.url), 'utf8').replace('<script type="module" src="./assets/main.js"></script>', '');
 const fixture = { open: true, currency: 'cad', currencyScale: 100, items: [
  { id: 'once', kind: 'donation', name: 'One-time gift', price: 2000, shown: 'CA$20.00', way: 'buy' },
  { id: 'monthly', kind: 'donation', name: 'Monthly gift', price: 2000, interval: 'month', shown: 'CA$20.00', way: 'buy' },
  { id: 'custom', kind: 'donation', name: 'Choose your monthly gift', price: 'choose', interval: 'month', min: 500, max: 10000, shown: 'CA$5.00 or more', way: 'buy' },
 ] };
 const load = async open => { await page.setContent(html); await page.evaluate(f => { window.fixture=f;window.bought=null; }, { ...fixture, open }); await page.addScriptTag({ content: bundled.outputFiles[0].text }); };
 await load(true);
 await page.select('#monthly', 'month'); await page.select('#choice', 'monthly'); await page.click('[data-action]');
 assert.deepEqual(await page.evaluate(() => window.bought), ['monthly', 1, null]);
 assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'phone has no horizontal overflow');
 await page.select('#choice', 'custom'); await page.type('input', '20'); await page.click('[data-action]');
 assert.deepEqual(await page.evaluate(() => window.bought), ['custom', 1, 2000]);
 assert.equal(await page.$eval('#goal', e => e.hidden), true, 'no unverified collected total');
 await load(false); await page.select('#monthly', 'month');
 assert.equal(await page.$eval('[data-action]', e => e.disabled), true);
 assert.equal(await page.evaluate(() => window.bought), null);
 assert.equal(await page.$$eval('#choice option', es => es.length), 2, 'gift options remain visible');
});
