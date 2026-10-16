import {test} from 'node:test';
import assert from 'node:assert/strict';
import {studioOrigin, boundedStudioFetch, studioResult} from '../worker/studios-client.mjs';
test('remote origins must be bare HTTPS origins',()=>{
 assert.equal(studioOrigin('https://venue.example'),'https://venue.example');
 for(const origin of ['http://venue.example','https://user:secret@venue.example','https://venue.example/path','https://venue.example?x=1','https://venue.example#x'])assert.throws(()=>studioOrigin(origin));
});
test('bounded transport refuses discovery escapes, redirects and oversized bodies',async()=>{
 let count=0;
 const safe=boundedStudioFetch('https://b.example',new AbortController().signal,{maxBytes:8,fetchFn:async(request)=>{count++;assert.equal(request.redirect,'manual');return new Response('123456789');}});
 await assert.rejects(()=>safe('https://evil.example/oauth/token'),/origin/);assert.equal(count,0);
 await assert.rejects(async()=> (await safe('https://b.example/mcp')).text(),/size/);
 const redirect=boundedStudioFetch('https://b.example',new AbortController().signal,{fetchFn:async()=>Response.redirect('https://evil.example')});
 await assert.rejects(()=>redirect('https://b.example/mcp'),/redirect/i);
});
test('structured and legacy toolkit results are decoded once and stay labelled as data',()=>{
 const envelope={kind:'untrusted-tool-data',tool:'book',data:{id:'booking'}};
 assert.deepEqual(studioResult({structuredContent:envelope,content:[]}),{isError:false,data:{id:'booking'},content:[]});
 assert.deepEqual(studioResult({content:[{type:'text',text:JSON.stringify(envelope)}]}).data,{id:'booking'});
 assert.deepEqual(studioResult({structuredContent:{available:true},content:[]}).data,{available:true});
 assert.equal(studioResult({isError:true,content:[{type:'text',text:'unavailable'}]}).isError,true);
});
