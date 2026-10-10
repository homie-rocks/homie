import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {connectToolClient} from './tools-cli.mjs';
export async function functionCommand(root,sub,positional,flags,{log=()=>{}}={}) {
  if(sub==='new') {
    const name=positional[2],event=flags.get('event')??'order.paid';
    if(!/^[a-z][a-z0-9-]*$/.test(name??''))throw new Error('Use a lowercase function name');
    const file=join(root,'functions',name+'.ts');if(existsSync(file))throw new Error('Function already exists');
    mkdirSync(join(root,'functions'),{recursive:true});
    writeFileSync(file,`import { defineFunction } from '@homie-rocks/studio/functions';\nexport default defineFunction({\n  name: ${JSON.stringify(name)}, event: ${JSON.stringify(event)},\n  async handler(event, context) {\n    // Deduplicate external side effects with event.id (for example an API idempotency key).\n    await context.database.put(event.id, event.data);\n  },\n});\n`);
    return {ok:true,command:'function new',file,next:'Edit your function, then run homie-studio dev.'};
  }
  if(sub==='replay') {
    if(!flags.has('replay'))throw new Error('Pass --replay to explicitly request retained history');
    const client=await connectToolClient(root,new URL(flags.get('url')??'http://localhost:8787'),{log});
    try {const result=await client.callTool({name:'studio_function_replay',arguments:{name:positional[2]}});return {ok:!result.isError,command:'function replay',result};}finally{await client.close();}
  }
  if(sub!=='fire')throw new Error('Use function new <name> --event <event>, or function fire <event> --input <JSON>');
  const url=new URL(flags.get('url')??'http://localhost:8787');
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Fire is local testing only');
  const client=await connectToolClient(root,url,{log});
  try {const result=await client.callTool({name:'studio_function_fire',arguments:{event:positional[2],data:JSON.parse(flags.get('input')??'{}'),...(flags.has('id')?{id:flags.get('id')}: {})}});return {ok:!result.isError,command:'function fire',result};}finally{await client.close();}
}
