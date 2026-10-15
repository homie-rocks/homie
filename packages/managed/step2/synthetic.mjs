/** Synthetic free booking and MCP checks, only on explicitly registered test previews. */
export async function synthetic(url,slot='planting'){
 if(url!=='https://hm-s2-dispatch.ryan-d2f.workers.dev')throw new Error('Preview origin required');
 let cookies='';
 async function call(path,body){const r=await fetch(url+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',origin:url,...(cookies?{cookie:cookies}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});const set=r.headers.getSetCookie?.()??[];if(set.length)cookies=set.map(c=>c.split(';')[0]).join('; ');return {status:r.status,body:await r.json()};}
 const schema=await fetch(url+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'app_schema',arguments:{app:'gathering'}}}),signal:AbortSignal.timeout(30000)});
 const raw=await schema.text();const message=JSON.parse(raw.startsWith('event:')?raw.split('\n').find(l=>l.startsWith('data: ')).slice(6):raw);
 if(!schema.ok||message.error||message.result?.isError)throw new Error('MCP schema failed');
 const age=await call('/api/shop/age',{year:1990});
 const booking=await call('/api/shop/buy',{game:'gathering',lines:[{item:'volunteer-shift',quantity:1}],booking:{collection:'signups',slot}});
 if(!booking.body.ok)throw new Error('Synthetic booking failed: '+JSON.stringify({age,booking}));
 return {synthetic:true,mcp:true,booking:{status:booking.status,order:booking.body.order,booking:booking.body.booking},moneyMoved:false};
}
