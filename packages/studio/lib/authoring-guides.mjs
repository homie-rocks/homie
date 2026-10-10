import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {STUDIO_VERSION} from './version.mjs';
const json=file=>{try{return JSON.parse(readFileSync(file,'utf8'));}catch{return null;}};
const older=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]<y[i];}return false;};
export function authoringGuidance({home=homedir(),version=STUDIO_VERSION}={}) {
  const installed=[];
  const claude=json(join(home,'.claude/plugins/installed_plugins.json'));
  for(const row of claude?.plugins?.['homie@homie']??[]) {
    const v=row.version??json(join(row.installPath??'','.claude-plugin/plugin.json'))?.version;
    if(v)installed.push({client:'Claude Code',version:v,update:'claude plugin update homie@homie'});
  }
  // Codex's plugin cache is versioned. Report older copies explicitly, including
  // one still loaded by a long-lived session after another copy was installed.
  const cache=join(home,'.codex/plugins/cache/homie/homie');
  if(existsSync(cache))for(const entry of readdirSync(cache)) {
    const v=json(join(cache,entry,'.codex-plugin/plugin.json'))?.version;
    if(v)installed.push({client:'Codex',version:v,update:'Run codex plugin marketplace upgrade homie && codex plugin add homie@homie, then start a new session'});
  }
  const guides='node_modules/@homie-rocks/studio/guides/game/';
  return {version,guides,warning:installed.filter(p=>/^\d+\.\d+\.\d+$/.test(p.version)&&older(p.version,version)).map(p=>`Homie ${p.client} plugin ${p.version} is older than toolkit ${version}. Its guidance may be stale. Read ${guides}{SKILL,RULES,REWRITE}.md. ${p.update}.`)};
}
export function authoringWords(options) {
  const g=authoringGuidance(options);
  return [`Author against toolkit ${g.version}: ${g.guides}{SKILL,RULES,REWRITE}.md`,...g.warning];
}
