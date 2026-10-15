import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureRun } from './studio-fixture.mjs';

test('fixture copies isolate mutations, reuse identical inputs, and execute rebuilds and changed inputs', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fixture-contract-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = join(root, 'cli.mjs');
  const calls = join(root, 'calls');
  writeFileSync(cli, `import {appendFileSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
    appendFileSync(${JSON.stringify(calls)}, 'call\\n');
    mkdirSync('site/dist',{recursive:true});
    writeFileSync('site/dist/output',readFileSync('input'));
    console.log(JSON.stringify({ok:true,root:process.cwd()}));`);
  const make = (name, text) => { const dir = join(root,name); mkdirSync(dir); writeFileSync(join(dir,'input'),text); return dir; };
  const a = make('a','unique fixture input');
  const b = make('b','unique fixture input');
  assert.equal(fixtureRun(cli,['build'],a).status,0);
  assert.equal(fixtureRun(cli,['build'],b).status,0);
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,1);
  writeFileSync(join(a,'site/dist/output'),'mutated');
  assert.equal(readFileSync(join(b,'site/dist/output'),'utf8'),'unique fixture input');
  assert.equal(JSON.parse(fixtureRun(cli,['build'],b).stdout).root,b);
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,2);
  const c = make('c','different input');
  fixtureRun(cli,['build'],c);
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,3);
  const d = make('d','unique fixture input');
  mkdirSync(join(d,'node_modules')); writeFileSync(join(d,'node_modules','mock-module'),'different dependency');
  fixtureRun(cli,['build'],d);
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,4);
  const e = make('e','unique fixture input');
  mkdirSync(join(e,'.studio')); writeFileSync(join(e,'.studio','progress.json'),'active progress');
  fixtureRun(cli,['build'],e);
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,5);


});

test('cached scaffolds retain an independent Git repository', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fixture-git-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = join(root, 'new.mjs');
  writeFileSync(cli, `import {mkdirSync,writeFileSync} from 'node:fs';
    import {execFileSync} from 'node:child_process';
    const dir=process.argv[3]; mkdirSync(dir);
    writeFileSync(dir+'/input','fresh');execFileSync('git',['init','-q',dir]);
    console.log(JSON.stringify({ok:true}));`);
  const a = join(root,'first'), b = join(root,'second');
  assert.equal(fixtureRun(cli,['new',a,'--no-install'],root).status,0);
  assert.equal(fixtureRun(cli,['new',b,'--no-install'],root).status,0);
  assert.equal(execFileSync('git',['rev-parse','--show-toplevel'],{cwd:b,encoding:'utf8'}).trim(),b);
  writeFileSync(join(a,'.git','description'),'first only');
  assert.notEqual(readFileSync(join(b,'.git','description'),'utf8'),'first only');
});
