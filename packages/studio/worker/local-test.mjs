/** Only dev supplies this secret. Neither a loopback URL nor a role parameter grants authority. */
const local = (request, env) => env.HOMIE_LOCAL_TEST_SECRET && ['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);
export async function localCaller(request, env) {
  const remote=await remoteSession(request,env);
  if(remote)return {id:`check-${remote.app}-${remote.role}`,owner:false,client:null,localTest:true,remoteTest:true,roles:{[remote.app]:[remote.role]},testApp:remote.app,testScope:remote.scope};
  if (!local(request, env) || request.headers.get('authorization') !== `Bearer ${env.HOMIE_LOCAL_TEST_SECRET}`) return null;
  const session=await localSession(request,env);
  // A supplied but invalid signed session must never fall back to owner.
  if(request.headers.get('cookie')?.includes('homie_test=')&&!session)return null;
  if(session)return {id:`local-test-${session.app}-${session.role}`,owner:session.role==='owner',client:null,localTest:true,roles:{[session.app]:[session.role]},testApp:session.app,testScope:session.scope??null};
  return {id:'local-test-owner',owner:true,client:null};
}
export async function localSession(request, env) {
  const remote=await remoteSession(request,env);if(remote)return remote;
  if (!local(request, env)) return null;
  const token = /(?:^|;\s*)homie_test=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
  if (!token) return null;
  try {
    const [data, signature] = token.split('.');
    if (!/^[a-f0-9]{64}$/.test(signature)) return null;
    const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(env.HOMIE_LOCAL_TEST_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    if (!await crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g),h=>parseInt(h,16)),new TextEncoder().encode(data))) return null;
    const session = JSON.parse(atob(data.replaceAll('-','+').replaceAll('_','/')));
    return /^[a-z][a-z0-9-]*$/.test(session.app) && /^[a-z][a-z0-9-]*$/.test(session.role) && (!session.scope || /^[a-zA-Z0-9-]+$/.test(session.scope)) ? session : null;
  } catch { return null; }
}

async function remoteSession(request,env) {
 const token=/(?:^|;\s*)homie_check=([^;]+)/.exec(request.headers.get('cookie')??'')?.[1];
 if(!token)return null;
 const session=await (await import('./office.mjs')).checkSessionTicket(env,null,token);
 return session?.origin===new URL(request.url).origin?{...session,remoteTest:true}:null;
}
