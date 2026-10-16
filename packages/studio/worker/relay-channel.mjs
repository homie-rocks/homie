/** Ordered input batches over bindings. A completed request holds no connection;
 * output travels on a separate stream, never a recursive callback chain. */
export function relayChannel(ctx, deliver) {
  const listeners = new Map();
  let chain = Promise.resolve(), closed = false, pending = 0, pendingBytes = 0, live = null;
  const emit = (name, event) => { for (const fn of listeners.get(name) ?? []) fn(event); };
  return {
    accept() {},
    addEventListener(name, fn) { const list = listeners.get(name) ?? []; list.push(fn); listeners.set(name, list); },
    emit,
    async attachLive(socket) {
      socket.addEventListener('message',event=>emit('message',event));
      socket.addEventListener('close',()=>{try{socket.close(1000,'detached');}catch{}if(live===socket){live=null;emit('detached',{});}});
      socket.addEventListener('error',()=>{if(live===socket){live=null;emit('detached',{});}});
      await chain;
      if(closed){socket.close(1000,'closed');return;}
      if(socket.readyState!==1)return;
      live=socket;
      emit('drain',{});
    },
    isLive:()=>Boolean(live),
    canSend(size) { return Boolean(live) || pendingBytes+size<=4*1024*1024; },
    send(data) {
      if(live){try{if(live.readyState===1){live.send(data);return;}}catch{ /* Retry over the idle transport. */ }live=null;}
      if (closed) throw new Error('Relay channel closed');
      const size=data.length;
      if (pendingBytes+size>4*1024*1024) throw new Error('Relay channel queue limit');
      pending++;pendingBytes+=size;
      chain = chain.then(async () => {
        if (closed) return;
        const response = await deliver(data);
        if (!response.ok) throw new Error('Relay delivery failed: ' + response.status);
        await response.body?.cancel();
      }).catch(error => { if (!closed) { closed = true; emit('error', {error}); } }).finally(() => { pending--;pendingBytes-=size;emit('drain',{}); });
      ctx.waitUntil(chain);
    },
    close(code, reason) { if (!closed) { closed = true;live?.close(code,reason);live=null;emit('close', {code, reason}); } },
  };
}

/** A Table's output is ordered on one stream while active. Closing the stream
 * detaches transport, not logical players. An alarm or a player's next message
 * can request another stream without sending a new welcome. */
export function relayStream(ctx, wake) {
  const listeners = new Map(), encoder = new TextEncoder();
  const limit = 4 * 1024 * 1024;
  let controller = null, live = null, queued = [], bytes = 0, waking = false;
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
      if(live){try{if(live.readyState===1){live.send(data);return;}}catch{ /* Retry over the idle transport. */ }live=null;}
      const chunk = encoder.encode(data+'\n');
      if (chunk.byteLength + (controller ? limit-controller.desiredSize : bytes) > limit) throw new Error('Relay output queue limit');
      if (controller) controller.enqueue(chunk);
      else { queued.push(chunk);bytes+=chunk.byteLength;request(); }
    },
    attachLive(socket) {
      controller?.close();controller=null;live?.close(1000,'replaced');live=socket;waking=false;
      for(const chunk of queued)socket.send(new TextDecoder().decode(chunk).trimEnd());queued=[];bytes=0;
      socket.addEventListener('close',()=>{try{socket.close(1000,'detached');}catch{}if(live===socket)live=null;});
      socket.addEventListener('error',()=>{if(live===socket)live=null;});
    },
    open() {
      controller?.close();
      let owned;
      return new ReadableStream({
        start(next) { owned=next;controller=next;waking=false;for(const chunk of queued)next.enqueue(chunk);queued=[];bytes=0; },
        cancel() { if(controller===owned)controller=null; },
      },{highWaterMark:limit,size:chunk=>chunk.byteLength});
    },
    sleep() { controller?.close();controller=null;const socket=live;live=null;socket?.close(1000,'room idle'); },
    close(code,reason) {
      live?.close(code,reason);live=null;
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
