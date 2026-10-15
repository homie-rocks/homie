import {authorized} from './auth.mjs';
import buildProgram from './run-build.cjs';
import {DurableObject} from 'cloudflare:workers';

/** A fresh VM per job. No deploy service, platform DB, or API credential binding. */
export class BuildSandbox extends DurableObject {
 async build(job) {
  if(!/^[a-f0-9]{40}$/.test(job.commit)||!/^[a-f0-9]{64}$/.test(job.lockDigest)||job.toolkit!=='0.51.8'||job.node!=='v24.20.0')throw new Error('Unpinned build');
  const c=this.ctx.container;if(!c)throw new Error('Remote container required');
  await this.ctx.storage.setAlarm(Date.now()+600000);
  try {
   c.start({image:'cloudflare/debian-trixie',entrypoint:['sleep','infinity'],enableInternet:true,instance:job.mode==='check'?'standard-3':'standard-2'});
   // exec alone does not prevent DO eviction during a long browser check.
   // monitor keeps the controller active for up to 15 minutes; our alarm is 10.
   this.ctx.waitUntil(c.monitor().catch(error=>console.error('Container stopped',error.message)));
   const p=await c.exec(['node','-e',buildProgram],{stdin:new Blob([JSON.stringify(job)]).stream()});
   const read=async (stream,limit)=>{const reader=stream.getReader();let size=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await c.destroy();throw new Error('Output limit');}chunks.push(value);}return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());};
   const [stdout,stderr,exitCode]=await Promise.all([read(p.stdout,32*1024*1024),read(p.stderr,64*1024),p.exitCode]);
   if(exitCode!==0)throw new Error('Build failed: '+stderr.replaceAll(job.readToken,'[REDACTED]').slice(-5000));
   return {archive:stdout};
  } finally {await c.destroy();await this.ctx.storage.deleteAlarm();}
 }
 async alarm(){await this.ctx.container?.destroy('Build deadline');}
 async probe() {
  const container=this.ctx.container;
  if(!container)throw new Error('Remote container required');
  try {
   container.start({image:'cloudflare/debian-trixie',entrypoint:['sleep','infinity'],enableInternet:false,instance:'standard-2'});
   const p=await container.exec(['node','-e','console.log(JSON.stringify({platform:process.platform,node:process.version,keys:Object.keys(process.env)}))']);
   const out=await p.output();
   return {exitCode:out.exitCode,stdout:new TextDecoder().decode(out.stdout)};
  } finally {await container.destroy();}
 }
}
export default {
 async fetch(request,env){
  if(request.method!=='POST'||!authorized(request.headers.get('authorization'),env.RUN_KEY))return new Response('Not found',{status:404});
  const stub=env.BUILDS.get(env.BUILDS.newUniqueId());
  try {return Response.json(new URL(request.url).pathname==='/build'?await stub.build(await request.json()):await stub.probe());}catch(error){return Response.json({error:error.message},{status:422});}
 }
};
