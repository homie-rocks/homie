/** Platform-owned, uncached registry. Never bind this namespace into tenant code. */
export class Registry {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async routes(){return [...(await this.ctx.storage.list({prefix:'route:'})).values()];}
  async put(tenant,routes,ticks=false){
    if(typeof tenant!=='string'||!tenant||tenant.length>255)throw Error('Tenant required');
    if(!Array.isArray(routes)||!routes.length)throw Error('Routes required');
    for(const r of routes)if(typeof r.hostname!=='string'||new URL('https://'+r.hostname).host!==r.hostname||typeof r.prefix!=='string'||!r.prefix.startsWith('/')||r.prefix.includes('?')||r.prefix.includes('#')||(r.prefix!=='/'&&r.prefix.endsWith('/')))throw Error('Invalid route');
    await this.ctx.storage.transaction(async tx=>{
      const existing=[...(await tx.list({prefix:'route:'})).values()];
      for(const owner of existing)if(owner.tenant!==tenant&&owner.routes.some(a=>routes.some(b=>a.hostname===b.hostname&&a.prefix===b.prefix)))throw Error('Route already owned');
      await tx.put('route:'+tenant,{tenant,routes,ticks:ticks===true,disabled:false});
    });
  }
  async kill(tenant){await this.ctx.storage.transaction(async tx=>{const r=await tx.get('route:'+tenant);if(r)await tx.put('route:'+tenant,{...r,disabled:true});});}
  async resolve(host,path){
    const matches=(await this.routes()).filter(r=>!r.disabled).flatMap(r=>r.routes.map(route=>({...route,script:r.tenant})))
      .filter(r=>r.hostname===host&&(r.prefix==='/'||path===r.prefix||path.startsWith(r.prefix+'/')));
    return matches.sort((a,b)=>b.prefix.length-a.prefix.length)[0]??null;
  }
  async scheduled(){return (await this.routes()).filter(r=>!r.disabled&&r.ticks).map(r=>r.tenant);}
  async claim(tenant,time){
    if(!Number.isSafeInteger(time)||time>Date.now()||time+60000<=Date.now())return 'skip';
    return this.ctx.storage.transaction(async tx=>{
      const r=await tx.get('route:'+tenant);
      if(!r||r.disabled||!r.ticks)return 'skip';
      // No lease expiry: a crashed delivery fails closed rather than overlapping live work.
      // An operator must reconcile stuck claims before clearing them.
      if(await tx.get('running:'+tenant))return 'busy';
      const last=await tx.get('tick:'+tenant)??0;
      if(time<=last)return 'skip';
      await tx.put('running:'+tenant,{time});return 'run';
    });
  }
  async finish(tenant,time,success){await this.ctx.storage.transaction(async tx=>{
    if((await tx.get('running:'+tenant))?.time!==time)return;
    if(success)await tx.put('tick:'+tenant,time);
    await tx.delete('running:'+tenant);
  });}
  async alert(body){await this.ctx.storage.put('alert:'+crypto.randomUUID(),{...body,at:Date.now()});console.error(JSON.stringify({event:'managed-tick-dlq',...body}));}
}
