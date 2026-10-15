/** One test origin per environment. Script identity is trusted deployment configuration. */
export default {async fetch(request,env){
 const url=new URL(request.url);if(url.hostname!==env.HOST)return new Response('Not found',{status:404});
 return env.STUDIOS.get(env.SCRIPT,{}, {limits:{cpuMs:1000,subRequests:128}}).fetch(request);
}};
