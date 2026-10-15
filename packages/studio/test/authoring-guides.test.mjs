import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {authoringGuidance} from '../lib/authoring-guides.mjs';

test('older installed plugin guidance names the installed guides and update step',t=>{
  const home=mkdtempSync(join(tmpdir(),'homie-guidance-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const dir=join(home,'.codex/plugins/cache/homie/homie/0.38.1/.codex-plugin');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'plugin.json'),JSON.stringify({version:'0.38.1'}));
  const g=authoringGuidance({home,version:'0.43.1'});
  assert.match(g.warning.join('\n'),/plugin 0.38.1 is older than toolkit 0.43.1/);assert.match(g.warning.join('\n'),/codex plugin marketplace upgrade homie/);assert.match(g.guides,/node_modules/);
  assert.equal(authoringGuidance({home,version:'0.38.1'}).warning.length,0);
});

test('check --json still tells an AI caller about installed version-matched guides',t=>{
  const root=mkdtempSync(join(tmpdir(),'homie-guidance-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Guides',slug:'guides'}));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../bin/homie-studio.mjs',import.meta.url)),'check','--json'],{cwd:root,encoding:'utf8',env:{...process.env,HOMIE_STUDIO_WARM:'0'}});
  assert.match(result.stderr,/Author against toolkit.*node_modules\/@homie-rocks\/studio\/guides\/game/);
  assert.equal(JSON.parse(result.stdout).command,'check');
});

test('D: app authoring guidance points at the shipped app skill', () => {
 const result = authoringGuidance({ kind: 'app' });
 assert.match(result.guides, /guides\/app\/$/);
 assert.equal(result.files, 'SKILL.md');
 assert.doesNotMatch(result.warning.join('\n'), /guides\/game/);
});
