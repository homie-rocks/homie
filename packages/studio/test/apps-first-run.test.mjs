import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newStudio } from '../lib/scaffold.mjs';
import { newApp } from '../lib/studio.mjs';
import { appProblems } from '../worker/app-format.mjs';
import { header } from '../worker/site.mjs';
import { deployOf } from '../../../plugins/homie/hooks/lib/commands.mjs';
const scratch = mkdtempSync(join(tmpdir(), 'first-app-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
test('A: fresh app declares its complete strict-build dependencies', async () => {
 const root = join(scratch, 'deps'); newStudio(root, { name: 'Cafe', install: false }); await newApp(root, 'quiz');
 const p = JSON.parse(readFileSync(join(root, 'package.json')));
 for (const n of ['three', '@types/three', '@homie-rocks/camera', '@homie-rocks/geom']) assert.ok(p.devDependencies[n], n);
});
test('D/F: a business scaffold starts with apps, creates pages, and documents landing takeover', () => {
 const root = join(scratch, 'business'); const r = newStudio(root, { name: 'Bike shop', kind: 'business', install: false });
 assert.match(r.next.join('\n'), /app new/); assert.doesNotMatch(r.next.join('\n'), /gem-rush|game skill/);
 assert.ok(existsSync(join(root, 'site/pages')));
 assert.match(readFileSync(join(root, 'site/README.md'), 'utf8'), /\/open/);
});
test('E: app words accept the app own complete interface vocabulary', () => {
 const a = JSON.parse(readFileSync(new URL('../app-starters/welcome/app.json', import.meta.url)));
 a.words.wallTitle = 'Welcome creekkeepers'; a.words.waiting = 'checked in';
 assert.deepEqual(appProblems(a), []);
});
test('F: header links custom pages and an existing shop', () => {
 const h = header({ studio: { name: 'Bike shop' }, games: [], site: { pages: ['/services/'] }, shop: { items: [{}] } });
 assert.match(h, /href="\/services\/"/); assert.match(h, /href="\/shop\/"/);
});
test('C: quoted documentation is not an executable deploy', () => {
 for (const c of ["printf '%s\\n' 'npm run deploy; homie-studio deploy' > docs.md", "cat <<'DOC' > docs.md\nnpm run deploy\nDOC", 'echo homie-studio deploy', 'node -e "console.log(\'npm run deploy; homie-studio deploy\')"']) assert.equal(deployOf(c), null, c);
 assert.ok(deployOf('cd studio && npm run deploy'));
});

test('G: local closed shop previews items and prices; live explains how to open', async () => {
 const { shopPage } = await import('../worker/shop-page.mjs');
 const shop = { currency: 'cad', items: [{ id: 'tune', name: 'Tune-up', price: 4500 }], policy: {}, refundDays: null };
 const local = await shopPage({ studio: { name: 'Bikes' } }, shop, { origin: 'http://127.0.0.1:8787' }).text();
 assert.match(local, /PREVIEW/); assert.match(local, /Tune-up/); assert.match(local, /45/);
 const live = await shopPage({ studio: { name: 'Bikes' } }, shop, { origin: 'https://bikes.example' }).text();
 assert.match(live, /Connect.*Stripe/);
});
test('H: giving preset uses studio currency and keeps monthly gift and receipt wording', async () => {
 const { shopInit } = await import('../lib/shop.mjs'); const { writeFileSync } = await import('node:fs');
 const root = join(scratch, 'giving'); newStudio(root, { name: 'Pantry', kind: 'cause', install: false });
 const file = join(root, 'studio.json'); const studio = JSON.parse(readFileSync(file)); studio.currency = 'cad'; writeFileSync(file, JSON.stringify(studio));
 assert.equal(shopInit(root, { giving: true }).ok, true);
 const shop = JSON.parse(readFileSync(join(root, 'shop.json')));
 assert.equal(shop.currency, 'cad'); assert.ok(shop.items.some(i => i.interval === 'month')); assert.equal(shop.giving.receiptText, '');
 assert.doesNotMatch(JSON.stringify(shop), /badge|beside your name/);
});
test('I: four advertised starters exist and declare their actual workflow', async () => {
 for (const from of ['giving', 'gathering', 'quiz', 'jobs']) {
  const root = join(scratch, from+'-starter'); newStudio(root, { name: from, install: false });
  const r = await newApp(root, 'demo', { from }); assert.equal(r.from, from);
  const meta = JSON.parse(readFileSync(join(root, 'apps/demo/app.json'))); assert.deepEqual(appProblems(meta), []);
  assert.notEqual(meta.check.action, '[data-join]');
 }
});
