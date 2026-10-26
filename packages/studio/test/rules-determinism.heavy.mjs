/** The served browser adapter and server host agree at each tick, including repeated handovers. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { PKG, esbuildOf, writeGame } from './rules-kit.mjs';
import { source, vocab } from './rules-feature-kit.mjs';
import { prepareRules, viewPlugin } from '../lib/rules-build.mjs';
import { chromeArgs, findChrome } from '../lib/chrome.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-rules-equality-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
let built;
async function kit() {
  if (built) return built;
  const esbuild = await esbuildOf();
  const dir = writeGame(scratch, 'equality', { rules: source.replace('seconds: 3', 'seconds: 60') });
  mkdirSync(join(dir, 'map'), { recursive: true }); writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-100, -100], max: [100, 100] } }));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify(vocab));
  const g = { id: 'equality', dir, players: { max: 4 }, room: { host: 'browser' } };
  const rules = await prepareRules(esbuild, scratch, g);
  const entry = `import def from 'homie:rules'; import { makeHost } from 'homie:host';
import { createHost } from ${JSON.stringify(join(PKG, 'rules/host.ts'))};
import { compileRules, compileMap } from ${JSON.stringify(join(PKG, 'rules/rules.ts'))};
import { fromBytes, toBytes } from ${JSON.stringify(join(PKG, 'rules/pack.ts'))};
const data = ${JSON.stringify({ ...rules, code: undefined, files: undefined })};
const vocabulary = ${JSON.stringify(vocab)};
export function replay(browser, handover) {
  const originalRandom = Math.random, originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let now = 0, seq = 0, timers = new Map(), host;
  Math.random = () => 0.37;
  globalThis.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  const peers = [{ id: 'one', seat: 0, occ: 1, name: 'One' }, { id: 'two', seat: 1, occ: 2, name: 'Two' }];
  const policy = { kind: 'beginner', guides: 1, aiSeats: 0, bots: 'fill', brain: 'script' };
  const compiled = compileRules(def, { ...data, map: compileMap(data.map) });
  let epoch = 0, tick = 0;
  const send = m => { if (m.t === 'snap') { epoch = m.e; tick = m.k; } };
  const start = save => {
    if (browser) host = makeHost({ now: () => now, peers, policy, restore: save, send, onEnd: why => { throw Error(why); } });
    else host = createHost({ game: 'equality', compiled, restore: save ? toBytes(save.data) : null, startPaused: false, restoreEpoch: Math.floor(0.37 * 4294967296), send,
      clock: { now: () => now, setTimer: globalThis.setTimeout, clearTimer: globalThis.clearTimeout } });
    if (!browser) host.frame({ t: 'vocabulary', vocab: vocabulary }); host.frame({ t: 'policy', policy });
    for (const peer of peers) host.frame({ t: 'join', peer }); host.start();
  };
  const save = () => browser ? host.save() : { rules: data.build, data: fromBytes(host.save()) };
  const records = [];
  try {
    start(null);
    for (let i = 0; i < 2400; i++) {
      if (handover && i && i % 137 === 0) { const s = save(); host.stop(); start(s); }
      for (const seat of [0, 1]) host.frame({ t: 'in', from: seat, e: epoch, k: tick + 1, r: 0, s: [[0, (i % 80 < 40 ? 1 : -1) * (seat ? 40 : 60)]] });
      if (i % 200 === 5) host.frame({ t: 'ev', from: 0, k: 'ask:follow', d: { slot: 3, args: { seat: 0 } } });
      now += 50;
      const due = [...timers].filter(([, t]) => t.at <= now);
      for (const [id, t] of due) { timers.delete(id); t.fn(); }
      records.push(JSON.stringify(save().data));
    }
    return records;
  } finally { host?.stop(); Math.random = originalRandom; globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
}
export default { fetch() { return Response.json([replay(false, false), replay(true, false), replay(false, true), replay(true, true)]); } };`;
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: scratch }, bundle: true, format: 'esm', write: false, plugins: [viewPlugin(g, rules, '')] });
  const text = bundle.outputFiles[0].text; const file = join(scratch, 'equality.mjs'); writeFileSync(file, text);
  const mod = await import(pathToFileURL(file).href);
  built = { text, mod }; return built;
}
const digest = values => createHash('sha256').update(JSON.stringify(values)).digest('hex');
test('server and browser saves match at all 2400 ticks, with and without handovers', async () => {
  const { mod } = await kit();
  for (const handover of [false, true]) {
    const a = mod.replay(false, handover), b = mod.replay(true, handover);
    for (let i = 0; i < a.length; i++) assert.equal(b[i], a[i], `tick ${i + 1}, handover=${handover}`);
    assert.equal(digest(b), digest(a));
  }
});

test('workerd agrees with Node at every tick', { skip: !process.env.HOMIE_TEST_MINIFLARE && 'set HOMIE_TEST_MINIFLARE to the installed module' }, async () => {
  const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(process.env.HOMIE_TEST_MINIFLARE).href);
  const { text, mod } = await kit();
  const options = { modules: true, script: text, compatibilityDate: '2026-10-01' };
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  try {
    const reply = await (await mf.dispatchFetch('http://room/')).json();
    const expected = [mod.replay(false, false), mod.replay(true, false), mod.replay(false, true), mod.replay(true, true)];
    assert.deepEqual(reply.map(digest), expected.map(digest));
  } finally { await mf.dispose(); }
});

test('Chrome agrees with Node at every tick', { timeout: 60000 }, async () => {
  const { text, mod } = await kit();
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: chromeArgs(), userDataDir: join(scratch, 'chrome') });
  try {
    const page = await browser.newPage();
    const results = await page.evaluate(async code => { const m = await import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); return [m.replay(false, false), m.replay(true, false), m.replay(false, true), m.replay(true, true)]; }, text);
    assert.deepEqual(results.map(digest), [mod.replay(false, false), mod.replay(true, false), mod.replay(false, true), mod.replay(true, true)].map(digest));
  } finally { await browser.close(); }
});
