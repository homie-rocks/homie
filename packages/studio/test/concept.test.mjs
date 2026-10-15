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
