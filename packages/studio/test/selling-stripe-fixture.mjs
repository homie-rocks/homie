import assert from 'node:assert/strict';
export function stripeFixture() {
 const rows={products:[],prices:[],payment_links:[],configurations:[]}; let sequence=0;
 return {rows,call(op){
   if(op.path==='/v1/checkout/sessions')return {data:[],has_more:false};
   const segments=op.path.split('/'),kind=segments[2]==='billing_portal'?'configurations':segments[2];
   const data=rows[kind];assert.ok(data,op.path);const id=segments.at(-1)===kind||segments.at(-1)==='search'?null:segments.at(-1);
   if(op.method==='GET') {
     if(!id){
       const start=op.params.starting_after?data.findIndex(o=>o.id===op.params.starting_after)+1:0;
       const page=structuredClone(data.slice(start,start+(op.params.limit??100)));
       if(kind==='payment_links'&&op.params.expand?.includes('data.line_items'))for(const o of page)o.line_items={data:o.line_items.map(l=>({...l,price:{id:l.price}})),has_more:false};
       return {data:page,has_more:start+page.length<data.length};
     }
     const object=structuredClone(data.find(o=>o.id===id));
     if(!object)return {error:{code:'resource_missing',message:'No such product'}};
     if(kind==='payment_links')object.line_items={data:object.line_items.map(line=>({...line,price:{id:line.price}}))};
     return object;
   }
   let object=id?data.find(o=>o.id===id):null;
   if(!object){object={id:op.params.id??`${kind==='payment_links'?'plink':kind==='prices'?'price':kind==='products'?'prod':'bpc'}_${++sequence}`,active:true,livemode:false};data.push(object);}
   const metadata={...object.metadata,...op.params.metadata};
   const count=object.restrictions?.completed_sessions?.count;
   const previousLines=object.line_items;
   Object.assign(object,structuredClone(op.params));
   if(kind==='payment_links'&&op.params.line_items)object.line_items=object.line_items.map((l,i)=>({...previousLines?.find(p=>p.id===l.id),...l,id:l.id??`li_${object.id}_${i}`}));
   object.metadata=metadata;
   if(count!==undefined && object.restrictions)object.restrictions.completed_sessions.count=count;
   if(kind==='payment_links'){object.url=`https://buy.stripe.com/test_${object.id}`;if(object.restrictions)object.restrictions.completed_sessions.count??=0;}
   if(kind==='configurations')object.login_page={enabled:true,url:'https://billing.stripe.com/p/login/test_fixture'};
   if(kind==='products' && op.params.default_price_data) {
     const price={id:`price_${++sequence}`,active:true,livemode:false,product:object.id,...structuredClone(op.params.default_price_data)};
     rows.prices.push(price);object.default_price=price;
   }
   const response=structuredClone(object);
   if(kind==='payment_links'&&op.params.expand)response.line_items={data:response.line_items.map(line=>({...line,price:{id:line.price}})),has_more:false};
   return response;
 }};
}
