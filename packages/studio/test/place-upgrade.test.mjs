import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {transform} from 'esbuild';
import {upgradePlaceView,upgradePlaceCodex} from '../lib/upgrade-places.mjs';
test('upgrade replaces a recognized records refresh timer with actual subscriptions',async()=>{
 const original=`import {createAppRecords} from '@homie-rocks/studio/apps';
 const records=createAppRecords({collection:'spots'});function refresh(){seen();}setInterval(refresh,2500);`;
 const updated=upgradePlaceView(original);let tick,reads=0,timers=0;
 const compiled=await transform(updated,{loader:'ts',format:'cjs'});
 runInNewContext(compiled.code,{require:()=>({createAppRecords:()=>({subscribe:fn=>{tick=fn;}})}),seen:()=>reads++,setInterval:()=>timers++});
 assert.equal(timers,0);assert.equal(reads,0);tick();assert.equal(reads,1);
 assert.equal(upgradePlaceView(updated),updated);
});
test('upgrade corrects exact obsolete capability notes without claiming old needs passed',()=>{
 const input='# Place\n\n## Limits\nThe runner has no staff surface or MCP step.\n\n## Needs\nOwner has not checked payments.\n';
 const expected='# Place\n\n## Limits\nThe toolkit supports staff surfaces and MCP needs. Rerun the needs; earlier manual evidence is not a passing proof.\n\n## Needs\nOwner has not checked payments.\n';
 assert.equal(upgradePlaceCodex(input),expected);assert.equal(upgradePlaceCodex(expected),expected);
});
