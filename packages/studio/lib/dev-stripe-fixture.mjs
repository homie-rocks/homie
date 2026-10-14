/** Offline Checkout fixture for local acceptance. No Stripe account, cards, or
 * real credentials. This is a simulator, not evidence of Stripe sandbox access. */
import { createServer } from 'node:http';
import { signPayload } from '../worker/stripe.mjs';
export async function startStripeFixture({ origin }) {
  const target=new URL(origin);
  if (target.protocol!=='http:' || !['localhost','127.0.0.1'].includes(target.hostname)) throw new Error('Fixture requires a loopback studio');
  const sessions=new Map(), idempotency=new Map(); let seq=0, base;
  const key='rk_test_homieLocalFixture', secret='whsec_homieLocalFixture';
  const server=createServer(async(req,res)=>{
    const send=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url,base);let body='';for await(const chunk of req){body+=chunk;if(body.length>262144)return send({error:{message:'fixture body limit'}},413);}
      const form=new URLSearchParams(body);
      if(url.pathname==='/v1/checkout/sessions'&&req.method==='GET') return send({data:[...sessions.values()].filter(s=>s.created>=Number(url.searchParams.get('created[gte]')??0)),has_more:false});
      if(url.pathname==='/v1/checkout/sessions'&&req.method==='POST') {
        const idem=req.headers['idempotency-key'];if(idem&&idempotency.has(idem))return send(sessions.get(idempotency.get(idem)));
        const id=`cs_fixture_${++seq}`,lines=[];
        for(let i=0;form.has(`line_items[${i}][quantity]`);i++) {const p=`line_items[${i}]`;lines.push({quantity:Number(form.get(`${p}[quantity]`)),amount_subtotal:Number(form.get(`${p}[quantity]`))*Number(form.get(`${p}[price_data][unit_amount]`)),name:form.get(`${p}[price_data][product_data][name]`)});}
        const s={id,object:'checkout.session',livemode:false,mode:form.get('mode'),status:'open',payment_status:'unpaid',created:Math.floor(Date.now()/1000),expires_at:Number(form.get('expires_at')),currency:form.get('line_items[0][price_data][currency]'),amount_subtotal:lines.reduce((n,l)=>n+l.amount_subtotal,0),metadata:{homie:form.get('metadata[homie]'),order:form.get('metadata[order]')},client_reference_id:form.get('client_reference_id'),url:`${base}/checkout/${id}`,success_url:form.get('success_url'),cancel_url:form.get('cancel_url'),lines};
        s.amount_total=s.amount_subtotal;sessions.set(id,s);if(idem)idempotency.set(idem,id);return send(s);
      }
      const api=/^\/v1\/checkout\/sessions\/(cs_fixture_\d+)(\/expire)?$/.exec(url.pathname);
      if(api){const s=sessions.get(api[1]);if(!s)return send({error:{code:'resource_missing'}},404);if(api[2]){if(s.status!=='open')return send({error:{message:'Session is not open'}},400);s.status='expired';await hook(s,'checkout.session.expired');}return send(s);}
      const page=/^\/checkout\/(cs_fixture_\d+)$/.exec(url.pathname);
      if(page){const s=sessions.get(page[1]);if(!s)return send({},404);res.writeHead(200,{'content-type':'text/html'});return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Offline Stripe fixture</title><style>body{font:20px system-ui;max-width:32em;margin:3em auto;padding:1em}button{padding:1em;font:inherit}</style><h1>Offline Stripe test fixture</h1><p>This is a simulation. No card or money is used.</p><p>${s.amount_total/100} ${s.currency.toUpperCase()}</p><form method="post" action="/complete/${s.id}"><button>Simulate successful test payment</button></form><form method="post" action="/expire/${s.id}"><button>Simulate expiry</button></form>`);}
      const finish=/^\/(complete|expire)\/(cs_fixture_\d+)$/.exec(url.pathname);
      if(finish&&req.method==='POST'){const s=sessions.get(finish[2]);if(!s||s.status!=='open')return send({error:'not open'},409);const paid=finish[1]==='complete';s.status=paid?'complete':'expired';s.payment_status=paid?'paid':'unpaid';if(paid){s.payment_intent={id:`pi_fixture${seq}`,status:'succeeded',latest_charge:{id:`ch_fixture${seq}`,created:Math.floor(Date.now()/1000),refunded:false,disputed:false}};if(s.mode==='subscription'){s.subscription=`sub_fixture${seq}`;s.customer=`cus_fixture${seq}`;}}await hook(s,paid?'checkout.session.completed':'checkout.session.expired');res.writeHead(303,{location:(paid?s.success_url:s.cancel_url).replace('{CHECKOUT_SESSION_ID}',s.id)});return res.end();}
      if(url.pathname.startsWith('/v1/payment_intents/')) { const payment=[...sessions.values()].map(s=>s.payment_intent).find(p=>p?.id===url.pathname.split('/').at(-1));return payment?send(payment):send({error:{code:'resource_missing'}},404); }
      if(url.pathname==='/v1/refunds')return send({data:[],has_more:false});
      return send({error:{message:'Unsupported offline fixture operation'}},404);
    }catch{send({error:{message:'Offline fixture failed'}},500);}
  });
  async function hook(session,type){const event={id:`evt_fixture_${session.id}_${type}`,type,livemode:false,created:Math.floor(Date.now()/1000),data:{object:session}};const payload=JSON.stringify(event),t=event.created;const response=await fetch(`${target.origin}/api/shop/hook`,{method:'POST',headers:{'stripe-signature':`t=${t},v1=${await signPayload(payload,secret,t)}`},body:payload});if(!response.ok)throw new Error('Studio rejected fixture webhook');}
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  return {base,bindings:{STRIPE_KEY:key,STRIPE_WEBHOOK_SECRET:secret,STRIPE_API_BASE:base},close:()=>new Promise(resolve=>server.close(resolve))};
}
