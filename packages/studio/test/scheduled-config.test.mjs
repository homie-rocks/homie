import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newStudio} from '../lib/scaffold.mjs';
import {refreshWorkerConfig} from '../lib/worker-config.mjs';

const read=root=>JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,''));
test('declared schedule retains its generated trigger when a studio has custom triggers',t=>{
 const root=mkdtempSync(join(tmpdir(),'scheduled-config-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 newStudio(root,{name:'Cleanup',install:false,kind:'business'});
 mkdirSync(join(root,'site/src/functions'),{recursive:true});
 writeFileSync(join(root,'site/src/functions/declarations.json'),JSON.stringify([{name:'cleanup',event:'cleanup.tick',schedule:'*/15 * * * *'}]));
 writeFileSync(join(root,'wrangler.custom.json'),JSON.stringify({triggers:{crons:[]}}));
 refreshWorkerConfig(root);
 assert.ok(read(root).triggers.crons.length,'a declared schedule must install a trigger even with an empty custom cron list');
});

test('cron ownership survives refresh and upgrade; removing schedules removes only generated entries',async t=>{
 const root=mkdtempSync(join(tmpdir(),'scheduled-ownership-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 newStudio(root,{name:'Cleanup',install:false,kind:'business'});
 const declarations=join(root,'site/src/functions/declarations.json');mkdirSync(join(root,'site/src/functions'),{recursive:true});
 writeFileSync(declarations,JSON.stringify([{name:'cleanup',event:'tick',schedule:'*/15 * * * *'}]));
 const own='0 2 * * *';writeFileSync(join(root,'wrangler.custom.json'),JSON.stringify({triggers:{crons:[own]},vars:{OWN:'kept'}}));
 refreshWorkerConfig(root);assert.deepEqual(read(root).triggers.crons,['*/15 * * * *',own]);
 const first=readFileSync(join(root,'wrangler.jsonc'),'utf8');refreshWorkerConfig(root);assert.equal(readFileSync(join(root,'wrangler.jsonc'),'utf8'),first);
 const {upgradeApply,upgradePlan}=await import('../lib/upgrade.mjs');upgradeApply(root,upgradePlan(root));
 assert.deepEqual(read(root).triggers.crons,['*/15 * * * *',own]);
 writeFileSync(declarations,'[]');refreshWorkerConfig(root);assert.deepEqual(read(root).triggers.crons,[own]);assert.equal(read(root).vars.OWN,'kept');
 writeFileSync(join(root,'wrangler.custom.json'),'{}');refreshWorkerConfig(root);assert.deepEqual(read(root).triggers.crons,[],'removing custom entries is respected');
});

test('last schedule clears remote triggers explicitly and preserves identical custom entries',t=>{
 const root=mkdtempSync(join(tmpdir(),'scheduled-remove-'));t.after(()=>rmSync(root,{recursive:true,force:true}));newStudio(root,{name:'Cleanup',install:false});
 mkdirSync(join(root,'site/src/functions'),{recursive:true});const declarations=join(root,'site/src/functions/declarations.json');
 writeFileSync(declarations,JSON.stringify([{name:'cleanup',event:'tick',schedule:'*/15 * * * *'}]));refreshWorkerConfig(root);
 writeFileSync(declarations,'[]');refreshWorkerConfig(root);assert.deepEqual(read(root).triggers.crons,[]);
 writeFileSync(join(root,'wrangler.custom.json'),JSON.stringify({triggers:{crons:['*/15 * * * *']}}));
 writeFileSync(declarations,JSON.stringify([{name:'cleanup',event:'tick',schedule:'*/15 * * * *'}]));refreshWorkerConfig(root);
 writeFileSync(declarations,'[]');refreshWorkerConfig(root);assert.deepEqual(read(root).triggers.crons,['*/15 * * * *']);
});

import {parseSchedule,nextDue,scheduleTrigger,scheduleStatus} from '../worker/function-schedule.mjs';
test('Cloudflare UTC expressions match lists, ranges, steps, names and calendar extensions',()=>{
 const cases=[['*/15 * * * *','2026-10-13T09:15:00Z'],['0 9 * * 1','2026-10-18T09:00:00Z'],['0 9 * JAN,OCT MON-FRI','2026-10-13T09:00:00Z'],['0 9 L * *','2026-10-31T09:00:00Z'],['59 23 LW * *','2026-10-30T23:59:00Z'],['0 9 1W * *','2026-08-03T09:00:00Z'],['0 18 * * FRIL','2026-10-30T18:00:00Z'],['0 9 * * MON#2','2026-10-12T09:00:00Z']];
 for(const [cron,time] of cases){assert.equal(parseSchedule(cron).matches(Date.parse(time)),true,cron);assert.equal(nextDue(cron,Date.parse(time)-60000),Date.parse(time),cron);}
 for(const cron of ['60 * * * *','*/0 * * * *','0 25 * * *','0 9 * * 0','0 9 * * BOGUS','0 9 * * MON#6','* * * *',''])assert.throws(()=>parseSchedule(cron),undefined,cron);
 assert.equal(nextDue('0 0 30 FEB *'),null);
 const defs=[{schedule:'*/15 * * * *'},{schedule:'7 * * * *'}],tick=scheduleTrigger(defs);
 for(let minute=0;minute<60;minute++)if(minute%15===0||minute===7)assert.equal(parseSchedule(tick).matches(Date.UTC(2026,9,13,9,minute)),true);
 assert.equal(scheduleTrigger([]),null);
 assert.match(scheduleStatus([{name:'x',schedule:'bad'}],[])[0].status,/Cannot run/);
 assert.match(scheduleStatus([{name:'x',schedule:'*/15 * * * *'}],[])[0].status,/no configured trigger/);
});
