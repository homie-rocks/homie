/** Generated entry owns the class; owner methods are composed, never inherited.
 * This shares an isolate with owner code, not a security boundary against JS tampering.
 */
// Capture timers before the generated entry imports owner modules.
const repeat=globalThis.setInterval.bind(globalThis),cancelRepeat=globalThis.clearInterval.bind(globalThis);
const delay=globalThis.setTimeout.bind(globalThis),cancelDelay=globalThis.clearTimeout.bind(globalThis);
const leases=new WeakMap();
const TTL=3500;
async function allowed(control,force=false){
 const start=Date.now(),cached=leases.get(control);
 if(!force&&cached&&start<cached.expires)return !cached.stopped;
 let timer;let state;try{state=await Promise.race([control.status(undefined,true),new Promise((_,reject)=>{timer=delay(()=>reject(Error('Stop read timed out')),2000);})]);}finally{cancelDelay(timer);}
 if(Date.now()>=start+TTL)throw Error('Stop lease expired in transit');
 leases.set(control,{...state,expires:start+TTL});return !state.stopped;
}
export function supervise(Owner,{tenant,binding,className}){
 return class HomieSupervisor {
  #ctx;#env;#platform;#control;#owner;#timer;#stopped=false;#registered=false;#active=0;#ordinary=false;#refreshing=false;
  constructor(ctx,env){
   this.#ctx=ctx;this.#env=env;
   this.#platform={abort:ctx.abort.bind(ctx),sockets:ctx.getWebSockets.bind(ctx),deleteAlarm:ctx.storage.deleteAlarm.bind(ctx.storage),sync:ctx.storage.sync.bind(ctx.storage)};
   const control=env.HOMIE_STOP,status=control.status;
   this.#control={status:(...args)=>status(...args)};
  }
  async #stop(){
   this.#stopped=true;cancelRepeat(this.#timer);
   for(const ws of this.#platform.sockets())try{ws.close(1012,'Tenant stopped');}catch{}
   await this.#platform.deleteAlarm();
   await this.#platform.sync();
   console.log(JSON.stringify({tenant,event:'supervisor-stop',className,object:this.#ctx.id.toString()}));
   // Resets timers, ordinary sockets, and running callbacks; storage is preserved.
   this.#platform.abort('Homie tenant stopped',{retryAlarm:false});
  }
  async #check(force=false){
   let ok=false;try{ok=!this.#stopped&&await allowed(this.#control,force);}catch(error){console.error(JSON.stringify({tenant,event:'supervisor-control-error',className,kind:String(error).includes('timed out')?'timeout':String(error).includes('expired')?'expired':'rpc-error'}));}
   if(!ok){await this.#stop();throw Error('Tenant stopped');}
   const lease=leases.get(this.#control);
   if(!force&&!this.#refreshing&&lease&&lease.expires-Date.now()<TTL/2){
    this.#refreshing=true;
    this.#ctx.waitUntil(this.#check(true).catch(()=>{}).finally(()=>{this.#refreshing=false;}));
   }
  }
  #watch(){
   if(this.#timer)return;
   this.#timer=repeat(()=>{void this.#check(true).catch(()=>{});},1000);
  }
  async #call(method,args){
   const started=performance.now();
   // Registration is durable before any owner constructor or callback executes.
   if(!this.#registered){
    const registeredAt=Date.now();let state;try{state=await this.#control.status({binding,id:this.#ctx.id.toString()});}catch{await this.#stop();throw Error('Stop registration failed');}
    if(state.stopped){await this.#stop();throw Error('Tenant stopped');}
    leases.set(this.#control,{...state,expires:registeredAt+TTL});
    this.#registered=true;
   }
   await this.#check();const guarded=performance.now();this.#active++;this.#watch();
   try{
    if(!this.#owner){
     // Keep the native DurableObjectState brand required by cloudflare:workers.
     const setAlarm=this.#ctx.storage.setAlarm.bind(this.#ctx.storage);
     this.#ctx.storage.setAlarm=(...args)=>{if(this.#stopped)throw Error('Tenant stopped');return setAlarm(...args);};
     this.#owner=new Owner(this.#ctx,this.#env);
    }
    const result=await this.#owner[method]?.(...args);
    await this.#check();
    if(result?.webSocket&&!this.#platform.sockets().length)this.#ordinary=true;
    console.log(JSON.stringify({tenant,event:'supervisor-callback',className,method}));
    if(result instanceof Response&&result.status!==101){const headers=new Headers(result.headers);headers.set('x-hm-supervisor-guard-ms',String(guarded-started));headers.set('x-hm-supervisor-owner-ms',String(performance.now()-guarded));return new Response(result.body,{status:result.status,headers});}
    return result;
   }finally{
    this.#active--;
    // Idle hibernation sockets are reached by the registry's durable notify list.
    if(!this.#active&&!this.#ordinary){cancelRepeat(this.#timer);this.#timer=null;}
   }
  }
  async fetch(request){
   if(new URL(request.url).pathname==='/__homie_supervisor/notify'){
    await this.#check(true);return new Response(null,{status:204});
   }
   return this.#call('fetch',[request]);
  }
  alarm(...args){return this.#call('alarm',args);}
  webSocketMessage(...args){return this.#call('webSocketMessage',args);}
  webSocketClose(...args){return this.#call('webSocketClose',args);}
  webSocketError(...args){return this.#call('webSocketError',args);}
 };
}
