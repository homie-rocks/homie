import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {resolve} from 'node:path';
test('installed-source browser helpers have no diagnostics under build --types settings',()=>{
 const program=ts.createProgram(['apps/apps.ts','netplay/netplay.ts','rules/view.ts'].map(p=>resolve('packages/studio',p)),{strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,allowImportingTsExtensions:true,allowJs:true,checkJs:false,types:[]});
 const errors=ts.getPreEmitDiagnostics(program);
 assert.equal(errors.length,0,ts.formatDiagnostics(errors,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));
});
