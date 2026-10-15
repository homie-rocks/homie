import {readStudio,writeStudio} from './studio.mjs';
export const backgroundQueues=worker=>({work:worker.slice(0,48)+'-background',dead:worker.slice(0,48)+'-background-dlq'});
/** Creation refuses a pre-existing unowned name; every successful creation is recorded immediately. */
export function ensureBackgroundQueues(root,run) {
  const studio=readStudio(root),names=backgroundQueues(studio.cloudflare.worker);
  for(const name of [names.dead,names.work]) {
    if(readStudio(root).cloudflare.created?.includes('queue:'+name))continue;
    const info=run(['queues','info',name]);
    const producers=/^Producers:\s*(.*)$/m.exec(info.out)?.[1]?.split(',').map(s=>s.trim());
    const owned=info.code===0&&producers?.length===1&&producers[0]==='worker:'+studio.cloudflare.worker;
    if(info.code===0&&!owned)throw new Error(`Queue ${name} already exists and is not bound exclusively to this studio`);
    const result=owned?{code:0,out:''}:run(['queues','create',name]);
    if(result.code!==0)throw new Error(`Could not create studio queue ${name}: ${result.out.trim().split('\n').slice(-4).join(' ')}`);
    const latest=readStudio(root);
    writeStudio(root,{...latest,cloudflare:{...latest.cloudflare,created:[...new Set([...(latest.cloudflare.created??[]),'queue:'+name])].sort()}});
  }
}
