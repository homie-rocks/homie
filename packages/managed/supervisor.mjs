/** Generated entry owns the class; owner methods are composed, never inherited.
 * This shares an isolate with owner code, not a security boundary against JS tampering.
 */
const leases=new WeakMap();
const TTL=1000;
async function allowed(control,force=false,strong=false){
 const start=Date.now(),cached=leases.get(control);
 if(!force&&cached&&start<cached.expires)return !cached.stopped;
 let timer;let state;try{state=await Promise.race([control.status(undefined,strong),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Stop read timed out')),TTL);})]);}finally{clearTimeout(timer);}
 if(Date.now()>=start+TTL)throw Error('Stop lease expired in transit');
 leases.set(control,{...state,expires:start+TTL});return !state.stopped;
}
export function supervise(Owner,{tenant,binding,className}){
 return class HomieSupervisor {
  #ctx;#env;#owner;#timer;#stopped=false;#registered=false;#active=0;#ordinary=false;
  constructor(ctx,env){this.#ctx=ctx;this.#env=env;}
  async #stop(){
   this.#stopped=true;clearInterval(this.#timer);
   for(const ws of this.#ctx.getWebSockets())try{ws.close(1012,'Tenant stopped');}catch{}
   await this.#ctx.storage.deleteAlarm();
   await this.#ctx.storage.sync();
   console.log(JSON.stringify({tenant,event:'supervisor-stop',className,object:this.#ctx.id.toString()}));
   // Resets timers, ordinary sockets, and running callbacks; storage is preserved.
   this.#ctx.abort('Homie tenant stopped',{retryAlarm:false});
  }
  async #check(force=false,strong=false){
   let ok=false;try{ok=!this.#stopped&&await allowed(this.#env.HOMIE_STOP,force,strong);}catch{}
   if(!ok){await this.#stop();throw Error('Tenant stopped');}
  }
  #watch(){
   if(this.#timer)return;
   this.#timer=setInterval(()=>{void this.#check(true).catch(()=>{});},1000);
  }
  async #call(method,args){
   // Registration is durable before any owner constructor or callback executes.
   if(!this.#registered){
    let state;try{state=await this.#env.HOMIE_STOP.status({binding,id:this.#ctx.id.toString()});}catch{await this.#stop();throw Error('Stop registration failed');}
    if(state.stopped){await this.#stop();throw Error('Tenant stopped');}
    this.#registered=true;
   }
   await this.#check();this.#active++;this.#watch();
   try{
    if(!this.#owner){
     // Keep the native DurableObjectState brand required by cloudflare:workers.
     const setAlarm=this.#ctx.storage.setAlarm.bind(this.#ctx.storage);
     this.#ctx.storage.setAlarm=(...args)=>{if(this.#stopped)throw Error('Tenant stopped');return setAlarm(...args);};
     this.#owner=new Owner(this.#ctx,this.#env);
    }
    const result=await this.#owner[method]?.(...args);
    await this.#check();
    if(result?.webSocket&&!this.#ctx.getWebSockets().length)this.#ordinary=true;
    console.log(JSON.stringify({tenant,event:'supervisor-callback',className,method}));
    return result;
   }finally{
    this.#active--;
    // Idle hibernation sockets are reached by the registry's durable notify list.
    if(!this.#active&&!this.#ordinary){clearInterval(this.#timer);this.#timer=null;}
   }
  }
  async fetch(request){
   if(new URL(request.url).pathname==='/__homie_supervisor/notify'){
    await this.#check(true,true);return new Response(null,{status:204});
   }
   return this.#call('fetch',[request]);
  }
  alarm(...args){return this.#call('alarm',args);}
  webSocketMessage(...args){return this.#call('webSocketMessage',args);}
  webSocketClose(...args){return this.#call('webSocketClose',args);}
  webSocketError(...args){return this.#call('webSocketError',args);}
 };
}
