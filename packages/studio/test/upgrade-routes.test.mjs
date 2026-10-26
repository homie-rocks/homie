import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newStudio} from '../lib/scaffold.mjs';
import {refreshWorkerConfig} from '../lib/worker-config.mjs';
import {upgradeApply,upgradePlan} from '../lib/upgrade.mjs';

const read=root=>JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,''));
const built=(root,games)=>{mkdirSync(join(root,'site/dist'),{recursive:true});writeFileSync(join(root,'site/dist/games.json'),JSON.stringify({games}));};

test('an upgrade in a fresh checkout (no build output) keeps the game routes the last build wrote',t=>{
 const root=mkdtempSync(join(tmpdir(),'upgrade-routes-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 newStudio(root,{name:'Routes',install:false});
 built(root,[{id:'rally',kind:'game'},{id:'desk',kind:'app'}]);
 refreshWorkerConfig(root);
 const before=read(root).assets.run_worker_first;
 for(const r of ['/rally','/rally/*','!/games/rally/assets/*','/desk/*'])assert.ok(before.includes(r),r);
 // A fresh clone: site/dist is git-ignored, so it is not there.
 rmSync(join(root,'site/dist'),{recursive:true,force:true});
 upgradeApply(root,upgradePlan(root));
 assert.deepEqual(read(root).assets.run_worker_first,before,'the upgrade must not drop game routes because nothing is built yet');
 refreshWorkerConfig(root);
 assert.deepEqual(read(root).assets.run_worker_first,before,'a refresh without build output keeps them too');
 // The next build is the truth again: a removed game's routes go.
 built(root,[{id:'desk',kind:'app'}]);
 refreshWorkerConfig(root);
 const after=read(root).assets.run_worker_first;
 assert.ok(after.includes('/desk/*'));
 assert.ok(!after.includes('/rally')&&!after.includes('!/games/rally/assets/*'));
});

test('without build output or an earlier config, the toolkit routes are the default',t=>{
 const root=mkdtempSync(join(tmpdir(),'upgrade-routes-new-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 newStudio(root,{name:'Fresh',install:false});
 rmSync(join(root,'wrangler.jsonc'),{force:true});
 refreshWorkerConfig(root);
 const routes=read(root).assets.run_worker_first;
 assert.ok(Array.isArray(routes)&&routes.includes('/games/*')&&routes.includes('/api/*'));
});
