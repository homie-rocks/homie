import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jsonSseReader,nextSseJson} from './sse-fixture.mjs';
import {notification,sseFrame} from '../worker/mcp-events-wire.mjs';

test('SSE JSON reader preserves coalesced frames and fragmented UTF-8 and delimiters',async()=>{
  const messages=[notification('event',{data:{name:'café 🫖'}},1),notification('heartbeat',{cursor:'v1:sample:1'},1)];
  const bytes=new TextEncoder().encode(': connected\r\n\r\n'+messages.map(m=>new TextDecoder().decode(sseFrame(m))).join(''));
  for(const chunks of [[bytes],Array.from(bytes,byte=>Uint8Array.of(byte))]) {
    const reader=jsonSseReader(new ReadableStream({start(c){for(const chunk of chunks)c.enqueue(chunk);c.close();}}));
    try {
      for(const message of messages)assert.deepEqual(await nextSseJson(reader),message);
      await assert.rejects(()=>nextSseJson(reader),/SSE ended/);
    } finally {await reader.cancel();}
  }
});

test('SSE JSON reader does not hide malformed event payloads',async()=>{
  const reader=jsonSseReader(new Response('event: message\ndata: {}{}\n\n').body);
  await assert.rejects(()=>nextSseJson(reader),SyntaxError);
});
