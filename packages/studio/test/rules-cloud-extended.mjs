/** Public bootstrap and unchanged trial driver, separate workerd processes. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
for(const total of (process.env.CROWD_TOTAL ? [Number(process.env.CROWD_TOTAL)] : [302,1000])) test(`Cloudflare transport reproduction: ${total} total seats`,{skip:process.env.RULES_EXTENDED!=='1',timeout:600000},async()=>{
  const out=await mkdtemp(join(tmpdir(),'homie-crowd-proof-'));
  const server=spawn(process.execPath,[fileURLToPath(new URL('./rules-cloud-local.mjs',import.meta.url))],{env:{...process.env,CROWD_PORT:'8810'},stdio:['ignore','pipe','pipe']});
  let log='',err='',driver;
  server.stderr.on('data',b=>{err+=b;});
  try {
    const info=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('workerd startup timed out: '+err.slice(-2000))),120000);
      server.on('exit',code=>{clearTimeout(timer);reject(Error('workerd exited '+code+': '+err.slice(-2000)));});
      server.stdout.on('data',b=>{log+=b;for(const line of log.split('\n')){try {const v=JSON.parse(line);if(v.driver){clearTimeout(timer);resolve(v);return;}}catch{}}});
    });
    driver=spawn(process.execPath,[...(process.env.CROWD_PROFILE ? ['--cpu-prof','--cpu-prof-dir='+out] : []),info.driver,'--url',info.url,'--n',String(total-2),'--seconds','60','--room','proof-'+total,'--out',out,'--ramp-ms',process.env.CROWD_RAMP_MS??'50'],{env:process.env,stdio:['ignore','pipe','pipe']});
    let driverLog='';driver.stdout.on('data',b=>{driverLog+=b;void appendFile(join(out,'driver-live.log'),b);});driver.stderr.on('data',b=>{driverLog+=b;void appendFile(join(out,'driver-live.log'),b);});
    const [code]=await once(driver,'exit');await writeFile(join(out,'driver.log'),driverLog);
    const report=JSON.parse(await readFile(join(out,'report.json'),'utf8'));
    console.log(JSON.stringify({out,code,total,joined:report.joined,live:report.connectedAtEnd,hz:report.tickHz,ack:report.inputAckMs}));
    assert.equal(code,0);assert.equal(report.joined,total-2);assert.equal(report.connectedAtEnd,total-2);assert.equal(report.disconnects,0);
    assert.ok(report.tickHz.median>=19.5 && report.tickHz.median<=20.5);
    // Four inter-object hops at 5 ms, plus one 50 ms scheduling phase.
    assert.ok(report.inputAckMs.p95<=220,`ack p95 ${report.inputAckMs.p95} ms`);
  } finally {
    driver?.kill('SIGTERM');server.kill('SIGTERM');if(server.exitCode===null)await once(server,'exit').catch(()=>{});
    await writeFile(join(out,'server.log'),log+'\n'+err);
  }
});
