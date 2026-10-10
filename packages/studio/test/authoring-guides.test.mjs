import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {authoringGuidance} from '../lib/authoring-guides.mjs';
test('npm authoring guides are byte-for-byte generated from the plugin source',()=>{
  for(const name of ['SKILL','RULES','REWRITE']) assert.equal(readFileSync(new URL(`../guides/game/${name}.md`,import.meta.url),'utf8'),readFileSync(new URL(`../../../plugins/homie/skills/game/${name}.md`,import.meta.url),'utf8'));
});
test('older installed plugin guidance names the installed guides and update step',t=>{
  const home=mkdtempSync(join(tmpdir(),'homie-guidance-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const dir=join(home,'.codex/plugins/cache/homie/homie/0.38.1/.codex-plugin');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'plugin.json'),JSON.stringify({version:'0.38.1'}));
  const g=authoringGuidance({home,version:'0.43.1'});
  assert.match(g.warning.join('\n'),/plugin 0.38.1 is older than toolkit 0.43.1/);assert.match(g.warning.join('\n'),/Update Homie/);assert.match(g.guides,/node_modules/);
  assert.equal(authoringGuidance({home,version:'0.38.1'}).warning.length,0);
});
