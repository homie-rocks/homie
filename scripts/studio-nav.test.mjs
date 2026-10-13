import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('studio uses the nav package flow baker without divergence',()=>{execFileSync(process.execPath,['scripts/studio-nav.mjs','--check']);});
