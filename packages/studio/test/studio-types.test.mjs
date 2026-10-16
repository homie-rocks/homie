import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
test('TypeScript consumers can pass asserted handles and preserve remote trust metadata',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hm-s2s-types-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'consumer.ts'),api=fileURLToPath(new URL('../tools/tools',import.meta.url));
 writeFileSync(path,`import type {ToolContext} from ${JSON.stringify(api)};
 declare const ctx:ToolContext;
 async function run(){
  const result=await ctx.studios.call('https://venue.example','book',{}, {assertedHandle:'guest-42'});
  const untrusted:true=result.untrusted;
  const authenticated:boolean=result.source.authenticated;
  const origin:string=result.source.origin;
  const tools=await ctx.studios.listTools(origin,{assertedHandle:'guest-42'});
  const descriptionUntrusted:true=tools.tools[0].untrusted;
  const method:'private_key_jwt'|undefined=ctx.caller.studio?.method;
  const handle:string|undefined=ctx.caller.actingFor?.assertedHandle;
  const address:string|undefined=ctx.caller.clientAddressKey;
  // @ts-expect-error Old handle option must not silently discard identity.
  await ctx.studios.call(origin,'book',{}, {actingFor:'guest-42'});
 }`);
 const program=ts.createProgram([path],{noEmit:true,strict:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,types:[]});
 const errors=ts.getPreEmitDiagnostics(program);assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>dir,getCanonicalFileName:p=>p,getNewLine:()=> '\n'}));
});
