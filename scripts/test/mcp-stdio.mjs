import {spawn} from 'node:child_process';

/** A bounded stdio MCP client for the desktop bundle check. */
export function talk(cmd,args,{cwd,env={}}={}) {
  const child=spawn(cmd,args,{cwd,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
  const waiting=new Map();let buf='',err='',seq=0,ended=false,closing;
  const settle=(id,error,reply)=>{
    const pending=waiting.get(id);if(!pending)return;
    waiting.delete(id);clearTimeout(pending.timer);
    if(error)pending.reject(error);else pending.resolve(reply);
  };
  const rejectAll=error=>{for(const id of waiting.keys())settle(id,error);};
  const closed=new Promise(resolve=>child.once('close',()=>{
    ended=true;rejectAll(new Error(`MCP server closed\n${err.slice(-1500)}`));resolve();
  }));
  child.on('error',rejectAll);
  child.stdin.on('error',rejectAll);
  child.stderr.on('data',data=>{err+=data;});
  child.stdout.on('data',data=>{
    buf+=data;let nl;
    while((nl=buf.indexOf('\n'))>=0){
      const line=buf.slice(0,nl);buf=buf.slice(nl+1);if(!line.trim())continue;
      try{const reply=JSON.parse(line);settle(reply.id,null,reply);}
      catch(error){rejectAll(error);child.kill();}
    }
  });
  const request=(method,params)=>new Promise((resolve,reject)=>{
    if(ended||closing){reject(new Error('MCP server closed'));return;}
    const id=++seq;
    const timer=setTimeout(()=>settle(id,new Error(`no answer to ${method}\n${err.slice(-1500)}`)),60000);
    waiting.set(id,{resolve,reject,timer});
    child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id,method,params})}\n`,error=>{if(error)settle(id,error);});
  });
  const close=()=>closing??=(async()=>{
    rejectAll(new Error('MCP client closed'));
    if(ended)return;
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},5000);
    child.stdin.end();
    try{await closed;}finally{clearTimeout(timer);}
    if(timedOut)throw new Error('MCP server did not close after stdin ended');
  })();
  return {request,close,stderr:()=>err};
}
