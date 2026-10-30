/**
 * A tool result goes to whoever called the MCP server, often an anonymous agent. Session material
 * (Set-Cookie headers, cookie strings, session tokens) must never ride along: the browser and HTTP
 * routes set cookies on their own responses, and MCP results carry none of it.
 */
const SESSION_KEY=/^(cookies?|set-?cookies?|session_?token|sessionToken)$/i;
const COOKIE_STRING=/^\s*[A-Za-z0-9_.-]+=[^;]*;\s*(?:[^;]*;\s*)*(?:Path|HttpOnly|Max-Age|Expires|SameSite|Secure|Domain)\b/i;
export function withoutSessionMaterial(value,depth=0) {
  if(depth>32||value===null||typeof value!=='object')return typeof value==='string'&&COOKIE_STRING.test(value)?undefined:value;
  if(Array.isArray(value))return value.map(v=>withoutSessionMaterial(v,depth+1)).filter(v=>v!==undefined);
  const out={};
  for(const [key,v] of Object.entries(value)){
    if(SESSION_KEY.test(key))continue;
    const kept=withoutSessionMaterial(v,depth+1);
    if(kept!==undefined)out[key]=kept;
  }
  // An account block left with nothing but the stripped cookies is dropped too.
  if(out.account&&typeof out.account==='object'&&!Array.isArray(out.account)&&!Object.keys(out.account).length)delete out.account;
  return out;
}
/** MCP content text that is JSON gets the same treatment; other text is left as it is. */
export function textWithoutSessionMaterial(text) {
  if(typeof text!=='string'||!/cookie|session_?token|sessionToken/i.test(text))return text;
  try{return JSON.stringify(withoutSessionMaterial(JSON.parse(text)));}catch{return text;}
}
export function resultWithoutSessionMaterial(result) {
  if(!result||typeof result!=='object')return result;
  const out={...result};
  if(Array.isArray(out.content))out.content=out.content.map(c=>c?.type==='text'?{...c,text:textWithoutSessionMaterial(c.text)}:c);
  if(out.structuredContent!==undefined)out.structuredContent=withoutSessionMaterial(out.structuredContent);
  return out;
}
