#!/usr/bin/env node
/** Audit the declarations used to contextually type game code. Usage: node this-file [generated-types-directory]. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { rulesTypes, rulesViewTypes } from '../lib/rules-types.mjs';

export const runtimeSources = () => Object.fromEntries(['rules/types.ts','rules/view.ts','rules/rules.ts','agents/agents.ts'].map(file=>[file,readFileSync(new URL('../'+file,import.meta.url),'utf8')]));
export function auditDeclarations(sources) {
  const findings=[];
  for(const [file,text] of Object.entries(sources)) {
    const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
    const runtime = ['rules/view.ts','rules/rules.ts','agents/agents.ts'].includes(file);
    const visit=node=>{
      if(runtime && ts.isFunctionDeclaration(node)) return; // Implementation signatures are not contextual author callbacks.
      if(runtime && node.parent===tree && !ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) return;
      if(node.kind===ts.SyntaxKind.UnknownKeyword||node.kind===ts.SyntaxKind.AnyKeyword){
        let parent=node;
        while(parent.parent&&!ts.isTypeAliasDeclaration(parent)&&!ts.isInterfaceDeclaration(parent))parent=parent.parent;
        const declaration=parent.name?.text??'';
        const line=tree.getLineAndCharacterOfPosition(node.getStart()).line+1;
        const source=text.split('\n')[line-1];
        let reason='UNEXPLAINED';
        if(['Goal','GuideRequest'].includes(declaration))reason='Generic fallback without a vocabulary; generated GameGoal and GameRequest replace it when names and argument shapes exist.';
        if(declaration==='GuideDecision')reason='Untrusted floor result; the admission boundary validates goal, line and argument names and values together.';
        if(runtime && file==='rules/rules.ts' && ['RuntimeWorld','RuntimeSelf','Handler','RoomHandler','MoveFn','GuideDef','EntityDef','AskDef','RulesDef'].includes(declaration)) reason='Raw runtime declaration; replaced by the generated Definition, Entity and Moves callback signatures before game code is checked.';
        if(runtime && file==='rules/rules.ts' && ['Field','FieldOptions'].includes(declaration)) reason='Initializer input crosses the declared field boundary before rules read it.';
        if(runtime && file==='rules/rules.ts' && declaration==='Compiled')reason='Raw compiled tuning record; generated public tuning fields supply their concrete types to game code.';
        if(runtime && file==='rules/rules.ts' && declaration==='CompileEnv')reason='Compiler configuration input is validated before becoming declared runtime values.';
        if(runtime && file==='rules/view.ts' && ['Entity','GameData'].includes(declaration)) reason='Raw schema transport; generated Entities and shared fields replace dynamic reads in a checked view.';
        if(runtime && file==='rules/view.ts' && declaration==='Room') reason='Generated Room replaces dynamic entity, event, command, field and button members; retained ask/offer inputs are validated and probe accepts arbitrary receipt values.';
        if(runtime && file==='rules/view.ts' && declaration==='OpenRoomOptions') reason='Explicit raw game injection for runtime integrations; ordinary views use the generated game declarations.';
        if(runtime && file==='agents/agents.ts') reason=({Decision:'Untrusted decision input is admitted against the vocabulary before use.',Goal:'Raw vocabulary goal; generated GameGoal supplies the argument union.',Ask:'Raw vocabulary request; generated GameRequest supplies the argument union.',SayEvent:'Legacy speech arguments are arbitrary; common text and slot fields are concrete.',AskButton:'Raw button shape is replaced by the generated discriminated request union.',AgentsOptions:'Low-level integration callbacks exchange raw vocabulary values; the core admission boundary validates them.',Agents:'Low-level agent transport; game authors use the generated Room facade.',AgentsSaved:'Saved transport data is validated before runtime admission.'})[declaration]??reason;
        if(source.includes('offer?:'))reason='Optional offered values are caller inputs validated against the vocabulary; button results are a generated discriminated union.';
        if(declaration==='BuiltIns')reason='Generic answer fallback; generated handlers replace it with declared questions and picks.';
        if(/(?:interface|type) Room<|function openRoom/.test(source))reason='Optional phantom rules marker; no runtime value or payload is read through it.';
        if(reason==='UNEXPLAINED' && source.includes('ask<K extends string>'))reason='A request name the view only has as a text takes any arguments, and the server checks them when they arrive; a name written out is checked against the vocabulary.';
        if(reason==='UNEXPLAINED' && source.includes('questions:'))reason='Question declaration input, parsed and validated before the generated answer type is produced.';
        if(reason==='UNEXPLAINED' && (source.includes('say:')||source.includes('ask: Readonly<Record')))reason='Legacy player speech and ask relay events accept arbitrary external data; inspect their values before use. Companion goal events are typed separately.';
        findings.push({file,line,type:ts.tokenToString(node.kind),declaration,reason});
      }
      ts.forEachChild(node,visit);
    };visit(tree);
  }
  return findings;
}
export function auditGenerated(checked,tune={}) {
  return auditDeclarations({'rules.d.ts':rulesTypes(checked,tune),'view.d.ts':rulesViewTypes(checked),...runtimeSources()});
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const dir=process.argv[2];
 const sources=runtimeSources();
 if(dir)for(const file of ['rules.d.ts','view.d.ts'])sources[file]=readFileSync(join(dir,file),'utf8');
 const rows=auditDeclarations(sources);
 console.log(JSON.stringify(rows,null,2));
 if(rows.some(r=>r.reason==='UNEXPLAINED'||r.file.endsWith('.d.ts')&&r.type==='any'))process.exitCode=1;
}
