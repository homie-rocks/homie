/** Hydrate the R2-compatible metadata returned by the studio-scoped managed binding.
 * Streams cross RPC without buffering songs, videos or saves in the Worker heap. */
function object(value) {
 if(!value)return null;
 return {...value,
  writeHttpMetadata(headers){for(const [key,name] of Object.entries({contentType:'content-type',contentLanguage:'content-language',contentDisposition:'content-disposition',contentEncoding:'content-encoding',cacheControl:'cache-control',cacheExpiry:'expires'})){if(value.httpMetadata?.[key])headers.set(name,String(value.httpMetadata[key]));}},
  arrayBuffer:()=>new Response(value.body).arrayBuffer(),
  text:()=>new Response(value.body).text(),
  json:()=>new Response(value.body).json(),
 };
}
export function managedMedia(env) {
 if(!env.HOMIE_MEDIA)return env;
 const binding=env.HOMIE_MEDIA;
 return {...env,MEDIA:{get:async(key,options)=>object(await binding.get(key,options)),head:async key=>object(await binding.head(key)),put:async(key,body,options)=>object(await binding.put(key,body,options)),delete:keys=>binding.delete(keys)}};
}
