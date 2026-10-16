/** Ordered input batches over bindings. A completed request holds no connection;
 * output travels on a separate stream, never a recursive callback chain. */
export function relayChannel(ctx, deliver) {
  const listeners = new Map();
  let chain = Promise.resolve(), closed = false, pending = 0;
  const emit = (name, event) => { for (const fn of listeners.get(name) ?? []) fn(event); };
  return {
    accept() {},
    addEventListener(name, fn) { const list = listeners.get(name) ?? []; list.push(fn); listeners.set(name, list); },
    emit,
    send(data) {
      if (closed) throw new Error('Relay channel closed');
      if (++pending > 64) throw new Error('Relay channel queue limit');
      chain = chain.then(async () => {
        if (closed) return;
        const response = await deliver(data);
        if (!response.ok) throw new Error('Relay delivery failed: ' + response.status);
        await response.body?.cancel();
      }).catch(error => { if (!closed) { closed = true; emit('error', {error}); } }).finally(() => { pending--; });
      ctx.waitUntil(chain);
    },
    close(code, reason) { if (!closed) { closed = true; emit('close', {code, reason}); } },
  };
}

/** A Table's output is ordered on one stream while active. Closing the stream
 * detaches transport, not logical players. An alarm or a player's next message
 * can request another stream without sending a new welcome. */
export function relayStream(ctx, wake) {
  const listeners = new Map(), encoder = new TextEncoder();
  const limit = 4 * 1024 * 1024;
  let controller = null, queued = [], bytes = 0, waking = false;
  const emit = (name, event) => { for (const fn of listeners.get(name) ?? []) fn(event); };
  const request = () => {
    if (waking) return;
    waking = true;
    ctx.waitUntil(Promise.resolve().then(wake).catch(error => { waking = false; emit('error', {error}); }));
  };
  return {
    accept() {}, emit,
    addEventListener(name, fn) { const list=listeners.get(name)??[];list.push(fn);listeners.set(name,list); },
    send(data) {
      const chunk = encoder.encode(data+'\n');
      if (chunk.byteLength + (controller ? limit-controller.desiredSize : bytes) > limit) throw new Error('Relay output queue limit');
      if (controller) controller.enqueue(chunk);
      else { queued.push(chunk);bytes+=chunk.byteLength;request(); }
    },
    open() {
      controller?.close();
      let owned;
      return new ReadableStream({
        start(next) { owned=next;controller=next;waking=false;for(const chunk of queued)next.enqueue(chunk);queued=[];bytes=0; },
        cancel() { if(controller===owned)controller=null; },
      },{highWaterMark:limit,size:chunk=>chunk.byteLength});
    },
    sleep() { controller?.close();controller=null; },
    close(code,reason) {
      if(controller){controller.enqueue(encoder.encode(JSON.stringify([['link-close',code,reason]])+'\n'));controller.close();}
      controller=null;queued=[];bytes=0;emit('close',{code,reason});
    },
  };
}

export async function readRelay(response, socket) {
  if (!response.ok || !response.body) throw new Error('Relay stream refused');
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
  try {
    for (;;) {
      const {value,done}=await reader.read();if(done)break;
      pending+=decoder.decode(value,{stream:true});
      let end;while((end=pending.indexOf('\n'))>=0){if(end>4*1024*1024)throw new Error('Relay frame limit');const data=pending.slice(0,end);pending=pending.slice(end+1);socket.emit('message',{data});}
      if(pending.length>4*1024*1024)throw new Error('Relay frame limit');
    }
    if(pending)throw new Error('Incomplete relay frame');
  } finally { await reader.cancel().catch(()=>{}); }
}
