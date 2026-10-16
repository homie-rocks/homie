import {localCookie} from './local-test.mjs';

/** Each action has an explicit local identity, using the real MCP transport and permissions. */
export function needsHeadless({url,secret,app,meta,scope,sessionFor}) {
  return async (item,role) => {
    if(!secret&&!sessionFor)throw new Error('Headless role proof requires homie-studio dev in this studio and its localhost URL');
    if(!role || (role!=='owner'&&!Object.hasOwn(meta.roles??{},role)))throw new Error(`Name a declared role (or owner) for headless proof; got ${role??'none'}`);
    const {Client,StreamableHTTPClientTransport}=await import('mcp-studio-client');
    const client=new Client({name:'Homie needs check',version:'1.0.0'});
    const cookie=sessionFor?await sessionFor(role):{name:'homie_test',value:localCookie(secret,{app,role,scope})};
    const transport=new StreamableHTTPClientTransport(new URL('/mcp',url),{requestInit:{headers:{...(secret?{authorization:`Bearer ${secret}`} : {}),...(cookie?{cookie:`${cookie.name}=${cookie.value}`}:{})}}});
    try {
      await client.connect(transport);
      let call=item.mcp;
      if(item.records)call={tool:'app_records',arguments:{...item.records,app,role,operation:'read'}};
      if(item.schedule)call={tool:'studio_schedule_fire',arguments:item.schedule};
      if(call?.method) {
        if(call.method==='resources/read')return await client.readResource(call.params);
        // The extension's JSON-RPC result is intentionally preserved for path assertions.
        if(['events/list','events/poll'].includes(call.method)) {
          const {z}=await import('zod');
          return await client.request({method:call.method,params:call.params??{}},z.object({}).passthrough(),{timeout:10000});
        }
        throw new Error(`Unsupported MCP proof method ${call.method}; use tools, resources/read, events/list or events/poll`);
      }
      if(!call?.tool)throw new Error('MCP step requires tool and optional arguments');
      const result=await client.callTool({name:call.tool,arguments:call.arguments??{}},undefined,{timeout:item.schedule?15000:10000});
      if(result.isError)throw new Error(result.content?.filter(c=>c.type==='text').map(c=>c.text).join('; ')||'MCP tool failed');
      if(result.structuredContent!==undefined){const value=result.structuredContent;return value?.kind==='untrusted-tool-data'?value.data:value;}
      const content=result.content?.filter(c=>c.type==='text');
      if(content?.length===1) {try {const parsed=JSON.parse(content[0].text);return parsed.kind==='untrusted-tool-data'?parsed.data:parsed;}catch{}}
      return result;
    } finally {await client.close();}
  };
}
