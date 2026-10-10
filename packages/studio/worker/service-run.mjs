/** A running service is never executed again, even if its Worker disappears.
 * Heartbeats follow active work; an abandoned run goes to refund recovery. */
export async function serviceResult(env,id,handler,refund,{now=Date.now,leaseMs=60000}={}) {
  await env.DB.prepare(`INSERT OR IGNORE INTO service_results(order_id,state,due) VALUES(?1,'pending',0)`).bind(id).run();
  const lease=crypto.randomUUID();
  const claimed=await env.DB.prepare(`UPDATE service_results SET state='running',lease=?2,due=?3 WHERE order_id=?1 AND state='pending'`).bind(id,lease,now()+leaseMs).run();
  const fail=async()=>env.DB.prepare(`UPDATE service_results SET state='refund-pending' WHERE order_id=?1 AND state='running'`).bind(id).run();
  if(claimed.meta.changes) {
    let renewal=Promise.resolve();
    const timer=setInterval(()=>{renewal=renewal.then(()=>env.DB.prepare(`UPDATE service_results SET due=?3 WHERE order_id=?1 AND lease=?2 AND state='running'`).bind(id,lease,now()+leaseMs).run()).catch(()=>{});},leaseMs/3);
    try {
      const value=await handler();
      await env.DB.prepare(`UPDATE service_results SET state='complete',result=?3 WHERE order_id=?1 AND lease=?2 AND state='running'`).bind(id,lease,JSON.stringify(value??null)).run();
    } catch {await fail();}
    finally{clearInterval(timer);await renewal;}
  }
  let saved=await env.DB.prepare('SELECT state,result,due FROM service_results WHERE order_id=?1').bind(id).first();
  if(saved.state==='running' && saved.due<=now()){await fail();saved.state='refund-pending';}
  if(saved.state==='refund-pending') {
    let outcome;try{outcome=await refund();}catch{outcome={ok:false};}
    if(outcome.ok && !outcome.pending){await env.DB.prepare(`UPDATE service_results SET state='refunded',result=?2 WHERE order_id=?1 AND state='refund-pending'`).bind(id,JSON.stringify({message:'The tool failed. Your payment was automatically refunded.'})).run();}
    saved=await env.DB.prepare('SELECT state,result,due FROM service_results WHERE order_id=?1').bind(id).first();
  }
  return {order:id,state:saved.state,...(saved.state==='complete'?{data:JSON.parse(saved.result)}:saved.state==='refunded'?JSON.parse(saved.result):saved.state==='refund-pending'?{message:'The tool failed. An automatic refund is pending; retry this same claim to check it. The tool will not run again.'}:{retry:'Retry this same claim; the service is running.'})};
}
