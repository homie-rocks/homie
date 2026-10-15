import { test } from 'node:test';
import assert from 'node:assert/strict';
import { header, gameLanding } from '../worker/site.mjs';
import { thanksPage } from '../worker/shop-page.mjs';
const app = { id: 'pantry', kind: 'app', name: 'A <B> & C', words: { open: 'Open place' }, players: { max: 32 } };
const cat = { studio: { name: 'River Pantry', kind: 'cause' }, games: [app], site: { pages: ['/about/'] }, shop: { giving: {}, items: [] } };
test('authored app pages have one navigation destination and escape supplied names', () => {
  const html = header({ ...cat, site: { pages: ['/about/', '/pantry/'] } });
  assert.equal([...html.matchAll(/href="\/pantry\/"/g)].length, 1);
  assert.ok(html.includes('A &lt;B&gt; &amp; C'));
  assert.ok(!html.includes(app.name));
});
test('landing and receipt actions retain their destinations', async () => {
  const landing = await gameLanding(cat, app).text();
  const receipt = await thanksPage(cat, { giving: {} }).text();
  assert.match(landing, /href="\/pantry\/open[^" ]*"/);
  assert.match(receipt, /href="\/"/);
});

test('app style starts with illustration and attributes AI refinements to the AI',async t=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {initDecisions,readDecisions,steerDecision,writeDecisions,directionsFor,pickDirection}=await import('../lib/decisions.mjs');
 const root=mkdtempSync(join(tmpdir(),'homie-app-style-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'apps/pantry'),{recursive:true});writeFileSync(join(root,'studio.json'),JSON.stringify(cat.studio));writeFileSync(join(root,'apps/pantry/app.json'),JSON.stringify(app));
 initDecisions(root,'pantry');assert.equal(readDecisions(root,'pantry').decisions['style.render'].value,'illustrated');
 const r=steerDecision(root,'pantry','style.palette','warmer',{by:'ai'});assert.equal(r.record.by,'ai');assert.equal(r.record.state,'auto');
 const doc=readDecisions(root,'pantry');doc.board={directions:directionsFor(root,'pantry').directions};writeDecisions(root,'pantry',doc);
 const picked=pickDirection(root,'pantry','b',{by:'ai'});assert.ok(picked.changed.length);
 for(const key of picked.changed){const row=readDecisions(root,'pantry').decisions[key];assert.equal(row.by,'ai');assert.equal(row.state,'auto');}
});
