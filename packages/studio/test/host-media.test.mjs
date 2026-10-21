import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hostMedia} from '../worker/host-media.mjs';
test('host media streams bytes and metadata for range reads and private saves',async()=>{
 const calls=[];
 const env=hostMedia({HOMIE_MEDIA:{get:async(key,opts)=>{calls.push({key,opts});return {body:new Response('bytes').body,httpMetadata:{contentType:'audio/mpeg'},httpEtag:'"abc"'}},delete:keys=>calls.push(keys)}});
 const obj=await env.MEDIA.get('songs/theme.mp3',{range:{offset:2,length:5}});
 assert.equal(await obj.text(),'bytes');const headers=new Headers();obj.writeHttpMetadata(headers);assert.equal(headers.get('content-type'),'audio/mpeg');
 assert.deepEqual(calls[0].opts,{range:{offset:2,length:5}});
 await env.MEDIA.delete(['players/private-save']);assert.deepEqual(calls[1],['players/private-save']);
});
