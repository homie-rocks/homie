import {tmpdir} from 'node:os';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {StudioContext,toolDefs} from '../lib/mcp-tools.mjs';
import {readStudio} from '../lib/studio.mjs';
import {deployPlan} from '../lib/cloudflare.mjs';

test('an MCP directory connection is not consent to list a new studio',async t=>{
 const root=mkdtempSync(join(tmpdir(),'homie-scaffold-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const ctx=new StudioContext({studiosDir:root,directory:'https://homie.rocks',install:false});
 const result=await toolDefs(ctx).find(tool=>tool.name==='studio_scaffold').run({name:'Private Proof'});
 assert.notEqual(result.isError,true);
 assert.equal(readStudio(ctx.root()).homie.directory,null);
 assert.equal(deployPlan(ctx.root()).directory.requested,false);
});

test('explicit listings and existing studios retain their directory choice',async t=>{
 const {newStudio}=await import('../lib/scaffold.mjs');
 const root=mkdtempSync(join(tmpdir(),'homie-listed-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 newStudio(root,{name:'Listed Proof',homie:'https://directory.example',install:false});
 newStudio(root,{name:'Listed Proof',install:false});
 assert.equal(readStudio(root).homie.directory,'https://directory.example');
 assert.equal(deployPlan(root).directory.requested,true);
});
