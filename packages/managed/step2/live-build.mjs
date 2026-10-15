import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {gunzipSync} from 'node:zlib';
import {local,state} from './operator.mjs';import {share,revoke} from './source.mjs';
const t=await share(3600);
try{
const job={...(process.argv[2]==='check'?{mode:'check',previewURL:'https://hm-s2-dispatch.ryan-d2f.workers.dev'}:{}),remote:state.remote,commit:state.pushes?.at(-1)?.commit??state.sourceCommit,readToken:t.plaintext,toolkit:'0.51.8',node:'v24.20.0',lockDigest:createHash('sha256').update(readFileSync(local+'source/package-lock.json')).digest('hex')};
const r=await fetch('https://hm-s2-builder.ryan-d2f.workers.dev/build',{method:'POST',headers:{authorization:'Bearer '+readFileSync(local+'run-key','utf8'),'content-type':'application/json'},body:JSON.stringify(job),signal:AbortSignal.timeout(620000)});
const result=await r.json();if(!r.ok)throw new Error(JSON.stringify(result));
const artifact=gunzipSync(Buffer.from(result.archive,'base64'));writeFileSync(local+(process.argv[2]==='check'?'studio-check.json':'artifact.json'),artifact);console.log({bytes:artifact.length,digest:createHash('sha256').update(artifact).digest('hex'),commit:job.commit});
}finally{await revoke(t.id);}
