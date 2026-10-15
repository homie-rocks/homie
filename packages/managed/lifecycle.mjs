/** Only provisioning-transient errors are retried. Never retry arbitrary migration failures. */
export async function waitForDatabase(probe,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),attempts=12}={}) {
  for(let attempt=0;attempt<attempts;attempt++) {
    try {return await probe();}catch(error) {
      if(!/7403|not found|not ready/i.test(String(error))||attempt===attempts-1)throw error;
      await sleep(Math.min(500*2**attempt,5000));
    }
  }
}
export async function removeResource(api,path,readPath=path) {
  const before=await api(readPath);
  if(before!==null)await api(path,'DELETE');
  const after=await api(readPath);
  if(after!==null)throw new Error(`Resource still exists: ${path}`);
  return {path,existed:before!==null,result:before===null?'already absent':'deleted',absent:true};
}
