import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newStudio } from '../lib/scaffold.mjs';
import { newPart, partDir, readPart, writePart } from '../lib/parts.mjs';
import { sharePart } from '../lib/parts-store.mjs';
import { deploy } from '../lib/cloudflare.mjs';
import { readStudio, writeStudio } from '../lib/studio.mjs';

for (const stop of ['storage', 'migration', 'deploy', 'upload']) test(`paid deploy interrupted at ${stop} never uploads before guarded code`, async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'purchase-deploy-'));
  const root = join(scratch, 'studio');
  try {
    newStudio(root, { name: 'Purchase Test', install: false, homie: 'https://directory.invalid' });
    const pkg = new URL('..', import.meta.url).pathname;
    const modules = new URL('../../../node_modules/', import.meta.url).pathname;
    mkdirSync(join(root, 'node_modules', '@homie-rocks'), { recursive: true });
    symlinkSync(pkg, join(root, 'node_modules', '@homie-rocks', 'studio'));
    symlinkSync(join(modules, 'esbuild'), join(root, 'node_modules', 'esbuild'));
    const studio = readStudio(root);
    studio.cloudflare = { ...studio.cloudflare, accountId: 'account', r2: 'purchase-media', created: ['r2:purchase-media', `worker:${studio.cloudflare.worker}`, `d1:${studio.cloudflare.d1}`] };
    if (stop === 'storage') studio.cloudflare.r2 = null;
    writeStudio(root, studio);
    newPart(root, 'camera');
    const dir = partDir(root, 'camera');
    const part = readPart(dir);
    writeFileSync(join(dir, 'LICENSE.txt'), 'Commercial licence.');
    Object.assign(part, { license: 'LicenseRef-Studio-Commercial', licenseTerms: 'LICENSE.txt', attribution: 'Studio', summary: 'Camera', sale: { amount: 1000, currency: 'usd', billing: 'one-time', scope: 'studio', source: true, updates: 'none', refund: 'Ask the studio', onRefund: 'terminate', onExpiry: 'retain', commercialUse: true, transferable: false } });
    writePart(dir, part);
    assert.equal(sharePart(root, 'camera').ok, true);
    const bin = join(root, 'node_modules', '.bin'); mkdirSync(bin);
    const calls = join(scratch, 'calls');
    writeFileSync(join(bin, 'wrangler'), `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
const stop=${JSON.stringify(stop)};
if(args[0]==='whoami') console.log(JSON.stringify({loggedIn:true,authType:'OAuth Token',accounts:[{id:'account',name:'Studio'}]}));
else if(args[0]==='d1'&&args[1]==='list') console.log(JSON.stringify([{name:${JSON.stringify(studio.cloudflare.d1)},uuid:'22222222-2222-2222-2222-222222222222'}]));
else if(args[0]==='d1'&&args[1]==='migrations'&&stop==='migration') {console.error('injected migration failure');process.exit(1);}
else if(args[0]==='r2'&&args[1]==='bucket'&&args[2]==='list') console.log('[]');
else if(args[0]==='r2'&&args[1]==='object') {console.error('injected upload failure');process.exit(1);}
else if(args[0]==='deploy'&&stop==='deploy') {console.error('injected deploy failure');process.exit(1);}
else if(args[0]==='deploy') console.log('Deployed https://test-studio.acct.workers.dev');
else console.log('ok');
`, { mode: 0o755 });
    let result;
    try { result = await deploy(root); } catch (error) { assert.equal(stop, 'upload', error.message); }
    const trace = readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
    const upload = trace.findIndex((a) => a[0] === 'r2' && a[1] === 'object');
    if (stop === 'upload') {
      assert.ok(trace.findIndex((a) => a[0] === 'deploy') < upload);
      assert.ok(upload >= 0);
      assert.ok(trace.filter((a) => a[0] === 'r2' && a[1] === 'object').every((a) => a[3].startsWith('purchase-media-purchases/paid-parts/')));
    } else { assert.equal(result.ok, false); assert.equal(upload, -1); }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
