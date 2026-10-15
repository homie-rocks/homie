import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {saveAppNeeds} from '../lib/app-needs.mjs';
test('outside shots are copied into durable studio evidence',t=>{
 const root=mkdtempSync(join(tmpdir(),'selling-evidence-')),external=mkdtempSync(join(tmpdir(),'selling-shots-'));t.after(()=>{rmSync(root,{recursive:true,force:true});rmSync(external,{recursive:true,force:true});});
 const file=join(external,'phone.jpg');writeFileSync(file,'image bytes');
 saveAppNeeds(root,'cafe',{hash:'fixture'},[{id:'buy',captures:[file]}]);
 const saved=JSON.parse(readFileSync(join(root,'.studio/checks/cafe-needs.json')));
 const capture=saved.needs[0].captures[0];assert.equal(relative(root,resolve(root,capture)).startsWith('..'),false);assert.equal(capture.startsWith('/'),false);assert.equal(readFileSync(resolve(root,capture),'utf8'),'image bytes');
});
