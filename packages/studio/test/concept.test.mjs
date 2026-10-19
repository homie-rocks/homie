import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
test('concept mode excludes directory listing, blocks indexing and visibly labels HTML',async()=>{
 const cat={studio:{name:'Example',concept:true,directory:false},games:[]};
 const env={HOMIE_CONCEPT:'1',ASSETS:{fetch:async()=>Response.json(cat)}};
 const get=path=>worker.fetch(new Request('https://place.example'+path),env,{waitUntil:()=>{}});
 const page=await get('/');assert.equal(page.headers.get('x-robots-tag'),'noindex, nofollow');
 const html=await page.text();assert.ok(html.includes('TEST / CONCEPT'));
 assert.equal((await get('/.well-known/homie-studio.json')).status,404);
 assert.ok((await (await get('/robots.txt')).text()).includes('Disallow: /'));
});

test('concept frames keep no-index headers without repeating the outer page banner',async()=>{
 const env={HOMIE_CONCEPT:'1',ASSETS:{fetch:async()=>Response.json({studio:{name:'Example',concept:true},games:[]})}};
 const get=dest=>worker.fetch(new Request('https://place.example/',{headers:{'sec-fetch-dest':dest}}),env,{waitUntil:()=>{}});
 const frame=await get('iframe');
 assert.equal(frame.headers.get('x-robots-tag'),'noindex, nofollow');
 assert.ok(!(await frame.text()).includes('TEST / CONCEPT'));
 assert.ok((await (await get('document')).text()).includes('TEST / CONCEPT'));
});
