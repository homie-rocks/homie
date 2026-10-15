import ts from 'typescript';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
/** Only a standalone, named refresh timer over known record clients is mechanical. */
export function upgradePlaceView(source){
 const file=ts.createSourceFile('view.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const factories=new Set(),clients=[];
 for(const statement of file.statements){
  if(ts.isImportDeclaration(statement)&&statement.moduleSpecifier.text==='@homie-rocks/studio/apps'){
   for(const name of statement.importClause?.namedBindings?.elements??[])if((name.propertyName?.text??name.name.text)==='createAppRecords')factories.add(name.name.text);
  }
  if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations){
   if(ts.isIdentifier(d.name)&&d.initializer&&ts.isCallExpression(d.initializer)&&ts.isIdentifier(d.initializer.expression)&&factories.has(d.initializer.expression.text))clients.push(d.name.text);
  }
 }
 if(!clients.length)return source;
 const edits=[];
 for(const statement of file.statements){
  if(!ts.isExpressionStatement(statement)||!ts.isCallExpression(statement.expression))continue;
  const call=statement.expression;
  if(!ts.isIdentifier(call.expression)||call.expression.text!=='setInterval'||call.arguments.length!==2)continue;
  const [callback,delay]=call.arguments;
  if(!ts.isIdentifier(callback)||!/^refresh/i.test(callback.text)||!ts.isNumericLiteral(delay)||+delay.text<2000||+delay.text>3000)continue;
  edits.push({start:statement.getStart(file),end:statement.end,text:clients.map(name=>`${name}.subscribe(${callback.text});`).join('\n')});
 }
 for(const edit of edits.reverse())source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
 return source;
}
/** Exact obsolete notes only. Never rewrite owner's words, evidence, dates or unresolved needs. */
export function upgradePlaceCodex(source){
 const replacements=new Map([
  ['The runner has no staff surface or MCP step.','The toolkit supports staff surfaces and MCP needs. Rerun the needs; earlier manual evidence is not a passing proof.'],
  ['Real Homie gap: no push for studio events, so the AI polls.','Declared studio event feeds support push subscriptions; reconnect from the last cursor.'],
  ['Staff device runs the jobs Homie has no scheduler for.','Run these jobs in scheduled server functions; remove the duplicate staff-device job after proving its replacement.'],
  ['ctx.database has only get/put (no atomic append).','Use versioned database writes and named event feeds; do not maintain an event log with sleep-and-retry.']
 ]);
 return source.split('\n').map(line=>replacements.get(line)??line).join('\n');
}
export function placeUpgradeChanges(root){
 const dir=join(root,'apps');if(!existsSync(dir))return [];
 const changes=[];
 for(const app of readdirSync(dir,{withFileTypes:true}).filter(d=>d.isDirectory()))for(const [suffix,rewrite] of [['CODEX.md',upgradePlaceCodex],['src/view.ts',upgradePlaceView]]){
  const file=`apps/${app.name}/${suffix}`,path=join(root,file);if(!existsSync(path))continue;
  const from=readFileSync(path,'utf8'),text=rewrite(from);if(from!==text)changes.push({file,kind:'update-file',from,text,what:'replace a recognized obsolete place workaround with the supported toolkit contract; rerun needs'});
 }
 return changes;
}
